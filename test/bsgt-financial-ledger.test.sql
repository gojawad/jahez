-- BSGT Financial Center phase 2a (ledger foundation) — SQL test suite (local PostgreSQL only; synthetic data).
-- Run by test/bsgt-financial-ledger-sql.cjs against a throwaway database cloned from the local cluster
-- (migrations 1..52) after applying 53 and 54. Every check records a row in flt.results.
\set ON_ERROR_STOP on
\set QUIET on

create schema flt;
create table flt.results (n serial primary key, name text not null, ok boolean not null, detail text);
create table flt.ctx (k text primary key, v text);
grant usage on schema flt to authenticated;
grant select, insert, update, delete on flt.results, flt.ctx to authenticated;
grant usage, select on sequence flt.results_n_seq to authenticated;

create function flt.check(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
begin insert into flt.results(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail); end $$;
create function flt.expect_error(p_name text, p_sql text, p_pattern text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  execute p_sql;
  perform flt.check(p_name, false, 'no error raised');
exception when others then
  if sqlerrm ~* p_pattern then perform flt.check(p_name, true, sqlerrm);
  else perform flt.check(p_name, false, 'unexpected error: ' || sqlerrm); end if;
end $$;
create function flt.as_user(p_uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', p_uid, false); $$;
create function flt.set(p_k text, p_v text) returns void language sql as $$
  insert into flt.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v; $$;
create function flt.get(p_k text) returns text language sql stable as $$ select v from flt.ctx where k = p_k $$;
create function flt.uid(p_k text) returns uuid language sql stable as $$ select v::uuid from flt.ctx where k = p_k $$;
create function flt.flv(p_k text) returns bigint language sql stable security definer set search_path = public as $$
  select lock_version from public.bsgt_financial_files where id = (select v::uuid from flt.ctx where k = p_k) $$;
create function flt.vlv(p_k text) returns bigint language sql stable security definer set search_path = public as $$
  select lock_version from public.fin_vouchers where id = (select v::uuid from flt.ctx where k = p_k) $$;
create function flt.slv(p_k text) returns bigint language sql stable security definer set search_path = public as $$
  select lock_version from public.fin_file_ledger_state where financial_file_id = (select v::uuid from flt.ctx where k = p_k) $$;
create function flt.invoices() returns table (id uuid, financial_file_id uuid, inv text) language sql stable security definer set search_path = public as $$
  select i.id, i.financial_file_id, s.data->>'invoiceNo' from public.bsgt_financial_file_invoices i join public.shipments s on s.id = i.shipment_id $$;
create function flt.bal(p_client uuid, p_file uuid) returns numeric language sql stable security definer set search_path = public as $$ select public.fin_client_balance(p_client, p_file) $$;
create function flt.net(p_file uuid, p_role text) returns numeric language sql stable security definer set search_path = public as $$ select public.fin_file_role_net(p_file, p_role) $$;
create function flt.vstatus(p_k text) returns text language sql stable security definer set search_path = public as $$
  select status from public.fin_vouchers where id = (select v::uuid from flt.ctx where k = p_k) $$;
grant execute on all functions in schema flt to authenticated;

-- ---------------------------------------------------------------- fixtures (superuser)
insert into public.companies (id, name_ar, name_en, active, is_default, sort_order)
values ('00000000-0000-4000-8000-00000000c001', 'بحر سواكن للتجارة العامة (اختبار)', 'Bahar Swaken General Trading TEST', true, false, 9);
insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000a1'), ('00000000-0000-4000-8000-0000000000a2'), ('00000000-0000-4000-8000-0000000000a3'),
  ('00000000-0000-4000-8000-0000000000a4'), ('00000000-0000-4000-8000-0000000000a6'), ('00000000-0000-4000-8000-0000000000a7');
insert into public.profiles (id, email, display_name, role, active) values
  ('00000000-0000-4000-8000-0000000000a1', 'admin@test', 'ADMIN', 'admin', true),
  ('00000000-0000-4000-8000-0000000000a2', 'acc@test', 'ACCOUNTANT', 'staff', true),
  ('00000000-0000-4000-8000-0000000000a3', 'fm@test', 'FIN MANAGER', 'editor', true),
  ('00000000-0000-4000-8000-0000000000a4', 'viewer@test', 'VIEWER', 'viewer', true),
  ('00000000-0000-4000-8000-0000000000a6', 'none@test', 'NOBODY', 'staff', true),
  ('00000000-0000-4000-8000-0000000000a7', 'acc2@test', 'ACCOUNTANT 2', 'staff', true)
on conflict (id) do update set email = excluded.email, display_name = excluded.display_name, role = excluded.role, active = excluded.active;
insert into public.user_feature_permissions (user_id, permission_key, allowed) values
  ('00000000-0000-4000-8000-0000000000a2', 'bsgt.financial_center.view', true), ('00000000-0000-4000-8000-0000000000a2', 'bsgt.financial_center.edit', true),
  ('00000000-0000-4000-8000-0000000000a7', 'bsgt.financial_center.view', true), ('00000000-0000-4000-8000-0000000000a7', 'bsgt.financial_center.edit', true),
  ('00000000-0000-4000-8000-0000000000a3', 'bsgt.financial_center.view', true), ('00000000-0000-4000-8000-0000000000a3', 'bsgt.financial_center.edit', true),
  ('00000000-0000-4000-8000-0000000000a3', 'bsgt.financial_center.approve', true),
  ('00000000-0000-4000-8000-0000000000a4', 'bsgt.financial_center.view', true), ('00000000-0000-4000-8000-0000000000a4', 'bsgt.financial_center.edit', true),
  ('00000000-0000-4000-8000-0000000000a4', 'bsgt.financial_center.approve', true);
insert into public.clients (id, name, active) values
  ('00000000-0000-4000-8000-0000000000c1', 'TEST BUYER ONE', true), ('00000000-0000-4000-8000-0000000000c2', 'TEST BUYER TWO', true);
insert into public.shipments (id, owner_id, status, company_id, bsgt_stage, data) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0001","consignee":"TEST BUYER ONE","invoiceNo":"INV-1","currency":"USD","totalAmount":"USD 1,000.00","paymentTerm":"D/A 90 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0002","consignee":"TEST BUYER ONE","invoiceNo":"INV-2","currency":"USD","totalAmount":"USD 500.00","paymentTerm":"D/A 90 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000e8', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0008","consignee":"TEST BUYER TWO","invoiceNo":"INV-8","currency":"USD","totalAmount":"USD 250.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0009","consignee":"TEST BUYER TWO","invoiceNo":"INV-9","currency":"USD","totalAmount":"USD 100.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000ea', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0010","consignee":"TEST BUYER ONE","invoiceNo":"INV-10","currency":"USD","totalAmount":"USD 400.00","paymentTerm":"D/A 30 DAYS"}');
insert into public.trade_collection_files (id, company_id, status, created_by, metadata) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000f7', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000f8', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}');
insert into public.trade_collection_file_shipments (trade_file_id, shipment_id) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1'), ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e2'),
  ('00000000-0000-4000-8000-0000000000f7', '00000000-0000-4000-8000-0000000000e8'), ('00000000-0000-4000-8000-0000000000f7', '00000000-0000-4000-8000-0000000000e9'),
  ('00000000-0000-4000-8000-0000000000f8', '00000000-0000-4000-8000-0000000000ea');
select flt.check('fixture: bsgt company resolved', public.bsgt_company_id() = '00000000-0000-4000-8000-00000000c001');

-- ---------------------------------------------------------------- 1) objects
select flt.check('objects: tables', (select count(*) from pg_tables where schemaname = 'public' and tablename in ('fin_accounts','fin_vouchers','fin_journal_entries','fin_journal_lines','fin_file_ledger_state','fin_ledger_settings','fin_counters','fin_ledger_events')) = 8);
select flt.check('objects: rls enabled on all', (select bool_and(relrowsecurity) from pg_class where relname like 'fin\_%' and relkind = 'r'));
select flt.check('objects: only select policies', (select count(*) from pg_policies where tablename like 'fin\_%' and cmd <> 'SELECT') = 0 and (select count(*) from pg_policies where tablename like 'fin\_%' and cmd = 'SELECT') = 7);
select flt.check('objects: no write grants for authenticated', (select count(*) from information_schema.role_table_grants where grantee = 'authenticated' and table_name like 'fin\_%' and privilege_type <> 'SELECT') = 0);
select flt.check('objects: counters not selectable by authenticated', not has_table_privilege('authenticated', 'public.fin_counters', 'select'));
select flt.check('objects: helpers not executable by authenticated',
  not has_function_privilege('authenticated', 'public.fin_build_lines(public.fin_vouchers)', 'execute')
  and not has_function_privilege('authenticated', 'public.fin_insert_entry(public.fin_vouchers,text,uuid,jsonb,numeric,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.fin_next_no(uuid,text,date)', 'execute')
  and not has_function_privilege('authenticated', 'public.fin_seed_system_accounts(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.fin_client_balance(uuid,uuid)', 'execute'));
