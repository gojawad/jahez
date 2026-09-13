'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const APP_PORT = 4300 + Math.floor(Math.random() * 150);
const SUPABASE_PORT = 4500 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const TOKEN = 'abcdefghijklmnopqrstuvwx';
const SHIPMENT_ID = '11111111-1111-4111-8111-111111111111';

const shipment = {
  id: SHIPMENT_ID,
  status: 'sent',
  created_at: '2026-09-13T08:00:00Z',
  updated_at: '2026-09-13T08:00:00Z',
  data: {
    qrToken: TOKEN,
    operationNo: 'BSGTX-2026-0023',
    itemDesc: 'TROLLEY CASE',
    invoiceNo: 'INV-0023',
    invoiceDate: '2026-09-13',
    billNo: 'BL-0023',
    consignee: 'PUBLIC TRADING LLC',
    qty: '7150',
    qtyUnit: 'PCE',
    countryOrigin: 'CHINA',
    portDischarge: 'ATBARA DRY PORT',
    bankDetails: 'SECRET BANK ACCOUNT',
    consigneeAddress: 'PRIVATE ADDRESS',
    notes: 'PRIVATE ADMIN NOTE',
    totalAmount: 'USD 99999'
  }
};

const files = [
  {
    id: '22222222-2222-4222-8222-222222222221',
    shipment_id: SHIPMENT_ID,
    document_type: 'import_permit',
    label: 'إذن الاستيراد',
    name: 'permit-v1.pdf',
    path: `${SHIPMENT_ID}/permit-v1.pdf`,
    mime: 'application/pdf',
    size_bytes: 9,
    created_at: '2026-09-13T08:04:00Z'
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    shipment_id: SHIPMENT_ID,
    document_type: 'bill_of_lading',
    label: 'بوليصة الشحن',
    name: 'bill.pdf',
    path: `${SHIPMENT_ID}/bill.pdf`,
    mime: 'application/pdf',
    size_bytes: 8,
    created_at: '2026-09-13T08:03:00Z'
  },
  {
    id: '22222222-2222-4222-8222-222222222223',
    shipment_id: SHIPMENT_ID,
    document_type: 'letter',
    label: 'خطاب التحصيل',
    name: 'private-collection-letter.pdf',
    path: `${SHIPMENT_ID}/private-collection-letter.pdf`,
    mime: 'application/pdf',
    size_bytes: 10,
    created_at: '2026-09-13T08:02:00Z'
  }
];

