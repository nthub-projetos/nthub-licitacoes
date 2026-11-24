import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../modules/identity/reset-mail.js', () => ({
  sendTemporaryPassword: vi.fn(),
}));
import { sendTemporaryPassword } from '../modules/identity/reset-mail.js';
import { buildApp } from '../app.js';
import { sql, drizzleClient } from '../core/db.js';
import { queue } from '../core/queue.js';
import { hashPassword } from '../modules/identity/index.js';

const org = randomUUID(),
  company = randomUUID(),
  user = randomUUID();
const email = `${user}@example.invalid`,
  original = 'Original-password-123';
const app = await buildApp();
const send = vi.mocked(sendTemporaryPassword);
let ip = 0;
const request = (
  method: 'GET' | 'POST',
  url: string,
  payload?: object,
  cookie = '',
) =>
  app.inject({
    method,
    url: '/api/v1' + url,
    ...(payload ? { payload } : {}),
    remoteAddress: `127.0.1.${ip}`,
    headers: { 'x-nthub-request': '1', cookie },
  });
const forgot = (address = email) =>
  request('POST', '/auth/forgot-password', { email: address });
const login = (password: string) =>
  request('POST', '/auth/login', { email, password });
const sessionCookie = (r: { headers: Record<string, unknown> }) =>
  String(r.headers['set-cookie']).split(';')[0]!;
const temporary = () => send.mock.calls.at(-1)![1];
const complete = (cookie: string, password = 'New-password-123456') =>
  request(
    'POST',
    '/auth/password-reset/complete',
    { newPassword: password, confirmPassword: password },
    cookie,
  );

beforeAll(async () => {
  await sql`INSERT INTO organizations VALUES(${org},'Password reset test')`;
  await sql`INSERT INTO companies(id,organization_id,name,capabilities) VALUES(${company},${org},'Reset test',${sql.json([])})`;
  await sql`INSERT INTO users(id,organization_id,company_id,email,password_hash) VALUES(${user},${org},${company},${email},${hashPassword(original)})`;
  await sql`INSERT INTO memberships(user_id,organization_id,company_id,role) VALUES(${user},${org},${company},'analyst')`;
});
beforeEach(async () => {
  ip++;
  send.mockReset();
  send.mockResolvedValue(undefined);
  await sql`DELETE FROM sessions WHERE user_id=${user}`;
  await sql`UPDATE users SET active=true,password_hash=${hashPassword(original)},temporary_password_hash=NULL,temporary_password_expires_at=NULL,password_reset_requested_at=NULL,reset_used_password_hash=NULL WHERE id=${user}`;
});
afterAll(async () => {
  await app.close();
  await queue.close();
  await sql`DELETE FROM audit_logs WHERE organization_id=${org}`;
  await sql`DELETE FROM sessions WHERE user_id=${user}`;
  await sql`DELETE FROM memberships WHERE organization_id=${org}`;
  await sql`DELETE FROM users WHERE organization_id=${org}`;
  await sql`DELETE FROM companies WHERE organization_id=${org}`;
  await sql`DELETE FROM organizations WHERE id=${org}`;
  await sql.end();
  await drizzleClient.end();
});

it('returns the same message for active, unknown and inactive accounts; only emails the active account', async () => {
  const existing = await forgot(email.toUpperCase());
  const unknown = await forgot('unknown@example.invalid');
  await sql`UPDATE users SET active=false WHERE id=${user}`;
  const inactive = await forgot();
  expect(existing.statusCode).toBe(200);
  expect(existing.json()).toEqual(unknown.json());
  expect(existing.json()).toEqual(inactive.json());
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0]).toBe(email);
});

it('stores only a hash, limits repeated sends and keeps the old password valid until completion', async () => {
  await forgot();
  await forgot();
  expect(send).toHaveBeenCalledTimes(1);
  const [row] =
    await sql`SELECT temporary_password_hash FROM users WHERE id=${user}`;
  expect(row?.temporary_password_hash).not.toBe(temporary());
  expect((await login(original)).json().passwordChangeRequired).toBe(false);
});

