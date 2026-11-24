import { z } from 'zod';
export const catalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(200).default(''),
  stage: z
    .enum([
      'all',
      'new',
      'review',
      'selected',
      'submitted',
      'won',
      'lost',
      'discarded',
    ])
    .default('all'),
  area: z.enum(['all', 'pipeline', 'discarded']).default('all'),
  deadline: z.enum(['all', 'open', 'expired', 'unknown']).default('all'),
  processing: z
    .enum([
      'all',
      'pending',
      'failed',
      'needs_ocr',
      'unsupported',
      'missing',
      'ready',
    ])
    .default('all'),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export interface CatalogSummary {
  review: number;
  selected: number;
  upcomingDeadlines: number;
  total: number;
  active: number;
  expired: number;
  unknownDeadline: number;
  new: number;
  discarded: number;
  estimatedPipeline: string;
  expiredPipeline: string;
}
export interface ProcessingIssue {
  kind: 'pending' | 'failed' | 'needs_ocr' | 'unsupported' | 'missing';
  title: string;
  action: string;
}
