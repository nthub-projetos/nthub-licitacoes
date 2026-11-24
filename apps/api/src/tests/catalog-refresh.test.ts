import { afterAll, beforeAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
vi.mock('../modules/sources/http-store.js', () => ({
  httpStore: {
    reserve: async () => 0,
    cooldown: async () => {},
    get: async () => null,
    put: async () => {},
    lock: async () => true,
    unlock: async () => {},
  },
}));
import { sql, drizzleClient } from '../core/db.js';
import { queue } from '../core/queue.js';
import { buildApp } from '../app.js';
import {
  hashToken,
  hashPassword,
  type Tenant,
} from '../modules/identity/index.js';
import { refreshTrackedOpportunity } from '../modules/sources/refresh.js';
import { runSchedules } from '../modules/sources/scheduler.js';
import { processingIssues } from '../modules/documents/issues.js';
import { opportunityContent } from '../modules/documents/index.js';
import { config } from '../core/config.js';
const org = randomUUID(),
  company = randomUUID(),
  sibling = randomUUID(),
  user = randomUUID(),
  token = randomUUID();
const prefix = 'CATALOG-' + org;
const proc = randomUUID(),
  op = randomUUID();
const sourceId =
  '12345678000199-1-' + Math.floor(Math.random() * 99999999) + '/2026';
const app = await buildApp();
const headers = { cookie: 'session=' + token, 'x-nthub-request': '1' };
const tenant: Tenant = {
  organizationId: org,
  companyId: sibling,
  userId: user,
  email: user + '@example.invalid',
};
beforeAll(async () => {
  await sql`INSERT INTO organizations VALUES(${org},'Catalog tests')`;
  await sql`INSERT INTO companies(id,organization_id,name,capabilities) VALUES(${company},${org},'Catalog','[]'),(${sibling},${org},'Sibling','[]')`;
  await sql`INSERT INTO users(id,organization_id,company_id,email,password_hash,group_role) VALUES(${user},${org},${company},${tenant.email},${hashPassword('test-password-123')},'group_admin')`;
  await sql`INSERT INTO sessions(token_hash,user_id,active_company_id,expires_at) VALUES(${hashToken(token)},${user},${company},now()+interval '1 hour')`;
  await sql`INSERT INTO procurements(id,source_id,title,agency,value,deadline,source_url,raw) SELECT gen_random_uuid(),${prefix}||g,'Catalog item '||g,'Test',100,CASE WHEN g=1 THEN now()-interval '2 days' WHEN g=2 THEN NULL ELSE now()+interval '5 days' END,'https://pncp.gov.br','{}' FROM generate_series(1,1005) g`;
  await sql`INSERT INTO opportunities(id,organization_id,company_id,procurement_id,score,matches,processing_state) SELECT gen_random_uuid(),${org},${company},id,10,'[]','ready' FROM procurements WHERE source_id LIKE ${prefix + '%'}`;
  await sql`INSERT INTO procurements(id,source_id,title,agency,value,deadline,source_url,raw) VALUES(${proc},${sourceId},'Old title','Test',300,now()-interval '2 days','https://pncp.gov.br','{}')`;
  await sql`INSERT INTO opportunities(id,organization_id,company_id,procurement_id,status,score,matches,processing_state) VALUES(${op},${org},${sibling},${proc},'review',10,'[]','ready')`;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await queue.close();
  await sql`DELETE FROM collection_schedules WHERE organization_id=${org}`;
  await sql`DELETE FROM outbox WHERE payload->'tenant'->>'organizationId'=${org}`;
  await sql`DELETE FROM audit_logs WHERE organization_id=${org}`;
  await sql`DELETE FROM documents WHERE organization_id=${org}`;
  await sql`DELETE FROM opportunities WHERE organization_id=${org}`;
  await sql`DELETE FROM procurements WHERE source_id LIKE ${prefix + '%'} OR id=${proc}`;
  await sql`DELETE FROM sessions WHERE user_id=${user}`;
  await sql`DELETE FROM users WHERE organization_id=${org}`;
  await sql`DELETE FROM companies WHERE organization_id=${org}`;
  await sql`DELETE FROM organizations WHERE id=${org}`;
  await sql.end();
  await drizzleClient.end();
});
it('paginates beyond 1000, searches across all records, rejects invalid input and isolates companies', async () => {
  const result = await app.inject({
    url: '/api/v1/opportunities/page?page=11&pageSize=100',
    headers,
  });
  expect(result.statusCode).toBe(200);
  expect(result.json().total).toBe(1005);
  expect(result.json().items).toHaveLength(5);
  const search = await app.inject({
    url: '/api/v1/opportunities/page?search=Catalog%20item%201005',
    headers,
  });
  expect(search.json().total).toBe(1);
  expect(search.json().items[0].title).toBe('Catalog item 1005');
  expect(
    (
      await app.inject({
        url: '/api/v1/opportunities/page?pageSize=101',
        headers,
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        url: '/api/v1/opportunities/page',
        headers: { ...headers, 'x-company-id': sibling },
      })
    ).json().total,
  ).toBe(1);
  expect(
    (
      await app.inject({
        url: '/api/v1/opportunities/' + op,
        headers: { ...headers, 'x-company-id': company },
      })
    ).statusCode,
  ).toBe(404);
});
it('separates expired and unknown deadlines from active pipeline without losing their stages', async () => {
  const result = await app.inject({
    url: '/api/v1/opportunities/page?deadline=expired',
    headers,
  });
  expect(result.json().total).toBe(1);
  expect(result.json().items[0].deadlineState).toBe('expired');
  expect(result.json().items[0].status).toBe('new');
  expect(result.json().summary.active).toBe(1003);
  expect(Number(result.json().summary.estimatedPipeline)).toBe(100300);
  expect(result.json().summary.expired).toBe(1);
  expect(result.json().summary.unknownDeadline).toBe(1);
  const group = await app.inject({ url: '/api/v1/analytics/group', headers });
  expect(Number(group.json().totals.estimatedPipeline)).toBe(100300);
  expect(group.json().totals.expired).toBe(2);
});
it('refreshes a notice outside the publication window, preserves CRM stage and flags changed information', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      if (path.endsWith('/arquivos')) return Response.json([]);
      if (path.includes('/itens?')) return Response.json([]);
      return Response.json({
        objetoCompra: 'Updated notice',
        orgaoEntidade: { razaoSocial: 'Test' },
        valorTotalEstimado: 500,
        dataEncerramentoProposta: '2035-01-01T12:00:00Z',
      });
    }),
  );
  const result = await refreshTrackedOpportunity(tenant, op);
  expect(result.changed).toBe(true);
  expect((await refreshTrackedOpportunity(tenant, op)).changed).toBe(false);
  const [row] =
    await sql`SELECT o.status,o.source_changed_at,o.source_checked_at,p.title,p.deadline FROM opportunities o JOIN procurements p ON p.id=o.procurement_id WHERE o.id=${op}`;
  expect(row?.status).toBe('review');
  expect(row?.title).toBe('Updated notice');
  expect(row?.source_changed_at).toBeTruthy();
  expect(row?.source_checked_at).toBeTruthy();
  expect(new Date(row?.deadline).getUTCFullYear()).toBe(2035);
  const content = await opportunityContent(tenant, op);
  expect(content.issues.some((i) => i.kind === 'missing')).toBe(true);
  expect(
    (
      await sql`SELECT count(*)::int AS n FROM outbox WHERE type='analyze' AND payload->'tenant'->>'organizationId'=${org}`
    )[0]?.n,
  ).toBe(0);
});
it('schedules reconciliation at the configured frequency and does not enqueue it again in the same cycle', async () => {
  await sql`INSERT INTO collection_schedules(id,organization_id,company_id,enabled,interval_minutes,modalities,ufs,lookback_days,next_run_at,created_by,sources) VALUES(${randomUUID()},${org},${sibling},true,360,'[6]','[]',2,now()-interval '1 second',${user},'["pncp"]')`;
  await runSchedules();
  await runSchedules();
  const [row] =
    await sql`SELECT count(*)::int AS n FROM outbox WHERE type='refresh' AND payload->>'opportunityId'=${op}`;
  expect(row?.n).toBe(1);
  const [schedule] =
    await sql`SELECT extract(epoch FROM(next_run_at-now())) AS remaining FROM collection_schedules WHERE company_id=${sibling}`;
  expect(Number(schedule?.remaining)).toBeGreaterThan(21590);
});
it('provides distinct explanations and actions for each processing issue', () => {
  expect(processingIssues('queued', []).map((i) => i.kind)).toEqual([
    'pending',
  ]);
  expect(processingIssues('ready', []).map((i) => i.kind)).toEqual(['missing']);
  expect(
    processingIssues('partial', [
      { extractionStatus: 'failed' },
      { extractionStatus: 'needs_ocr' },
      { extractionStatus: 'unsupported' },
    ]).map((i) => i.kind),
  ).toEqual(['failed', 'needs_ocr', 'unsupported']);
});
it('uses distinct client IPs only through the configured trusted proxy', async () => {
  const previous = config.TRUSTED_PROXY_CIDRS;
  config.TRUSTED_PROXY_CIDRS = '127.0.0.1';
  const proxyApp = await buildApp();
  config.TRUSTED_PROXY_CIDRS = previous;
  try {
    for (let i = 0; i < 10; i++)
      expect(
        (
          await proxyApp.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            remoteAddress: '127.0.0.1',
            headers: { 'x-nthub-request': '1', 'x-forwarded-for': '192.0.2.1' },
            payload: { email: 'invalid@example.invalid', password: 'invalid' },
          })
        ).statusCode,
      ).toBe(401);
    expect(
      (
        await proxyApp.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: '127.0.0.1',
          headers: { 'x-nthub-request': '1', 'x-forwarded-for': '192.0.2.2' },
          payload: { email: 'invalid@example.invalid', password: 'invalid' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await proxyApp.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          remoteAddress: '127.0.0.1',
          headers: { 'x-nthub-request': '1', 'x-forwarded-for': '192.0.2.1' },
          payload: { email: 'invalid@example.invalid', password: 'invalid' },
        })
      ).statusCode,
    ).toBe(429);
  } finally {
    await proxyApp.close();
  }
});
