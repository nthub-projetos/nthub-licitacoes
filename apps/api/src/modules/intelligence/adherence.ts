import { createHash } from 'node:crypto';
import { adherenceSchema, type AdherenceCriterion } from '@nthub/contracts';
export const ANALYSIS_VERSION = 'company-v2-rubric';
export const dimensions = [
  { id: 'scope', label: 'Compatibilidade do objeto', weight: 40 },
  { id: 'technical', label: 'Atendimento técnico', weight: 35 },
  { id: 'documentation', label: 'Comprovação documental', weight: 25 },
] as const;
export type CompanyFact = {
  id: string;
  text: string;
  kind: 'declared_scope' | 'verified_technical' | 'verified_document';
};
export function companyFacts(company: { description: string }): CompanyFact[] {
  return company.description.trim()
    ? [{ id: 'C1', kind: 'declared_scope', text: company.description.trim() }]
    : [];
}
const points = { supported: 100, partial: 50, unsupported: 0, unknown: null };
const normalized = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export function criterionId(dimension: string, title: string) {
  return createHash('sha256')
    .update(dimension + ':' + normalized(title))
    .digest('hex')
    .slice(0, 20);
}
export function calculateAdherence(input: AdherenceCriterion[]) {
  const unique = new Map<string, AdherenceCriterion>();
  const conflicts = new Set<string>();
  for (const item of input) {
    const id = criterionId(item.dimension, item.title),
      previous = unique.get(id);
    const current = { ...item, id, points: points[item.status] };
    if (conflicts.has(id)) continue;
    if (
      previous &&
      previous.status !== current.status &&
      previous.status !== 'unknown' &&
      current.status !== 'unknown'
    ) {
      conflicts.add(id);
      unique.set(id, {
        ...current,
        status: 'unknown',
        points: null,
        reason:
          'Os trechos produziram avaliações divergentes deste critério. A equipe precisa conferir as evidências.',
        pendingEvidence: 'Revisar as avaliações divergentes.',
        evidence: [...previous.evidence, ...current.evidence],
      });
    } else if (
      !previous ||
      (previous.status === 'unknown' && current.status !== 'unknown')
    )
      unique.set(id, current);
  }
  const groups = dimensions.map((d) => {
    let criteria = [...unique.values()].filter((c) => c.dimension === d.id);
    if (!criteria.length)
      criteria = [
        {
          id: criterionId(d.id, 'Avaliação pendente'),
          dimension: d.id,
          title: 'Avaliação pendente',
          status: 'unknown',
          points: null,
          reason:
            d.id === 'technical'
              ? 'Os requisitos técnicos ainda não receberam uma avaliação fundamentada com comprovação da empresa.'
              : d.id === 'documentation'
                ? 'Os documentos da empresa ainda não foram verificados em relação às exigências deste edital.'
                : 'Não há evidências suficientes para comparar o objeto com a atuação declarada da empresa.',
          companyBasis: [],
          evidence: [],
          pendingEvidence: 'Conferir os requisitos e a comprovação da empresa.',
        },
      ];
    const known = criteria.filter((c) => c.points !== null),
      coverage = known.length / criteria.length;
    const earnedPoints =
      (d.weight * criteria.reduce((n, c) => n + (c.points ?? 0), 0)) /
      criteria.length /
      100;
    return {
      ...d,
      score: known.length
        ? Math.round(known.reduce((n, c) => n + c.points!, 0) / known.length)
        : null,
      coverage: Math.round(coverage * 100),
      earnedPoints,
      pendingWeight: d.weight * (1 - coverage),
      criteria,
    };
  });
  const earned = groups.reduce((n, d) => n + d.earnedPoints, 0),
    pending = groups.reduce((n, d) => n + d.pendingWeight, 0),
    coverage = 100 - pending;
  const complete = pending < 0.000001;
  return adherenceSchema.parse({
    version: 'adherence-v2',
    overallScore: complete ? Math.round(earned) : null,
    evaluatedScore: coverage ? Math.round((earned / coverage) * 100) : null,
    coverage: Math.round(coverage),
    lowerBound: Math.round(earned),
    upperBound: Math.round(earned + pending),
    status: complete ? 'complete' : 'inconclusive',
    explanation: complete
      ? 'Nota ponderada: objeto 40%, atendimento técnico 35% e comprovação documental 25%. Cada critério comprovado vale 100, parcial 50 e incompatível 0.'
      : `Resultado geral inconclusivo: ${Math.round(coverage)}% do peso foi avaliado e ${Math.round(pending)}% depende de comprovação. Pendências não recebem zero. A afinidade com o objeto usa a atuação declarada e não comprova habilitação.`,
    dimensions: groups,
  });
}
