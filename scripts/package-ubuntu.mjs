import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, cp, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const postgres = require('postgres');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const folder = path.resolve('output/ubuntu-package/nthub-licitacoes');
await mkdir(path.join(folder,'backup/objects'),{recursive:true});
const sql = postgres(process.env.DATABASE_URL,{max:1});
try {
  for (const name of ['apps','packages','deploy','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.dockerignore']) {
    await cp(name,path.join(folder,name),{recursive:true,filter:source=>!source.split(path.sep).some(part=>['node_modules','dist','.git','.runtime','output'].includes(part))});
  }
  console.log('Código de implantação copiado. Criando snapshot consistente do PostgreSQL...');
  const dump = path.join(folder,'backup/database.dump');
  const stream = createWriteStream(dump);
  await new Promise((resolve,reject)=>{
    const child=spawn('docker',['compose','exec','-T','postgres','pg_dump','-U','nthub','-d','nthub','-Fc','--no-owner','--no-acl'],{stdio:['ignore','pipe','pipe']});
    child.stdout.pipe(stream);let errors='';child.stderr.on('data',d=>errors+=d);
    child.on('error',reject);child.on('close',code=>{if(code)reject(new Error('Falha no pg_dump: '+errors));else resolve();});
    stream.on('error',reject);
  });
  await finished(stream);
  const rows=[];
  for(const table of ['documents','private_files']) rows.push(...(await sql`SELECT id,storage_key,${table}::text AS tbl FROM ${sql(table)} WHERE storage_key IS NOT NULL AND content IS NULL`).map(row=>row));
  const client=new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION||'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY,secretAccessKey:process.env.S3_SECRET_KEY}});
  const manifest=[];let bytesTotal=0;
  for(let i=0;i<rows.length;i+=4){
    await Promise.all(rows.slice(i,i+4).map(async row=>{
      const result=await client.send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:row.storage_key}));
      const bytes=Buffer.from(await result.Body.transformToByteArray());
      const file=row.tbl+'-'+row.id+'.bin';await writeFile(path.join(folder,'backup/objects',file),bytes);
      manifest.push({table:row.tbl,id:row.id,key:row.storage_key,file,sha256:createHash('sha256').update(bytes).digest('hex')});bytesTotal+=bytes.length;
    }));
    if(i%40===0)console.log(`Documentos exportados: ${Math.min(i+4,rows.length)}/${rows.length}`);
  }
  manifest.sort((a,b)=>a.file.localeCompare(b.file));
  await writeFile(path.join(folder,'backup/objects.json'),JSON.stringify(manifest,null,2));
  const settings={BIND_IP:'192.168.100.240',HTTP_PORT:'8088',APP_URL:'http://192.168.100.240:8088',POSTGRES_PASSWORD:randomBytes(24).toString('hex'),GEMINI_API_KEY:process.env.GEMINI_API_KEY||'',GEMINI_MODEL:process.env.GEMINI_MODEL||'gemini-2.5-flash',SMTP_HOST:process.env.SMTP_HOST||'',SMTP_PORT:process.env.SMTP_PORT||'465',SMTP_SECURE:process.env.SMTP_SECURE||'true',SMTP_USER:process.env.SMTP_USER||'',SMTP_PASSWORD:process.env.SMTP_PASSWORD||'',SMTP_FROM:process.env.SMTP_FROM||'',DATA_ENCRYPTION_KEY:process.env.DATA_ENCRYPTION_KEY||''};
  await writeFile(path.join(folder,'.env'),Object.entries(settings).map(([k,v])=>`${k}='${String(v).replaceAll("'","\\'")}'`).join('\n')+'\n',{mode:0o600});
  const [counts]=await sql`SELECT (SELECT count(*) FROM companies WHERE organization_id='10000000-0000-4000-8000-000000000001') AS companies,(SELECT count(*) FROM opportunities WHERE organization_id='10000000-0000-4000-8000-000000000001') AS opportunities,(SELECT count(*) FROM users WHERE organization_id='10000000-0000-4000-8000-000000000001') AS users`;
  const info={createdAt:new Date().toISOString(),...counts,externalFiles:manifest.length,externalBytes:bytesTotal,dumpBytes:(await stat(dump)).size};
  await writeFile(path.join(folder,'backup/snapshot-info.json'),JSON.stringify(info,null,2));
  await cp('deploy/ubuntu/LEIA-ME.md',path.join(folder,'LEIA-ME.md'));
  console.log(JSON.stringify(info));
} finally {await sql.end();}
