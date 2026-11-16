import { adherenceSchema } from './adherence.js';
export * from './adherence.js';
import { z } from 'zod';
export * from './management.js';
export const statuses = [
  'new',
  'review',
  'selected',
  'discarded',
  'submitted',
  'won',
  'lost',
] as const;
export const statusSchema = z.enum(statuses);
export const syncSchema = z
  .object({
    source: z.enum(['pncp', 'compras']).default('pncp'),
    since: z.iso.date(),
    until: z.iso.date(),
    modality: z.number().int().min(1).max(14).default(6),
    uf: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  })
  .refine(
    (v) =>
      v.since <= v.until &&
      (Date.parse(v.until) - Date.parse(v.since)) / 86400000 <= 31,
    'Use um intervalo de até 31 dias.',
  );
export const analysisSchema = z.object({
  summary: z.string().min(1),
  relevanceScore: z.number().min(0).max(100).nullable(),
  adherence: adherenceSchema.optional(),
  requirements: z.array(
    z.object({
      description: z.string(),
      page: z.number().int().positive(),
      excerpt: z.string().min(8),
      documentId: z.uuid().optional(),
    }),
  ),
  risks: z.array(
    z.object({
      description: z.string(),
      page: z.number().int().positive(),
      excerpt: z.string().min(8),
      documentId: z.uuid().optional(),
    }),
  ),
  missingInformation: z.array(z.string()),
});
export type Assessment = z.infer<typeof analysisSchema>;
export type Status = z.infer<typeof statusSchema>;
export interface Opportunity {
  decisionReason?: string | null;
  sources?: ('pncp' | 'compras')[];
  assignedUserId?: string | null;
  assignedName?: string | null;
  id: string;
  title: string;
  agency: string;
  uf: string | null;
  city: string | null;
  value: string | null;
  deadline: string | null;
  sourceId: string;
  sourceUrl: string;
  status: Status;
  score: number;
  matches: string[];
  analysis: Assessment | null;
  analysisAt: string | null;
  documentName: string | null;
  createdAt: string;
  processingState: string;
  processingError: string | null;
  syncedAt: string | null;
  documentCount: number;
}
export interface SourceDocument {
  id: string;
  name: string;
  sourceUrl: string | null;
  mime: string;
  extractionStatus: string;
  extractionError: string | null;
  pageCount: number;
  downloadable: boolean;
}
export interface ProcurementItem {
  numeroItem: number;
  descricao: string;
  quantidade?: number | null;
  unidadeMedida?: string | null;
  valorUnitarioEstimado?: number | null;
  valorTotal?: number | null;
  criterioJulgamentoNome?: string | null;
  situacaoCompraItemNome?: string | null;
}
export interface OpportunityContent {
  origins?: { source: 'pncp' | 'compras'; url: string }[];
  documents: SourceDocument[];
  items: ProcurementItem[];
  source: Record<string, unknown>;
  processingState: string;
  processingError: string | null;
  syncedAt: string | null;
  analysis: Assessment | null;
  analysisAt: string | null;
}
export const capabilities = [
  'digitalização',
  'gestão documental',
  'microfilmagem',
  'GED',
  'SIGAD',
  'OCR',
  'guarda documental',
  'preservação documental',
];

export * from './permissions.js';
