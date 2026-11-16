import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { syncSchema } from '@nthub/contracts';
import { sql } from '../../core/db.js';
import { queue } from '../../core/queue.js';
import {
  authenticate,
  requireGroupAdmin,
  requirePermission,
  httpError,
} from '../identity/index.js';
export async function sourceRoutes(app: FastifyInstance) {
  app.post('/api/v1/sources/rematch', async (req, reply) => {
    const t = await authenticate(req);
    requirePermission(t, 'company:manage');
    const id = randomUUID();
    await sql`INSERT INTO outbox(id,type,payload) VALUES(${id},'rematch',${sql.json({ tenant: t })})`;
    return reply.code(202).send({ jobId: id });
  });
  app.post('/api/v1/sources/group-sync', async (req, reply) => {
    const t = await authenticate(req);
    requireGroupAdmin(t);
    const input = syncSchema.parse(req.body);
    const companies =
      await sql`SELECT id FROM companies WHERE organization_id=${t.organizationId} AND active AND NOT is_parent AND jsonb_array_length(capabilities)>0`;
    const jobIds: string[] = [];
    await sql.begin(async (tx) => {
      for (const c of companies) {
        const id = randomUUID();
        jobIds.push(id);
        await tx`INSERT INTO outbox(id,type,payload) VALUES(${id},'collect',${tx.json({ tenant: { ...t, companyId: c.id }, input })})`;
      }
    });
    return reply.code(202).send({ jobIds });
  });
  app.get('/api/v1/sources/schedule', async (req) => {
    const t = await authenticate(req);
    const [schedule] =
      await sql`SELECT sources,enabled,interval_minutes AS "intervalMinutes",modalities,ufs,lookback_days AS "lookbackDays",next_run_at AS "nextRunAt" FROM collection_schedules WHERE organization_id=${t.organizationId} AND company_id=${t.companyId}`;
    return (
      schedule || {
        sources: ['pncp', 'compras'],
        enabled: false,
        intervalMinutes: 360,
        modalities: [4, 6, 8],
        ufs: [],
        lookbackDays: 2,
        nextRunAt: null,
      }
    );
  });
  app.put('/api/v1/sources/schedule', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'sources:manage');
    const body = z
      .object({
        sources: z
          .array(z.enum(['pncp', 'compras']))
          .min(1)
          .max(2)
          .default(['pncp', 'compras']),
        enabled: z.boolean(),
        intervalMinutes: z.number().int().min(60).max(10080),
        modalities: z.array(z.number().int().min(1).max(14)).min(1).max(14),
        ufs: z.array(z.string().regex(/^[A-Z]{2}$/)).max(27),
        lookbackDays: z.number().int().min(1).max(14),
      })
      .parse(req.body);
    await sql.begin(async (tx) => {
      await tx`INSERT INTO collection_schedules(id,organization_id,company_id,enabled,interval_minutes,modalities,ufs,lookback_days,created_by,sources) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${body.enabled},${body.intervalMinutes},${tx.json([...new Set(body.modalities)])},${tx.json([...new Set(body.ufs)])},${body.lookbackDays},${t.userId},${tx.json([...new Set(body.sources)])}) ON CONFLICT(company_id) DO UPDATE SET sources=EXCLUDED.sources,enabled=EXCLUDED.enabled,interval_minutes=EXCLUDED.interval_minutes,modalities=EXCLUDED.modalities,ufs=EXCLUDED.ufs,lookback_days=EXCLUDED.lookback_days,created_by=EXCLUDED.created_by,next_run_at=now()`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'source:schedule-updated',${t.companyId},${tx.json(body)})`;
    });
    return { ok: true };
  });
  app.get('/api/v1/sources/runs', async (req) => {
    const t = await authenticate(req);
    return sql`SELECT id,source,input,cursor_page AS "cursorPage",records_processed AS "recordsProcessed",opportunities_processed AS "opportunitiesProcessed",status,error,started_at AS "startedAt",completed_at AS "completedAt" FROM source_runs WHERE organization_id=${t.organizationId} AND company_id=${t.companyId} ORDER BY started_at DESC LIMIT 100`;
  });
  app.get('/api/v1/sources/jobs', async (req) => {
    const t = await authenticate(req);
    return sql`SELECT id,type,state,attempt,result,error,started_at AS "startedAt",finished_at AS "finishedAt",created_at AS "createdAt" FROM job_runs WHERE organization_id=${t.organizationId} AND company_id=${t.companyId} ORDER BY created_at DESC LIMIT 100`;
  });
  app.post('/api/v1/sources/jobs/:id/retry', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'sources:manage');
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [run] =
      await sql`SELECT id FROM job_runs WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
    if (!run) throw httpError(404, 'Trabalho não encontrado.');
    const job = await queue.getJob(id);
    if (!job || (await job.getState()) !== 'failed')
      throw httpError(409, 'Apenas trabalhos com falha podem ser retomados.');
    await job.retry();
    await sql`UPDATE job_runs SET state='waiting',error=NULL WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
    return { ok: true };
  });
}
