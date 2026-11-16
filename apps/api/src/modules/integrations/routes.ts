import type { FastifyInstance } from 'fastify';
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  createHmac,
} from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { z } from 'zod';
import { sql } from '../../core/db.js';
import { config } from '../../core/config.js';
import {
  authenticate,
  hashToken,
  httpError,
  requirePermission,
} from '../identity/index.js';
const scopes = [
  'opportunities:read',
  'opportunities:write',
  'documents:read',
  'documents:write',
  'bids:read',
  'bids:write',
  'tasks:read',
  'tasks:write',
  'analytics:read',
  'sources:read',
  'sources:sync',
  'company:read',
] as const;
export const webhookEvents = [
  'opportunity.created',
  'opportunity.status_changed',
  'bid.changed',
  'analysis.completed',
] as const;
function encryptionKey() {
  const key = Buffer.from(config.DATA_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32)
    throw httpError(
      409,
      'A criptografia das integrações ainda não foi configurada.',
    );
  return key;
}
export function seal(value: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return [
    nonce.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}
export function unseal(value: string) {
  const [nonce, tag, data] = value.split('.');
  if (!nonce || !tag || !data) throw new Error('Segredo inválido.');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(nonce, 'base64'),
  );
  cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    cipher.update(Buffer.from(data, 'base64')),
    cipher.final(),
  ]).toString('utf8');
}
export function webhookUrl(value: string) {
  const url = new URL(value);
  const hosts = config.WEBHOOK_ALLOWED_HOSTS.split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    isIP(url.hostname) ||
    !hosts.includes(url.hostname.toLowerCase())
  )
    throw httpError(
      400,
      'Destino não autorizado. O administrador deve configurar WEBHOOK_ALLOWED_HOSTS para um host HTTPS público.',
    );
  return url;
}
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('::', 96, 'ipv6');
export function publicAddress(address: string) {
  if (address.startsWith('::ffff:')) return publicAddress(address.slice(7));
  const family = isIP(address);
  return (
    Boolean(family) && !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4')
  );
}
export async function deliverWebhook(id: string) {
  const [delivery] =
    await sql`SELECT d.*,w.url,w.secret_encrypted,w.active FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id AND w.organization_id=d.organization_id AND w.company_id=d.company_id WHERE d.id=${id}`;
  if (!delivery || !delivery.active) return { skipped: true };
  if (delivery.status === 'delivered') return { cached: true };
  const url = webhookUrl(delivery.url);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some((item) => !publicAddress(item.address))
  )
    throw new Error('Destino do webhook resolve para endereço não público.');
  const address = addresses[0]!;
  const body = JSON.stringify(delivery.payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', unseal(delivery.secret_encrypted))
    .update(timestamp + '.' + body)
    .digest('hex');
  await sql`UPDATE webhook_deliveries SET attempts=attempts+1,status='sending' WHERE id=${id}`;
  try {
    await new Promise<void>((resolve, reject) => {
      const request = httpsRequest(
        {
          hostname: address.address,
          port: 443,
          servername: url.hostname,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            Host: url.host,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'X-NTHUB-Event': delivery.event_type,
            'X-NTHUB-Delivery': id,
            'X-NTHUB-Timestamp': timestamp,
            'X-NTHUB-Signature': 'sha256=' + signature,
          },
        },
        (response) => {
          response.resume();
          if (
            response.statusCode &&
            response.statusCode >= 200 &&
            response.statusCode < 300
          )
            resolve();
          else
            reject(new Error('Webhook respondeu HTTP ' + response.statusCode));
        },
      );
      request.setTimeout(15000, () =>
        request.destroy(new Error('Tempo limite do webhook.')),
      );
      request.on('error', reject);
      request.end(body);
    });
    await sql`UPDATE webhook_deliveries SET status='delivered',error=NULL,delivered_at=now() WHERE id=${id}`;
    return { ok: true };
  } catch (error) {
    await sql`UPDATE webhook_deliveries SET status='failed',error=${error instanceof Error ? error.message : 'Falha de entrega'} WHERE id=${id}`;
    throw error;
  }
}
export async function integrationRoutes(app: FastifyInstance) {
  app.get('/api/v1/integrations/status', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'integrations:read');
    return {
      smtpConfigured: Boolean(config.SMTP_HOST),
      storageConfigured: Boolean(config.S3_ENDPOINT && config.S3_BUCKET),
      oidcConfigured: Boolean(config.OIDC_ISSUER && config.OIDC_CLIENT_ID),
      webhookHosts: config.WEBHOOK_ALLOWED_HOSTS.split(',').filter(Boolean),
      geminiConfigured: Boolean(config.GEMINI_API_KEY),
    };
  });
  app.get('/api/v1/integrations/tokens', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'integrations:read');
    return sql`SELECT id,name,scopes,active,last_used_at AS "lastUsedAt",expires_at AS "expiresAt",created_at AS "createdAt" FROM api_tokens WHERE organization_id=${t.organizationId} AND company_id=${t.companyId} ORDER BY created_at DESC`;
  });
  app.post('/api/v1/integrations/tokens', async (req, reply) => {
    const t = await authenticate(req);
    requirePermission(t, 'integrations:manage');
    const body = z
      .object({
        name: z.string().trim().min(2).max(100),
        scopes: z.array(z.enum(scopes)).min(1).max(scopes.length),
        expiresAt: z.iso.datetime({ offset: true }),
      })
      .parse(req.body);
    if (
      Date.parse(body.expiresAt) <= Date.now() ||
      Date.parse(body.expiresAt) > Date.now() + 366 * 86400000
    )
      throw httpError(400, 'A validade deve estar entre agora e um ano.');
    for (const scope of body.scopes) requirePermission(t, scope);
    const id = randomUUID(),
      token = 'nth_' + randomBytes(32).toString('hex');
    await sql.begin(async (tx) => {
      await tx`INSERT INTO api_tokens(id,organization_id,company_id,name,token_hash,scopes,created_by,expires_at) VALUES(${id},${t.organizationId},${t.companyId},${body.name},${hashToken(token)},${tx.json([...new Set(body.scopes)])},${t.userId},${body.expiresAt})`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'integration:token-created',${id})`;
    });
    return reply.code(201).send({ id, token });
  });
  app.patch('/api/v1/integrations/tokens/:id/revoke', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'integrations:manage');
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const rows =
      await sql`UPDATE api_tokens SET active=false WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} RETURNING id`;
    if (!rows.length) throw httpError(404, 'Credencial não encontrada.');
    return { ok: true };
  });
  app.get('/api/v1/integrations/webhooks', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'integrations:read');
    return sql`SELECT id,name,url,events,active,created_at AS "createdAt" FROM webhooks WHERE organization_id=${t.organizationId} AND company_id=${t.companyId} ORDER BY created_at DESC`;
  });
  app.post('/api/v1/integrations/webhooks', async (req, reply) => {
    const t = await authenticate(req);
    requirePermission(t, 'integrations:manage');
    const body = z
      .object({
        name: z.string().trim().min(2).max(100),
        url: z.url(),
        events: z.array(z.enum(webhookEvents)).min(1),
      })
      .parse(req.body);
    const url = webhookUrl(body.url);
    const secret = randomBytes(32).toString('hex'),
      id = randomUUID();
    await sql`INSERT INTO webhooks(id,organization_id,company_id,name,url,secret_encrypted,events) VALUES(${id},${t.organizationId},${t.companyId},${body.name},${url.href},${seal(secret)},${sql.json([...new Set(body.events)])})`;
    return reply.code(201).send({ id, secret });
  });
  app.patch('/api/v1/integrations/webhooks/:id', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'integrations:manage');
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const rows =
      await sql`UPDATE webhooks SET active=${active} WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} RETURNING id`;
    if (!rows.length) throw httpError(404, 'Webhook não encontrado.');
    return { ok: true };
  });
  app.get('/api/v1/integrations/deliveries', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'integrations:read');
    return sql`SELECT id,event_type AS "eventType",status,attempts,error,delivered_at AS "deliveredAt",created_at AS "createdAt" FROM webhook_deliveries WHERE organization_id=${t.organizationId} AND company_id=${t.companyId} ORDER BY created_at DESC LIMIT 100`;
  });
  app.post('/api/v1/integrations/deliveries/:id/retry', async (req) => {
    const t = await authenticate(req);
    requirePermission(t, 'integrations:manage');
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [delivery] =
      await sql`SELECT id FROM webhook_deliveries WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND status='failed'`;
    if (!delivery) throw httpError(409, 'Entrega com falha não encontrada.');
    await sql`INSERT INTO outbox(id,type,payload) VALUES(${randomUUID()},'webhook.deliver',${sql.json({ tenant: t, deliveryId: id })})`;
    return { ok: true };
  });
}
