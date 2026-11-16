import {
  ANALYSIS_VERSION,
  calculateAdherence,
  companyFacts,
} from '../intelligence/adherence.js';
import { SourceThrottleError } from '../sources/http.js';
import { storeBlob, loadBlob } from '../../core/storage.js';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../../core/db.js';
import { config } from '../../core/config.js';
import type { Tenant } from '../identity/index.js';
import { requireOpportunity } from '../opportunities/index.js';
import { assess, type Page } from '../intelligence/index.js';
import { downloadOfficial, officialJson, procurementBase } from './network.js';
import {
  pdfText,
  transcribePdf,
  zipEntries,
  sanitizeExtractedText,
} from './extract.js';

export async function enqueueEnrichment(t: Tenant, id: string) {
  await requireOpportunity(t, id);
  return sql.begin(async (tx) => {
    const [op] =
      await tx`SELECT processing_state,processing_job_id FROM opportunities WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} FOR UPDATE`;
    if (!op) throw new Error('Oportunidade não encontrada.');
    if (
      ['queued', 'processing'].includes(op.processing_state) &&
      op.processing_job_id
    )
      return op.processing_job_id as string;
    const jobId = randomUUID();
    await tx`INSERT INTO outbox(id,type,payload) VALUES(${jobId},'enrich',${tx.json({ opportunityId: id, tenant: t })})`;
    await tx`UPDATE opportunities SET processing_state='queued',processing_error=NULL,processing_job_id=${jobId} WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
    return jobId;
  });
}
export function documentSetHash(
  docs: { id: string; hash: string; state?: string }[],
) {
  return createHash('sha256')
    .update(
      docs
        .map((d) => d.id + ':' + d.hash + ':' + (d.state || ''))
        .sort()
        .join('|'),
    )
    .digest('hex');
}
export async function analyzeOpportunity(t: Tenant, id: string) {
  const opportunity = await requireOpportunity(t, id);
  const [sourceContext] =
    await sql`SELECT raw,items FROM procurements WHERE id=${opportunity.procurement_id}`;
  let docs =
    await sql`SELECT id,name,hash,pages,extraction_status,content,storage_key FROM documents WHERE opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND active=true ORDER BY source_key NULLS LAST,id`;
  const ocrDocuments = docs.filter((d) => d.extraction_status === 'needs_ocr');
  for (const doc of ocrDocuments) {
    const pages = await transcribePdf(
      await loadBlob(doc.content, doc.storage_key),
      doc.pages as Page[],
    );
    await sql`UPDATE documents SET pages=${sql.json(pages)},extraction_status='ready',extraction_error=NULL WHERE id=${doc.id} AND opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND active`;
    doc.pages = pages;
    doc.extraction_status = 'ready';
  }
  if (ocrDocuments.length) {
    const remaining = String(opportunity.processing_error || '')
      .split('\n')
      .filter(
        (line) =>
          line &&
          !line.includes(
            'PDF digitalizado. A leitura por IA será realizada somente',
          ),
      )
      .join('\n');
    const ready = docs.every((d) =>
      ['ready', 'archive'].includes(d.extraction_status),
    );
    await sql`UPDATE opportunities SET processing_error=${remaining || null},processing_state=${ready && !remaining ? 'ready' : 'partial'} WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND processing_state='partial' AND processing_error IS NOT DISTINCT FROM ${opportunity.processing_error || null}`;
  }
  const readable = docs.filter(
    (d) => d.extraction_status === 'ready' && d.pages.length,
  );
  if (!readable.length)
    throw new Error('Nenhum documento legível foi disponibilizado pela fonte.');
  const fingerprint = documentSetHash(
    docs.map((d) => ({
      id: String(d.id),
      hash: String(d.hash),
      state: String(d.extraction_status || d.extractionStatus),
    })),
  );
  const [company] =
    await sql`SELECT name,description,capabilities,criteria_version FROM companies WHERE id=${t.companyId} AND organization_id=${t.organizationId}`;
  if (!company) throw new Error('Empresa indisponível.');
  const [previous] =
    await sql`SELECT id FROM analyses WHERE opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND document_set_hash=${fingerprint} AND model=${config.GEMINI_MODEL} AND prompt_version=${ANALYSIS_VERSION} AND criteria_version=${company.criteria_version}`;
  if (previous) return { ok: true, cached: true };
  const chunks: Page[][] = [];
  let current: Page[] = [];
  let size = 0;
  for (const d of readable)
    for (const p of d.pages as Page[]) {
      if (size + p.text.length > 700000 && current.length) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push({ ...p, documentId: d.id, documentName: d.name });
      size += p.text.length;
    }
  if (current.length) chunks.push(current);
  const results: Awaited<ReturnType<typeof assess>>[] = [];
  for (const chunk of chunks)
    results.push(
      await assess(
        chunk,
        company.capabilities as string[],
        {
          company: {
            name: company.name,
            description: company.description,
            capabilities: company.capabilities,
          },
          publication: sourceContext?.raw,
          items: sourceContext?.items,
          partial: chunks.length > 1,
        },
        companyFacts({ description: company.description || '' }),
      ),
    );
  const adherence = calculateAdherence(
    results.flatMap(
      (r) => r.adherence?.dimensions.flatMap((d) => d.criteria) || [],
    ),
  );
  const result = {
    adherence,
    summary: results.map((r) => r.summary).join('\n\n'),
    relevanceScore: adherence.overallScore,
    requirements: results.flatMap((r) => r.requirements),
    risks: results.flatMap((r) => r.risks),
    missingInformation: [
      ...new Set([
        ...results.flatMap((r) => r.missingInformation),
        ...docs
          .filter((d) => !['ready', 'archive'].includes(d.extraction_status))
          .map(
            (d) => `Anexo não analisado: ${d.name} (${d.extraction_status}).`,
          ),
      ]),
    ],
  };
  await sql.begin(async (tx) => {
    await tx`INSERT INTO analyses(id,organization_id,company_id,opportunity_id,document_id,result,model,prompt_version,document_set_hash,criteria_version,input_tokens,output_tokens) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${id},${readable[0]!.id},${tx.json(result)},${config.GEMINI_MODEL},${ANALYSIS_VERSION},${fingerprint},${company.criteria_version},${results.reduce((n, r) => n + (r.usage?.inputTokens || 0), 0)},${results.reduce((n, r) => n + (r.usage?.outputTokens || 0), 0)})`;
    await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'analysis:completed',${id})`;
    await tx`INSERT INTO outbox(id,type,payload) VALUES(${randomUUID()},'domain.event',${tx.json({ tenant: t, event: 'analysis.completed', resourceId: id, data: { model: config.GEMINI_MODEL } })})`;
  });
  return { ok: true, cached: false };
}
const fileSchema = z.object({
  sequencialDocumento: z.number().int().positive(),
  titulo: z.string(),
  url: z.string().optional(),
  statusAtivo: z.boolean().optional(),
});
const itemSchema = z
  .object({ numeroItem: z.number().int().positive(), descricao: z.string() })
  .passthrough();
