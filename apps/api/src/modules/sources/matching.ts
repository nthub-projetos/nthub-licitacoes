import { randomUUID } from 'node:crypto';
import { searchSettingsSchema } from '@nthub/contracts';
import { sql } from '../../core/db.js';
import { classify, normalize } from '../classification/index.js';
import { enqueueEnrichment } from '../documents/index.js';
import type { Tenant } from '../identity/index.js';
export function matchCompany(
  text: string,
  keywords: string[],
  settings: unknown,
  meta: { uf: string | null; value: number | null; deadline: string | null },
) {
  const rules = searchSettingsSchema.parse(settings || {});
  const normalized = normalize(text);
  const none = { matches: [] as string[], score: 0 };
  if (rules.excludedKeywords.some((k) => normalized.includes(normalize(k))))
    return none;
  if (
    rules.requiredKeywords.length &&
    !rules.requiredKeywords.some((k) => normalized.includes(normalize(k)))
  )
    return none;
  if (rules.ufs.length && (!meta.uf || !rules.ufs.includes(meta.uf)))
    return none;
  if (
    (rules.minimumValue !== null || rules.maximumValue !== null) &&
    meta.value === null
  )
    return none;
  if (
    meta.value !== null &&
    ((rules.minimumValue !== null && meta.value < rules.minimumValue) ||
      (rules.maximumValue !== null && meta.value > rules.maximumValue))
  )
    return none;
  if (
    !rules.includeExpired &&
    meta.deadline &&
    Date.parse(meta.deadline) < Date.now()
  )
    return none;
  const result = classify(text, keywords);
  return rules.matchMode === 'all' && result.matches.length !== keywords.length
    ? none
    : result;
}
export async function rematchCatalog(t: Tenant) {
  const [company] =
    await sql`SELECT capabilities,search_settings FROM companies WHERE id=${t.companyId} AND organization_id=${t.organizationId} AND active AND NOT is_parent`;
  if (!company) throw new Error('Empresa indisponível.');
  let count = 0,
    offset = 0;
  while (true) {
    const rows =
      await sql`SELECT id,title,uf,value,deadline FROM procurements ORDER BY id LIMIT 500 OFFSET ${offset}`;
    if (!rows.length) break;
    for (const p of rows) {
      const result = matchCompany(
        p.title,
        company.capabilities as string[],
        company.search_settings,
        {
          uf: p.uf,
          value: p.value == null ? null : Number(p.value),
          deadline: p.deadline ? new Date(p.deadline).toISOString() : null,
        },
      );
      if (!result.matches.length) continue;
      const [op] = await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${t.organizationId + ':' + p.id},0))`;
        return tx`INSERT INTO opportunities(id,organization_id,company_id,procurement_id,score,matches) SELECT ${randomUUID()},${t.organizationId},${t.companyId},${p.id},${result.score},${tx.json(result.matches)} WHERE NOT EXISTS(SELECT 1 FROM opportunity_routes r WHERE r.organization_id=${t.organizationId} AND r.procurement_id=${p.id} AND r.excluded_company_id=${t.companyId}) ON CONFLICT(company_id,procurement_id) DO UPDATE SET score=EXCLUDED.score,matches=EXCLUDED.matches RETURNING id`;
      });
      if (op) {
        count++;
        await enqueueEnrichment(t, op.id);
      }
    }
    offset += rows.length;
  }
  return { matched: count };
}
