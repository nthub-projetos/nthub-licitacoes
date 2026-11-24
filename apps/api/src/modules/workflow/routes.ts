import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { bidSchema, taskSchema } from '@nthub/contracts';
import { sql } from '../../core/db.js';
import { storeBlob, loadBlob } from '../../core/storage.js';
import {
  authenticate,
  requirePermission,
  requireGroupAdmin,
  requireAssignee,
  httpError,
  hashPassword,
  verifyPassword,
  type Tenant,
} from '../identity/index.js';
import { requireOpportunity } from '../opportunities/index.js';
const idSchema = z.object({ id: z.uuid() });
async function writable(t: Tenant, id: string) {
  const op = await requireOpportunity(t, id);
  if (
    t.role === 'analyst' &&
    op.assigned_user_id &&
    op.assigned_user_id !== t.userId
  )
    throw httpError(
      403,
      'Esta oportunidade está atribuída a outro responsável.',
    );
  return op;
}
export async function workflowRoutes(app: FastifyInstance) {
  app.get('/api/v1/opportunities/:id/activity', async (req) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    const op = await requireOpportunity(t, id);
    const notes =
      await sql`SELECT n.id,n.body,n.created_at AS "createdAt",u.name AS "userName" FROM opportunity_notes n JOIN users u ON u.id=n.user_id WHERE n.opportunity_id=${id} AND n.organization_id=${t.organizationId} AND n.company_id=${t.companyId} ORDER BY n.created_at DESC`;
    const canReadBids = (() => {
      try {
        requirePermission(t, 'bids:read');
        return true;
      } catch {
        return false;
      }
    })();
    const historyRows =
      await sql`SELECT a.id,a.action,a.details,a.created_at AS "createdAt",u.name AS "userName" FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.resource_id=${id} AND a.organization_id=${t.organizationId} AND a.company_id=${t.companyId} ORDER BY a.created_at DESC LIMIT 100`;
    const history = historyRows.filter(
      (h) => canReadBids || !String(h.action).startsWith('bid:'),
    );
    const contacts =
      await sql`SELECT id,name,role,email,phone,notes,created_at AS "createdAt" FROM opportunity_contacts WHERE opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} ORDER BY name`;
    const bids =
      await sql`SELECT id,title,proposed_value AS "proposedValue",status,protocol,notes,created_at AS "createdAt" FROM bids WHERE opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} ORDER BY updated_at DESC`;
    const timeline = [
      ...notes.map((n) => ({
        id: n.id,
        kind: 'comment',
        action: 'opportunity:commented',
        createdAt: n.createdAt,
        userName: n.userName,
        body: n.body,
        details: {},
      })),
      ...history
        .filter((h) => h.action !== 'opportunity:commented')
        .map((h) => ({
          id: h.id,
          action: h.action,
          details: h.details,
          createdAt: h.createdAt,
          userName: h.userName,
          kind: h.action.startsWith('bid:')
            ? 'proposal'
            : h.action.startsWith('contact:')
              ? 'contact'
              : h.action.startsWith('status:')
                ? 'status'
                : 'system',
        })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return {
      contacts,
      bids: canReadBids ? bids : [],
      timeline,
      notes,
      history,
      assignedUserId: op.assigned_user_id,
      decisionReason: op.decision_reason,
    };
  });
  const contactSchema = z.object({
    name: z.string().trim().min(2).max(150),
    role: z.string().trim().max(150).default(''),
    email: z.email().nullable().default(null),
    phone: z.string().trim().max(60).default(''),
    notes: z.string().trim().max(3000).default(''),
  });
  app.post('/api/v1/opportunities/:id/contacts', async (req, reply) => {
    const t = await authenticate(req),
      { id } = idSchema.parse(req.params);
    await writable(t, id);
    const body = contactSchema.parse(req.body),
      contactId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO opportunity_contacts(id,organization_id,company_id,opportunity_id,name,role,email,phone,notes,created_by) VALUES(${contactId},${t.organizationId},${t.companyId},${id},${body.name},${body.role},${body.email},${body.phone},${body.notes},${t.userId})`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'contact:created',${id},${tx.json({ contactId, ...body })})`;
    });
    return reply.code(201).send({ id: contactId });
  });
  app.patch('/api/v1/opportunities/:id/contacts/:contactId', async (req) => {
    const t = await authenticate(req),
      { id, contactId } = z
        .object({ id: z.uuid(), contactId: z.uuid() })
        .parse(req.params);
    await writable(t, id);
    const body = contactSchema.parse(req.body);
    await sql.begin(async (tx) => {
      const [old] =
        await tx`SELECT id FROM opportunity_contacts WHERE id=${contactId} AND opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} FOR UPDATE`;
      if (!old)
        throw httpError(404, 'Contato não encontrado nesta oportunidade.');
      await tx`UPDATE opportunity_contacts SET name=${body.name},role=${body.role},email=${body.email},phone=${body.phone},notes=${body.notes},updated_at=now() WHERE id=${contactId} AND opportunity_id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'contact:updated',${id},${tx.json({ contactId, ...body })})`;
    });
    return { ok: true };
  });
  app.post('/api/v1/opportunities/:id/notes', async (req, reply) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    await writable(t, id);
    const { body } = z
      .object({ body: z.string().trim().min(1).max(10000) })
      .parse(req.body);
    const noteId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO opportunity_notes VALUES(${noteId},${t.organizationId},${t.companyId},${id},${t.userId},${body},now())`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'opportunity:commented',${id})`;
    });
    return reply.code(201).send({ id: noteId });
  });
  app.patch('/api/v1/opportunities/:id/assignment', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'members:manage');
    const { id } = idSchema.parse(req.params);
    await requireOpportunity(t, id);
    const { userId } = z
      .object({ userId: z.uuid().nullable() })
      .parse(req.body);
    await requireAssignee(t, userId);
    await sql.begin(async (tx) => {
      await tx`UPDATE opportunities SET assigned_user_id=${userId},updated_at=now() WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'opportunity:assigned',${id},${tx.json({ assignedUserId: userId })})`;
    });
    return { ok: true };
  });
  app.get('/api/v1/bids', async (req) => {
    const t = await authenticate(req);
    return sql`SELECT b.id,b.opportunity_id AS "opportunityId",b.title,b.proposed_value AS "proposedValue",b.status,b.protocol,b.notes,b.submitted_at AS "submittedAt",b.created_at AS "createdAt",p.title AS "opportunityTitle" FROM bids b JOIN opportunities o ON o.id=b.opportunity_id AND o.organization_id=b.organization_id AND o.company_id=b.company_id JOIN procurements p ON p.id=o.procurement_id WHERE b.organization_id=${t.organizationId} AND b.company_id=${t.companyId} ORDER BY b.updated_at DESC LIMIT 1000`;
  });
  app.post('/api/v1/bids', async (req, reply) => {
    const t = await authenticate(req);
    const b = bidSchema.parse(req.body);
    await writable(t, b.opportunityId);
    const id = randomUUID();
    if (['won', 'lost', 'submitted'].includes(b.status) && !b.protocol.trim())
      throw httpError(
        400,
        'Informe o protocolo de envio para registrar a participação.',
      );
    await sql.begin(async (tx) => {
      await tx`INSERT INTO bids(id,organization_id,company_id,opportunity_id,title,proposed_value,status,protocol,notes,created_by,submitted_at,result_at) VALUES(${id},${t.organizationId},${t.companyId},${b.opportunityId},${b.title},${b.proposedValue},${b.status},${b.protocol},${b.notes},${t.userId},${['submitted', 'won', 'lost'].includes(b.status) ? new Date() : null},${['won', 'lost'].includes(b.status) ? new Date() : null})`;
      if (['submitted', 'won', 'lost'].includes(b.status))
        await tx`UPDATE opportunities SET status=${b.status},updated_at=now() WHERE id=${b.opportunityId} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'bid:created',${b.opportunityId},${tx.json({ bidId: id, title: b.title, proposedValue: b.proposedValue, notes: b.notes, protocol: b.protocol, status: b.status })})`;
      await tx`INSERT INTO outbox(id,type,payload) VALUES(${randomUUID()},'domain.event',${tx.json({ tenant: t, event: 'bid.changed', resourceId: b.opportunityId, data: { bidId: id, status: b.status } })})`;
    });
    return reply.code(201).send({ id });
  });
  app.patch('/api/v1/bids/:id', async (req) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    const b = bidSchema.parse(req.body);
    const [existing] =
      await sql`SELECT * FROM bids WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
    if (!existing) throw httpError(404, 'Proposta não encontrada.');
    if (existing.opportunity_id !== b.opportunityId)
      throw httpError(
        400,
        'A oportunidade de uma proposta não pode ser alterada.',
      );
    await writable(t, b.opportunityId);
    const transitions: Record<string, string[]> = {
      draft: ['draft', 'prepared', 'cancelled'],
      prepared: ['prepared', 'draft', 'submitted', 'cancelled'],
      submitted: ['submitted', 'won', 'lost', 'cancelled'],
      won: ['won'],
      lost: ['lost'],
      cancelled: ['cancelled', 'draft'],
    };
    if (!transitions[existing.status]?.includes(b.status))
      throw httpError(
        409,
        'Transição de proposta inválida. Prepare e registre o envio antes do resultado.',
      );
    if (['submitted', 'won', 'lost'].includes(b.status) && !b.protocol.trim())
      throw httpError(400, 'Informe o protocolo de envio.');
    await sql.begin(async (tx) => {
      await tx`UPDATE bids SET title=${b.title},proposed_value=${b.proposedValue},status=${b.status},protocol=${b.protocol},notes=${b.notes},submitted_at=CASE WHEN ${['submitted', 'won', 'lost'].includes(b.status)} THEN coalesce(submitted_at,now()) ELSE submitted_at END,result_at=CASE WHEN ${['won', 'lost'].includes(b.status)} THEN coalesce(result_at,now()) ELSE result_at END,updated_at=now() WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
      if (['submitted', 'won', 'lost'].includes(b.status))
        await tx`UPDATE opportunities SET status=${b.status},updated_at=now() WHERE id=${b.opportunityId} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'bid:updated',${b.opportunityId},${tx.json({ bidId: id, title: b.title, proposedValue: b.proposedValue, previousProposedValue: existing.proposed_value, notes: b.notes, protocol: b.protocol, from: existing.status, to: b.status })})`;
      await tx`INSERT INTO outbox(id,type,payload) VALUES(${randomUUID()},'domain.event',${tx.json({ tenant: t, event: 'bid.changed', resourceId: b.opportunityId, data: { bidId: id, status: b.status } })})`;
    });
    return { ok: true };
  });
  app.get('/api/v1/tasks', async (req) => {
    const t = await authenticate(req);
    return sql`SELECT k.id,k.title,k.due_at AS "dueAt",k.assigned_user_id AS "assignedUserId",u.name AS "assignedName",k.status,k.opportunity_id AS "opportunityId" FROM tasks k LEFT JOIN users u ON u.id=k.assigned_user_id WHERE k.organization_id=${t.organizationId} AND k.company_id=${t.companyId} ORDER BY k.status DESC,k.due_at NULLS LAST,k.created_at DESC LIMIT 1000`;
  });
  app.post('/api/v1/tasks', async (req, reply) => {
    const t = await authenticate(req);
    const task = taskSchema.parse(req.body);
    if (task.opportunityId) await writable(t, task.opportunityId);
    if (
      t.role === 'analyst' &&
      task.assignedUserId &&
      task.assignedUserId !== t.userId
    )
      throw httpError(
        403,
        'Analistas podem criar tarefas para si ou sem atribuição.',
      );
    await requireAssignee(t, task.assignedUserId);
    const id = randomUUID();
    await sql`INSERT INTO tasks(id,organization_id,company_id,opportunity_id,title,due_at,assigned_user_id,created_by) VALUES(${id},${t.organizationId},${t.companyId},${task.opportunityId},${task.title},${task.dueAt},${task.assignedUserId},${t.userId})`;
    return reply.code(201).send({ id });
  });
  app.patch('/api/v1/tasks/:id', async (req) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    const body = z
      .object({ status: z.enum(['pending', 'done']) })
      .parse(req.body);
    const [task] =
      await sql`SELECT assigned_user_id FROM tasks WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
    if (!task) throw httpError(404, 'Tarefa não encontrada.');
    if (
      t.role === 'analyst' &&
      task.assigned_user_id &&
      task.assigned_user_id !== t.userId
    )
      throw httpError(403, 'Tarefa atribuída a outro funcionário.');
    await sql`UPDATE tasks SET status=${body.status} WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
    return { ok: true };
  });
  app.get('/api/v1/files', async (req) => {
    const t = await authenticate(req);
    return sql`SELECT id,name,mime,category,valid_until AS "validUntil",notes,opportunity_id AS "opportunityId",bid_id AS "bidId",created_at AS "createdAt" FROM private_files WHERE organization_id=${t.organizationId} AND company_id=${t.companyId} AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1000`;
  });
  app.post('/api/v1/files', async (req, reply) => {
    const t = await authenticate(req);
    const fields: Record<string, string> = {};
    let bytes: Buffer | null = null;
    let name = '';
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        bytes = await part.toBuffer();
        name = part.filename.slice(0, 200);
      } else fields[part.fieldname] = String(part.value);
    }
    if (!bytes || !name) throw httpError(400, 'Selecione um documento.');
    const body = z
      .object({
        category: z
          .enum(['corporate', 'qualification', 'proposal'])
          .default('corporate'),
        opportunityId: z.uuid().nullable().default(null),
        bidId: z.uuid().nullable().default(null),
        validUntil: z.iso.date().nullable().default(null),
        notes: z.string().max(3000).default(''),
      })
      .parse({
        ...fields,
        opportunityId: fields.opportunityId || null,
        bidId: fields.bidId || null,
        validUntil: fields.validUntil || null,
      });
    if (body.opportunityId) await writable(t, body.opportunityId);
    if (body.bidId) {
      const [bid] =
        await sql`SELECT opportunity_id FROM bids WHERE id=${body.bidId} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
      if (!bid) throw httpError(404, 'Proposta não encontrada.');
      await writable(t, bid.opportunity_id);
      if (body.opportunityId && body.opportunityId !== bid.opportunity_id)
        throw httpError(
          400,
          'Documento e proposta devem pertencer à mesma oportunidade.',
        );
    }
    let mime = '';
    if (bytes.subarray(0, 5).toString() === '%PDF-') mime = 'application/pdf';
    else if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a')
      mime = 'image/png';
    else if (bytes.subarray(0, 3).toString('hex') === 'ffd8ff')
      mime = 'image/jpeg';
    if (!mime)
      throw httpError(400, 'Documentos internos aceitam PDF, PNG ou JPEG.');
    const id = randomUUID();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const stored = await storeBlob(
      `${t.organizationId}/${t.companyId}/private/${id}/${hash}`,
      bytes,
      mime,
    );
    await sql.begin(async (tx) => {
      await tx`INSERT INTO private_files(id,organization_id,company_id,opportunity_id,bid_id,name,mime,hash,content,storage_key,category,valid_until,notes,created_by) VALUES(${id},${t.organizationId},${t.companyId},${body.opportunityId},${body.bidId},${name},${mime},${hash},${stored.content},${stored.storageKey},${body.category},${body.validUntil},${body.notes},${t.userId})`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'private-document:uploaded',${id})`;
    });
    return reply.code(201).send({ id });
  });
  app.get('/api/v1/files/:id/download', async (req, reply) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    const [file] =
      await sql`SELECT name,mime,content,storage_key FROM private_files WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND archived_at IS NULL`;
    if (!file) throw httpError(404, 'Documento não encontrado.');
    const bytes = await loadBlob(file.content, file.storage_key);
    await sql`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'private-document:downloaded',${id})`;
    return reply
      .type(file.mime)
      .header('Content-Security-Policy', "sandbox; default-src 'none'")
      .header(
        'Content-Disposition',
        "attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
      )
      .send(bytes);
  });
  app.patch('/api/v1/files/:id/archive', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'company:manage');
    const { id } = idSchema.parse(req.params);
    const rows =
      await sql`UPDATE private_files SET archived_at=now() WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} RETURNING id`;
    if (!rows.length) throw httpError(404, 'Documento não encontrado.');
    return { ok: true };
  });
  app.get('/api/v1/notifications', async (req) => {
    const t = await authenticate(req);
    return sql`SELECT n.id,n.title,n.body,n.kind,n.opportunity_id AS "opportunityId",r.read_at IS NOT NULL AS read,n.created_at AS "createdAt",n.email_status AS "emailStatus" FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=${t.userId} WHERE n.organization_id=${t.organizationId} AND n.company_id=${t.companyId} AND (n.recipient_user_id IS NULL OR n.recipient_user_id=${t.userId}) ORDER BY n.created_at DESC LIMIT 200`;
  });
  app.post('/api/v1/notifications/:id/read', async (req) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    const [notification] =
      await sql`SELECT id FROM notifications WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND (recipient_user_id IS NULL OR recipient_user_id=${t.userId})`;
    if (!notification) throw httpError(404, 'Notificação não encontrada.');
    await sql`INSERT INTO notification_reads(notification_id,user_id) VALUES(${id},${t.userId}) ON CONFLICT DO NOTHING`;
    return { ok: true };
  });
  app.get('/api/v1/notifications/preferences', async (req) => {
    const t = await authenticate(req);
    const [prefs] =
      await sql`SELECT email_enabled AS "emailEnabled",lead_days AS "leadDays" FROM notification_preferences WHERE user_id=${t.userId} AND company_id=${t.companyId} AND organization_id=${t.organizationId}`;
    return prefs || { emailEnabled: false, leadDays: [1, 3, 7] };
  });
  app.put('/api/v1/notifications/preferences', async (req) => {
    const t = await authenticate(req);
    const prefs = z
      .object({
        emailEnabled: z.boolean(),
        leadDays: z.array(z.number().int().min(0).max(30)).min(1).max(10),
      })
      .parse(req.body);
    await sql`INSERT INTO notification_preferences(user_id,organization_id,company_id,email_enabled,lead_days) VALUES(${t.userId},${t.organizationId},${t.companyId},${prefs.emailEnabled},${sql.json([...new Set(prefs.leadDays)])}) ON CONFLICT(user_id,company_id) DO UPDATE SET email_enabled=EXCLUDED.email_enabled,lead_days=EXCLUDED.lead_days`;
    return { ok: true };
  });
  app.get('/api/v1/saved-searches', async (req) => {
    const t = await authenticate(req);
    return sql`SELECT id,name,filters FROM saved_searches WHERE user_id=${t.userId} AND company_id=${t.companyId} AND organization_id=${t.organizationId} ORDER BY name`;
  });
  app.post('/api/v1/saved-searches', async (req, reply) => {
    const t = await authenticate(req);
    const body = z
      .object({
        name: z.string().trim().min(2).max(100),
        filters: z.object({
          query: z.string().max(300),
          status: z.string().max(30).default('all'),
        }),
      })
      .parse(req.body);
    const id = randomUUID();
    await sql`INSERT INTO saved_searches(id,organization_id,company_id,user_id,name,filters) VALUES(${id},${t.organizationId},${t.companyId},${t.userId},${body.name},${sql.json(body.filters)})`;
    return reply.code(201).send({ id });
  });
  app.delete('/api/v1/saved-searches/:id', async (req) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    await sql`DELETE FROM saved_searches WHERE id=${id} AND user_id=${t.userId} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
    return { ok: true };
  });
  app.get('/api/v1/analytics/overview', async (req) => {
    const t = await authenticate(req);
    const [metrics] =
      await sql`SELECT count(*)::int AS opportunities,count(*) FILTER(WHERE status NOT IN ('discarded','won','lost') AND p.deadline>=now())::int AS active,count(*) FILTER(WHERE status='review')::int AS review,count(*) FILTER(WHERE status='selected')::int AS selected,count(*) FILTER(WHERE status='won')::int AS won,count(*) FILTER(WHERE status='lost')::int AS lost,coalesce(sum(p.value) FILTER(WHERE o.status NOT IN ('discarded','won','lost') AND p.deadline>=now()),0) AS "estimatedPipeline",count(*) FILTER(WHERE o.status NOT IN ('discarded','won','lost') AND p.deadline<now())::int AS "expired",count(*) FILTER(WHERE o.status NOT IN ('discarded','won','lost') AND p.deadline IS NULL)::int AS "unknownDeadline",coalesce(sum(p.value) FILTER(WHERE o.status NOT IN ('discarded','won','lost') AND p.deadline<now()),0) AS "expiredPipeline",coalesce(sum(p.value) FILTER(WHERE o.status='discarded'),0) AS "discardedPipeline",count(*) FILTER(WHERE p.deadline>now() AND p.deadline<now()+interval '7 days' AND o.status NOT IN ('discarded','won','lost'))::int AS "upcomingDeadlines" FROM opportunities o JOIN procurements p ON p.id=o.procurement_id WHERE o.organization_id=${t.organizationId} AND o.company_id=${t.companyId}`;
    const byStatus =
      await sql`SELECT status,count(*)::int AS count FROM opportunities WHERE organization_id=${t.organizationId} AND company_id=${t.companyId} GROUP BY status`;
    const byUf =
      await sql`SELECT coalesce(p.uf,'Não informado') AS uf,count(*)::int AS count FROM opportunities o JOIN procurements p ON p.id=o.procurement_id WHERE o.organization_id=${t.organizationId} AND o.company_id=${t.companyId} GROUP BY p.uf ORDER BY count DESC`;
    return { ...metrics, byStatus, byUf };
  });
  app.get('/api/v1/analytics/group', async (req) => {
    const t = await authenticate(req);
    requireGroupAdmin(t);
    const { companyId } = z
      .object({ companyId: z.uuid().optional() })
      .parse(req.query);
    const companies =
      await sql`SELECT c.id,c.name,c.short_name AS "shortName",c.logo_url AS "logoUrl",c.is_parent AS "isParent",c.active,(SELECT count(*)::int FROM opportunities o WHERE o.company_id=c.id AND o.organization_id=c.organization_id) AS opportunities,(SELECT count(*)::int FROM opportunities o WHERE o.company_id=c.id AND o.organization_id=c.organization_id AND o.status NOT IN ('discarded','won','lost') AND EXISTS(SELECT 1 FROM procurements p WHERE p.id=o.procurement_id AND p.deadline>=now())) AS "activeOpportunities" FROM companies c WHERE c.organization_id=${t.organizationId} AND NOT c.is_parent ORDER BY c.name`;
    if (companyId && !companies.some((c) => c.id === companyId))
      throw httpError(404, 'Empresa não encontrada no grupo.');
    const [totals] =
      await sql`SELECT count(*)::int AS opportunities,count(DISTINCT o.procurement_id)::int AS "uniqueProcurements",count(*) FILTER(WHERE o.status NOT IN ('discarded','won','lost') AND p.deadline>=now())::int AS active,count(*) FILTER(WHERE o.status='new')::int AS new,count(*) FILTER(WHERE o.status='review')::int AS review,count(*) FILTER(WHERE o.status='selected')::int AS selected,count(*) FILTER(WHERE o.status='submitted')::int AS submitted,count(*) FILTER(WHERE o.status='won')::int AS won,count(*) FILTER(WHERE o.status='lost')::int AS lost,count(*) FILTER(WHERE o.status='discarded')::int AS discarded,coalesce(sum(p.value) FILTER(WHERE o.status NOT IN ('discarded','won','lost') AND p.deadline>=now()),0) AS "estimatedPipeline",count(*) FILTER(WHERE o.status NOT IN ('discarded','won','lost') AND p.deadline<now())::int AS "expired",count(*) FILTER(WHERE o.status NOT IN ('discarded','won','lost') AND p.deadline IS NULL)::int AS "unknownDeadline",coalesce(sum(p.value) FILTER(WHERE o.status NOT IN ('discarded','won','lost') AND p.deadline<now()),0) AS "expiredPipeline",coalesce(sum(p.value) FILTER(WHERE o.status='discarded'),0) AS "discardedPipeline",count(*) FILTER(WHERE p.deadline>now() AND p.deadline<now()+interval '7 days' AND o.status NOT IN ('discarded','won','lost'))::int AS "upcomingDeadlines" FROM opportunities o JOIN companies c ON c.id=o.company_id AND c.organization_id=o.organization_id JOIN procurements p ON p.id=o.procurement_id WHERE o.organization_id=${t.organizationId} AND NOT c.is_parent AND (${companyId || null}::uuid IS NULL OR o.company_id=${companyId || null})`;
    const byStatus =
      await sql`SELECT o.status,count(*)::int AS count FROM opportunities o JOIN companies c ON c.id=o.company_id AND c.organization_id=o.organization_id WHERE o.organization_id=${t.organizationId} AND NOT c.is_parent AND (${companyId || null}::uuid IS NULL OR o.company_id=${companyId || null}) GROUP BY o.status`;
    const byUf =
      await sql`SELECT coalesce(p.uf,'Não informado') AS uf,count(*)::int AS count FROM opportunities o JOIN companies c ON c.id=o.company_id AND c.organization_id=o.organization_id JOIN procurements p ON p.id=o.procurement_id WHERE o.organization_id=${t.organizationId} AND NOT c.is_parent AND (${companyId || null}::uuid IS NULL OR o.company_id=${companyId || null}) GROUP BY p.uf ORDER BY count DESC`;
    const [proposals] =
      await sql`SELECT count(*)::int AS count,coalesce(sum(proposed_value),0) AS value FROM (SELECT DISTINCT ON(b.opportunity_id) b.proposed_value FROM bids b JOIN companies c ON c.id=b.company_id AND c.organization_id=b.organization_id WHERE b.organization_id=${t.organizationId} AND NOT c.is_parent AND b.status<>'cancelled' AND (${companyId || null}::uuid IS NULL OR b.company_id=${companyId || null}) ORDER BY b.opportunity_id,b.updated_at DESC,b.id) latest`;
    return {
      companies,
      totals: {
        ...totals,
        proposalCount: proposals!.count,
        proposalValue: proposals!.value,
      },
      byStatus,
      byUf,
    };
  });
  app.get('/api/v1/exports/opportunities.csv', async (req, reply) => {
    const t = await authenticate(req);
    const rows =
      await sql`SELECT p.source_id,p.title,p.agency,p.uf,p.value,p.deadline,o.status,o.score FROM opportunities o JOIN procurements p ON p.id=o.procurement_id WHERE o.organization_id=${t.organizationId} AND o.company_id=${t.companyId} ORDER BY o.created_at DESC`;
    const cell = (value: unknown) => {
      let text =
        value instanceof Date ? value.toISOString() : String(value ?? '');
      if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const csv = [
      'Identificador PNCP;Objeto;Órgão;UF;Valor estimado;Prazo;Status;Aderência',
      ...rows.map((row) =>
        [
          row.source_id,
          row.title,
          row.agency,
          row.uf,
          row.value,
          row.deadline,
          row.status,
          row.score,
        ]
          .map(cell)
          .join(';'),
      ),
    ].join('\r\n');
    await sql`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'opportunities:exported',${t.companyId})`;
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="oportunidades.csv"')
      .send('\uFEFF' + csv);
  });
  app.patch('/api/v1/profile', async (req) => {
    const t = await authenticate(req);
    if (t.authKind !== 'session')
      throw httpError(403, 'Ação restrita à sessão do usuário.');
    const { name } = z
      .object({ name: z.string().trim().min(2).max(120) })
      .parse(req.body);
    await sql`UPDATE users SET name=${name} WHERE id=${t.userId} AND organization_id=${t.organizationId}`;
    return { ok: true };
  });
  app.post('/api/v1/profile/password', async (req, reply) => {
    const t = await authenticate(req);
    if (t.authKind !== 'session')
      throw httpError(403, 'Ação restrita à sessão do usuário.');
    const body = z
      .object({
        currentPassword: z.string().max(256),
        newPassword: z.string().min(12).max(256),
      })
      .parse(req.body);
    const [user] =
      await sql`SELECT password_hash FROM users WHERE id=${t.userId} AND organization_id=${t.organizationId}`;
    if (!user || !verifyPassword(body.currentPassword, user.password_hash))
      throw httpError(400, 'Senha atual inválida.');
    await sql.begin(async (tx) => {
      await tx`UPDATE users SET password_hash=${hashPassword(body.newPassword)},temporary_password_hash=NULL,temporary_password_expires_at=NULL,reset_used_password_hash=NULL WHERE id=${t.userId}`;
      await tx`DELETE FROM sessions WHERE user_id=${t.userId}`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'profile:password-changed',${t.userId})`;
    });
    reply.clearCookie('session', { path: '/' });
    return { ok: true, loginRequired: true };
  });
}
