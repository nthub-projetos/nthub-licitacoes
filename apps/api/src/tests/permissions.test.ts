import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { sql, drizzleClient } from '../core/db.js';
import { buildApp } from '../app.js';
import {
  hashToken,
  hashPassword,
  authorizeBackground,
} from '../modules/identity/index.js';
import { rematchCatalog } from '../modules/sources/matching.js';
import { queue } from '../core/queue.js';
import { effectivePermissions, defaultPermissions } from '@nthub/contracts';
const org = randomUUID(),
  company = randomUUID(),
  sibling = randomUUID(),
  admin = randomUUID(),
  employee = randomUUID(),
  adminToken = randomUUID(),
  employeeToken = randomUUID();
const headers = { cookie: 'session=' + adminToken, 'x-nthub-request': '1' };
const employeeHeaders = {
  cookie: 'session=' + employeeToken,
  'x-nthub-request': '1',
};
const app = await buildApp();
let profileId = '';
beforeAll(async () => {
  await sql`INSERT INTO organizations(id,name) VALUES(${org},'Permission tests')`;
  await sql`INSERT INTO companies(id,organization_id,name,capabilities) VALUES(${company},${org},'Permission company','[]'),(${sibling},${org},'Permission sibling','[]')`;
  for (const [id, group, token] of [
    [admin, 'group_admin', adminToken],
    [employee, 'member', employeeToken],
  ]) {
    await sql`INSERT INTO users(id,organization_id,company_id,email,password_hash,group_role) VALUES(${id!},${org},${company},${id + '@example.invalid'},${hashPassword('test-password-123')},${group!})`;
    await sql`INSERT INTO sessions(token_hash,user_id,active_company_id,expires_at) VALUES(${hashToken(token!)},${id!},${company},now()+interval '1 hour')`;
  }
  await sql`INSERT INTO memberships(user_id,organization_id,company_id,role) VALUES(${employee},${org},${company},'viewer'),(${employee},${org},${sibling},'analyst')`;
});
afterAll(async () => {
  await app.close();
  await queue.close();
  await sql`DELETE FROM api_tokens WHERE organization_id=${org}`;
  await sql`DELETE FROM outbox WHERE payload->'tenant'->>'organizationId'=${org}`;
  await sql`DELETE FROM notifications WHERE organization_id=${org}`;
  await sql`DELETE FROM opportunity_routes WHERE organization_id=${org}`;
  for (const table of [
    'private_files',
    'bids',
    'opportunity_notes',
    'opportunity_contacts',
    'tasks',
    'analyses',
    'documents',
  ])
    await sql`DELETE FROM ${sql(table)} WHERE organization_id=${org}`;
  await sql`DELETE FROM opportunities WHERE organization_id=${org}`;
  await sql`DELETE FROM procurements WHERE source_id LIKE ${'DISCARD-TEST-' + org + '%'}`;
  await sql`DELETE FROM audit_logs WHERE organization_id=${org}`;
  await sql`DELETE FROM sessions WHERE user_id IN (${admin},${employee})`;
  await sql`DELETE FROM memberships WHERE organization_id=${org}`;
  await sql`DELETE FROM permission_profiles WHERE organization_id=${org}`;
  await sql`DELETE FROM users WHERE organization_id=${org}`;
  await sql`DELETE FROM companies WHERE organization_id=${org}`;
  await sql`DELETE FROM organizations WHERE id=${org}`;
  await sql.end();
  await drizzleClient.end();
});
const assign = (
  overrides: Record<string, boolean> = {},
  id: string | null = profileId,
) =>
  app.inject({
    method: 'PUT',
    url: '/api/v1/permissions/members/' + employee,
    headers,
    payload: { role: 'viewer', profileId: id, overrides },
  });
