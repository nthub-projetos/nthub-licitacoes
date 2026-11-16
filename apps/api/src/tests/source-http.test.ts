import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({
  cache: new Map<string, string>(),
  wait: 0,
  locked: false,
}));
vi.mock('../modules/sources/http-store.js', () => ({
  httpStore: {
    reserve: vi.fn(async () => state.wait),
    cooldown: vi.fn(async (_host: string, ms: number) => {
      state.wait = ms;
    }),
    get: vi.fn(async (url: string) => state.cache.get(url) ?? null),
    put: vi.fn(async (url: string, v: string) => {
      state.cache.set(url, v);
    }),
    lock: vi.fn(async () => !state.locked),
    unlock: vi.fn(async () => {}),
  },
}));
import {
  sourceFetch,
  sourceJson,
  SourceThrottleError,
  retryAfterMs,
} from '../modules/sources/http.js';
import { comprasPage, comprasQuery } from '../modules/sources/compras.js';
import { syncSchema } from '@nthub/contracts';
beforeEach(() => {
  state.cache.clear();
  state.wait = 0;
  state.locked = false;
});
afterEach(() => vi.unstubAllGlobals());
describe('Fontes oficiais: limites e cache', () => {
  it('interpreta Retry-After em segundos e data HTTP sem antecipar a liberação', () => {
    expect(retryAfterMs('120')).toBe(120000);
    expect(
      retryAfterMs(
        'Fri, 13 Nov 2026 15:02:00 GMT',
        Date.parse('2026-11-13T15:00:00Z'),
      ),
    ).toBe(120000);
    expect(retryAfterMs('inválido')).toBe(60000);
  });
  it('429 instala pausa compartilhada e impede novas chamadas durante o bloqueio', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('', { status: 429, headers: { 'retry-after': '120' } }),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      sourceFetch('https://pncp.gov.br/api/test'),
    ).rejects.toMatchObject({ retryAfterMs: 120000 });
    await expect(
      sourceFetch('https://pncp.gov.br/api/other'),
    ).rejects.toBeInstanceOf(SourceThrottleError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reutiliza página pública em consultas de empresas diferentes', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [1], totalPaginas: 1 })),
    );
    vi.stubGlobal('fetch', fetch);
    const url = 'https://pncp.gov.br/api/test';
    expect(await sourceJson(url)).toEqual(await sourceJson(url));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('não armazena erro HTTP nem deixa lock após falha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    await expect(sourceJson('https://pncp.gov.br/api/test')).rejects.toThrow(
      /500/,
    );
    expect(state.cache.size).toBe(0);
  });
  it('coalesce consulta já em andamento sem repetir a chamada', async () => {
    state.locked = true;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      sourceJson('https://pncp.gov.br/api/test'),
    ).rejects.toBeInstanceOf(SourceThrottleError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejeita origem externa antes de transmitir dados', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(sourceFetch('http://127.0.0.1/private')).rejects.toThrow(
      /não autorizada/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('converte modalidade PNCP para Compras e mantém datas/UF/página', () => {
    const query = new URL(
      comprasQuery(
        syncSchema.parse({
          source: 'compras',
          since: '2026-11-12',
          until: '2026-11-13',
          modality: 6,
          uf: 'SP',
        }),
        3,
      ),
    );
    expect(query.searchParams.get('codigoModalidade')).toBe('5');
    expect(query.searchParams.get('pagina')).toBe('3');
    expect(query.searchParams.get('dataPublicacaoPncpFinal')).toBe(
      '2026-11-14',
    );
    expect(query.searchParams.get('unidadeOrgaoUfSigla')).toBe('SP');
  });
  it('não transforma uma modalidade sem suporte em pregão silenciosamente', () => {
    expect(() =>
      comprasQuery(
        syncSchema.parse({
          source: 'compras',
          since: '2026-11-12',
          until: '2026-11-13',
          modality: 14,
        }),
        1,
      ),
    ).toThrow(/não suportada/);
  });
  it('normaliza Compras para enriquecimento PNCP e filtra excluídos/modalidade divergente', async () => {
    const raw = {
      idCompra: '12345605000012026',
      numeroControlePNCP: '12345678000199-1-000001/2026',
      objetoCompra: 'Locação de scanners',
      dataPublicacaoPncp: '2026-11-12T10:00:00',
      orgaoEntidadeRazaoSocial: 'Órgão',
      modalidadeIdPncp: 6,
      dataEncerramentoPropostaPncp: '2026-12-01T10:00:00',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              resultado: [
                raw,
                { ...raw, contratacaoExcluida: true },
                { ...raw, modalidadeIdPncp: 7 },
                { ...raw, dataPublicacaoPncp: '2026-11-14T00:00:00' },
              ],
              totalPaginas: 1,
            }),
          ),
      ),
    );
    const batch = await comprasPage(
      syncSchema.parse({
        since: '2026-11-12',
        until: '2026-11-13',
        source: 'compras',
      }),
      1,
    );
    expect(batch.data).toHaveLength(1);
    expect(batch.data[0]?.orgaoEntidade.razaoSocial).toBe('Órgão');
    expect(batch.data[0]?.dataEncerramentoProposta).toBe(
      raw.dataEncerramentoPropostaPncp,
    );
  });
});
