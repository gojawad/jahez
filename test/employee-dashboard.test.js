'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const portalAccess = require('../portal-access');

const root = path.join(__dirname, '..');
const appHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dashboardCss = fs.readFileSync(path.join(root, 'employee-dashboard.css'), 'utf8');
const importPermit = fs.readFileSync(path.join(root, 'import-permit.js'), 'utf8');
const collectionHtml = fs.readFileSync(path.join(root, 'experiments', 'bs-collection', 'index.html'), 'utf8');
const collectionJs = fs.readFileSync(path.join(root, 'experiments', 'bs-collection', 'collection-lab.js'), 'utf8');
const bsgtSql = fs.readFileSync(path.join(root, 'supabase', '24_مستخدم_بوابة_BSGT.sql'), 'utf8');
const portalSql = fs.readFileSync(path.join(root, 'supabase', '36_user_portal_permissions.sql'), 'utf8');
const dashboardRenderer = appHtml.slice(appHtml.indexOf('function renderTargetDashboard(){'), appHtml.indexOf('function renderDashboard(){'));

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`✔ ${name}`);
}

const profile = role => ({id:`${role}-1`, role, active:true});

check('authenticated employees start from the dashboard fallback', () => {
  assert.ok(appHtml.includes("const fallback = 'dashboard';"));
  assert.ok(!appHtml.includes("const fallback = isStaffRole() ? 'tasks' : 'dashboard';"));
});

check('dashboard greeting uses the current profile display name', () => {
  assert.ok(appHtml.includes("displayName: prof.display_name || (prof.email||'').split('@')[0]"));
  assert.ok(appHtml.includes('escapeHtml(currentUser.displayName||currentUser.username)'));
});

check('dashboard displays the current photo when present', () => {
  assert.ok(appHtml.includes('photo: prof.photo_url ||'));
  assert.ok(appHtml.includes('db-employee-avatar'));
  assert.ok(appHtml.includes('${avatarHtml(currentUser)}'));
});

check('enterprise dashboard uses the durable local logistics hero and live widgets', () => {
  assert.ok(appHtml.includes('employee-dashboard.css?v=20260912-enterprise-2'));
  assert.ok(dashboardRenderer.includes('src="jahez-login-bsgt.png"'));
  assert.ok(dashboardRenderer.includes('الشركات الأكثر نشاطاً'));
  assert.ok(dashboardRenderer.includes('const total = records.length;'));
});

check('enterprise dashboard does not introduce ratings or invented comparison trends', () => {
  assert.ok(!dashboardRenderer.includes('db-stars'));
  assert.ok(!dashboardRenderer.includes('تقييم'));
  assert.ok(!dashboardRenderer.includes('مقارنة بالشهر الماضي'));
  assert.ok(!dashboardRenderer.includes('أداء الفريق'));
});

check('enterprise dashboard remains isolated and responsive', () => {
  assert.ok(dashboardCss.includes('body:has(#viewDashboard.active)'));
  assert.ok(dashboardCss.includes('@media (max-width: 1080px)'));
  assert.ok(dashboardCss.includes('grid-template-columns: repeat(4, minmax(0, 1fr))'));
  assert.ok(dashboardCss.includes('transform: translateX(100%) !important'));
});

check('bsgt_user gets only the commercial collection shortcut', () => {
  const permissions = {portalKeys:['commercial_collection']};
  assert.deepStrictEqual(portalAccess.resolveUserPortals(profile('bsgt_user'), permissions).map(item => item.key), ['commercial_collection']);
  assert.strictEqual(portalAccess.resolveUserPortal(profile('bsgt_user'), permissions).label, 'بوابة التحصيل التجاري');
});

check('non-BSGT roles do not receive the collection shortcut', () => {
  for (const role of ['editor', 'staff', 'viewer']) {
    assert.ok(!portalAccess.resolveUserPortals(profile(role)).some(item => item.key === 'commercial_collection'));
  }
});

check('admin retains all currently authorized portal shortcuts', () => {
  assert.deepStrictEqual(portalAccess.resolveUserPortals(profile('admin')).map(item => item.key), ['commercial_collection', 'import_permit']);
});

