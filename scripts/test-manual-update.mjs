import {mkdtemp, mkdir, writeFile, copyFile, readFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const temp=await mkdtemp(path.join(os.tmpdir(),'nthub-update-test-'));
const mock=`#!/usr/local/bin/node
const fs=require('node:fs');const name=require('node:path').basename(process.argv[1]);const args=process.argv.slice(2);const cmd=args.join(' '),mode=process.env.SCENARIO;
fs.appendFileSync(process.env.TEST_LOG,name+' '+cmd+'\\n');
if(name==='flock')process.exit(0);
if(name==='git'){
 if(cmd==='branch --show-current')console.log('main');
 if(cmd==='status --porcelain'&&mode==='dirty')console.log(' M apps/api/src/app.ts');
 if(cmd.startsWith('rev-parse'))console.log((cmd.includes('FETCH_HEAD')||mode==='noop')?'b'.repeat(40):'a'.repeat(40));
 process.exit(0);
}
if(cmd.includes(' ps -q '))console.log(args[args.length-1]+'-container');
else if(cmd.startsWith('inspect '))console.log('sha256:previous-image');
else if(cmd.includes(' config')&&!cmd.includes('--quiet'))console.log('services: {}');
else if(cmd.includes(' build ')&&mode==='build-failure')process.exit(20);
else if(cmd.includes(' pg_isready'))process.exit(0);
else if(cmd.includes(' psql '))console.log('0');
else if(cmd.includes(' pg_dump '))console.log('FAKE-DUMP');
else if(cmd.includes(' pg_restore ')){if(mode==='backup-failure')process.exit(21);console.log('Catalog valid');}
else if(cmd.includes(' run --rm --no-deps init ')&&mode==='migration-failure')process.exit(22);
else if(cmd.includes(' up ')&&cmd.endsWith(' api')&&mode==='health-failure')process.exit(23);
`;
try{
 const bin=path.join(temp,'bin');await mkdir(bin);
 for(const name of ['docker','git','flock'])await writeFile(path.join(bin,name),mock,{mode:0o755});
 for(const scenario of ['success','noop','dirty','build-failure','backup-failure','migration-failure','health-failure']){
  const root=path.join(temp,scenario);await mkdir(path.join(root,'deploy/ubuntu'),{recursive:true});await mkdir(path.join(root,'.git'));
  for(const file of ['update.sh','RECUPERACAO.md'])await copyFile('deploy/ubuntu/'+file,path.join(root,'deploy/ubuntu',file));
  await writeFile(path.join(root,'.env'),'DUMMY=1\n');await writeFile(path.join(root,'deploy/ubuntu/compose.yaml'),'services: {}\n');
  if(scenario==='noop'){await mkdir(path.join(root,'.runtime'));await writeFile(path.join(root,'.runtime/deployed-commit'),'b'.repeat(40)+'\n');}
  const log=path.join(root,'commands.log');
  const result=spawnSync('bash',[path.join(root,'deploy/ubuntu/update.sh')],{env:{...process.env,PATH:bin+':'+process.env.PATH,SCENARIO:scenario,TEST_LOG:log},encoding:'utf8'});
  const commands=await readFile(log,'utf8');const ok=condition=>{if(!condition)throw new Error(scenario+' failed\n'+result.stdout+'\n'+result.stderr+'\n'+commands);};
  ok(scenario==='success'||scenario==='noop'?result.status===0:result.status!==0);
  ok(!commands.includes(' down ')&&!commands.includes('bootstrap.mjs'));
  if(['noop','dirty','build-failure'].includes(scenario))ok(!commands.includes(' stop '));
  if(scenario==='success')ok(commands.includes('pg_dump')&&commands.includes('pg_restore --list')&&commands.includes('src/migrate.ts')&&commands.includes('api/v1/health'));
  if(scenario==='backup-failure')ok(commands.includes('previous-images.yaml')&&!commands.includes('src/migrate.ts'));
  if(['migration-failure','health-failure'].includes(scenario))ok(!commands.includes('previous-images.yaml up')&&commands.includes(' stop -t 60 web api worker'));
  console.log('PASS '+scenario);
 }
}finally{await rm(temp,{recursive:true,force:true});}
