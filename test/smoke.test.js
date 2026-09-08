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
    let companyWizard = '';
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
      const wizardResponse = await fetch(`${BASE}/company-wizard.js`);
      assert.strictEqual(wizardResponse.status, 200);
      companyWizard = await wizardResponse.text();
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
      const contractSource = appHtml.slice(appHtml.indexOf('function baharSwakenContractSheet(r)'), appHtml.indexOf('\nfunction invoiceSheet', appHtml.indexOf('function baharSwakenContractSheet(r)')));
      assert.ok(appHtml.includes('function baharSwakenContractSheet(r)'));
      assert.ok(appHtml.includes('function shiftIsoDate(value, dayOffset)'));
      assert.ok(appHtml.includes('shiftIsoDate(r.proformaDate, 3)'));
      assert.ok(appHtml.includes('date.setUTCDate(date.getUTCDate() + Number(dayOffset || 0))'));
      assert.ok(appHtml.includes('function bsgtInvoiceAedText(amountText, enabled = true)'));
      assert.ok(appHtml.includes("return 'AED ' + (numeric * 3.67)"));
      assert.ok(appHtml.includes('const invoiceValue = value => bsgtInvoiceAedText(value, r.bsgtAutoAed !== false)'));
      assert.ok(appHtml.includes("['إجمالي القيمة', contractTotal, 'Total Contract Value']"));
      assert.ok(appHtml.includes("['العملة', contractCurrency, 'Currency']"));
      assert.ok(appHtml.includes("const stationery = settings.header || '';"));
      assert.ok(appHtml.includes('bahar-contract-stationery'));
      assert.ok(!contractSource.includes('bahar-contract-bg'));
      assert.ok(!contractSource.includes('bahar-contract-watermark'));
      assert.ok(!contractSource.includes('bahar-inv-brand'));
      assert.ok(appHtml.includes("fmtDateByLang(bsgtContractDate(r), 'en')"));
      assert.ok(appHtml.includes("has-contract-stationery':''"));
      assert.ok(appHtml.includes('--contract-line-height:${contractLayout.lineHeight}'));
      assert.ok(appHtml.includes('contractCellPaddingMm'));
      assert.ok(appHtml.includes("marginPreset === 'normal' ? 25.4"));
      assert.ok(appHtml.includes('border:.2mm solid #000'));
      assert.ok(appHtml.includes('background:transparent'));
      assert.ok(appHtml.includes("Number(qrPosition.yPercent) <= 36"));
      assert.ok(appHtml.includes('.bahar-contract-sheet.qr-top-right'));
      assert.ok(appHtml.includes('.bahar-contract-title{display:grid;gap:0;width:100%'));
      assert.ok(appHtml.includes('function baharContractRuntimeSettings(r)'));
      assert.ok(appHtml.includes('companySettings.contractBranding || {}'));
      assert.ok(appHtml.includes('--contract-table-y:${contractLayout.tableTopMm}mm'));
      assert.ok(appHtml.includes("grid-template-areas:'en value ar'"));
      assert.ok(appHtml.includes('cc-contract">تعديل العقد'));
      assert.ok(companyWizard.includes('window.openBaharContractEditor = id =>'));
      assert.ok(companyWizard.includes('contractBranding:clone(draft)'));
      assert.ok(companyWizard.includes('موضع ختم العقد فقط'));
      assert.ok(companyWizard.includes('خلفية وترويسة صفحة العقد'));
      assert.ok(companyWizard.includes('bce-header-pick'));
      assert.ok(companyWizard.includes("['stamp','qr']"));
      assert.ok(!companyWizard.includes('bce-show-header'));
      assert.ok(!companyWizard.includes("transformFields('header'"));
      assert.ok(appHtml.includes('company-wizard.js?v=20260907-contract-stationery'));
      assert.ok(companyWizard.includes('تحريك الجدول لأعلى أو أسفل'));
      assert.ok(companyWizard.includes('Office 307 Al Faheem Building'));
      assert.ok(!appHtml.includes('${decorations(false,true)}${brand()}'));
    });
    await check('BSGT shipment attachments have role-aware read-only UI', async () => {
      assert.ok(appHtml.includes('function canManageShipmentFiles(r)'));
      assert.ok(appHtml.includes('async function deleteBaharDocument(r, key)'));
      assert.ok(appHtml.includes("k==='importPermit' && uploaded && canManageFiles"));
      assert.ok(appHtml.includes('حذف الملف'));
      assert.ok(appHtml.includes('ستبقى الخانة فارغة ويمكنك رفع ملف جديد لاحقاً'));
      assert.ok(appHtml.includes("shipmentFilesCache[r.id] = (shipmentFilesCache[r.id] || []).filter(item=>item.label!==label)"));
      assert.ok(appHtml.includes('shipmentFilesErrors[id]'));
      assert.ok(appHtml.includes('تعذر تحميل الملف — تحقق من الصلاحية أو الاتصال'));
      const policySql = fs.readFileSync(path.join(__dirname, '..', 'supabase', '25_قراءة_مرفقات_BSGT.sql'), 'utf8');
      assert.ok(policySql.includes('public.is_bsgt_user() and s.company_id = public.bsgt_company_id()'));
      assert.ok(policySql.includes('create policy shipmentfiles_select'));
      assert.ok(policySql.includes('create policy shippkgatt_select'));
    });
    await check('BSGT bill numbers are duplicate-safe and operation history is visible', async () => {
      assert.ok(appHtml.includes('function normalizeBsgtBillNumber(value)'));
      assert.ok(appHtml.includes('function findDuplicateBsgtBill(value, excludeId = bsgtShipEditId)'));
      assert.ok(appHtml.includes('async function findDuplicateBsgtBillOnServer(companyId, value, excludeId = bsgtShipEditId)'));
      assert.ok(appHtml.includes(".eq('company_id', companyId)"));
      assert.ok(appHtml.includes('رقم البوليصة مستخدم مسبقاً في'));
      assert.ok(appHtml.includes('تعذّر التحقق من عدم تكرار رقم البوليصة. لم يتم الحفظ'));
      assert.ok(appHtml.includes('فتح العملية'));
      assert.ok(appHtml.includes('function shipmentAuditUserName(userId)'));
      assert.ok(appHtml.includes('أنشأ العملية'));
      assert.ok(appHtml.includes('تاريخ الإنشاء'));
      assert.ok(appHtml.includes('آخر تحديث'));
      assert.ok(appHtml.includes('ما حدث في العملية'));
      assert.ok(appHtml.includes("if(!isBsgtAudit) query = query.in('kind', ['submit','approve','return'])"));
      assert.ok(appHtml.includes("const note = isBsgtAudit ? [`بواسطة: ${actor}`, c.body]"));
      assert.ok(appHtml.includes("updateHash(navKey === 'bsgt' ? 'bsgt' : v)"));
      assert.ok(appHtml.includes('onclick="openBsgtShipForm(null)"'));
    });
    await check('import-permit proforma portal is standalone and Baldna-restricted', async () => {
      const permitSource = fs.readFileSync(path.join(__dirname, '..', 'import-permit.js'), 'utf8');
      const catalogSource = fs.readFileSync(path.join(__dirname, '..', 'baldna-commodities.js'), 'utf8');
      const catalogJson = catalogSource.slice(catalogSource.indexOf('Object.freeze(') + 'Object.freeze('.length, catalogSource.lastIndexOf(');'));
      const catalog = JSON.parse(catalogJson);
      assert.strictEqual(catalog.length, 429);
      assert.ok(catalog.every(item => item.id && item.category && item.name && /^\d{6,10}$/.test(item.hsCode) && item.unit));
      assert.deepStrictEqual([...new Set(catalog.map(item => item.unit))].sort(), ['DZN','GRM','KGM','MTK','MTQ','PCE']);
      assert.ok(appHtml.includes('id="bsgtImportPermitBtn"'));
      assert.ok(appHtml.includes('id="importPermitOverlay"'));
      assert.ok(appHtml.includes('فاتورة مبدئية فقط، لا تنشئ شحنة ولا قيداً محاسبياً'));
      assert.ok(appHtml.includes("const amountCurrency = String(r.permitInvoiceCurrency || 'AED').toUpperCase()"));
      assert.ok(permitSource.includes("openPrintWindow(buildSheet(record, 'proforma', 'en'))"));
      assert.ok(permitSource.includes('permitInvoiceCurrency: currency'));
      assert.ok(!permitSource.includes('dbSaveRecord'));
      assert.ok(!permitSource.includes("from('shipments')"));
      assert.ok(!permitSource.includes('ledger'));
      assert.ok(!permitSource.includes('localStorage'));
    });
    await check('static assets served with correct MIME', async () => {
      for (const [file, type] of [['wizard.js', 'text/javascript'], ['wizard.css', 'text/css'], ['jahez-glass.css', 'text/css'], ['import-permit.js', 'text/javascript'], ['baldna-commodities.js', 'text/javascript'], ['import-permit.css', 'text/css'], ['dashboard-team.png', 'image/png'], ['dubai-certificate-template.pdf', 'application/pdf'], ['public-shipment.html', 'text/html']]) {
        const r = await fetch(`${BASE}/${file}`);
        assert.strictEqual(r.status, 200, file);
        assert.match(r.headers.get('content-type'), new RegExp(type), file);
      }
    });
    await check('Jahez Glass skin is isolated from generated documents', async () => {
      assert.ok(appHtml.includes('jahez-glass.css?v=20260908-glass-4'));
      const glass = await (await fetch(`${BASE}/jahez-glass.css`)).text();
      assert.ok(glass.includes('--glass-bg-strong'));
      assert.ok(glass.includes('.app-sidebar'));
      assert.ok(glass.includes('.lab-header'));
      assert.ok(glass.includes('@media print'));
      const navbarRule = glass.match(/\.o-navbar\s*\{([^}]*)\}/);
      assert.ok(navbarRule);
      assert.ok(!navbarRule[1].includes('backdrop-filter'));
      assert.ok(glass.includes('#lockScreen {'));
      assert.ok(!glass.includes('.lock-form-panel { background: rgba'));
      assert.match(glass, /\.o-control-panel\s*\{[^}]*z-index:\s*2/);
      assert.ok(!glass.includes('.doc-sheet'));
      assert.ok(!glass.includes('.bahar-contract'));
      assert.ok(!glass.includes('.bahar-inv'));
      const collectionHtml = await (await fetch(`${BASE}/experiments/bs-collection/`)).text();
      assert.ok(collectionHtml.includes('../../jahez-glass.css?v=20260908-glass-4'));
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