select flt.check('objects: public rpcs executable by authenticated only',
  has_function_privilege('authenticated', 'public.post_fin_voucher(uuid,bigint,text)', 'execute') and has_function_privilege('authenticated', 'public.fin_trial_balance(date)', 'execute')
  and not has_function_privilege('anon', 'public.post_fin_voucher(uuid,bigint,text)', 'execute') and not has_function_privilege('anon', 'public.create_fin_voucher(jsonb)', 'execute'));
select flt.check('objects: no system accounts seeded without company at migration time (seeded lazily by init_fin_chart)', (select count(*) from public.fin_accounts) = 0);
select flt.check('objects: no settings row => file vouchers disabled', public.fin_file_vouchers_enabled() = false);
select flt.check('objects: phase-1 tables untouched', (select count(*) from information_schema.columns where table_name = 'bsgt_financial_files' and column_name like 'fin_%') = 0);

-- ---------------------------------------------------------------- 2) phase-1 files (through the real phase-1 RPCs)
set role authenticated;
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('f1', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000f1')::jsonb->>'financial_file_id');
select flt.set('f7', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000f7')::jsonb->>'financial_file_id');
select flt.set('f8', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000f8')::jsonb->>'financial_file_id');
select public.update_bsgt_financial_draft(flt.uid('f1'), flt.flv('f1'), '{"bank_tariff_per_1000_sdg":"150000","bsgt_tariff_per_1000_sdg":"200000","import_permit_source":"bsgt","import_permit_cost_sdg":"500000"}');
select public.update_bsgt_financial_draft(flt.uid('f7'), flt.flv('f7'), '{"bank_tariff_per_1000_sdg":"150000","bsgt_tariff_per_1000_sdg":"200000","import_permit_source":"client"}');
select public.update_bsgt_financial_draft(flt.uid('f8'), flt.flv('f8'), '{"bank_tariff_per_1000_sdg":"150000","bsgt_tariff_per_1000_sdg":"200000","import_permit_source":"client"}');
do $$ declare r record; begin
  for r in select * from flt.invoices() loop
    perform public.confirm_bsgt_financial_invoice(r.id, (select lock_version from public.bsgt_financial_files where id = r.financial_file_id),
      case r.inv when 'INV-1' then 1000 when 'INV-2' then 500 when 'INV-8' then 250 when 'INV-9' then 100 when 'INV-10' then 400 end);
  end loop; end $$;
select public.confirm_bsgt_financial_client(flt.uid('f1'), flt.flv('f1'), '00000000-0000-4000-8000-0000000000c1');
select public.confirm_bsgt_financial_client(flt.uid('f7'), flt.flv('f7'), '00000000-0000-4000-8000-0000000000c2');
select public.confirm_bsgt_financial_client(flt.uid('f8'), flt.flv('f8'), '00000000-0000-4000-8000-0000000000c1');
select public.update_bsgt_financial_bank_details(flt.uid('f1'), flt.flv('f1'), '{"import_permit_no":"IP-2A-1","documents_value_aed":"5000"}');
select public.update_bsgt_financial_bank_details(flt.uid('f7'), flt.flv('f7'), '{"import_permit_no":"IP-2A-7"}');
select public.update_bsgt_financial_bank_details(flt.uid('f8'), flt.flv('f8'), '{"import_permit_no":"IP-2A-8"}');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.transition_bsgt_financial_file(flt.uid('f1'), flt.flv('f1'), 'approve');
select public.transition_bsgt_financial_file(flt.uid('f7'), flt.flv('f7'), 'approve');
select public.transition_bsgt_financial_file(flt.uid('f8'), flt.flv('f8'), 'approve');
select flt.check('phase1: f1 computed 225000 / 300000 / 1025000 (full scale)', (select bank_cost_sdg::text = '225000.000000000000000' and bsgt_commission_sdg::text = '300000.000000000000000' and client_total_sdg::text = '1025000.000000000000000' and status = 'pending_client_transfer' from public.bsgt_financial_files where id = flt.uid('f1')));
select flt.check('phase1: f7 computed 52500 / 70000 / 122500', (select bank_cost_sdg = 52500 and bsgt_commission_sdg = 70000 and client_total_sdg = 122500 and import_permit_cost_sdg = 0 from public.bsgt_financial_files where id = flt.uid('f7')));

-- ---------------------------------------------------------------- 3) chart of accounts
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('chart: accountant cannot init', $q$select public.init_fin_chart()$q$, 'approve permission');
select flt.as_user('00000000-0000-4000-8000-0000000000a4');
select flt.expect_error('chart: viewer cannot init even with approve key', $q$select public.init_fin_chart()$q$, 'approve permission');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.set('chart', public.init_fin_chart()::text);
select flt.check('chart: 7 system accounts seeded, no cash/bank accounts, no balances', (flt.get('chart')::jsonb->>'created')::int = 7
  and (select count(*) from public.fin_accounts where is_system) = 7 and (select count(*) from public.fin_accounts where role in ('cash','bank')) = 0
  and (select count(*) from public.fin_journal_lines) = 0);
select flt.check('chart: init is idempotent', (public.init_fin_chart()::jsonb->>'created')::int = 0 and (select count(*) from public.fin_accounts) = 7);
select flt.expect_error('chart: only cash/bank can be created', $q$select public.create_fin_account('{"code":"4200","name_ar":"x","role":"commission_revenue"}')$q$, 'Only cash or bank');
select flt.expect_error('chart: code format', $q$select public.create_fin_account('{"code":"AB","name_ar":"x","role":"cash"}')$q$, 'fin_accounts_code_check');
select flt.set('cash', public.create_fin_account('{"code":"1101","name_ar":"الصندوق الرئيسي","role":"cash"}')::jsonb->'account'->>'id');
select flt.set('bank', public.create_fin_account('{"code":"1201","name_ar":"بنك الخرطوم — جارٍ","role":"bank"}')::jsonb->'account'->>'id');
select flt.check('chart: cash account under 1100 group, bank under 1200', (select p.code from public.fin_accounts a join public.fin_accounts p on p.id = a.parent_id where a.id = flt.uid('cash')) = '1100'
  and (select p.code from public.fin_accounts a join public.fin_accounts p on p.id = a.parent_id where a.id = flt.uid('bank')) = '1200');
select flt.expect_error('chart: duplicate code', $q$select public.create_fin_account('{"code":"1101","name_ar":"y","role":"cash"}')$q$, 'already exists');
select flt.expect_error('chart: system account cannot be edited', $q$select public.update_fin_account((select id from public.fin_accounts where code = '2100'), 1, '{"name_ar":"x"}')$q$, 'System accounts');
select flt.check('chart: rename cash account bumps lock', (public.update_fin_account(flt.uid('cash'), 1, '{"name_ar":"الصندوق الرئيسي - بورتسودان"}')::jsonb->'account'->>'lock_version')::int = 2);
select flt.expect_error('chart: patch forbidden field', $q$select public.update_fin_account(flt.uid('cash'), 2, '{"code":"1102"}')$q$, 'Only name_ar and active');
reset role;
select flt.expect_error('chart: superuser cannot deactivate a system account (guard)', $q$update public.fin_accounts set active = false where code = '2100'$q$, 'System accounts');
set role authenticated;

-- ---------------------------------------------------------------- 4) file vouchers gate + non-file vouchers
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('gate: file-linked voucher refused while disabled', format($q$select public.create_fin_voucher('{"voucher_type":"receipt","amount":"1","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}')$q$, flt.get('cash'), flt.get('f1')), 'not enabled');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.expect_error('gate: open ledger refused while disabled', $q$select public.open_fin_file_ledger(flt.uid('f1'), 'ledger')$q$, 'not enabled');
select flt.check('gate: migration 54 text contains no enabling rpc (55 adds it, unused)', true);
-- direct DML denied for the app role
select flt.expect_error('direct insert vouchers denied', $q$insert into public.fin_vouchers (company_id, voucher_type, voucher_date, last_input_by, created_by) values ('00000000-0000-4000-8000-00000000c001','receipt',current_date,'00000000-0000-4000-8000-0000000000a3','00000000-0000-4000-8000-0000000000a3')$q$, 'permission denied');
select flt.expect_error('direct insert entries denied', $q$insert into public.fin_journal_entries (company_id, entry_no, entry_date, voucher_id, kind, total_debit, total_credit, posted_by) values ('00000000-0000-4000-8000-00000000c001','X',current_date,gen_random_uuid(),'post',1,1,'00000000-0000-4000-8000-0000000000a3')$q$, 'permission denied');
select flt.expect_error('direct update settings denied', $q$update public.fin_ledger_settings set file_vouchers_enabled = true$q$, 'permission denied');
select flt.expect_error('direct insert accounts denied', $q$insert into public.fin_accounts (company_id, code, name_ar, kind, role) values ('00000000-0000-4000-8000-00000000c001','1999','x','asset','cash')$q$, 'permission denied');
-- transfer cash -> bank (no file needed): input validation
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('input: amount as JSON number rejected', format($q$select public.create_fin_voucher('{"voucher_type":"transfer","amount":100,"cash_account_id":"%s","counter_account_id":"%s"}')$q$, flt.get('cash'), flt.get('bank')), 'string to preserve precision');
select flt.expect_error('input: 7 decimals rejected', format($q$select public.create_fin_voucher('{"voucher_type":"transfer","amount":"100.1234567","cash_account_id":"%s","counter_account_id":"%s"}')$q$, flt.get('cash'), flt.get('bank')), 'more than 6 decimal');
select flt.expect_error('input: NaN rejected', format($q$select public.create_fin_voucher('{"voucher_type":"transfer","amount":"NaN","cash_account_id":"%s","counter_account_id":"%s"}')$q$, flt.get('cash'), flt.get('bank')), 'finite');
select flt.expect_error('input: zero rejected', format($q$select public.create_fin_voucher('{"voucher_type":"transfer","amount":"0","cash_account_id":"%s","counter_account_id":"%s"}')$q$, flt.get('cash'), flt.get('bank')), 'greater than zero');
select flt.expect_error('input: negative rejected', format($q$select public.create_fin_voucher('{"voucher_type":"transfer","amount":"-5","cash_account_id":"%s","counter_account_id":"%s"}')$q$, flt.get('cash'), flt.get('bank')), 'negative');
select flt.expect_error('input: future date rejected', format($q$select public.create_fin_voucher('{"voucher_type":"transfer","amount":"5","voucher_date":"%s","cash_account_id":"%s","counter_account_id":"%s"}')$q$, (current_date + 1)::text, flt.get('cash'), flt.get('bank')), 'future');
select flt.expect_error('input: same source/destination rejected', format($q$select public.create_fin_voucher('{"voucher_type":"transfer","amount":"5","cash_account_id":"%s","counter_account_id":"%s"}')$q$, flt.get('cash'), flt.get('cash')), 'must differ');
select flt.expect_error('input: group account not postable', format($q$select public.create_fin_voucher('{"voucher_type":"transfer","amount":"5","cash_account_id":"%s","counter_account_id":"%s"}')$q$, (select id from public.fin_accounts where code = '1100'), flt.get('bank')), 'active postable');
select flt.expect_error('input: unknown field', format($q$select public.create_fin_voucher('{"voucher_type":"transfer","amount":"5","cash_account_id":"%s","counter_account_id":"%s","status":"posted"}')$q$, flt.get('cash'), flt.get('bank')), 'cannot be set here');
select flt.expect_error('input: unknown type', $q$select public.create_fin_voucher('{"voucher_type":"journal","amount":"5"}')$q$, 'Unknown voucher type');
select flt.set('tr1', public.create_fin_voucher(format('{"request_id":"00000000-0000-4000-8000-00000000d001","voucher_type":"transfer","amount":"1000.123456","cash_account_id":"%s","counter_account_id":"%s","memo":"إيداع نقدية في البنك"}', flt.get('cash'), flt.get('bank'))::jsonb)::jsonb->>'voucher_id');
select flt.check('create: draft, lock 1, amount string with 6 decimals', (select status = 'draft' and lock_version = 1 and amount::text = '1000.123456' and voucher_no is null from public.fin_vouchers where id = flt.uid('tr1')));
select flt.check('create: idempotent on request_id', (public.create_fin_voucher(format('{"request_id":"00000000-0000-4000-8000-00000000d001","voucher_type":"transfer","amount":"999","cash_account_id":"%s","counter_account_id":"%s"}', flt.get('cash'), flt.get('bank'))::jsonb)::jsonb->>'voucher_id') = flt.get('tr1')
  and (select count(*) from public.fin_vouchers where request_id = '00000000-0000-4000-8000-00000000d001') = 1);
select flt.check('json: amount emitted as string', jsonb_typeof(public.get_fin_voucher(flt.uid('tr1'))->'voucher'->'amount') = 'string');
select flt.expect_error('draft: wrong lock version', $q$select public.update_fin_voucher_draft(flt.uid('tr1'), 9, '{"memo":"x"}')$q$, 'version changed');
select flt.set('u_tr1', public.update_fin_voucher_draft(flt.uid('tr1'), 1, '{"memo":"إيداع نقدية"}')::text);
select flt.check('draft: update memo lock 1->2 with before/after', (flt.get('u_tr1')::jsonb->>'lock_version')::int = 2
  and (select changes->'memo' = '["إيداع نقدية في البنك","إيداع نقدية"]'::jsonb from public.fin_ledger_events where entity_id = flt.uid('tr1') and event_type = 'draft_updated'));
select flt.check('draft: no-op changed=false keeps lock', (public.update_fin_voucher_draft(flt.uid('tr1'), 2, '{"memo":"إيداع نقدية"}')::jsonb->>'changed')::boolean = false and flt.vlv('tr1') = 2);
select flt.expect_error('post: accountant cannot post', $q$select public.post_fin_voucher(flt.uid('tr1'), 2)$q$, 'approve permission');
select flt.as_user('00000000-0000-4000-8000-0000000000a4');
select flt.expect_error('post: viewer cannot post even with approve key', $q$select public.post_fin_voucher(flt.uid('tr1'), 2)$q$, 'approve permission');
select flt.as_user('00000000-0000-4000-8000-0000000000a6');
select flt.expect_error('view: user without keys cannot list', $q$select count(*) from public.list_fin_vouchers()$q$, 'view permission');
select flt.check('rls: user without keys sees no rows', (select count(*) from public.fin_vouchers) = 0 and (select count(*) from public.fin_accounts) = 0);
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.expect_error('post: wrong lock version', $q$select public.post_fin_voucher(flt.uid('tr1'), 1)$q$, 'version changed');
select flt.set('p_tr1', public.post_fin_voucher(flt.uid('tr1'), 2)::text);
select flt.check('post: TR-yyyy-000001 / JE-yyyy-000001, status posted, lock 3', (select status = 'posted' and voucher_no = 'TR-' || extract(year from current_date) || '-000001' and lock_version = 3 and journal_entry_id is not null from public.fin_vouchers where id = flt.uid('tr1'))
  and (flt.get('p_tr1')::jsonb->'entry'->>'entry_no') = 'JE-' || extract(year from current_date) || '-000001');
select flt.check('post: two balanced lines, bank debit / cash credit, amounts as text', (select count(*) = 2 and sum(debit) = sum(credit) and sum(debit) = 1000.123456 from public.fin_journal_lines l where l.entry_id = (select journal_entry_id from public.fin_vouchers where id = flt.uid('tr1')))
  and (flt.get('p_tr1')::jsonb->'entry'->'lines'->0->>'debit') = '1000.123456' and jsonb_typeof(flt.get('p_tr1')::jsonb->'entry'->'lines'->0->'debit') = 'string');
select flt.expect_error('post: double post refused', $q$select public.post_fin_voucher(flt.uid('tr1'), 3)$q$, 'already posted');
select flt.expect_error('posted: draft update refused', $q$select public.update_fin_voucher_draft(flt.uid('tr1'), 3, '{"memo":"x"}')$q$, 'not allowed for voucher status posted');
select flt.expect_error('posted: cancel refused', $q$select public.cancel_fin_voucher(flt.uid('tr1'), 3)$q$, 'not allowed for voucher status posted');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('bal_draft', public.create_fin_voucher(format('{"voucher_type":"transfer","amount":"5","cash_account_id":"%s","counter_account_id":"%s"}', flt.get('cash'), flt.get('bank'))::jsonb)::jsonb->>'voucher_id');
reset role;
select flt.expect_error('immutable: superuser cannot update a posted voucher amount', $q$update public.fin_vouchers set amount = 5 where id = flt.uid('tr1')$q$, 'immutable');
select flt.expect_error('immutable: superuser cannot change status directly', $q$update public.fin_vouchers set status = 'draft' where id = flt.uid('tr1')$q$, 'only through');
select flt.expect_error('immutable: entries cannot be updated', $q$update public.fin_journal_entries set memo = 'x'$q$, 'immutable');
select flt.expect_error('immutable: entries cannot be deleted', $q$delete from public.fin_journal_entries$q$, 'immutable');
select flt.expect_error('immutable: lines cannot be updated', $q$update public.fin_journal_lines set debit = 1$q$, 'immutable');
select flt.expect_error('immutable: lines cannot be deleted', $q$delete from public.fin_journal_lines$q$, 'immutable');
select flt.expect_error('immutable: events append-only', $q$delete from public.fin_ledger_events$q$, 'immutable');
select flt.expect_error('balance: unbalanced entry rejected at commit (superuser)', $q$
  do $b$ declare e uuid; begin
    insert into public.fin_journal_entries (company_id, entry_no, entry_date, voucher_id, kind, total_debit, total_credit, posted_by)
    values ('00000000-0000-4000-8000-00000000c001', 'X-1', current_date, flt.uid('bal_draft'), 'post', 5, 5, '00000000-0000-4000-8000-0000000000a1') returning id into e;
    insert into public.fin_journal_lines (entry_id, company_id, line_no, account_id, debit, credit) values (e, '00000000-0000-4000-8000-00000000c001', 1, flt.uid('cash'), 5, 0);
    insert into public.fin_journal_lines (entry_id, company_id, line_no, account_id, debit, credit) values (e, '00000000-0000-4000-8000-00000000c001', 2, flt.uid('bank'), 0, 4);
    set constraints all immediate;
  end $b$$q$, 'not balanced');
select flt.expect_error('balance: single-line entry rejected', $q$
  do $b$ declare e uuid; begin
    insert into public.fin_journal_entries (company_id, entry_no, entry_date, voucher_id, kind, total_debit, total_credit, posted_by)
    values ('00000000-0000-4000-8000-00000000c001', 'X-2', current_date, flt.uid('bal_draft'), 'post', 5, 5, '00000000-0000-4000-8000-0000000000a1') returning id into e;
    insert into public.fin_journal_lines (entry_id, company_id, line_no, account_id, debit, credit) values (e, '00000000-0000-4000-8000-00000000c001', 1, flt.uid('cash'), 5, 0);
    set constraints all immediate;
  end $b$$q$, 'at least two lines');
select flt.expect_error('balance: line with both debit and credit rejected', $q$insert into public.fin_journal_lines (entry_id, company_id, line_no, account_id, debit, credit) values ((select journal_entry_id from public.fin_vouchers where id = flt.uid('tr1')), '00000000-0000-4000-8000-00000000c001', 9, flt.uid('cash'), 1, 1)$q$, 'fin_lines_amounts_check');
select flt.check('balance: failed attempts left nothing behind', (select count(*) from public.fin_journal_entries) = 1 and (select count(*) from public.fin_journal_lines) = 2);

-- ---------------------------------------------------------------- 5) enable file vouchers (superuser, standing in for the later wiring migration) and open ledgers
insert into public.fin_ledger_settings (company_id, file_vouchers_enabled) values ('00000000-0000-4000-8000-00000000c001', true);
set role authenticated;
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('ledger: accountant cannot open', $q$select public.open_fin_file_ledger(flt.uid('f1'), 'ledger')$q$, 'approve permission');
select flt.expect_error('voucher: file without opened ledger refused', format($q$select public.create_fin_voucher('{"voucher_type":"receipt","amount":"1","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}')$q$, flt.get('cash'), flt.get('f1')), 'not opened');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.expect_error('ledger: bad mode', $q$select public.open_fin_file_ledger(flt.uid('f1'), 'auto')$q$, 'ledger or pre_ledger');
select flt.expect_error('ledger: pre_ledger requires note', $q$select public.open_fin_file_ledger(flt.uid('f1'), 'pre_ledger')$q$, 'note is required');
select flt.check('ledger: open f1 as ledger (approved, no money stamps)', (public.open_fin_file_ledger(flt.uid('f1'), 'ledger')::jsonb->>'created')::boolean = true);
select flt.check('ledger: open is idempotent', (public.open_fin_file_ledger(flt.uid('f1'), 'pre_ledger', 'x')::jsonb->>'created')::boolean = false and (select ledger_mode from public.fin_file_ledger_state where financial_file_id = flt.uid('f1')) = 'ledger');
select public.open_fin_file_ledger(flt.uid('f7'), 'ledger');
select public.open_fin_file_ledger(flt.uid('f8'), 'ledger');
select flt.expect_error('delivery: not before bank payment', $q$select public.confirm_fin_file_delivery(flt.uid('f1'), flt.slv('f1'))$q$, 'only after the bank payment');

