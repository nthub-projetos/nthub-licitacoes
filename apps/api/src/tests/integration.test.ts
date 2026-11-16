import * as extraction from '../modules/documents/extract.js';
vi.mock('../modules/sources/http-store.js', () => ({
  httpStore: {
    reserve: async () => 0,
    cooldown: async () => {},
    get: async () => null,
    put: async () => {},
    lock: async () => true,
    unlock: async () => {},
  },
}));
import { samplePdf } from './pdf-fixture.js';
import {
  enrichOpportunity,
  analyzeOpportunity,
} from '../modules/documents/index.js';
import { config } from '../core/config.js';
import * as intelligence from '../modules/intelligence/index.js';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql, drizzleClient } from '../core/db.js';
import {
  hashPassword,
  hashToken,
  type Tenant,
} from '../modules/identity/index.js';
import { collect } from '../modules/sources/index.js';
import { buildApp } from '../app.js';
import { queue } from '../core/queue.js';
const org = randomUUID(),
  otherOrg = randomUUID(),
  company = randomUUID(),
  sibling = randomUUID(),
  otherCompany = randomUUID(),
  user = randomUUID(),
  procurement = randomUUID(),
  opportunity = randomUUID(),
  email = `test-${user}@example.invalid`,
  token = randomUUID();
const tenant: Tenant = {
  organizationId: org,
  companyId: company,
  userId: user,
  email,
};
const app = await buildApp();
const headers = { cookie: `session=${token}`, 'x-nthub-request': '1' };
const crossSourceId =
  '12345678000199-1-' + Math.floor(Math.random() * 999999999) + '/2026';
