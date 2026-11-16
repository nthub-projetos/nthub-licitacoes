import { sql, db } from '../../core/db.js';
import { sql as query } from 'drizzle-orm';
import type { Tenant } from '../identity/index.js';
export async function requireOpportunity(tenant: Tenant, id: string) {
  const [row] =
    await sql`SELECT o.*,p.title FROM opportunities o JOIN procurements p ON p.id=o.procurement_id WHERE o.id=${id} AND o.organization_id=${tenant.organizationId} AND o.company_id=${tenant.companyId}`;
  if (!row)
    throw Object.assign(new Error('Oportunidade não encontrada.'), {
      statusCode: 404,
    });
  return row;
}
export async function listOpportunities(t: Tenant) {
  return db.execute(
    query`SELECT o.id,o.decision_reason AS "decisionReason",o.assigned_user_id AS "assignedUserId",(SELECT name FROM users WHERE id=o.assigned_user_id AND organization_id=o.organization_id) AS "assignedName",coalesce((SELECT jsonb_agg(ps.source ORDER BY ps.source) FROM procurement_sources ps WHERE ps.procurement_id=p.id),'["pncp"]'::jsonb) AS sources,p.title,p.agency,p.uf,p.city,p.value,p.deadline,p.source_id AS "sourceId",p.source_url AS "sourceUrl",o.status,o.score,o.matches,o.created_at AS "createdAt",o.processing_state AS "processingState",o.processing_error AS "processingError",o.synced_at AS "syncedAt",(SELECT count(*)::int FROM documents WHERE opportunity_id=o.id AND active=true) AS "documentCount",a.result AS analysis,a.created_at AS "analysisAt",d.name AS "documentName" FROM opportunities o JOIN procurements p ON p.id=o.procurement_id LEFT JOIN LATERAL (SELECT result,created_at FROM analyses WHERE opportunity_id=o.id AND organization_id=${t.organizationId} AND company_id=${t.companyId} AND criteria_version=(SELECT criteria_version FROM companies WHERE id=o.company_id AND organization_id=o.organization_id) AND document_set_hash=encode(sha256(convert_to(coalesce((SELECT string_agg(ds.id::text || ':' || ds.hash || ':' || ds.extraction_status,'|' ORDER BY ds.id) FROM documents ds WHERE ds.opportunity_id=o.id AND ds.organization_id=o.organization_id AND ds.company_id=o.company_id AND ds.active),''),'UTF8')),'hex') ORDER BY created_at DESC LIMIT 1) a ON true LEFT JOIN LATERAL (SELECT name FROM documents WHERE opportunity_id=o.id AND organization_id=${t.organizationId} AND company_id=${t.companyId} ORDER BY created_at DESC LIMIT 1) d ON true WHERE o.organization_id=${t.organizationId} AND o.company_id=${t.companyId} ORDER BY o.created_at DESC LIMIT 1000`,
  );
}
