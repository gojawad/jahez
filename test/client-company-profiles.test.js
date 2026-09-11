'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const profiles = require('../client-company-profiles');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'client-company-profiles.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'client-company-profiles.css'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '29_client_company_profiles.sql'), 'utf8');

let checks = 0;
function check(name, fn){ fn(); checks += 1; console.log(`✔ ${name}`); }

check('existing clients remain the profile source of truth', () => {
  assert.match(js, /sb\.from\('clients'\)\.select/);
  assert.ok(sql.includes('alter table public.clients'));
  assert.ok(!sql.includes('create table if not exists public.clients'));
});

check('profile data is additive and preserves existing client IDs', () => {
  for(const column of ['name_ar','name_en','email','address','country','trade_license_no','tax_registration_no','website','updated_at']){
    assert.ok(sql.includes(`add column if not exists ${column}`));
  }
  assert.ok(!/update\s+public\.clients\s+set\s+id/i.test(sql));
  assert.ok(!/insert\s+into\s+public\.clients/i.test(sql));
});

check('ledger and shipment records are not changed by the migration', () => {
  assert.ok(!/alter table public\.ledger_entries/i.test(sql));
  assert.ok(!/alter table public\.shipments/i.test(sql));
  assert.ok(!/alter table public\.shipment_files/i.test(sql));
});

check('client files and shipment files remain separate', () => {
  assert.ok(sql.includes('public.client_profile_files'));
  assert.ok(js.includes("const BUCKET = 'client-profile-files'"));
  assert.ok(!js.includes("storage.from('shipment-files')"));
});

check('operating companies are not used by the feature', () => {
  assert.ok(!/public\.companies|from\('companies'\)/.test(sql + js));
});

check('the bucket is private and constrained to safe file types and size', () => {
  assert.match(sql, /'client-profile-files',\s*'client-profile-files',\s*false/);
  assert.ok(sql.includes('15728640'));
  for(const mime of profiles.ALLOWED_MIME) assert.ok(sql.includes(`'${mime}'`));
  assert.strictEqual((sql.match(/storage\.foldername\(storage\.objects\.name\)/g) || []).length, 2);
});

check('file types use the requested central mapping', () => {
  assert.deepStrictEqual(Object.keys(profiles.FILE_TYPES), [
    'logo','letterhead','stamp','signature','trade_license',
    'registration_certificate','tax_certificate','bank_document','other'
  ]);
});

check('stamp and signature management is limited to admin and editor', () => {
  assert.strictEqual(profiles.canManage('admin'), true);
  assert.strictEqual(profiles.canManage('editor'), true);
  assert.strictEqual(profiles.canManage('staff'), false);
  assert.strictEqual(profiles.canManage('viewer'), false);
  assert.strictEqual(profiles.canArchive('admin'), true);
  assert.strictEqual(profiles.canArchive('editor'), false);
  assert.strictEqual(profiles.canAccessFile('staff'), false);
  assert.strictEqual(profiles.canAccessFile('viewer'), true);
  assert.match(sql, /my_role\(\) in \('admin','editor'\)/);
});

check('all requested read roles can open a profile', () => {
  for(const role of ['admin','editor','staff','viewer']) assert.strictEqual(profiles.canRead(role), true);
  assert.strictEqual(profiles.canRead('bsgt_user'), false);
});

check('signatures can be associated with an authorized signatory', () => {
  assert.match(sql, /signatory_id uuid references public\.client_authorized_signatories\(id\) on delete set null/);
  assert.match(sql, /new\.signatory_id is not null and new\.file_type <> 'signature'/);
  assert.ok(js.includes("signatory_id:type==='signature'"));
});

check('client list summary is loaded in one relational query without per-card requests', () => {
  assert.ok(js.includes('client_profile_files(id,file_type,is_active)'));
  const listLoader = js.slice(js.indexOf('async function loadClients'), js.indexOf('function filteredClients'));
  assert.strictEqual((listLoader.match(/sb\.from\(/g) || []).length, 1);
});

check('summary keeps assets isolated per client', () => {
  const summary = profiles.summarizeClient({client_profile_files:[
    {file_type:'stamp',is_active:true},
    {file_type:'letterhead',is_active:false},
    {file_type:'signature',is_active:true}
  ]});
  assert.deepStrictEqual(summary,{fileCount:2,hasStamp:true,hasLetterhead:false,hasLogo:false});
});

check('file validation rejects executables and oversized uploads', () => {
  assert.match(profiles.validateFile({type:'application/x-msdownload',size:10}), /المسموحة/);
  assert.match(profiles.validateFile({type:'application/pdf',size:profiles.MAX_FILE_SIZE+1}), /15MB/);
  assert.strictEqual(profiles.validateFile({type:'image/png',size:1024}), '');
});

check('navigation and four profile tabs are wired into the existing app', () => {
  assert.ok(html.includes('id="navClientProfiles"'));
  assert.ok(html.includes('id="viewClientProfiles"'));
  for(const label of ['نظرة عامة','الأختام والتوقيعات','المستندات','الأشخاص المفوضون']) assert.ok(js.includes(label));
});

check('responsive layout has desktop, tablet, and mobile grids without overflow', () => {
  assert.ok(css.includes('width:min(1500px,calc(100% - 48px))'));
  assert.ok(css.includes('@media(max-width:1100px)'));
  assert.ok(css.includes('@media(max-width:700px)'));
  assert.ok(css.includes('grid-template-columns:1fr'));
  assert.ok(css.includes('overflow-x:auto'));
});

assert.ok(checks >= 15);
console.log(`\n${checks} client company profile checks passed`);
