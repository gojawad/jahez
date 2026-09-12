'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workspace = require('../bsgt-workspace');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase', '30_bsgt_workspace_phase1.sql'), 'utf8');

const admin = {id:'admin-1', role:'admin', active:true};
const editor = {id:'editor-1', role:'editor', active:true};
const viewer = {id:'viewer-1', role:'viewer', active:true};
const financeOnly = [{section:'finance', can_view:true, can_edit:true}];

assert.deepStrictEqual(workspace.SECTION_KEYS, ['operations', 'finance', 'management', 'relations']);
assert.deepStrictEqual(workspace.allowedSections(admin, []).map(item=>item.key), workspace.SECTION_KEYS);
assert.deepStrictEqual(workspace.allowedSections(editor, financeOnly).map(item=>item.key), ['finance']);
assert.strictEqual(workspace.permissionFor('finance', editor, financeOnly).canEdit, true);
assert.strictEqual(workspace.permissionFor('finance', viewer, financeOnly).canEdit, false);
assert.strictEqual(workspace.resolveSection('operations', editor, financeOnly), 'finance');
assert.strictEqual(workspace.resolveSection('finance', editor, financeOnly), 'finance');
assert.strictEqual(workspace.resolveSection('operations', editor, []), null);
assert.strictEqual(workspace.resolveBsgtCompanyId([
  {id:'other', name_ar:'شركة أخرى'},
  {id:'bsgt', name_en:'Bahar Swaken General Trading LLC'}
]), 'bsgt');

assert.ok(html.includes('data-view="bsgtWorkspace" id="navBsgt"'));
assert.ok(html.includes('>مساحة BSGT</button>'));
assert.ok(!html.includes('id="navBsgt" data-ic="ship">شحنات BSGT</button>'));
assert.ok(html.includes('id="viewBsgtWorkspace"'));
assert.ok(html.includes("section: p.get('section')"));
assert.ok(html.includes("bsgtWorkspace:'مساحة BSGT'"));
for(const text of [
  'سيتم هنا إدارة شحنات BSGT ومرحلة تجهيز المستندات.',
  'سيتم هنا إنشاء وإدارة ملفات العمليات التجارية والإرسال للبنك.',
  'سيتم هنا مراجعة المستندات والتوقيع والقبول النهائي.',
  'سيتم هنا استكمال المرفقات والإرسال للبنك المحصل.'
]) assert.ok(fs.readFileSync(path.join(root, 'bsgt-workspace.js'), 'utf8').includes(text));

for(const table of ['bsgt_workspace_permissions', 'trade_collection_files', 'trade_collection_file_shipments']){
  assert.ok(migration.includes(`create table if not exists public.${table}`));
  assert.ok(migration.includes(`alter table public.${table} enable row level security`));
}
assert.ok(migration.includes("check (section in ('operations', 'finance', 'management', 'relations'))"));
assert.ok(migration.includes("check (operation_no ~ '^TC-[0-9]{4}-[0-9]{6}$')"));
assert.ok(migration.includes('constraint trade_collection_files_operation_no_key unique (operation_no)'));
assert.ok(migration.includes('constraint trade_collection_file_shipments_unique unique (trade_file_id, shipment_id)'));
assert.ok(migration.includes('Only BSGT shipments can be linked to BSGT trade collection files'));
for(const status of ['draft','sent_to_remitting','under_management_review','final_accepted','sent_to_collecting']){
  assert.ok(migration.includes(`'${status}'`));
}
assert.ok(migration.includes("public.has_bsgt_workspace_permission('finance', false)"));
assert.ok(migration.includes("public.has_bsgt_workspace_permission('finance', true)"));
assert.ok(!migration.includes('update public.shipments set'));
assert.ok(!migration.includes('commercialCollectionOperations'));
assert.ok(!migration.includes('collectionBatchId'));
assert.ok(!migration.includes('collectionOperationNo'));

console.log('BSGT workspace Phase 1 helpers and migration: passed');