it('requires a new password, survives reload, blocks business APIs and consumes the temporary password once', async () => {
  await forgot();
  const result = await login(temporary());
  expect(result.statusCode).toBe(200);
  expect(result.json().passwordChangeRequired).toBe(true);
  const cookie = sessionCookie(result);
  expect(
    (
      await request('GET', '/auth/password-reset/status', undefined, cookie)
    ).json().passwordChangeRequired,
  ).toBe(true);
  for (const path of ['/me', '/opportunities', '/companies'])
    expect((await request('GET', path, undefined, cookie)).statusCode).toBe(
      401,
    );
  expect((await login(temporary())).statusCode).toBe(401);
  expect((await complete(cookie, temporary())).statusCode).toBe(400);
  expect((await complete(cookie, original)).statusCode).toBe(400);
  expect((await complete(cookie)).statusCode).toBe(200);
  expect((await login(original)).statusCode).toBe(401);
  const normal = await login('New-password-123456');
  expect(normal.statusCode).toBe(200);
  expect(normal.json().passwordChangeRequired).toBe(false);
  expect(
    (await request('GET', '/me', undefined, sessionCookie(normal))).statusCode,
  ).toBe(200);
  expect((await complete(cookie)).statusCode).toBe(401);
});

it('rejects expired passwords and expired restricted sessions', async () => {
  await forgot();
  await sql`UPDATE users SET temporary_password_expires_at=now()-interval '1 second' WHERE id=${user}`;
  expect((await login(temporary())).statusCode).toBe(401);
  await sql`UPDATE users SET temporary_password_expires_at=now()+interval '10 minutes' WHERE id=${user}`;
  const r = await login(temporary());
  await sql`UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=${user}`;
  expect((await complete(sessionCookie(r))).statusCode).toBe(401);
});

it('does not alter credentials on SMTP failure or disclose that failure as account existence', async () => {
  send.mockRejectedValueOnce(new Error('SMTP unavailable'));
  const result = await forgot();
  expect(result.statusCode).toBe(200);
  const [row] =
    await sql`SELECT temporary_password_hash FROM users WHERE id=${user}`;
  expect(row?.temporary_password_hash).toBeNull();
  expect((await login(original)).statusCode).toBe(200);
});

it('rejects mismatched/short passwords and completion without a restricted session', async () => {
  await forgot();
  const cookie = sessionCookie(await login(temporary()));
  expect(
    (
      await request(
        'POST',
        '/auth/password-reset/complete',
        {
          newPassword: 'New-password-123456',
          confirmPassword: 'Different-password-123',
        },
        cookie,
      )
    ).statusCode,
  ).toBe(400);
  expect((await complete(cookie, 'short')).statusCode).toBe(400);
  expect(
    (await complete(sessionCookie(await login(original)))).statusCode,
  ).toBe(401);
  expect((await complete('')).statusCode).toBe(401);
});

it('invalidates existing sessions on completion and records an audit without secrets', async () => {
  const oldCookie = sessionCookie(await login(original));
  await forgot();
  const cookie = sessionCookie(await login(temporary()));
  expect((await complete(cookie)).statusCode).toBe(200);
  expect((await request('GET', '/me', undefined, oldCookie)).statusCode).toBe(
    401,
  );
  const [audit] =
    await sql`SELECT details FROM audit_logs WHERE user_id=${user} AND action='profile:password-reset'`;
  expect(audit).toBeDefined();
  expect(JSON.stringify(audit)).not.toContain(temporary());
});

it('replaces a previous temporary password and invalidates an unfinished reset session on resend', async () => {
  await forgot();
  const first = temporary();
  const cookie = sessionCookie(await login(first));
  await sql`UPDATE users SET password_reset_requested_at=now()-interval '2 minutes' WHERE id=${user}`;
  await forgot();
  expect((await complete(cookie)).statusCode).toBe(401);
  expect((await login(first)).statusCode).toBe(401);
  expect((await login(temporary())).statusCode).toBe(200);
});
