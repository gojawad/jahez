-- BSGT Financial Center phase 1 — SQL test suite (local PostgreSQL only; synthetic data).
-- Run by test/bsgt-financial-center-sql.cjs against a throwaway database cloned from the
-- local cluster that already carries migrations 1..52, after applying migration 53.
-- Every check records a row in fct.results; the runner fails when any row is not ok.
\set ON_ERROR_STOP on
\set QUIET on

create schema fct;
create table fct.results (n serial primary key, name text not null, ok boolean not null, detail text);
grant usage on schema fct to authenticated;
grant select on fct.results to authenticated;

create function fct.check(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
begin insert into fct.results(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail); end $$;

-- Runs p_sql expecting an error matching p_pattern; the failed statement is rolled back by the exception block.
create function fct.expect_error(p_name text, p_sql text, p_pattern text)
returns void language plpgsql security definer set search_path = public as $$
begin
  execute p_sql;
  perform fct.check(p_name, false, 'no error raised');
exception when others then
  if sqlerrm ~* p_pattern then perform fct.check(p_name, true, sqlerrm);
  else perform fct.check(p_name, false, 'unexpected error: ' || sqlerrm); end if;
end $$;
-- expect_error/check run as definer (postgres) so that the results table is writable from any role;
-- the dynamic SQL inside expect_error still runs under the *current* session role and jwt claim.
alter function fct.expect_error(text, text, text) security invoker;
grant execute on function fct.check(text, boolean, text) to authenticated;
grant execute on function fct.expect_error(text, text, text) to authenticated;
grant insert on fct.results to authenticated;
grant usage, select on sequence fct.results_n_seq to authenticated;

-- ---------------------------------------------------------------- fixtures (superuser)
insert into public.companies (id, name_ar, name_en, active, is_default, sort_order)
values ('00000000-0000-4000-8000-00000000c001', 'بحر سواكن للتجارة العامة (اختبار)', 'Bahar Swaken General Trading TEST', true, false, 9);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000a1'), ('00000000-0000-4000-8000-0000000000a2'), ('00000000-0000-4000-8000-0000000000a3'),
  ('00000000-0000-4000-8000-0000000000a4'), ('00000000-0000-4000-8000-0000000000a5'), ('00000000-0000-4000-8000-0000000000a6'),
  ('00000000-0000-4000-8000-0000000000a7');
insert into public.profiles (id, email, display_name, role, active) values
  ('00000000-0000-4000-8000-0000000000a1', 'admin@test', 'ADMIN', 'admin', true),
  ('00000000-0000-4000-8000-0000000000a2', 'acc@test', 'ACCOUNTANT', 'staff', true),
  ('00000000-0000-4000-8000-0000000000a3', 'fm@test', 'FIN MANAGER', 'editor', true),
  ('00000000-0000-4000-8000-0000000000a4', 'viewer@test', 'VIEWER', 'viewer', true),
  ('00000000-0000-4000-8000-0000000000a5', 'ops@test', 'OPERATIONS', 'staff', true),
  ('00000000-0000-4000-8000-0000000000a6', 'none@test', 'NOBODY', 'staff', true),
  ('00000000-0000-4000-8000-0000000000a7', 'acc2@test', 'ACCOUNTANT 2', 'staff', true)
on conflict (id) do update set email = excluded.email, display_name = excluded.display_name, role = excluded.role, active = excluded.active;   -- auth.users trigger may pre-create profiles
insert into public.user_feature_permissions (user_id, permission_key, allowed) values
  ('00000000-0000-4000-8000-0000000000a2', 'bsgt.financial_center.view', true),
  ('00000000-0000-4000-8000-0000000000a2', 'bsgt.financial_center.edit', true),
  ('00000000-0000-4000-8000-0000000000a7', 'bsgt.financial_center.view', true),
  ('00000000-0000-4000-8000-0000000000a7', 'bsgt.financial_center.edit', true),
  ('00000000-0000-4000-8000-0000000000a3', 'bsgt.financial_center.view', true),
  ('00000000-0000-4000-8000-0000000000a3', 'bsgt.financial_center.edit', true),
  ('00000000-0000-4000-8000-0000000000a3', 'bsgt.financial_center.approve', true),
  ('00000000-0000-4000-8000-0000000000a4', 'bsgt.financial_center.view', true),
  ('00000000-0000-4000-8000-0000000000a4', 'bsgt.financial_center.edit', true),
  ('00000000-0000-4000-8000-0000000000a4', 'bsgt.financial_center.approve', true),
  ('00000000-0000-4000-8000-0000000000a5', 'bsgt.operations.view', true);

insert into public.clients (id, name, active) values
  ('00000000-0000-4000-8000-0000000000c1', 'TEST BUYER ONE', true),
  ('00000000-0000-4000-8000-0000000000c2', 'TEST BUYER TWO', true),
  ('00000000-0000-4000-8000-0000000000c3', 'INACTIVE BUYER', false);

-- shipments: s1,s2 USD collection; s3 AED collection; s4 no currency; s5 CAD; s6 ADVANCE; s7 collection (other consignee)
insert into public.shipments (id, owner_id, status, company_id, bsgt_stage, data) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0001","consignee":"TEST BUYER ONE","invoiceNo":"INV-1","currency":"USD","totalAmount":"USD 1,000.00","paymentTerm":"D/A 90 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0002","consignee":"TEST BUYER ONE","invoiceNo":"INV-2","currency":"USD","totalAmount":"USD 500.00","paymentTerm":"D/A 90 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0003","consignee":"TEST BUYER TWO","invoiceNo":"INV-3","currency":"AED","totalAmount":"AED 4,534.00","paymentTerm":"D/A 60 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0004","consignee":"TEST BUYER TWO","invoiceNo":"INV-4","totalAmount":"1234.567891","paymentTerm":"D/P AT SIGHT"}'),
  ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0005","consignee":"TEST BUYER ONE","invoiceNo":"INV-5","currency":"USD","totalAmount":"USD 900.00","paymentTerm":"CAD"}'),
  ('00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0006","consignee":"TEST BUYER ONE","invoiceNo":"INV-6","currency":"USD","totalAmount":"USD 900.00","paymentTerm":"100% ADVANCE PAYMENT"}'),
  ('00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0007","consignee":"TEST BUYER TWO","invoiceNo":"INV-7","currency":"USD","totalAmount":"USD 250.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000e8', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0008","consignee":"TEST BUYER TWO","invoiceNo":"INV-8","currency":"USD","totalAmount":"USD 250.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0009","consignee":"TEST BUYER TWO","invoiceNo":"INV-9","currency":"USD","totalAmount":"USD 100.00","paymentTerm":"D/A 30 DAYS"}');

-- trade files: t1 collection (s1,s2); t2 legacy without collectionMode (s4); t3 CAD (s5); t4 archived (s7); t5 collection metadata but ADVANCE shipment (s6); t6 (s3 AED)
insert into public.trade_collection_files (id, company_id, status, created_by, metadata) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-00000000c001', 'sent_to_remitting', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-00000000c001', 'final_accepted', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}');
insert into public.trade_collection_file_shipments (trade_file_id, shipment_id) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e2'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e4'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000e5'),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000e7'),
  ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000e3');
