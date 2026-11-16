import { sourceJson, SourceThrottleError } from './http.js';
import { comprasPage } from './compras.js';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../../core/db.js';
import type { Tenant } from '../identity/index.js';
import { syncSchema } from '@nthub/contracts';
import { enqueueEnrichment } from '../documents/index.js';
import { matchCompany } from './matching.js';
const recordSchema = z
  .object({
    numeroControlePNCP: z.string(),
    objetoCompra: z.string(),
    orgaoEntidade: z.object({ razaoSocial: z.string() }),
    unidadeOrgao: z.object({
      ufSigla: z.string().nullish(),
      municipioNome: z.string().nullish(),
    }),
    valorTotalEstimado: z.number().nullish(),
    dataEncerramentoProposta: z.string().nullish(),
  })
  .passthrough();
export async function collect(input: unknown, t: Tenant, jobId?: string) {
  const opts = syncSchema.parse(input);
  const [company] =
    await sql`SELECT capabilities,search_settings FROM companies WHERE id=${t.companyId} AND organization_id=${t.organizationId} AND active AND NOT is_parent`;
  if (!company) throw new Error('Empresa indisponível.');
  const runId = jobId || randomUUID();
  await sql`INSERT INTO source_runs(id,organization_id,company_id,source,input) VALUES(${runId},${t.organizationId},${t.companyId},${opts.source},${sql.json(opts)}) ON CONFLICT DO NOTHING`;
  const [run] =
    await sql`SELECT cursor_page,records_processed,opportunities_processed FROM source_runs WHERE id=${runId} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
  if (!run) throw new Error('Contexto de coleta inválido.');
  let page = Number(run.cursor_page),
    total = page,
    count = Number(run.opportunities_processed),
    records = Number(run.records_processed);
  await sql`UPDATE source_runs SET status='running',error=NULL WHERE id=${runId}`;
  try {
    do {
      const query = new URLSearchParams({
        dataInicial: opts.since.replaceAll('-', ''),
        dataFinal: opts.until.replaceAll('-', ''),
        codigoModalidadeContratacao: String(opts.modality),
        pagina: String(page),
        tamanhoPagina: '50',
        ...(opts.uf ? { uf: opts.uf } : {}),
      });
      const payload =
        opts.source === 'compras'
          ? await comprasPage(opts, page)
          : await sourceJson(
              'https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?' +
                query,
            );
      if (Array.isArray(payload) && payload.length === 0) break;
      const batch = z
        .object({
          data: z.array(recordSchema),
          totalPaginas: z.number().int().nonnegative(),
        })
        .parse(payload);
      total = batch.totalPaginas;
      for (const raw of batch.data) {
        const result = matchCompany(
          raw.objetoCompra,
          company.capabilities as string[],
          company.search_settings,
          {
            uf: raw.unidadeOrgao.ufSigla || null,
            value: raw.valorTotalEstimado ?? null,
            deadline: raw.dataEncerramentoProposta || null,
          },
        );
        let matchedId: string | undefined;
        await sql.begin(async (tx) => {
          const [p] =
            await tx`INSERT INTO procurements(id,source_id,title,agency,uf,city,value,deadline,source_url,raw) VALUES(${randomUUID()},${raw.numeroControlePNCP},${raw.objetoCompra},${raw.orgaoEntidade.razaoSocial},${raw.unidadeOrgao.ufSigla ?? null},${raw.unidadeOrgao.municipioNome ?? null},${raw.valorTotalEstimado ?? null},${raw.dataEncerramentoProposta ?? null},${'https://pncp.gov.br/app/editais/' + raw.numeroControlePNCP.replace(/^(\d+)-1-(\d+)\/(\d+)$/, '$1/$3/$2')},${tx.json(z.json().parse(raw))}) ON CONFLICT(source_id) DO UPDATE SET title=EXCLUDED.title,agency=EXCLUDED.agency,uf=EXCLUDED.uf,city=EXCLUDED.city,value=EXCLUDED.value,deadline=EXCLUDED.deadline,raw=CASE WHEN ${opts.source}='compras' AND EXISTS(SELECT 1 FROM procurement_sources ps WHERE ps.procurement_id=procurements.id AND ps.source='pncp') THEN procurements.raw ELSE EXCLUDED.raw END,updated_at=now() RETURNING id`;
          if (!p) return;
          await tx`INSERT INTO procurement_sources(procurement_id,source,source_key,payload) VALUES(${p.id},${opts.source},${raw.numeroControlePNCP},${tx.json(z.json().parse(raw))}) ON CONFLICT(procurement_id,source) DO UPDATE SET payload=EXCLUDED.payload,observed_at=now()`;
          const hash = createHash('sha256')
            .update(JSON.stringify(raw))
            .digest('hex');
          await tx`INSERT INTO procurement_versions(id,procurement_id,payload_hash,raw) VALUES(${randomUUID()},${p.id},${hash},${tx.json(z.json().parse(raw))}) ON CONFLICT(procurement_id,payload_hash) DO NOTHING`;
          if (result.matches.length) {
            await tx`SELECT pg_advisory_xact_lock(hashtextextended(${t.organizationId + ':' + p.id},0))`;
            const [op] =
              await tx`INSERT INTO opportunities(id,organization_id,company_id,procurement_id,score,matches) SELECT ${randomUUID()},${t.organizationId},${t.companyId},${p.id},${result.score},${tx.json(result.matches)} WHERE NOT EXISTS(SELECT 1 FROM opportunity_routes r WHERE r.organization_id=${t.organizationId} AND r.procurement_id=${p.id} AND r.excluded_company_id=${t.companyId}) ON CONFLICT(company_id,procurement_id) DO UPDATE SET score=EXCLUDED.score,matches=EXCLUDED.matches RETURNING id,(xmax=0) AS is_new`;
            if (op) {
              count++;
              matchedId = op.id;
              if (op.is_new)
                await tx`INSERT INTO outbox(id,type,payload) VALUES(${randomUUID()},'domain.event',${tx.json({ tenant: t, event: 'opportunity.created', resourceId: op.id, data: { title: raw.objetoCompra, sourceId: raw.numeroControlePNCP } })})`;
            }
          }
        });
        if (matchedId) await enqueueEnrichment(t, matchedId);
        records++;
      }
      page++;
      await sql`UPDATE source_runs SET cursor_page=${page},records_processed=${records},opportunities_processed=${count} WHERE id=${runId}`;
      if (page > 500 && page <= total)
        throw new Error('Coleta excedeu 500 páginas. Reduza o intervalo.');
    } while (page <= total);
    await sql`UPDATE source_runs SET status='completed',completed_at=now(),records_processed=${records},opportunities_processed=${count} WHERE id=${runId}`;
    return { processed: count, pages: page - 1, records };
  } catch (error) {
    await sql`UPDATE source_runs SET status=${error instanceof SourceThrottleError ? 'waiting' : 'failed'},error=${error instanceof Error ? error.message : 'Falha na coleta.'} WHERE id=${runId}`;
    throw error;
  }
}
