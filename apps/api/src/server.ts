import { buildApp } from './app.js';
import { config } from './core/config.js';
import { sql, drizzleClient } from './core/db.js';
import { queue } from './core/queue.js';
const app = await buildApp();
await app.listen({ port: config.PORT, host: config.HOST });
async function close() {
  await app.close();
  await queue.close();
  await sql.end();
  await drizzleClient.end();
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
