import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const sql = require('postgres')(process.env.DATABASE_URL, { max: 1 });
try {
  await sql`CREATE TABLE IF NOT EXISTS deployment_bootstrap(key text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`;
  const [done] = await sql`SELECT key FROM deployment_bootstrap WHERE key='ubuntu-test-import'`;
  if (done) { console.log('Dados de teste já preparados; configurações preservadas.'); }
  else {
    const manifest = JSON.parse(await readFile('/backup/objects.json', 'utf8'));
    await sql.begin(async tx => {
      for (const item of manifest) {
        if (!['documents','private_files'].includes(item.table) || !/^[a-f0-9-]{36}$/.test(item.id) || !/^[a-z_]+-[a-f0-9-]{36}\.bin$/.test(item.file)) throw new Error('Manifesto de arquivos inválido.');
        const bytes = await readFile('/backup/objects/' + item.file);
        if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('Falha de integridade no arquivo ' + item.id);
        await tx`UPDATE ${tx(item.table)} SET content=${bytes},storage_key=null WHERE id=${item.id} AND storage_key=${item.key}`;
      }
      const [missing] = await tx`SELECT (SELECT count(*) FROM documents WHERE storage_key IS NOT NULL AND content IS NULL)+(SELECT count(*) FROM private_files WHERE storage_key IS NOT NULL AND content IS NULL) AS n`;
      if (Number(missing.n)) throw new Error('Há documentos ausentes no pacote.');
      // A copied test environment must not replay old emails, webhooks or AI jobs.
      await tx`DELETE FROM sessions`;
      await tx`UPDATE collection_schedules SET enabled=false`;
      await tx`UPDATE notification_preferences SET email_enabled=false`;
      await tx`UPDATE webhooks SET active=false`;
      await tx`UPDATE api_tokens SET active=false`;
      await tx`UPDATE email_deliveries SET status='cancelled' WHERE status<>'sent'`;
      await tx`UPDATE outbox SET published_at=coalesce(published_at,now())`;
      await tx`UPDATE job_runs SET state='failed',error='Trabalho anterior não retomado na cópia de teste.',finished_at=now() WHERE state NOT IN ('completed','failed')`;
      await tx`UPDATE opportunities SET processing_state='partial',processing_job_id=null,processing_error='Ambiente de teste importado. Atualize as informações quando necessário.' WHERE processing_state IN ('pending','queued','processing')`;
      await tx`INSERT INTO deployment_bootstrap(key) VALUES('ubuntu-test-import')`;
    });
    console.log('Documentos conferidos. Usuários, oportunidades e históricos preservados. Automações copiadas pausadas para teste.');
  }

  const [provisioned]=await sql`SELECT key FROM deployment_bootstrap WHERE key='ubuntu-test-users-v1'`;
  if(!provisioned){
    const accounts=JSON.parse(await readFile('/backup/test-users.json','utf8'));
    await sql.begin(async tx=>{
      const companies=await tx`SELECT id,is_parent FROM companies WHERE organization_id='10000000-0000-4000-8000-000000000001' AND active ORDER BY is_parent DESC,name`;
      const parent=companies.find(c=>c.is_parent),operating=companies.filter(c=>!c.is_parent);
      if(!parent||operating.length!==3)throw new Error('Empresas esperadas não encontradas para os acessos de teste.');
      for(const account of accounts){
        if(!['group_admin','analyst'].includes(account.role)||!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(account.passwordHash))throw new Error('Cadastro de teste inválido.');
        const [existing]=await tx`SELECT id FROM users WHERE email=${account.email}`;
        if(existing)throw new Error('O login de teste já existe. A senha existente foi preservada: '+account.email);
        await tx`INSERT INTO users(id,organization_id,company_id,name,email,password_hash,group_role) VALUES(${account.id},'10000000-0000-4000-8000-000000000001',${account.role==='group_admin'?parent.id:operating[0].id},${account.name},${account.email},${account.passwordHash},${account.role==='group_admin'?'group_admin':'member'})`;
        if(account.role==='analyst')for(const c of operating)await tx`INSERT INTO memberships(user_id,organization_id,company_id,role) VALUES(${account.id},'10000000-0000-4000-8000-000000000001',${c.id},'analyst')`;
        await tx`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(gen_random_uuid(),'10000000-0000-4000-8000-000000000001',${parent.id},null,'member:test-provisioned',${account.id},${tx.json({name:account.name,email:account.email,role:account.role})})`;
      }
      await tx`INSERT INTO deployment_bootstrap(key) VALUES('ubuntu-test-users-v1')`;
    });console.log('Quatro acessos de teste provisionados, sem envio de e-mails.');
  }else console.log('Acessos de teste existentes preservados.');
} finally { await sql.end(); }