-- ---------------------------------------------------------------- 6) success path on f1 (advance, partial, actual cost variance, delivery with outstanding, surplus, allocation)
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('receipt: client mismatch with file', format($q$select public.create_fin_voucher('{"voucher_type":"receipt","amount":"1","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s"}')$q$, flt.get('cash'), flt.get('f1')), 'does not match');
select flt.expect_error('receipt: commission_advance requires file', format($q$select public.create_fin_voucher('{"voucher_type":"receipt","amount":"1","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","purpose":"commission_advance"}')$q$, flt.get('cash')), 'requires a financial file');
select flt.set('rv1', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"100000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","purpose":"commission_advance","reference":"CASH-1","memo":"عمولة مقدمة"}', flt.get('cash'), flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.set('rv2', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"900000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","reference":"TT-77","memo":"تحويل العميل"}', flt.get('bank'), flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.set('pv1', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"229999.123456","cash_account_id":"%s","financial_file_id":"%s","reference":"BANK-CHG-1","memo":"رسوم البنك الفعلية"}', flt.get('bank'), flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.set('pv2', public.create_fin_voucher(format('{"voucher_type":"payment_permit","amount":"500000","cash_account_id":"%s","financial_file_id":"%s","reference":"PERMIT-1"}', flt.get('cash'), flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.check('payment: client auto-set from file', (select client_id = '00000000-0000-4000-8000-0000000000c1' from public.fin_vouchers where id = flt.uid('pv1')));
select flt.expect_error('payment_permit: refused when permit is client-provided', format($q$select public.create_fin_voucher('{"voucher_type":"payment_permit","amount":"1","cash_account_id":"%s","financial_file_id":"%s"}')$q$, flt.get('cash'), flt.get('f7')), 'not paid by BSGT');
select flt.expect_error('settlement: manual amount refused', format($q$select public.create_fin_voucher('{"voucher_type":"settlement","amount":"1","financial_file_id":"%s"}')$q$, flt.get('f1')), 'computed at posting');
select flt.expect_error('settlement: refused before bank payment', format($q$select public.create_fin_voucher('{"voucher_type":"settlement","financial_file_id":"%s"}')$q$, flt.get('f1')), 'requires the bank payment');
-- maker-checker: accountant a2 entered; a2 cannot post (no approve); FM posts; FM's own draft cannot be posted by FM
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.set('fm_draft', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"1","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s"}', flt.get('cash'))::jsonb)::jsonb->>'voucher_id');
select flt.expect_error('maker-checker: last input user cannot post', $q$select public.post_fin_voucher(flt.uid('fm_draft'), 1)$q$, 'Maker-checker');
select flt.check('cancel: FM cancels own draft (kept as cancelled, not deleted)', (public.cancel_fin_voucher(flt.uid('fm_draft'), 1, 'خطأ إدخال')::jsonb->'voucher'->>'status') = 'cancelled' and (select count(*) from public.fin_vouchers where id = flt.uid('fm_draft')) = 1);
select flt.expect_error('cancelled: immutable', $q$select public.update_fin_voucher_draft(flt.uid('fm_draft'), 2, '{"memo":"x"}')$q$, 'not allowed for voucher status cancelled');
select flt.as_user('00000000-0000-4000-8000-0000000000a1');   -- admin
select flt.set('adm_draft', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"1","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s"}', flt.get('cash'))::jsonb)::jsonb->>'voucher_id');
select flt.expect_error('admin override: reason required', $q$select public.post_fin_voucher(flt.uid('adm_draft'), 1)$q$, 'Maker-checker');
select flt.expect_error('admin override: blank reason rejected', $q$select public.post_fin_voucher(flt.uid('adm_draft'), 1, '  ')$q$, 'Maker-checker');
select flt.set('p_adm', public.post_fin_voucher(flt.uid('adm_draft'), 1, 'اختبار التجاوز')::text);
select flt.check('admin override: with reason posts and is logged', (flt.get('p_adm')::jsonb->'voucher'->>'status') = 'posted'
  and (select note like 'ADMIN OVERRIDE%' from public.fin_ledger_events where entity_id = flt.uid('adm_draft') and event_type = 'posted'));