check('an employee without an assigned portal safely receives no shortcut', () => {
  assert.deepStrictEqual(portalAccess.resolveUserPortals(profile('viewer')), []);
  assert.strictEqual(portalAccess.resolveUserPortal({role:'unknown', active:true}), null);
});

check('inactive profiles cannot resolve or directly access portals', () => {
  const inactive = {role:'admin', active:false};
  assert.deepStrictEqual(portalAccess.resolveUserPortals(inactive), []);
  assert.strictEqual(portalAccess.canAccessPortal('commercial_collection', inactive), false);
});

check('direct commercial collection access is role guarded', () => {
  assert.strictEqual(portalAccess.canAccessPortal('commercial_collection', profile('bsgt_user'), {portalKeys:['commercial_collection']}), true);
  assert.strictEqual(portalAccess.canAccessPortal('commercial_collection', profile('bsgt_user'), {portalKeys:[]}), false);
  assert.strictEqual(portalAccess.canAccessPortal('commercial_collection', profile('editor'), {portalKeys:['commercial_collection']}), true);
  assert.ok(collectionJs.includes("canAccessPortal('commercial_collection',portalContext.profile,portalContext.permissions)"));
  assert.ok(collectionJs.includes("window.location.replace('/#v=dashboard')"));
});

check('direct import permit access uses the same central resolver', () => {
  assert.ok(importPermit.includes("window.JahezAccess.canAccessPortal('import_permit')"));
  assert.ok(importPermit.includes('denyStandalonePortalAccess()'));
  assert.strictEqual(portalAccess.canAccessPortal('import_permit', profile('viewer')), false);
});

check('dashboard statistics remain scoped by the current Supabase session and RLS', () => {
  assert.match(appHtml, /sb\.from\('shipments'\)\s*\.select\('\*'\)\.order\('updated_at'/);
  assert.ok(appHtml.includes('const total = records.length;'));
  assert.ok(bsgtSql.includes("public.is_bsgt_user() and company_id = public.bsgt_company_id()"));
  assert.ok(!appHtml.includes('SUPABASE_SERVICE_ROLE_KEY'));
});

check('viewer receives no new write permission', () => {
  assert.ok(appHtml.includes("function isEditor(){ return currentUser && ['admin','editor','staff'].includes(currentUser.role); }"));
  assert.ok(appHtml.includes("viewer: Object.freeze(['dashboard','records','operationCenter','bsgt','bsgtWorkspace','activityLog','clientProfiles','sea','issued','drafts'])"));
  assert.strictEqual(require('../client-company-profiles').canManage('viewer'), false);
  assert.ok(!portalAccess.resolveUserPortals(profile('viewer')).length);
});

check('portal navigation stays hidden until profile permissions are known', () => {
  assert.ok(appHtml.includes('id="employeeTopNav" aria-label="تنقل الموظف" hidden'));
  assert.ok(appHtml.includes('function renderEmployeeNavigation()'));
  assert.ok(collectionHtml.includes('portal-access-loading'));
  assert.ok(collectionHtml.indexOf('portal-access.js') < collectionHtml.indexOf('collection-lab.js'));
});

check('refresh routes are preserved while unauthorized routes return to dashboard', () => {
  assert.ok(appHtml.includes("window.addEventListener('hashchange', restoreFromHash)"));
  assert.ok(appHtml.includes('if(!canAccessAppView(v)){ v=\'dashboard\'; accessDenied=true; }'));
  assert.ok(appHtml.includes("toast('ليس لديك صلاحية للوصول إلى هذه البوابة.', 'err')"));
  assert.ok(collectionJs.includes('rememberPortalLocation()'));
});

check('portal assignments are persisted with RLS and a compatibility backfill', () => {
  assert.ok(portalSql.includes('create table if not exists public.user_portal_permissions'));
  assert.ok(portalSql.includes('public.is_admin() or user_id = auth.uid()'));
  assert.ok(portalSql.includes("where role in ('editor', 'staff') and active"));
  assert.ok(portalSql.includes("where role = 'bsgt_user' and active"));
});

assert.ok(checks >= 17);
console.log(`\n${checks} employee dashboard checks passed`);
