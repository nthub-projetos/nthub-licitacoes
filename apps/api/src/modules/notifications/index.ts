import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { sql } from '../../core/db.js';
import { config } from '../../core/config.js';
import type { Tenant } from '../identity/index.js';
import { webhookEvents } from '../integrations/routes.js';
export async function notify(
  t: Tenant,
  input: {
    title: string;
    body: string;
    kind: string;
    key: string;
    opportunityId?: string | null;
    recipientUserId?: string | null;
  },
) {
  await sql.begin(async (tx) => {
    const id = randomUUID();
    const [notification] =
      await tx`INSERT INTO notifications(id,organization_id,company_id,recipient_user_id,title,body,kind,opportunity_id,unique_key) VALUES(${id},${t.organizationId},${t.companyId},${input.recipientUserId || null},${input.title},${input.body},${input.kind},${input.opportunityId || null},${input.key}) ON CONFLICT(unique_key) DO NOTHING RETURNING id`;
    if (!notification || !config.SMTP_HOST) return;
    const users =
      await tx`SELECT DISTINCT u.id FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.company_id=${t.companyId} AND m.organization_id=u.organization_id AND m.active JOIN notification_preferences p ON p.user_id=u.id AND p.company_id=${t.companyId} AND p.organization_id=u.organization_id AND p.email_enabled WHERE u.organization_id=${t.organizationId} AND u.active AND (u.group_role='group_admin' OR m.user_id IS NOT NULL) AND (${input.recipientUserId || null}::uuid IS NULL OR u.id=${input.recipientUserId || null})`;
    for (const user of users) {
      const deliveryId = randomUUID();
      await tx`INSERT INTO email_deliveries(id,notification_id,user_id) VALUES(${deliveryId},${id},${user.id}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO outbox(id,type,payload) VALUES(${randomUUID()},'email.deliver',${tx.json({ tenant: t, deliveryId })})`;
    }
  });
}
export async function domainEvent(
  t: Tenant,
  eventId: string,
  event: string,
  resourceId: string,
  data: Record<string, unknown>,
) {
  if (event === 'opportunity.created')
    await notify(t, {
      title: 'Nova oportunidade encontrada',
      body: String(
        data.title ||
          'Uma nova contratação corresponde aos critérios da empresa.',
      ).slice(0, 1000),
      kind: 'opportunity',
      key: 'event:' + eventId,
      opportunityId: resourceId,
    });
  if (event === 'bid.changed')
    await notify(t, {
      title: 'Participação atualizada',
      body:
        'Uma proposta mudou para o status ' +
        String(data.status || 'atualizado') +
        '.',
      kind: 'bid',
      key: 'event:' + eventId,
      opportunityId: resourceId,
    });
  if (event === 'analysis.completed')
    await notify(t, {
      title: 'Análise de edital disponível',
      body: 'A análise com evidências já pode ser consultada na oportunidade.',
      kind: 'analysis',
      key: 'event:' + eventId,
      opportunityId: resourceId,
    });
  if (!(webhookEvents as readonly string[]).includes(event)) return;
  const hooks =
    await sql`SELECT id FROM webhooks WHERE organization_id=${t.organizationId} AND company_id=${t.companyId} AND active AND events ? ${event}`;
  await sql.begin(async (tx) => {
    for (const hook of hooks) {
      const id = randomUUID();
      const payload = {
        id: eventId,
        type: event,
        companyId: t.companyId,
        organizationId: t.organizationId,
        resourceId,
        occurredAt: new Date().toISOString(),
        data,
      };
      const [delivery] =
        await tx`INSERT INTO webhook_deliveries(id,organization_id,company_id,webhook_id,event_id,event_type,payload) VALUES(${id},${t.organizationId},${t.companyId},${hook.id},${eventId},${event},${tx.json(z.json().parse(payload))}) ON CONFLICT(webhook_id,event_id) DO NOTHING RETURNING id`;
      if (delivery)
        await tx`INSERT INTO outbox(id,type,payload) VALUES(${randomUUID()},'webhook.deliver',${tx.json({ tenant: t, deliveryId: id })})`;
    }
  });
}
export async function deliverEmail(id: string) {
  if (!config.SMTP_HOST) throw new Error('SMTP não configurado.');
  const [delivery] =
    await sql`SELECT d.id,d.status,d.user_id,u.email,u.active,u.group_role,n.id AS notification_id,n.organization_id,n.company_id,n.recipient_user_id,n.title,n.body,n.opportunity_id FROM email_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN users u ON u.id=d.user_id AND u.organization_id=n.organization_id JOIN companies c ON c.id=n.company_id AND c.organization_id=n.organization_id AND c.active WHERE d.id=${id}`;
  if (!delivery || delivery.status === 'sent') return { skipped: true };
  const [membership] =
    await sql`SELECT role FROM memberships WHERE user_id=${delivery.user_id} AND company_id=${delivery.company_id} AND organization_id=${delivery.organization_id} AND active`;
  const [preference] =
    await sql`SELECT email_enabled FROM notification_preferences WHERE user_id=${delivery.user_id} AND company_id=${delivery.company_id} AND organization_id=${delivery.organization_id}`;
  if (
    !delivery.active ||
    (delivery.group_role !== 'group_admin' && !membership) ||
    !preference?.email_enabled ||
    (delivery.recipient_user_id &&
      delivery.recipient_user_id !== delivery.user_id)
  ) {
    await sql`UPDATE email_deliveries SET status='cancelled' WHERE id=${id}`;
    return { skipped: true };
  }
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE === 'true',
    ...(config.SMTP_USER
      ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
      : {}),
    connectionTimeout: 15000,
    socketTimeout: 20000,
  });
  try {
    await transport.sendMail({
      from: config.SMTP_FROM,
      to: delivery.email,
      subject: 'NTHUB · ' + delivery.title,
      messageId: `<${id}@nthub.local>`,
      text:
        delivery.body +
        '\n\nAcesse seu ambiente: ' +
        config.APP_URL +
        '/notifications',
    });
    await sql.begin(async (tx) => {
      await tx`UPDATE email_deliveries SET status='sent',error=NULL,sent_at=now() WHERE id=${id}`;
      await tx`UPDATE notifications SET email_status='sent' WHERE id=${delivery.notification_id}`;
    });
    return { ok: true };
  } catch (error) {
    await sql`UPDATE email_deliveries SET status='failed',error=${error instanceof Error ? error.message : 'Falha de envio.'} WHERE id=${id}`;
    throw error;
  } finally {
    transport.close();
  }
}
