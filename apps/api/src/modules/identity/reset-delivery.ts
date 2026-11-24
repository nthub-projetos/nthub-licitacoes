import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../../core/db.js';
import { hashPassword } from './index.js';
import { sendTemporaryPassword } from './reset-mail.js';

export async function deliverPasswordReset(input: unknown) {
  const { email } = z.object({ email: z.email().max(254) }).parse(input);
  try {
    await sql.begin(async (tx) => {
      // Serialize sends without locking the users row while SMTP is in flight.
      // Login never takes this advisory lock and cannot observe SMTP latency through it.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'password-reset:' + email.toLowerCase()},0))`;
      const [user] =
        await tx`SELECT id,email,password_hash FROM users WHERE email=${email.toLowerCase()} AND active AND (password_reset_requested_at IS NULL OR password_reset_requested_at<now()-interval '1 minute')`;
      if (!user) return;
      const temporary = randomBytes(18).toString('base64url');
      const hash = hashPassword(temporary);
      await sendTemporaryPassword(user.email, temporary);
      // Do not revive a request if credentials changed or the account was disabled during delivery.
      const updated =
        await tx`UPDATE users SET temporary_password_hash=${hash},temporary_password_expires_at=now()+interval '30 minutes',password_reset_requested_at=now() WHERE id=${user.id} AND active AND password_hash=${user.password_hash} RETURNING id`;
      if (updated.length)
        await tx`DELETE FROM sessions WHERE user_id=${user.id} AND password_reset_only`;
    });
  } catch {
    // BullMQ retries safely; do not retain SMTP details, credentials or the generated password.
    throw new Error(
      'Falha no envio de recuperação de senha. Verifique o SMTP.',
    );
  }
  return { ok: true };
}
