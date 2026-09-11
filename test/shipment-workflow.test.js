'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'shipment-workflow.js'), 'utf8');
const context = {window:{}};
vm.runInNewContext(source, context, {filename:'shipment-workflow.js'});

const workflow = context.window.JahezShipmentWorkflow;
assert.deepStrictEqual(Array.from(workflow.STAGES), ['created', 'bank_sent', 'signed', 'accepted']);
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
  JSON.parse(JSON.stringify(workflow.toRow({workflowStage:'created',acceptedAt:'',acceptedBy:''}))),
  {workflow_stage:'created',accepted_at:null,accepted_by:null}
);

const migration = fs.readFileSync(path.join(root, 'supabase', '27_shipment_workflow_phase1.sql'), 'utf8');
for(const column of ['workflow_stage','workflow_updated_at','bank_sent_at','signed_at','accepted_at','accepted_by']){
  assert.ok(migration.includes(`add column if not exists ${column}`), `${column} must be additive`);
}
assert.ok(migration.includes("check (workflow_stage in ('created', 'bank_sent', 'signed', 'accepted'))"));
assert.ok(migration.includes("lower(coalesce(data->>'collectionStatus', '')) = 'sent'"));
assert.ok(migration.includes("data->>'collectionSentAt'"));
assert.ok(migration.includes("where workflow_stage = 'created'"));
assert.ok(!migration.includes('update public.shipments set status'));

console.log('Shipment workflow phase 1 helpers and migration: passed');
