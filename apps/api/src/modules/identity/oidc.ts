import type { FastifyInstance } from 'fastify';
import * as oidc from 'openid-client';
import { randomBytes } from 'node:crypto';
import { config } from '../../core/config.js';
import { sql } from '../../core/db.js';
import { seal, unseal } from '../integrations/routes.js';
import { hashToken, httpError } from './index.js';

export const oidcEnabled = () =>
  Boolean(
    config.OIDC_ISSUER &&
    config.OIDC_CLIENT_ID &&
    config.OIDC_ORGANIZATION_ID &&
    config.DATA_ENCRYPTION_KEY,
  );
let discovery: Promise<oidc.Configuration> | undefined;
function provider() {
  if (!oidcEnabled())
    throw httpError(503, 'Acesso corporativo ainda não configurado.');
  if (!config.OIDC_ISSUER.startsWith('https://'))
    throw httpError(503, 'O provedor corporativo exige HTTPS.');
  return (discovery ||= oidc.discovery(
    new URL(config.OIDC_ISSUER),
    config.OIDC_CLIENT_ID,
    config.OIDC_CLIENT_SECRET || undefined,
  ));
}
export async function oidcRoutes(app: FastifyInstance) {
  app.get('/api/v1/auth/options', async () => ({ oidc: oidcEnabled() }));
  app.get('/api/v1/auth/oidc/start', async (_req, reply) => {
    const client = await provider();
    const state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      verifier = oidc.randomPKCECodeVerifier();
    const browser = randomBytes(32).toString('hex');
    await sql`DELETE FROM oidc_states WHERE expires_at<now()`;
    await sql`INSERT INTO oidc_states VALUES(${hashToken(state)},${hashToken(browser)},${seal(JSON.stringify({ verifier, nonce }))},now()+interval '10 minutes')`;
    reply.setCookie('oidc_browser', browser, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth/oidc',
      maxAge: 600,
    });
    const url = oidc.buildAuthorizationUrl(client, {
      redirect_uri: config.APP_URL + '/api/v1/auth/oidc/callback',
      scope: 'openid email',
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
    });
    return reply.redirect(url.href);
  });
  app.get('/api/v1/auth/oidc/callback', async (req, reply) => {
    const url = new URL(req.url, config.APP_URL),
      state = url.searchParams.get('state');
    if (!state || !req.cookies.oidc_browser)
      throw httpError(400, 'Retorno corporativo inválido.');
    const [stored] =
      await sql`DELETE FROM oidc_states WHERE state_hash=${hashToken(state)} AND browser_hash=${hashToken(req.cookies.oidc_browser)} AND expires_at>now() RETURNING encrypted`;
    reply.clearCookie('oidc_browser', { path: '/api/v1/auth/oidc' });
    if (!stored) throw httpError(400, 'A sessão corporativa expirou.');
    const { verifier, nonce } = JSON.parse(unseal(stored.encrypted));
    const tokens = await oidc.authorizationCodeGrant(await provider(), url, {
      pkceCodeVerifier: verifier,
      expectedNonce: nonce,
      expectedState: state,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (
      !claims?.sub ||
      claims.email_verified !== true ||
      typeof claims.email !== 'string'
    )
      throw httpError(403, 'O provedor deve confirmar o e-mail corporativo.');
    const token = randomBytes(32).toString('hex');
    await sql.begin(async (tx) => {
      const [user] =
        await tx`SELECT id,organization_id,company_id,group_role FROM users WHERE email=${claims.email!.toString().toLowerCase()} AND organization_id=${config.OIDC_ORGANIZATION_ID} AND active FOR UPDATE`;
      if (!user)
        throw httpError(
          403,
          'Solicite ao administrador seu cadastro e vínculo com uma empresa.',
        );
      const [binding] =
        await tx`SELECT subject,user_id FROM oidc_identities WHERE issuer=${config.OIDC_ISSUER} AND (subject=${claims.sub} OR user_id=${user.id})`;
      if (
        binding &&
        (binding.subject !== claims.sub || binding.user_id !== user.id)
      )
        throw httpError(403, 'Identidade corporativa divergente do cadastro.');
      const [company] =
        await tx`SELECT c.id FROM companies c LEFT JOIN memberships m ON m.company_id=c.id AND m.user_id=${user.id} AND m.organization_id=c.organization_id AND m.active WHERE c.organization_id=${user.organization_id} AND c.active AND (${user.group_role === 'group_admin'} OR m.user_id IS NOT NULL) ORDER BY c.is_parent DESC,c.name LIMIT 1`;
      if (!company) throw httpError(403, 'Nenhuma empresa autorizada.');
      await tx`INSERT INTO oidc_identities VALUES(${config.OIDC_ISSUER},${claims.sub},${user.id}) ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO sessions(token_hash,user_id,expires_at,active_company_id) VALUES(${hashToken(token)},${user.id},now()+interval '12 hours',${company.id})`;
    });
    reply.setCookie('session', token, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 43200,
    });
    return reply.redirect(config.APP_URL + '/overview');
  });
}
