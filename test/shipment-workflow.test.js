'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'shipment-workflow.js'), 'utf8');
const context = {window:{}, Date};
vm.runInNewContext(source, context, {filename:'shipment-workflow.js'});

const workflow = context.window.JahezShipmentWorkflow;
const plain = value => JSON.parse(JSON.stringify(value));
const sentRecord = (stage = 'bank_sent', kinds = ['letter', 'undertaking', 'exchange']) => ({
  id:'shipment-1',
  status:'sent',
  workflowStage:stage,
  commercialCollectionOperations:[{
    id:'operation-1', operationNo:'TC-2026-0001', status:'sent',
    sentAt:'2026-09-11T10:00:00.000Z', documentKinds:kinds
  }]
});
const signedFile = (type, createdAt = '2026-09-11T11:00:00.000Z') => ({
  id:`${type}-${createdAt}`,
  document_type:type,
  signature_status:'signed',
  signed_at:createdAt,
  created_at:createdAt
});

assert.deepStrictEqual(Array.from(workflow.STAGES), ['created', 'bank_sent', 'signed', 'accepted']);
assert.deepStrictEqual(Array.from(workflow.SIGNED_DOCUMENT_TYPES), ['letter', 'undertaking', 'exchange']);
assert.strictEqual(workflow.normalizeStage('bank_sent'), 'bank_sent');
assert.strictEqual(workflow.normalizeStage('unexpected'), 'created');
assert.strictEqual(workflow.inferStage({data:{collectionStatus:'sent'}}), 'bank_sent');
assert.strictEqual(workflow.inferStage({data:{collectionSentAt:'2026-09-11T10:00:00.000Z'}}), 'bank_sent');
assert.strictEqual(workflow.inferStage({data:{}}), 'created');
assert.strictEqual(workflow.inferStage({workflow_stage:'accepted',data:{collectionStatus:'sent'}}), 'accepted');

const sent = workflow.bankSentFields('2026-09-11T10:00:00.000Z');
assert.strictEqual(sent.workflow_stage, 'bank_sent');
assert.strictEqual(sent.workflow_updated_at, sent.bank_sent_at);
assert.deepStrictEqual(
  plain(workflow.toRow({workflowStage:'created',acceptedAt:'',acceptedBy:''})),
  {workflow_stage:'created',accepted_at:null,accepted_by:null}
);

const latestOperationRecord = sentRecord();
latestOperationRecord.commercialCollectionOperations.unshift({
  id:'operation-old', status:'sent', sentAt:'2026-09-10T10:00:00.000Z', documentKinds:['letter']
});
latestOperationRecord.commercialCollectionOperations.push({
  id:'operation-new', status:'sent', sentAt:'2026-09-12T10:00:00.000Z',
  documentKinds:['exchange', 'letter', 'letter', 'invalid']
});
assert.deepStrictEqual(Array.from(workflow.requiredSignedDocumentTypes(latestOperationRecord)), ['exchange', 'letter']);

assert.deepStrictEqual(
  Array.from(workflow.requiredSignedDocumentTypes({collectionDocumentKinds:['undertaking', 'exchange']})),
  ['undertaking', 'exchange']
);

const bankSent = sentRecord();
assert.strictEqual(workflow.signingSyncFields(bankSent, []), null);
assert.strictEqual(workflow.signingSyncFields(bankSent, [signedFile('letter')]), null);
assert.strictEqual(workflow.signingSyncFields(bankSent, [signedFile('letter'), signedFile('undertaking')]), null);

const completedFiles = ['letter', 'undertaking', 'exchange'].map(type=>signedFile(type));
assert.deepStrictEqual(
  plain(workflow.signingSyncFields(bankSent, completedFiles, '2026-09-11T12:00:00.000Z')),
  {workflow_stage:'signed',workflow_updated_at:'2026-09-11T12:00:00.000Z',signed_at:'2026-09-11T12:00:00.000Z'}
);

assert.strictEqual(workflow.signingSyncFields(sentRecord('created'), completedFiles), null);

assert.deepStrictEqual(
  plain(workflow.signingSyncFields(sentRecord('signed'), completedFiles.slice(0, 2), '2026-09-11T13:00:00.000Z')),
  {workflow_stage:'bank_sent',workflow_updated_at:'2026-09-11T13:00:00.000Z',signed_at:null}
);

assert.strictEqual(workflow.signingSyncFields(sentRecord('accepted'), []), null);

assert.strictEqual(workflow.evaluateShipmentSigning(bankSent, [
  {document_type:'letter',signature_status:'uploaded'},
  signedFile('unrelated')
]).progress.completed, 0);

const oldLetter = signedFile('letter', '2026-09-11T09:00:00.000Z');
const newLetter = signedFile('letter', '2026-09-11T14:00:00.000Z');
const versioned = workflow.evaluateShipmentSigning(sentRecord('bank_sent', ['letter']), [oldLetter, newLetter]);
assert.strictEqual(versioned.activeSignedFiles.letter.id, newLetter.id);
assert.strictEqual(versioned.completed, true);

const unchanged = sentRecord();
const before = plain(unchanged);
workflow.evaluateShipmentSigning(unchanged, completedFiles);
workflow.signingSyncFields(unchanged, completedFiles);
assert.deepStrictEqual(plain(unchanged), before);
assert.strictEqual(unchanged.status, 'sent');

const phase1Migration = fs.readFileSync(path.join(root, 'supabase', '27_shipment_workflow_phase1.sql'), 'utf8');
for(const column of ['workflow_stage','workflow_updated_at','bank_sent_at','signed_at','accepted_at','accepted_by']){
  assert.ok(phase1Migration.includes(`add column if not exists ${column}`), `${column} must be additive`);
}
assert.ok(phase1Migration.includes("check (workflow_stage in ('created', 'bank_sent', 'signed', 'accepted'))"));
assert.ok(!phase1Migration.includes('update public.shipments set status'));

const phase2Migration = fs.readFileSync(path.join(root, 'supabase', '28_shipment_workflow_signed.sql'), 'utf8');
for(const column of ['document_type','signature_status','signed_at','is_required','metadata']){
  assert.ok(phase2Migration.includes(`add column if not exists ${column}`), `${column} must be additive`);
}
assert.ok(phase2Migration.includes("signature_status text not null default 'uploaded'"));
assert.ok(phase2Migration.includes("metadata jsonb not null default '{}'::jsonb"));
assert.ok(phase2Migration.includes("check (signature_status in ('uploaded', 'signed'))"));
assert.ok(phase2Migration.includes('shipmentfiles_shipment_idx'));
assert.ok(phase2Migration.includes('shipmentfiles_document_type_idx'));
assert.ok(phase2Migration.includes('shipmentfiles_signature_status_idx'));
assert.ok(!phase2Migration.includes('update public.shipments'));
assert.ok(!phase2Migration.includes('create policy'));

console.log('Shipment workflow phase 1 and signed phase 2 helpers: passed');