-- t5: collection metadata written explicitly, then an ADVANCE shipment is forced in (bypassing the mixing guard) to test the approval/creation whitelist
alter table public.trade_collection_file_shipments disable trigger trade_file_shipments_collection_mode;
insert into public.trade_collection_file_shipments (trade_file_id, shipment_id) values ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000e6');
alter table public.trade_collection_file_shipments enable trigger trade_file_shipments_collection_mode;
update public.trade_collection_files set metadata = jsonb_build_object('collectionMode', 'collection') where id = '00000000-0000-4000-8000-0000000000f5';
update public.trade_collection_files set metadata = metadata - 'collectionMode' where id = '00000000-0000-4000-8000-0000000000f2';   -- legacy file
update public.trade_collection_files set archived_at = now(), archived_by = '00000000-0000-4000-8000-0000000000a1' where id = '00000000-0000-4000-8000-0000000000f4';

select fct.check('fixture: t1 collection mode', (select metadata->>'collectionMode' from public.trade_collection_files where id = '00000000-0000-4000-8000-0000000000f1') = 'collection');
select fct.check('fixture: t3 cad mode', (select metadata->>'collectionMode' from public.trade_collection_files where id = '00000000-0000-4000-8000-0000000000f3') = 'cad');
select fct.check('fixture: t2 legacy has no collectionMode', (select metadata ? 'collectionMode' from public.trade_collection_files where id = '00000000-0000-4000-8000-0000000000f2') = false);
select fct.check('fixture: bsgt company resolved', public.bsgt_company_id() = '00000000-0000-4000-8000-00000000c001');

-- ---------------------------------------------------------------- 1) objects
select fct.check('objects: tables', (select count(*) from pg_tables where schemaname = 'public' and tablename in ('bsgt_financial_files','bsgt_financial_file_invoices','bsgt_financial_file_events')) = 3);
select fct.check('objects: catalog keys', (select count(*) from public.feature_permission_catalog where permission_key like 'bsgt.financial_center.%') = 3);
select fct.check('objects: indexes', (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('bff_page_idx','bff_status_idx','bff_client_idx','bff_permit_no_uniq','bff_consignee_trgm','bff_client_name_trgm','bff_permit_no_trgm','bffi_file_active_idx','bffi_shipment_idx','bffe_file_idx','bff_m53_tcf_operation_no_prefix_idx')) = 11);
select fct.check('objects: rls enabled', (select bool_and(relrowsecurity) from pg_class where relname in ('bsgt_financial_files','bsgt_financial_file_invoices','bsgt_financial_file_events')));
select fct.check('objects: only select policies', (select count(*) from pg_policies where tablename like 'bsgt_financial_file%' and cmd <> 'SELECT') = 0
  and (select count(*) from pg_policies where tablename like 'bsgt_financial_file%' and cmd = 'SELECT') = 3);
select fct.check('objects: no write grants for authenticated', (select count(*) from information_schema.role_table_grants where grantee = 'authenticated' and table_name like 'bsgt_financial_file%' and privilege_type <> 'SELECT') = 0);
select fct.check('objects: helpers not executable by authenticated',
  not has_function_privilege('authenticated', 'public.bsgt_financial_lock(uuid,bigint,text[])', 'execute')
  and not has_function_privilege('authenticated', 'public.bsgt_financial_log(uuid,text,text,text,text,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.bsgt_financial_assert_eligible(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.bsgt_financial_consignees(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.bsgt_financial_total(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.bsgt_financial_scale6(numeric,text)', 'execute'));
select fct.check('objects: public rpcs executable by authenticated',
  has_function_privilege('authenticated', 'public.create_bsgt_financial_file(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.transition_bsgt_financial_file(uuid,bigint,text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.list_bsgt_financial_files(text,text,boolean,integer,timestamptz,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.create_bsgt_financial_file(uuid)', 'execute'));

-- ---------------------------------------------------------------- helpers to switch identity
create function fct.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, false);
$$;
grant execute on function fct.as_user(text) to authenticated;

-- ================================================================ as ACCOUNTANT (edit)
set role authenticated;
select fct.as_user('00000000-0000-4000-8000-0000000000a2');

-- 3) direct DML denied
select fct.expect_error('direct insert denied', $q$insert into public.bsgt_financial_files (trade_file_id, company_id, consignee_snapshot, consignee_count) values ('00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-00000000c001','X',1)$q$, 'permission denied');
select fct.expect_error('direct insert invoices denied', $q$insert into public.bsgt_financial_file_invoices (financial_file_id, shipment_id) values (gen_random_uuid(),'00000000-0000-4000-8000-0000000000e1')$q$, 'permission denied');
select fct.expect_error('direct insert events denied', $q$insert into public.bsgt_financial_file_events (financial_file_id, event_type) values (gen_random_uuid(),'created')$q$, 'permission denied');

-- 4) create + 5) idempotency
create temp table fct_ctx (k text primary key, v text);
insert into fct_ctx select 'r1', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000f1')::text;
select fct.check('create: created=true lock=1', (select (v::jsonb->>'created')::boolean and (v::jsonb->>'lock_version')::bigint = 1 from fct_ctx where k = 'r1'));
insert into fct_ctx select 'f1', v::jsonb->>'financial_file_id' from fct_ctx where k = 'r1';
select fct.check('create: two unconfirmed invoices, null total', (select count(*) = 2 and bool_and(amount_usd is null) from public.bsgt_financial_file_invoices where financial_file_id = (select v::uuid from fct_ctx where k='f1'))
  and (select invoice_total_usd is null and consignee_snapshot = 'TEST BUYER ONE' and consignee_count = 1 and status = 'draft' from public.bsgt_financial_files where id = (select v::uuid from fct_ctx where k='f1')));
select fct.check('create: computed columns null until inputs complete', (select bank_cost_sdg is null and bsgt_commission_sdg is null and client_total_sdg is null and calculation_ready = false from public.bsgt_financial_files where id = (select v::uuid from fct_ctx where k='f1')));
select fct.check('create: event created', (select count(*) = 1 from public.bsgt_financial_file_events where financial_file_id = (select v::uuid from fct_ctx where k='f1') and event_type = 'created'));
insert into fct_ctx select 'r1b', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000f1')::text;
select fct.check('idempotent: same id, created=false, no new rows', (select v::jsonb->>'financial_file_id' = (select v from fct_ctx where k='f1') and (v::jsonb->>'created')::boolean = false from fct_ctx where k='r1b')
  and (select count(*) from public.bsgt_financial_files where trade_file_id = '00000000-0000-4000-8000-0000000000f1') = 1
  and (select count(*) from public.bsgt_financial_file_events where financial_file_id = (select v::uuid from fct_ctx where k='f1')) = 1);

