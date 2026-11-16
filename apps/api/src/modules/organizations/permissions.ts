import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  permissionCatalog,
  permissionKeys,
  builtinProfiles,
  defaultPermissions,
  roleSchema,
} from '@nthub/contracts';
import { sql } from '../../core/db.js';
import {
  authenticate,
  requireGroupAdmin,
  httpError,
} from '../identity/index.js';
const keys = z
  .array(z.enum(permissionKeys as [string, ...string[]]))
  .max(permissionKeys.length)
  .transform((v) => [...new Set(v)]);
const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).default(''),
  permissions: keys,
});
const idSchema = z.object({ id: z.uuid() });
export async function permissionRoutes(app: FastifyInstance) {
  app.get('/api/v1/permissions', async (req) => {
    const t = await authenticate(req);
    requireGroupAdmin(t);
    const profiles =
      await sql`SELECT id,name,description,permissions FROM permission_profiles WHERE company_id=${t.companyId} AND organization_id=${t.organizationId} ORDER BY name`;
    const members =
      await sql`SELECT u.id,u.name,u.email,m.role,m.permission_profile_id AS "profileId",m.permission_overrides AS overrides,m.active FROM memberships m JOIN users u ON u.id=m.user_id AND u.organization_id=m.organization_id WHERE m.company_id=${t.companyId} AND m.organization_id=${t.organizationId} AND u.group_role<>'group_admin' AND u.active ORDER BY u.name,u.email`;
    return {
      catalog: permissionCatalog.map(([key, group, label]) => ({
        key,
        group,
        label,
      })),
      profiles: [
        ...builtinProfiles.map((p) => ({
          ...p,
          description: 'Perfil padrão do sistema',
          builtin: true,
          permissions: defaultPermissions(p.id),
        })),
        ...profiles.map((p) => ({ ...p, builtin: false })),
      ],
      members,
    };
  });
  app.post('/api/v1/permissions/profiles', async (req, reply) => {
    const t = await authenticate(req);
    requireGroupAdmin(t);
    const body = profileSchema.parse(req.body);
    const id = randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO permission_profiles(id,organization_id,company_id,name,description,permissions) VALUES(${id},${t.organizationId},${t.companyId},${body.name},${body.description},${tx.json(body.permissions)})`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'permissions:profile-created',${id},${tx.json(body)})`;
    });
    return reply.code(201).send({ id });
  });
  app.patch('/api/v1/permissions/profiles/:id', async (req) => {
    const t = await authenticate(req);
    requireGroupAdmin(t);
    const { id } = idSchema.parse(req.params);
    const body = profileSchema.parse(req.body);
    await sql.begin(async (tx) => {
      const [old] =
        await tx`SELECT id FROM permission_profiles WHERE id=${id} AND company_id=${t.companyId} AND organization_id=${t.organizationId} FOR UPDATE`;
      if (!old) throw httpError(404, 'Perfil não encontrado nesta empresa.');
      await tx`UPDATE permission_profiles SET name=${body.name},description=${body.description},permissions=${tx.json(body.permissions)},updated_at=now() WHERE id=${id} AND company_id=${t.companyId} AND organization_id=${t.organizationId}`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'permissions:profile-updated',${id},${tx.json(body)})`;
    });
    return { ok: true };
  });
  app.put('/api/v1/permissions/members/:id', async (req) => {
    const t = await authenticate(req);
    requireGroupAdmin(t);
    const { id } = idSchema.parse(req.params);
    const body = z
      .object({
        role: roleSchema,
        profileId: z.uuid().nullable(),
        overrides: z.partialRecord(
          z.enum(permissionKeys as [string, ...string[]]),
          z.boolean(),
        ),
      })
      .parse(req.body);
    await sql.begin(async (tx) => {
      const [member] =
        await tx`SELECT u.group_role,m.role,m.permission_profile_id,m.permission_overrides FROM memberships m JOIN users u ON u.id=m.user_id AND u.organization_id=m.organization_id WHERE m.user_id=${id} AND m.company_id=${t.companyId} AND m.organization_id=${t.organizationId} FOR UPDATE OF m`;
      if (!member)
        throw httpError(404, 'Funcionário não encontrado nesta empresa.');
      if (member.group_role === 'group_admin' || id === t.userId)
        throw httpError(
          409,
          'O administrador do grupo mantém acesso integral.',
        );
      if (body.profileId) {
        const [profile] =
          await tx`SELECT id FROM permission_profiles WHERE id=${body.profileId} AND company_id=${t.companyId} AND organization_id=${t.organizationId}`;
        if (!profile)
          throw httpError(404, 'Perfil não encontrado nesta empresa.');
      }
      await tx`UPDATE memberships SET role=${body.role},permission_profile_id=${body.profileId},permission_overrides=${tx.json(body.overrides)} WHERE user_id=${id} AND company_id=${t.companyId} AND organization_id=${t.organizationId}`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'permissions:member-updated',${id},${tx.json({ previous: { role: member.role, profileId: member.permission_profile_id, overrides: member.permission_overrides }, ...body })})`;
    });
    return { ok: true };
  });
}
