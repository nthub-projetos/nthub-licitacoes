ALTER TABLE companies ADD COLUMN IF NOT EXISTS short_name text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_parent boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS parent_company_id uuid;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS search_settings jsonb NOT NULL DEFAULT '{"excludedKeywords":[],"ufs":[],"minimumValue":null,"maximumValue":null,"matchMode":"any","includeExpired":false}';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS group_role text NOT NULL DEFAULT 'member' CHECK(group_role IN ('group_admin','member'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS active_company_id uuid REFERENCES companies(id);
CREATE TABLE IF NOT EXISTS memberships(user_id uuid NOT NULL REFERENCES users(id),organization_id uuid NOT NULL,company_id uuid NOT NULL,role text NOT NULL CHECK(role IN ('company_manager','analyst','viewer')),active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,company_id),FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id));
INSERT INTO memberships(user_id,organization_id,company_id,role) SELECT id,organization_id,company_id,'analyst' FROM users ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS memberships_scope ON memberships(organization_id,company_id,active);
CREATE TABLE IF NOT EXISTS invitations(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id),token_hash text UNIQUE NOT NULL,expires_at timestamptz NOT NULL,accepted_at timestamptz,created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id));
CREATE TABLE IF NOT EXISTS company_logos(company_id uuid PRIMARY KEY,organization_id uuid NOT NULL,content bytea NOT NULL,mime text NOT NULL,FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id));
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES users(id);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS decision_reason text;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS opportunity_notes(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,opportunity_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id),body text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(opportunity_id,organization_id,company_id) REFERENCES opportunities(id,organization_id,company_id));
CREATE TABLE IF NOT EXISTS bids(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,opportunity_id uuid NOT NULL,title text NOT NULL,proposed_value numeric(18,2),awarded_value numeric(18,2),status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','prepared','submitted','won','lost','cancelled')),protocol text NOT NULL DEFAULT '',notes text NOT NULL DEFAULT '',submitted_at timestamptz,result_at timestamptz,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(opportunity_id,organization_id,company_id) REFERENCES opportunities(id,organization_id,company_id),UNIQUE(id,organization_id,company_id));
CREATE INDEX IF NOT EXISTS bids_scope ON bids(organization_id,company_id,status);
CREATE TABLE IF NOT EXISTS private_files(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,opportunity_id uuid,bid_id uuid,name text NOT NULL,mime text NOT NULL,hash text NOT NULL,content bytea,storage_key text,category text NOT NULL DEFAULT 'corporate' CHECK(category IN ('corporate','qualification','proposal')),valid_until date,notes text NOT NULL DEFAULT '',created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),archived_at timestamptz,FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id),FOREIGN KEY(opportunity_id,organization_id,company_id) REFERENCES opportunities(id,organization_id,company_id),FOREIGN KEY(bid_id,organization_id,company_id) REFERENCES bids(id,organization_id,company_id));
CREATE TABLE IF NOT EXISTS tasks(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,opportunity_id uuid,title text NOT NULL,due_at timestamptz,assigned_user_id uuid REFERENCES users(id),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id),FOREIGN KEY(opportunity_id,organization_id,company_id) REFERENCES opportunities(id,organization_id,company_id));
CREATE TABLE IF NOT EXISTS notifications(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,recipient_user_id uuid REFERENCES users(id),title text NOT NULL,body text NOT NULL,kind text NOT NULL,opportunity_id uuid,unique_key text NOT NULL UNIQUE,email_status text NOT NULL DEFAULT 'not_requested',created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id),FOREIGN KEY(opportunity_id,organization_id,company_id) REFERENCES opportunities(id,organization_id,company_id));
CREATE TABLE IF NOT EXISTS notification_reads(notification_id uuid NOT NULL REFERENCES notifications(id),user_id uuid NOT NULL REFERENCES users(id),read_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(notification_id,user_id));
CREATE TABLE IF NOT EXISTS notification_preferences(user_id uuid NOT NULL REFERENCES users(id),organization_id uuid NOT NULL,company_id uuid NOT NULL,email_enabled boolean NOT NULL DEFAULT false,lead_days jsonb NOT NULL DEFAULT '[1,3,7]',PRIMARY KEY(user_id,company_id),FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id));
CREATE TABLE IF NOT EXISTS saved_searches(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id),name text NOT NULL,filters jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id));
CREATE TABLE IF NOT EXISTS collection_schedules(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,interval_minutes integer NOT NULL DEFAULT 360 CHECK(interval_minutes BETWEEN 60 AND 10080),modalities jsonb NOT NULL DEFAULT '[4,6,8]',ufs jsonb NOT NULL DEFAULT '[]',lookback_days integer NOT NULL DEFAULT 2 CHECK(lookback_days BETWEEN 1 AND 14),next_run_at timestamptz NOT NULL DEFAULT now(),created_by uuid REFERENCES users(id),UNIQUE(company_id),FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id));
CREATE TABLE IF NOT EXISTS source_runs(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,source text NOT NULL DEFAULT 'pncp',input jsonb NOT NULL,cursor_page integer NOT NULL DEFAULT 1,records_processed integer NOT NULL DEFAULT 0,opportunities_processed integer NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'running',error text,started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id));
CREATE TABLE IF NOT EXISTS procurement_versions(id uuid PRIMARY KEY,procurement_id uuid NOT NULL REFERENCES procurements(id),payload_hash text NOT NULL,raw jsonb NOT NULL,collected_at timestamptz NOT NULL DEFAULT now(),UNIQUE(procurement_id,payload_hash));
CREATE TABLE IF NOT EXISTS job_runs(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,type text NOT NULL,state text NOT NULL,attempt integer NOT NULL DEFAULT 0,result jsonb,error text,started_at timestamptz,finished_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id));
CREATE TABLE IF NOT EXISTS api_tokens(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,name text NOT NULL,token_hash text UNIQUE NOT NULL,scopes jsonb NOT NULL,created_by uuid NOT NULL REFERENCES users(id),active boolean NOT NULL DEFAULT true,last_used_at timestamptz,expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id));
CREATE TABLE IF NOT EXISTS webhooks(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,name text NOT NULL,url text NOT NULL,secret_encrypted text NOT NULL,events jsonb NOT NULL,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id),UNIQUE(id,organization_id,company_id));
CREATE TABLE IF NOT EXISTS webhook_deliveries(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,webhook_id uuid NOT NULL,event_id uuid NOT NULL,event_type text NOT NULL,payload jsonb NOT NULL,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,error text,delivered_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(webhook_id,event_id),FOREIGN KEY(webhook_id,organization_id,company_id) REFERENCES webhooks(id,organization_id,company_id));
ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_key text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS location_kind text NOT NULL DEFAULT 'page';
CREATE INDEX IF NOT EXISTS notifications_scope ON notifications(organization_id,company_id,created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_scope ON tasks(organization_id,company_id,status,due_at);
CREATE INDEX IF NOT EXISTS private_files_scope ON private_files(organization_id,company_id,category);
CREATE INDEX IF NOT EXISTS job_runs_scope ON job_runs(organization_id,company_id,created_at DESC);
CREATE TABLE IF NOT EXISTS email_deliveries(id uuid PRIMARY KEY,notification_id uuid NOT NULL REFERENCES notifications(id),user_id uuid NOT NULL REFERENCES users(id),status text NOT NULL DEFAULT 'pending',error text,sent_at timestamptz,UNIQUE(notification_id,user_id));
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS input_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS output_tokens integer NOT NULL DEFAULT 0;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS configured_by_user boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS criteria_version integer NOT NULL DEFAULT 1;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS criteria_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS oidc_states(state_hash text PRIMARY KEY,browser_hash text NOT NULL,encrypted text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS oidc_identities(issuer text NOT NULL,subject text NOT NULL,user_id uuid NOT NULL REFERENCES users(id),PRIMARY KEY(issuer,subject),UNIQUE(issuer,user_id));

CREATE TABLE IF NOT EXISTS procurement_sources(procurement_id uuid NOT NULL REFERENCES procurements(id),source text NOT NULL CHECK(source IN ('pncp','compras')),source_key text NOT NULL,payload jsonb NOT NULL,observed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(procurement_id,source),UNIQUE(source,source_key));
ALTER TABLE collection_schedules ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '["pncp","compras"]';

CREATE TABLE IF NOT EXISTS opportunity_contacts(id uuid PRIMARY KEY,organization_id uuid NOT NULL,company_id uuid NOT NULL,opportunity_id uuid NOT NULL,name text NOT NULL,role text NOT NULL DEFAULT '',email text,phone text NOT NULL DEFAULT '',notes text NOT NULL DEFAULT '',created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(opportunity_id,organization_id,company_id) REFERENCES opportunities(id,organization_id,company_id));
CREATE INDEX IF NOT EXISTS opportunity_contacts_scope ON opportunity_contacts(organization_id,company_id,opportunity_id);

CREATE TABLE IF NOT EXISTS permission_profiles (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, company_id uuid NOT NULL,
 name text NOT NULL, description text NOT NULL DEFAULT '', permissions jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,company_id,organization_id), UNIQUE(company_id,name),
 FOREIGN KEY(company_id,organization_id) REFERENCES companies(id,organization_id)
);
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS permission_profile_id uuid;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS permission_overrides jsonb NOT NULL DEFAULT '{}';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='membership_permission_profile_fk') THEN
 ALTER TABLE memberships ADD CONSTRAINT membership_permission_profile_fk FOREIGN KEY(permission_profile_id,company_id,organization_id) REFERENCES permission_profiles(id,company_id,organization_id);
 END IF;
END $$;

-- Keep opportunity aggregates consistent during an atomic company transfer.
DO $$ DECLARE relation record; BEGIN
 FOR relation IN SELECT conrelid::regclass AS tbl,conname FROM pg_constraint WHERE contype='f' AND confrelid IN ('opportunities'::regclass,'bids'::regclass) LOOP
  EXECUTE format('ALTER TABLE %s ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE',relation.tbl,relation.conname);
 END LOOP;
END $$;
CREATE TABLE IF NOT EXISTS opportunity_routes(organization_id uuid NOT NULL,procurement_id uuid NOT NULL REFERENCES procurements(id),excluded_company_id uuid NOT NULL,destination_company_id uuid NOT NULL,PRIMARY KEY(organization_id,procurement_id,excluded_company_id),FOREIGN KEY(excluded_company_id,organization_id) REFERENCES companies(id,organization_id),FOREIGN KEY(destination_company_id,organization_id) REFERENCES companies(id,organization_id));
