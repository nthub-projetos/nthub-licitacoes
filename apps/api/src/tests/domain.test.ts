import { matchCompany } from '../modules/sources/matching.js';
import { describe, it, expect } from 'vitest';
import { classify } from '../modules/classification/index.js';
import { validateEvidence } from '../modules/intelligence/index.js';
import { syncSchema, analysisSchema } from '@nthub/contracts';
describe('Classificação Safe', () => {
  it('reconhece siglas isoladas', () =>
    expect(
      classify('Sistema GED com OCR', ['GED', 'OCR']).matches,
    ).toHaveLength(2));
  it('considera acentos e caixa', () =>
    expect(
      classify('DIGITALIZAÇÃO e gestão documental', [
        'digitalização',
        'gestão documental',
      ]).matches,
    ).toHaveLength(2));
  it('não confunde siglas com partes de palavras', () =>
    expect(
      classify('Mercado de tecnologia', ['GED', 'OCR']).matches,
    ).toHaveLength(0));
  it('não sugere oportunidades sem aderência', () =>
    expect(classify('Compra de alimentos', ['microfilmagem']).score).toBe(0));
});
describe('Evidências de IA', () => {
  const base = {
    summary: 'Análise',
    relevanceScore: 80,
    requirements: [
      {
        description: 'Exigência',
        page: 1,
        excerpt: 'Digitalização de documentos',
      },
    ],
    risks: [],
    missingInformation: [],
  };
  it('aceita citação literal na página correta', () =>
    expect(
      validateEvidence(base, [
        { page: 1, text: 'Objeto: Digitalização de documentos públicos.' },
      ]),
    ).toEqual(base));
  it('rejeita trechos inventados', () =>
    expect(() =>
      validateEvidence(base, [{ page: 1, text: 'Compra de papel.' }]),
    ).toThrow(/evidência/));
  it('rejeita página incorreta', () =>
    expect(() =>
      validateEvidence(base, [
        { page: 2, text: 'Digitalização de documentos' },
      ]),
    ).toThrow());
  it('rejeita score fora da faixa', () =>
    expect(
      analysisSchema.safeParse({ ...base, relevanceScore: 101 }).success,
    ).toBe(false));
});
describe('Coleta', () => {
  it('rejeita períodos invertidos', () =>
    expect(
      syncSchema.safeParse({ since: '2026-11-12', until: '2026-11-01' })
        .success,
    ).toBe(false));
  it('limita período a 31 dias', () =>
    expect(
      syncSchema.safeParse({ since: '2026-01-01', until: '2026-11-01' })
        .success,
    ).toBe(false));
});

describe('Critérios específicos por empresa', () => {
  const meta = { uf: 'SP', value: 1000, deadline: null };
  it('IA encontra aluguel de impressoras e exclui compra sem locação', () => {
    expect(
      matchCompany(
        'Locação de impressoras',
        ['impressoras'],
        { requiredKeywords: ['locação', 'aluguel'] },
        meta,
      ).matches,
    ).toHaveLength(1);
    expect(
      matchCompany(
        'Compra de impressoras',
        ['impressoras'],
        { requiredKeywords: ['locação', 'aluguel'] },
        meta,
      ).matches,
    ).toHaveLength(0);
  });
  it('aplica termos negativos, UF e limites de valor', () => {
    expect(
      matchCompany(
        'Software hospitalar',
        ['software'],
        { excludedKeywords: ['hospitalar'] },
        meta,
      ).score,
    ).toBe(0);
    expect(
      matchCompany('Software', ['software'], { ufs: ['RJ'] }, meta).score,
    ).toBe(0);
    expect(
      matchCompany('Software', ['software'], { minimumValue: 2000 }, meta)
        .score,
    ).toBe(0);
  });
  it('exige todos os termos quando configurado', () => {
    expect(
      matchCompany(
        'Software de governo',
        ['software', 'governo'],
        { matchMode: 'all' },
        meta,
      ).matches,
    ).toHaveLength(2);
    expect(
      matchCompany(
        'Software privado',
        ['software', 'governo'],
        { matchMode: 'all' },
        meta,
      ).score,
    ).toBe(0);
  });
  it('omite prazo vencido salvo escolha explícita', () => {
    expect(
      matchCompany(
        'Digitalização',
        ['digitalização'],
        {},
        { ...meta, deadline: '2020-01-01' },
      ).score,
    ).toBe(0);
    expect(
      matchCompany(
        'Digitalização',
        ['digitalização'],
        { includeExpired: true },
        { ...meta, deadline: '2020-01-01' },
      ).score,
    ).toBeGreaterThan(0);
  });
});