-- 6) eligibility
select fct.expect_error('eligibility: cad file refused', $q$select public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000f3')$q$, 'collection-mode');
select fct.expect_error('eligibility: advance shipment refused', $q$select public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000f5')$q$, 'CAD / advance');
select fct.expect_error('eligibility: archived refused', $q$select public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000f4')$q$, 'archived');
select fct.expect_error('eligibility: unknown file', $q$select public.create_bsgt_financial_file(gen_random_uuid())$q$, 'not found');
insert into fct_ctx select 'r2', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000f2')::text;
insert into fct_ctx select 'f2', v::jsonb->>'financial_file_id' from fct_ctx where k = 'r2';
select fct.check('eligibility: legacy file without collectionMode accepted', (select (v::jsonb->>'created')::boolean from fct_ctx where k='r2'));
insert into fct_ctx select 'r6', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000f6')::text;
insert into fct_ctx select 'f6', v::jsonb->>'financial_file_id' from fct_ctx where k = 'r6';

-- 7) visibility without legacy section permissions
select fct.check('list: accountant sees files without finance.view', (select count(*) from public.list_bsgt_financial_files()) = 3);
select fct.check('list: eligible trade files excludes cad/advance/archived/with-file', (select array_agg(id order by id) from public.list_bsgt_financial_eligible_trade_files()) = '{}'::uuid[]
  or (select count(*) from public.list_bsgt_financial_eligible_trade_files()) = 0);
select fct.check('rls: accountant selects rows directly', (select count(*) from public.bsgt_financial_files) = 3);

-- 8) lock conflict, 9) lock +1, 10) rounding, 12) permit source
select fct.expect_error('lock: wrong version rejected', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 99, '{"notes":"x"}')$q$, 'version changed');
select fct.expect_error('lock: null version rejected', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), null, '{"notes":"x"}')$q$, 'version changed');
select fct.expect_error('draft: forbidden field', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 1, '{"invoice_total_usd":"1"}')$q$, 'cannot be updated');
select fct.expect_error('rounding: 7 decimals rejected', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 1, '{"bank_tariff_per_1000_sdg":"150000.1234567"}')$q$, 'more than 6 decimal');
select fct.expect_error('permit: cost without source rejected (clear message)', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 1, '{"import_permit_cost_sdg":"500000"}')$q$, 'before the import permit source');
select fct.expect_error('finite: NaN tariff rejected', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 1, '{"bank_tariff_per_1000_sdg":"NaN"}')$q$, 'finite decimal');
select fct.expect_error('finite: Infinity tariff rejected', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 1, '{"bsgt_tariff_per_1000_sdg":"Infinity"}')$q$, 'finite decimal');
select fct.expect_error('finite: -Infinity cost rejected', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 1, '{"import_permit_source":"bsgt","import_permit_cost_sdg":"-Infinity"}')$q$, 'finite decimal');
select fct.expect_error('finite: non-numeric text rejected by cast', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 1, '{"bank_tariff_per_1000_sdg":"12abc"}')$q$, 'invalid input syntax');
reset role;
select fct.expect_error('finite: table constraint rejects NaN even for superuser', $q$update public.bsgt_financial_files set bank_tariff_per_1000_sdg = 'NaN' where id = (select v::uuid from fct_ctx where k='f1')$q$, 'bff_amounts_check');
select fct.expect_error('finite: table constraint rejects Infinity even for superuser', $q$update public.bsgt_financial_files set documents_value_aed = 'Infinity' where id = (select v::uuid from fct_ctx where k='f1')$q$, 'bff_amounts_check|numeric field overflow');
select fct.expect_error('permit: table constraint rejects cost without source', $q$update public.bsgt_financial_files set import_permit_cost_sdg = 1 where id = (select v::uuid from fct_ctx where k='f1')$q$, 'bff_permit_cost_check');
select fct.expect_error('permit: table constraint rejects bsgt source with null cost', $q$update public.bsgt_financial_files set import_permit_source = 'bsgt' where id = (select v::uuid from fct_ctx where k='f1')$q$, 'bff_permit_cost_check');
select fct.expect_error('permit: table constraint rejects client source with null cost', $q$update public.bsgt_financial_files set import_permit_source = 'client' where id = (select v::uuid from fct_ctx where k='f1')$q$, 'bff_permit_cost_check');
select fct.check('finite: superuser attempts left lock_version at 1', (select lock_version = 1 from public.bsgt_financial_files where id = (select v::uuid from fct_ctx where k='f1')));
set role authenticated;
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
select fct.expect_error('permit: bsgt without cost rejected', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 1, '{"import_permit_source":"bsgt"}')$q$, 'required in the same request');
select fct.expect_error('permit: bsgt zero cost rejected', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 1, '{"import_permit_source":"bsgt","import_permit_cost_sdg":"0"}')$q$, 'greater than zero');
insert into fct_ctx select 'u1', public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 1,
  '{"bank_tariff_per_1000_sdg":"150000","bsgt_tariff_per_1000_sdg":"200000","import_permit_source":"client","notes":"first note"}')::text;
select fct.check('draft: lock 1->2, changed=true, client permit cost 0', (select (v::jsonb->>'lock_version')::bigint = 2 and (v::jsonb->>'changed')::boolean and (v::jsonb->'file'->>'import_permit_cost_sdg')::numeric = 0 from fct_ctx where k='u1'));
select fct.check('draft event: before/after tariffs as strings, notes only changed:true', (select changes->'bank_tariff_per_1000_sdg' = '[null, "150000.000000"]'::jsonb and jsonb_typeof(changes->'bank_tariff_per_1000_sdg'->1) = 'string' and changes->'notes' = '{"changed": true}'::jsonb from public.bsgt_financial_file_events where financial_file_id = (select v::uuid from fct_ctx where k='f1') and event_type = 'draft_updated' order by created_at desc limit 1));
select fct.check('json: money fields are strings in rpc output', (select jsonb_typeof(v::jsonb->'file'->'bank_tariff_per_1000_sdg') = 'string' and jsonb_typeof(v::jsonb->'file'->'import_permit_cost_sdg') = 'string' and v::jsonb->'file'->>'bank_tariff_per_1000_sdg' = '150000.000000' and jsonb_typeof(v::jsonb->'file'->'invoice_total_usd') = 'null' and jsonb_typeof(v::jsonb->'file'->'lock_version') = 'number' from fct_ctx where k='u1'));
insert into fct_ctx select 'u1b', public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 2, '{"bank_tariff_per_1000_sdg":"150000.000000"}')::text;
select fct.check('draft: no-op keeps lock=2 and changed=false', (select (v::jsonb->>'lock_version')::bigint = 2 and (v::jsonb->>'changed')::boolean = false from fct_ctx where k='u1b'));
select fct.check('draft: no-op wrote no event', (select count(*) from public.bsgt_financial_file_events where financial_file_id = (select v::uuid from fct_ctx where k='f1') and event_type = 'draft_updated') = 1);
insert into fct_ctx select 'u1c', public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 2, '{"import_permit_source":null}')::text;
select fct.check('permit: clearing source clears cost', (select (v::jsonb->'file'->>'import_permit_cost_sdg') is null and (v::jsonb->'file'->>'import_permit_source') is null and (v::jsonb->>'lock_version')::bigint = 3 from fct_ctx where k='u1c'));
insert into fct_ctx select 'u1d', public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 3, '{"import_permit_source":"bsgt","import_permit_cost_sdg":"500000"}')::text;
select fct.check('permit: bsgt with 500000 accepted (lock 4)', (select (v::jsonb->'file'->>'import_permit_cost_sdg')::numeric = 500000 and (v::jsonb->>'lock_version')::bigint = 4 from fct_ctx where k='u1d'));

