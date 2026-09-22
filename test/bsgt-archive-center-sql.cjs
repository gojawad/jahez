'use strict';
// مركز الأرشيف — مشغّل اختبارات PostgreSQL حقيقي (العنقود المحلي فقط، لا يمسّ Supabase إطلاقاً).
// يحتاج PostgreSQL محلياً يحمل supabase/1..52 في قاعدة قالب
// (الافتراضي: قاعدة "jahez" على المقبس /var/tmp/jpg منفذ 5499 بالمستخدم postgres):
//   JAHEZ_PG_HOST=/var/tmp/jpg JAHEZ_PG_PORT=5499 JAHEZ_PG_USER=postgres JAHEZ_PG_TEMPLATE=jahez \
//     node test/bsgt-archive-center-sql.cjs
// الخطوات:
//   1) استنساخ القالب ← تطبيق 58 ← تشغيل مجموعة الاختبارات وعدّ النتائج
//   2) إعادة تطبيق 58 على قاعدة مُهاجَرة (create or replace ⇒ يجب أن تنجح بلا أثر)
//   3) Rollback يحذف دوال الهجرة وحدها ويترك كل ما عداها، ثم إعادة تطبيق ناجحة
//   4) تحقّق أن الهجرة لم تُنشئ أي جدول أو عمود أو مفتاح صلاحية جديد
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOST = process.env.JAHEZ_PG_HOST || '/var/tmp/jpg';
const PORT = process.env.JAHEZ_PG_PORT || '5499';
const USER = process.env.JAHEZ_PG_USER || 'postgres';
const TEMPLATE = process.env.JAHEZ_PG_TEMPLATE || 'jahez';
const ROOT = path.join(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase', '58_bsgt_archive_center.sql');
const MIGRATION60 = path.join(ROOT, 'supabase', '60_bsgt_archive_center_preview.sql');
const SUITE = path.join(__dirname, 'bsgt-archive-center.test.sql');
const SUITE60 = path.join(__dirname, 'bsgt-archive-center-preview.test.sql');
const stamp = Date.now().toString(36);
const DB1 = `jahez_ac_${stamp}_a`, DB2 = `jahez_ac_${stamp}_b`;

const OWN_FUNCTIONS = [
  'can_view_bsgt_archive_center',
  'bsgt_archive_center_summary',
  'list_bsgt_archived_shipments',
  'list_bsgt_archived_trade_files',
  'list_bsgt_archived_documents'
];

function psql(db, args, {allowFail = false} = {}) {
  const result = spawnSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], {encoding: 'utf8'});
  if (result.status !== 0 && !allowFail) throw new Error(`psql failed (${db}): ${result.stderr || result.stdout}`);
  return result;
}
const scalar = (db, sql) => psql(db, ['-Atc', sql]).stdout.trim();

// يستخرج كتلة الـ Rollback المعلّقة في نهاية الهجرة
function rollbackScript() {
  const text = fs.readFileSync(MIGRATION, 'utf8');
  const start = text.indexOf('-- 7) Rollback');
  assert.ok(start > 0, 'rollback block present');
  return text.slice(start).split('\n')
    .filter(line => line.startsWith('-- '))
    .map(line => line.slice(3))
    .filter(line => !/^-{3,}/.test(line) && !/^7\) Rollback/.test(line) && !/^\(/.test(line))
    .join('\n');
}

const ownFunctionCount = db => scalar(db,
  `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in (${OWN_FUNCTIONS.map(name => `'${name}'`).join(',')})`);

const probe = spawnSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', TEMPLATE, '-Atc',
  'select count(*) from public.trade_collection_file_documents'], {encoding: 'utf8'});
if (probe.status !== 0) {
  console.error(`Local PostgreSQL template "${TEMPLATE}" is not reachable on ${HOST}:${PORT}. Start the local cluster with migrations 1..52 applied first.\n${probe.stderr}`);
  process.exit(2);
}

const created = [];
function createDb(name) { psql(TEMPLATE, ['-c', `create database ${name} template ${TEMPLATE}`]); created.push(name); }
function summary(db) {
  return psql(db, ['-Atc', "select ok, name, coalesce(detail,'') from act.results order by n"]).stdout.trim()
    .split('\n').filter(Boolean)
    .map(line => { const [ok, name, detail] = line.split('|'); return {ok: ok === 't', name, detail}; });
}