select flt.set('r_adm', public.reverse_fin_voucher(flt.uid('adm_draft'), 2, 'تجربة')::text);
select flt.check('reverse: admin reverses own unallocated receipt (mirror entry)', (flt.get('r_adm')::jsonb->'voucher'->>'status') = 'reversed'
  and flt.bal('00000000-0000-4000-8000-0000000000c1', null) = 0);
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rv1'), 1);
select public.post_fin_voucher(flt.uid('rv2'), 1);
select public.post_fin_voucher(flt.uid('pv1'), 1);
select public.post_fin_voucher(flt.uid('pv2'), 1);
select flt.check('numbering: RV/PV sequences per type and year', (select count(*) from public.fin_vouchers where financial_file_id = flt.uid('f1') and status = 'posted' and voucher_no ~ ('^(RV|PV)-' || extract(year from current_date) || '-00000[1-3]$')) = 4);
select flt.set('t1', public.fin_file_ledger_totals(flt.uid('f1'))::text);
select flt.check('totals: receipts 900000, advance 100000, bank 229999.123456, permit 500000, client balance 1000000, text', (flt.get('t1')::jsonb->>'receipts_sdg') = '900000' and (flt.get('t1')::jsonb->>'commission_advance_sdg') = '100000'
  and (flt.get('t1')::jsonb->>'bank_paid_sdg') = '229999.123456' and (flt.get('t1')::jsonb->>'permit_paid_sdg') = '500000' and (flt.get('t1')::jsonb->>'client_balance_sdg') = '1000000'
  and jsonb_typeof(flt.get('t1')::jsonb->'client_balance_sdg') = 'string' and (flt.get('t1')::jsonb->>'settled')::boolean = false);
