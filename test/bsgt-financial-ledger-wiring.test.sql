-- BSGT Financial Center phase 2b (migration 55: ledger-aware transitions) — SQL test suite.
-- Runs after test/bsgt-financial-ledger.test.sql in the same throwaway database (flt schema and fixtures reused).
\set ON_ERROR_STOP on
\set QUIET on

-- ---------------------------------------------------------------- 1) objects
select flt.check('55 objects: refund columns + rpcs', (select count(*) from information_schema.columns where table_name = 'fin_file_ledger_state' and column_name in ('refund_due_sdg','refund_due_at','refund_due_seq','refund_allocated_sdg','refund_allocation_approved_at','refund_allocation_approved_by','refund_allocation_reason')) = 7
  and has_function_privilege('authenticated', 'public.enable_fin_file_vouchers()', 'execute') and has_function_privilege('authenticated', 'public.approve_fin_refund_allocation(uuid,bigint,text)', 'execute')
  and has_function_privilege('authenticated', 'public.fin_file_refund_status(uuid)', 'execute') and not has_function_privilege('anon', 'public.enable_fin_file_vouchers()', 'execute')
  and not has_function_privilege('authenticated', 'public.fin_refunds_after(uuid,bigint)', 'execute'));
select flt.check('55 objects: transition function still authenticated-only', has_function_privilege('authenticated', 'public.transition_bsgt_financial_file(uuid,bigint,text,text,text)', 'execute') and not has_function_privilege('anon', 'public.transition_bsgt_financial_file(uuid,bigint,text,text,text)', 'execute'));

-- fixtures for this suite (superuser): f9 = ledger failure path (client TWO), f10 = no ledger at all (phase-1 behaviour)
insert into public.shipments (id, owner_id, status, company_id, bsgt_stage, data) values
  ('00000000-0000-4000-8000-0000000000eb', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0011","consignee":"TEST BUYER TWO","invoiceNo":"INV-11","currency":"USD","totalAmount":"USD 200.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000ec', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0012","consignee":"TEST BUYER TWO","invoiceNo":"INV-12","currency":"USD","totalAmount":"USD 300.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000ed', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0013","consignee":"TEST BUYER TWO","invoiceNo":"INV-13","currency":"USD","totalAmount":"USD 100.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000ee', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0014","consignee":"TEST BUYER ONE","invoiceNo":"INV-14","currency":"USD","totalAmount":"USD 200.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000ef', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0015","consignee":"TEST BUYER TWO","invoiceNo":"INV-15","currency":"USD","totalAmount":"USD 300.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000f0', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0016","consignee":"TEST BUYER ONE","invoiceNo":"INV-16","currency":"USD","totalAmount":"USD 300.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0017","consignee":"TEST BUYER TWO","invoiceNo":"INV-17","currency":"USD","totalAmount":"USD 100.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0018","consignee":"TEST BUYER ONE","invoiceNo":"INV-18","currency":"USD","totalAmount":"USD 200.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0019","consignee":"TEST BUYER ONE","invoiceNo":"INV-19","currency":"USD","totalAmount":"USD 200.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0020","consignee":"TEST BUYER ONE","invoiceNo":"INV-20","currency":"USD","totalAmount":"USD 200.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0021","consignee":"TEST BUYER ONE","invoiceNo":"INV-21","currency":"USD","totalAmount":"USD 200.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0022","consignee":"TEST BUYER TWO","invoiceNo":"INV-22","currency":"USD","totalAmount":"USD 200.00","paymentTerm":"D/A 30 DAYS"}'),
  ('00000000-0000-4000-8000-0000000000f7', '00000000-0000-4000-8000-0000000000a1', 'sent', '00000000-0000-4000-8000-00000000c001', 'ready_for_finance',
   '{"operationNo":"BSGTX-T-0023","consignee":"TEST BUYER TWO","invoiceNo":"INV-23","currency":"USD","totalAmount":"USD 200.00","paymentTerm":"D/A 30 DAYS"}');
insert into public.trade_collection_files (id, company_id, status, created_by, metadata) values
  ('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000fa', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000fb', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000fc', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000fd', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000fe', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-0000000000ff', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}'),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-00000000c001', 'draft', '00000000-0000-4000-8000-0000000000a1', '{}');
insert into public.trade_collection_file_shipments (trade_file_id, shipment_id) values
  ('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000000eb'), ('00000000-0000-4000-8000-0000000000fa', '00000000-0000-4000-8000-0000000000ec'),
  ('00000000-0000-4000-8000-0000000000fb', '00000000-0000-4000-8000-0000000000ed'), ('00000000-0000-4000-8000-0000000000fc', '00000000-0000-4000-8000-0000000000ee'),
  ('00000000-0000-4000-8000-0000000000fd', '00000000-0000-4000-8000-0000000000ef'), ('00000000-0000-4000-8000-0000000000fe', '00000000-0000-4000-8000-0000000000f0'),
  ('00000000-0000-4000-8000-0000000000ff', '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-0000000000f2'), ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-0000000000f3'),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-0000000000f4'), ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-0000000000f5'),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-0000000000f6'), ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-0000000000f7');
update public.trade_collection_files set status = 'sent_to_collecting', sent_to_collecting_at = now() where id in ('00000000-0000-4000-8000-0000000000fc','00000000-0000-4000-8000-0000000000fe','00000000-0000-4000-8000-000000000104');
-- f8 TC must be at the collecting bank for 'complete'
update public.trade_collection_files set status = 'sent_to_collecting', sent_to_collecting_at = now() where id = '00000000-0000-4000-8000-0000000000f8';