// لقطة بنيوية: الجداول والأعمدة ومفاتيح الصلاحيات — الهجرة يجب ألا تغيّر أياً منها
const shape = db => [
  scalar(db, "select count(*) from pg_tables where schemaname = 'public'"),
  scalar(db, "select count(*) from information_schema.columns where table_schema = 'public'"),
  scalar(db, 'select count(*) from public.feature_permission_catalog')
].join('|');

try {
  // ---- 1) الهجرة + مجموعة الاختبارات
  createDb(DB1);
  const before = shape(DB1);
  psql(DB1, ['-f', MIGRATION]);
  assert.equal(ownFunctionCount(DB1), String(OWN_FUNCTIONS.length), 'all five functions created');
  assert.equal(shape(DB1), before, 'no table, column or permission key added by the migration');
  console.log('migration 58: five read-only functions, no schema or permission change (ok)');

  psql(DB1, ['-f', SUITE]);
  const rows = summary(DB1);
  const failed = rows.filter(row => !row.ok);
  console.log(`SQL suite: ${rows.length - failed.length}/${rows.length} checks passed`);
  for (const row of failed) console.log(`  FAIL ${row.name}: ${row.detail}`);

  // ---- 1ب) هجرة المعاينة 60 + مجموعتها
  const shapeBefore60 = shape(DB1);
  psql(DB1, ['-f', MIGRATION60]);
  assert.equal(shape(DB1), shapeBefore60, 'migration 60 adds no table, column or permission key');
  psql(DB1, ['-f', SUITE60]);
  const rows60 = psql(DB1, ['-Atc', "select ok, name, coalesce(detail,'') from acp.results order by n"]).stdout.trim()
    .split('\n').filter(Boolean)
    .map(line => { const [ok, name, detail] = line.split('|'); return {ok: ok === 't', name, detail}; });
  const failed60 = rows60.filter(row => !row.ok);
  console.log(`preview suite: ${rows60.length - failed60.length}/${rows60.length} checks passed`);
  for (const row of failed60) console.log(`  FAIL ${row.name}: ${row.detail}`);

  // ---- 2) إعادة التطبيق على قاعدة مُهاجَرة: create or replace ⇒ تنجح بلا تغيير
  const rerunShape = shape(DB1);
  psql(DB1, ['-f', MIGRATION]);
  assert.equal(ownFunctionCount(DB1), String(OWN_FUNCTIONS.length), 're-apply keeps exactly five functions');
  assert.equal(shape(DB1), rerunShape, 're-apply changes nothing');
  console.log('re-apply on a migrated database: idempotent (ok)');

  // ---- 3) Rollback ثم إعادة التطبيق
  createDb(DB2);
  // دالة مشابهة الاسم موجودة مسبقاً وليست من هذه الهجرة: يجب أن يتركها الـ Rollback
  psql(DB2, ['-c', "create function public.list_bsgt_archived_legacy() returns integer language sql as 'select 1'"]);
  const db2Before = shape(DB2);
  psql(DB2, ['-f', MIGRATION]);
  psql(DB2, ['-c', rollbackScript()]);
  assert.equal(ownFunctionCount(DB2), '0', 'own functions dropped by rollback');
  assert.equal(scalar(DB2, "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'list_bsgt_archived_legacy'"), '1', 'unrelated look-alike function kept');
  assert.equal(scalar(DB2, "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_bsgt_archive'"), '1', 'existing archive RPC untouched by rollback');
  assert.equal(shape(DB2), db2Before, 'rollback leaves tables, columns and permission keys as they were');
  psql(DB2, ['-f', MIGRATION]);
  assert.equal(ownFunctionCount(DB2), String(OWN_FUNCTIONS.length), 're-applied after rollback');
  console.log('rollback: own functions removed, everything else kept, re-apply succeeded (ok)');

  if (failed.length || failed60.length) { process.exitCode = 1; console.log('BSGT archive center SQL: FAILED'); }
  else console.log('BSGT archive center SQL: passed');
} finally {
  if (!process.env.KEEP_TEST_DBS) for (const db of created) psql(TEMPLATE, ['-c', `drop database if exists ${db}`], {allowFail: true});
  else console.log('kept databases:', created.join(', '));
}