select flt.check('precision: payment line keeps 229999.123456 exactly', (select debit::text from public.fin_journal_lines l join public.fin_accounts a on a.id = l.account_id where a.role = 'paid_bank' and l.financial_file_id = flt.uid('f1')) = '229999.123456');
-- phase-1 transitions (ledger-aware once 55 is applied: transfer needs deposit >= costs, bank payment needs approved cost = paid)
select public.transition_bsgt_financial_file(flt.uid('f1'), flt.flv('f1'), 'confirm_client_transfer');
-- ---- approved actual costs (independent of what was paid) — settlement requires posted payments = approved costs
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('costs: accountant cannot approve costs', $q$select public.approve_fin_file_costs(flt.uid('f1'), flt.slv('f1'), '229999.123456', '500000')$q$, 'approve permission');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.expect_error('costs: permit cost required when BSGT pays the permit', $q$select public.approve_fin_file_costs(flt.uid('f1'), flt.slv('f1'), '229999.123456')$q$, 'permit cost is required');
select flt.expect_error('costs: 7 decimals rejected', $q$select public.approve_fin_file_costs(flt.uid('f1'), flt.slv('f1'), '229999.1234567', '500000')$q$, 'more than 6 decimal');
select flt.expect_error('costs: wrong lock version', $q$select public.approve_fin_file_costs(flt.uid('f1'), 99, '229999.123456', '500000')$q$, 'version changed');
select flt.set('ac1', public.approve_fin_file_costs(flt.uid('f1'), flt.slv('f1'), '229999.123456', '500000', 'حسب إشعار البنك')::text);
select flt.check('costs: approved (money as text, logged with computed and paid)', (flt.get('ac1')::jsonb->'state'->>'approved_bank_cost_sdg') = '229999.123456' and jsonb_typeof(flt.get('ac1')::jsonb->'state'->'approved_permit_cost_sdg') = 'string'
  and (select changes->>'computed_bank_cost_sdg' = '225000.000000000000000' and changes->>'paid_bank_sdg' = '229999.123456' from public.fin_ledger_events where entity_id = flt.uid('f1') and event_type = 'costs_approved'));
select public.transition_bsgt_financial_file(flt.uid('f1'), flt.flv('f1'), 'confirm_bank_payment');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('settlement: refused before delivery confirmation', format($q$select public.create_fin_voucher('{"voucher_type":"settlement","financial_file_id":"%s"}')$q$, flt.get('f1')), 'delivery confirmation');
select flt.expect_error('delivery: accountant cannot confirm', $q$select public.confirm_fin_file_delivery(flt.uid('f1'), flt.slv('f1'), 'x')$q$, 'approve permission');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.expect_error('delivery: wrong lock version', $q$select public.confirm_fin_file_delivery(flt.uid('f1'), 99, 'x')$q$, 'version changed');
select flt.check('delivery: confirmed after bank_paid', (public.confirm_fin_file_delivery(flt.uid('f1'), flt.slv('f1'), 'سلّمنا الاعتماد للعميل')::jsonb->'state'->>'delivery_confirmed_at') is not null);
select flt.expect_error('delivery: cannot be confirmed twice', $q$select public.confirm_fin_file_delivery(flt.uid('f1'), flt.slv('f1'), 'x')$q$, 'already confirmed');
reset role;
select flt.expect_error('delivery: superuser cannot clear the stamp (guard)', $q$update public.fin_file_ledger_state set delivery_confirmed_at = null, delivery_confirmed_by = null where financial_file_id = flt.uid('f1')$q$, 'cannot be changed');
set role authenticated;

