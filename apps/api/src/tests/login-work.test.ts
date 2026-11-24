import { expect, it, vi, afterAll } from 'vitest';
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, scryptSync: vi.fn(actual.scryptSync) };
});
import { scryptSync } from 'node:crypto';
import {
  hashPassword,
  verifyLoginCredentials,
} from '../modules/identity/index.js';
import { sql, drizzleClient } from '../core/db.js';
const regular = 'Legitimate-password-123',
  temporary = 'Temporary-password-123';
const user = {
  active: true,
  password_hash: hashPassword(regular),
  temporary_password_hash: hashPassword(temporary),
  temporary_password_expires_at: new Date(Date.now() + 60000),
};

afterAll(async () => {
  await sql.end();
  await drizzleClient.end();
});

it('does two expensive verifications for missing, inactive, normal and temporary-reset accounts', () => {
  for (const candidate of [
    undefined,
    { ...user, active: false },
    { ...user, temporary_password_hash: null },
    user,
    { ...user, temporary_password_expires_at: new Date(0) },
  ]) {
    vi.mocked(scryptSync).mockClear();
    expect(verifyLoginCredentials('wrong-password', candidate)).toEqual({
      regular: false,
      temporary: false,
    });
    expect(scryptSync).toHaveBeenCalledTimes(2);
  }
});

it('preserves legitimate regular and temporary logins, rejects expired and inactive credentials', () => {
  expect(verifyLoginCredentials(regular, user)).toEqual({
    regular: true,
    temporary: false,
  });
  expect(verifyLoginCredentials(temporary, user)).toEqual({
    regular: false,
    temporary: true,
  });
  expect(
    verifyLoginCredentials(temporary, {
      ...user,
      temporary_password_expires_at: new Date(0),
    }),
  ).toEqual({ regular: false, temporary: false });
  expect(verifyLoginCredentials(regular, { ...user, active: false })).toEqual({
    regular: false,
    temporary: false,
  });
});
