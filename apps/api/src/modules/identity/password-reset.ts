import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql } from '../../core/db.js';
import { hashPassword, hashToken, httpError, verifyPassword } from './index.js';
import { enqueuePasswordReset } from '../../core/password-reset-queue.js';

const message =
  'Se o e-mail corresponder a uma conta ativa, você receberá uma senha temporária. Confira também a pasta de spam.';

export async function passwordResetRoutes(app: FastifyInstance) {
  app.post(
    '/api/v1/auth/forgot-password',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (req) => {
      const { email } = z.object({ email: z.email().max(254) }).parse(req.body);
      await enqueuePasswordReset(email.toLowerCase());
      return { message };
    },
  );

  app.get('/api/v1/auth/password-reset/status', async (req) => {
    const [session] =
      await sql`SELECT s.password_reset_only FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=${hashToken(req.cookies.session || '')} AND s.expires_at>now() AND u.active`;
    return { passwordChangeRequired: Boolean(session?.password_reset_only) };
  });

  app.post(
    '/api/v1/auth/password-reset/complete',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const body = z
        .object({
          newPassword: z.string().min(12).max(256),
          confirmPassword: z.string().min(12).max(256),
        })
        .refine((b) => b.newPassword === b.confirmPassword, {
          message: 'As senhas não coincidem.',
          path: ['confirmPassword'],
        })
        .parse(req.body);
      await sql.begin(async (tx) => {
        const [session] =
          await tx`SELECT u.id,u.organization_id,u.company_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=${hashToken(req.cookies.session || '')} AND s.password_reset_only AND s.expires_at>now() AND u.active FOR UPDATE OF u,s`;
        if (!session)
          throw httpError(
            401,
            'A redefinição expirou. Solicite outra senha temporária.',
          );
        const [current] =
          await tx`SELECT password_hash,reset_used_password_hash FROM users WHERE id=${session.id}`;
        if (
          !current ||
          verifyPassword(body.newPassword, current.password_hash) ||
          (current.reset_used_password_hash &&
            verifyPassword(body.newPassword, current.reset_used_password_hash))
        )
          throw httpError(
            400,
            'Escolha uma senha diferente da anterior e da temporária.',
          );
        await tx`UPDATE users SET password_hash=${hashPassword(body.newPassword)},temporary_password_hash=NULL,temporary_password_expires_at=NULL,reset_used_password_hash=NULL WHERE id=${session.id}`;
        await tx`DELETE FROM sessions WHERE user_id=${session.id}`;
        await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id) VALUES(${randomUUID()},${session.organization_id},${session.company_id},${session.id},'profile:password-reset',${session.id})`;
      });
      reply.clearCookie('session', { path: '/' });
      return { ok: true };
    },
  );
}
