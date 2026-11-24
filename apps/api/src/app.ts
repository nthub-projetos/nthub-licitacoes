import { oidcRoutes } from './modules/identity/oidc.js';
import { opportunityPage } from './modules/opportunities/catalog.js';
import { passwordResetRoutes } from './modules/identity/password-reset.js';
import { loadBlob } from './core/storage.js';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { transferRoutes } from './modules/organizations/transfers.js';
import { permissionRoutes } from './modules/organizations/permissions.js';
import { organizationRoutes } from './modules/organizations/routes.js';
import { workflowRoutes } from './modules/workflow/routes.js';
import { sourceRoutes } from './modules/sources/routes.js';
import { integrationRoutes } from './modules/integrations/routes.js';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { z, ZodError } from 'zod';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { sql } from './core/db.js';
import { config } from './core/config.js';
import { queue } from './core/queue.js';
import {
  authenticate,
  hashToken,
  verifyLoginCredentials,
  accessibleCompanies,
  requirePermission,
  requireGroupAdmin,
  httpError,
} from './modules/identity/index.js';
import {
  listOpportunities,
  requireOpportunity,
} from './modules/opportunities/index.js';
import { statusSchema, syncSchema } from '@nthub/contracts';
import {
  enqueueEnrichment,
  opportunityContent,
} from './modules/documents/index.js';
const idSchema = z.object({ id: z.uuid() });
export async function buildApp() {
  const app = Fastify({
    trustProxy: config.TRUSTED_PROXY_CIDRS.split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    logger: {
      redact: [
        'req.headers.cookie',
        'req.headers.authorization',
        'password',
        'token',
      ],
    },
    bodyLimit: 1024 * 1024,
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'NTHUB Licitações',
        version: '1.0.0',
        description:
          'API multiempresa. Sessão HttpOnly ou Bearer com escopos; mutações exigem X-NTHub-Request: 1.',
      },
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'session' },
          bearer: { type: 'http', scheme: 'bearer' },
        },
      },
      security: [{ session: [] }, { bearer: [] }],
    },
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers['x-nthub-request'] !== '1'
    )
      throw Object.assign(new Error('Origem da requisição inválida.'), {
        statusCode: 403,
      });
  });
  app.addHook('preHandler', async (req) => {
    const path = req.url.split('?')[0] || '';
    if (
      !path.startsWith('/api/') ||
      [
        '/api/v1/health',
        '/api/v1/auth/login',
        '/api/v1/auth/forgot-password',
        '/api/v1/auth/password-reset/status',
        '/api/v1/auth/password-reset/complete',
        '/api/v1/auth/options',
        '/api/v1/auth/oidc/start',
        '/api/v1/auth/oidc/callback',
        '/api/v1/auth/logout',
        '/api/v1/auth/invitation/inspect',
        '/api/v1/auth/invitation/accept',
      ].includes(path)
    )
      return;
    const t = await authenticate(req);
    if (
      t.authKind === 'session' &&
      ['/api/v1/me', '/api/v1/companies', '/api/v1/companies/switch'].includes(
        path,
      )
    )
      return;
    if (req.method === 'GET' && /^\/api\/v1\/jobs\/[0-9a-f-]+$/.test(path))
      return;
    if (path.startsWith('/api/v1/permissions')) {
      requireGroupAdmin(t);
      return;
    }
    let area = 'company';
    if (/\/opportunities/.test(path)) area = 'opportunities';
    else if (/\/(documents|files)/.test(path)) area = 'documents';
    else if (/\/bids/.test(path)) area = 'bids';
    else if (/\/tasks/.test(path)) area = 'tasks';
    else if (/\/(sources|jobs)/.test(path)) area = 'sources';
    else if (/\/members/.test(path)) area = 'members';
    else if (/\/analytics/.test(path)) area = 'analytics';
    else if (/\/notifications/.test(path)) area = 'notifications';
    else if (/\/integrations/.test(path)) area = 'integrations';
    else if (/\/audit/.test(path)) area = 'audit';
    else if (/\/exports/.test(path)) area = 'exports';
    else if (/\/saved-searches/.test(path)) area = 'searches';
    else if (/\/profile/.test(path)) area = 'profile';
    const read = ['GET', 'HEAD'].includes(req.method);
    const permission =
      area +
      ':' +
      (read
        ? 'read'
        : area === 'sources'
          ? path.endsWith('/sync')
            ? 'sync'
            : 'manage'
          : ['company', 'members', 'integrations'].includes(area)
            ? 'manage'
            : 'write');
    if (path === '/api/v1/companies/switch') return;
    requirePermission(t, permission);
    if (path.endsWith('/analyses') && !read)
      requirePermission(t, 'intelligence:run');
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({ message: 'Dados inválidos.', issues: error.issues });
    const e = error as Error & { statusCode?: number };
    const code = (e as Error & { code?: string }).code;
    const status =
      e.statusCode || (code === '23505' ? 409 : code === '23503' ? 400 : 500);
    if (code === '23505')
      return reply
        .code(409)
        .send({ message: 'Já existe um cadastro com esses dados.' });
    if (code === '23503')
      return reply.code(400).send({
        message: 'O cadastro relacionado não é válido neste ambiente.',
      });
    if (status >= 500) req.log.error({ err: e }, 'Request failed');
    return reply.code(status).send({
      message:
        status >= 500
          ? 'Não foi possível concluir a operação. Consulte os logs do servidor.'
          : e.message,
    });
  });
  await oidcRoutes(app);
  await passwordResetRoutes(app);
  app.get('/api/v1/health', async () => {
    await sql`SELECT 1`;
    await queue.waitUntilReady();
    return { status: 'ok' };
  });
  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z
        .object({ email: z.email(), password: z.string().min(1).max(256) })
        .parse(req.body);
      const token = randomBytes(32).toString('hex');
      const passwordChangeRequired = await sql.begin(async (tx) => {
        const [user] =
          await tx`SELECT * FROM users WHERE email=${body.email.toLowerCase()} FOR UPDATE`;
        const { regular, temporary } = verifyLoginCredentials(
          body.password,
          user as Parameters<typeof verifyLoginCredentials>[1],
        );
        if (!user || !user.active || (!regular && !temporary))
          throw httpError(401, 'E-mail ou senha inválidos.');
        const [firstCompany] =
          await tx`SELECT c.id FROM companies c LEFT JOIN memberships m ON m.company_id=c.id AND m.organization_id=c.organization_id AND m.user_id=${user.id} AND m.active WHERE c.organization_id=${user.organization_id} AND c.active AND (${user.group_role === 'group_admin'} OR m.user_id IS NOT NULL) ORDER BY (c.id=${user.company_id}) DESC,c.is_parent DESC,c.name LIMIT 1`;
        if (!firstCompany)
          throw httpError(
            403,
            'Nenhum ambiente está autorizado para este usuário.',
          );
        if (temporary) {
          await tx`DELETE FROM sessions WHERE user_id=${user.id} AND password_reset_only`;
          await tx`UPDATE users SET reset_used_password_hash=temporary_password_hash,temporary_password_hash=NULL,temporary_password_expires_at=NULL WHERE id=${user.id}`;
        }
        await tx`INSERT INTO sessions(token_hash,user_id,expires_at,active_company_id,password_reset_only) VALUES(${hashToken(token)},${user.id},now()+(${temporary ? 900 : 43200}*interval '1 second'),${firstCompany.id},${Boolean(temporary)})`;
        return Boolean(temporary);
      });
      reply.setCookie('session', token, {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: passwordChangeRequired ? 900 : 43200,
      });
      return { ok: true, passwordChangeRequired };
    },
  );
  app.post('/api/v1/auth/logout', async (req, reply) => {
    if (req.cookies.session)
      await sql`DELETE FROM sessions WHERE token_hash=${hashToken(req.cookies.session)}`;
    reply.clearCookie('session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/v1/me', async (req) => {
    const t = await authenticate(req);
    const companies = await accessibleCompanies(t);
    return {
      ...t,
      company: companies.find((c) => c.id === t.companyId),
      companies,
      geminiConfigured: Boolean(config.GEMINI_API_KEY),
    };
  });
  app.get('/api/v1/opportunities', async (req) =>
    listOpportunities(await authenticate(req)),
  );
  app.get('/api/v1/opportunities/page', async (req) =>
    opportunityPage(await authenticate(req), req.query),
  );
  app.get('/api/v1/opportunities/:id', async (req) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    await requireOpportunity(t, id);
    const { sql: q } = await import('drizzle-orm');
    const rows = await listOpportunities(t, {
      where: q`o.id=${id} AND o.organization_id=${t.organizationId} AND o.company_id=${t.companyId}`,
      limit: 1,
      offset: 0,
    });
    return rows[0];
  });
  app.patch('/api/v1/opportunities/:id/status', async (req) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    const { status, reason } = z
      .object({
        status: statusSchema,
        reason: z.string().trim().max(3000).optional(),
      })
      .refine(
        (body) => body.status !== 'discarded' || Boolean(body.reason?.trim()),
        { message: 'Informe a justificativa do descarte.', path: ['reason'] },
      )
      .parse(req.body);
    const op = await requireOpportunity(t, id);
    if (
      t.role === 'analyst' &&
      op.assigned_user_id &&
      op.assigned_user_id !== t.userId
    )
      throw httpError(
        403,
        'Esta oportunidade está atribuída a outro funcionário.',
      );
    await sql.begin(async (tx) => {
      await tx`UPDATE opportunities SET status=${status},decision_reason=${reason || null},updated_at=now() WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},${'status:' + status},${id},${tx.json({ from: op.status, to: status, reason: reason || null, previousReason: op.decision_reason })})`;
      await tx`INSERT INTO outbox(id,type,payload) VALUES(${randomUUID()},'domain.event',${tx.json({ tenant: t, event: 'opportunity.status_changed', resourceId: id, data: { from: op.status, to: status, reason: reason || null } })})`;
    });
    return { ok: true };
  });
  app.post('/api/v1/sources/pncp/sync', async (req, reply) => {
    const t = await authenticate(req);
    const input = syncSchema.parse(req.body);
    const id = randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO outbox(id,type,payload) VALUES(${id},'collect',${tx.json({ input, tenant: t })})`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'pncp:sync',${id})`;
    });
    return reply.code(202).send({ jobId: id });
  });
  app.post('/api/v1/sources/sync', async (req, reply) => {
    const t = await authenticate(req);
    requirePermission(t, 'sources:sync');
    const input = syncSchema.parse(req.body),
      id = randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO outbox(id,type,payload) VALUES(${id},'collect',${tx.json({ input, tenant: t })})`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},${input.source + ':sync'},${id})`;
    });
    return reply.code(202).send({ jobId: id });
  });
  app.get('/api/v1/jobs/:id', async (req, reply) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    const [event] =
      await sql`SELECT type,payload FROM outbox WHERE id=${id} AND payload->'tenant'->>'organizationId'=${t.organizationId} AND payload->'tenant'->>'companyId'=${t.companyId}`;
    if (!event)
      return reply.code(404).send({ message: 'Trabalho não encontrado.' });
    requirePermission(
      t,
      event.type === 'analyze'
        ? 'intelligence:run'
        : event.type === 'enrich'
          ? 'opportunities:read'
          : event.type === 'rematch'
            ? 'company:read'
            : 'sources:read',
    );
    const job = await queue.getJob(id);
    const [persisted] =
      await sql`SELECT state,result,error FROM job_runs WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId}`;
    return {
      state: job ? await job.getState() : persisted?.state || 'pending',
      result: job?.returnvalue || persisted?.result,
      error: persisted?.error || job?.failedReason || null,
    };
  });
  app.post('/api/v1/opportunities/:id/document', async (req, reply) => {
    const t = await authenticate(req);
    requirePermission(t, 'documents:write');
    const { id } = idSchema.parse(req.params);
    await requireOpportunity(t, id);
    const file = await req.file();
    if (!file)
      return reply.code(400).send({ message: 'Envie um arquivo PDF.' });
    const data = await file.toBuffer();
    if (data.subarray(0, 5).toString() !== '%PDF-')
      return reply
        .code(400)
        .send({ message: 'Arquivo inválido. Envie um PDF.' });
    const pdf = await getDocument({
      data: new Uint8Array(data),
      useSystemFonts: true,
    }).promise;
    const pages: { page: number; text: string }[] = [];
    try {
      if (pdf.numPages > 300)
        return reply
          .code(400)
          .send({ message: 'Limite de 300 páginas por documento.' });
      let length = 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const text = content.items
          .map((i) => ('str' in i ? i.str : ''))
          .join(' ');
        length += text.length;
        if (length > 250000)
          return reply
            .code(400)
            .send({ message: 'Limite de 250 mil caracteres por documento.' });
        pages.push({ page: n, text });
      }
    } finally {
      await pdf.destroy();
    }
    if (pages.reduce((n, p) => n + p.text.trim().length, 0) < 80)
      return reply.code(422).send({
        message:
          'PDF sem texto suficiente. Este incremento ainda não executa OCR; envie uma versão pesquisável.',
      });
    const documentId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO documents(id,organization_id,company_id,opportunity_id,name,hash,pages) VALUES(${documentId},${t.organizationId},${t.companyId},${id},${file.filename.slice(0, 200)},${createHash('sha256').update(data).digest('hex')},${tx.json(pages)})`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'document:upload',${documentId})`;
    });
    return { documentId, pages: pages.length };
  });
  app.post('/api/v1/opportunities/:id/analyses', async (req, reply) => {
    const t = await authenticate(req);
    if (t.authKind !== 'session')
      throw httpError(
        403,
        'A análise por IA deve ser solicitada por um usuário no portal.',
      );
    const { id } = idSchema.parse(req.params);
    await requireOpportunity(t, id);
    if (!config.GEMINI_API_KEY)
      return reply.code(409).send({
        message: 'Configure GEMINI_API_KEY no arquivo .env do backend.',
      });
    const jobId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO outbox(id,type,payload) VALUES(${jobId},'analyze',${tx.json({ opportunityId: id, tenant: t, requestedByUser: true })})`;
      await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'analysis:requested',${id},${tx.json({ jobId })})`;
    });
    return reply.code(202).send({ jobId });
  });
  app.get('/api/v1/opportunities/:id/content', async (req) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    return opportunityContent(t, id);
  });
  app.post('/api/v1/opportunities/:id/refresh', async (req, reply) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    const jobId = await enqueueEnrichment(t, id, true);
    return reply.code(202).send({ jobId });
  });
  app.get('/api/v1/documents/:id/file', async (req, reply) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    const [doc] =
      await sql`SELECT content,storage_key,mime,name FROM documents WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND active=true`;
    if (!doc || (!doc.content && !doc.storage_key))
      return reply.code(404).send({ message: 'Documento não encontrado.' });
    await sql`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'document:view',${id})`;
    return reply
      .type(doc.mime)
      .header('Content-Security-Policy', "sandbox; default-src 'none'")
      .header(
        'Content-Disposition',
        `${doc.mime === 'application/pdf' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.name.replace(/[\r\n]/g, ''))}`,
      )
      .send(await loadBlob(doc.content, doc.storage_key));
  });
  app.get('/api/v1/documents/:id/text', async (req, reply) => {
    const t = await authenticate(req);
    const { id } = idSchema.parse(req.params);
    const [doc] =
      await sql`SELECT name,pages,extraction_status AS status FROM documents WHERE id=${id} AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND active=true`;
    if (!doc)
      return reply.code(404).send({ message: 'Documento não encontrado.' });
    await sql`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${t.organizationId},${t.companyId},${t.userId},'document:text-view',${id})`;
    return doc;
  });
  app.get('/api/v1/audit', async (req) => {
    const t = await authenticate(req);
    return sql`SELECT a.action,a.resource_id AS "resourceId",a.created_at AS "createdAt",a.details,u.name AS "userName" FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.organization_id=${t.organizationId} AND a.company_id=${t.companyId} ORDER BY a.created_at DESC LIMIT 100`;
  });
  await organizationRoutes(app);
  await transferRoutes(app);
  await permissionRoutes(app);
  await workflowRoutes(app);
  await sourceRoutes(app);
  await integrationRoutes(app);
  app.get('/api/v1/openapi.json', async () => app.swagger());
  await app.register(swaggerUI, { routePrefix: '/docs' });
  return app;
}
