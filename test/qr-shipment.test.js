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

const { PDFDocument } = require('../experiments/bs-collection/collection-pdf-lib');
const signedScenario = { active: false, fileStatus: 'under_management_review' };
const pdfCache = {};
async function pdfWithPages(key, count) {
  if (!pdfCache[key]) { const pdf = await PDFDocument.create(); for (let i = 0; i < count; i += 1) pdf.addPage(); pdfCache[key] = Buffer.from(await pdf.save()); }
  return pdfCache[key];
}
const REVISION_DOCS = () => [
  { kind: 'contract', path: `${SHIPMENT_ID}/${shipment.operations_revision_id}/contract.pdf` },
  { kind: 'invoice', path: `${SHIPMENT_ID}/${shipment.operations_revision_id}/invoice.pdf` }
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
          operations_revision_id: shipment.operations_revision_id || null,
          operationNo: shipment.data.operationNo,
          qrPackagePath: shipment.data.qrPackagePath || null,
          qrPublishedAt: shipment.data.qrPublishedAt || null
        }]);
      }
      return json(res, [shipment]);
    }
    if (url.pathname === '/rest/v1/shipment_files') return json(res, files);
    if (url.pathname === '/rest/v1/bsgt_operations_revisions') {
      assert.equal(url.searchParams.get('shipment_id'), `eq.${shipment.id}`);
      assert.equal(url.searchParams.get('id'), `eq.${shipment.operations_revision_id}`);
      assert.equal(url.searchParams.get('approved_at'), 'not.is.null');
      return json(res, [{id:shipment.operations_revision_id,package_path:`${shipment.id}/${shipment.operations_revision_id}/package.pdf`,documents:REVISION_DOCS()}]);
    }
    if (url.pathname === '/rest/v1/trade_collection_file_shipments') {
      if (!signedScenario.active) { res.writeHead(404); return res.end('not found'); }
      assert.equal(url.searchParams.get('shipment_id'), `eq.${shipment.id}`);
      return json(res, [{ trade_file_id: 'file-1' }]);
    }
    if (url.pathname === '/rest/v1/trade_collection_files') {
      assert.equal(url.searchParams.get('status'), 'in.(final_accepted,sent_to_collecting)');
      const accepted = ['final_accepted', 'sent_to_collecting'].includes(signedScenario.fileStatus);
      return json(res, accepted ? [{ id: 'file-1', revision_no: 2, status: signedScenario.fileStatus, created_at: '2026-09-17T10:00:00Z' }] : []);
    }
    if (url.pathname === '/rest/v1/trade_collection_file_documents') {
      assert.equal(url.searchParams.get('document_variant'), 'eq.administration_signed');
      assert.equal(url.searchParams.get('is_active'), 'eq.true');
      const base = { document_variant: 'administration_signed', shipment_id: shipment.id, operations_revision_id: shipment.operations_revision_id, revision_no: 2, is_active: true };
      return json(res, [
        { ...base, id: 'd1', document_type: 'contract', storage_path: 'signed/contract-signed.pdf', source_document_path: REVISION_DOCS()[0].path, created_at: '2026-09-17T10:05:00Z' },
        { ...base, id: 'd2', document_type: 'letter', storage_path: 'signed/letter-signed.pdf', source_document_path: 'finance/letter.pdf', created_at: '2026-09-17T10:06:00Z' }
      ]);
    }
    if (url.pathname.startsWith('/storage/v1/object/trade-collection-documents/')) {
      const storagePath = decodeURIComponent(url.pathname.replace('/storage/v1/object/trade-collection-documents/', ''));
      if (storagePath === 'signed/letter-signed.pdf') { res.writeHead(500); return res.end('confidential document must never be requested by the QR route'); }
      return pdfWithPages('signed-contract', 2).then(body => { res.writeHead(200, {'Content-Type':'application/pdf'}); res.end(body); });
    }
    if (url.pathname.startsWith('/storage/v1/object/bsgt-operations-packages/')) {
      const storagePath = decodeURIComponent(url.pathname.replace('/storage/v1/object/bsgt-operations-packages/', ''));
      if (signedScenario.active && storagePath.endsWith('/invoice.pdf')) return pdfWithPages('invoice', 1).then(body => { res.writeHead(200, {'Content-Type':'application/pdf'}); res.end(body); });
      if (signedScenario.active && storagePath.endsWith('/contract.pdf')) { res.writeHead(500); return res.end('signed contract must replace the original'); }
      const body=Buffer.from(`%PDF-operations-${shipment.operations_revision_id}`);
      res.writeHead(200, {'Content-Type':'application/pdf'}); return res.end(body);
    }
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

    const permanentUrl = `${BASE}/s/${TOKEN}`;
    const packageUrl = `${BASE}/api/qr-package?token=${TOKEN}`;
    const splash = await (await fetch(permanentUrl)).text();
    assert.match(splash, /\/api\/qr-package\?token=/);
    assert.doesNotMatch(splash, /\/api\/public-shipment\?token=/);

    const oldPageResponse = await fetch(`${BASE}/api/public-shipment?token=${TOKEN}`, { redirect: 'manual' });
    assert.strictEqual(oldPageResponse.status, 302);
    assert.strictEqual(oldPageResponse.headers.get('location'), `/api/qr-package?token=${TOKEN}`);

    const beforePackageResponse = await fetch(packageUrl);
    const beforePackage = await beforePackageResponse.text();
    assert.strictEqual(beforePackageResponse.status, 200);
    assert.match(beforePackage, /الملف في المرحلة المبدئية/);
    assert.match(beforePackage, /لم يتم تجميع الحزمة الكاملة PDF حتى الآن/);
    assert.match(beforePackage, /BSGTX-2026-0023/);
    assert.doesNotMatch(beforePackage, /permit-v1\.pdf|bill\.pdf|TROLLEY CASE|INV-0023|BL-0023|PUBLIC TRADING LLC/);

    shipment.data.qrPackagePath = `qr-package/${SHIPMENT_ID}/package.pdf`;
    shipment.data.qrPublishedAt = '2026-09-13T09:00:00Z';
    const packageResponse = await fetch(packageUrl);
    assert.strictEqual(packageResponse.status, 200);
    assert.match(packageResponse.headers.get('content-type'), /application\/pdf/);
    assert.strictEqual(await packageResponse.text(), '%PDF-package');

    shipment.operations_revision_id='revision-1';
    assert.strictEqual(await (await fetch(packageUrl)).text(),'%PDF-operations-revision-1');
    shipment.data.qrPackagePath='private/admin-signed.pdf';
    assert.strictEqual(await (await fetch(packageUrl+'&document=letter&bucket=trade-collection-documents')).text(),'%PDF-operations-revision-1');
    shipment.operations_revision_id='revision-2';
    assert.strictEqual(await (await fetch(packageUrl)).text(),'%PDF-operations-revision-2');

    // Administration signatures: only after the trade file is accepted, only operations documents, finance stays out.
    signedScenario.active = true; signedScenario.fileStatus = 'under_management_review';
    let response = await fetch(packageUrl);
    assert.strictEqual(response.headers.get('x-jahez-package'), null, 'no signed package before management acceptance');
    assert.strictEqual(await response.text(), '%PDF-operations-revision-2');
    signedScenario.fileStatus = 'final_accepted';
    response = await fetch(packageUrl);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('x-jahez-package'), 'signed:contract');
    const signedPdf = await PDFDocument.load(Buffer.from(await response.arrayBuffer()));
    assert.strictEqual(signedPdf.getPageCount(), 3, 'signed contract (2 pages) + original invoice (1 page); confidential letter excluded');
    signedScenario.fileStatus = 'sent_to_collecting';
    assert.strictEqual((await fetch(packageUrl)).headers.get('x-jahez-package'), 'signed:contract');
    signedScenario.active = false;
    console.log('✔ QR serves administration-signed operations documents after acceptance and never finance documents');

    const appHtml = await fs.promises.readFile(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(appHtml.includes('if(!rec.qrToken) rec.qrToken = newQrToken();'));
    assert.ok(appHtml.includes("const target = qrPackageUrl(r);"));
    assert.ok(!appHtml.slice(appHtml.indexOf('function shipmentOperationQr'), appHtml.indexOf('const INV_I18N')).includes('qrPackagePath'));

    console.log('✔ permanent QR shows a preliminary-stage message before merging');
    console.log('✔ old public shipment links no longer expose individual files');
    console.log('✔ the same QR opens only the merged PDF after generation');
  } finally {
    app.kill('SIGTERM');
    await new Promise(resolve => fakeSupabase.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