describe('Perfis personalizados e permissões por empresa', () => {
  it('bloqueia administração de permissões para funcionários', async () => {
    expect(
      (
        await app.inject({
          url: '/api/v1/permissions',
          headers: employeeHeaders,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/permissions/profiles',
          headers: employeeHeaders,
          payload: { name: 'Escalada', permissions: ['company:manage'] },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('cria perfil restrito e registra auditoria', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/permissions/profiles',
      headers,
      payload: {
        name: 'Operação CRM',
        permissions: [
          'company:read',
          'opportunities:read',
          'opportunities:write',
          'bids:read',
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    profileId = r.json().id;
    const [log] =
      await sql`SELECT action FROM audit_logs WHERE resource_id=${profileId}`;
    expect(log?.action).toBe('permissions:profile-created');
  });
  it('isola perfis por empresa, inclusive no mesmo grupo', async () => {
    const h = { ...headers, 'x-company-id': sibling };
    const list = await app.inject({ url: '/api/v1/permissions', headers: h });
    expect(
      list.json().profiles.some((p: { id: string }) => p.id === profileId),
    ).toBe(false);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/permissions/profiles/' + profileId,
          headers: h,
          payload: { name: 'Intrusão', permissions: [] },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/permissions/members/' + employee,
          headers: h,
          payload: { role: 'viewer', profileId, overrides: {} },
        })
      ).statusCode,
    ).toBe(404);
  });
  it('aplica perfil personalizado sem elevar o papel base', async () => {
    expect((await assign()).statusCode).toBe(200);
    const me = (
      await app.inject({ url: '/api/v1/me', headers: employeeHeaders })
    ).json();
    expect(me.role).toBe('viewer');
    expect(me.permissions).toContain('opportunities:write');
    expect(me.permissions).not.toContain('members:manage');
    expect(
      (
        await app.inject({
          url: '/api/v1/opportunities',
          headers: employeeHeaders,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/tasks', headers: employeeHeaders }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/members',
          headers: employeeHeaders,
          payload: { name: 'X' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('permite exceção individual e dá prioridade ao bloqueio', async () => {
    expect(
      (await assign({ 'tasks:read': true, 'opportunities:write': false }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/tasks', headers: employeeHeaders }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/opportunities/' + randomUUID() + '/status',
          headers: employeeHeaders,
          payload: { status: 'review' },
        })
      ).statusCode,
    ).toBe(403);
    const [other] =
      await sql`SELECT permission_profile_id,permission_overrides FROM memberships WHERE user_id=${employee} AND company_id=${sibling}`;
    expect(other?.permission_profile_id).toBeNull();
    expect(other?.permission_overrides).toEqual({});
  });
  it('atualiza sessões existentes e mantém a negativa individual após edição do perfil', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: '/api/v1/permissions/profiles/' + profileId,
      headers,
      payload: {
        name: 'Operação CRM',
        permissions: [
          'company:read',
          'opportunities:read',
          'opportunities:write',
          'analytics:read',
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    const me = (
      await app.inject({ url: '/api/v1/me', headers: employeeHeaders })
    ).json();
    expect(me.permissions).toContain('analytics:read');
    expect(me.permissions).not.toContain('opportunities:write');
    expect(me.permissions).toContain('tasks:read');
  });
  it('revalida permissões na execução de trabalhos em segundo plano', async () => {
    await expect(
      authorizeBackground(
        {
          userId: employee,
          companyId: company,
          organizationId: org,
          email: 'test@example.invalid',
          role: 'company_manager',
          permissions: ['intelligence:run'],
        },
        'intelligence:run',
      ),
    ).rejects.toThrow();
  });
  it('separa uso da IA da edição do CRM', async () => {
    await assign();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/opportunities/' + randomUUID() + '/analyses',
          headers: employeeHeaders,
        })
      ).statusCode,
    ).toBe(403);
  });
  it('aceita perfil sem permissões sem voltar aos privilégios padrão', async () => {
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/permissions/profiles/' + profileId,
          headers,
          payload: { name: 'Sem acesso', permissions: [] },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/me', headers: employeeHeaders })).json()
        .permissions,
    ).toEqual([]);
    expect(
      (
        await app.inject({
          url: '/api/v1/opportunities',
          headers: employeeHeaders,
        })
      ).statusCode,
    ).toBe(403);
  });
  it('revoga escopos de integração junto com as permissões do criador', async () => {
    await assign({
      'integrations:manage': true,
      'integrations:read': true,
      'opportunities:read': true,
    });
    const token = 'nth_' + randomBytes(32).toString('hex');
    await sql`INSERT INTO api_tokens(id,organization_id,company_id,name,token_hash,scopes,created_by,expires_at) VALUES(${randomUUID()},${org},${company},'Test integration',${hashToken(token)},${sql.json(['opportunities:read'])},${employee},now()+interval '1 hour')`;
    const bearer = { authorization: 'Bearer ' + token };
    expect(
      (await app.inject({ url: '/api/v1/opportunities', headers: bearer }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/integrations/tokens',
          headers: employeeHeaders,
          payload: {
            name: 'Forbidden expansion',
            scopes: ['bids:write'],
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
        })
      ).statusCode,
    ).toBe(403);
    await assign({ 'integrations:manage': true });
    expect(
      (await app.inject({ url: '/api/v1/opportunities', headers: bearer }))
        .statusCode,
    ).toBe(403);
    await assign();
    expect(
      (await app.inject({ url: '/api/v1/opportunities', headers: bearer }))
        .statusCode,
    ).toBe(401);
  });
  it('rejeita permissões desconhecidas e mantém padrões ao restaurar herança', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/permissions/profiles',
          headers,
          payload: { name: 'Inválido', permissions: ['all:admin'] },
        })
      ).statusCode,
    ).toBe(400);
    expect((await assign({}, null)).statusCode).toBe(200);
    expect(
      (await app.inject({ url: '/api/v1/me', headers: employeeHeaders })).json()
        .permissions,
    ).toEqual(defaultPermissions('viewer'));
    expect(effectivePermissions('company_manager', [], {})).toEqual([]);
  });
  it('exige motivo no descarte e separa o valor descartado do pipeline por empresa', async () => {
    const procurement = randomUUID(),
      opportunity = randomUUID(),
      otherProcurement = randomUUID(),
      otherOpportunity = randomUUID();
    for (const [pid, oid, cid, value] of [
      [procurement, opportunity, company, 1000],
      [otherProcurement, otherOpportunity, sibling, 2500],
    ] as const) {
      await sql`INSERT INTO procurements(id,source_id,title,agency,value,deadline,source_url,raw) VALUES(${pid},${'DISCARD-TEST-' + org + pid},'Test discard','Test',${value},now()+interval '5 days','https://pncp.gov.br','{}')`;
      await sql`INSERT INTO opportunities(id,organization_id,company_id,procurement_id,score,matches) VALUES(${oid},${org},${cid},${pid},0,'[]')`;
    }
    const url = '/api/v1/opportunities/' + opportunity + '/status';
    for (const reason of [undefined, '', '   '])
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url,
            headers,
            payload: { status: 'discarded', reason },
          })
        ).statusCode,
      ).toBe(400);
    const before = (
      await app.inject({
        url: '/api/v1/analytics/group?companyId=' + company,
        headers,
      })
    ).json();
    expect(Number(before.totals.estimatedPipeline)).toBe(1000);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers,
          payload: {
            status: 'discarded',
            reason: '  Escopo fora da atuação da empresa.  ',
          },
        })
      ).statusCode,
    ).toBe(200);
    const list = (
      await app.inject({ url: '/api/v1/opportunities', headers })
    ).json();
    expect(
      list.find((o: { id: string }) => o.id === opportunity).decisionReason,
    ).toBe('Escopo fora da atuação da empresa.');
    const activity = (
      await app.inject({
        url: '/api/v1/opportunities/' + opportunity + '/activity',
        headers,
      })
    ).json();
    expect(
      activity.timeline.find(
        (e: { action: string }) => e.action === 'status:discarded',
      ).details.reason,
    ).toBe('Escopo fora da atuação da empresa.');
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/opportunities/' + otherOpportunity + '/status',
      headers: { ...headers, 'x-company-id': sibling },
      payload: { status: 'discarded', reason: 'Sem capacidade técnica.' },
    });
    const group = (
      await app.inject({ url: '/api/v1/analytics/group', headers })
    ).json();
    expect(Number(group.totals.estimatedPipeline)).toBe(0);
    expect(Number(group.totals.discardedPipeline)).toBe(3500);
    const filtered = (
      await app.inject({
        url: '/api/v1/analytics/group?companyId=' + company,
        headers,
      })
    ).json();
    expect(Number(filtered.totals.discardedPipeline)).toBe(1000);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers,
          payload: { status: 'review' },
        })
      ).statusCode,
    ).toBe(200);
    const restored = (
      await app.inject({
        url: '/api/v1/analytics/group?companyId=' + company,
        headers,
      })
    ).json();
    expect(Number(restored.totals.discardedPipeline)).toBe(0);
    expect(Number(restored.totals.estimatedPipeline)).toBe(1000);
  });
  it('transfere o agregado e preserva histórico, sem duplicar ou reutilizar aderência da origem', async () => {
    const pid = randomUUID(),
      id = randomUUID(),
      doc = randomUUID(),
      analysis = randomUUID(),
      bid = randomUUID(),
      file = randomUUID(),
      keyword = 'transferfixture' + randomUUID().replaceAll('-', '');
    await sql`INSERT INTO procurements(id,source_id,title,agency,value,source_url,raw) VALUES(${pid},${'DISCARD-TEST-' + org + pid},${keyword},'Transfer test',100,'https://pncp.gov.br','{}')`;
    await sql`UPDATE companies SET capabilities=${sql.json([keyword])} WHERE id IN (${company},${sibling})`;
    await sql`INSERT INTO opportunities(id,organization_id,company_id,procurement_id,score,matches,status,assigned_user_id) VALUES(${id},${org},${company},${pid},10,'[]','review',${employee})`;
    await sql`INSERT INTO documents(id,organization_id,company_id,opportunity_id,name,hash,pages) VALUES(${doc},${org},${company},${id},'Test.pdf','test','[]')`;
    await sql`INSERT INTO analyses(id,organization_id,company_id,opportunity_id,document_id,result,model,prompt_version) VALUES(${analysis},${org},${company},${id},${doc},'{}','test','test')`;
    await sql`INSERT INTO opportunity_notes(id,organization_id,company_id,opportunity_id,user_id,body) VALUES(${randomUUID()},${org},${company},${id},${admin},'Preserve note')`;
    await sql`INSERT INTO opportunity_contacts(id,organization_id,company_id,opportunity_id,name,created_by) VALUES(${randomUUID()},${org},${company},${id},'Contact',${admin})`;
    await sql`INSERT INTO bids(id,organization_id,company_id,opportunity_id,title,created_by) VALUES(${bid},${org},${company},${id},'Draft',${admin})`;
    await sql`INSERT INTO private_files(id,organization_id,company_id,bid_id,name,mime,hash,created_by) VALUES(${file},${org},${company},${bid},'Draft.pdf','application/pdf','test',${admin})`;
    await sql`INSERT INTO tasks(id,organization_id,company_id,opportunity_id,title,assigned_user_id,created_by) VALUES(${randomUUID()},${org},${company},${id},'Task',${employee},${admin})`;
    await sql`INSERT INTO audit_logs(id,organization_id,company_id,user_id,action,resource_id,details) VALUES(${randomUUID()},${org},${company},${admin},'status:review',${id},'{}')`;
    const url = '/api/v1/opportunities/' + id + '/transfer',
      payload = {
        companyId: sibling,
        reason: 'Melhor aderência aos serviços da outra empresa.',
      };
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: employeeHeaders,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers,
          payload: { ...payload, companyId: randomUUID() },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers,
          payload: { ...payload, reason: '   ' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url, headers, payload })).statusCode,
    ).toBe(200);
    const [op] =
      await sql`SELECT company_id,status,assigned_user_id FROM opportunities WHERE id=${id}`;
    expect(op?.company_id).toBe(sibling);
    expect(op?.status).toBe('new');
    expect(op?.assigned_user_id).toBeNull();
    for (const table of [
      'documents',
      'analyses',
      'opportunity_notes',
      'opportunity_contacts',
      'tasks',
      'bids',
    ]) {
      const [row] =
        await sql`SELECT company_id FROM ${sql(table)} WHERE opportunity_id=${id}`;
      expect(row?.company_id).toBe(sibling);
    }
    const [storedFile] =
      await sql`SELECT company_id FROM private_files WHERE id=${file}`;
    expect(storedFile?.company_id).toBe(sibling);
    const [storedAnalysis] =
      await sql`SELECT criteria_version FROM analyses WHERE id=${analysis}`;
    expect(storedAnalysis?.criteria_version).toBe(0);
    expect(
      (
        await app.inject({
          url: '/api/v1/opportunities/' + id + '/activity',
          headers,
        })
      ).statusCode,
    ).toBe(404);
    const activity = (
      await app.inject({
        url: '/api/v1/opportunities/' + id + '/activity',
        headers: { ...headers, 'x-company-id': sibling },
      })
    ).json();
    expect(
      activity.timeline.some(
        (e: { action: string }) => e.action === 'status:review',
      ),
    ).toBe(true);
    expect(
      activity.timeline.find(
        (e: { action: string }) => e.action === 'opportunity:transferred',
      ).details.reason,
    ).toBe(payload.reason);
    await rematchCatalog({
      userId: admin,
      organizationId: org,
      companyId: company,
      email: 'test@example.invalid',
      isGroupAdmin: true,
      role: 'group_admin',
    });
    const [count] =
      await sql`SELECT count(*)::int AS n FROM opportunities WHERE company_id=${company} AND procurement_id=${pid}`;
    expect(count?.n).toBe(0);
    const duplicate = randomUUID();
    await sql`INSERT INTO opportunities(id,organization_id,company_id,procurement_id,score,matches) VALUES(${duplicate},${org},${company},${pid},0,'[]')`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { ...headers, 'x-company-id': sibling },
          payload: { companyId: company, reason: 'Voltar' },
        })
      ).statusCode,
    ).toBe(409);
    await sql`DELETE FROM opportunities WHERE id=${duplicate}`;
    await sql`UPDATE bids SET status='submitted' WHERE id=${bid}`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { ...headers, 'x-company-id': sibling },
          payload: { companyId: company, reason: 'Voltar' },
        })
      ).statusCode,
    ).toBe(409);
    await sql`UPDATE bids SET status='draft' WHERE id=${bid}`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { ...headers, 'x-company-id': sibling },
          payload: { companyId: company, reason: 'Retornar para a origem' },
        })
      ).statusCode,
    ).toBe(200);
    const [route] =
      await sql`SELECT excluded_company_id FROM opportunity_routes WHERE organization_id=${org} AND procurement_id=${pid}`;
    expect(route?.excluded_company_id).toBe(sibling);
  });
});