export async function enrichOpportunity(t: Tenant, id: string) {
  const op = await requireOpportunity(t, id);
  const [proc] =
    await sql`SELECT source_id FROM procurements WHERE id=${op.procurement_id}`;
  if (!proc) throw new Error('Contratação não encontrada.');
  const base = procurementBase(proc.source_id);
  await sql`UPDATE opportunities SET processing_state='processing',processing_error=NULL WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
  const warnings: string[] = [];
  try {
    const files = z
      .array(fileSchema)
      .parse(await officialJson(base + '/arquivos'))
      .filter((f) => f.statusAtivo !== false);
    if (files.length > 50)
      throw new Error(
        'Fonte retornou mais de 50 anexos. Coleta não concluída.',
      );
    const items: z.infer<typeof itemSchema>[] = [];
    try {
      for (let page = 1; page <= 100; page++) {
        const batch = z
          .array(itemSchema)
          .parse(
            await officialJson(base + `/itens?pagina=${page}&tamanhoPagina=50`),
          );
        items.push(...batch);
        if (batch.length < 50) break;
        if (page === 100) throw new Error('Fonte excede 5 mil itens.');
      }
      await sql`UPDATE procurements SET items=${sql.json(z.json().parse(items))} WHERE id=${op.procurement_id}`;
    } catch (e) {
      if (e instanceof SourceThrottleError) throw e;
      warnings.push('Itens: ' + message(e));
    }
    const seen: string[] = [];
    let budget = 0;
    const processFile = async (
      key: string,
      name: string,
      url: string,
      bytes: Buffer,
      depth = 0,
    ): Promise<void> => {
      seen.push(key);
      budget += bytes.length;
      if (budget > 120 * 1024 * 1024)
        throw new Error('Conjunto de anexos excede 120 MB.');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const [existing] =
        await sql`SELECT id,hash,extraction_status FROM documents WHERE opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND source_key=${key}`;
      const isPdf = bytes.subarray(0, 5).toString() === '%PDF-';
      const isZip =
        bytes.subarray(0, 2).toString() === 'PK' && !/\.docx$/i.test(name);
      let pages: { page: number; text: string }[] = [];
      let state = 'unsupported';
      let error: string | null = null;
      let mime = 'application/octet-stream';
      if (existing?.hash === hash && existing.extraction_status === 'ready') {
        await sql`UPDATE documents SET active=true,name=${name.slice(0, 400)},source_url=${url} WHERE id=${existing.id}`;
        return;
      }
      try {
        if (isPdf) {
          mime = 'application/pdf';
          const extracted = await pdfText(bytes);
          pages = extracted.pages;
          if (extracted.needsOcr) {
            state = 'needs_ocr';
            error =
              'PDF digitalizado. A leitura por IA será realizada somente se você solicitar a análise.';
          }
          if (state !== 'needs_ocr') state = 'ready';
        } else if (isZip) {
          mime = 'application/zip';
          state = 'archive';
          if (depth >= 2)
            throw new Error('ZIP excede profundidade de dois níveis.');
        } else if (/\.(txt|csv)$/i.test(name)) {
          mime = 'text/plain';
          const text = sanitizeExtractedText(bytes.toString('utf8'));
          if (text.length > 250000)
            throw new Error('Texto excede 250 mil caracteres.');
          pages = [{ page: 1, text }];
          state = 'ready';
        } else
          error =
            'Formato disponível para consulta, ainda sem extração automática.';
      } catch (e) {
        if (e instanceof SourceThrottleError) throw e;
        state = 'failed';
        error = message(e);
      }
      const stored = await storeBlob(
        `${t.organizationId}/${t.companyId}/sources/${id}/${hash}`,
        bytes,
        mime,
      );
      await sql`INSERT INTO documents(id,organization_id,company_id,opportunity_id,name,hash,pages,source_key,source_url,content,storage_key,mime,extraction_status,extraction_error,active) VALUES(${existing?.id || randomUUID()},${t.organizationId},${t.companyId},${id},${name.slice(0, 400)},${hash},${sql.json(pages)},${key},${url},${stored.content},${stored.storageKey},${mime},${state},${error},true) ON CONFLICT(opportunity_id,source_key) WHERE source_key IS NOT NULL DO UPDATE SET name=EXCLUDED.name,hash=EXCLUDED.hash,pages=EXCLUDED.pages,source_url=EXCLUDED.source_url,content=EXCLUDED.content,storage_key=EXCLUDED.storage_key,mime=EXCLUDED.mime,extraction_status=EXCLUDED.extraction_status,extraction_error=EXCLUDED.extraction_error,active=true`;
      if (error) warnings.push(name + ': ' + error);
      if (isZip && state === 'archive') {
        try {
          const entries = await zipEntries(bytes);
          if (!entries.length) warnings.push(name + ': ZIP vazio.');
          for (const entry of entries) {
            if (seen.length >= 150)
              throw new Error('Conjunto excede 150 arquivos.');
            await processFile(
              key + '/' + entry.name,
              entry.name,
              url,
              entry.bytes,
              depth + 1,
            );
          }
        } catch (e) {
          if (e instanceof SourceThrottleError) throw e;
          warnings.push(name + ': ' + message(e));
          await sql`UPDATE documents SET extraction_status='failed',extraction_error=${message(e)} WHERE opportunity_id=${id} AND source_key=${key} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
        }
      }
    };
    for (const file of files) {
      const key = String(file.sequencialDocumento);
      const url = base + '/arquivos/' + file.sequencialDocumento;
      try {
        await processFile(key, file.titulo, url, await downloadOfficial(url));
      } catch (e) {
        if (e instanceof SourceThrottleError) throw e;
        seen.push(key);
        const error = message(e);
        warnings.push(file.titulo + ': ' + error);
        await sql`INSERT INTO documents(id,organization_id,company_id,opportunity_id,name,hash,pages,source_key,source_url,extraction_status,extraction_error) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${id},${file.titulo},'',${sql.json([])},${key},${url},'failed',${error}) ON CONFLICT(opportunity_id,source_key) WHERE source_key IS NOT NULL DO UPDATE SET extraction_status='failed',extraction_error=EXCLUDED.extraction_error,active=true`;
      }
    }
    // Only retire removed files after the authoritative list and every attempt were recorded.
    await sql`UPDATE documents SET active=false WHERE opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND source_key IS NOT NULL AND NOT (source_key=ANY(${seen}::text[]))`;
    if (!files.length)
      warnings.push(
        'O PNCP ainda não disponibilizou anexos para esta contratação.',
      );
    await sql.begin(async (tx) => {
      await tx`UPDATE opportunities SET processing_state=${warnings.length ? 'partial' : 'ready'},processing_error=${warnings.length ? warnings.join('\n').slice(0, 6000) : null},synced_at=now() WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'source:documents-collected',${id})`;
    });
    return { documents: files.length, items: items.length, warnings };
  } catch (error) {
    if (error instanceof SourceThrottleError) {
      await sql`UPDATE opportunities SET processing_state='queued',processing_error=${error.message} WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
      throw error;
    }
    await sql`UPDATE opportunities SET processing_state='failed',processing_error=${message(error)} WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
    throw error;
  }
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Falha no processamento da fonte.';
}
export async function opportunityContent(t: Tenant, id: string) {
  const op = await requireOpportunity(t, id);
  const [p] =
    await sql`SELECT raw,items,source_url FROM procurements WHERE id=${op.procurement_id}`;
  const docs =
    await sql`SELECT id,name,hash,source_url AS "sourceUrl",mime,extraction_status AS "extractionStatus",extraction_error AS "extractionError",jsonb_array_length(pages) AS "pageCount",(content IS NOT NULL OR storage_key IS NOT NULL) AS downloadable FROM documents WHERE opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND active=true ORDER BY source_key NULLS LAST,name`;
  const fingerprint = documentSetHash(
    docs.map((d) => ({
      id: String(d.id),
      hash: String(d.hash),
      state: String(d.extraction_status || d.extractionStatus),
    })),
  );
  const [analysis] =
    await sql`SELECT result,created_at FROM analyses WHERE criteria_version=(SELECT criteria_version FROM companies WHERE id=${t.companyId} AND organization_id=${t.organizationId}) AND opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND document_set_hash=${fingerprint} ORDER BY created_at DESC LIMIT 1`;
  const origins =
    await sql`SELECT source,payload->>'idCompra' AS purchase_id FROM procurement_sources WHERE procurement_id=${op.procurement_id} ORDER BY source`;
  return {
    origins: [
      { source: 'pncp', url: p!.source_url },
      ...origins
        .filter(
          (r) => r.source === 'compras' && /^\d+$/.test(r.purchase_id || ''),
        )
        .map((r) => ({
          source: 'compras',
          url:
            'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=' +
            r.purchase_id,
        })),
    ],
    source: p?.raw || {},
    items: p?.items || [],
    documents: docs.map(({ hash, ...doc }) => doc),
    processingState: op.processing_state,
    processingError: op.processing_error,
    syncedAt: op.synced_at,
    analysis: analysis?.result || null,
    analysisAt: analysis?.created_at || null,
  };
}