function json(res, value) {
  const body = JSON.stringify(value);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function startFakeSupabase() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${SUPABASE_PORT}`);
    if (url.pathname === '/rest/v1/shipments') {
      if (String(url.searchParams.get('select') || '').includes('data->>operationNo')) {
        return json(res, [{
          id: shipment.id,
          operationNo: shipment.data.operationNo,
          qrPackagePath: shipment.data.qrPackagePath || null,
          qrPublishedAt: shipment.data.qrPublishedAt || null
        }]);
      }
      return json(res, [shipment]);
    }
    if (url.pathname === '/rest/v1/shipment_files') return json(res, files);
    if (url.pathname.startsWith('/storage/v1/object/shipment-files/')) {
      const storagePath = decodeURIComponent(url.pathname.replace('/storage/v1/object/shipment-files/', ''));
      const isPackage = storagePath === shipment.data.qrPackagePath;
      const isDocument = files.some(file => file.path === storagePath);
      if (!isPackage && !isDocument) {
        res.writeHead(404);
        return res.end('missing');
      }
      const body = Buffer.from(isPackage ? '%PDF-package' : '%PDF-doc');
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': body.length });
      return res.end(body);
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise(resolve => server.listen(SUPABASE_PORT, '127.0.0.1', () => resolve(server)));
}

async function waitForApp(proc) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (proc.exitCode !== null) throw new Error(`app exited early with code ${proc.exitCode}`);
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('app did not start');
}

async function main() {
  const fakeSupabase = await startFakeSupabase();
  const app = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      SUPABASE_URL: `http://127.0.0.1:${SUPABASE_PORT}`,
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key'
    },
    stdio: ['ignore', 'inherit', 'inherit']
  });

  try {
    await waitForApp(app);

    const splash = await (await fetch(`${BASE}/s/${TOKEN}`)).text();
    assert.match(splash, /\/api\/public-shipment\?token=/);
    assert.doesNotMatch(splash, /\/api\/qr-package\?token=/);

    const permanentUrl = `${BASE}/api/public-shipment?token=${TOKEN}`;
    const beforePackageResponse = await fetch(permanentUrl);
    const beforePackage = await beforePackageResponse.text();
    assert.strictEqual(beforePackageResponse.status, 200);
    assert.match(beforePackage, /الحزمة الكاملة قيد التجهيز/);
    assert.match(beforePackage, /لم يتم إنشاء PDF الكامل بعد/);
    assert.match(beforePackage, /BSGTX-2026-0023/);
    assert.match(beforePackage, /BL-0023/);
    assert.match(beforePackage, /permit-v1\.pdf/);
    assert.match(beforePackage, /bill\.pdf/);
    assert.doesNotMatch(beforePackage, /api\/qr-package/);
    assert.doesNotMatch(beforePackage, /SECRET BANK ACCOUNT|PRIVATE ADDRESS|PRIVATE ADMIN NOTE|USD 99999/);
    assert.doesNotMatch(beforePackage, /private-collection-letter|خطاب التحصيل/);
    assert.match(beforePackageResponse.headers.get('x-robots-tag'), /noindex/);

    const documentResponse = await fetch(`${permanentUrl}&document=${files[0].id}`);
    assert.strictEqual(documentResponse.status, 200);
    assert.match(documentResponse.headers.get('content-type'), /application\/pdf/);
    assert.strictEqual(await documentResponse.text(), '%PDF-doc');

    shipment.data.qrPackagePath = `qr-package/${SHIPMENT_ID}/package.pdf`;
    shipment.data.qrPublishedAt = '2026-09-13T09:00:00Z';
    const afterPackage = await (await fetch(permanentUrl)).text();
    assert.match(afterPackage, /الحزمة الكاملة جاهزة/);
    assert.match(afterPackage, /عرض الحزمة الكاملة PDF/);
    assert.match(afterPackage, new RegExp(`/api/qr-package\\?token=${TOKEN}`));
    const packageResponse = await fetch(`${BASE}/api/qr-package?token=${TOKEN}`);
    assert.strictEqual(packageResponse.status, 200);
    assert.strictEqual(await packageResponse.text(), '%PDF-package');

    files.unshift({
      ...files[0],
      id: '22222222-2222-4222-8222-222222222224',
      name: 'permit-v2.pdf',
      path: `${SHIPMENT_ID}/permit-v2.pdf`,
      created_at: '2026-09-13T10:00:00Z'
    });
    const afterDocumentUpdate = await (await fetch(permanentUrl)).text();
    assert.match(afterDocumentUpdate, /permit-v2\.pdf/);
    assert.doesNotMatch(afterDocumentUpdate, /permit-v1\.pdf/);

    const appHtml = await fs.promises.readFile(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(appHtml.includes('if(!rec.qrToken) rec.qrToken = newQrToken();'));
    assert.ok(appHtml.includes("const target = qrPackageUrl(r);"));
    assert.ok(!appHtml.slice(appHtml.indexOf('function shipmentOperationQr'), appHtml.indexOf('const INV_I18N')).includes('qrPackagePath'));

    console.log('✔ permanent QR opens shipment before package generation');
    console.log('✔ public documents update without changing the QR');
    console.log('✔ full package button appears only after package generation');
    console.log('✔ private and collection data remain excluded');
  } finally {
    app.kill('SIGTERM');
    await new Promise(resolve => fakeSupabase.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
