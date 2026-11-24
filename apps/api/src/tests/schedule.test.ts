import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { sql, drizzleClient } from '../core/db.js';
import { queue } from '../core/queue.js';
import { hashPassword, hashToken } from '../modules/identity/index.js';

const org = randomUUID(), company = randomUUID(), user = randomUUID();
const token = randomUUID();
const app = await buildApp();
const headers = { cookie: `session=${token}`, 'x-nthub-request': '1' };
const settings = {
  sources: ['pncp', 'compras'], enabled: true, intervalMinutes: 360,
  modalities: [4, 6, 8], ufs: [], lookbackDays: 2,
};

beforeAll(async () => {
  await sql`INSERT INTO organizations VALUES(${org},'Schedule test')`;
  await sql`INSERT INTO companies(id,organization_id,name,capabilities) VALUES(${company},${org},'Schedule test',${sql.json([])})`;
  await sql`INSERT INTO users(id,organization_id,company_id,email,password_hash) VALUES(${user},${org},${company},${user + '@example.invalid'},${hashPassword('test-password-123')})`;
  await sql`INSERT INTO memberships(user_id,organization_id,company_id,role) VALUES(${user},${org},${company},'company_manager')`;
  await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${hashToken(token)},${user},now()+interval '1 hour')`;
});

afterAll(async () => {
  await app.close();
  await queue.close();
  await sql`DELETE FROM collection_schedules WHERE organization_id=${org}`;
  await sql`DELETE FROM audit_logs WHERE organization_id=${org}`;
  await sql`DELETE FROM sessions WHERE user_id=${user}`;
  await sql`DELETE FROM memberships WHERE organization_id=${org}`;
  await sql`DELETE FROM users WHERE organization_id=${org}`;
  await sql`DELETE FROM companies WHERE organization_id=${org}`;
  await sql`DELETE FROM organizations WHERE id=${org}`;
  await sql.end();
  await drizzleClient.end();
});

it('waits the configured interval on creation, update and re-enabling without enqueueing collection', async () => {
  for (const enabled of [true, false, true]) {
    const r = await app.inject({ method: 'PUT', url: '/api/v1/sources/schedule', headers, payload: { ...settings, enabled } });
    expect(r.statusCode).toBe(200);
    const [row] = await sql`SELECT enabled,extract(epoch FROM (next_run_at-now()))::float8 AS remaining FROM collection_schedules WHERE company_id=${company}`;
    if (!row) throw new Error('Schedule was not saved');
    expect(row.enabled).toBe(enabled);
    expect(row.remaining).toBeGreaterThan(21590);
    expect(row.remaining).toBeLessThanOrEqual(21600);
  }
  const r = await app.inject({ method: 'PUT', url: '/api/v1/sources/schedule', headers, payload: { ...settings, intervalMinutes: 720 } });
  expect(r.statusCode).toBe(200);
  const [row] = await sql`SELECT extract(epoch FROM (next_run_at-now()))::float8 AS remaining FROM collection_schedules WHERE company_id=${company}`;
  if (!row) throw new Error('Schedule was not updated');
  expect(row.remaining).toBeGreaterThan(43190);
  expect(row.remaining).toBeLessThanOrEqual(43200);
  const [jobs] = await sql`SELECT count(*)::int AS count FROM outbox WHERE payload->'tenant'->>'companyId'=${company}`;
  expect(jobs?.count).toBe(0);
});