-- 13/5) currencies and invoice confirmation
insert into fct_ctx select 'inv1', id::text from public.bsgt_financial_file_invoices where financial_file_id = (select v::uuid from fct_ctx where k='f1') and shipment_id = '00000000-0000-4000-8000-0000000000e1';
insert into fct_ctx select 'inv2', id::text from public.bsgt_financial_file_invoices where financial_file_id = (select v::uuid from fct_ctx where k='f1') and shipment_id = '00000000-0000-4000-8000-0000000000e2';
select fct.expect_error('invoice: 7 decimals rejected', $q$select public.confirm_bsgt_financial_invoice((select v::uuid from fct_ctx where k='inv1'), 4, 1000.1234567)$q$, 'more than 6 decimal');
select fct.expect_error('invoice: negative rejected', $q$select public.confirm_bsgt_financial_invoice((select v::uuid from fct_ctx where k='inv1'), 4, -1)$q$, 'negative');
insert into fct_ctx select 'c1', public.confirm_bsgt_financial_invoice((select v::uuid from fct_ctx where k='inv1'), 4, 1000)::text;
select fct.check('invoice: usd basis source_usd, lock 5, total still null', (select v::jsonb->'invoice'->>'amount_usd_basis' = 'source_usd' and (v::jsonb->>'lock_version')::bigint = 5 and (v::jsonb->'file'->>'invoice_total_usd') is null from fct_ctx where k='c1'));
select fct.check('invoice event: before/after arrays (amounts as strings)', (select changes->'amount_usd' = '[null, "1000.000000"]'::jsonb and changes ? 'amount_confirmed_by' and changes ? 'shipment_id' from public.bsgt_financial_file_events where financial_file_id = (select v::uuid from fct_ctx where k='f1') and event_type = 'invoice_confirmed' order by created_at desc limit 1));
select fct.check('json: invoice amount is a string', (select jsonb_typeof(v::jsonb->'invoice'->'amount_usd') = 'string' and v::jsonb->'invoice'->>'amount_usd' = '1000.000000' from fct_ctx where k='c1'));
select fct.expect_error('lock order: unknown invoice id', $q$select public.confirm_bsgt_financial_invoice(gen_random_uuid(), 5, 1)$q$, 'Invoice not found');
insert into fct_ctx select 'c1b', public.confirm_bsgt_financial_invoice((select v::uuid from fct_ctx where k='inv1'), 5, 1000.000000)::text;
select fct.check('invoice: repeat is no-op (lock stays 5)', (select (v::jsonb->>'lock_version')::bigint = 5 and (v::jsonb->>'changed')::boolean = false from fct_ctx where k='c1b'));
insert into fct_ctx select 'c2', public.confirm_bsgt_financial_invoice((select v::uuid from fct_ctx where k='inv2'), 5, 500)::text;
select fct.check('invoice: total 1500 after both confirmed; costs computed exactly', (select (v::jsonb->'file'->>'invoice_total_usd')::numeric = 1500 and (v::jsonb->'file'->>'bank_cost_sdg')::numeric = 225000 and (v::jsonb->'file'->>'bsgt_commission_sdg')::numeric = 300000 and (v::jsonb->'file'->>'client_total_sdg')::numeric = 1025000 and (v::jsonb->'file'->>'calculation_ready')::boolean from fct_ctx where k='c2'));
select fct.check('precision: stored text has no rounding', (select bank_cost_sdg::text = '225000.000000000000000' and client_total_sdg::text = '1025000.000000000000000' from public.bsgt_financial_files where id = (select v::uuid from fct_ctx where k='f1')));
select fct.check('json: computed costs are strings with full scale', (select v::jsonb->'file'->>'bank_cost_sdg' = '225000.000000000000000' and jsonb_typeof(v::jsonb->'file'->'client_total_sdg') = 'string' from fct_ctx where k='c2'));
select fct.check('list: money columns are text type with full precision', (select pg_typeof(invoice_total_usd)::text = 'text' and pg_typeof(client_total_sdg)::text = 'text' and client_total_sdg = '1025000.000000000000000' from public.list_bsgt_financial_files() where id = (select v::uuid from fct_ctx where k='f1')));
-- AED invoice (file f6) and missing-currency invoice (file f2)
insert into fct_ctx select 'inv6', id::text from public.bsgt_financial_file_invoices where financial_file_id = (select v::uuid from fct_ctx where k='f6');
select fct.expect_error('currency: AED without basis rejected', $q$select public.confirm_bsgt_financial_invoice((select v::uuid from fct_ctx where k='inv6'), 1, 1234.56)$q$, 'basis of the USD value');
insert into fct_ctx select 'c6', public.confirm_bsgt_financial_invoice((select v::uuid from fct_ctx where k='inv6'), 1, 1234.56, 'Manual: bank rate note 3.6725 on invoice date')::text;
select fct.check('currency: AED with explicit basis accepted', (select v::jsonb->'invoice'->>'amount_usd_basis' like 'Manual:%' from fct_ctx where k='c6'));
insert into fct_ctx select 'inv4', id::text from public.bsgt_financial_file_invoices where financial_file_id = (select v::uuid from fct_ctx where k='f2');
select fct.expect_error('currency: missing currency is not USD', $q$select public.confirm_bsgt_financial_invoice((select v::uuid from fct_ctx where k='inv4'), 1, 1234.567891)$q$, 'basis of the USD value');
insert into fct_ctx select 'c4', public.confirm_bsgt_financial_invoice((select v::uuid from fct_ctx where k='inv4'), 1, 1234.567891, 'source text is USD per contract')::text;
insert into fct_ctx select 'u2', public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f2'), 2, '{"bank_tariff_per_1000_sdg":"123.456789","bsgt_tariff_per_1000_sdg":"0.000001","import_permit_source":"client"}')::text;
select fct.check('precision: 1234.567891 x 123.456789 / 1000 kept in full', (select bank_cost_sdg::text = '152.415787625361999' and bsgt_commission_sdg::text = '0.000001234567891' from public.bsgt_financial_files where id = (select v::uuid from fct_ctx where k='f2')));

