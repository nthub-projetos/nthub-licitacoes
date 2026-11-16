import type { FastifyInstance } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { companySchema, roleSchema } from '@nthub/contracts';
import { sql } from '../../core/db.js';
import {
  authenticate,
  accessibleCompanies,
  hashPassword,
  hashToken,
  httpError,
  requireGroupAdmin,
  requirePermission,
} from '../identity/index.js';
const idSchema = z.object({ id: z.uuid() });
export async function organizationRoutes(app: FastifyInstance) {
  app.get('/api/v1/companies', async (req) =>
    accessibleCompanies(await authenticate(req)),
  );
  app.get('/api/v1/companies/admin', async (req) => {
    const t = await authenticate(req);
    requireGroupAdmin(t);
    return sql`SELECT id,name,short_name AS "shortName",description,cnpj,website,logo_url AS "logoUrl",capabilities,search_settings AS "searchSettings",is_parent AS "isParent",active,'group_admin' AS role FROM companies WHERE organization_id=${t.organizationId} ORDER BY is_parent DESC,name`;
  });
  app.post('/api/v1/companies/switch', async (req) => {
    const t = await authenticate(req);
    if (t.authKind !== 'session')
      throw httpError(403, 'Integrações não podem alternar o ambiente.');
    const { companyId } = z.object({ companyId: z.uuid() }).parse(req.body);
    const companies = await accessibleCompanies(t);
    if (!companies.some((c) => c.id === companyId))
      throw httpError(403, 'Você não possui acesso à empresa selecionada.');
    await sql`UPDATE sessions SET active_company_id=${companyId} WHERE token_hash=${hashToken(req.cookies.session!)} AND user_id=${t.userId}`;
    return { ok: true };
  });
  app.post('/api/v1/companies', async (req, reply) => {
    const t = await authenticate(req);
    requireGroupAdmin(t);
    const c = companySchema.parse(req.body);
    const id = randomUUID();
    await sql.begin(async (tx) => {
      const [parent] =
        await tx`SELECT id FROM companies WHERE organization_id=${t.organizationId} AND is_parent LIMIT 1`;
      if (c.isParent && parent)
        throw httpError(409, 'A matriz já está cadastrada.');
      await tx`INSERT INTO companies(id,organization_id,name,short_name,description,cnpj,website,capabilities,search_settings,is_parent,active,parent_company_id) VALUES(${id},${t.organizationId},${c.name},${c.shortName},${c.description},${c.cnpj},${c.website},${tx.json(c.capabilities)},${tx.json(c.searchSettings)},${c.isParent},${c.active},${c.isParent ? null : parent?.id || null})`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${id},${t.userId},'company:created',${id})`;
    });
    return reply.code(201).send({ id });
  });
  app.patch('/api/v1/companies/:id', async (req) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    if (id !== t.companyId) requireGroupAdmin(t);
    requirePermission(t, 'company:manage');
    const c = companySchema.parse(req.body);
    const [old] =
      await sql`SELECT * FROM companies WHERE id=${id} AND organization_id=${t.organizationId}`;
    if (!old) throw httpError(404, 'Empresa não encontrada.');
    if (c.active !== old.active || c.isParent !== old.is_parent)
      requireGroupAdmin(t);
    if (id === t.companyId && !c.active)
      throw httpError(
        409,
        'Alterne para outra empresa antes de desativar este ambiente.',
      );
    if (old.is_parent && !c.isParent)
      throw httpError(409, 'O vínculo de matriz deve ser preservado.');
    if (c.isParent && !old.is_parent)
      throw httpError(409, 'A matriz já está cadastrada.');
    await sql.begin(async (tx) => {
      await tx`UPDATE companies SET configured_by_user=true,criteria_version=criteria_version+1,name=${c.name},short_name=${c.shortName},description=${c.description},cnpj=${c.cnpj},website=${c.website},capabilities=${tx.json(c.capabilities)},search_settings=${tx.json(c.searchSettings)},active=${c.active} WHERE id=${id} AND organization_id=${t.organizationId}`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${id},${t.userId},'company:updated',${id},${tx.json({ keywords: c.capabilities, searchSettings: c.searchSettings })})`;
    });
    return { ok: true };
  });
  app.post('/api/v1/companies/:id/logo', async (req, reply) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    if (id !== t.companyId) requireGroupAdmin(t);
    requirePermission(t, 'company:manage');
    const [company] =
      await sql`SELECT id FROM companies WHERE id=${id} AND organization_id=${t.organizationId}`;
    if (!company) throw httpError(404, 'Empresa não encontrada.');
    const file = await req.file();
    if (!file) throw httpError(400, 'Selecione uma imagem PNG.');
    const bytes = await file.toBuffer();
    if (
      bytes.length > 2 * 1024 * 1024 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    )
      throw httpError(400, 'Envie uma imagem PNG de até 2 MB.');
    if (
      bytes.length < 24 ||
      bytes.readUInt32BE(16) > 4096 ||
      bytes.readUInt32BE(20) > 4096
    )
      throw httpError(400, 'A logo deve ter até 4096 pixels por dimensão.');
    await sql.begin(async (tx) => {
      await tx`INSERT INTO company_logos VALUES(${id},${t.organizationId},${bytes},'image/png') ON CONFLICT(company_id) DO UPDATE SET content=EXCLUDED.content`;
      await tx`UPDATE companies SET logo_url=${'/api/v1/companies/' + id + '/logo?v=' + Date.now()} WHERE id=${id} AND organization_id=${t.organizationId}`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${id},${t.userId},'company:logo-updated',${id})`;
    });
    return reply.code(201).send({ ok: true });
  });
  app.get('/api/v1/companies/:id/logo', async (req, reply) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    if (!(await accessibleCompanies(t)).some((c) => c.id === id))
      throw httpError(404, 'Empresa não encontrada.');
    const [logo] =
      await sql`SELECT content,mime FROM company_logos WHERE company_id=${id} AND organization_id=${t.organizationId}`;
    if (!logo) throw httpError(404, 'Logo não encontrada.');
    return reply.type('image/png').send(logo.content);
  });
  app.get('/api/v1/members', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'members:read');
    return sql`SELECT u.id,u.name,u.email,CASE WHEN u.group_role='group_admin' THEN 'group_admin' ELSE m.role END AS role,(u.active AND coalesce(m.active,true)) AS active,u.group_role AS "groupRole",m.permission_profile_id AS "permissionProfileId",p.name AS "permissionProfileName" FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.company_id=${t.companyId} AND m.organization_id=u.organization_id LEFT JOIN permission_profiles p ON p.id=m.permission_profile_id AND p.company_id=m.company_id AND p.organization_id=m.organization_id WHERE u.organization_id=${t.organizationId} AND (m.company_id IS NOT NULL OR u.group_role='group_admin') ORDER BY u.group_role,u.name,u.email`;
  });
  app.post('/api/v1/members', async (req, reply) => {
    const t = await authenticate(req);
    requirePermission(t, 'members:manage');
    const body = z
      .object({
        name: z.string().trim().min(2).max(120),
        email: z.email().toLowerCase(),
        role: roleSchema,
      })
      .parse(req.body);
    if (!t.isGroupAdmin && body.role === 'company_manager')
      throw httpError(403, 'Somente o administrador do grupo cria gestores.');
    const token = randomBytes(32).toString('hex');
    let userId = '';
    await sql.begin(async (tx) => {
      const [existing] =
        await tx`SELECT id,organization_id,group_role FROM users WHERE email=${body.email}`;
      if (existing && existing.organization_id !== t.organizationId)
        throw httpError(409, 'Este e-mail já está vinculado a outro cadastro.');
      if (existing?.group_role === 'group_admin')
        throw httpError(409, 'O administrador do grupo já possui acesso.');
      userId = existing?.id || randomUUID();
      if (!existing)
        await tx`INSERT INTO users(id,organization_id,company_id,name,email,password_hash) VALUES(${userId},${t.organizationId},${t.companyId},${body.name},${body.email},${hashPassword(randomBytes(48).toString('hex'))})`;
      else {
        const [membership] =
          await tx`SELECT user_id FROM memberships WHERE user_id=${userId} AND company_id=${t.companyId}`;
        if (membership)
          throw httpError(409, 'Funcionário já vinculado a esta empresa.');
      }
      await tx`INSERT INTO memberships(user_id,organization_id,company_id,role) VALUES(${userId},${t.organizationId},${t.companyId},${body.role})`;
      if (!existing)
        await tx`INSERT INTO invitations(id,organization_id,company_id,user_id,token_hash,expires_at,created_by) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${userId},${hashToken(token)},now()+interval '48 hours',${t.userId})`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'member:added',${userId},${tx.json({ role: body.role })})`;
    });
    const [invitation] =
      await sql`SELECT id FROM invitations WHERE token_hash=${hashToken(token)}`;
    return reply.code(201).send({
      id: userId,
      invitationPath: invitation ? '/accept-invitation#token=' + token : null,
    });
  });
  app.patch('/api/v1/members/:id', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'members:manage');
    const { id } = idSchema.parse(req.params);
    const body = z
      .object({ role: roleSchema, active: z.boolean() })
      .parse(req.body);
    const [member] =
      await sql`SELECT u.group_role,m.role FROM users u JOIN memberships m ON m.user_id=u.id AND m.company_id=${t.companyId} AND m.organization_id=u.organization_id WHERE u.id=${id} AND u.organization_id=${t.organizationId}`;
    if (!member)
      throw httpError(404, 'Funcionário não encontrado nesta empresa.');
    if (member.group_role === 'group_admin' || id === t.userId)
      throw httpError(409, 'Não é possível alterar este vínculo por aqui.');
    if (
      !t.isGroupAdmin &&
      (member.role === 'company_manager' || body.role === 'company_manager')
    )
      requireGroupAdmin(t);
    await sql.begin(async (tx) => {
      await tx`UPDATE memberships SET role=${body.role},active=${body.active} WHERE user_id=${id} AND company_id=${t.companyId} AND organization_id=${t.organizationId}`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'member:access-updated',${id},${tx.json(body)})`;
    });
    return { ok: true };
  });
  app.post('/api/v1/members/:id/invitation', async (req) => {
    const t = await authenticate(req);
    requireGroupAdmin(t);
    const { id } = idSchema.parse(req.params);
    const [user] =
      await sql`SELECT u.id,m.role FROM users u JOIN memberships m ON m.user_id=u.id AND m.company_id=${t.companyId} AND m.organization_id=u.organization_id WHERE u.id=${id} AND u.organization_id=${t.organizationId} AND u.group_role<>'group_admin' AND m.active`;
    if (!user) throw httpError(404, 'Funcionário não encontrado.');
    if (!t.isGroupAdmin && user.role === 'company_manager')
      requireGroupAdmin(t);
    const token = randomBytes(32).toString('hex');
    await sql.begin(async (tx) => {
      await tx`UPDATE invitations SET expires_at=now() WHERE user_id=${id} AND accepted_at IS NULL`;
      await tx`INSERT INTO invitations(id,organization_id,company_id,user_id,token_hash,expires_at,created_by) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${id},${hashToken(token)},now()+interval '48 hours',${t.userId})`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'member:invitation-created',${id})`;
    });
    return { invitationPath: '/accept-invitation#token=' + token };
  });
  const inviteSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
  app.post(
    '/api/v1/auth/invitation/inspect',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { token } = inviteSchema.parse(req.body);
      const [invite] =
        await sql`SELECT u.name,u.email,c.name AS company FROM invitations i JOIN users u ON u.id=i.user_id AND u.active JOIN companies c ON c.id=i.company_id AND c.organization_id=i.organization_id AND c.active JOIN memberships m ON m.user_id=u.id AND m.company_id=c.id AND m.active WHERE i.token_hash=${hashToken(token)} AND i.expires_at>now() AND i.accepted_at IS NULL`;
      if (!invite)
        throw httpError(
          410,
          'Convite inválido ou expirado. Solicite um novo ao gestor.',
        );
      return invite;
    },
  );
  app.post(
    '/api/v1/auth/invitation/accept',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => {
      const { token, password } = inviteSchema
        .extend({ password: z.string().min(12).max(256) })
        .parse(req.body);
      await sql.begin(async (tx) => {
        const [invite] =
          await tx`SELECT i.id,i.user_id,i.organization_id,i.company_id FROM invitations i JOIN users u ON u.id=i.user_id AND u.active JOIN companies c ON c.id=i.company_id AND c.active JOIN memberships m ON m.user_id=u.id AND m.company_id=i.company_id AND m.active WHERE i.token_hash=${hashToken(token)} AND i.expires_at>now() AND i.accepted_at IS NULL FOR UPDATE OF i`;
        if (!invite) throw httpError(410, 'Convite inválido ou expirado.');
        await tx`UPDATE users SET password_hash=${hashPassword(password)} WHERE id=${invite.user_id}`;
        await tx`UPDATE invitations SET accepted_at=now() WHERE user_id=${invite.user_id} AND accepted_at IS NULL`;
        await tx`DELETE FROM sessions WHERE user_id=${invite.user_id}`;
        await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${invite.organization_id},${invite.company_id},${invite.user_id},'member:invitation-accepted',${invite.user_id})`;
      });
      return { ok: true };
    },
  );
}
