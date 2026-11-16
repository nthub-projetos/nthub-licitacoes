import { readFile } from 'node:fs/promises';
import { sql } from './core/db.js';
try {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(772913)`;
    await tx.unsafe(
      await readFile(new URL('./schema.sql', import.meta.url), 'utf8'),
    );
    await tx.unsafe(
      await readFile(new URL('./schema-v2.sql', import.meta.url), 'utf8'),
    );
  });
  console.log('Schema atualizado.');
} finally {
  await sql.end();
}
