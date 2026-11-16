import { z } from 'zod';
export const adherenceEvidenceSchema = z.object({
  page: z.number().int().positive(),
  excerpt: z.string().min(8),
  documentId: z.uuid().optional(),
});
export const adherenceCriterionSchema = z.object({
  id: z.string(),
  dimension: z.enum(['scope', 'technical', 'documentation']),
  title: z.string(),
  status: z.enum(['supported', 'partial', 'unsupported', 'unknown']),
  points: z.number().min(0).max(100).nullable(),
  reason: z.string(),
  companyBasis: z.array(z.string()),
  evidence: z.array(adherenceEvidenceSchema),
  pendingEvidence: z.string().nullable(),
});
export const adherenceSchema = z.object({
  version: z.literal('adherence-v2'),
  overallScore: z.number().min(0).max(100).nullable(),
  evaluatedScore: z.number().min(0).max(100).nullable(),
  coverage: z.number().min(0).max(100),
  lowerBound: z.number().min(0).max(100),
  upperBound: z.number().min(0).max(100),
  status: z.enum(['complete', 'inconclusive']),
  explanation: z.string(),
  dimensions: z.array(
    z.object({
      id: z.enum(['scope', 'technical', 'documentation']),
      label: z.string(),
      weight: z.number(),
      score: z.number().nullable(),
      coverage: z.number(),
      earnedPoints: z.number(),
      pendingWeight: z.number(),
      criteria: z.array(adherenceCriterionSchema),
    }),
  ),
});
export type Adherence = z.infer<typeof adherenceSchema>;
export type AdherenceCriterion = z.infer<typeof adherenceCriterionSchema>;