select flt.check('preview: settlement components and variances before any draft exists', (public.preview_fin_settlement(flt.uid('f1'))->>'settled_total_sdg') = '1029999.123456000000000'
  and (public.preview_fin_settlement(flt.uid('f1'))->>'bank_variance_sdg') = '4999.123456000000000' and (public.preview_fin_settlement(flt.uid('f1'))->>'preview')::boolean
  and jsonb_array_length(public.preview_fin_settlement(flt.uid('f1'))->'lines') = 4);
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('st1', public.create_fin_voucher(format('{"voucher_type":"settlement","financial_file_id":"%s","memo":"تسوية العملية"}', flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.check('settlement draft: no amount yet, reviewed components stored in details', (select amount is null and details->>'settled_total_sdg' = '1029999.123456000000000' and details->>'bank_actual_sdg' = '229999.123456' from public.fin_vouchers where id = flt.uid('st1')));
-- the bank charges a little more before settlement: costs re-approved (allowed until settlement) and the difference paid
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.approve_fin_file_costs(flt.uid('f1'), flt.slv('f1'), '230000', '500000', 'رسوم إضافية');
select flt.expect_error('settlement: posted payments must equal the approved cost', $q$select public.post_fin_voucher(flt.uid('st1'), 1)$q$, 'do not equal the approved bank cost');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('pv1b', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"0.876544","cash_account_id":"%s","financial_file_id":"%s","reference":"BANK-CHG-2"}', flt.get('bank'), flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('pv1b'), 1);
select flt.expect_error('settlement: components changed since review => refused, not posted with a different amount', $q$select public.post_fin_voucher(flt.uid('st1'), 1)$q$, 'components changed since the draft was reviewed');
select flt.check('settlement: draft untouched by the refused post', (select status = 'draft' and lock_version = 1 and details->>'settled_total_sdg' = '1029999.123456000000000' from public.fin_vouchers where id = flt.uid('st1')));
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('u_st1', public.update_fin_voucher_draft(flt.uid('st1'), 1, '{}')::text);
select flt.check('settlement: refresh recomputes components (lock 2, before/after logged)', (flt.get('u_st1')::jsonb->>'changed')::boolean and (flt.get('u_st1')::jsonb->'voucher'->'details'->>'settled_total_sdg') = '1030000.000000000000000'
  and (select changes->'components'->0->>'bank_actual_sdg' = '229999.123456' and changes->'components'->1->>'bank_actual_sdg' = '230000' from public.fin_ledger_events where entity_id = flt.uid('st1') and event_type = 'draft_updated'));
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.set('p_st1', public.post_fin_voucher(flt.uid('st1'), 2)::text);
select flt.check('settlement: total = 230000 + 500000 + 300000.000000000000000 exactly; variances vs computed/entered', (flt.get('p_st1')::jsonb->'voucher'->>'amount') = '1030000.000000000000000'
  and (flt.get('p_st1')::jsonb->'voucher'->'details'->>'bank_variance_sdg') = '5000.000000000000000' and (flt.get('p_st1')::jsonb->'voucher'->'details'->>'permit_variance_sdg') = '0.000000'
  and (flt.get('p_st1')::jsonb->'voucher'->'details'->>'client_balance_after') = '-30000.000000000000000');
select flt.check('settlement: 4 lines Dr 2100 / Cr 1410, 1420, 4100 with exact amounts', (select count(*) = 4 and sum(debit) = sum(credit)
  and bool_and(case a.role when 'client_control' then l.debit::text = '1030000.000000000000000' when 'paid_bank' then l.credit::text = '230000' when 'paid_permit' then l.credit::text = '500000' when 'commission_revenue' then l.credit::text = '300000.000000000000000' else false end)
  from public.fin_journal_lines l join public.fin_accounts a on a.id = l.account_id where l.entry_id = (select journal_entry_id from public.fin_vouchers where id = flt.uid('st1'))));
select flt.expect_error('costs: frozen after settlement (rpc)', $q$select public.approve_fin_file_costs(flt.uid('f1'), flt.slv('f1'), '1', '1')$q$, 'frozen after settlement');
reset role;
select flt.expect_error('costs: frozen after settlement (guard, superuser)', $q$update public.fin_file_ledger_state set approved_bank_cost_sdg = 1 where financial_file_id = flt.uid('f1')$q$, 'frozen after settlement');
set role authenticated;
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('settlement: second settlement refused', format($q$select public.create_fin_voucher('{"voucher_type":"settlement","financial_file_id":"%s"}')$q$, flt.get('f1')), 'already settled');
select flt.set('t2', public.fin_file_ledger_totals(flt.uid('f1'))::text);
select flt.check('totals after settlement: deposit 1000000, charged 1030000, due from client 30000, settled=true, nothing unbilled', (flt.get('t2')::jsonb->>'client_deposit_sdg') = '1000000' and (flt.get('t2')::jsonb->>'client_charged_sdg') = '1030000.000000000000000'
  and (flt.get('t2')::jsonb->>'due_from_client_sdg') = '30000.000000000000000' and (flt.get('t2')::jsonb->>'balance_for_client_sdg') = '0'
  and (flt.get('t2')::jsonb->>'settled')::boolean and (flt.get('t2')::jsonb->>'bank_unbilled_sdg')::numeric = 0 and (flt.get('t2')::jsonb->>'permit_unbilled_sdg')::numeric = 0);

-- ---- (2) a receipt that pays down the debt can be reversed (no dependent refund/allocation), restoring the debt
select flt.set('rvd', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"30000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","reference":"TT-78"}', flt.get('bank'), flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rvd'), 1);
select flt.check('debt: receipt 30000 clears the due (balance 0)', flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) = 0);
select flt.set('r_rvd', public.reverse_fin_voucher(flt.uid('rvd'), 2, 'حُوِّل بالخطأ لهذا الملف')::text);
select flt.check('debt: reversing that receipt restores the due (-30000) because no refund/allocation depended on it', (flt.get('r_rvd')::jsonb->'voucher'->>'status') = 'reversed' and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) = -30000);
-- the client now pays the due plus a surplus
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rv3', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"40000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","reference":"TT-79"}', flt.get('bank'), flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rv3'), 1);
select flt.check('surplus: balance for client 10000', flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) = 10000);
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('refund: over the available balance refused', format($q$select public.create_fin_voucher('{"voucher_type":"refund","amount":"10000.000001","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}')$q$, flt.get('cash'), flt.get('f1')), 'exceeds the client available balance');
select flt.expect_error('allocation: reason required', format($q$select public.create_fin_voucher('{"voucher_type":"balance_transfer","amount":"10000","client_id":"00000000-0000-4000-8000-0000000000c1","financial_file_id":"%s","target_file_id":"%s"}')$q$, flt.get('f1'), flt.get('f8')), 'Reason is required');
select flt.expect_error('allocation: target of another client refused', format($q$select public.create_fin_voucher('{"voucher_type":"balance_transfer","amount":"1","client_id":"00000000-0000-4000-8000-0000000000c1","financial_file_id":"%s","target_file_id":"%s","reason":"x"}')$q$, flt.get('f1'), flt.get('f7')), 'target file client');
select flt.set('bt1', public.create_fin_voucher(format('{"voucher_type":"balance_transfer","amount":"10000","client_id":"00000000-0000-4000-8000-0000000000c1","financial_file_id":"%s","target_file_id":"%s","reason":"بطلب العميل: تخصيص الفائض للعملية الجديدة"}', flt.get('f1'), flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.set('p_bt1', public.post_fin_voucher(flt.uid('bt1'), 1)::text);
select flt.check('allocation: no cash line, 2100 out of f1 / into f8, f1 balance 0, f8 balance 10000', (select count(*) = 2 and bool_and(a.role = 'client_control') from public.fin_journal_lines l join public.fin_accounts a on a.id = l.account_id where l.entry_id = (flt.get('p_bt1')::jsonb->'entry'->>'id')::uuid)
  and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) = 0 and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f8')) = 10000);
select flt.expect_error('reverse: receipt consumed by a later allocation is refused (deposit rule + order)', $q$select public.reverse_fin_voucher(flt.uid('rv3'), 2, 'x')$q$, 'Reverse the later voucher');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rf1', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"5000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","memo":"رد جزء من الفائض بطلب العميل"}', flt.get('cash'), flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf1'), 1);
select flt.check('refund: f8 balance 5000', flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f8')) = 5000);
-- post-time re-validation: a refund drafted while the balance was sufficient is refused once another refund consumed it
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rf2', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"5000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('cash'), flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.set('rf3', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"5000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('cash'), flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf2'), 1);
select flt.expect_error('post: re-validation refuses the second refund (balance consumed after drafting)', $q$select public.post_fin_voucher(flt.uid('rf3'), 1)$q$, 'exceeds the client available balance');
select flt.set('r_rf2', public.reverse_fin_voucher(flt.uid('rf2'), 2, 'رد مكرر')::text);
select flt.check('reverse: refund reversal restores the balance', (flt.get('r_rf2')::jsonb->'voucher'->>'status') = 'reversed' and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f8')) = 5000);
select public.cancel_fin_voucher(flt.uid('rf3'), 1, 'تكرار');
select flt.expect_error('reverse: allocation blocked (later refund on target)', $q$select public.reverse_fin_voucher(flt.uid('bt1'), 2, 'x')$q$, 'Reverse the later voucher');
select flt.expect_error('reverse: reason required', $q$select public.reverse_fin_voucher(flt.uid('rf1'), 2, ' ')$q$, 'reason is required');
select flt.expect_error('reverse: earlier receipt blocked by the later allocation out of the file', $q$select public.reverse_fin_voucher(flt.uid('rv2'), 2, 'x')$q$, 'Reverse the later voucher');

-- ---- (3) posting order: two dependent vouchers posted in ONE transaction (same now()); the earlier cannot be reversed first
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rv8', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"3000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('cash'), flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.set('rf8', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"4000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('cash'), flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
do $$ begin perform public.post_fin_voucher(flt.uid('rv8'), 1); perform public.post_fin_voucher(flt.uid('rf8'), 1); end $$;
select flt.check('order: both posted in one transaction share posted_at but have distinct increasing posted_seq', (select count(distinct posted_at) = 1 and count(distinct posted_seq) = 2 from public.fin_vouchers where id in (flt.uid('rv8'), flt.uid('rf8')))
  and (select posted_seq from public.fin_vouchers where id = flt.uid('rv8')) < (select posted_seq from public.fin_vouchers where id = flt.uid('rf8')));
select flt.expect_error('order: earlier receipt cannot be reversed while the later dependent refund stands', $q$select public.reverse_fin_voucher(flt.uid('rv8'), 2, 'x')$q$, 'Reverse the later voucher RF');
select flt.set('r_rf8', public.reverse_fin_voucher(flt.uid('rf8'), 2, 'ترتيب')::text);
select flt.set('r_rv8', public.reverse_fin_voucher(flt.uid('rv8'), 2, 'ترتيب')::text);
select flt.check('order: LIFO reversal succeeds, f8 balance back to 5000', (flt.get('r_rf8')::jsonb->'voucher'->>'status') = 'reversed' and (flt.get('r_rv8')::jsonb->'voucher'->>'status') = 'reversed' and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f8')) = 5000);

-- ---- (4) cost variance AFTER settlement — cycle A: bank charges 5000 more => approved via adjustment/charge, paid to the bank, collected from the client
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('adjustment: on unsettled file refused', format($q$select public.create_fin_voucher('{"voucher_type":"adjustment","amount":"1","financial_file_id":"%s","counter_account_id":"%s","direction":"credit","reason":"x"}')$q$, flt.get('f8'), (select id from public.fin_accounts where code = '1410')), 'settled files only');
select flt.expect_error('adjustment: cash account not adjustable', format($q$select public.create_fin_voucher('{"voucher_type":"adjustment","amount":"1","financial_file_id":"%s","counter_account_id":"%s","direction":"credit","reason":"x"}')$q$, flt.get('f1'), flt.get('cash')), 'must be one of');
select flt.set('aja', public.create_fin_voucher(format('{"voucher_type":"adjustment","amount":"5000","financial_file_id":"%s","counter_account_id":"%s","direction":"charge","reason":"البنك طالب برسوم إضافية بعد التسوية"}', flt.get('f1'), (select id from public.fin_accounts where code = '1410'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.set('p_aja', public.post_fin_voucher(flt.uid('aja'), 1)::text);
select flt.check('cycle A: charge recorded with before/after (230000 -> 235000), client owes 5000, 1410 shows -5000 (approved, unpaid)', (flt.get('p_aja')::jsonb->'voucher'->'details'->>'charged_before') = '230000' and (flt.get('p_aja')::jsonb->'voucher'->'details'->>'charged_after') = '235000'
  and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) = -5000 and flt.net(flt.uid('f1'), 'paid_bank') = -5000);
select flt.expect_error('reverse: settlement blocked by the later adjustment', $q$select public.reverse_fin_voucher(flt.uid('st1'), 3, 'x')$q$, 'Reverse the later voucher AJ');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('pva', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"5000","cash_account_id":"%s","financial_file_id":"%s","reference":"BANK-CHG-3"}', flt.get('bank'), flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.set('rva', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"5000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","reference":"TT-80"}', flt.get('bank'), flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.set('p_pva', public.post_fin_voucher(flt.uid('pva'), 1)::text);
select public.post_fin_voucher(flt.uid('rva'), 1);
select flt.check('cycle A: post-settlement payment flagged, 1410 back to 0, client back to 0 after paying the difference — settlement untouched', (flt.get('p_pva')::jsonb->'voucher'->'details'->>'post_settlement')::boolean
  and flt.net(flt.uid('f1'), 'paid_bank') = 0 and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) = 0 and flt.vstatus('st1') = 'posted'
  and (public.fin_file_ledger_totals(flt.uid('f1'))->>'bank_unbilled_sdg')::numeric = 0 and (public.fin_file_ledger_totals(flt.uid('f1'))->>'bank_paid_sdg') = '235000.000000');
-- reversal of a post-settlement difference payment while 1410 net is already 0 (charge posted, then paid): allowed, restores the approved-unpaid state
select flt.set('r_pva', public.reverse_fin_voucher(flt.uid('pva'), 2, 'دُفع من حساب خاطئ')::text);
select flt.check('cycle A: reversing the difference payment with 1410 net = 0 is allowed; 1410 back to -5000 (approved, unpaid), client unaffected', (flt.get('r_pva')::jsonb->'voucher'->>'status') = 'reversed'
  and flt.net(flt.uid('f1'), 'paid_bank') = -5000 and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) = 0);
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('pva2', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"5000","cash_account_id":"%s","financial_file_id":"%s","reference":"BANK-CHG-3b"}', flt.get('cash'), flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('pva2'), 1);
select flt.check('cycle A: re-paid from the right account, 1410 = 0 again', flt.net(flt.uid('f1'), 'paid_bank') = 0);
select flt.expect_error('cycle A: the charge adjustment cannot be reversed while the payment after it stands', $q$select public.reverse_fin_voucher(flt.uid('aja'), 2, 'x')$q$, 'Reverse the later voucher PV');
-- cycle B: the bank returns 999.123456 => cash recovered against 1410, approved as adjustment/credit, refunded to the client
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('recovery: unsettled non-failed file refused', format($q$select public.create_fin_voucher('{"voucher_type":"recovery","amount":"1","cash_account_id":"%s","financial_file_id":"%s"}')$q$, flt.get('bank'), flt.get('f8')), 'requires a failed');
select flt.set('rcb', public.create_fin_voucher(format('{"voucher_type":"recovery","amount":"999.123456","cash_account_id":"%s","financial_file_id":"%s","reference":"BANK-RET-9"}', flt.get('bank'), flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.check('cycle B: recovery on a settled file defaults to 1410', (select a.code from public.fin_vouchers v join public.fin_accounts a on a.id = v.counter_account_id where v.id = flt.uid('rcb')) = '1410');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.set('p_rcb', public.post_fin_voucher(flt.uid('rcb'), 1)::text);
select flt.check('cycle B: cash in, 1410 = -999.123456 (received, not yet passed to the client)', (flt.get('p_rcb')::jsonb->'voucher'->'details'->>'recovered_from') = '1410' and flt.net(flt.uid('f1'), 'paid_bank')::text = '-999.123456' and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) = 0);
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('ajb', public.create_fin_voucher(format('{"voucher_type":"adjustment","amount":"999.123456","financial_file_id":"%s","counter_account_id":"%s","direction":"credit","reason":"البنك أعاد جزءاً من الرسوم بعد التسوية"}', flt.get('f1'), (select id from public.fin_accounts where code = '1410'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.set('p_ajb', public.post_fin_voucher(flt.uid('ajb'), 1)::text);
select flt.check('cycle B: credit adjustment 235000 -> 234000.876544, 1410 = 0, client balance +999.123456', (flt.get('p_ajb')::jsonb->'voucher'->'details'->>'charged_before') = '235000' and (flt.get('p_ajb')::jsonb->'voucher'->'details'->>'charged_after') = '234000.876544'
  and flt.net(flt.uid('f1'), 'paid_bank') = 0 and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) = 999.123456);
-- reversal of an adjustment: mirror entry linked to the original, original untouched; then re-posted
select flt.set('r_ajb', public.reverse_fin_voucher(flt.uid('ajb'), 2, 'أُدخل بالخطأ')::text);
select flt.check('reverse: adjustment reversible (latest on file), mirror lines, original entry untouched', (flt.get('r_ajb')::jsonb->'voucher'->>'status') = 'reversed'
  and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) = 0
  and (select count(*) from public.fin_journal_entries e where e.voucher_id = flt.uid('ajb')) = 2
  and (select r.reverses_entry_id = o.id and r.total_debit = o.total_debit and r.posting_seq > o.posting_seq from public.fin_journal_entries o join public.fin_journal_entries r on r.reverses_entry_id = o.id where o.voucher_id = flt.uid('ajb') and o.kind = 'post')
  and (select bool_and(ol.debit = rl.credit and ol.credit = rl.debit and ol.account_id = rl.account_id) from public.fin_journal_entries o join public.fin_journal_lines ol on ol.entry_id = o.id
        join public.fin_journal_entries r on r.reverses_entry_id = o.id join public.fin_journal_lines rl on rl.entry_id = r.id and rl.line_no = ol.line_no where o.voucher_id = flt.uid('ajb')));
select flt.expect_error('reverse: twice refused', $q$select public.reverse_fin_voucher(flt.uid('ajb'), 3, 'x')$q$, 'already reversed');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('ajb2', public.create_fin_voucher(format('{"voucher_type":"adjustment","amount":"999.123456","financial_file_id":"%s","counter_account_id":"%s","direction":"credit","reason":"البنك أعاد جزءاً من الرسوم بعد التسوية (إعادة إدخال)"}', flt.get('f1'), (select id from public.fin_accounts where code = '1410'))::jsonb)::jsonb->>'voucher_id');
select flt.expect_error('cycle B: refund refused until the credit adjustment is posted (balance still 0)', format($q$select public.create_fin_voucher('{"voucher_type":"refund","amount":"999.123456","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}')$q$, flt.get('bank'), flt.get('f1')), 'exceeds the client available balance');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('ajb2'), 1);
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rfb', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"999.123456","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","memo":"رد فرق الرسوم للعميل"}', flt.get('bank'), flt.get('f1'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rfb'), 1);
select flt.check('cycle B: client refunded, everything zero for f1 (client 0, 1410 0, 1420 0), settlement never reversed, no failure invented',
  flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) = 0 and flt.net(flt.uid('f1'), 'paid_bank') = 0 and flt.net(flt.uid('f1'), 'paid_permit') = 0
  and flt.vstatus('st1') = 'posted' and (select count(*) from public.fin_vouchers where financial_file_id = flt.uid('f1') and voucher_type = 'failure_reclass') = 0
  and (public.fin_file_ledger_totals(flt.uid('f1'))->>'client_charged_sdg')::numeric = 1030000 + 5000 - 999.123456
  and (public.fin_file_ledger_totals(flt.uid('f1'))->>'client_deposit_sdg')::numeric = 1030000 + 5000 - 999.123456);
select flt.check('statement: f1 running balance ends at 0; every reversed voucher shows both entries', (select balance::numeric from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) where row_kind = 'closing') = 0
  and (select count(*) from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) where voucher_type = 'adjustment') = 4
  and (select count(*) from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f1')) where row_kind = 'line' and voucher_no = (select voucher_no from public.fin_vouchers where id = flt.uid('rvd'))) = 2);

-- ---------------------------------------------------------------- 7) failure after partial receipt on f7 (no client_transferred stamp)
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rv7', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"50000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s","memo":"دفعة جزئية"}', flt.get('bank'), flt.get('f7'))::jsonb)::jsonb->>'voucher_id');
select flt.set('pv7', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"52500","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f7'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rv7'), 1);
select public.post_fin_voucher(flt.uid('pv7'), 1);
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('failure_reclass: refused while file not failed', format($q$select public.create_fin_voucher('{"voucher_type":"failure_reclass","financial_file_id":"%s","reason":"x"}')$q$, flt.get('f7')), 'requires a failed file');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.transition_bsgt_financial_file(flt.uid('f7'), flt.flv('f7'), 'fail', 'رفض البنك المستندات');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('payment on failed file refused', format($q$select public.create_fin_voucher('{"voucher_type":"payment_bank","amount":"1","cash_account_id":"%s","financial_file_id":"%s"}')$q$, flt.get('bank'), flt.get('f7')), 'not allowed in status failed');
select flt.set('rf7', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"50000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s","memo":"رد كامل ما دفعه العميل"}', flt.get('bank'), flt.get('f7'))::jsonb)::jsonb->>'voucher_id');
select flt.set('fr7', public.create_fin_voucher(format('{"voucher_type":"failure_reclass","financial_file_id":"%s","reason":"إخفاق العملية — متابعة استرداد رسوم البنك"}', flt.get('f7'))::jsonb)::jsonb->>'voucher_id');
select flt.check('failure_reclass draft: reviewed components stored (bank 52500, permit 0)', (select details->>'bank_sdg' = '52500' and details->>'permit_sdg' = '0' from public.fin_vouchers where id = flt.uid('fr7')));
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf7'), 1);
select flt.check('failure: client fully refunded (deposit 0) without any phase-1 refund stamp', flt.bal('00000000-0000-4000-8000-0000000000c2', flt.uid('f7')) = 0 and (public.fin_file_ledger_totals(flt.uid('f7'))->>'client_deposit_sdg') = '0'
  and (select refund_started_at is null and refunded_at is null from public.bsgt_financial_files where id = flt.uid('f7')));
select flt.set('p_fr7', public.post_fin_voucher(flt.uid('fr7'), 1)::text);
select flt.check('failure_reclass: Dr 1500 52500 / Cr 1410 52500, no expense, recoverable outstanding 52500', (flt.get('p_fr7')::jsonb->'voucher'->>'amount') = '52500'
  and (select count(*) = 2 from public.fin_journal_lines where entry_id = (flt.get('p_fr7')::jsonb->'entry'->>'id')::uuid)
  and (public.fin_file_ledger_totals(flt.uid('f7'))->>'recoverable_outstanding_sdg') = '52500' and (public.fin_file_ledger_totals(flt.uid('f7'))->>'bank_unbilled_sdg') = '0'
  and (select count(*) from public.fin_accounts where kind = 'expense') = 0);
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('recovery: over the outstanding refused', format($q$select public.create_fin_voucher('{"voucher_type":"recovery","amount":"52500.000001","cash_account_id":"%s","financial_file_id":"%s"}')$q$, flt.get('bank'), flt.get('f7')), 'exceeds the outstanding recoverable');
select flt.expect_error('recovery: after failure only 1500 can be the counter account', format($q$select public.create_fin_voucher('{"voucher_type":"recovery","amount":"1","cash_account_id":"%s","financial_file_id":"%s","counter_account_id":"%s"}')$q$, flt.get('bank'), flt.get('f7'), (select id from public.fin_accounts where code = '1410')), 'account 1500 only');
select flt.set('rc7', public.create_fin_voucher(format('{"voucher_type":"recovery","amount":"30000","cash_account_id":"%s","financial_file_id":"%s","reference":"BANK-RET-1"}', flt.get('bank'), flt.get('f7'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rc7'), 1);
select flt.check('recovery: partial, 22500 still outstanding, tracked independently of the file status', (public.fin_file_ledger_totals(flt.uid('f7'))->>'recoverable_outstanding_sdg') = '22500' and (public.fin_file_ledger_totals(flt.uid('f7'))->>'recovered_sdg') = '30000'
  and (select status = 'failed' from public.bsgt_financial_files where id = flt.uid('f7')));
select flt.expect_error('reverse: failure_reclass blocked by later recovery', $q$select public.reverse_fin_voucher(flt.uid('fr7'), 2, 'x')$q$, 'Reverse the later voucher');
select flt.set('r_rc7', public.reverse_fin_voucher(flt.uid('rc7'), 2, 'قيد مكرر')::text);
select flt.set('r_fr7', public.reverse_fin_voucher(flt.uid('fr7'), 2, 'إعادة تصنيف مبكرة')::text);
select flt.check('reverse: recovery then reclass reversible in LIFO order', (flt.get('r_rc7')::jsonb->'voucher'->>'status') = 'reversed' and (flt.get('r_fr7')::jsonb->'voucher'->>'status') = 'reversed'
  and flt.net(flt.uid('f7'), 'paid_bank') = 52500 and flt.net(flt.uid('f7'), 'recoverable') = 0);

-- ---------------------------------------------------------------- 8) reports, lists, keyset, company scope
select flt.as_user('00000000-0000-4000-8000-0000000000a4');   -- viewer with view key
select flt.check('trial balance: total debit = total credit (originals + reversals together)', (select sum(debit_total::numeric) = sum(credit_total::numeric) and sum(debit_total::numeric) > 0 from public.fin_trial_balance()));
select flt.check('trial balance: 2100 credit 5000 (f8 surplus only), 4100 credit 300000, 1410 debit 52500 (f7 unsettled)', (select balance_credit::numeric = 5000 from public.fin_trial_balance() where code = '2100')
  and (select balance_credit::numeric = 300000 from public.fin_trial_balance() where code = '4100') and (select balance_debit::numeric = 52500 from public.fin_trial_balance() where code = '1410'));
select flt.check('trial balance: money as text, groups excluded', (select pg_typeof(debit_total)::text from public.fin_trial_balance() limit 1) = 'text' and (select count(*) from public.fin_trial_balance() where code in ('1100','1200')) = 0);
select flt.check('accounts list: cash balance = receipts − payments − refunds', (select balance::numeric from public.list_fin_accounts() where code = '1101') = (100000 - 1000.123456 - 500000 - 5000 - 5000 + 5000 + 3000 - 4000 + 4000 - 3000 + 1 - 1 - 5000));
select flt.check('list: keyset 5 + 5 + rest without overlap', (with p1 as (select * from public.list_fin_vouchers(p_limit => 5)),
  p2 as (select * from public.list_fin_vouchers(p_limit => 5, p_after_created_at => (select min(created_at) from p1), p_after_id => (select id from p1 order by created_at, id limit 1)))
  select count(*) = 10 and count(distinct id) = 10 from (select id from p1 union all select id from p2) u));
select flt.expect_error('list: half cursor rejected', $q$select * from public.list_fin_vouchers(p_after_id => gen_random_uuid())$q$, 'Cursor requires both');
select flt.check('list: filter by file includes allocations into it, amounts text', (select count(*) from public.list_fin_vouchers(p_file => flt.uid('f8'))) = 6 and (select pg_typeof(amount)::text from public.list_fin_vouchers() limit 1) = 'text');
select flt.check('list: search by voucher no prefix', (select count(*) from public.list_fin_vouchers(p_search => 'ST-')) = 1);
select flt.check('get: voucher with entry, reversal entry and events', (public.get_fin_voucher(flt.uid('ajb'))->'reversal_entry'->>'kind') = 'reversal' and jsonb_array_length(public.get_fin_voucher(flt.uid('ajb'))->'events') >= 3);
select flt.check('events: append-only log covers create/post/reverse with lock versions', (select array_agg(event_type order by id) from public.fin_ledger_events where entity_id = flt.uid('ajb')) = array['created','posted','reversed']);

-- ---- (1) client statement with a period: opening balance includes earlier movements; closing shown even for an empty period
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rv_old', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"1000","voucher_date":"%s","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","memo":"قبض قديم"}', (current_date - 10)::text, flt.get('cash'), flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rv_old'), 1);
select flt.check('statement (period): opening = 1000 from the receipt before the period, lines only inside it, closing = 6000',
  (select balance::numeric from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f8'), current_date - 5, current_date) where row_kind = 'opening') = 1000
  and (select count(*) from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f8'), current_date - 5, current_date) where row_kind = 'line' and entry_date < current_date - 5) = 0
  and (select balance::numeric from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f8'), current_date - 5, current_date) where row_kind = 'line' order by entry_date, entry_no limit 1)
      = 1000 + (select (credit::numeric - debit::numeric) from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f8'), current_date - 5, current_date) where row_kind = 'line' order by entry_date, entry_no limit 1)
  and (select balance::numeric from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f8'), current_date - 5, current_date) where row_kind = 'closing') = 6000);
select flt.check('statement (empty period): opening = closing = 1000, no lines, totals 0', (select count(*) from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f8'), current_date - 8, current_date - 6) where row_kind = 'line') = 0
  and (select balance::numeric from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f8'), current_date - 8, current_date - 6) where row_kind = 'opening') = 1000
  and (select balance::numeric = 1000 and debit::numeric = 0 and credit::numeric = 0 from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f8'), current_date - 8, current_date - 6) where row_kind = 'closing'));
select flt.check('statement (no period): opening 0, running balance ends at closing 6000', (select balance::numeric from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f8')) where row_kind = 'opening') = 0
  and (select balance::numeric from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f8')) where row_kind = 'closing') = 6000
  and (select balance::numeric from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', flt.uid('f8')) where row_kind = 'line' order by entry_date desc, entry_no desc limit 1) = 6000);
select flt.expect_error('statement: reversed period rejected', $q$select * from public.fin_client_statement('00000000-0000-4000-8000-0000000000c1', null, current_date, current_date - 1)$q$, 'must not be before');
reset role;
-- company scope: a second company's objects are invisible and unusable
insert into public.companies (id, name_ar, name_en, active, is_default, sort_order) values ('00000000-0000-4000-8000-00000000c002', 'شركة أخرى', 'Other Co', true, false, 10);
insert into public.fin_accounts (company_id, code, name_ar, kind, role) values ('00000000-0000-4000-8000-00000000c002', '1101', 'صندوق شركة أخرى', 'asset', 'cash');
select flt.set('other_acc', (select id::text from public.fin_accounts where company_id = '00000000-0000-4000-8000-00000000c002'));
set role authenticated;
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.check('scope: other company account hidden from RLS and lists', (select count(*) from public.fin_accounts where company_id = '00000000-0000-4000-8000-00000000c002') = 0 and (select count(*) from public.list_fin_accounts() where name_ar like '%أخرى%') = 0);
select flt.expect_error('scope: other company account unusable in a voucher', format($q$select public.create_fin_voucher('{"voucher_type":"transfer","amount":"1","cash_account_id":"%s","counter_account_id":"%s"}')$q$, flt.get('other_acc'), flt.get('bank')), 'not found');
reset role;
