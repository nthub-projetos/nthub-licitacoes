import { createHash } from 'node:crypto';
import { sql } from './core/db.js';
import {
  ensureStorage,
  storeBlob,
  loadBlob,
  storageConfigured,
} from './core/storage.js';
if (!storageConfigured)
  throw new Error('Configure o armazenamento S3 antes de migrar.');
try {
  await ensureStorage();
  let migrated = 0;
  while (true) {
    const rows =
      await sql`SELECT id,organization_id,company_id,content,mime,hash FROM documents WHERE content IS NOT NULL AND storage_key IS NULL LIMIT 20`;
    if (!rows.length) break;
    for (const row of rows) {
      const key = `${row.organization_id}/${row.company_id}/legacy/${row.id}/${row.hash}`;
      const stored = await storeBlob(key, row.content, row.mime);
      const verified = await loadBlob(null, stored.storageKey);
      if (
        createHash('sha256').update(verified).digest('hex') !==
        createHash('sha256').update(row.content).digest('hex')
      )
        throw new Error('Verificação de integridade falhou.');
      await sql`UPDATE documents SET storage_key=${stored.storageKey},content=NULL WHERE id=${row.id} AND hash=${row.hash}`;
      migrated++;
    }
  }
  console.log(`${migrated} originais migrados e verificados por SHA256.`);
} finally {
  await sql.end();
}
