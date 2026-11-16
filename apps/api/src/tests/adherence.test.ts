import { describe, it, expect } from 'vitest';
import {
  calculateAdherence,
  companyFacts,
} from '../modules/intelligence/adherence.js';
import {
  resolveCriteria,
  validateEvidence,
} from '../modules/intelligence/index.js';
import type { AdherenceCriterion } from '@nthub/contracts';
const criterion = (
  dimension: AdherenceCriterion['dimension'],
  status: AdherenceCriterion['status'],
  title = dimension,
): AdherenceCriterion => ({
  id: title,
  dimension,
  title,
  status,
  points: 99,
  reason: 'Justificativa',
  companyBasis: [],
  evidence: [],
  pendingEvidence: status === 'unknown' ? 'Comprovar atendimento' : null,
});
describe('Aderência fundamentada e separada por critérios', () => {
  it('não transforma documentação desconhecida em nota zero nem em aprovação', () => {
    const result = calculateAdherence([
      criterion('scope', 'supported'),
      criterion('technical', 'unknown'),
      criterion('documentation', 'unknown'),
    ]);
    expect(result.overallScore).toBeNull();
    expect(result.coverage).toBe(40);
    expect(result.lowerBound).toBe(40);
    expect(result.upperBound).toBe(100);
    expect(result.dimensions[0]?.score).toBe(100);
    expect(result.dimensions[1]?.score).toBeNull();
  });
  it('calcula a nota ponderada no servidor quando todos os critérios são avaliados', () => {
    const result = calculateAdherence([
      criterion('scope', 'supported'),
      criterion('technical', 'partial'),
      criterion('documentation', 'unsupported'),
    ]);
    expect(result.overallScore).toBe(58);
    expect(result.coverage).toBe(100);
    expect(result.status).toBe('complete');
  });
  it('ignora pontos numéricos fornecidos pelo modelo', () => {
    expect(
      calculateAdherence([criterion('scope', 'supported')]).dimensions[0]
        ?.score,
    ).toBe(100);
    expect(
      calculateAdherence([criterion('scope', 'unsupported')]).dimensions[0]
        ?.score,
    ).toBe(0);
  });
  it('não cria nota quando não há evidências avaliáveis', () => {
    const result = calculateAdherence([]);
    expect(result.overallScore).toBeNull();
    expect(result.evaluatedScore).toBeNull();
    expect(result.coverage).toBe(0);
    expect(result.upperBound).toBe(100);
  });
  it('deduplica critério repetido em vários blocos de análise', () => {
    const c = criterion('scope', 'supported');
    expect(calculateAdherence([c, c, c]).dimensions[0]?.criteria).toHaveLength(
      1,
    );
  });
  it('mantém divergência entre blocos pendente mesmo se um terceiro repetir a aprovação', () => {
    const result = calculateAdherence([
      criterion('scope', 'supported'),
      criterion('scope', 'unsupported'),
      criterion('scope', 'supported'),
    ]);
    expect(result.dimensions[0]?.score).toBeNull();
    expect(result.dimensions[0]?.criteria[0]?.reason).toContain('divergentes');
  });
  it('não usa apenas descrição ou palavra-chave como prova técnica/documental', () => {
    const facts = companyFacts({
      description: 'Software de gestão governamental.',
    });
    const input = {
      title: 'Atendimento a SIAFIC',
      status: 'supported' as const,
      reason: 'Exigência identificada',
      evidenceIds: ['E1'],
      companyFactIds: ['C1'],
      pendingEvidence: 'Apresentar comprovação técnica.',
    };
    for (const dimension of ['technical', 'documentation'] as const) {
      const [result] = resolveCriteria(
        [{ ...input, dimension }],
        [{ id: 'E1', page: 1, excerpt: 'O sistema deverá cumprir SIAFIC.' }],
        facts,
      );
      expect(result?.status).toBe('unknown');
      expect(result?.companyBasis).toHaveLength(0);
    }
  });
  it('aceita atuação declarada para afinidade de objeto, mantendo sua origem explícita', () => {
    const facts = companyFacts({
      description: 'Software de gestão governamental.',
    });
    const [result] = resolveCriteria(
      [
        {
          dimension: 'scope',
          title: 'Compatibilidade',
          status: 'supported',
          reason: 'O objeto pede gestão governamental.',
          evidenceIds: ['E1'],
          companyFactIds: ['C1'],
          pendingEvidence: '',
        },
      ],
      [
        {
          id: 'E1',
          page: 1,
          excerpt: 'Sistema integrado de gestão governamental.',
        },
      ],
      facts,
    );
    expect(result?.status).toBe('supported');
    expect(result?.companyBasis).toEqual(['Software de gestão governamental.']);
  });
  it('rejeita critério com citação inexistente e identificação empresarial inventada', () => {
    const input = {
      dimension: 'scope' as const,
      title: 'Objeto',
      status: 'supported' as const,
      reason: 'Razão',
      evidenceIds: ['E9'],
      companyFactIds: [],
      pendingEvidence: '',
    };
    expect(() => resolveCriteria([input], [], [])).toThrow(
      /evidência inexistente/,
    );
    expect(() =>
      resolveCriteria(
        [{ ...input, evidenceIds: ['E1'], companyFactIds: ['C9'] }],
        [{ id: 'E1', page: 1, excerpt: 'Objeto verdadeiro.' }],
        [],
      ),
    ).toThrow(/empresarial inexistente/);
  });
  it('confere também as citações usadas na justificativa da pontuação', () => {
    const c = criterion('scope', 'supported');
    c.evidence = [{ page: 1, excerpt: 'Trecho que não existe.' }];
    const adherence = calculateAdherence([c]);
    expect(() =>
      validateEvidence(
        {
          summary: 'Teste',
          relevanceScore: null,
          adherence,
          requirements: [],
          risks: [],
          missingInformation: [],
        },
        [{ page: 1, text: 'Outro conteúdo.' }],
      ),
    ).toThrow(/evidência/);
  });
  it('não pontua afinidade sem citar o edital, mesmo com perfil empresarial disponível', () => {
    const [result] = resolveCriteria(
      [
        {
          dimension: 'scope',
          title: 'Objeto',
          status: 'supported',
          reason: 'Suposta correspondência',
          evidenceIds: [],
          companyFactIds: ['C1'],
          pendingEvidence: '',
        },
      ],
      [],
      companyFacts({ description: 'Gestão pública.' }),
    );
    expect(result?.status).toBe('unknown');
    expect(calculateAdherence([result!]).coverage).toBe(0);
  });
});
