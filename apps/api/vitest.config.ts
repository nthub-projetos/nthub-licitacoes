import { loadEnvFile } from 'node:process';
import { defineConfig } from 'vitest/config';
loadEnvFile('../../.env');
process.env.GEMINI_API_KEY = '';
process.env.S3_ENDPOINT = '';
process.env.SMTP_HOST = '';
export default defineConfig({
  test: { fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 },
});
