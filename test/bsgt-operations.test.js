'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const operations = require('../bsgt-operations');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', '31_bsgt_operations_phase2.sql'), 'utf8');
const deleteMigration = fs.readFileSync(path.join(root, 'supabase', '37_bsgt_operations_document_delete.sql'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const completeShipment = {operationNo:'BSGTX-2026-0001',consignee:'Buyer',itemDesc:'Goods',proformaNo:'PI-1',invoiceNo:'INV-1'};
const requiredFiles = [
  {id:'a',document_type:'import_permit'},
  {id:'b',document_type:'certificate_of_origin'},
  {id:'c',document_type:'bill_of_lading'}
];

assert.strictEqual(operations.evaluateBsgtOperationsReadiness({}, []).completed, false);
for (const field of ['operationNo','consignee','itemDesc','proformaNo','invoiceNo']) {
  const shipment = {...completeShipment, [field]:''};
  assert.strictEqual(operations.evaluateBsgtOperationsReadiness(shipment, requiredFiles).completed, false, field);
}
for (const type of ['import_permit','certificate_of_origin','bill_of_lading']) {
  assert.strictEqual(operations.evaluateBsgtOperationsReadiness(completeShipment, requiredFiles.filter(file=>file.document_type!==type)).completed, false, type);
}
const ready = operations.evaluateBsgtOperationsReadiness(completeShipment, requiredFiles);
assert.strictEqual(ready.completed, true);
assert.strictEqual(ready.completedCount, 7);
assert.strictEqual(operations.evaluateBsgtOperationsReadiness(completeShipment, [...requiredFiles,{document_type:'optional_attachment'}]).completed, true);
assert.strictEqual(operations.evaluateBsgtOperationsReadiness(completeShipment, [{label:'إذن الاستيراد'},{label:'شهادة المنشأ (بحر سواكن)'},{label:'بوليصة الشحن (بحر سواكن)'}]).completed, true);
assert.strictEqual(operations.stageLabel('operations_draft'), 'مسودة');
assert.strictEqual(operations.stageLabel('ready_for_finance'), 'جاهزة للمالية');
assert.strictEqual(operations.isSupportedFile({name:'scan.PDF'}), true);
assert.strictEqual(operations.isSupportedFile({name:'scan.webp'}), false);
assert.strictEqual(operations.isUploadedOperationsDocument({document_type:'import_permit'}), true);
assert.strictEqual(operations.isUploadedOperationsDocument({document_type:'optional_attachment'}), true);
assert.strictEqual(operations.isUploadedOperationsDocument({document_type:'generated_invoice'}), false);
assert.strictEqual(operations.canDeleteUploadedDocument({bsgtStage:'operations_draft'}, {document_type:'generated_invoice'}, true), false);
assert.strictEqual(operations.canDeleteUploadedDocument({bsgtStage:'operations_draft'}, requiredFiles[0], true), true);
assert.strictEqual(operations.canDeleteUploadedDocument({bsgtStage:'operations_draft'}, requiredFiles[0], false), false);
for (const stage of ['ready_for_finance','sent_to_remitting','management_review','final_accepted','sent_to_collecting']) {
  assert.strictEqual(operations.canDeleteUploadedDocument({bsgtStage:stage}, requiredFiles[0], true), false, stage);
}
const afterRequiredDelete = operations.evaluateBsgtOperationsReadiness(completeShipment, requiredFiles.slice(1));
assert.strictEqual(afterRequiredDelete.completed, false);
assert.strictEqual(afterRequiredDelete.completedCount, 6);
const withOptional = [...requiredFiles,{id:'optional',document_type:'optional_attachment'}];
assert.strictEqual(operations.evaluateBsgtOperationsReadiness(completeShipment, withOptional.filter(file=>file.id!=='optional')).completed, true);

for (const column of ['bsgt_stage','bsgt_stage_updated_at','operations_completed_at','operations_completed_by']) assert.ok(migration.includes(column));
for (const stage of ['operations_draft','ready_for_finance','sent_to_remitting','management_review','final_accepted','sent_to_collecting']) assert.ok(migration.includes(`'${stage}'`));
assert.ok(migration.includes("where company_id = public.bsgt_company_id()"));
assert.ok(migration.includes("and bsgt_stage is null"));
assert.ok(migration.includes("public.has_bsgt_workspace_permission('operations', true)"));
assert.ok(migration.includes('for update;'));
assert.ok(migration.includes("bsgt_stage = 'ready_for_finance'"));
assert.ok(migration.includes("jsonb_set(coalesce(new.data, '{}'::jsonb), '{bsgtOperationsSnapshot}'"));
assert.ok(migration.includes("'generatedKinds', jsonb_build_array('contract','proforma','invoice','packing')"));
assert.ok(migration.includes("'uploadedDocumentIds'"));
assert.ok(migration.includes("'uploadedDocuments'"));
assert.ok(migration.includes('create trigger shipments_guard_bsgt_operations_transition'));
assert.ok(migration.includes("raise exception 'BSGT operations requirements are incomplete'"));
assert.ok(!migration.includes('set status ='));
assert.ok(!migration.includes('workflow_stage ='));
assert.ok(!migration.includes('trade_collection_files'));
assert.ok(!migration.includes('shipment_package_attachments'));

assert.ok(deleteMigration.includes("public.has_bsgt_workspace_permission('operations', true)"));
assert.ok(deleteMigration.includes("shipment.bsgt_stage = 'operations_draft'"));
assert.ok(deleteMigration.includes('file.id = p_file_id'));
assert.ok(deleteMigration.includes('file.shipment_id = p_shipment_id'));
assert.ok(deleteMigration.includes("bucket_id = 'shipment-files'"));
assert.ok(deleteMigration.includes('file.path = storage.objects.name'));
assert.ok(deleteMigration.includes('not exists ('));
assert.ok(deleteMigration.includes('delete_bsgt_operations_document'));
assert.ok(!deleteMigration.includes('delete from public.shipments'));

for (const source of ['bsgt-workspace.js','bsgt-operations.js','bsgt-operations.css']) assert.ok(html.includes(source));
assert.ok(html.includes(".eq('company_id', companyId)"));
assert.ok(html.includes(".in('shipment_id', ids)"));
assert.ok(!html.includes("state.rows.map(async"));
assert.ok(html.includes('function renderBsgtOperationsDocuments(r)'));
assert.ok(html.includes("${file?'مرفوع':'غير مرفوع'}"));
assert.ok(html.includes('function submitBsgtOperationsToFinance(id, button'));
assert.ok(html.includes("sb.rpc('complete_bsgt_operations'"));
assert.ok(html.includes("documentType:api.DOCUMENT_TYPES[key]"));
assert.ok(html.includes("key === 'optionalAttachment'"));
assert.ok(html.includes("sb.rpc('delete_bsgt_operations_document'"));
assert.ok(html.includes('showShipmentWorkflowDialog({'));
assert.ok(html.includes("if(!confirm('سيتم إنهاء مرحلة العمليات وإرسال الشحنة للمالية.\\nهل تريد المتابعة؟'))"));
assert.ok(html.includes('function renderBsgtFinanceShell'));
console.log('BSGT operations readiness and migration: passed');
