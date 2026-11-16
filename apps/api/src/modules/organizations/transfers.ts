import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../../core/db.js';
import {
  authenticate,
  requirePermission,
  httpError,
  accessibleCompanies,
  membershipPermissions,
  type Tenant,
} from '../identity/index.js';
import { matchCompany } from '../sources/matching.js';
async function destinations(t: Tenant) {
  if (t.authKind !== 'session')
    throw httpError(403, 'Transferências exigem acesso de funcionário.');
  requirePermission(t, 'opportunities:transfer');
  requirePermission(t, 'opportunities:write');
  const companies = await accessibleCompanies(t);
  const result = [];
  for (const c of companies) {
    if (c.id === t.companyId || c.isParent) continue;
    const permissions = await membershipPermissions(
      t.userId,
      c.id,
      t.organizationId,
    );
    try {
      requirePermission(
        { ...t, companyId: c.id, permissions },
        'opportunities:transfer',
      );
      requirePermission(
        { ...t, companyId: c.id, permissions },
        'opportunities:write',
      );
      requirePermission(
        { ...t, companyId: c.id, permissions },
        'opportunities:read',
      );
      result.push(c);
    } catch {}
  }
  return result;
}
export async function transferRoutes(app: FastifyInstance) {
  app.get('/api/v1/opportunities/transfer-destinations', async (req) =>
    destinations(await authenticate(req)),
  );
  app.post('/api/v1/opportunities/:id/transfer', async (req) => {
    const t = await authenticate(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z
      .object({
        companyId: z.uuid(),
        reason: z.string().trim().min(1).max(3000),
      })
      .parse(req.body);
    if (body.companyId === t.companyId)
      throw httpError(400, 'Escolha outra empresa.');
    const target = (await destinations(t)).find((c) => c.id === body.companyId);
    if (!target)
      throw httpError(
        403,
        'Empresa de destino indisponível ou sem permissão de transferência.',
      );
    await sql.begin(async (tx) => {
      await tx`SET CONSTRAINTS ALL DEFERRED`;
      const [candidate] =
        await tx`SELECT procurement_id FROM opportunities WHERE id=${id} AND company_id=${t.companyId} AND organization_id=${t.organizationId}`;
      if (!candidate)
        throw httpError(404, 'Oportunidade não encontrada nesta empresa.');
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${t.organizationId + ':' + candidate.procurement_id},0))`;
      const [op] =
        await tx`SELECT o.*,p.title,p.uf,p.value,p.deadline FROM opportunities o JOIN procurements p ON p.id=o.procurement_id WHERE o.id=${id} AND o.organization_id=${t.organizationId} AND o.company_id=${t.companyId} FOR UPDATE OF o`;
      if (!op)
        throw httpError(404, 'Oportunidade não encontrada nesta empresa.');
      if (
        t.role === 'analyst' &&
        op.assigned_user_id &&
        op.assigned_user_id !== t.userId
      )
        throw httpError(
          403,
          'Esta oportunidade está atribuída a outro funcionário.',
        );
      const [dest] =
        await tx`SELECT id FROM companies WHERE id=${body.companyId} AND organization_id=${t.organizationId} AND active AND NOT is_parent FOR SHARE`;
      if (!dest) throw httpError(409, 'Empresa de destino indisponível.');
      const [duplicate] =
        await tx`SELECT id FROM opportunities WHERE company_id=${body.companyId} AND organization_id=${t.organizationId} AND procurement_id=${op.procurement_id}`;
      if (duplicate)
        throw httpError(
          409,
          'Esta oportunidade já existe no CRM da empresa de destino. Nenhum registro foi alterado.',
        );
      const [formal] =
        await tx`SELECT id FROM bids WHERE opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND status<>'draft' LIMIT 1`;
      if (formal || ['submitted', 'won', 'lost'].includes(op.status))
        throw httpError(
          409,
          'Oportunidades com proposta formalizada ou resultado devem permanecer na empresa participante.',
        );
      const [work] =
        await tx`SELECT id FROM outbox WHERE type IN ('enrich','analyze') AND payload->>'opportunityId'=${id} AND payload->'tenant'->>'companyId'=${t.companyId} AND NOT EXISTS(SELECT 1 FROM job_runs j WHERE j.id=outbox.id AND j.state IN ('completed','failed')) LIMIT 1`;
      if (['queued', 'processing'].includes(op.processing_state) || work)
        throw httpError(
          409,
          'Aguarde o processamento desta oportunidade terminar antes de transferir.',
        );
      const [source] =
        await tx`SELECT short_name,name FROM companies WHERE id=${t.companyId} AND organization_id=${t.organizationId}`;
      const match = matchCompany(
        op.title,
        target.capabilities as string[],
        target.searchSettings,
        {
          uf: op.uf,
          value: op.value == null ? null : Number(op.value),
          deadline: op.deadline ? new Date(op.deadline).toISOString() : null,
        },
      );
      await tx`UPDATE opportunities SET company_id=${body.companyId},status='new',decision_reason=null,assigned_user_id=null,score=${match.score},matches=${tx.json(match.matches)},updated_at=now() WHERE id=${id} AND company_id=${t.companyId} AND organization_id=${t.organizationId}`;
      await tx`UPDATE private_files SET company_id=${body.companyId} WHERE organization_id=${t.organizationId} AND company_id=${t.companyId} AND bid_id IN (SELECT id FROM bids WHERE opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId})`;
      for (const table of [
        'documents',
        'analyses',
        'opportunity_notes',
        'bids',
        'private_files',
        'tasks',
        'notifications',
        'opportunity_contacts',
      ]) {
        await tx`UPDATE ${tx(table)} SET company_id=${body.companyId} WHERE opportunity_id=${id} AND company_id=${t.companyId} AND organization_id=${t.organizationId}`;
      }
      await tx`UPDATE analyses SET criteria_version=0 WHERE opportunity_id=${id} AND company_id=${body.companyId} AND organization_id=${t.organizationId}`;
      await tx`UPDATE tasks SET assigned_user_id=null WHERE opportunity_id=${id} AND company_id=${body.companyId} AND organization_id=${t.organizationId} AND assigned_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.company_id=${body.companyId} AND m.organization_id=u.organization_id AND m.active WHERE u.id=tasks.assigned_user_id AND u.organization_id=${t.organizationId} AND u.active AND (u.group_role='group_admin' OR m.user_id IS NOT NULL))`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details,created_at) SELECT gen_random_uuid(),organization_id,${body.companyId},user_id,action,resource_id,details||jsonb_build_object('originCompany',${source?.short_name || source?.name}::text),created_at FROM audit_logs WHERE organization_id=${t.organizationId} AND company_id=${t.companyId} AND resource_id=${id}`;
      const details = {
        fromCompanyId: t.companyId,
        toCompanyId: body.companyId,
        fromCompany: source?.short_name || source?.name,
        toCompany: target.shortName || target.name,
        reason: body.reason,
        previousStatus: op.status,
        previousReason: op.decision_reason,
      };
      for (const companyId of [t.companyId, body.companyId])
        await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${companyId},${t.userId},'opportunity:transferred',${id},${tx.json(details)})`;
      await tx`DELETE FROM opportunity_routes WHERE organization_id=${t.organizationId} AND procurement_id=${op.procurement_id} AND excluded_company_id=${body.companyId}`;
      await tx`INSERT INTO opportunity_routes VALUES(${t.organizationId},${op.procurement_id},${t.companyId},${body.companyId}) ON CONFLICT(organization_id,procurement_id,excluded_company_id) DO UPDATE SET destination_company_id=EXCLUDED.destination_company_id`;
    });
    return { id, companyId: body.companyId };
  });
}
