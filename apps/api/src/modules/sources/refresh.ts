import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../../core/db.js';
import type { Tenant } from '../identity/index.js';
import { requireOpportunity } from '../opportunities/index.js';
import { enrichOpportunity } from '../documents/index.js';
import { officialJson, procurementBase } from '../documents/network.js';
import { SourceThrottleError } from './http.js';
const detailSchema = z
  .object({
    objetoCompra: z.string().min(1),
    orgaoEntidade: z.object({ razaoSocial: z.string() }),
    valorTotalEstimado: z.number().nullish(),
    dataEncerramentoProposta: z.string().nullish(),
  })
  .passthrough();
export async function refreshTrackedOpportunity(t: Tenant, id: string) {
  const op = await requireOpportunity(t, id);
  try {
    const [proc] =
      await sql`SELECT * FROM procurements WHERE id=${op.procurement_id}`;
    if (!proc) throw new Error('Contratação não encontrada.');
    const detail = detailSchema.parse(
      await officialJson(procurementBase(proc.source_id)),
    );
    const beforeDocs =
      await sql`SELECT source_key,hash FROM documents WHERE opportunity_id=${id} AND active ORDER BY source_key`;
    const deadline =
      detail.dataEncerramentoProposta === undefined
        ? proc.deadline
        : detail.dataEncerramentoProposta;
    const value =
      detail.valorTotalEstimado === undefined
        ? proc.value
        : detail.valorTotalEstimado;
    const changed =
      proc.title !== detail.objetoCompra ||
      proc.agency !== detail.orgaoEntidade.razaoSocial ||
      (proc.value == null ? null : Number(proc.value)) !==
        (value == null ? null : Number(value)) ||
      (proc.deadline ? new Date(proc.deadline).toISOString() : null) !==
        (deadline ? new Date(deadline).toISOString() : null);
    await sql.begin(async (tx) => {
      await tx`UPDATE procurements SET title=${detail.objetoCompra},agency=${detail.orgaoEntidade.razaoSocial},value=${value},deadline=${deadline},raw=raw||${tx.json(z.json().parse(detail))},updated_at=now() WHERE id=${proc.id}`;
      if (changed) {
        await tx`UPDATE opportunities SET source_changed_at=now() WHERE procurement_id=${proc.id}`;
        await tx`UPDATE analyses SET criteria_version=0 WHERE opportunity_id IN (SELECT id FROM opportunities WHERE procurement_id=${proc.id})`;
        await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'source:updated',${id},${tx.json({ previousDeadline: proc.deadline, deadline, previousValue: proc.value, value })})`;
      }
    });
    const result = await enrichOpportunity(t, id);
    const afterDocs =
      await sql`SELECT source_key,hash FROM documents WHERE opportunity_id=${id} AND active ORDER BY source_key`;
    if (
      beforeDocs.length &&
      JSON.stringify(beforeDocs) !== JSON.stringify(afterDocs)
    ) {
      await sql`UPDATE opportunities SET source_changed_at=now() WHERE id=${id}`;
      await sql`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'source:attachments-updated',${id})`;
    }
    await sql`UPDATE opportunities SET source_checked_at=now() WHERE id=${id}`;
    return { ...result, changed };
  } catch (error) {
    await sql`UPDATE opportunities SET processing_state=${error instanceof SourceThrottleError ? 'queued' : 'failed'},processing_error=${error instanceof Error ? error.message : 'Falha ao atualizar a fonte.'} WHERE id=${id}`;
    throw error;
  }
}
