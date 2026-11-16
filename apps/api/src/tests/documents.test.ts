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
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  validatePncpUrl,
  downloadOfficial,
  procurementBase,
} from '../modules/documents/network.js';
import {
  pdfText,
  zipEntries,
  sanitizeExtractedText,
} from '../modules/documents/extract.js';
import { validateEvidence } from '../modules/intelligence/index.js';
import {
  evidenceSources,
  resolveSelections,
} from '../modules/intelligence/index.js';
import { samplePdf } from './pdf-fixture.js';
import { sampleZip } from './zip-fixture.js';
afterEach(() => vi.unstubAllGlobals());
describe('Coleta oficial de documentos', () => {
  it('normaliza caracteres rejeitados pelo JSONB sem alterar o original binário', () => {
    expect(sanitizeExtractedText('Texto\u0000PDF\ud800')).toBe('Texto PDF�');
  });
  it('resolve citações usando os trechos originais, sem texto inventado pelo modelo', () => {
    const sources = evidenceSources([
      {
        page: 12,
        documentId: '30000000-0000-4000-8000-000000000001',
        text: 'Exige-se experiência comprovada em digitalização de documentos.',
      },
    ]);
    const result = resolveSelections(
      {
        summary: 'Análise',
        relevanceScore: 70,
        requirements: [
          { description: 'Comprovação de experiência', evidenceId: 'E1' },
        ],
        risks: [],
        missingInformation: [],
      },
      sources,
    );
    expect(result.requirements[0]?.page).toBe(12);
    expect(result.requirements[0]?.excerpt).toBe(
      'Exige-se experiência comprovada em digitalização de documentos.',
    );
    expect(() =>
      resolveSelections(
        {
          summary: 'Análise',
          relevanceScore: 70,
          requirements: [{ description: 'Inventado', evidenceId: 'E999' }],
          risks: [],
          missingInformation: [],
        },
        sources,
      ),
    ).toThrow(/inexistente/);
  });
  it('monta URL exclusivamente pelo identificador PNCP', () =>
    expect(procurementBase('45332095000189-1-000186/2026')).toBe(
      'https://pncp.gov.br/api/pncp/v1/orgaos/45332095000189/compras/2026/186',
    ));
  it.each([
    'http://127.0.0.1/',
    'https://pncp.gov.br.evil.test/file',
    'https://evil.test/',
    'file:///etc/passwd',
    'https://user:password@pncp.gov.br/file',
    'https://pncp.gov.br:1234/file',
  ])('rejeita endereço não autorizado: %s', (url) =>
    expect(() => validatePncpUrl(url)).toThrow(),
  );
  it('bloqueia redirecionamento para redes internas', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/admin' },
        }),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      downloadOfficial('https://pncp.gov.br/test'),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('interrompe resposta maior que o limite sem depender de Content-Length', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('123456789')),
    );
    await expect(
      downloadOfficial('https://pncp.gov.br/test', 4),
    ).rejects.toThrow(/tamanho/);
  });
  it('lê texto de PDF sem interação do usuário', async () => {
    const result = await pdfText(samplePdf());
    expect(result.pages[0]?.text).toContain('Digitalizacao');
    expect(result.needsOcr).toBe(false);
  });
  it('abre anexos dentro de ZIP sem gravar caminhos no disco', async () => {
    const entries = await zipEntries(sampleZip);
    expect(entries[0]?.name).toBe('pasta/edital.pdf');
    expect(entries[0]?.bytes.toString()).toContain('%PDF-');
  });
  it('rejeita ZIP com tamanho expandido exagerado antes de descompactar', async () => {
    const bomb = Buffer.from(sampleZip);
    const offset = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(30 * 1024 * 1024, offset + 24);
    await expect(zipEntries(bomb)).rejects.toThrow(/limite/);
  });
  it('distingue página 1 de documentos diferentes na evidência', () => {
    const a = '30000000-0000-4000-8000-000000000001',
      b = '30000000-0000-4000-8000-000000000002';
    const result = {
      summary: 'Resumo',
      relevanceScore: 20,
      requirements: [
        {
          description: 'Exigência',
          page: 1,
          documentId: b,
          excerpt: 'trecho do documento A',
        },
      ],
      risks: [],
      missingInformation: [],
    };
    expect(() =>
      validateEvidence(result, [
        { page: 1, documentId: a, text: 'trecho do documento A' },
        { page: 1, documentId: b, text: 'texto diferente do documento B' },
      ]),
    ).toThrow(/evidência/);
  });
});