set role authenticated;
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('enable: accountant cannot enable', $q$select public.enable_fin_file_vouchers()$q$, 'approve permission');
select flt.set('f9', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000f9')::jsonb->>'financial_file_id');
select flt.set('f10', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000fa')::jsonb->>'financial_file_id');
select flt.set('f11', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000fb')::jsonb->>'financial_file_id');
select public.update_bsgt_financial_draft(flt.uid('f11'), flt.flv('f11'), '{"bank_tariff_per_1000_sdg":"150000","bsgt_tariff_per_1000_sdg":"200000","import_permit_source":"client"}');
select flt.set('f12', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000fc')::jsonb->>'financial_file_id');
select flt.set('f13', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000fd')::jsonb->>'financial_file_id');
select flt.set('f14', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000fe')::jsonb->>'financial_file_id');
select flt.set('f15', public.create_bsgt_financial_file('00000000-0000-4000-8000-0000000000ff')::jsonb->>'financial_file_id');
select flt.set('f16', public.create_bsgt_financial_file('00000000-0000-4000-8000-000000000101')::jsonb->>'financial_file_id');
select flt.set('f17', public.create_bsgt_financial_file('00000000-0000-4000-8000-000000000102')::jsonb->>'financial_file_id');
select flt.set('f18', public.create_bsgt_financial_file('00000000-0000-4000-8000-000000000103')::jsonb->>'financial_file_id');
select flt.set('f19', public.create_bsgt_financial_file('00000000-0000-4000-8000-000000000104')::jsonb->>'financial_file_id');
select flt.set('f20', public.create_bsgt_financial_file('00000000-0000-4000-8000-000000000105')::jsonb->>'financial_file_id');
select flt.set('f21', public.create_bsgt_financial_file('00000000-0000-4000-8000-000000000106')::jsonb->>'financial_file_id');
select public.update_bsgt_financial_draft(flt.uid(k), flt.flv(k), '{"bank_tariff_per_1000_sdg":"150000","bsgt_tariff_per_1000_sdg":"200000","import_permit_source":"client"}') from unnest(array['f12','f13','f14','f15','f16','f17','f18','f19','f20','f21']) k;
select public.update_bsgt_financial_draft(flt.uid('f9'), flt.flv('f9'), '{"bank_tariff_per_1000_sdg":"150000","bsgt_tariff_per_1000_sdg":"200000","import_permit_source":"client"}');
select public.update_bsgt_financial_draft(flt.uid('f10'), flt.flv('f10'), '{"bank_tariff_per_1000_sdg":"150000","bsgt_tariff_per_1000_sdg":"200000","import_permit_source":"client"}');
do $$ declare r record; begin
  for r in select * from flt.invoices() where inv in ('INV-11','INV-12','INV-13','INV-14','INV-15','INV-16','INV-17','INV-18','INV-19','INV-20','INV-21','INV-22','INV-23') loop
    perform public.confirm_bsgt_financial_invoice(r.id, (select lock_version from public.bsgt_financial_files where id = r.financial_file_id), case r.inv when 'INV-11' then 200 when 'INV-12' then 300 when 'INV-14' then 200 when 'INV-15' then 300 when 'INV-16' then 300 when 'INV-13' then 100 when 'INV-17' then 100 else 200 end);
  end loop; end $$;
select public.confirm_bsgt_financial_client(flt.uid('f9'), flt.flv('f9'), '00000000-0000-4000-8000-0000000000c2');
select public.confirm_bsgt_financial_client(flt.uid('f10'), flt.flv('f10'), '00000000-0000-4000-8000-0000000000c2');
select public.confirm_bsgt_financial_client(flt.uid('f11'), flt.flv('f11'), '00000000-0000-4000-8000-0000000000c2');
select public.update_bsgt_financial_bank_details(flt.uid('f11'), flt.flv('f11'), '{"import_permit_no":"IP-2B-11"}');
select public.confirm_bsgt_financial_client(flt.uid('f12'), flt.flv('f12'), '00000000-0000-4000-8000-0000000000c1');
select public.confirm_bsgt_financial_client(flt.uid('f13'), flt.flv('f13'), '00000000-0000-4000-8000-0000000000c2');
select public.confirm_bsgt_financial_client(flt.uid('f14'), flt.flv('f14'), '00000000-0000-4000-8000-0000000000c1');
select public.confirm_bsgt_financial_client(flt.uid('f15'), flt.flv('f15'), '00000000-0000-4000-8000-0000000000c2');
select public.confirm_bsgt_financial_client(flt.uid(k), flt.flv(k), '00000000-0000-4000-8000-0000000000c1') from unnest(array['f16','f17','f18','f19']) k;
select public.confirm_bsgt_financial_client(flt.uid('f20'), flt.flv('f20'), '00000000-0000-4000-8000-0000000000c2');
select public.confirm_bsgt_financial_client(flt.uid('f21'), flt.flv('f21'), '00000000-0000-4000-8000-0000000000c2');
select public.update_bsgt_financial_bank_details(flt.uid(k), flt.flv(k), ('{"import_permit_no":"IP-2B-' || k || '","documents_value_aed":"800"}')::jsonb) from unnest(array['f16','f17','f18','f19','f20','f21']) k;
select public.update_bsgt_financial_bank_details(flt.uid('f12'), flt.flv('f12'), '{"import_permit_no":"IP-2B-12","documents_value_aed":"800"}');
select public.update_bsgt_financial_bank_details(flt.uid('f13'), flt.flv('f13'), '{"import_permit_no":"IP-2B-13"}');
select public.update_bsgt_financial_bank_details(flt.uid('f14'), flt.flv('f14'), '{"import_permit_no":"IP-2B-14","documents_value_aed":"1200"}');
select public.update_bsgt_financial_bank_details(flt.uid('f15'), flt.flv('f15'), '{"import_permit_no":"IP-2B-15"}');
select public.update_bsgt_financial_bank_details(flt.uid('f9'), flt.flv('f9'), '{"import_permit_no":"IP-2B-9","documents_value_aed":"700"}');
select public.update_bsgt_financial_bank_details(flt.uid('f10'), flt.flv('f10'), '{"import_permit_no":"IP-2B-10","documents_value_aed":"900"}');
select public.update_bsgt_financial_bank_details(flt.uid('f8'), flt.flv('f8'), '{"documents_value_aed":"1500"}');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.transition_bsgt_financial_file(flt.uid('f9'), flt.flv('f9'), 'approve');
select public.transition_bsgt_financial_file(flt.uid('f10'), flt.flv('f10'), 'approve');
select public.transition_bsgt_financial_file(flt.uid('f11'), flt.flv('f11'), 'approve');
select public.transition_bsgt_financial_file(flt.uid(k), flt.flv(k), 'approve') from unnest(array['f12','f13','f14','f15','f16','f17','f18','f19','f20','f21']) k;
select public.open_fin_file_ledger(flt.uid('f9'), 'ledger');
select flt.check('enable: idempotent for the finance manager (already on in this test db)', (public.enable_fin_file_vouchers()::jsonb->'settings'->>'file_vouchers_enabled')::boolean);

-- ---------------------------------------------------------------- 2) point 1: delivery with the commission still due — no full-receipt stamp required or invented (f8: bank 60000, commission 80000)
select flt.check('f8: costs 60000 / commission 80000 / total 140000; deposit 6000 so far', (select bank_cost_sdg = 60000 and bsgt_commission_sdg = 80000 and client_total_sdg = 140000 from public.bsgt_financial_files where id = flt.uid('f8'))
  and (public.fin_file_ledger_totals(flt.uid('f8'))->>'client_deposit_sdg')::numeric = 6000);
select flt.expect_error('transfer: refused while net deposit (6000) < bank+permit costs (60000)', $q$select public.transition_bsgt_financial_file(flt.uid('f8'), flt.flv('f8'), 'confirm_client_transfer')$q$, 'does not cover the bank and permit costs');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rv8c', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"54000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","memo":"تحويل تكاليف البنك فقط"}', flt.get('bank'), flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rv8c'), 1);
select flt.set('ct8', public.transition_bsgt_financial_file(flt.uid('f8'), flt.flv('f8'), 'confirm_client_transfer')::text);
select flt.check('transfer: confirmed with deposit 60000 = costs; commission 80000 still unpaid; note records the ledger check', (flt.get('ct8')::jsonb->'file'->>'status') = 'client_transferred'
  and (select note like '%ledger: deposit 60000 >= costs 60000%' from public.bsgt_financial_file_events where financial_file_id = flt.uid('f8') and event_type = 'client_transfer_confirmed'));
select flt.expect_error('bank payment: refused until the actual bank cost is approved', $q$select public.transition_bsgt_financial_file(flt.uid('f8'), flt.flv('f8'), 'confirm_bank_payment')$q$, 'Approve the actual bank cost first');
select public.approve_fin_file_costs(flt.uid('f8'), flt.slv('f8'), '60000');
select flt.expect_error('bank payment: a single voucher is not enough — posted sum (0) must equal approved (60000)', $q$select public.transition_bsgt_financial_file(flt.uid('f8'), flt.flv('f8'), 'confirm_bank_payment')$q$, 'do not equal the approved bank cost');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('pv8a', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"25000","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.set('pv8b', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"35000","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('pv8a'), 1);
select flt.expect_error('bank payment: partial (25000 of 60000) refused', $q$select public.transition_bsgt_financial_file(flt.uid('f8'), flt.flv('f8'), 'confirm_bank_payment')$q$, 'Posted bank payments \(25000\) do not equal');
select public.post_fin_voucher(flt.uid('pv8b'), 1);
select flt.set('bp8', public.transition_bsgt_financial_file(flt.uid('f8'), flt.flv('f8'), 'confirm_bank_payment')::text);
select flt.check('bank payment: confirmed once the posted sum equals the approved cost', (flt.get('bp8')::jsonb->'file'->>'status') = 'bank_paid');
select public.confirm_fin_file_delivery(flt.uid('f8'), flt.slv('f8'), 'سُلِّم الاعتماد للعميل');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('st8', public.create_fin_voucher(format('{"voucher_type":"settlement","financial_file_id":"%s"}', flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('st8'), 1);
select flt.check('delivery + settlement with commission outstanding: due from client 80000, no receipt stamp invented (client_transferred_at is the real transfer of costs)',
  (public.fin_file_ledger_totals(flt.uid('f8'))->>'due_from_client_sdg')::numeric = 80000 and (public.fin_file_ledger_totals(flt.uid('f8'))->>'settled')::boolean
  and (select client_transferred_at is not null and completed_at is null from public.bsgt_financial_files where id = flt.uid('f8')));
select flt.set('cp8', public.transition_bsgt_financial_file(flt.uid('f8'), flt.flv('f8'), 'complete')::text);
select flt.check('complete: still "sent to collecting bank" only; allowed with the commission due', (flt.get('cp8')::jsonb->'file'->>'status') = 'completed');
select flt.expect_error('close: refused while the client owes the commission', $q$select public.transition_bsgt_financial_file(flt.uid('f8'), flt.flv('f8'), 'close')$q$, 'Client still owes 80000');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rv8d', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"80000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","memo":"سداد العمولة بعد التسليم"}', flt.get('bank'), flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rv8d'), 1);
select flt.set('cl8', public.transition_bsgt_financial_file(flt.uid('f8'), flt.flv('f8'), 'close')::text);
select flt.check('close: allowed once the due is collected; file closed, ledger still usable afterwards', (flt.get('cl8')::jsonb->'file'->>'closed_at') is not null and (public.fin_file_ledger_totals(flt.uid('f8'))->>'due_from_client_sdg')::numeric = 0);
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rv8e', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"1","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","memo":"قبض بعد الإقفال"}', flt.get('cash'), flt.get('f8'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.check('closed file: receipts/refunds still possible through the ledger (file row untouched)', (public.post_fin_voucher(flt.uid('rv8e'), 1)::jsonb->'voucher'->>'status') = 'posted');

-- ---------------------------------------------------------------- 3) failure under the ledger (f9): refund due fixed at failure; cash refunds + approved allocation prove it; 1500 independent
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rv9', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"20000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f9'))::jsonb)::jsonb->>'voucher_id');
select flt.set('pv9', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"10000","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f9'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rv9'), 1);
select public.post_fin_voucher(flt.uid('pv9'), 1);
select flt.set('fl9', public.transition_bsgt_financial_file(flt.uid('f9'), flt.flv('f9'), 'fail', 'رفض البنك')::text);
select flt.check('fail: refund due fixed = net deposit 20000 (no client_transferred stamp)', (select refund_due_sdg = 20000 and refund_due_seq is not null from public.fin_file_ledger_state where financial_file_id = flt.uid('f9'))
  and (select client_transferred_at is null from public.bsgt_financial_files where id = flt.uid('f9')) and (flt.get('fl9')::jsonb->'file'->>'status') = 'failed');
reset role;
select flt.expect_error('fail: refund due cannot be changed afterwards (guard, superuser)', $q$update public.fin_file_ledger_state set refund_due_sdg = 1 where financial_file_id = flt.uid('f9')$q$, 'fixed at the moment of failure');
set role authenticated;
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.set('sr9', public.transition_bsgt_financial_file(flt.uid('f9'), flt.flv('f9'), 'start_refund')::text);
select flt.check('start_refund: allowed from the ledger refund due, without the phase-1 stamp', (flt.get('sr9')::jsonb->'file'->>'status') = 'refund_in_progress');
select flt.expect_error('confirm_refund: nothing refunded yet => refused (balance is not the proof)', $q$select public.transition_bsgt_financial_file(flt.uid('f9'), flt.flv('f9'), 'confirm_refund')$q$, 'do not equal the refund due \(20000\)');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.open_fin_file_ledger(flt.uid('f10'), 'ledger');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rf9', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"5000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f9'))::jsonb)::jsonb->>'voucher_id');
select flt.set('bt9', public.create_fin_voucher(format('{"voucher_type":"balance_transfer","amount":"15000","client_id":"00000000-0000-4000-8000-0000000000c2","financial_file_id":"%s","target_file_id":"%s","reason":"بطلب العميل: تحويل الباقي لعملية أخرى"}', flt.get('f9'), flt.get('f10'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf9'), 1);
select flt.expect_error('confirm_refund: partial cash refund (5000 of 20000) refused', $q$select public.transition_bsgt_financial_file(flt.uid('f9'), flt.flv('f9'), 'confirm_refund')$q$, 'Cash refunds posted after the failure \(5000\)');
select flt.expect_error('allocation approval: nothing allocated yet', $q$select public.approve_fin_refund_allocation(flt.uid('f9'), flt.slv('f9'), 'x')$q$, 'No posted allocation');
select public.post_fin_voucher(flt.uid('bt9'), 1);
select flt.check('allocation posted: client balance 0 but refund NOT confirmable — allocation is not a cash refund', flt.bal('00000000-0000-4000-8000-0000000000c2', flt.uid('f9')) = 0
  and (public.fin_file_refund_status(flt.uid('f9'))->>'refund_remaining_sdg')::numeric = 15000 and (public.fin_file_refund_status(flt.uid('f9'))->>'allocated_after_failure_sdg')::numeric = 15000);
select flt.expect_error('confirm_refund: zero balance alone does not prove the refund', $q$select public.transition_bsgt_financial_file(flt.uid('f9'), flt.flv('f9'), 'confirm_refund')$q$, 'plus approved allocations \(0\) do not equal');
select flt.expect_error('allocation approval: reason required', $q$select public.approve_fin_refund_allocation(flt.uid('f9'), flt.slv('f9'), ' ')$q$, 'Reason is required');
select flt.set('aa9', public.approve_fin_refund_allocation(flt.uid('f9'), flt.slv('f9'), 'العميل اختار التخصيص كتابةً')::text);
select flt.check('allocation approval: 15000 recorded as allocation (not refund), remaining 0', (flt.get('aa9')::jsonb->'refund'->>'refund_allocated_approved_sdg')::numeric = 15000 and (flt.get('aa9')::jsonb->'refund'->>'refund_remaining_sdg')::numeric = 0
  and (select event_type = 'refund_allocation_approved' from public.fin_ledger_events where entity_id = flt.uid('f9') and event_type = 'refund_allocation_approved'));
select flt.set('cr9', public.transition_bsgt_financial_file(flt.uid('f9'), flt.flv('f9'), 'confirm_refund')::text);
select flt.check('confirm_refund: cash 5000 + approved allocation 15000 = due 20000; note distinguishes both', (flt.get('cr9')::jsonb->'file'->>'status') = 'refunded'
  and (select note like '%cash 5000, allocated 15000%' from public.bsgt_financial_file_events where financial_file_id = flt.uid('f9') and event_type = 'refunded'));
-- bank side independent of the client refund
select flt.expect_error('close: refused while the 10000 paid to the bank is neither reclassified nor recovered', $q$select public.transition_bsgt_financial_file(flt.uid('f9'), flt.flv('f9'), 'close')$q$, 'not yet settled, reclassified or billed');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('fr9', public.create_fin_voucher(format('{"voucher_type":"failure_reclass","financial_file_id":"%s","reason":"متابعة استرداد رسوم البنك"}', flt.get('f9'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('fr9'), 1);
select flt.set('cl9', public.transition_bsgt_financial_file(flt.uid('f9'), flt.flv('f9'), 'close')::text);
select flt.check('close: allowed with 10000 still outstanding in 1500 (bank recovery tracked independently of the client refund)', (flt.get('cl9')::jsonb->'file'->>'closed_at') is not null
  and (public.fin_file_refund_status(flt.uid('f9'))->>'recoverable_outstanding_sdg')::numeric = 10000);
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rc9', public.create_fin_voucher(format('{"voucher_type":"recovery","amount":"10000","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f9'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.check('recovery after close: still possible; 1500 zero', (public.post_fin_voucher(flt.uid('rc9'), 1)::jsonb->'voucher'->>'status') = 'posted');
select flt.check('recovery after close: 1500 zero', (public.fin_file_refund_status(flt.uid('f9'))->>'recoverable_outstanding_sdg')::numeric = 0);

-- ---------------------------------------------------------------- 4) failed ledger file with no deposit: failed -> close directly, no refund states
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.transition_bsgt_financial_file(flt.uid('f10'), flt.flv('f10'), 'fail', 'إلغاء من العميل');
select flt.check('no-deposit failure: refund due = 15000? no — f10 holds the allocated 15000 as deposit', (select refund_due_sdg = 15000 from public.fin_file_ledger_state where financial_file_id = flt.uid('f10')));
select flt.expect_error('no-deposit failure: close refused while refund due > 0', $q$select public.transition_bsgt_financial_file(flt.uid('f10'), flt.flv('f10'), 'close')$q$, 'not allowed from status failed');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rf10', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"15000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f10'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf10'), 1);
select public.transition_bsgt_financial_file(flt.uid('f10'), flt.flv('f10'), 'start_refund');
select flt.check('allocated deposit refunded in cash on the new file and confirmed', (public.transition_bsgt_financial_file(flt.uid('f10'), flt.flv('f10'), 'confirm_refund')::jsonb->'file'->>'status') = 'refunded');

-- ---------------------------------------------------------------- 5) files without a ledger keep the phase-1 behaviour exactly
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.check('no ledger: transfer confirmed manually as in phase 1 (no deposit needed)', (public.transition_bsgt_financial_file(flt.uid('f11'), flt.flv('f11'), 'confirm_client_transfer')::jsonb->'file'->>'status') = 'client_transferred');
select flt.check('no ledger: fail then start_refund by the phase-1 stamp rule', (public.transition_bsgt_financial_file(flt.uid('f11'), flt.flv('f11'), 'fail', 'x')::jsonb->'file'->>'status') = 'failed');
select flt.check('no ledger: start_refund allowed by client_transferred stamp', (public.transition_bsgt_financial_file(flt.uid('f11'), flt.flv('f11'), 'start_refund')::jsonb->'file'->>'status') = 'refund_in_progress');
select flt.check('no ledger: confirm_refund manual as before', (public.transition_bsgt_financial_file(flt.uid('f11'), flt.flv('f11'), 'confirm_refund')::jsonb->'file'->>'status') = 'refunded');
select flt.check('no ledger: close as before', (public.transition_bsgt_financial_file(flt.uid('f11'), flt.flv('f11'), 'close')::jsonb->'file'->>'closed_at') is not null);
-- f7 (suite 54): failed under the ledger after a partial receipt of 50000 (refunded in full through the ledger before any phase-1 refund state)
select flt.check('f7: refund due fixed at 50000 at failure, cash refunds after failure 50000, remaining 0', (select refund_due_sdg = 50000 from public.fin_file_ledger_state where financial_file_id = flt.uid('f7'))
  and (public.fin_file_refund_status(flt.uid('f7'))->>'refunded_cash_sdg')::numeric = 50000 and (public.fin_file_refund_status(flt.uid('f7'))->>'refund_remaining_sdg')::numeric = 0);
select flt.check('f7: start_refund then confirm_refund pass on the ledger proof, without client_transferred_at', (public.transition_bsgt_financial_file(flt.uid('f7'), flt.flv('f7'), 'start_refund')::jsonb->'file'->>'status') = 'refund_in_progress');
select flt.check('f7: refunded', (public.transition_bsgt_financial_file(flt.uid('f7'), flt.flv('f7'), 'confirm_refund')::jsonb->'file'->>'status') = 'refunded'
  and (select client_transferred_at is null from public.bsgt_financial_files where id = flt.uid('f7')));
select flt.check('activation flag: still governed by fin_ledger_settings only', (select count(*) from public.fin_ledger_settings) = 1);

-- ================================================================ 6) reversals vs confirmed file states (f12: ledger, client ONE, bank 30000, commission 40000, permit client)
set role authenticated;
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.open_fin_file_ledger(flt.uid('f12'), 'ledger');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r12a', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"30000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f12'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r12a'), 1);
select public.transition_bsgt_financial_file(flt.uid('f12'), flt.flv('f12'), 'confirm_client_transfer');
select flt.set('rr12a', public.reverse_fin_voucher(flt.uid('r12a'), 2, 'حوالة مرتجعة من البنك')::text);
select flt.check('reverse receipt after funding confirmed: documented auto-revert to pending + stamp cleared + events on both sides', (flt.get('rr12a')::jsonb->'voucher'->>'status') = 'reversed'
  and (select status = 'pending_client_transfer' and client_transferred_at is null from public.bsgt_financial_files where id = flt.uid('f12'))
  and (select count(*) = 1 from public.bsgt_financial_file_events where financial_file_id = flt.uid('f12') and event_type = 'client_transfer_reverted' and note like '%deposit 0 < costs 30000%')
  and (select note like '%client transfer stamp reverted%' from public.fin_ledger_events where entity_id = flt.uid('r12a') and event_type = 'reversed'));
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r12b', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"30000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f12'))::jsonb)::jsonb->>'voucher_id');
select flt.set('r12c', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"1000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f12'))::jsonb)::jsonb->>'voucher_id');
select flt.set('p12', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"30000","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f12'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r12b'), 1);
select public.post_fin_voucher(flt.uid('r12c'), 1);
select public.transition_bsgt_financial_file(flt.uid('f12'), flt.flv('f12'), 'confirm_client_transfer');
select flt.set('rr12c', public.reverse_fin_voucher(flt.uid('r12c'), 2, 'قيد مكرر')::text);
select flt.check('reverse receipt that funding does not rely on (deposit stays >= costs): no state change', (select status = 'client_transferred' and client_transferred_at is not null from public.bsgt_financial_files where id = flt.uid('f12')));
select public.approve_fin_file_costs(flt.uid('f12'), flt.slv('f12'), '30000');
select public.post_fin_voucher(flt.uid('p12'), 1);
select public.transition_bsgt_financial_file(flt.uid('f12'), flt.flv('f12'), 'confirm_bank_payment');
select flt.set('rr12b', public.reverse_fin_voucher(flt.uid('r12b'), 2, 'حوالة مرتجعة')::text);
select flt.check('reverse receipt when bank_paid: status kept, transfer stamp cleared (documented), no fake stamps', (select status = 'bank_paid' and client_transferred_at is null and bank_paid_at is not null from public.bsgt_financial_files where id = flt.uid('f12'))
  and (select note like '%stamp cleared, status kept%' from public.bsgt_financial_file_events where financial_file_id = flt.uid('f12') and event_type = 'client_transfer_reverted' order by created_at desc limit 1));
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r12d', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"30000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f12'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r12d'), 1);
select flt.set('ct12', public.transition_bsgt_financial_file(flt.uid('f12'), flt.flv('f12'), 'confirm_client_transfer')::text);
select flt.check('transfer stamp recorded later while bank_paid (status kept)', (flt.get('ct12')::jsonb->'file'->>'status') = 'bank_paid' and (flt.get('ct12')::jsonb->'file'->>'client_transferred_at') is not null);
select flt.set('rp12', public.reverse_fin_voucher(flt.uid('p12'), 2, 'دُفع من حساب خاطئ')::text);
select flt.check('reverse bank payment after confirmation (no delivery/settlement): documented auto-revert to client_transferred', (flt.get('rp12')::jsonb->'voucher'->>'status') = 'reversed'
  and (select status = 'client_transferred' and bank_paid_at is null from public.bsgt_financial_files where id = flt.uid('f12'))
  and (select count(*) = 1 from public.bsgt_financial_file_events where financial_file_id = flt.uid('f12') and event_type = 'bank_payment_reverted'));
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('p12b', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"30000","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('cash'), flt.get('f12'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('p12b'), 1);
select public.transition_bsgt_financial_file(flt.uid('f12'), flt.flv('f12'), 'confirm_bank_payment');
select public.confirm_fin_file_delivery(flt.uid('f12'), flt.slv('f12'), 'سُلِّم');
select flt.expect_error('reverse bank payment after delivery confirmed: refused with a correction path', $q$select public.reverse_fin_voucher(flt.uid('p12b'), 2, 'x')$q$, 'followed by delivery/settlement/completion');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('st12', public.create_fin_voucher(format('{"voucher_type":"settlement","financial_file_id":"%s"}', flt.get('f12'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('st12'), 1);
select public.transition_bsgt_financial_file(flt.uid('f12'), flt.flv('f12'), 'complete');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r12e', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"40000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","memo":"العمولة"}', flt.get('bank'), flt.get('f12'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r12e'), 1);
select public.transition_bsgt_financial_file(flt.uid('f12'), flt.flv('f12'), 'close');
select flt.expect_error('closed file: reversing the commission receipt would reopen a due => refused', $q$select public.reverse_fin_voucher(flt.uid('r12e'), 2, 'x')$q$, 'closed with no client due');
select flt.expect_error('closed file: reversing the settlement refused (closure relies on it)', $q$select public.reverse_fin_voucher(flt.uid('st12'), 2, 'x')$q$, 'closure relies on the settlement');
select flt.expect_error('closed file: reversing the funding receipt refused', $q$select public.reverse_fin_voucher(flt.uid('r12d'), 2, 'x')$q$, 'closed');
select flt.check('closed file stays closed and completed after the refused reversals', (select status = 'completed' and closed_at is not null from public.bsgt_financial_files where id = flt.uid('f12')) and flt.vstatus('r12e') = 'posted' and flt.vstatus('st12') = 'posted');

-- ================================================================ 7) allocation approval bound to the vouchers; receipts after failure (f13: client TWO, deposit 20000 at failure)
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.open_fin_file_ledger(flt.uid('f13'), 'ledger');
select public.open_fin_file_ledger(flt.uid('f15'), 'ledger');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r13', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"20000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f13'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r13'), 1);
select public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'fail', 'رفض');
select public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'start_refund');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rf13', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"5000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f13'))::jsonb)::jsonb->>'voucher_id');
select flt.set('r13x', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"3000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s","memo":"حوالة وصلت بعد الإخفاق"}', flt.get('bank'), flt.get('f13'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf13'), 1);
select public.post_fin_voucher(flt.uid('r13x'), 1);
select flt.check('receipt after failure: fixed due unchanged (20000), total due 23000, remaining 18000', (select refund_due_sdg = 20000 from public.fin_file_ledger_state where financial_file_id = flt.uid('f13'))
  and (public.fin_file_refund_status(flt.uid('f13'))->>'refund_total_due_sdg')::numeric = 23000 and (public.fin_file_refund_status(flt.uid('f13'))->>'received_after_failure_sdg')::numeric = 3000
  and (public.fin_file_refund_status(flt.uid('f13'))->>'refund_remaining_sdg')::numeric = 18000);
