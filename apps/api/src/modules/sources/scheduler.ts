import { randomUUID } from 'node:crypto';
import { sql } from '../../core/db.js';
import { notify } from '../notifications/index.js';
import type { Tenant } from '../identity/index.js';
export async function runSchedules() {
  await sql.begin(async (tx) => {
    const schedules =
      await tx`SELECT s.*,u.email FROM collection_schedules s JOIN users u ON u.id=s.created_by AND u.active JOIN companies c ON c.id=s.company_id AND c.organization_id=s.organization_id AND c.active AND NOT c.is_parent WHERE s.enabled AND s.next_run_at<=now() ORDER BY s.next_run_at LIMIT 10 FOR UPDATE OF s SKIP LOCKED`;
    for (const schedule of schedules) {
      const until = new Date().toLocaleDateString('en-CA', {
        timeZone: 'America/Sao_Paulo',
      });
      const since = new Date(
        Date.parse(until + 'T12:00:00Z') -
          Number(schedule.lookback_days) * 86400000,
      )
        .toISOString()
        .slice(0, 10);
      for (const modality of schedule.modalities as number[]) {
        for (const uf of (schedule.ufs as string[]).length
          ? (schedule.ufs as string[])
          : ['']) {
          const tenant = {
            organizationId: schedule.organization_id,
            companyId: schedule.company_id,
            userId: schedule.created_by,
            email: schedule.email,
          };
          for (const source of schedule.sources as ('pncp' | 'compras')[]) {
            const input = {
              source,
              since,
              until,
              modality,
              ...(uf ? { uf } : {}),
            };
            await tx`INSERT INTO outbox(id,type,payload) VALUES(${randomUUID()},'collect',${tx.json({ tenant, input })})`;
          }
        }
      }
      await tx`UPDATE collection_schedules SET next_run_at=now()+(${schedule.interval_minutes}*interval '1 minute') WHERE id=${schedule.id}`;
      // Revisit tracked notices regardless of original publication date, once per scheduled cycle.
      // Locked/queued opportunities are left to their current job to avoid overlapping work.
      const tracked =
        await tx`SELECT id FROM opportunities WHERE organization_id=${schedule.organization_id} AND company_id=${schedule.company_id} AND status NOT IN ('won','lost','discarded') AND processing_state NOT IN ('queued','processing') FOR UPDATE SKIP LOCKED`;
      for (const op of tracked) {
        const jobId = randomUUID();
        await tx`INSERT INTO outbox(id,type,payload) VALUES(${jobId},'refresh',${tx.json({ tenant: { organizationId: schedule.organization_id, companyId: schedule.company_id, userId: schedule.created_by, email: schedule.email }, opportunityId: op.id, scheduled: true })})`;
        await tx`UPDATE opportunities SET processing_state='queued',processing_job_id=${jobId} WHERE id=${op.id}`;
      }
    }
  });
}
export async function runDeadlineAlerts() {
  const rows =
    await sql`SELECT o.id,o.organization_id,o.company_id,o.assigned_user_id,p.title,p.deadline,u.id AS user_id,u.email,coalesce(pref.lead_days,'[1,3,7]'::jsonb) AS lead_days FROM opportunities o JOIN procurements p ON p.id=o.procurement_id JOIN companies c ON c.id=o.company_id AND c.organization_id=o.organization_id AND c.active JOIN users u ON u.organization_id=o.organization_id AND u.active LEFT JOIN memberships m ON m.user_id=u.id AND m.company_id=o.company_id AND m.organization_id=o.organization_id AND m.active LEFT JOIN notification_preferences pref ON pref.user_id=u.id AND pref.company_id=o.company_id AND pref.organization_id=o.organization_id WHERE o.status NOT IN ('discarded','won','lost') AND p.deadline>now() AND p.deadline<now()+interval '31 days' AND (u.group_role='group_admin' OR m.user_id IS NOT NULL)`;
  for (const row of rows) {
    const days = Math.floor(
      (new Date(row.deadline).getTime() - Date.now()) / 86400000,
    );
    if (!(row.lead_days as number[]).includes(days)) continue;
    const tenant: Tenant = {
      userId: row.user_id,
      organizationId: row.organization_id,
      companyId: row.company_id,
      email: row.email,
    };
    await notify(tenant, {
      title: 'Prazo de proposta em ' + days + ' dia(s)',
      body: row.title,
      kind: 'deadline',
      key: `deadline:${row.id}:${row.user_id}:${new Date(row.deadline).toISOString()}:${days}`,
      opportunityId: row.id,
      recipientUserId: row.user_id,
    });
  }
  const files =
    await sql`SELECT f.id,f.organization_id,f.company_id,f.name,f.valid_until,u.id AS user_id,u.email FROM private_files f JOIN companies c ON c.id=f.company_id AND c.organization_id=f.organization_id AND c.active JOIN users u ON u.organization_id=f.organization_id AND u.active LEFT JOIN memberships m ON m.user_id=u.id AND m.company_id=f.company_id AND m.organization_id=f.organization_id AND m.active WHERE (u.group_role='group_admin' OR m.role='company_manager') AND f.category='qualification' AND f.archived_at IS NULL AND f.valid_until BETWEEN current_date AND current_date+7`;
  for (const file of files)
    await notify(
      {
        userId: file.user_id,
        organizationId: file.organization_id,
        companyId: file.company_id,
        email: file.email,
      },
      {
        title: 'Documento de habilitação próximo do vencimento',
        body:
          file.name +
          ' · validade ' +
          new Date(file.valid_until).toLocaleDateString('pt-BR', {
            timeZone: 'UTC',
          }),
        kind: 'document',
        key: `qualification:${file.id}:${file.user_id}:${file.valid_until}`,
        recipientUserId: file.user_id,
      },
    );
}
