'use strict';
// BSGT Financial Center phase 2a (ledger foundation) — real PostgreSQL test runner (local cluster only).
// Requires a local PostgreSQL that already carries supabase/1..52 in a template database
// (default: db "jahez" on socket /var/tmp/jpg port 5499, user postgres). Never touches Supabase.
//   node test/bsgt-financial-ledger-sql.cjs
// Steps: 1) clone template -> apply 53 + 54 -> run the SQL suite and count results
//        2) concurrency: two sessions post the same draft / the same file at once (lock timeout, then "already posted")
//        3) re-running 54 on a migrated database must refuse (partial-schema guard)
//        4) second clone -> apply -> rollback -> phase-1 objects intact, phase-2a objects gone -> re-apply
const {spawnSync, spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOST = process.env.JAHEZ_PG_HOST || '/var/tmp/jpg';
const PORT = process.env.JAHEZ_PG_PORT || '5499';
const USER = process.env.JAHEZ_PG_USER || 'postgres';
const TEMPLATE = process.env.JAHEZ_PG_TEMPLATE || 'jahez';
const ROOT = path.join(__dirname, '..');
const M53 = path.join(ROOT, 'supabase', '53_bsgt_financial_center_phase1.sql');
const M54 = path.join(ROOT, 'supabase', '54_bsgt_financial_ledger_phase2a.sql');
const M55 = path.join(ROOT, 'supabase', '55_bsgt_financial_ledger_wiring.sql');
const SUITE = path.join(__dirname, 'bsgt-financial-ledger.test.sql');
const SUITE55 = path.join(__dirname, 'bsgt-financial-ledger-wiring.test.sql');
const stamp = Date.now().toString(36);
const DB1 = `jahez_fl_${stamp}_a`, DB2 = `jahez_fl_${stamp}_b`;
const BASE = ['-h', HOST, '-p', PORT, '-U', USER, '-X', '-q'];

function psql(db, args, {allowFail = false} = {}) {
  const result = spawnSync('psql', [...BASE, '-d', db, '-v', 'ON_ERROR_STOP=1', ...args], {encoding: 'utf8'});
  if (result.status !== 0 && !allowFail) throw new Error(`psql failed (${db}): ${result.stderr || result.stdout}`);
  return result;
}
const scalar = (db, sql) => psql(db, ['-Atc', sql]).stdout.trim();
function rollbackScript(file = M54, marker = '-- ===== 13) Rollback') {
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf(marker);
  assert.ok(start > 0, 'rollback block present');
  return text.slice(start).split('\n').filter(line => line.startsWith('-- ')).map(line => line.slice(3)).filter(line => !/^=====/.test(line)).join('\n');
}
// Runs a script in its own session (own connection) and resolves with {status, stdout, stderr}.
function session(db, script) {
  return new Promise(resolve => {
    const child = spawn('psql', [...BASE, '-d', db, '-v', 'ON_ERROR_STOP=0'], {stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => resolve({status, stdout, stderr}));
    child.stdin.end(script);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const probe = spawnSync('psql', [...BASE, '-d', TEMPLATE, '-Atc', 'select count(*) from public.feature_permission_catalog'], {encoding: 'utf8'});
if (probe.status !== 0) {
  console.error(`Local PostgreSQL template "${TEMPLATE}" is not reachable on ${HOST}:${PORT}. Start the local cluster with migrations 1..52 applied first.\n${probe.stderr}`);
  process.exit(2);
}
const created = [];
function createDb(name) { psql(TEMPLATE, ['-c', `create database ${name} template ${TEMPLATE}`]); created.push(name); }
function summary(db) {
  return psql(db, ['-Atc', "select ok, name, coalesce(detail,'') from flt.results order by n"]).stdout.trim().split('\n').filter(Boolean)
    .map(line => { const [ok, name, ...rest] = line.split('|'); return {ok: ok === 't', name, detail: rest.join('|')}; });
}

(async () => {
  try {
    // ---- 1) migrations + suite
    createDb(DB1);
    psql(DB1, ['-f', M53]);
    psql(DB1, ['-f', M54]);
    assert.equal(scalar(DB1, "select count(*) from pg_tables where schemaname='public' and tablename like 'fin\\_%'"), '8', 'eight tables created');
    psql(DB1, ['-f', M55]);
    assert.equal(scalar(DB1, 'select public.fin_file_vouchers_enabled()'), 'f', 'file vouchers still disabled after 55');
    psql(DB1, ['-f', SUITE]);
    const rows54 = summary(DB1);
    console.log(`SQL suite 54 (ledger foundation): ${rows54.filter(r => r.ok).length}/${rows54.length} checks passed`);
    psql(DB1, ['-f', SUITE55]);
    const rows = summary(DB1);
    const rows55 = rows.slice(rows54.length);
    console.log(`SQL suite 55 (transition wiring): ${rows55.filter(r => r.ok).length}/${rows55.length} checks passed`);
    const failed = rows.filter(row => !row.ok);
    for (const row of failed) console.log(`  FAIL ${row.name}: ${row.detail}`);

    // ---- 2) concurrency: same draft posted by two sessions; same file receives two posts at once
    const FM = "select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a3',false); set role authenticated;";
    const ACC = "select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a2',false); set role authenticated;";
    const cash = scalar(DB1, "select id from public.fin_accounts where code='1101' and company_id = public.bsgt_company_id()");
    const f8 = scalar(DB1, "select v from flt.ctx where k='f8'");
    // two receipts drafted by the accountant on the same file
    const mkDraft = amt => `select public.create_fin_voucher('{"voucher_type":"receipt","amount":"${amt}","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"${cash}","financial_file_id":"${f8}"}')->>'voucher_id';`;
    const drafts = psql(DB1, ['-Atc', `${ACC} ${mkDraft('7')} ${mkDraft('8')}`]).stdout.trim().split('\n');
    const [vA, vB] = drafts.slice(-2);
    // Session A posts vA and holds the transaction (file + voucher locks) for 2.5s; session B tries vA (same draft) then vB (same file) with a lock timeout.
    const a = session(DB1, `${FM} begin; select public.post_fin_voucher('${vA}', 1)->>'lock_version'; select pg_sleep(2.5); commit;`);
    await sleep(700);
    const b = await session(DB1, `${FM} set lock_timeout = '600ms'; select public.post_fin_voucher('${vA}', 1); select public.post_fin_voucher('${vB}', 1);`);
    const ra = await a;
    assert.equal(ra.status, 0, 'session A committed');
    assert.match(b.stderr, /lock timeout|canceling statement due to lock timeout/, 'session B waited on the locks instead of double-posting');
    const afterA = psql(DB1, ['-Atc', `${FM} select public.post_fin_voucher('${vA}', 1);`], {allowFail: true});
    assert.match(afterA.stderr, /version changed|already posted/, 'second post of the same draft refused after A committed');
    const postB = psql(DB1, ['-Atc', `${FM} select public.post_fin_voucher('${vB}', 1)->>'lock_version';`]);
    assert.equal(postB.stdout.trim().split('\n').pop(), '2', 'vB posts normally once the file lock is free');
    assert.equal(scalar(DB1, `select count(*) from public.fin_journal_entries where voucher_id in ('${vA}','${vB}')`), '2', 'exactly one entry per voucher');
    assert.equal(scalar(DB1, "select count(*) from public.fin_journal_entries e where e.total_debit <> (select sum(l.debit) from public.fin_journal_lines l where l.entry_id = e.id) or e.total_credit <> (select sum(l.credit) from public.fin_journal_lines l where l.entry_id = e.id)"), '0', 'every entry balanced after the race');
    // idempotent create under a race: same request_id from two sessions => one voucher
    const req = '00000000-0000-4000-8000-00000000d777';
    const mk = `${ACC} select public.create_fin_voucher('{"request_id":"${req}","voucher_type":"receipt","amount":"9","client_id":"00000000-0000-4000-8000-0000000000c1","cash_account_id":"${cash}"}')->>'voucher_id';`;
    const [r1, r2] = await Promise.all([session(DB1, mk), session(DB1, mk)]);
    assert.equal(r1.status, 0); assert.equal(r2.status, 0);
    assert.equal(scalar(DB1, `select count(*) from public.fin_vouchers where request_id='${req}'`), '1', 'one voucher for a duplicated request_id');
    assert.equal(r1.stdout.trim().split('\n').pop(), r2.stdout.trim().split('\n').pop(), 'both sessions received the same voucher id');
    console.log('concurrency: lock wait + no double post, race-safe idempotent create (ok)');

    // ---- 3) guard: re-running on a migrated database must refuse
    const rerun = psql(DB1, ['-f', M54], {allowFail: true});
    assert.notEqual(rerun.status, 0, 'second run refused');
    assert.match(rerun.stderr, /already exists — refusing to run/);
    const rerun55 = psql(DB1, ['-f', M55], {allowFail: true});
    assert.notEqual(rerun55.status, 0, 'second run of 55 refused');
    assert.match(rerun55.stderr, /Migration 55 objects already exist/);
    const on53only = (() => { createDb(DB2); psql(DB2, ['-f', M53]); return psql(DB2, ['-f', M55], {allowFail: true}); })();
    assert.match(on53only.stderr, /Migration 54 .* must be applied first/, '55 refuses without 54');
    console.log('partial-schema guard: refuses to re-run (ok)');
    // ---- 4) rollback + re-apply (phase-1 untouched); 55 rollback restores the phase-1 transition function byte for byte
    const p1Functions = scalar(DB2, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'bsgt_financial%'");
    const p1Transition = scalar(DB2, "select md5(prosrc) from pg_proc where proname='transition_bsgt_financial_file'");
    psql(DB2, ['-f', M54]);
    const m54PostReverse = scalar(DB2, "select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname in ('post_fin_voucher','reverse_fin_voucher')");
    psql(DB2, ['-f', M55]);
    assert.notEqual(scalar(DB2, "select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname in ('post_fin_voucher','reverse_fin_voucher')"), m54PostReverse, '55 replaced post/reverse');
    assert.notEqual(scalar(DB2, "select md5(prosrc) from pg_proc where proname='transition_bsgt_financial_file'"), p1Transition, '55 replaced the transition function');
    psql(DB2, ['-c', rollbackScript(M55, '-- ===== 7) Rollback')]);
    assert.equal(scalar(DB2, "select md5(prosrc) from pg_proc where proname='transition_bsgt_financial_file'"), p1Transition, '55 rollback restored the phase-1 function text');
    assert.equal(scalar(DB2, "select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname in ('post_fin_voucher','reverse_fin_voucher')"), m54PostReverse, '55 rollback restored the 54 post/reverse text');
    assert.equal(scalar(DB2, "select count(*) from information_schema.columns where table_name='fin_file_ledger_state' and column_name like 'refund%'"), '0', '55 columns dropped');
    psql(DB2, ['-c', rollbackScript()]);
    assert.equal(scalar(DB2, "select count(*) from pg_tables where schemaname='public' and tablename like 'fin\\_%'"), '0', 'tables dropped');
    assert.equal(scalar(DB2, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'fin\\_%' or p.proname like '%fin_voucher%' or p.proname like '%fin_account%' or p.proname in ('init_fin_chart','open_fin_file_ledger','confirm_fin_file_delivery'))"), '0', 'functions dropped');
    assert.equal(scalar(DB2, "select count(*) from pg_tables where schemaname='public' and tablename like 'bsgt_financial_file%'"), '3', 'phase-1 tables kept');
    assert.equal(scalar(DB2, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'bsgt_financial%'"), p1Functions, 'phase-1 functions kept');
    assert.equal(scalar(DB2, "select count(*) from public.feature_permission_catalog where permission_key like 'bsgt.financial_center.%'"), '3', 'phase-1 catalog keys kept (2a adds none)');
    psql(DB2, ['-f', M54]);
    assert.equal(scalar(DB2, "select count(*) from pg_tables where schemaname='public' and tablename like 'fin\\_%'"), '8', 're-applied after rollback');
    console.log('rollback: phase-1 intact, phase-2a objects removed, re-apply succeeded (ok)');

    if (failed.length) { process.exitCode = 1; console.log('BSGT financial ledger SQL: FAILED'); }
    else console.log('BSGT financial ledger SQL: passed');
  } catch (err) {
    process.exitCode = 1;
    console.error(err && err.stack || err);
  } finally {
    if (!process.env.KEEP_TEST_DBS) for (const db of created) psql(TEMPLATE, ['-c', `drop database if exists ${db}`], {allowFail: true});
    else console.log('kept databases:', created.join(', '));
  }
})();
