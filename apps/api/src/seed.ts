import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sql } from './core/db.js';
import {searchSettingsSchema} from '@nthub/contracts';
import { hashPassword } from './modules/identity/index.js';
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 12)
  throw new Error('Configure ADMIN_PASSWORD com pelo menos 12 caracteres.');
const org = '10000000-0000-4000-8000-000000000001';
const parent = '20000000-0000-4000-8000-000000000004';
const definitions = [
  {
    id: parent,
    name: 'NTHUB',
    short: 'NTHUB',
    description: 'Matriz e administração do grupo empresarial NTHUB.',
    file: 'nthub.png',
    website: null,
    keywords: [],
    parent: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Safe Conversão Digital',
    short: 'Safe',
    description: 'Digitalização, gestão documental e microfilmagem.',
    file: 'safe.png',
    website: null,
    keywords: [
      'digitalização',
      'gestão documental',
      'microfilmagem',
      'GED',
      'SIGAD',
      'OCR',
      'guarda documental',
      'preservação documental',
    ],
    parent: false,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    name: 'DBSeller Sistemas Integrados',
    short: 'DBSeller',
    description:
      'Software de gestão governamental e municipal, e-Cidade e nota fiscal de serviços eletrônica.',
    file: 'dbseller.png',
    website: 'https://www.dbseller.com.br/',
    keywords: [
      'gestão pública',
      'gestão municipal',
      'gestão governamental',
      'e-cidade',
      'e cidade',
      'software de gestão pública',
      'sistema integrado de gestão pública',
      'nota fiscal eletrônica',
      'nota fiscal de serviços eletrônica',
      'NFS-e',
      'SIAFIC',
    ],
    parent: false,
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    name: 'IA Tecnologia',
    short: 'IA Tecnologia',
    description:
      'Locação de computadores, microcomputadores, impressoras, scanners e ar-condicionado.',
    file: 'ia-tecnologia.png',
    website: null,
    keywords: [
      'computadores','microcomputadores','impressoras','impressão','scanners','ar condicionado',
      'locação de computadores',
      'locação de microcomputadores',
      'aluguel de computadores',
      'locação de impressoras',
      'outsourcing de impressão',
      'locação de scanners',
      'aluguel de scanners',
      'locação de ar condicionado',
      'locação de ar-condicionado',
      'aluguel de ar condicionado',
    ],
    parent: false,
  },
];
try {
  await sql.begin(async (tx) => {
    await tx`INSERT INTO organizations(id,name) VALUES(${org},'NTHUB') ON CONFLICT(id) DO UPDATE SET name='NTHUB'`;
    for (const company of definitions) {
      await tx`INSERT INTO companies(id,organization_id,name,short_name,description,website,capabilities,is_parent,parent_company_id,logo_url,search_settings) VALUES(${company.id},${org},${company.name},${company.short},${company.description},${company.website},${tx.json(company.keywords)},${company.parent},${company.parent ? null : parent},${'/api/v1/companies/' + company.id + '/logo'},${tx.json(searchSettingsSchema.parse(company.short==='IA Tecnologia'?{requiredKeywords:['locação','aluguel','outsourcing']}:{}))}) ON CONFLICT(id) DO UPDATE SET capabilities=CASE WHEN companies.configured_by_user THEN companies.capabilities ELSE EXCLUDED.capabilities END,search_settings=CASE WHEN companies.configured_by_user THEN companies.search_settings ELSE EXCLUDED.search_settings END,short_name=CASE WHEN companies.short_name='' THEN EXCLUDED.short_name ELSE companies.short_name END,description=CASE WHEN companies.description='' THEN EXCLUDED.description ELSE companies.description END,website=coalesce(companies.website,EXCLUDED.website),is_parent=EXCLUDED.is_parent,parent_company_id=EXCLUDED.parent_company_id,logo_url=coalesce(companies.logo_url,EXCLUDED.logo_url)`;
      const bytes = await readFile(
        new URL(
          '../../web/public/brand/companies/' + company.file,
          import.meta.url,
        ),
      );
      await tx`INSERT INTO company_logos(company_id,organization_id,content,mime) VALUES(${company.id},${org},${bytes},'image/png') ON CONFLICT DO NOTHING`;
    }
    const email = (process.env.ADMIN_EMAIL || 'admin@safe.local').toLowerCase();
    await tx`INSERT INTO users(id,organization_id,company_id,name,email,password_hash,group_role) VALUES(${randomUUID()},${org},${parent},'Administrador NTHUB',${email},${hashPassword(password)},'group_admin') ON CONFLICT(email) DO UPDATE SET group_role='group_admin',name=CASE WHEN users.name='' THEN 'Administrador NTHUB' ELSE users.name END WHERE users.organization_id=${org}`;
  });
  console.log(
    'Grupo NTHUB, matriz e três empresas cadastrados. Apenas o administrador do grupo foi provisionado. CNPJs pendentes.',
  );
} finally {
  await sql.end();
}