-- 11) client confirmation
select fct.expect_error('client: inactive rejected', $q$select public.confirm_bsgt_financial_client((select v::uuid from fct_ctx where k='f1'), 6, '00000000-0000-4000-8000-0000000000c3')$q$, 'not found or inactive');
insert into fct_ctx select 'k1', public.confirm_bsgt_financial_client((select v::uuid from fct_ctx where k='f1'), 6, '00000000-0000-4000-8000-0000000000c1')::text;
select fct.check('client: snapshot + stamps set, lock 7', (select v::jsonb->'file'->>'client_name_snapshot' = 'TEST BUYER ONE' and (v::jsonb->'file'->>'client_confirmed_by') = '00000000-0000-4000-8000-0000000000a2' and (v::jsonb->>'lock_version')::bigint = 7 from fct_ctx where k='k1'));
select fct.check('client event: before/after', (select changes->'client_id' = jsonb_build_array(null, '00000000-0000-4000-8000-0000000000c1') and changes->'client_name_snapshot' = '[null, "TEST BUYER ONE"]'::jsonb from public.bsgt_financial_file_events where financial_file_id = (select v::uuid from fct_ctx where k='f1') and event_type = 'client_confirmed'));

-- bank details + permit dates (5)
select fct.expect_error('permit dates: expiry before issue rejected', $q$select public.update_bsgt_financial_bank_details((select v::uuid from fct_ctx where k='f1'), 7, '{"import_permit_no":"IP-100","import_permit_issued_at":"2026-05-01","import_permit_expires_at":"2026-04-01"}')$q$, 'must not be before');
insert into fct_ctx select 'b1', public.update_bsgt_financial_bank_details((select v::uuid from fct_ctx where k='f1'), 7, '{"import_permit_no":" IP-100 ","import_permit_issued_at":"2026-05-01","import_permit_expires_at":"","import_permit_issuer":"  "}')::text;
select fct.check('bank details: trimmed number, blanks stored as null, lock 8', (select v::jsonb->'file'->>'import_permit_no' = 'IP-100' and (v::jsonb->'file'->>'import_permit_expires_at') is null and (v::jsonb->'file'->>'import_permit_issuer') is null and (v::jsonb->>'lock_version')::bigint = 8 from fct_ctx where k='b1'));

-- viewer boundary and unauthorized users
select fct.as_user('00000000-0000-4000-8000-0000000000a4');
select fct.check('viewer: can read', (select count(*) from public.bsgt_financial_files) = 3);
select fct.expect_error('viewer: cannot edit even with edit key', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 8, '{"notes":"v"}')$q$, 'edit permission');
select fct.expect_error('viewer: cannot approve even with approve key', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 8, 'approve')$q$, 'approve permission');
select fct.as_user('00000000-0000-4000-8000-0000000000a5');
select fct.check('ops user: sees nothing', (select count(*) from public.bsgt_financial_files) = 0 and (select count(*) from public.bsgt_financial_file_events) = 0);
select fct.expect_error('ops user: list rejected', $q$select * from public.list_bsgt_financial_files()$q$, 'view permission');
select fct.expect_error('ops user: create rejected', $q$select public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000f1')$q$, 'edit permission');
select fct.as_user('00000000-0000-4000-8000-0000000000a6');
select fct.check('nobody: sees nothing', (select count(*) from public.bsgt_financial_files) = 0);
select fct.expect_error('accountant cannot approve', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 8, 'approve')$q$, 'approve permission');

-- ================================================================ maker-checker / admin override
select fct.as_user('00000000-0000-4000-8000-0000000000a3');   -- finance manager (approve)
-- FM makes an input then tries to approve his own input
insert into fct_ctx select 'fm1', public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 8, '{"notes":"fm note"}')::text;
select fct.expect_error('maker-checker: last input user cannot approve', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 9, 'approve')$q$, 'Maker-checker');
select fct.as_user('00000000-0000-4000-8000-0000000000a1');   -- admin
insert into fct_ctx select 'adm1', public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 9, '{"notes":"admin note"}')::text;   -- admin is now last_input_by (lock 10)
select fct.expect_error('admin override: reason required', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 10, 'approve')$q$, 'Maker-checker');
-- admin override with a reason is exercised on file f6 below
select fct.as_user('00000000-0000-4000-8000-0000000000a7');   -- accountant 2 makes the last input so FM can approve normally
insert into fct_ctx select 'a2', public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 10, '{"notes":"acc2 note"}')::text;
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
-- stale consignee snapshot: change a consignee in TC before approval (superuser), then approve must fail
reset role;
update public.shipments set data = data || '{"consignee":"TEST BUYER ONE LTD"}' where id = '00000000-0000-4000-8000-0000000000e2';
set role authenticated;
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
select fct.expect_error('approve: stale consignee snapshot rejected', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 11, 'approve')$q$, 'snapshot is stale');
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
insert into fct_ctx select 's1', public.sync_bsgt_financial_invoices((select v::uuid from fct_ctx where k='f1'), 11)::text;
select fct.check('sync: consignee snapshot/count updated, lock 12', (select v::jsonb->'file'->>'consignee_snapshot' = 'TEST BUYER ONE | TEST BUYER ONE LTD' and (v::jsonb->'file'->>'consignee_count')::int = 2 and (v::jsonb->>'lock_version')::bigint = 12 and (v::jsonb->>'changed')::boolean from fct_ctx where k='s1'));
select fct.check('sync event: consignee before/after', (select changes->'consignee_snapshot' = '["TEST BUYER ONE", "TEST BUYER ONE | TEST BUYER ONE LTD"]'::jsonb and changes->'consignee_count' = '[1, 2]'::jsonb from public.bsgt_financial_file_events where financial_file_id = (select v::uuid from fct_ctx where k='f1') and event_type = 'invoices_synced' order by created_at desc limit 1));
insert into fct_ctx select 's1b', public.sync_bsgt_financial_invoices((select v::uuid from fct_ctx where k='f1'), 12)::text;
select fct.check('sync: no-op keeps lock 12', (select (v::jsonb->>'lock_version')::bigint = 12 and (v::jsonb->>'changed')::boolean = false from fct_ctx where k='s1b'));
-- sync add / detach / reattach
reset role;
delete from public.trade_collection_file_shipments where trade_file_id = '00000000-0000-4000-8000-0000000000f1' and shipment_id = '00000000-0000-4000-8000-0000000000e2';
set role authenticated;
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
insert into fct_ctx select 's2', public.sync_bsgt_financial_invoices((select v::uuid from fct_ctx where k='f1'), 12)::text;
select fct.check('sync: detached list + confirmed amount kept on detached row', (select v::jsonb->'detached' = jsonb_build_array('00000000-0000-4000-8000-0000000000e2') and (v::jsonb->'file'->>'invoice_total_usd')::numeric = 1000 and (v::jsonb->'file'->>'consignee_count')::int = 1 from fct_ctx where k='s2')
  and (select amount_usd = 500 and detached_at is not null from public.bsgt_financial_file_invoices where id = (select v::uuid from fct_ctx where k='inv2')));
