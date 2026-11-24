import { sql as q } from 'drizzle-orm';
import { catalogQuerySchema } from '@nthub/contracts';
import { db, sql } from '../../core/db.js';
import type { Tenant } from '../identity/index.js';
import { listOpportunities } from './index.js';
export async function opportunityPage(t: Tenant, input: unknown) {
  const p = catalogQuerySchema.parse(input);
  const conditions = [
    q`o.organization_id=${t.organizationId} AND o.company_id=${t.companyId}`,
  ];
  if (p.search)
    conditions.push(
      q`strpos(lower(concat_ws(' ',p.title,p.agency,p.city,p.uf,(SELECT name FROM users WHERE id=o.assigned_user_id AND organization_id=o.organization_id))),lower(${p.search}))>0`,
    );
  if (p.stage !== 'all') conditions.push(q`o.status=${p.stage}`);
  if (p.area === 'pipeline') conditions.push(q`o.status<>'discarded'`);
  if (p.area === 'discarded') conditions.push(q`o.status='discarded'`);
  if (p.deadline === 'expired') conditions.push(q`p.deadline<now()`);
  if (p.deadline === 'open') conditions.push(q`p.deadline>=now()`);
  if (p.deadline === 'unknown') conditions.push(q`p.deadline IS NULL`);
  if (p.processing === 'pending')
    conditions.push(q`o.processing_state IN ('pending','queued','processing')`);
  if (p.processing === 'failed')
    conditions.push(
      q`(o.processing_state='failed' OR EXISTS(SELECT 1 FROM documents d WHERE d.opportunity_id=o.id AND d.active AND d.extraction_status='failed'))`,
    );
  if (['needs_ocr', 'unsupported'].includes(p.processing))
    conditions.push(
      q`EXISTS(SELECT 1 FROM documents d WHERE d.opportunity_id=o.id AND d.active AND d.extraction_status=${p.processing})`,
    );
  if (p.processing === 'missing')
    conditions.push(
      q`o.processing_state NOT IN ('pending','queued','processing') AND NOT EXISTS(SELECT 1 FROM documents d WHERE d.opportunity_id=o.id AND d.active)`,
    );
  if (p.processing === 'ready') conditions.push(q`o.processing_state='ready'`);
  const where = q.join(conditions, q` AND `);
  const count = await db.execute(
    q`SELECT count(*)::int AS total FROM opportunities o JOIN procurements p ON p.id=o.procurement_id WHERE ${where}`,
  );
  const total = Number(count[0]?.total || 0);
  const page = Math.min(p.page, Math.max(1, Math.ceil(total / p.pageSize)));
  const items = await listOpportunities(t, {
    where,
    limit: p.pageSize,
    offset: (page - 1) * p.pageSize,
  });
  const [summary] =
    await sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE o.status='review')::int AS review,count(*) FILTER(WHERE o.status='selected')::int AS selected,count(*) FILTER(WHERE o.status NOT IN ('won','lost','discarded') AND p.deadline>=now() AND p.deadline<now()+interval '7 days')::int AS "upcomingDeadlines",count(*) FILTER(WHERE o.status NOT IN ('won','lost','discarded') AND p.deadline>=now())::int AS active,count(*) FILTER(WHERE o.status NOT IN ('won','lost','discarded') AND p.deadline<now())::int AS expired,count(*) FILTER(WHERE o.status NOT IN ('won','lost','discarded') AND p.deadline IS NULL)::int AS "unknownDeadline",count(*) FILTER(WHERE o.status='new')::int AS new,count(*) FILTER(WHERE o.status='discarded')::int AS discarded,coalesce(sum(p.value) FILTER(WHERE o.status NOT IN ('won','lost','discarded') AND p.deadline>=now()),0) AS "estimatedPipeline",coalesce(sum(p.value) FILTER(WHERE o.status NOT IN ('won','lost','discarded') AND p.deadline<now()),0) AS "expiredPipeline" FROM opportunities o JOIN procurements p ON p.id=o.procurement_id WHERE o.organization_id=${t.organizationId} AND o.company_id=${t.companyId}`;
  return { items, total, page, pageSize: p.pageSize, summary };
}
