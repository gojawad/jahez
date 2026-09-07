'use strict';
// اختبار دخاني: يشغّل الخادم على منفذ عشوائي ويتحقق من الواجهة والـ API وتوليد PDF.
// التشغيل: node test/smoke.test.js   (اضبط CHROMIUM_PATH إن لم يكن Chromium في المسار الافتراضي)

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const PORT = 3900 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForServer(proc) {
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode !== null) throw new Error(`server exited early with code ${proc.exitCode}`);
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}

async function main() {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), BUILD_SHA: 'test-sha', BROWSERLESS_TOKEN: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    stdio: ['ignore', 'inherit', 'inherit']
  });
  try {
    await waitForServer(proc);
    const results = [];
    let appHtml = '';
    const check = async (name, fn) => { await fn(); results.push(name); console.log('✔', name); };

    await check('healthz reports build sha', async () => {
      const j = await (await fetch(`${BASE}/healthz`)).json();
      assert.strictEqual(j.ok, true); assert.strictEqual(j.commitSha, 'test-sha');
    });
    await check('/ serves index.html uncached', async () => {
      const r = await fetch(`${BASE}/`);
      assert.strictEqual(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.match(r.headers.get('cache-control'), /no-cache/);
      assert.strictEqual(r.headers.get('x-frame-options'), 'SAMEORIGIN');
      appHtml = await r.text();
      assert.ok(appHtml.includes('supabase'), 'index.html should be the app');
    });
    await check('shipment company isolation guards are present', async () => {
      assert.ok(appHtml.includes('function companyEntryForRecord(r)'));
      assert.ok(appHtml.includes('function isBsgtRecord(r)'));
      assert.ok(appHtml.includes("companyId: selectedCompanyId"));
      assert.ok(appHtml.includes("nextCompanyNumber('invoice', requestedCompanyId)"));
      assert.ok(!appHtml.includes('companyId: (prev && prev.companyId) || document.getElementById(\'f_company\').value'));
      assert.ok(!appHtml.includes('isBaharSwakenCompany(companyDataFor(r))'));
    });
    await check('Bahar sale contract is a compact configurable single A4 sheet', async () => {
      assert.ok(appHtml.includes('function baharSwakenContractSheet(r)'));
      assert.ok(appHtml.includes('${decorations(true,true)}${brand()}'));
      assert.ok(appHtml.includes('--contract-line-height:${contractLayout.lineHeight}'));
      assert.ok(appHtml.includes('contractCellPaddingMm'));
      assert.ok(appHtml.includes("marginPreset === 'normal' ? 25.4"));
      assert.ok(appHtml.includes('border:.2mm solid #000'));
      assert.ok(appHtml.includes('background:transparent'));
      assert.ok(!appHtml.includes('${decorations(false,true)}${brand()}'));
    });
    await check('BSGT shipment attachments have role-aware read-only UI', async () => {
      assert.ok(appHtml.includes('function canManageShipmentFiles(r)'));
      assert.ok(appHtml.includes('shipmentFilesErrors[id]'));
      assert.ok(appHtml.includes('تعذر تحميل الملف — تحقق من الصلاحية أو الاتصال'));
      const policySql = fs.readFileSync(path.join(__dirname, '..', 'supabase', '25_قراءة_مرفقات_BSGT.sql'), 'utf8');
      assert.ok(policySql.includes('public.is_bsgt_user() and s.company_id = public.bsgt_company_id()'));
      assert.ok(policySql.includes('create policy shipmentfiles_select'));
      assert.ok(policySql.includes('create policy shippkgatt_select'));
    });
    await check('static assets served with correct MIME', async () => {
      for (const [file, type] of [['wizard.js', 'text/javascript'], ['wizard.css', 'text/css'], ['dashboard-team.png', 'image/png'], ['dubai-certificate-template.pdf', 'application/pdf'], ['public-shipment.html', 'text/html']]) {
        const r = await fetch(`${BASE}/${file}`);
        assert.strictEqual(r.status, 200, file);
        assert.match(r.headers.get('content-type'), new RegExp(type), file);
      }
    });
    await check('server files and SQL are not exposed', async () => {
      for (const p of ['/server.js', '/package.json', '/.env', '/.git/config', '/supabase/1.sql', '/api/microsoft.js', '/../etc/passwd', '/%2e%2e/etc/passwd']) {
        const r = await fetch(`${BASE}${p}`);
        assert.ok(r.status === 404 || r.status === 400, `${p} -> ${r.status}`);
      }
    });
    await check('public-shipment without id returns 400 page', async () => {
      const r = await fetch(`${BASE}/api/public-shipment`);
      assert.strictEqual(r.status, 400);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.match(await r.text(), /رابط الشحنة غير مكتمل/);
    });
    await check('microsoft status without server settings answers JSON', async () => {
      const r = await fetch(`${BASE}/api/microsoft`);
      const j = await r.json();
      assert.strictEqual(j.connected, false);
      assert.strictEqual(j.connectUrl, '/api/microsoft?action=connect');
    });
    await check('/s/<token> QR route answers without a service key', async () => {
      const bad = await fetch(`${BASE}/s/short`);
      assert.strictEqual(bad.status, 404);
      const r = await fetch(`${BASE}/s/abcdefghijklmnopqrstuvwx`);
      assert.strictEqual(r.status, 503);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.match(await r.text(), /SUPABASE_SERVICE_ROLE_KEY/);
      assert.strictEqual((await fetch(`${BASE}/s/`)).status, 404);
    });
    await check('unknown api route is 404', async () => {
      assert.strictEqual((await fetch(`${BASE}/api/nope`)).status, 404);
    });
    await check('render-bsgt-pdf rejects GET and empty body', async () => {
      assert.strictEqual((await fetch(`${BASE}/api/render-bsgt-pdf`)).status, 405);
      const r = await fetch(`${BASE}/api/render-bsgt-pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.strictEqual(r.status, 400);
    });
    await check('render-bsgt-pdf renders a real A4 PDF with local Chromium', async () => {
      const html = '<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>@page{size:A4;margin:0}body{font-family:sans-serif;margin:20mm}</style></head><body><h1>فاتورة اختبار — بحر سواكن</h1><p>Invoice 001</p></body></html>';
      const r = await fetch(`${BASE}/api/render-bsgt-pdf`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html }) });
      const buf = Buffer.from(await r.arrayBuffer());
      assert.strictEqual(r.status, 200, buf.toString('utf8').slice(0, 300));
      assert.strictEqual(r.headers.get('content-type'), 'application/pdf');
      assert.strictEqual(buf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(buf.length > 1000, 'pdf should not be empty');
      fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, 'output', 'smoke.pdf'), buf);
    });
    console.log(`\n${results.length} checks passed`);
  } finally {
    proc.kill('SIGTERM');
  }
}

main().catch(e => { console.error('✘', e.message); process.exit(1); });