select fct.expect_error('detached invoice cannot be confirmed', $q$select public.confirm_bsgt_financial_invoice((select v::uuid from fct_ctx where k='inv2'), 13, 500)$q$, 'Detached');
reset role;
insert into public.trade_collection_file_shipments (trade_file_id, shipment_id) values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e2');
insert into public.trade_collection_file_shipments (trade_file_id, shipment_id) values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e8');
set role authenticated;
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
insert into fct_ctx select 's3', public.sync_bsgt_financial_invoices((select v::uuid from fct_ctx where k='f1'), 13)::text;
select fct.check('sync: reattached clears confirmation and refreshes snapshot; added row appears', (select v::jsonb->'reattached' = jsonb_build_array('00000000-0000-4000-8000-0000000000e2') and v::jsonb->'added' = jsonb_build_array('00000000-0000-4000-8000-0000000000e8') and (v::jsonb->'file'->>'invoice_total_usd') is null and (v::jsonb->'file'->>'consignee_count')::int = 3 from fct_ctx where k='s3')
  and (select amount_usd is null and amount_confirmed_at is null and detached_at is null from public.bsgt_financial_file_invoices where id = (select v::uuid from fct_ctx where k='inv2')));
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
select fct.expect_error('approve: unconfirmed invoices rejected', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 14, 'approve')$q$, 'Unconfirmed');
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
-- make file f1 approvable again: confirm both, set client, keep accountant as last input
insert into fct_ctx select 'c2b', public.confirm_bsgt_financial_invoice((select v::uuid from fct_ctx where k='inv2'), 14, 500)::text;
insert into fct_ctx select 'inv7', id::text from public.bsgt_financial_file_invoices where financial_file_id = (select v::uuid from fct_ctx where k='f1') and shipment_id = '00000000-0000-4000-8000-0000000000e8';
insert into fct_ctx select 'c7', public.confirm_bsgt_financial_invoice((select v::uuid from fct_ctx where k='inv7'), 15, 250)::text;
select fct.check('total after re-confirmation = 1750', (select (v::jsonb->'file'->>'invoice_total_usd')::numeric = 1750 and (v::jsonb->>'lock_version')::bigint = 16 from fct_ctx where k='c7'));
-- approval membership check: force an extra TC link not in invoices (superuser) then expect rejection
reset role;
alter table public.trade_collection_file_shipments disable trigger trade_file_shipments_collection_mode;
insert into public.trade_collection_file_shipments (trade_file_id, shipment_id) values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e9');
alter table public.trade_collection_file_shipments enable trigger trade_file_shipments_collection_mode;
set role authenticated;
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
select fct.expect_error('approve: TC shipments changed after creation rejected', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 16, 'approve')$q$, 'shipments changed|snapshot is stale');
reset role;
delete from public.trade_collection_file_shipments where trade_file_id = '00000000-0000-4000-8000-0000000000f1' and shipment_id = '00000000-0000-4000-8000-0000000000e9';
set role authenticated;
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
-- eligibility re-check at approval: archive TC then expect rejection, restore
reset role; update public.trade_collection_files set archived_at = now(), archived_by = '00000000-0000-4000-8000-0000000000a1' where id = '00000000-0000-4000-8000-0000000000f1'; set role authenticated;
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
select fct.expect_error('approve: archived TC rejected at approval', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 16, 'approve')$q$, 'archived');
reset role; update public.trade_collection_files set archived_at = null, archived_by = null where id = '00000000-0000-4000-8000-0000000000f1'; set role authenticated;
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
insert into fct_ctx select 'ap', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 16, 'approve')::text;
select fct.check('approve: pending_client_transfer, approved stamps, lock 17', (select v::jsonb->'file'->>'status' = 'pending_client_transfer' and (v::jsonb->'file'->>'approved_by') = '00000000-0000-4000-8000-0000000000a3' and (v::jsonb->>'lock_version')::bigint = 17 from fct_ctx where k='ap'));
select fct.expect_error('locked: tariff change after approval rejected', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 17, '{"bank_tariff_per_1000_sdg":"1"}')$q$, 'not allowed in status');
select fct.expect_error('locked: sync after approval rejected', $q$select public.sync_bsgt_financial_invoices((select v::uuid from fct_ctx where k='f1'), 17)$q$, 'not allowed in status');
select fct.expect_error('transition: complete from pending rejected', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 17, 'complete')$q$, 'not allowed');
select fct.expect_error('transition: start_refund without failure rejected', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 17, 'start_refund')$q$, 'not allowed');
select fct.expect_error('transition: close before completion rejected', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 17, 'close')$q$, 'not allowed');
-- reopen then re-approve (accountant edits in between so FM stays checker)
insert into fct_ctx select 'ro', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 17, 'reopen')::text;
select fct.check('reopen: draft, approval stamps cleared, lock 18', (select v::jsonb->'file'->>'status' = 'draft' and (v::jsonb->'file'->>'approved_at') is null and (v::jsonb->>'lock_version')::bigint = 18 from fct_ctx where k='ro'));
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
insert into fct_ctx select 'u3', public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 18, '{"notes":"after reopen"}')::text;
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
insert into fct_ctx select 'ap2', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 19, 'approve')::text;
select fct.check('re-approve after reopen (lock 20)', (select v::jsonb->'file'->>'status' = 'pending_client_transfer' and (v::jsonb->>'lock_version')::bigint = 20 from fct_ctx where k='ap2'));
-- client transfer, bank payment prerequisites (permit number, AED)
insert into fct_ctx select 'ct', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 20, 'confirm_client_transfer')::text;
select fct.check('client transfer confirmed (lock 21)', (select v::jsonb->'file'->>'status' = 'client_transferred' and (v::jsonb->>'lock_version')::bigint = 21 from fct_ctx where k='ct'));
select fct.expect_error('bank payment: AED value required', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 21, 'confirm_bank_payment')$q$, 'AED');
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
insert into fct_ctx select 'b2', public.update_bsgt_financial_bank_details((select v::uuid from fct_ctx where k='f1'), 21, '{"documents_value_aed":"5512.50"}')::text;
select fct.check('bank details editable after approval (lock 22)', (select (v::jsonb->'file'->>'documents_value_aed')::numeric = 5512.5 and (v::jsonb->>'lock_version')::bigint = 22 from fct_ctx where k='b2'));
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
insert into fct_ctx select 'bp', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 22, 'confirm_bank_payment')::text;
select fct.check('bank paid (lock 23)', (select v::jsonb->'file'->>'status' = 'bank_paid' and (v::jsonb->>'lock_version')::bigint = 23 from fct_ctx where k='bp'));
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
select fct.expect_error('bank details locked after bank payment', $q$select public.update_bsgt_financial_bank_details((select v::uuid from fct_ctx where k='f1'), 23, '{"import_permit_no":"IP-200"}')$q$, 'not allowed in status');
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
select fct.expect_error('complete: TC not sent_to_collecting rejected', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 23, 'complete')$q$, 'collecting bank');
reset role; update public.trade_collection_files set status = 'sent_to_collecting', sent_to_collecting_at = now() where id = '00000000-0000-4000-8000-0000000000f1'; set role authenticated;
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
insert into fct_ctx select 'cp', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 23, 'complete')::text;
select fct.check('completed (lock 24)', (select v::jsonb->'file'->>'status' = 'completed' and (v::jsonb->>'lock_version')::bigint = 24 from fct_ctx where k='cp'));
insert into fct_ctx select 'cl', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 24, 'close')::text;
select fct.check('close keeps status completed and sets closed_at (lock 25)', (select v::jsonb->'file'->>'status' = 'completed' and (v::jsonb->'file'->>'closed_at') is not null and (v::jsonb->>'lock_version')::bigint = 25 from fct_ctx where k='cl'));
select fct.check('close event logged', (select count(*) = 1 from public.bsgt_financial_file_events where financial_file_id = (select v::uuid from fct_ctx where k='f1') and event_type = 'closed'));
-- immutability after close (every category, every path)
select fct.expect_error('closed: transition rejected', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f1'), 25, 'fail', 'x')$q$, 'closed');
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
select fct.expect_error('closed: notes via draft rpc rejected', $q$select public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f1'), 25, '{"notes":"late"}')$q$, 'closed');
select fct.expect_error('closed: bank details rpc rejected', $q$select public.update_bsgt_financial_bank_details((select v::uuid from fct_ctx where k='f1'), 25, '{"import_permit_issuer":"x"}')$q$, 'closed');
select fct.expect_error('closed: client rpc rejected', $q$select public.confirm_bsgt_financial_client((select v::uuid from fct_ctx where k='f1'), 25, '00000000-0000-4000-8000-0000000000c2')$q$, 'closed');
reset role;
select fct.expect_error('closed: superuser direct update notes rejected by guard', $q$update public.bsgt_financial_files set notes = 'x' where id = (select v::uuid from fct_ctx where k='f1')$q$, 'immutable');
select fct.expect_error('closed: superuser direct update stamp rejected by guard', $q$update public.bsgt_financial_files set completed_at = now() where id = (select v::uuid from fct_ctx where k='f1')$q$, 'immutable');
select fct.expect_error('closed: superuser direct update last_input rejected by guard', $q$update public.bsgt_financial_files set last_input_at = now() where id = (select v::uuid from fct_ctx where k='f1')$q$, 'immutable');
select fct.expect_error('closed: superuser direct update status rejected by guard', $q$update public.bsgt_financial_files set status = 'failed' where id = (select v::uuid from fct_ctx where k='f1')$q$, 'immutable');
-- events append-only (even for superuser); FK restrict protects history
select fct.expect_error('events: update rejected', $q$update public.bsgt_financial_file_events set note = 'x' where financial_file_id = (select v::uuid from fct_ctx where k='f1')$q$, 'append-only');
select fct.expect_error('events: delete rejected', $q$delete from public.bsgt_financial_file_events where financial_file_id = (select v::uuid from fct_ctx where k='f1')$q$, 'append-only');
select fct.expect_error('fk: deleting a trade file with a financial file fails', $q$delete from public.trade_collection_files where id = '00000000-0000-4000-8000-0000000000f1'$q$, 'violates foreign key|restrict');
select fct.expect_error('fk: deleting a financial file fails (invoices/events restrict)', $q$delete from public.bsgt_financial_files where id = (select v::uuid from fct_ctx where k='f1')$q$, 'violates foreign key|restrict');
select fct.expect_error('constraint: expiry before issue rejected at table level', $q$update public.bsgt_financial_files set import_permit_issued_at = '2026-05-01', import_permit_expires_at = '2026-04-01' where id = (select v::uuid from fct_ctx where k='f2')$q$, 'bff_permit_dates_check|immutable');
select fct.expect_error('constraint: direct status change rejected outside transition', $q$update public.bsgt_financial_files set status = 'failed' where id = (select v::uuid from fct_ctx where k='f2')$q$, 'only through transition');
-- archived TC keeps the financial file visible
update public.trade_collection_files set archived_at = now(), archived_by = '00000000-0000-4000-8000-0000000000a1' where id = '00000000-0000-4000-8000-0000000000f1';
set role authenticated;
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
select fct.check('archived TC: file still listed with trade_archived_at', (select trade_archived_at is not null from public.list_bsgt_financial_files() where id = (select v::uuid from fct_ctx where k='f1')));

-- ================================================================ failure paths
-- f2: fail from draft (no approval stamps), then close directly
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
select fct.expect_error('fail: reason required', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f2'), 3, 'fail')$q$, 'reason');
insert into fct_ctx select 'fd', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f2'), 3, 'fail', 'client withdrew before costing')::text;
select fct.check('fail from draft: failed without approval stamps', (select v::jsonb->'file'->>'status' = 'failed' and (v::jsonb->'file'->>'approved_at') is null and (v::jsonb->'file'->>'failed_by') = '00000000-0000-4000-8000-0000000000a3' from fct_ctx where k='fd'));
select fct.check('fail from draft: event from_status=draft', (select from_status = 'draft' and to_status = 'failed' from public.bsgt_financial_file_events where financial_file_id = (select v::uuid from fct_ctx where k='f2') and event_type = 'failed'));
select fct.expect_error('fail from draft: refund not allowed (no transfer)', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f2'), 4, 'start_refund')$q$, 'not allowed');
insert into fct_ctx select 'fdc', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f2'), 4, 'close')::text;
select fct.check('fail from draft: closed directly, status stays failed', (select v::jsonb->'file'->>'status' = 'failed' and (v::jsonb->'file'->>'closed_at') is not null from fct_ctx where k='fdc'));
-- f6: full refund path after client transfer
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
insert into fct_ctx select 'u6', public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f6'), 2, '{"bank_tariff_per_1000_sdg":"100","bsgt_tariff_per_1000_sdg":"50","import_permit_source":"client"}')::text;
insert into fct_ctx select 'k6', public.confirm_bsgt_financial_client((select v::uuid from fct_ctx where k='f6'), 3, '00000000-0000-4000-8000-0000000000c2')::text;
select fct.expect_error('approve: client-provided permit number required', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f6'), 4, 'approve')$q$, 'approve permission');
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
select fct.expect_error('approve: client-provided permit number required (fm)', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f6'), 4, 'approve')$q$, 'permit number is required');
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
select fct.expect_error('permit number: duplicate of IP-100 rejected (case/space-insensitive)', $q$select public.update_bsgt_financial_bank_details((select v::uuid from fct_ctx where k='f6'), 4, '{"import_permit_no":"ip-100 "}')$q$, 'duplicate key|bff_permit_no_uniq');
select fct.check('permit number: file f6 still has no number after rejected duplicate', (select import_permit_no is null and lock_version = 4 from public.bsgt_financial_files where id = (select v::uuid from fct_ctx where k='f6')));
insert into fct_ctx select 'b6b', public.update_bsgt_financial_bank_details((select v::uuid from fct_ctx where k='f6'), 4, '{"import_permit_no":"IP-200"}')::text;
-- admin override: admin becomes last input, then approves his own input only with a reason
select fct.as_user('00000000-0000-4000-8000-0000000000a1');
insert into fct_ctx select 'adm6', public.update_bsgt_financial_draft((select v::uuid from fct_ctx where k='f6'), 5, '{"notes":"admin touched"}')::text;
select fct.expect_error('admin override: no reason rejected', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f6'), 6, 'approve')$q$, 'Maker-checker');
select fct.expect_error('admin override: blank reason rejected', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f6'), 6, 'approve', null, '   ')$q$, 'Maker-checker');
insert into fct_ctx select 'ap6', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f6'), 6, 'approve', 'urgent', 'finance manager on leave; CEO instruction #17')::text;
select fct.check('admin override with reason: approved, lock 7', (select v::jsonb->'file'->>'status' = 'pending_client_transfer' and (v::jsonb->>'lock_version')::bigint = 7 from fct_ctx where k='ap6'));
select fct.check('admin override: event note records override', (select note like '%ADMIN OVERRIDE%CEO instruction #17%' from public.bsgt_financial_file_events where financial_file_id = (select v::uuid from fct_ctx where k='f6') and event_type = 'approved'));
select fct.as_user('00000000-0000-4000-8000-0000000000a3');
insert into fct_ctx select 'ct6', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f6'), 7, 'confirm_client_transfer')::text;
insert into fct_ctx select 'fl6', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f6'), 8, 'fail', 'bank rejected documents')::text;
select fct.check('fail after transfer: failed keeps approval + transfer stamps', (select v::jsonb->'file'->>'status' = 'failed' and (v::jsonb->'file'->>'approved_at') is not null and (v::jsonb->'file'->>'client_transferred_at') is not null from fct_ctx where k='fl6'));
select fct.expect_error('fail after transfer: close before refund rejected', $q$select public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f6'), 9, 'close')$q$, 'not allowed');
insert into fct_ctx select 'rs6', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f6'), 9, 'start_refund')::text;
insert into fct_ctx select 'rf6', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f6'), 10, 'confirm_refund')::text;
select fct.check('full refund: refunded with stamps', (select v::jsonb->'file'->>'status' = 'refunded' and (v::jsonb->'file'->>'refunded_at') is not null and (v::jsonb->>'lock_version')::bigint = 11 from fct_ctx where k='rf6'));
insert into fct_ctx select 'cl6', public.transition_bsgt_financial_file((select v::uuid from fct_ctx where k='f6'), 11, 'close')::text;
select fct.check('refunded then closed keeps status refunded', (select v::jsonb->'file'->>'status' = 'refunded' and (v::jsonb->'file'->>'closed_at') is not null from fct_ctx where k='cl6'));
select fct.check('records preserved: 3 files, no deletions', (select count(*) from public.bsgt_financial_files) = 3 and (select count(*) from public.bsgt_financial_file_events) >= 25);
select fct.check('status filter works after close', (select count(*) from public.list_bsgt_financial_files(p_status => 'refunded', p_closed => true)) = 1
  and (select count(*) from public.list_bsgt_financial_files(p_status => 'completed')) = 1 and (select count(*) from public.list_bsgt_financial_files(p_closed => false)) = 0);

-- ================================================================ keyset pagination (bulk synthetic files)
reset role;
do $$
declare i int; sid uuid; tid uuid;
begin
  for i in 1..23 loop
    sid := ('00000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid;
    tid := ('00000000-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid;
    insert into public.shipments (id, owner_id, status, company_id, bsgt_stage, data) values (sid, '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
      jsonb_build_object('operationNo', 'BSGTX-P-' || i, 'consignee', 'PAGE CLIENT ' || i, 'invoiceNo', 'P' || i, 'currency', 'USD', 'totalAmount', 'USD 10.00', 'paymentTerm', 'D/A 30 DAYS'));
    insert into public.trade_collection_files (id, company_id, status, created_by) values (tid, '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1');
    insert into public.trade_collection_file_shipments (trade_file_id, shipment_id) values (tid, sid);
  end loop;
end $$;
set role authenticated;
select fct.as_user('00000000-0000-4000-8000-0000000000a2');
select fct.check('eligible list: 23 pageable, limit default 10', (select count(*) from public.list_bsgt_financial_eligible_trade_files()) = 10);
-- simpler keyset walk: collect ids page by page
create temp table fct_pages (page int, id uuid, created_at timestamptz);
do $$
declare last_at timestamptz; last_id uuid; p int := 0; got int;
begin
  loop
    p := p + 1;
    insert into fct_pages select p, id, created_at from public.list_bsgt_financial_eligible_trade_files(null, 10, last_at, last_id);
    select count(*) into got from fct_pages where page = p;
    exit when got = 0 or p > 10;
    select created_at, id into last_at, last_id from fct_pages where page = p order by created_at, id limit 1;   -- last row of the page (desc order)
  end loop;
end $$;
select fct.check('keyset: pages of 10,10,3 with no duplicates', (select array_agg(c order by page) from (select page, count(*) c from fct_pages group by page) x) = '{10,10,3}'::bigint[]
  and (select count(distinct id) from fct_pages) = 23);
select fct.expect_error('keyset: half cursor rejected', $q$select * from public.list_bsgt_financial_files(null, null, null, 10, now(), null)$q$, 'Cursor requires both');
select fct.check('list: limit capped at 50 and search trimmed/limited', (select count(*) from public.list_bsgt_financial_files(null, repeat('x', 200), null, 500)) = 0);
select fct.check('list: prefix search on operation no', (select count(*) from public.list_bsgt_financial_files(null, 'tc-')) = 3);
select fct.check('list: search by consignee/client name (trgm ilike)', (select count(*) from public.list_bsgt_financial_files(null, 'BUYER TWO')) = 3 and (select count(*) from public.list_bsgt_financial_files(null, 'buyer one ltd')) = 1);
select fct.check('list: search by permit number', (select count(*) from public.list_bsgt_financial_files(null, 'IP-2')) = 1);
reset role;
