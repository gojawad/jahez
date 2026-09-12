'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const finance = require('../bsgt-finance');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', '32_bsgt_finance_phase3.sql'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const portal = fs.readFileSync(path.join(root, 'experiments', 'bs-collection', 'collection-lab.js'), 'utf8');

const usdA = {id:'a', operationNo:'BSGT-2026-0001', totalAmount:'USD 1,200.50'};
const usdB = {id:'b', operationNo:'BSGT-2026-0002', totalAmount:'500', currency:'usd'};
const aed = {id:'c', operationNo:'BSGT-2026-0003', totalAmount:'AED 100.00'};
assert.deepStrictEqual(finance.shipmentMoney(usdA), {currency:'USD', amount:1200.5});
assert.deepStrictEqual(finance.shipmentMoney(usdB), {currency:'USD', amount:500});
assert.strictEqual(finance.summarizeShipments([usdA, usdB]).sameCurrency, true);
assert.strictEqual(finance.summarizeShipments([usdA, usdB]).amount, 1700.5);
assert.strictEqual(finance.summarizeShipments([usdA, aed]).sameCurrency, false);
assert.deepStrictEqual(finance.summarizeShipments([usdA, aed]).totals, {USD:1200.5,AED:100});
assert.strictEqual(finance.fileStatusLabel('draft'), 'مسودة');
assert.strictEqual(finance.fileStatusLabel('sent_to_remitting'), 'تم الإرسال للبنك المرسل');
assert.strictEqual(finance.collectionPortalUrl('file id'), '/experiments/bs-collection/?tradeFileId=file%20id');

// Server-side ready-for-finance filtering and BSGT scoping.
assert.ok(html.includes(".eq('company_id',companyId).eq('bsgt_stage','ready_for_finance')"));
assert.ok(html.includes('data-bsgt-finance-select'));
assert.ok(html.includes('bsgtFinanceState.selected=new Set'));
assert.ok(html.includes("sb.rpc('create_bsgt_trade_collection_file'"));
assert.ok(html.includes("sb.rpc('add_bsgt_shipments_to_trade_file'"));
assert.ok(html.includes("sb.rpc('remove_bsgt_shipment_from_trade_file'"));
assert.ok(html.includes("sb.rpc('send_bsgt_trade_file_to_remitting'"));
assert.ok(html.includes('الشحنات المختارة تحتوي على أكثر من عملة'));
assert.ok(html.includes('!summary.sameCurrency'));
assert.ok(html.includes("documentKinds:['letter','undertaking','exchange']"));
assert.ok(html.includes('qrIncluded:false'));
assert.ok(html.includes(".in('trade_file_id',fileIds)"));
assert.ok(!html.includes('files.map(async'));

// Database transaction boundaries and invariants.
assert.ok(migration.includes('trade_collection_file_shipments_shipment_key'));
assert.ok(migration.includes("raise exception 'Cannot enable one-trade-file-per-shipment: duplicate shipment links exist'"));
assert.ok(migration.includes('create or replace function public.create_bsgt_trade_collection_file'));
assert.ok(migration.includes('create or replace function public.send_bsgt_trade_file_to_remitting'));
assert.ok(migration.includes("public.has_bsgt_workspace_permission('finance', true)"));
assert.ok(migration.includes("shipment.bsgt_stage = 'ready_for_finance'"));
assert.ok(migration.includes("shipment.company_id = public.bsgt_company_id()"));
assert.ok(migration.includes("raise exception 'One or more shipments already belong to a trade file'"));
assert.ok(migration.includes('for update of shipment'));
assert.ok(migration.includes("set bsgt_stage = 'sent_to_remitting'"));
assert.ok(migration.includes("set status = 'sent_to_remitting'"));
assert.ok(migration.includes("raise exception 'All linked shipments must use one valid currency'"));
assert.ok(!migration.includes('workflow_stage ='));
assert.ok(!migration.includes('set status = \'sent\''));
assert.ok(!migration.includes('shipment_package_attachments'));

// Trade-file portal context uses the database operation number and leaves legacy mode intact.
assert.ok(portal.includes("new URLSearchParams(location.search).get('tradeFileId')"));
assert.ok(portal.includes("operationNo:state.tradeFile?.operation_no||createCollectionOperationNo(sentAt)"));
assert.ok(portal.includes("sb.from('trade_collection_file_shipments')"));
assert.ok(portal.includes("state.selected=new Set(state.shipments.map(shipment=>shipment.id))"));
assert.ok(portal.includes("${state.tradeFile?'disabled':''}"));
assert.ok(portal.includes("if(state.tradeFile){"));
assert.ok(portal.includes("sb.rpc('send_bsgt_trade_file_to_remitting'"));
assert.ok(portal.includes("else await saveShipmentCollectionState(rows,'sent',batch)"));

console.log('BSGT finance workflow, atomic RPCs, and trade-file portal context: passed');