select flt.expect_error('confirm_refund with money received after failure still unreturned: refused (5000 <> 23000)', $q$select public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'confirm_refund')$q$, 'received after failure 3000');
select flt.set('rr13x', public.reverse_fin_voucher(flt.uid('r13x'), 2, 'حوالة لملف آخر')::text);
select flt.check('reversing the post-failure receipt before confirmation: total due back to 20000', (flt.get('rr13x')::jsonb->'voucher'->>'status') = 'reversed' and (public.fin_file_refund_status(flt.uid('f13'))->>'refund_total_due_sdg')::numeric = 20000);
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('bt13', public.create_fin_voucher(format('{"voucher_type":"balance_transfer","amount":"15000","client_id":"00000000-0000-4000-8000-0000000000c2","financial_file_id":"%s","target_file_id":"%s","reason":"بطلب العميل"}', flt.get('f13'), flt.get('f15'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('bt13'), 1);
select flt.set('aa13', public.approve_fin_refund_allocation(flt.uid('f13'), flt.slv('f13'), 'العميل اختار التخصيص')::text);
select flt.check('allocation approval bound to the voucher set (ids + versions)', (select refund_allocation_voucher_ids = array[flt.uid('bt13')] and refund_allocation_lock_versions = array[2::bigint] and refund_allocated_sdg = 15000 from public.fin_file_ledger_state where financial_file_id = flt.uid('f13'))
  and (flt.get('aa13')::jsonb->'refund'->>'refund_allocation_valid')::boolean);
select flt.expect_error('allocation approval: the same set cannot be re-approved without a change', $q$select public.approve_fin_refund_allocation(flt.uid('f13'), flt.slv('f13'), 'x')$q$, 'already approved');
select flt.set('cr13', public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'confirm_refund')::text);
select flt.check('confirm_refund: cash 5000 + approved allocation 15000 = 20000', (flt.get('cr13')::jsonb->'file'->>'status') = 'refunded');
-- the scenario: reverse the approved allocation => approval voided in the same transaction, refund reopened, confirmation refused
select flt.set('rbt13', public.reverse_fin_voucher(flt.uid('bt13'), 2, 'العميل تراجع عن التخصيص')::text);
select flt.check('reverse approved allocation: approval voided + refund reopened + logged', (flt.get('rbt13')::jsonb->'voucher'->>'status') = 'reversed'
  and (select refund_allocated_sdg is null and refund_allocation_voucher_ids is null and refund_allocation_approved_at is null from public.fin_file_ledger_state where financial_file_id = flt.uid('f13'))
  and (select status = 'refund_in_progress' and refunded_at is null from public.bsgt_financial_files where id = flt.uid('f13'))
  and (select count(*) = 1 from public.fin_ledger_events where entity_id = flt.uid('f13') and event_type = 'refund_allocation_voided')
  and (select count(*) >= 1 from public.bsgt_financial_file_events where financial_file_id = flt.uid('f13') and event_type = 'refund_reopened'));
select flt.expect_error('confirm_refund after the allocation reversal: refused', $q$select public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'confirm_refund')$q$, 'plus approved allocations \(0\) do not equal');
-- a replacement allocation cannot reuse the old approval
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('bt13b', public.create_fin_voucher(format('{"voucher_type":"balance_transfer","amount":"15000","client_id":"00000000-0000-4000-8000-0000000000c2","financial_file_id":"%s","target_file_id":"%s","reason":"تخصيص بديل"}', flt.get('f13'), flt.get('f15'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('bt13b'), 1);
select flt.expect_error('replacement allocation without a new review: confirm_refund refused', $q$select public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'confirm_refund')$q$, 'do not equal');
select public.approve_fin_refund_allocation(flt.uid('f13'), flt.slv('f13'), 'مراجعة جديدة للتخصيص البديل');
-- an allocation beyond the balance cannot even be drafted (balance rule), so the approved set cannot grow silently
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('an allocation beyond the due is refused by the balance rule', format($q$select public.create_fin_voucher('{"voucher_type":"balance_transfer","amount":"1","client_id":"00000000-0000-4000-8000-0000000000c2","financial_file_id":"%s","target_file_id":"%s","reason":"x"}')$q$, flt.get('f13'), flt.get('f15')), 'exceeds the client available balance');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.set('cr13b', public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'confirm_refund')::text);
select flt.check('confirm_refund with the newly approved set', (flt.get('cr13b')::jsonb->'file'->>'status') = 'refunded');
-- receipt AFTER the confirmed refund: refund reopened in the same transaction; close refused until returned
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r13y', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"2000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s","memo":"وصلت بعد الرد"}', flt.get('bank'), flt.get('f13'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.set('pr13y', public.post_fin_voucher(flt.uid('r13y'), 1)::text);
select flt.check('receipt after confirmed refund: refund reopened (documented), total due 22000, remaining 2000', (select status = 'refund_in_progress' and refunded_at is null from public.bsgt_financial_files where id = flt.uid('f13'))
  and (select note like '%refund reopened%' from public.fin_ledger_events where entity_id = flt.uid('r13y') and event_type = 'posted')
  and (public.fin_file_refund_status(flt.uid('f13'))->>'refund_remaining_sdg')::numeric = 2000);
select flt.expect_error('confirm_refund refused while the 2000 is unreturned', $q$select public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'confirm_refund')$q$, 'received after failure 2000');
select flt.set('rr13y', public.reverse_fin_voucher(flt.uid('r13y'), 2, 'قُيّدت بالخطأ على هذا الملف')::text);
select flt.check('reversing that receipt: remaining 0 again, status stays refund_in_progress until re-confirmed', (public.fin_file_refund_status(flt.uid('f13'))->>'refund_remaining_sdg')::numeric = 0 and (select status = 'refund_in_progress' from public.bsgt_financial_files where id = flt.uid('f13')));
select public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'confirm_refund');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r13z', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"2000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f13'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r13z'), 1);
select flt.expect_error('close refused while money received after the refund is unreturned', $q$select public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'close')$q$, 'not allowed from status refund_in_progress');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rf13z', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"2000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f13'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf13z'), 1);
select flt.set('cr13c', public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'confirm_refund')::text);
select flt.check('re-confirmed: cash 7000 + allocation 15000 = 20000 + 2000', (flt.get('cr13c')::jsonb->'file'->>'status') = 'refunded');
-- reversing a refund after confirmation: reopened; closed => refused
select flt.set('rrf13z', public.reverse_fin_voucher(flt.uid('rf13z'), 2, 'حوالة الرد ارتدت')::text);
select flt.check('reverse refund after confirm_refund: refund reopened (documented)', (select status = 'refund_in_progress' from public.bsgt_financial_files where id = flt.uid('f13')) and (select count(*) >= 3 from public.bsgt_financial_file_events where financial_file_id = flt.uid('f13') and event_type = 'refund_reopened'));
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rf13w', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"2000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('cash'), flt.get('f13'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf13w'), 1);
select public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'confirm_refund');
select flt.set('cl13', public.transition_bsgt_financial_file(flt.uid('f13'), flt.flv('f13'), 'close')::text);
select flt.check('closed refunded file (deposit 0)', (flt.get('cl13')::jsonb->'file'->>'closed_at') is not null);
select flt.expect_error('closed refunded file: refund reversal refused', $q$select public.reverse_fin_voucher(flt.uid('rf13w'), 2, 'x')$q$, 'closed after a confirmed refund');
select flt.expect_error('closed refunded file: approved allocation reversal refused', $q$select public.reverse_fin_voucher(flt.uid('bt13b'), 2, 'x')$q$, 'closed after a confirmed refund');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r13c', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"1","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f13'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.expect_error('closed refunded file: posting a new receipt is refused (record it on the client without a file)', $q$select public.post_fin_voucher(flt.uid('r13c'), 1)$q$, 'closed after a confirmed refund');
select flt.check('closed refunded file: the refused receipt stays a draft, file untouched', flt.vstatus('r13c') = 'draft' and (select status = 'refunded' and closed_at is not null from public.bsgt_financial_files where id = flt.uid('f13')));

