import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
let text;try{text=await readFile(join(root,'.env'),'utf8');}catch{text=await readFile(join(root,'.env.example'),'utf8');}
const values=Object.fromEntries(text.split(/\r?\n/).filter(line=>line&&!line.startsWith('#')&&line.includes('=')).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
const defaults={ADMIN_PASSWORD:randomBytes(24).toString('base64url'),APP_URL:'http://127.0.0.1:5173',DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),S3_ENDPOINT:'http://127.0.0.1:9000',S3_REGION:'garage',S3_BUCKET:'nthub-documents',S3_ACCESS_KEY:'GK'+randomBytes(16).toString('hex'),S3_SECRET_KEY:randomBytes(32).toString('hex'),SMTP_HOST:'127.0.0.1',SMTP_PORT:'1025',SMTP_SECURE:'false',SMTP_FROM:'NTHUB <no-reply@nthub.local>'};
for(const [key,value] of Object.entries(defaults)){if(values[key])continue;values[key]=value;const pattern=new RegExp('^'+key+'=.*$','m');text=pattern.test(text)?text.replace(pattern,key+'='+value):text.trimEnd()+'\n'+key+'='+value+'\n';}
await writeFile(join(root,'.env'),text,'utf8');
await mkdir(join(root,'.runtime'),{recursive:true});
try{await readFile(join(root,'.runtime','garage.toml'));}catch{await writeFile(join(root,'.runtime','garage.toml'),`metadata_dir = "/var/lib/garage/meta"\ndata_dir = "/var/lib/garage/data"\ndb_engine = "sqlite"\nreplication_factor = 1\nrpc_bind_addr = "0.0.0.0:3901"\nrpc_public_addr = "127.0.0.1:3901"\nrpc_secret = "${randomBytes(32).toString('hex')}"\n[s3_api]\ns3_region = "garage"\napi_bind_addr = "0.0.0.0:3900"\nroot_domain = ".s3.garage.localhost"\n`,'utf8');}
console.log('Ambiente local preparado. Credenciais existentes preservadas. Armazenamento S3 e captura local de e-mails configurados.');
