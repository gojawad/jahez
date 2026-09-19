'use strict';
// BSGT Financial Center phase 1 — real PostgreSQL test runner (local cluster only).
// Requires a local PostgreSQL that already carries supabase/1..52 in a template database
// (default: db "jahez" on socket /var/tmp/jpg port 5499, user postgres). Never touches Supabase.
//   JAHEZ_PG_HOST=/var/tmp/jpg JAHEZ_PG_PORT=5499 JAHEZ_PG_USER=postgres JAHEZ_PG_TEMPLATE=jahez node test/bsgt-financial-center-sql.cjs
// Steps: 1) clone template -> apply 53 -> run the SQL suite and count results
//        2) second clone -> pre-existing legacy index -> apply -> rollback -> legacy index kept, objects gone -> re-apply on the now-clean db
//        3) re-running the migration on a migrated db must refuse (partial-schema guard)
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOST = process.env.JAHEZ_PG_HOST || '/var/tmp/jpg';
const PORT = process.env.JAHEZ_PG_PORT || '5499';
const USER = process.env.JAHEZ_PG_USER || 'postgres';
const TEMPLATE = process.env.JAHEZ_PG_TEMPLATE || 'jahez';
const ROOT = path.join(__dirname, '..');
const MIGRATION = path.join(ROOT, 'supabase', '53_bsgt_financial_center_phase1.sql');
const SUITE = path.join(__dirname, 'bsgt-financial-center.test.sql');
const stamp = Date.now().toString(36);
const DB1 = `jahez_fc_${stamp}_a`, DB2 = `jahez_fc_${stamp}_b`;

function psql(db, args, {allowFail = false} = {}) {
  const result = spawnSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], {encoding: 'utf8'});
  if (result.status !== 0 && !allowFail) throw new Error(`psql failed (${db}): ${result.stderr || result.stdout}`);
  return result;
}
const scalar = (db, sql) => psql(db, ['-Atc', sql]).stdout.trim();

function rollbackScript() {
  const text = fs.readFileSync(MIGRATION, 'utf8');
  const start = text.indexOf('-- ===== 9) Rollback');
  assert.ok(start > 0, 'rollback block present');
  return text.slice(start).split('\n').filter(line => line.startsWith('-- ')).map(line => line.slice(3))
    .filter(line => !/^=====/.test(line)).join('\n');
}

const probe = spawnSync('psql', ['-h', HOST, '-p', PORT, '-U', USER, '-d', TEMPLATE, '-Atc', "select count(*) from public.feature_permission_catalog"], {encoding: 'utf8'});
if (probe.status !== 0) {
  console.error(`Local PostgreSQL template "${TEMPLATE}" is not reachable on ${HOST}:${PORT}. Start the local cluster with migrations 1..52 applied first.\n${probe.stderr}`);
  process.exit(2);
}

const created = [];
function createDb(name) { psql(TEMPLATE, ['-c', `create database ${name} template ${TEMPLATE}`]); created.push(name); }
function summary(db) {
  const rows = psql(db, ['-Atc', "select ok, name, coalesce(detail,'') from fct.results order by n"]).stdout.trim().split('\n').filter(Boolean)
    .map(line => { const [ok, name, detail] = line.split('|'); return {ok: ok === 't', name, detail}; });
  return rows;
}

try {
  // ---- 1) migration + suite
  createDb(DB1);
  psql(DB1, ['-f', MIGRATION]);
  const objects = scalar(DB1, "select count(*) from pg_tables where schemaname='public' and tablename like 'bsgt_financial_file%'");
  assert.equal(objects, '3', 'three tables created');
  psql(DB1, ['-f', SUITE]);
  const rows = summary(DB1);
  const failed = rows.filter(row => !row.ok);
  console.log(`SQL suite: ${rows.length - failed.length}/${rows.length} checks passed`);
  for (const row of failed) console.log(`  FAIL ${row.name}: ${row.detail}`);
  // ---- 3) guard: re-running on a migrated database must refuse before touching anything
  const rerun = psql(DB1, ['-f', MIGRATION], {allowFail: true});
  assert.notEqual(rerun.status, 0, 'second run refused');
  assert.match(rerun.stderr, /already exists — refusing to run/);
  console.log('partial-schema guard: refuses to re-run (ok)');

  // ---- 2) rollback ownership + re-apply
  createDb(DB2);
  psql(DB2, ['-c', 'create index tcf_operation_no_prefix_idx on public.trade_collection_files (operation_no text_pattern_ops)']); // pre-existing, not ours
  psql(DB2, ['-f', MIGRATION]);
  psql(DB2, ['-c', rollbackScript()]);
  assert.equal(scalar(DB2, "select count(*) from pg_indexes where indexname='tcf_operation_no_prefix_idx'"), '1', 'legacy index kept by rollback');
  assert.equal(scalar(DB2, "select count(*) from pg_indexes where indexname='bff_m53_tcf_operation_no_prefix_idx'"), '0', 'own index dropped');
  assert.equal(scalar(DB2, "select count(*) from pg_tables where schemaname='public' and tablename like 'bsgt_financial_file%'"), '0', 'tables dropped');
  assert.equal(scalar(DB2, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'bsgt_financial%' or p.proname like '%bsgt_financial_%')"), '0', 'functions dropped');
  assert.equal(scalar(DB2, "select count(*) from public.feature_permission_catalog where permission_key like 'bsgt.financial_center.%'"), '0', 'catalog keys removed');
  assert.equal(scalar(DB2, "select count(*) from public.trade_collection_files"), scalar(TEMPLATE, "select count(*) from public.trade_collection_files"), 'existing tables untouched');
  psql(DB2, ['-f', MIGRATION]);   // re-apply on the rolled-back database
  assert.equal(scalar(DB2, "select count(*) from pg_tables where schemaname='public' and tablename like 'bsgt_financial_file%'"), '3', 're-applied after rollback');
  console.log('rollback: legacy index kept, own objects removed, re-apply succeeded (ok)');

  if (failed.length) { process.exitCode = 1; console.log('BSGT financial center SQL: FAILED'); }
  else console.log('BSGT financial center SQL: passed');
} finally {
  if (!process.env.KEEP_TEST_DBS) for (const db of created) psql(TEMPLATE, ['-c', `drop database if exists ${db}`], {allowFail: true});
  else console.log('kept databases:', created.join(', '));
}