-- ================================================================ 8) bank payment and delivery BEFORE the client transfers (f14: client ONE, bank 45000, commission 60000)
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.open_fin_file_ledger(flt.uid('f14'), 'ledger');
select public.approve_fin_file_costs(flt.uid('f14'), flt.slv('f14'), '45000');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('p14', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"45000","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f14'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('p14'), 1);
select flt.set('bp14', public.transition_bsgt_financial_file(flt.uid('f14'), flt.flv('f14'), 'confirm_bank_payment')::text);
select flt.check('bank payment confirmed from pending_client_transfer on the ledger proof, no transfer stamp invented', (flt.get('bp14')::jsonb->'file'->>'status') = 'bank_paid' and (flt.get('bp14')::jsonb->'file'->>'client_transferred_at') is null);
select public.confirm_fin_file_delivery(flt.uid('f14'), flt.slv('f14'), 'سُلِّم قبل التحويل');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('st14', public.create_fin_voucher(format('{"voucher_type":"settlement","financial_file_id":"%s"}', flt.get('f14'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('st14'), 1);
select flt.set('cp14', public.transition_bsgt_financial_file(flt.uid('f14'), flt.flv('f14'), 'complete')::text);
select flt.check('delivered and completed with the whole 105000 due from the client (no receipts at all)', (flt.get('cp14')::jsonb->'file'->>'status') = 'completed' and (public.fin_file_ledger_totals(flt.uid('f14'))->>'due_from_client_sdg')::numeric = 105000);
select flt.expect_error('transfer stamp cannot be recorded before the costs are funded', $q$select public.transition_bsgt_financial_file(flt.uid('f14'), flt.flv('f14'), 'confirm_client_transfer')$q$, 'does not cover');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r14', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"105000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f14'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r14'), 1);
select flt.set('ct14', public.transition_bsgt_financial_file(flt.uid('f14'), flt.flv('f14'), 'confirm_client_transfer')::text);
select flt.check('transfer stamp recorded after completion (status unchanged, stamp real)', (flt.get('ct14')::jsonb->'file'->>'status') = 'completed' and (flt.get('ct14')::jsonb->'file'->>'client_transferred_at') is not null);
select flt.check('close after the client paid everything', (public.transition_bsgt_financial_file(flt.uid('f14'), flt.flv('f14'), 'close')::jsonb->'file'->>'closed_at') is not null);

-- ================================================================ 9) funding evidence re-checked on NEW movements (refund / allocation out), not only on reversals
-- f16..f19: client ONE, bank 30000, commission 40000, permit client. f17 is also the allocation target.
set role authenticated;
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.open_fin_file_ledger(flt.uid(k), 'ledger') from unnest(array['f16','f17','f18','f19']) k;
-- (a) receipt covers costs → confirm_client_transfer → refund part
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r16', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"30000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f16'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r16'), 1);
select public.transition_bsgt_financial_file(flt.uid('f16'), flt.flv('f16'), 'confirm_client_transfer');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rf16', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"1000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s","memo":"رد جزء بطلب العميل"}', flt.get('bank'), flt.get('f16'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select flt.set('prf16', public.post_fin_voucher(flt.uid('rf16'), 1)::text);
select flt.check('post refund after funding confirmed: no unsupported confirmation left — status pending, stamp cleared, documented', (select status = 'pending_client_transfer' and client_transferred_at is null from public.bsgt_financial_files where id = flt.uid('f16'))
  and (select note like 'ledger: posting of RF%deposit 29000 < costs 30000%' from public.bsgt_financial_file_events where financial_file_id = flt.uid('f16') and event_type = 'client_transfer_reverted' order by created_at desc limit 1)
  and (select note like '%client transfer stamp reverted%' from public.fin_ledger_events where entity_id = flt.uid('rf16') and event_type = 'posted'));
-- (b) same with an allocation out
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r16b', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"1000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f16'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r16b'), 1);
select public.transition_bsgt_financial_file(flt.uid('f16'), flt.flv('f16'), 'confirm_client_transfer');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('bt16', public.create_fin_voucher(format('{"voucher_type":"balance_transfer","amount":"500","client_id":"00000000-0000-4000-8000-0000000000c1","financial_file_id":"%s","target_file_id":"%s","reason":"تخصيص جزء لملف آخر"}', flt.get('f16'), flt.get('f17'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('bt16'), 1);
select flt.check('post allocation out after funding confirmed: stamp cleared and status pending (source); target unaffected', (select status = 'pending_client_transfer' and client_transferred_at is null from public.bsgt_financial_files where id = flt.uid('f16'))
  and (select count(*) = 2 from public.bsgt_financial_file_events where financial_file_id = flt.uid('f16') and event_type = 'client_transfer_reverted')
  and (select status = 'pending_client_transfer' from public.bsgt_financial_files where id = flt.uid('f17')) and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f17')) = 500);
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rf16z', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"100","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f16'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf16z'), 1);
select flt.check('refund while already pending (no confirmation to protect): posted, no extra event', (select count(*) = 2 from public.bsgt_financial_file_events where financial_file_id = flt.uid('f16') and event_type = 'client_transfer_reverted'));
-- (c) after bank payment: refund and allocation out clear the stamp only, status bank_paid kept (bank payment evidence is the payment vouchers, not the deposit)
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r18', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"30000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f18'))::jsonb)::jsonb->>'voucher_id');
select flt.set('p18', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"30000","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f18'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r18'), 1);
select public.transition_bsgt_financial_file(flt.uid('f18'), flt.flv('f18'), 'confirm_client_transfer');
select public.approve_fin_file_costs(flt.uid('f18'), flt.slv('f18'), '30000');
select public.post_fin_voucher(flt.uid('p18'), 1);
select public.transition_bsgt_financial_file(flt.uid('f18'), flt.flv('f18'), 'confirm_bank_payment');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rf18', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"200","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f18'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf18'), 1);
select flt.check('post refund after bank paid: stamp cleared, status bank_paid kept, bank stamp kept (payments still = approved)', (select status = 'bank_paid' and client_transferred_at is null and bank_paid_at is not null from public.bsgt_financial_files where id = flt.uid('f18'))
  and (select note like '%stamp cleared, status kept%' from public.bsgt_financial_file_events where financial_file_id = flt.uid('f18') and event_type = 'client_transfer_reverted' order by created_at desc limit 1));
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r18b', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"200","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f18'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r18b'), 1);
select public.transition_bsgt_financial_file(flt.uid('f18'), flt.flv('f18'), 'confirm_client_transfer');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('bt18', public.create_fin_voucher(format('{"voucher_type":"balance_transfer","amount":"1","client_id":"00000000-0000-4000-8000-0000000000c1","financial_file_id":"%s","target_file_id":"%s","reason":"x"}', flt.get('f18'), flt.get('f17'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('bt18'), 1);
select flt.check('post allocation out after bank paid: stamp cleared again, status bank_paid kept', (select status = 'bank_paid' and client_transferred_at is null from public.bsgt_financial_files where id = flt.uid('f18'))
  and (select count(*) = 2 from public.bsgt_financial_file_events where financial_file_id = flt.uid('f18') and event_type = 'client_transfer_reverted'));
reset role;
select flt.check('stamps never contradict the balances: every file with a transfer stamp has deposit >= costs', (select count(*) = 0 from public.bsgt_financial_files f join public.fin_file_ledger_state s on s.financial_file_id = f.id
  where s.ledger_mode = 'ledger' and f.client_transferred_at is not null and f.status not in ('failed','refund_in_progress','refunded')
    and public.fin_client_deposit(f.client_id, f.id) < coalesce(s.approved_bank_cost_sdg, f.bank_cost_sdg) + case when f.import_permit_source = 'bsgt' then coalesce(s.approved_permit_cost_sdg, f.import_permit_cost_sdg) else 0 end));
set role authenticated;
-- (d) closed completed file with a surplus: refund of the surplus keeps funding + closure intact; a refund beyond the surplus is refused by the balance rule
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r19', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"75000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f19'))::jsonb)::jsonb->>'voucher_id');
select flt.set('p19', public.create_fin_voucher(format('{"voucher_type":"payment_bank","amount":"30000","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f19'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r19'), 1);
select public.transition_bsgt_financial_file(flt.uid('f19'), flt.flv('f19'), 'confirm_client_transfer');
select public.approve_fin_file_costs(flt.uid('f19'), flt.slv('f19'), '30000');
select public.post_fin_voucher(flt.uid('p19'), 1);
select public.transition_bsgt_financial_file(flt.uid('f19'), flt.flv('f19'), 'confirm_bank_payment');
select public.confirm_fin_file_delivery(flt.uid('f19'), flt.slv('f19'), 'سُلِّم');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('st19', public.create_fin_voucher(format('{"voucher_type":"settlement","financial_file_id":"%s"}', flt.get('f19'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('st19'), 1);
select public.transition_bsgt_financial_file(flt.uid('f19'), flt.flv('f19'), 'complete');
select public.transition_bsgt_financial_file(flt.uid('f19'), flt.flv('f19'), 'close');
select flt.check('f19 closed with a 5000 surplus for the client', (select closed_at is not null from public.bsgt_financial_files where id = flt.uid('f19')) and flt.bal('00000000-0000-4000-8000-0000000000c1', flt.uid('f19')) = 5000);
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.expect_error('closed file: refund beyond the surplus refused (balance rule) — no due can be reopened', format($q$select public.create_fin_voucher('{"voucher_type":"refund","amount":"5001","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}')$q$, flt.get('bank'), flt.get('f19')), 'exceeds the client available balance');
select flt.set('rf19', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"5000","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f19'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf19'), 1);
select flt.check('closed file: surplus refunded; status, stamps and closure untouched; deposit still >= costs; due 0', (select status = 'completed' and closed_at is not null and client_transferred_at is not null and bank_paid_at is not null from public.bsgt_financial_files where id = flt.uid('f19'))
  and (public.fin_file_ledger_totals(flt.uid('f19'))->>'due_from_client_sdg')::numeric = 0 and (public.fin_file_ledger_totals(flt.uid('f19'))->>'client_deposit_sdg')::numeric = 70000
  and (select count(*) = 0 from public.bsgt_financial_file_events where financial_file_id = flt.uid('f19') and event_type in ('client_transfer_reverted','bank_payment_reverted')));

-- ================================================================ 10) reversal of a receipt that is part of the refund-due snapshot (f20: client TWO)
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.open_fin_file_ledger(flt.uid('f20'), 'ledger');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r20', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"10000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f20'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r20'), 1);
select public.transition_bsgt_financial_file(flt.uid('f20'), flt.flv('f20'), 'fail', 'إلغاء');
select flt.expect_error('pre-failure receipt cannot be reversed: it is part of the fixed refund due (10000) — return the money with a refund voucher', $q$select public.reverse_fin_voucher(flt.uid('r20'), 2, 'قُيّد بالخطأ')$q$, 'part of the refund due fixed at the failure');
select flt.check('snapshot and received money preserved after the refused reversal', flt.vstatus('r20') = 'posted' and (select refund_due_sdg = 10000 from public.fin_file_ledger_state where financial_file_id = flt.uid('f20'))
  and (public.fin_file_refund_status(flt.uid('f20'))->>'refund_remaining_sdg')::numeric = 10000);
select public.transition_bsgt_financial_file(flt.uid('f20'), flt.flv('f20'), 'start_refund');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rf20', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"10000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s","memo":"إعادة المبلغ المقيَّد بالخطأ"}', flt.get('bank'), flt.get('f20'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf20'), 1);
select flt.check('the correction path: a refund voucher proves the return and the refund is confirmable with the original snapshot', (public.transition_bsgt_financial_file(flt.uid('f20'), flt.flv('f20'), 'confirm_refund')::jsonb->'file'->>'status') = 'refunded');

-- ================================================================ 11) failure with a zero snapshot, then a receipt (f21: client TWO): the total due drives start_refund / close
set role authenticated;
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.open_fin_file_ledger(flt.uid('f21'), 'ledger');
select public.transition_bsgt_financial_file(flt.uid('f21'), flt.flv('f21'), 'fail', 'ألغى العميل قبل أي دفع');
select flt.check('zero snapshot: refund due 0 at failure, start_refund not offered', (select refund_due_sdg = 0 from public.fin_file_ledger_state where financial_file_id = flt.uid('f21')));
select flt.expect_error('zero snapshot: start_refund refused while nothing is due', $q$select public.transition_bsgt_financial_file(flt.uid('f21'), flt.flv('f21'), 'start_refund')$q$, 'not allowed from status failed');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('r21', public.create_fin_voucher(format('{"voucher_type":"receipt","amount":"10000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s","memo":"حوالة وصلت بعد الإلغاء"}', flt.get('bank'), flt.get('f21'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('r21'), 1);
select flt.check('receipt after a zero-snapshot failure: snapshot stays 0, total due 10000', (select refund_due_sdg = 0 from public.fin_file_ledger_state where financial_file_id = flt.uid('f21'))
  and (public.fin_file_refund_status(flt.uid('f21'))->>'refund_total_due_sdg')::numeric = 10000 and (public.fin_file_refund_status(flt.uid('f21'))->>'refund_remaining_sdg')::numeric = 10000);
select flt.expect_error('close refused: the refund proof would be bypassed (total due 10000)', $q$select public.transition_bsgt_financial_file(flt.uid('f21'), flt.flv('f21'), 'close')$q$, 'not allowed from status failed');
select flt.set('sr21', public.transition_bsgt_financial_file(flt.uid('f21'), flt.flv('f21'), 'start_refund')::text);
select flt.check('start_refund allowed from the total due (snapshot 0 + received 10000)', (flt.get('sr21')::jsonb->'file'->>'status') = 'refund_in_progress');
select flt.expect_error('confirm_refund refused before the 10000 is returned', $q$select public.transition_bsgt_financial_file(flt.uid('f21'), flt.flv('f21'), 'confirm_refund')$q$, 'received after failure 10000');
select flt.as_user('00000000-0000-4000-8000-0000000000a2');
select flt.set('rf21', public.create_fin_voucher(format('{"voucher_type":"refund","amount":"10000","client_id":"00000000-0000-4000-8000-0000000000c2","cash_account_id":"%s","financial_file_id":"%s"}', flt.get('bank'), flt.get('f21'))::jsonb)::jsonb->>'voucher_id');
select flt.as_user('00000000-0000-4000-8000-0000000000a3');
select public.post_fin_voucher(flt.uid('rf21'), 1);
select flt.check('confirm_refund after returning the 10000 (cash 10000 = 0 + 10000)', (public.transition_bsgt_financial_file(flt.uid('f21'), flt.flv('f21'), 'confirm_refund')::jsonb->'file'->>'status') = 'refunded');
select flt.check('close after the refund cycle', (public.transition_bsgt_financial_file(flt.uid('f21'), flt.flv('f21'), 'close')::jsonb->'file'->>'closed_at') is not null);
reset role;
