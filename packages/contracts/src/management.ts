import { z } from 'zod';
export const roleSchema = z.enum(['company_manager', 'analyst', 'viewer']);
export type CompanyRole = z.infer<typeof roleSchema>;
export const searchSettingsSchema = z
  .object({
    requiredKeywords: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .default([]),
    excludedKeywords: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .default([]),
    ufs: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .max(27)
      .default([]),
    minimumValue: z.number().nonnegative().nullable().default(null),
    maximumValue: z.number().nonnegative().nullable().default(null),
    matchMode: z.enum(['any', 'all']).default('any'),
    includeExpired: z.boolean().default(false),
  })
  .refine(
    (v) =>
      v.minimumValue == null ||
      v.maximumValue == null ||
      v.maximumValue >= v.minimumValue,
    'Valor máximo deve ser maior que o mínimo.',
  );
export const companySchema = z.object({
  name: z.string().trim().min(2).max(180),
  shortName: z.string().trim().min(2).max(50),
  description: z.string().max(3000).default(''),
  cnpj: z
    .string()
    .regex(/^\d{14}$/)
    .nullable()
    .default(null),
  website: z.url().startsWith('https://').nullable().default(null),
  capabilities: z.array(z.string().trim().min(2).max(120)).max(150),
  searchSettings: searchSettingsSchema,
  isParent: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type SearchSettings = z.infer<typeof searchSettingsSchema>;
export interface Company {
  id: string;
  name: string;
  shortName: string;
  description: string;
  cnpj: string | null;
  website: string | null;
  logoUrl: string | null;
  capabilities: string[];
  searchSettings: SearchSettings;
  isParent: boolean;
  active: boolean;
  role: CompanyRole | 'group_admin';
}
export interface UserContext {
  permissions?: string[];
  userId: string;
  organizationId: string;
  companyId: string;
  email: string;
  name: string;
  role: CompanyRole | 'group_admin';
  isGroupAdmin: boolean;
  company: Company;
  companies: Company[];
  geminiConfigured: boolean;
}
export interface Member {
  permissionProfileId?: string | null;
  permissionProfileName?: string | null;
  id: string;
  name: string;
  email: string;
  role: CompanyRole | 'group_admin';
  active: boolean;
  groupRole: string;
}
export interface Bid {
  id: string;
  opportunityId: string;
  title: string;
  proposedValue: string | null;
  status: 'draft' | 'prepared' | 'submitted' | 'won' | 'lost' | 'cancelled';
  protocol: string;
  notes: string;
  submittedAt: string | null;
  createdAt: string;
  opportunityTitle: string;
}
export interface WorkTask {
  id: string;
  title: string;
  dueAt: string | null;
  assignedUserId: string | null;
  assignedName: string | null;
  status: 'pending' | 'done';
  opportunityId: string | null;
}
export interface Notification {
  id: string;
  title: string;
  body: string;
  kind: string;
  opportunityId: string | null;
  read: boolean;
  createdAt: string;
  emailStatus: string;
}
export const bidSchema = z.object({
  opportunityId: z.uuid(),
  title: z.string().trim().min(2).max(250),
  proposedValue: z
    .string()
    .regex(/^\d{1,14}(\.\d{1,2})?$/)
    .nullable()
    .default(null),
  status: z
    .enum(['draft', 'prepared', 'submitted', 'won', 'lost', 'cancelled'])
    .default('draft'),
  protocol: z.string().max(200).default(''),
  notes: z.string().max(10000).default(''),
});
export const taskSchema = z.object({
  title: z.string().trim().min(2).max(300),
  opportunityId: z.uuid().nullable().default(null),
  assignedUserId: z.uuid().nullable().default(null),
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
