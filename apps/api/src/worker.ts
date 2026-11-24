import { Worker, DelayedError } from 'bullmq';
import {
  passwordResetQueueName,
  closePasswordResetQueue,
} from './core/password-reset-queue.js';
import { deliverPasswordReset } from './modules/identity/reset-delivery.js';
import { refreshTrackedOpportunity } from './modules/sources/refresh.js';
import { SourceThrottleError } from './modules/sources/http.js';
import { z } from 'zod';
import { sql, drizzleClient } from './core/db.js';
import { redisConnection, config } from './core/config.js';
import { queue } from './core/queue.js';
import { collect } from './modules/sources/index.js';
import { rematchCatalog } from './modules/sources/matching.js';
import {
  enrichOpportunity,
  analyzeOpportunity,
  enqueueEnrichment,
} from './modules/documents/index.js';
import { authorizeBackground, type Tenant } from './modules/identity/index.js';
import { domainEvent, deliverEmail } from './modules/notifications/index.js';
import { deliverWebhook } from './modules/integrations/routes.js';
import {
  runSchedules,
  runDeadlineAlerts,
} from './modules/sources/scheduler.js';
import { ensureStorage } from './core/storage.js';
const tenantSchema = z.object({
  userId: z.uuid(),
  organizationId: z.uuid(),
  companyId: z.uuid(),
  email: z.email(),
  authKind: z.enum(['session', 'api_token']).optional(),
  scopes: z.array(z.string()).optional(),
  apiTokenId: z.uuid().optional(),
});
function safeError(error: unknown) {
  if (error instanceof z.ZodError)
    return 'A resposta recebida está incompleta ou inválida. A avaliação anterior foi preservada. Tente novamente após conferir o processamento.';
  let message =
    error instanceof Error ? error.message : 'Falha no processamento.';
  for (const secret of [
    config.GEMINI_API_KEY,
    config.SMTP_PASSWORD,
    config.S3_SECRET_KEY,
    config.DATA_ENCRYPTION_KEY,
  ])
    if (secret) message = message.replaceAll(secret, '[redigido]');
  return message.slice(0, 2000);
}
const worker = new Worker(
  'nthub',
  async (job, token) => {
    const payload = z
      .object({ tenant: tenantSchema })
      .passthrough()
      .parse(job.data);
    const tenant = payload.tenant as Tenant;
    const permission =
      job.name === 'analyze'
        ? 'intelligence:run'
        : job.name === 'collect'
          ? 'sources:sync'
          : job.name === 'rematch'
            ? 'company:manage'
            : job.name === 'refresh'
              ? payload.scheduled === true
                ? 'sources:sync'
                : 'opportunities:write'
              : ['enrich', 'analyze'].includes(job.name)
                ? tenant.authKind === 'api_token' &&
                  tenant.scopes?.includes('sources:sync')
                  ? 'sources:sync'
                  : 'documents:write'
                : 'company:read';
    await authorizeBackground(tenant, permission);
    if (job.name === 'analyze')
      await authorizeBackground(tenant, 'opportunities:write');
    await sql`INSERT INTO job_runs(id,organization_id,company_id,type,state,attempt,started_at) VALUES(${job.id!},${tenant.organizationId},${tenant.companyId},${job.name},'active',${job.attemptsMade + 1},now()) ON CONFLICT(id) DO UPDATE SET state='active',attempt=EXCLUDED.attempt,started_at=now(),error=NULL`;
    try {
      let result: unknown;
      if (job.name === 'collect')
        result = await collect(payload.input, tenant, job.id!);
      else if (job.name === 'rematch') result = await rematchCatalog(tenant);
      else if (['enrich', 'analyze', 'refresh'].includes(job.name)) {
        if (job.name === 'analyze' && payload.requestedByUser !== true)
          throw new Error(
            'A análise por IA exige uma solicitação explícita do usuário.',
          );
        const { opportunityId } = z
          .object({ opportunityId: z.uuid() })
          .parse(payload);
        result =
          job.name === 'refresh'
            ? await refreshTrackedOpportunity(tenant, opportunityId)
            : job.name === 'enrich'
              ? await enrichOpportunity(tenant, opportunityId)
              : await analyzeOpportunity(tenant, opportunityId);
      } else if (job.name === 'domain.event') {
        const event = z
          .object({
            event: z.string(),
            resourceId: z.uuid(),
            data: z.record(z.string(), z.json()),
          })
          .parse(payload);
        await domainEvent(
          tenant,
          job.id!,
          event.event,
          event.resourceId,
          event.data,
        );
        result = { ok: true };
      } else if (
        job.name === 'email.deliver' ||
        job.name === 'webhook.deliver'
      ) {
        const { deliveryId } = z
          .object({ deliveryId: z.uuid() })
          .parse(payload);
        result =
          job.name === 'email.deliver'
            ? await deliverEmail(deliveryId)
            : await deliverWebhook(deliveryId);
      } else throw new Error('Tipo de trabalho desconhecido.');
      await sql`UPDATE job_runs SET state='completed',result=${sql.json(z.json().parse(result || {}))},finished_at=now() WHERE id=${job.id!}`;
      return result;
    } catch (error) {
      if (error instanceof SourceThrottleError) {
        await sql`UPDATE job_runs SET state='delayed',error=${error.message},finished_at=NULL WHERE id=${job.id!}`;
        await job.moveToDelayed(
          Date.now() + error.retryAfterMs + Math.floor(Math.random() * 1000),
          token,
        );
        throw new DelayedError();
      }
      const message = safeError(error);
      await sql`UPDATE job_runs SET state='failed',error=${message},finished_at=now() WHERE id=${job.id!}`;
      throw new Error(message);
    }
  },
  { connection: redisConnection, concurrency: 2 },
);
const resetWorker = new Worker(
  passwordResetQueueName,
  async (job) => {
    if (job.name !== 'send')
      throw new Error('Trabalho de recuperação inválido.');
    return deliverPasswordReset(job.data);
  },
  { connection: redisConnection, concurrency: 2 },
);
resetWorker.on('failed', (job) =>
  console.error('Falha na recuperação de senha. Verifique o SMTP.', job?.id),
);
let closing = false;
let dispatchTimer: ReturnType<typeof setTimeout> | undefined;
let scheduleTimer: ReturnType<typeof setTimeout> | undefined;
async function dispatch() {
  if (closing) return;
  try {
    const rows =
      await sql`SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 30`;
    for (const row of rows) {
      await queue.add(row.type, row.payload, { jobId: row.id });
      await sql`UPDATE outbox SET published_at=now() WHERE id=${row.id}`;
    }
  } catch (error) {
    console.error('Dispatcher:', safeError(error));
  } finally {
    if (!closing) dispatchTimer = setTimeout(() => void dispatch(), 1500);
  }
}
async function schedules() {
  if (closing) return;
  try {
    await runSchedules();
    await runDeadlineAlerts();
  } catch (error) {
    console.error('Agendadores:', safeError(error));
  } finally {
    if (!closing) scheduleTimer = setTimeout(() => void schedules(), 60000);
  }
}
async function backfill() {
  const rows =
    await sql`SELECT o.id,o.organization_id,o.company_id,u.id AS user_id,u.email FROM opportunities o JOIN LATERAL (SELECT u.id,u.email FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.company_id=o.company_id AND m.organization_id=u.organization_id AND m.active WHERE u.organization_id=o.organization_id AND u.active AND (u.group_role='group_admin' OR m.role IN ('company_manager','analyst')) ORDER BY (u.group_role='group_admin') DESC,u.id LIMIT 1) u ON true JOIN companies c ON c.id=o.company_id AND c.active WHERE o.processing_state='pending' LIMIT 1000`;
  for (const row of rows)
    await enqueueEnrichment(
      {
        organizationId: row.organization_id,
        companyId: row.company_id,
        userId: row.user_id,
        email: row.email,
      },
      row.id,
    );
}
worker.on('failed', (job, error) =>
  console.error('Job falhou', job?.id, safeError(error)),
);
await ensureStorage();
void dispatch();
void schedules();
void backfill().catch((error) => console.error('Retomada:', safeError(error)));
console.log('Worker, outbox, alertas e agendamento ativos.');
async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(dispatchTimer);
  clearTimeout(scheduleTimer);
  await worker.close();
  await resetWorker.close();
  await closePasswordResetQueue();
  await queue.close();
  await sql.end();
  await drizzleClient.end();
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