let sourceId = 'TEST-' + randomUUID();
beforeAll(async () => {
  await sql`INSERT INTO organizations VALUES(${org},'Test organization'),(${otherOrg},'Other test organization')`;
  await sql`INSERT INTO companies(id,organization_id,name,capabilities) VALUES(${company},${org},'Test Safe',${sql.json(['digitalização'])}),(${sibling},${org},'Sibling',${sql.json([])}),(${otherCompany},${otherOrg},'Other',${sql.json([])})`;
  await sql`INSERT INTO users(id,organization_id,company_id,email,password_hash) VALUES(${user},${org},${company},${email},${hashPassword('test-password-123')})`;
  await sql`INSERT INTO memberships(user_id,organization_id,company_id,role) VALUES(${user},${org},${company},'analyst')`;
  await sql`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(${hashToken(token)},${user},now()+interval '1 hour')`;
  await sql`INSERT INTO procurements(id,source_id,title,agency,source_url,raw) VALUES(${procurement},${'TEST-' + procurement},'Private test procurement','Test','https://pncp.gov.br',${sql.json({})})`;
  await sql`INSERT INTO opportunities(id,organization_id,company_id,procurement_id,score,matches) VALUES(${opportunity},${org},${sibling},${procurement},50,${sql.json([])})`;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await queue.close();
  await sql`DELETE FROM invitations WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM api_tokens WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM bids WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM saved_searches WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM audit_logs WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM outbox WHERE payload->'tenant'->>'organizationId' IN (${org},${otherOrg})`;
  await sql`DELETE FROM source_runs WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM job_runs WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM opportunity_contacts WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM notifications WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM analyses WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM documents WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM opportunities WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM procurement_sources WHERE procurement_id IN (SELECT id FROM procurements WHERE id=${procurement} OR source_id=${sourceId} OR source_id=${crossSourceId})`;
  await sql`DELETE FROM procurement_versions WHERE procurement_id IN (SELECT id FROM procurements WHERE id=${procurement} OR source_id=${sourceId} OR source_id=${crossSourceId})`;
  await sql`DELETE FROM procurements WHERE id=${procurement} OR source_id=${sourceId} OR source_id=${crossSourceId}`;
  await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE organization_id IN (${org},${otherOrg}))`;
  await sql`DELETE FROM memberships WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM users WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM companies WHERE organization_id IN (${org},${otherOrg})`;
  await sql`DELETE FROM organizations WHERE id IN (${org},${otherOrg})`;
  await sql.end();
  await drizzleClient.end();
});
describe('Autenticação e isolamento real no PostgreSQL', () => {
  it('exige login', async () => {
    const r = await app.inject({ url: '/api/v1/opportunities' });
    expect(r.statusCode).toBe(401);
  });
  it('não lista oportunidades de outra empresa no mesmo grupo', async () => {
    const r = await app.inject({ url: '/api/v1/opportunities', headers });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]);
  });
  it('não altera status de outra empresa', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/opportunities/${opportunity}/status`,
      headers,
      payload: { status: 'selected' },
    });
    expect(r.statusCode).toBe(404);
  });
  it('não altera status entre organizações', async () => {
    await sql`UPDATE opportunities SET organization_id=${otherOrg},company_id=${otherCompany} WHERE id=${opportunity}`;
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/opportunities/${opportunity}/status`,
      headers,
      payload: { status: 'selected' },
    });
    expect(r.statusCode).toBe(404);
  });
  it('bloqueia mutação sem cabeçalho de mesma origem', async () => {
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/opportunities/${opportunity}/status`,
      headers: { cookie: `session=${token}` },
      payload: { status: 'selected' },
    });
    expect(r.statusCode).toBe(403);
  });
  it('autentica e cria cookie HttpOnly', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-nthub-request': '1' },
      payload: { email, password: 'test-password-123' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['set-cookie']).toContain('HttpOnly');
  });
  it('coleta repetida atualiza sem duplicar e preserva decisão humana', async () => {
    let title = 'Serviços de digitalização';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  numeroControlePNCP: sourceId,
                  objetoCompra: title,
                  orgaoEntidade: { razaoSocial: 'Test agency' },
                  unidadeOrgao: { ufSigla: 'SP', municipioNome: 'São Paulo' },
                  valorTotalEstimado: 100,
                },
              ],
              totalPaginas: 1,
            }),
            { status: 200 },
          ),
      ),
    );
    const input = { since: '2026-11-01', until: '2026-11-02', modality: 6 };
    await collect(input, tenant);
    const catalog = await app.inject({ url: '/api/v1/opportunities', headers });
    expect(catalog.json()[0].status).toBe('new');
    expect(catalog.json()[0].processingState).toBe('queued');
    expect(catalog.json()[0].analysis).toBeNull();
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/opportunities/' + catalog.json()[0].id + '/status',
          headers,
          payload: { status: 'selected' },
        })
      ).statusCode,
    ).toBe(200);
    title = 'Serviços de digitalização e preservação';
    await collect(input, tenant);
    const rows =
      await sql`SELECT o.status,p.title FROM opportunities o JOIN procurements p ON p.id=o.procurement_id WHERE o.company_id=${company}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('selected');
    expect(rows[0]?.title).toBe(title);
    vi.unstubAllGlobals();
  });
  it('extrai um PDF pesquisável e registra seu hash sem chamar Gemini', async () => {
    const [own] =
      await sql`SELECT id FROM opportunities WHERE company_id=${company}`;
    const pdf = samplePdf().toString();
    const boundary = 'nthub-test-boundary';
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="edital-teste.pdf"\r\nContent-Type: application/pdf\r\n\r\n${pdf}\r\n--${boundary}--\r\n`,
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${own!.id}/document`,
      headers: {
        ...headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().pages).toBe(1);
    const [doc] =
      await sql`SELECT hash,pages FROM documents WHERE id=${response.json().documentId}`;
    expect(doc?.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(doc?.pages[0].text).toContain('Digitalizacao de documentos');
  });
  it('rejeita arquivo que se apresenta como PDF mas não é PDF', async () => {
    const [own] =
      await sql`SELECT id FROM opportunities WHERE company_id=${company}`;
    const boundary = 'nthub-invalid';
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${own!.id}/document`,
      headers: {
        ...headers,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bad.pdf"\r\nContent-Type: application/pdf\r\n\r\nnot a PDF\r\n--${boundary}--\r\n`,
      ),
    });
    expect(response.statusCode).toBe(400);
  });
  it('não expõe andamento de job de outra empresa', async () => {
    const id = randomUUID();
    await sql`INSERT INTO outbox(id,type,payload,published_at) VALUES(${id},'collect',${sql.json({ tenant: { organizationId: otherOrg, companyId: otherCompany } })},now())`;
    const response = await app.inject({ url: `/api/v1/jobs/${id}`, headers });
    expect(response.statusCode).toBe(404);
  });
  it('coleta edital e itens automaticamente, reprocessa sem duplicar e analisa todos os anexos', async () => {
    const [own] =
      await sql`SELECT id,procurement_id FROM opportunities WHERE company_id=${company}`;
    await sql`DELETE FROM documents WHERE organization_id=${org}`;
    sourceId = `99999999999999-1-${Math.floor(Math.random() * 999999999)}/2026`;
    await sql`UPDATE procurements SET source_id=${sourceId} WHERE id=${own!.procurement_id}`;
    const previousKey = config.GEMINI_API_KEY;
    config.GEMINI_API_KEY = 'test-key-no-external-call';
    const ai = vi
      .spyOn(intelligence, 'assess')
      .mockImplementation(async (pages) => ({
        summary: 'Triagem testada',
        relevanceScore: 80,
        requirements: [
          {
            description: 'Digitalização',
            page: pages[0]!.page,
            documentId: pages[0]!.documentId!,
            excerpt: 'Digitalizacao de documentos publicos',
          },
        ],
        risks: [],
        missingInformation: [],
      }));
    const fetch = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/arquivos'))
        return new Response(
          JSON.stringify([
            {
              sequencialDocumento: 1,
              titulo: 'edital.pdf',
              statusAtivo: true,
              url: 'http://127.0.0.1/do-not-fetch',
            },
            { sequencialDocumento: 2, titulo: 'anexo.pdf', statusAtivo: true },
          ]),
          { status: 200 },
        );
      if (url.includes('/itens?'))
        return new Response(
          JSON.stringify([
            {
              numeroItem: 1,
              descricao: 'Digitalizacao de documentos',
              quantidade: 100,
              valorTotal: 1000,
            },
          ]),
          { status: 200 },
        );
      if (/\/arquivos\/[12]$/.test(url))
        return new Response(new Uint8Array(samplePdf()), { status: 200 });
      throw new Error('Unexpected URL: ' + url);
    });
    vi.stubGlobal('fetch', fetch);
    try {
      const result = await enrichOpportunity(tenant, own!.id);
      expect(result.documents).toBe(2);
      expect(result.items).toBe(1);
      expect(result.warnings).toEqual([]);
      await enrichOpportunity(tenant, own!.id);
      const docs =
        await sql`SELECT id,content,source_key FROM documents WHERE opportunity_id=${own!.id} AND active=true`;
      expect(docs).toHaveLength(2);
      expect(docs[0]?.content.subarray(0, 5).toString()).toBe('%PDF-');
      expect(ai).not.toHaveBeenCalled();
      await analyzeOpportunity(tenant, own!.id);
      await analyzeOpportunity(tenant, own!.id);
      expect(ai).toHaveBeenCalledTimes(1);
      expect(ai.mock.calls[0]?.[0]).toHaveLength(2);
      expect(
        fetch.mock.calls.every(([url]) =>
          String(url).startsWith('https://pncp.gov.br/'),
        ),
      ).toBe(true);
      const response = await app.inject({
        url: `/api/v1/opportunities/${own!.id}/content`,
        headers,
      });
      const content = response.json();
      expect(response.statusCode).toBe(200);
      expect(content.items).toHaveLength(1);
      expect(content.documents).toHaveLength(2);
      expect(content.analysis.summary).toBe('Triagem testada');
      expect(content.analysis.adherence.version).toBe('adherence-v2');
      expect(content.analysis.relevanceScore).toBeNull();
      const [listed] = await app
        .inject({ url: '/api/v1/opportunities', headers })
        .then((r) => r.json());
      expect(listed.analysis.adherence.version).toBe('adherence-v2');
      const file = await app.inject({
        url: `/api/v1/documents/${docs[0]!.id}/file`,
        headers,
      });
      expect(file.statusCode).toBe(200);
      expect(file.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      await sql`UPDATE documents SET organization_id=${otherOrg},company_id=${otherCompany},opportunity_id=${opportunity} WHERE id=${docs[0]!.id}`;
      for (const suffix of ['file', 'text']) {
        const foreign = await app.inject({
          url: `/api/v1/documents/${docs[0]!.id}/${suffix}`,
          headers,
        });
        expect(foreign.statusCode).toBe(404);
      }
    } finally {
      config.GEMINI_API_KEY = previousKey;
      ai.mockRestore();
      vi.unstubAllGlobals();
    }
  });
  it('recusa selecionar empresa sem vínculo mesmo com cabeçalho explícito', async () => {
    const r = await app.inject({
      url: '/api/v1/me',
      headers: { ...headers, 'x-company-id': sibling },
    });
    expect(r.statusCode).toBe(401);
  });
  it('recusa selecionar empresa de outra organização', async () => {
    const r = await app.inject({
      url: '/api/v1/me',
      headers: { ...headers, 'x-company-id': otherCompany },
    });
    expect(r.statusCode).toBe(401);
  });
  it('analista não cadastra funcionário nem empresa', async () => {
    for (const url of ['/api/v1/members', '/api/v1/companies']) {
      const r = await app.inject({ method: 'POST', url, headers, payload: {} });
      expect(r.statusCode).toBe(403);
    }
  });
  it('leitor consulta dados e não modifica oportunidades', async () => {
    await sql`UPDATE memberships SET role='viewer' WHERE user_id=${user}`;
    try {
      expect(
        (await app.inject({ url: '/api/v1/bids', headers })).statusCode,
      ).toBe(200);
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/tasks',
        headers,
        payload: { title: 'Não autorizado' },
      });
      expect(r.statusCode).toBe(403);
    } finally {
      await sql`UPDATE memberships SET role='analyst' WHERE user_id=${user}`;
    }
  });
  it('revoga imediatamente sessão quando vínculo é suspenso', async () => {
    await sql`UPDATE memberships SET active=false WHERE user_id=${user}`;
    try {
      expect(
        (await app.inject({ url: '/api/v1/me', headers })).statusCode,
      ).toBe(401);
    } finally {
      await sql`UPDATE memberships SET active=true WHERE user_id=${user}`;
    }
  });
  it('gestor não recebe visão consolidada do grupo', async () => {
    await sql`UPDATE memberships SET role='company_manager' WHERE user_id=${user}`;
    try {
      expect(
        (await app.inject({ url: '/api/v1/analytics/group', headers }))
          .statusCode,
      ).toBe(403);
    } finally {
      await sql`UPDATE memberships SET role='analyst' WHERE user_id=${user}`;
    }
  });
  it('administrador do grupo alterna apenas dentro da organização', async () => {
    await sql`UPDATE users SET group_role='group_admin' WHERE id=${user}`;
    try {
      const own = await app.inject({
        url: '/api/v1/me',
        headers: { ...headers, 'x-company-id': sibling },
      });
      expect(own.statusCode).toBe(200);
      expect(own.json().companyId).toBe(sibling);
      expect(
        (
          await app.inject({
            url: '/api/v1/me',
            headers: { ...headers, 'x-company-id': otherCompany },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await sql`UPDATE users SET group_role='member' WHERE id=${user}`;
    }
  });
  it('não expõe arquivos internos e propostas com identificadores de outra empresa', async () => {
    for (const url of [
      `/api/v1/files/${randomUUID()}/download`,
      `/api/v1/opportunities/${opportunity}/activity`,
    ])
      expect((await app.inject({ url, headers })).statusCode).toBe(404);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/bids',
      headers,
      payload: { opportunityId: opportunity, title: 'Proposta externa' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('cadastra funcionário com convite de uso único e papel isolado', async () => {
    await sql`UPDATE users SET group_role='group_admin' WHERE id=${user}`;
    try {
      const address = `employee-${randomUUID()}@example.invalid`;
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/members',
        headers,
        payload: {
          name: 'Funcionário de teste',
          email: address,
          role: 'viewer',
        },
      });
      expect(r.statusCode).toBe(201);
      const invitationToken = new URLSearchParams(
        r.json().invitationPath.split('#')[1],
      ).get('token');
      const publicHeaders = { 'x-nthub-request': '1' };
      const accept = {
        method: 'POST' as const,
        url: '/api/v1/auth/invitation/accept',
        headers: publicHeaders,
        payload: { token: invitationToken, password: 'employee-password-123' },
      };
      expect((await app.inject(accept)).statusCode).toBe(200);
      expect((await app.inject(accept)).statusCode).toBe(410);
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: publicHeaders,
        payload: { email: address, password: 'employee-password-123' },
      });
      expect(login.statusCode).toBe(200);
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      const context = await app.inject({
        url: '/api/v1/me',
        headers: { cookie },
      });
      expect(context.json().role).toBe('viewer');
      expect(context.json().companies).toHaveLength(1);
      expect(
        (
          await app.inject({
            url: '/api/v1/me',
            headers: { cookie, 'x-company-id': sibling },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await sql`UPDATE users SET group_role='member' WHERE id=${user}`;
    }
  });
  it('registra proposta, exige protocolo e respeita sequência de resultado', async () => {
    const [own] =
      await sql`SELECT id FROM opportunities WHERE company_id=${company}`;
    const body = {
      opportunityId: own!.id,
      title: 'Proposta de teste',
      status: 'draft',
      proposedValue: '1500',
      awardedValue: null,
      protocol: '',
      notes: '',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/bids',
      headers,
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    const url = '/api/v1/bids/' + created.json().id;
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers,
          payload: { ...body, status: 'won', protocol: 'P-01' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers,
          payload: { ...body, status: 'prepared' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers,
          payload: { ...body, status: 'submitted' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers,
          payload: { ...body, status: 'submitted', protocol: 'P-01' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers,
          payload: {
            ...body,
            status: 'won',
            protocol: 'P-01',
            awardedValue: '1400',
          },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('mantém pesquisa salva privada e por empresa', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/saved-searches',
      headers,
      payload: {
        name: 'Minha pesquisa',
        filters: { query: 'digitalização', status: 'all' },
      },
    });
    expect(r.statusCode).toBe(201);
    expect(
      (await app.inject({ url: '/api/v1/saved-searches', headers })).json(),
    ).toHaveLength(1);
    await sql`UPDATE users SET group_role='group_admin' WHERE id=${user}`;
    try {
      expect(
        (
          await app.inject({
            url: '/api/v1/saved-searches',
            headers: { ...headers, 'x-company-id': sibling },
          })
        ).json(),
      ).toHaveLength(0);
    } finally {
      await sql`UPDATE users SET group_role='member' WHERE id=${user}`;
    }
  });
  it('credencial de integração tem escopo, empresa fixa e revogação imediata', async () => {
    await sql`UPDATE users SET group_role='group_admin' WHERE id=${user}`;
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/tokens',
        headers,
        payload: {
          name: 'Teste isolado',
          scopes: ['opportunities:read'],
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      expect(created.statusCode).toBe(201);
      const credentials = {
        authorization: 'Bearer ' + created.json().token,
        'x-company-id': sibling,
        'x-nthub-request': '1',
      };
      const own = await app.inject({
        url: '/api/v1/opportunities',
        headers: credentials,
      });
      expect(own.statusCode).toBe(200);
      expect(own.json().length).toBeGreaterThan(0);
      expect(
        (await app.inject({ url: '/api/v1/bids', headers: credentials }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/companies/switch',
            headers: credentials,
            payload: { companyId: sibling },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/api/v1/integrations/tokens/' + created.json().id + '/revoke',
            headers,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            url: '/api/v1/opportunities',
            headers: credentials,
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await sql`UPDATE users SET group_role='member' WHERE id=${user}`;
    }
  });

  it('integra Compras.gov.br sem duplicar PNCP e preserva decisões e vínculos por empresa', async () => {
    const raw = {
      numeroControlePNCP: crossSourceId,
      idCompra: '12345605000012026',
      objetoCompra: 'Digitalização de acervos',
      orgaoEntidadeRazaoSocial: 'Órgão de teste',
      dataPublicacaoPncp: '2026-11-01T10:00:00',
      modalidadeIdPncp: 6,
      unidadeOrgaoUfSigla: 'SP',
      valorTotalEstimado: 1000,
    };
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        calls.push(url);
        return new Response(
          JSON.stringify(
            url.includes('compras.gov.br')
              ? { resultado: [raw], totalPaginas: 1 }
              : {
                  data: [
                    {
                      numeroControlePNCP: crossSourceId,
                      objetoCompra: raw.objetoCompra,
                      orgaoEntidade: {
                        razaoSocial: raw.orgaoEntidadeRazaoSocial,
                      },
                      unidadeOrgao: { ufSigla: 'SP' },
                      valorTotalEstimado: 1000,
                    },
                  ],
                  totalPaginas: 1,
                },
          ),
          { status: 200 },
        );
      }),
    );
    const input = { since: '2026-11-01', until: '2026-11-02', modality: 6 };
    try {
      await collect({ ...input, source: 'compras' }, tenant);
      const [own] =
        await sql`SELECT id FROM opportunities WHERE company_id=${company} AND procurement_id=(SELECT id FROM procurements WHERE source_id=${crossSourceId})`;
      await sql`UPDATE opportunities SET status='selected' WHERE id=${own!.id}`;
      await collect(input, tenant);
      await sql`UPDATE companies SET capabilities=${sql.json(['digitalização'])} WHERE id=${sibling}`;
      await collect(
        { ...input, source: 'compras' },
        { ...tenant, companyId: sibling },
      );
      expect(
        await sql`SELECT id FROM procurements WHERE source_id=${crossSourceId}`,
      ).toHaveLength(1);
      const sources =
        await sql`SELECT source FROM procurement_sources WHERE source_key=${crossSourceId}`;
      expect(sources).toHaveLength(2);
      expect(
        (await sql`SELECT status FROM opportunities WHERE id=${own!.id}`)[0]
          ?.status,
      ).toBe('selected');
      expect(
        await sql`SELECT id FROM opportunities WHERE procurement_id=(SELECT id FROM procurements WHERE source_id=${crossSourceId})`,
      ).toHaveLength(2);
      expect(calls.some((u) => u.includes('codigoModalidade=5'))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('429 mantém checkpoint e retoma a página interrompida', async () => {
    const runId = randomUUID(),
      pages: number[] = [];
    let throttle = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const page = Number(new URL(String(input)).searchParams.get('pagina'));
        pages.push(page);
        if (page === 2 && throttle) {
          throttle = false;
          return new Response('', {
            status: 429,
            headers: { 'Retry-After': '60' },
          });
        }
        return new Response(JSON.stringify({ data: [], totalPaginas: 2 }), {
          status: 200,
        });
      }),
    );
    const input = { since: '2026-11-04', until: '2026-11-04', modality: 6 };
    try {
      await expect(collect(input, tenant, runId)).rejects.toThrow(
        /Retomada automática/,
      );
      const [run] =
        await sql`SELECT cursor_page,status FROM source_runs WHERE id=${runId}`;
      expect(run?.cursor_page).toBe(2);
      expect(run?.status).toBe('waiting');
      await collect(input, tenant, runId);
      expect(pages).toEqual([1, 2, 2]);
      expect(
        (await sql`SELECT status FROM source_runs WHERE id=${runId}`)[0]
          ?.status,
      ).toBe('completed');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('cadastra contatos e impede leitura/alteração por outra empresa', async () => {
    const [own] =
      await sql`SELECT id FROM opportunities WHERE company_id=${company} LIMIT 1`;
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/opportunities/${own!.id}/contacts`,
      headers,
      payload: {
        name: 'Contato de teste',
        role: 'Compras',
        email: 'contact@example.invalid',
        phone: '21999990000',
        notes: 'Contato fornecido pela equipe.',
      },
    });
    expect(created.statusCode).toBe(201);
    const activity = await app.inject({
      url: `/api/v1/opportunities/${own!.id}/activity`,
      headers,
    });
    expect(activity.json().contacts).toHaveLength(1);
    expect(
      activity
        .json()
        .timeline.some(
          (e: any) =>
            e.kind === 'contact' &&
            e.details.email === 'contact@example.invalid',
        ),
    ).toBe(true);
    const denied = await app.inject({
      method: 'PATCH',
      url: `/api/v1/opportunities/${opportunity}/contacts/${created.json().id}`,
      headers,
      payload: { name: 'Alteração indevida' },
    });
    expect(denied.statusCode).toBe(404);
    await sql`UPDATE memberships SET role='viewer' WHERE user_id=${user}`;
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/opportunities/${own!.id}/contacts`,
            headers,
            payload: { name: 'Sem permissão' },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await sql`UPDATE memberships SET role='analyst' WHERE user_id=${user}`;
    }
  });
  it('guarda valores de cada versão de proposta na linha do tempo sem valor contratado', async () => {
    const [own] =
      await sql`SELECT id FROM opportunities WHERE company_id=${company} LIMIT 1`;
    const body = {
      opportunityId: own!.id,
      title: 'Proposta registrada no CRM',
      proposedValue: '1000.00',
      notes: 'Primeira versão',
      status: 'draft',
      awardedValue: '9999',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/bids',
      headers,
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/v1/bids/' + created.json().id,
          headers,
          payload: { ...body, proposedValue: '1250.00', notes: 'Revisão' },
        })
      ).statusCode,
    ).toBe(200);
    const activity = (
      await app.inject({
        url: `/api/v1/opportunities/${own!.id}/activity`,
        headers,
      })
    ).json();
    const events = activity.timeline.filter(
      (e: any) =>
        e.kind === 'proposal' && e.details.bidId === created.json().id,
    );
    expect(events).toHaveLength(2);
    expect(events.map((e: any) => e.details.proposedValue).sort()).toEqual([
      '1000.00',
      '1250.00',
    ]);
    const bids = (await app.inject({ url: '/api/v1/bids', headers })).json();
    expect(
      bids.find((b: any) => b.id === created.json().id),
    ).not.toHaveProperty('awardedValue');
  });
  it('consolida indicadores do grupo com filtro de empresa validado na organização', async () => {
    await sql`UPDATE users SET group_role='group_admin' WHERE id=${user}`;
    try {
      const filtered = await app.inject({
        url: '/api/v1/analytics/group?companyId=' + company,
        headers,
      });
      expect(filtered.statusCode).toBe(200);
      const own = (
        await app.inject({ url: '/api/v1/opportunities', headers })
      ).json();
      expect(filtered.json().totals.opportunities).toBe(own.length);
      const all = await app.inject({ url: '/api/v1/analytics/group', headers });
      expect(all.json().totals.opportunities).toBeGreaterThanOrEqual(
        own.length,
      );
      expect(all.json().companies).toHaveLength(2);
      expect(
        (
          await app.inject({
            url: '/api/v1/analytics/group?companyId=' + otherCompany,
            headers,
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await sql`UPDATE users SET group_role='member' WHERE id=${user}`;
    }
  });
  it('coleta PDF digitalizado sem chamar IA e só transcreve/análise após solicitação', async () => {
    const [own] =
      await sql`SELECT o.id FROM opportunities o JOIN procurements p ON p.id=o.procurement_id WHERE o.company_id=${company} AND p.source_id=${sourceId}`;
    const oldKey = config.GEMINI_API_KEY;
    config.GEMINI_API_KEY = 'test-key-no-external-call';
    const read = vi
      .spyOn(extraction, 'pdfText')
      .mockResolvedValue({ pages: [{ page: 1, text: '' }], needsOcr: true });
    const transcribe = vi
      .spyOn(extraction, 'transcribePdf')
      .mockResolvedValue([
        { page: 1, text: 'Digitalizacao de documentos publicos.' },
      ]);
    const assess = vi.spyOn(intelligence, 'assess').mockResolvedValue({
      summary: 'Análise manual',
      relevanceScore: null,
      requirements: [],
      risks: [],
      missingInformation: [],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith('/arquivos'))
          return new Response(
            JSON.stringify([
              { sequencialDocumento: 77, titulo: 'digitalizado.pdf' },
            ]),
          );
        if (url.includes('/itens?')) return new Response('[]');
        return new Response(new Uint8Array(samplePdf()));
      }),
    );
    try {
      await enrichOpportunity(tenant, own!.id);
      expect(transcribe).not.toHaveBeenCalled();
      expect(assess).not.toHaveBeenCalled();
      const [doc] =
        await sql`SELECT extraction_status FROM documents WHERE opportunity_id=${own!.id} AND source_key='77'`;
      expect(doc?.extraction_status).toBe('needs_ocr');
      await analyzeOpportunity(tenant, own!.id);
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(assess).toHaveBeenCalledTimes(1);
      const [afterOcr] =
        await sql`SELECT processing_state,processing_error FROM opportunities WHERE id=${own!.id}`;
      expect(afterOcr?.processing_state).toBe('ready');
      expect(afterOcr?.processing_error).toBeNull();
      const requested = await app.inject({
        method: 'POST',
        url: `/api/v1/opportunities/${own!.id}/analyses`,
        headers,
      });
      expect(requested.statusCode).toBe(202);
      const [event] =
        await sql`SELECT payload FROM outbox WHERE id=${requested.json().jobId}`;
      expect(event?.payload.requestedByUser).toBe(true);
    } finally {
      config.GEMINI_API_KEY = oldKey;
      read.mockRestore();
      transcribe.mockRestore();
      assess.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
