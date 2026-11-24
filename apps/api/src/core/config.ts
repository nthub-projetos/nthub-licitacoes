import { z } from 'zod';
export const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().url(),
    GEMINI_API_KEY: z.string().default(''),
    GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
    PORT: z.coerce.number().default(3001),
    HOST: z.string().default('127.0.0.1'),
    TRUSTED_PROXY_CIDRS: z.string().default(''),
    APP_URL: z.string().url().default('http://127.0.0.1:5173'),
    S3_ENDPOINT: z.string().default(''),
    S3_BUCKET: z.string().default(''),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY: z.string().default(''),
    S3_SECRET_KEY: z.string().default(''),
    SMTP_HOST: z.string().default(''),
    SMTP_PORT: z.coerce.number().default(1025),
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_SECURE: z.enum(['true', 'false']).default('false'),
    SMTP_FROM: z.string().default('NTHUB <no-reply@nthub.local>'),
    DATA_ENCRYPTION_KEY: z.string().default(''),
    WEBHOOK_ALLOWED_HOSTS: z.string().default(''),
    OIDC_ISSUER: z.string().default(''),
    OIDC_ORGANIZATION_ID: z.string().default(''),
    OIDC_CLIENT_ID: z.string().default(''),
    OIDC_CLIENT_SECRET: z.string().default(''),

    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
  })
  .parse(process.env);
export const redisUrl = new URL(config.REDIS_URL);
export const redisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  ...(redisUrl.password
    ? { password: decodeURIComponent(redisUrl.password) }
    : {}),
  ...(redisUrl.protocol === 'rediss:' ? { tls: {} } : {}),
};
