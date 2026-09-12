const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const permissions = require('../permissions');
const portalAccess = require('../portal-access');
const workspace = require('../bsgt-workspace');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', '38_granular_employee_permissions.sql'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const wizard = fs.readFileSync(path.join(__dirname, '..', 'company-wizard.js'), 'utf8');
const clientProfiles = fs.readFileSync(path.join(__dirname, '..', 'client-company-profiles.js'), 'utf8');
const workflowContext = {window:{}, Date};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'shipment-workflow.js'), 'utf8'), workflowContext);
const workflow = workflowContext.window.JahezShipmentWorkflow;

function context(profile, rows = [], portalKeys = [], workspaceRows = []) {
  return permissions.createContext({profile, rows, portalKeys, workspaceRows});
}
const staff = {id:'staff', role:'staff', active:true};
const admin = {id:'admin', role:'admin', active:true};
const allow = (...keys) => keys.map(permission_key => ({permission_key, allowed:true}));

const tests = [
  ['admin has every permission without rows', () => assert.equal(context(admin).allowedKeys().length, permissions.ALL_KEYS.length)],
  ['admin cannot be restricted by false rows', () => assert.equal(context(admin, [{permission_key:'package.merge',allowed:false}]).can('package.merge'), true)],
  ['staff without assignments has no optional features', () => assert.deepEqual(context(staff).allowedKeys(), [])],
  ['import permit assignment permits portal', () => assert.equal(portalAccess.canAccessPortal('import_permit', staff, {featureKeys:['import_permit.view']}), true)],
  ['missing import permit assignment denies portal', () => assert.equal(portalAccess.canAccessPortal('import_permit', staff, {featureKeys:[]}), false)],
  ['operations view resolves workspace section', () => assert.equal(workspace.permissionFor('operations', staff, [], {featureKeys:['bsgt.operations.view']}).canView, true)],
  ['operations edit permits actions', () => assert.equal(workspace.permissionFor('operations', staff, [], {featureKeys:['bsgt.operations.view','bsgt.operations.edit']}).canEdit, true)],
  ['operations view-only cannot edit', () => assert.equal(workspace.permissionFor('operations', staff, [], {featureKeys:['bsgt.operations.view']}).canEdit, false)],
  ['BSGT operation-center key is registered', () => {
    assert.equal(permissions.ALL_KEYS.includes('bsgt.operation_center.view'), true);
    assert.match(index, /can\('bsgt\.operation_center\.view'\)/);
  }],
  ['finance view and edit are separate', () => assert.deepEqual(context(staff, allow('bsgt.finance.view')).allowedKeys(), ['bsgt.finance.view'])],
  ['management view and edit are separate', () => assert.equal(context(staff, allow('bsgt.management.view')).can('bsgt.management.edit'), false)],
  ['relations view and edit are separate', () => assert.equal(context(staff, allow('bsgt.relations.view')).can('bsgt.relations.edit'), false)],
  ['document delete is wired to UI', () => assert.match(index, /can\('shipment_documents\.delete'\)/)],
  ['document delete retains workflow draft gate', () => assert.match(migration, /bsgt_stage = 'operations_draft'[\s\S]+shipment_documents\.delete/)],
  ['package permission does not bypass merge gate', () => {
    assert.equal(context(admin).can('package.merge') && workflow.canMergeShipmentPackage({workflowStage:'created'}, []), false);
  }],
  ['contract editor permission is enforced', () => assert.match(wizard, /can\('contracts\.edit'\)/)],
  ['client assets permission is enforced', () => assert.match(wizard, /can\('client_assets\.use'\)/)],
  ['client profile view and edit are enforced', () => {
    assert.match(clientProfiles, /can\('client_profiles\.view'\)/);
    assert.match(clientProfiles, /can\('client_profiles\.edit'\)/);
  }],
  ['edit permission automatically enables view', () => assert.deepEqual(permissions.normalizeKeys(['bsgt.finance.edit']), ['bsgt.finance.view','bsgt.finance.edit'])],
  ['batch-save RPC exists', () => assert.match(migration, /function public\.set_user_feature_permissions\(/)],
  ['ordinary user cannot edit permissions', () => assert.match(migration, /if not public\.is_admin\(\) then raise exception 'Admin permission is required'/)],
  ['admin can assign permissions through RPC policy', () => assert.match(migration, /user_feature_permissions_admin_update[\s\S]+public\.is_admin\(\)/)],
  ['backfill preserves current access', () => assert.match(migration, /Preserve all current portal access[\s\S]+Preserve all current BSGT workspace access/)],
  ['legacy portal permissions remain compatible', () => assert.deepEqual(context(staff, [], ['import_permit']).allowedKeys(), ['import_permit.view'])],
  ['legacy BSGT permissions remain compatible', () => {
    const rows = [{section:'finance',can_view:true,can_edit:true}];
    assert.deepEqual(context(staff, [], [], rows).allowedKeys(), ['bsgt.finance.view','bsgt.finance.edit']);
    assert.deepEqual(context({id:'viewer',role:'viewer',active:true}, [], [], rows).allowedKeys(), ['bsgt.finance.view']);
    assert.equal(context(staff, [], [], [{section:'operations',can_view:true,can_edit:false}]).can('bsgt.operation_center.view'), true);
  }]
];

for (const [name, test] of tests) {
  test();
  console.log(`PASS ${name}`);
}
console.log(`Permission tests passed: ${tests.length}`);
