import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import {
  effectivePermissions,
  defaultPermissions,
  type CompanyRole,
} from '@nthub/contracts';
import { sql } from '../../core/db.js';
export type Tenant = {
  userId: string;
  organizationId: string;
  companyId: string;
  email: string;
  name?: string;
  role?: CompanyRole | 'group_admin';
  isGroupAdmin?: boolean;
  authKind?: 'session' | 'api_token';
  scopes?: string[];
  permissions?: string[];
  apiTokenId?: string;
};
export const hashToken = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function verifyPassword(password: string, hash: string) {
  const [salt, key] = hash.split(':');
  if (!salt || !key || !/^[a-f0-9]{128}$/.test(key)) return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(key, 'hex'),
  );
}
const dummyPasswordHash = hashPassword(randomBytes(32).toString('hex'));
export function verifyLoginCredentials(
  password: string,
  user?: {
    active: boolean;
    password_hash: string;
    temporary_password_hash?: string | null;
    temporary_password_expires_at?: string | Date | null;
  },
) {
  const temporaryValid = Boolean(
    user?.active &&
    user.temporary_password_hash &&
    user.temporary_password_expires_at &&
    new Date(user.temporary_password_expires_at).getTime() > Date.now(),
  );
  // Always perform two hashes, including absent/inactive accounts and absent/expired resets.
  const regularMatch = verifyPassword(
    password,
    user?.active ? user.password_hash : dummyPasswordHash,
  );
  const temporaryMatch = verifyPassword(
    password,
    temporaryValid ? user!.temporary_password_hash! : dummyPasswordHash,
  );
  return {
    regular: Boolean(user?.active && regularMatch),
    temporary: Boolean(temporaryValid && temporaryMatch),
  };
}
export function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}
async function resolveAuthentication(request: FastifyRequest): Promise<Tenant> {
  const bearer = request.headers.authorization?.match(
    /^Bearer (nth_[a-f0-9]{64})$/,
  )?.[1];
  if (bearer) {
    const [token] =
      await sql`SELECT k.id,k.organization_id,k.company_id,k.scopes,u.id AS user_id,u.email,u.name FROM api_tokens k JOIN users u ON u.id=k.created_by AND u.organization_id=k.organization_id JOIN companies c ON c.id=k.company_id AND c.organization_id=k.organization_id WHERE k.token_hash=${hashToken(bearer)} AND k.active AND u.active AND c.active AND (u.group_role='group_admin' OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.company_id=c.id AND m.organization_id=u.organization_id AND m.active)) AND (k.expires_at IS NULL OR k.expires_at>now())`;
    if (!token)
      throw httpError(401, 'Credencial de integração inválida ou expirada.');
    const ownerPermissions = await membershipPermissions(
      token.user_id,
      token.company_id,
      token.organization_id,
    );
    const [owner] =
      await sql`SELECT group_role FROM users WHERE id=${token.user_id}`;
    if (
      owner?.group_role !== 'group_admin' &&
      !ownerPermissions.includes('integrations:manage')
    )
      throw httpError(401, 'Acesso da integração revogado.');
    await sql`UPDATE api_tokens SET last_used_at=now() WHERE id=${token.id}`;
    return {
      userId: token.user_id,
      organizationId: token.organization_id,
      companyId: token.company_id,
      email: token.email,
      name: token.name,
      role: 'viewer',
      isGroupAdmin: false,
      authKind: 'api_token',
      apiTokenId: token.id,
      scopes:
        owner?.group_role === 'group_admin'
          ? (token.scopes as string[])
          : (token.scopes as string[]).filter((p) =>
              ownerPermissions.includes(p),
            ),
    };
  }
  const scopeHeader = request.headers['x-company-id'];
  const scopeQuery = new URL(request.url, 'http://internal').searchParams.get(
    'company',
  );
  const requestedCompany =
    typeof scopeHeader === 'string' ? scopeHeader : scopeQuery;
  if (
    requestedCompany &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestedCompany,
    )
  )
    throw httpError(400, 'Empresa inválida.');
  const token = request.cookies.session;
  if (!token) throw httpError(401, 'Entre na sua conta para continuar.');
  const [user] =
    await sql`SELECT u.id,u.organization_id,u.email,u.name,u.group_role,coalesce(${requestedCompany || null}::uuid,s.active_company_id,u.company_id) AS company_id,m.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN companies c ON c.id=coalesce(${requestedCompany || null}::uuid,s.active_company_id,u.company_id) AND c.organization_id=u.organization_id AND c.active LEFT JOIN memberships m ON m.user_id=u.id AND m.company_id=c.id AND m.organization_id=u.organization_id AND m.active WHERE s.token_hash=${hashToken(token)} AND s.expires_at>now() AND NOT s.password_reset_only AND u.active AND (u.group_role='group_admin' OR m.user_id IS NOT NULL)`;
  if (!user)
    throw httpError(401, 'Sessão expirada ou acesso à empresa revogado.');
  const permissions = await membershipPermissions(
    user.id,
    user.company_id,
    user.organization_id,
    user.role,
  );
  const isGroupAdmin = user.group_role === 'group_admin';
  return {
    userId: user.id,
    organizationId: user.organization_id,
    companyId: user.company_id,
    email: user.email,
    name: user.name,
    role: isGroupAdmin ? 'group_admin' : (user.role as CompanyRole),
    isGroupAdmin,
    permissions,
    authKind: 'session',
  };
}
export async function membershipPermissions(
  userId: string,
  companyId: string,
  organizationId: string,
  role?: string,
) {
  const [membership] =
    await sql`SELECT m.role,m.permission_profile_id,m.permission_overrides,p.permissions FROM memberships m LEFT JOIN permission_profiles p ON p.id=m.permission_profile_id AND p.company_id=m.company_id AND p.organization_id=m.organization_id WHERE m.user_id=${userId} AND m.company_id=${companyId} AND m.organization_id=${organizationId} AND m.active`;
  return effectivePermissions(
    membership?.role ?? role,
    membership?.permission_profile_id
      ? ((membership.permissions as string[]) ?? [])
      : null,
    (membership?.permission_overrides as Record<string, boolean>) ?? {},
  );
}
export function requirePermission(t: Tenant, permission: string) {
  if (t.authKind === 'api_token') {
    if (!t.scopes?.includes(permission))
      throw httpError(403, 'A credencial não possui este escopo.');
    return;
  }
  if (t.isGroupAdmin || t.role === 'group_admin') return;
  if ((t.permissions ?? defaultPermissions(t.role)).includes(permission))
    return;
  throw httpError(403, 'Seu perfil não permite esta ação nesta empresa.');
}
export function requireGroupAdmin(t: Tenant) {
  if (!t.isGroupAdmin || t.authKind === 'api_token')
    throw httpError(403, 'Ação restrita ao administrador do grupo NTHUB.');
}
export async function accessibleCompanies(t: Tenant) {
  return sql`SELECT c.id,c.name,c.short_name AS "shortName",c.description,c.cnpj,c.website,c.logo_url AS "logoUrl",c.capabilities,c.search_settings AS "searchSettings",c.is_parent AS "isParent",c.active,CASE WHEN ${Boolean(t.isGroupAdmin)} THEN 'group_admin' ELSE m.role END AS role FROM companies c LEFT JOIN memberships m ON m.company_id=c.id AND m.organization_id=c.organization_id AND m.user_id=${t.userId} AND m.active WHERE c.organization_id=${t.organizationId} AND c.active AND (${Boolean(t.isGroupAdmin)} OR m.user_id IS NOT NULL) ORDER BY c.is_parent DESC,c.short_name,c.name`;
}
export async function requireAssignee(t: Tenant, userId: string | null) {
  if (!userId) return;
  const [user] =
    await sql`SELECT u.id FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.organization_id=u.organization_id AND m.company_id=${t.companyId} AND m.active WHERE u.id=${userId} AND u.organization_id=${t.organizationId} AND u.active AND (u.group_role='group_admin' OR m.user_id IS NOT NULL)`;
  if (!user)
    throw httpError(400, 'O responsável não tem acesso ativo a esta empresa.');
}
export async function authorizeBackground(t: Tenant, permission: string) {
  if (t.authKind === 'api_token') {
    const [token] =
      await sql`SELECT scopes FROM api_tokens WHERE id=${t.apiTokenId || null} AND company_id=${t.companyId} AND organization_id=${t.organizationId} AND active AND (expires_at IS NULL OR expires_at>now())`;
    if (!token)
      throw new Error('Credencial que originou o trabalho foi revogada.');
    t = { ...t, scopes: token.scopes as string[] };
  }
  const [user] =
    await sql`SELECT u.group_role,m.role FROM users u JOIN companies c ON c.id=${t.companyId} AND c.organization_id=u.organization_id AND c.active LEFT JOIN memberships m ON m.user_id=u.id AND m.company_id=c.id AND m.organization_id=u.organization_id AND m.active WHERE u.id=${t.userId} AND u.organization_id=${t.organizationId} AND u.active AND (u.group_role='group_admin' OR m.user_id IS NOT NULL)`;
  if (!user) throw new Error('Acesso que originou o trabalho foi revogado.');
  const currentPermissions = await membershipPermissions(
    t.userId,
    t.companyId,
    t.organizationId,
    user.role,
  );
  if (t.authKind === 'api_token' && user.group_role !== 'group_admin') {
    if (!currentPermissions.includes('integrations:manage'))
      throw new Error('Acesso da integração revogado.');
    t = {
      ...t,
      scopes: (t.scopes ?? []).filter((p) => currentPermissions.includes(p)),
    };
  }
  requirePermission(
    {
      ...t,
      // Internal notifications are consequences of a previously authorized job.
      // The original credential and current membership were revalidated above.
      ...(permission === 'company:read'
        ? { authKind: 'session' as const }
        : {}),
      permissions: currentPermissions,
      role: user.group_role === 'group_admin' ? 'group_admin' : user.role,
      isGroupAdmin: user.group_role === 'group_admin',
    },
    permission,
  );
}

const requestTenants = new WeakMap<FastifyRequest, Tenant>();
export async function authenticate(request: FastifyRequest): Promise<Tenant> {
  const existing = requestTenants.get(request);
  if (existing) return existing;
  const tenant = await resolveAuthentication(request);
  requestTenants.set(request, tenant);
  return tenant;
}
