'use strict';
// مركز الأرشيف — اختبار متصفح على الواجهة الحقيقية مع Supabase مُحاكى بالكامل.
// لا يتصل بأي خدمة: كل نداءات PostgREST والتخزين تُلتقط عبر route().
//   CHROMIUM_PATH=/opt/pw-browsers/chromium node test/bsgt-archive-center-browser.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {chromium} = require('playwright-core');

const PORT = 4800 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_ORIGIN = `http://jahez.test:${PORT}`;
const SUPABASE_ORIGIN = 'https://vthcmqqiexaedukduquv.supabase.co';

const chromiumPath = () => [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(fs.existsSync);

async function waitForServer(child){
  for(let attempt = 0; attempt < 50; attempt++){
    if(child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try{ if((await fetch(`${BASE}/healthz`)).ok) return; }catch{}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('server did not start');
}

function fakeJwt(exp){
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'employee-1',exp,aud:'authenticated'})}.signature`;
}

// ------------------------------------------------------------------ fixtures
const FILE_A = '11111111-1111-4111-8111-111111111111';
const SHIP_A = '22222222-2222-4222-8222-222222222222';
const SHIP_B = '33333333-3333-4333-8333-333333333333';

const db = {
  shipments: [
    {id:SHIP_B, operation_no:'ARCH-0002', consignee:'BETA IMPORT', item_desc:'RICE', invoice_no:'AINV-2',
     bsgt_stage:'operations_draft', archived_at:'2026-09-05T10:00:00Z', archived_by_name:'ARCHIVER',
     trade_file_id:null, trade_file_operation_no:null},
    {id:SHIP_A, operation_no:'ARCH-0001', consignee:'ALPHA TRADING', item_desc:'SUGAR', invoice_no:'AINV-1',
     bsgt_stage:'final_accepted', archived_at:'2026-09-01T10:00:00Z', archived_by_name:'ARCHIVER',
     trade_file_id:FILE_A, trade_file_operation_no:'TC-2026-000901'}
  ],
  files: [
    {id:FILE_A, operation_no:'TC-2026-000901', status:'final_accepted', revision_no:2,
     remitting_bank:'OMDURMAN NATIONAL BANK', collecting_bank:'BANK OF KHARTOUM',
     archived_at:'2026-09-02T12:00:00Z', archived_by_name:'ARCHIVER', shipment_count:1, document_count:1}
  ],
  documents: [
    {id:'aaaa1111-1111-4111-8111-111111111111', trade_file_id:FILE_A, trade_file_operation_no:'TC-2026-000901',
     trade_file_status:'under_management_review', document_type:'undertaking', file_name:'التعهد الموقّع.pdf',
     storage_path:`${FILE_A}/undertaking-r1.pdf`, mime_type:'application/pdf', file_size:12345, revision_no:1,
     is_active:false, document_archived_at:'2026-09-03T08:00:00Z', file_archived_at:null,
     uploaded_by_name:'ARCH MANAGER', created_at:'2026-08-21T09:00:00Z'},
    {id:'bbbb2222-2222-4222-8222-222222222222', trade_file_id:FILE_A, trade_file_operation_no:'TC-2026-000901',
     trade_file_status:'final_accepted', document_type:'letter', file_name:'خطاب التحصيل الموقّع.pdf',
     storage_path:`${FILE_A}/letter-r2.pdf`, mime_type:'application/pdf', file_size:34567, revision_no:2,
     is_active:true, document_archived_at:null, file_archived_at:'2026-09-02T12:00:00Z',
     uploaded_by_name:'ARCH MANAGER', created_at:'2026-08-20T09:00:00Z'}
  ]
};
db.shipmentCards = {
  [SHIP_A]: {id:SHIP_A, operation_no:'ARCH-0001', consignee:'ALPHA TRADING', item_desc:'SUGAR',
    invoice_no:'AINV-1', bsgt_stage:'final_accepted', status:'sent', workflow_stage:'accepted',
    data:{operationNo:'ARCH-0001', consignee:'ALPHA TRADING', itemDesc:'SUGAR', invoiceNo:'AINV-1',
      currency:'USD', totalAmount:'USD 1,000.00', paymentTerm:'D/A 90 DAYS', vessel:'MV TEST'},
    archived_at:'2026-09-01T10:00:00Z', archived_by_name:'ARCHIVER',
    created_at:'2026-08-01T10:00:00Z', updated_at:'2026-09-01T10:00:00Z',
    trade_file_id:FILE_A, trade_file_operation_no:'TC-2026-000901', trade_file_status:'final_accepted',
    trade_file_archived_at:'2026-09-02T12:00:00Z', file_count:2}
};
db.shipmentFiles = {
  [SHIP_A]: [
    {id:'f1', name:'فاتورة مختومة.pdf', path:`${SHIP_A}/invoice-stamped.pdf`, mime:'application/pdf',
     size_bytes:45678, label:null, uploaded_by_name:'ARCH MANAGER', created_at:'2026-08-26T09:00:00Z'},
    {id:'f2', name:'بوليصة موقّعة.pdf', path:`${SHIP_A}/bl-signed.pdf`, mime:'application/pdf',
     size_bytes:91011, label:'بوليصة الشحن الموقّعة', uploaded_by_name:'ARCH MANAGER', created_at:'2026-08-25T09:00:00Z'}
  ]
};
const calls = {restore:[], signedUrl:[], lists:[], detail:[]};
let listFailsOnce = false;

function match(rows, search, fields){
  if(!search) return rows;
  const needle = String(search).toLowerCase();
  return rows.filter(row => fields.some(field => String(row[field] ?? '').toLowerCase().includes(needle)));
}

async function createContext(browser, {role = 'staff', featureKeys = [], canPreview = false} = {}){
  const context = await browser.newContext({viewport:{width:1440, height:900}});
  const profile = {id:'employee-1', email:'archive@example.test', display_name:'موظف الأرشيف',
    role, active:true, photo_url:'', feature_permissions_initialized:true};
  const expiresAt = Math.floor(Date.now()/1000) + 3600;
  await context.addInitScript(({profile, expiresAt, token}) => {
    localStorage.setItem('shipdocs-auth', JSON.stringify({
      access_token:token, refresh_token:'refresh-token', expires_at:expiresAt, expires_in:3600,
      token_type:'bearer', user:{id:profile.id, email:profile.email, aud:'authenticated', role:'authenticated'}
    }));
  }, {profile, expiresAt, token:fakeJwt(expiresAt)});

  await context.route(`${SUPABASE_ORIGIN}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'Access-Control-Allow-Origin':APP_ORIGIN,
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info',
      'Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      'Content-Type':'application/json'
    };
    const json = body => route.fulfill({status:200, headers, body:JSON.stringify(body)});
    if(request.method() === 'OPTIONS') return route.fulfill({status:204, headers, body:''});

    const p = url.pathname;
    if(p === '/rest/v1/profiles') return json([profile]);
    if(p === '/rest/v1/rpc/get_user_feature_permissions') return json(featureKeys.map(permission_key => ({permission_key, allowed:true})));
    if(p === '/rest/v1/rpc/get_bsgt_workspace_permissions') return json([]);
    if(p === '/rest/v1/companies') return json([{id:'bsgt-company', name_ar:'بحر سواكن للتجارة العامة',
      name_en:'Bahar Swaken General Trading', active:true, is_default:false, sort_order:1, settings:{}}]);

    if(p === '/rest/v1/rpc/bsgt_archive_center_summary'){
      return json([{archived_shipments:db.shipments.length, archived_trade_files:db.files.length, archived_documents:db.documents.length}]);
    }
    if(p === '/rest/v1/rpc/get_bsgt_archived_shipment'){
      const id = (request.postDataJSON() || {}).p_shipment_id;
      calls.detail.push({rpc:'card', id});
      const card = db.shipmentCards[id];
      if(!card) return route.fulfill({status:400, headers, body:JSON.stringify({message:'Archived shipment is not available'})});
      return json([card]);
    }
    if(p === '/rest/v1/rpc/list_bsgt_archived_shipment_files'){
      const id = (request.postDataJSON() || {}).p_shipment_id;
      calls.detail.push({rpc:'files', id});
      if(!db.shipmentCards[id]) return route.fulfill({status:400, headers, body:JSON.stringify({message:'Archived shipment is not available'})});
      return json(db.shipmentFiles[id] || []);
    }
    if(p.startsWith('/rest/v1/rpc/list_bsgt_archived_')){
      const body = request.postDataJSON() || {};
      calls.lists.push({rpc:p.split('/').pop(), search:body.p_search ?? null, page:body.p_page ?? 1});
      if(listFailsOnce){ listFailsOnce = false; return route.fulfill({status:500, headers, body:JSON.stringify({message:'archive read failed'})}); }
      const size = body.p_page_size || 20;
      const page = Math.max(1, body.p_page || 1);
      let rows, fields;
      if(p.endsWith('list_bsgt_archived_shipments')){ rows = db.shipments; fields = ['operation_no','consignee','item_desc','invoice_no','trade_file_operation_no']; }
      else if(p.endsWith('list_bsgt_archived_trade_files')){ rows = db.files; fields = ['operation_no','remitting_bank','collecting_bank']; }
      else { rows = db.documents; fields = ['file_name','trade_file_operation_no','document_type']; }
      const matched = match(rows, body.p_search, fields);
      const slice = matched.slice((page-1)*size, page*size)
        .map(row => ({...row, total_count:matched.length, ...(fields.includes('file_name') ? {can_preview:canPreview} : {})}));
      return json(slice);
    }
    if(p === '/rest/v1/rpc/set_bsgt_archive'){
      const body = request.postDataJSON() || {};
      calls.restore.push(body);
      if(body.p_kind === 'shipment'){
        const index = db.shipments.findIndex(row => row.id === body.p_id);
        if(index >= 0 && body.p_archived === false) db.shipments.splice(index, 1);
      }
      if(body.p_kind === 'trade_file' && body.p_archived === false){
        db.files.length = 0;
        db.documents.length = 0;
      }
      return json({kind:body.p_kind, id:body.p_id, archived:body.p_archived});
    }
    if(p.includes('/storage/v1/object/sign/')){
      calls.signedUrl.push(decodeURIComponent(p.split('/storage/v1/object/sign/')[1]));
      return json({signedURL:`/storage/v1/object/signed/${p.split('/sign/')[1]}?token=test`});
    }
    if(p === '/rest/v1/shipments') return json([]);
    if(request.method() === 'HEAD') return route.fulfill({status:200, headers:{...headers, 'Content-Range':'0-0/0'}, body:''});
    return json([]);
  });
  return context;
}

const openArchive = async page => {
  await page.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=archiveCenter`, {waitUntil:'domcontentloaded'});
  await page.locator('.ac-shell').waitFor({timeout:20000});
};

async function main(){
  const executablePath = chromiumPath();
  if(!executablePath) throw new Error('Chrome or Chromium executable was not found.');
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env:{...process.env, PORT:String(PORT), BUILD_SHA:'bsgt-archive-center-browser-test'},
    stdio:['ignore', 'inherit', 'inherit']
  });
  let browser;
  try{
    await waitForServer(server);
    browser = await chromium.launch({executablePath, headless:true,
      args:['--no-sandbox', '--disable-gpu', '--host-resolver-rules=MAP jahez.test 127.0.0.1']});

    // ---------------------------------------------------------- 1) بلا صلاحية
    const plain = await createContext(browser, {role:'staff', featureKeys:['shipments.view','bsgt.operations.view']});
    const plainPage = await plain.newPage();
    await plainPage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace`, {waitUntil:'domcontentloaded'});
    await plainPage.locator('#viewBsgtWorkspace.active').waitFor({timeout:20000});
    assert.strictEqual(await plainPage.locator('.bsgt-workspace-tab', {hasText:'مركز الأرشيف'}).count(), 0,
      'archive tab hidden without the archive permission');
    await plain.close();

    // ---------------------------------------------------------- 2) صلاحية الأرشفة، بلا صلاحية إدارة
    const archiver = await createContext(browser, {role:'staff', featureKeys:['shipments.delete'], canPreview:false});
    const page = await archiver.newPage();
    await page.goto(`${APP_ORIGIN}/#v=bsgtWorkspace`, {waitUntil:'domcontentloaded'});
    await page.locator('#viewBsgtWorkspace.active .bsgt-workspace-tab').first().waitFor({timeout:20000});
    assert.strictEqual(await page.locator('.bsgt-workspace-tab').count(), 1, 'only the archive tab is offered');
    assert.strictEqual((await page.locator('.bsgt-workspace-tab').first().textContent()).trim(), 'مركز الأرشيف');

    await openArchive(page);
    await page.locator('.ac-table tbody tr').first().waitFor({timeout:10000});
    const stats = await page.locator('.ac-stat b').allTextContents();
    assert.deepStrictEqual(stats, ['2', '1', '2'], 'summary counts rendered');
    assert.strictEqual(await page.locator('.ac-tab').count(), 3, 'three archive tabs');
    assert.strictEqual(await page.locator('.ac-table tbody tr').count(), 2, 'two archived shipments');
    assert.ok((await page.locator('.ac-table tbody tr').first().textContent()).includes('ARCH-0002'),
      'newest archived shipment first');
    assert.ok((await page.locator('.ac-table tbody tr').nth(1).textContent()).includes('TC-2026-000901'),
      'linked trade file shown on the shipment row');
    assert.ok((await page.locator('.ac-table tbody tr').first().textContent()).includes('غير مرتبطة'),
      'unlinked shipment labelled');

    // بحث
    await page.fill('#acSearch', 'beta');
    await page.click('[data-action="search"]');
    await page.waitForFunction(() => document.querySelectorAll('.ac-table tbody tr').length === 1);
    assert.strictEqual(calls.lists.at(-1).search, 'beta', 'search text reaches the RPC');
    await page.click('[data-action="clear"]');
    await page.waitForFunction(() => document.querySelectorAll('.ac-table tbody tr').length === 2);

    // تبويب الملفات التجارية
    await page.click('.ac-tab[data-tab="files"]');
    await page.waitForFunction(() => document.querySelector('.ac-table th')?.textContent.trim() === 'الملف');
    assert.strictEqual(await page.locator('.ac-table tbody tr').count(), 1);
    const fileRow = await page.locator('.ac-table tbody tr').first().textContent();
    assert.ok(fileRow.includes('قبول نهائي') && fileRow.includes('BANK OF KHARTOUM'), 'trade file row rendered');

    // تبويب المستندات: بلا صلاحية إدارة ⇒ لا زر معاينة
    await page.click('.ac-tab[data-tab="documents"]');
    await page.waitForFunction(() => document.querySelector('.ac-table th')?.textContent.trim() === 'المستند');
    assert.strictEqual(await page.locator('.ac-table tbody tr').count(), 2, 'two archived documents');
    assert.strictEqual(await page.locator('[data-preview]').count(), 0, 'no preview button without management permission');
    assert.strictEqual(await page.locator('.ac-table tbody tr', {hasText:'المعاينة تحتاج صلاحية الإدارة'}).count(), 2);
    const docRows = await page.locator('.ac-table tbody tr').allTextContents();
    assert.ok(docRows[0].includes('التعهد') && docRows[0].includes('مؤرشف بذاته'), 'self-archived document labelled');
    assert.ok(docRows[1].includes('خطاب التحصيل') && docRows[1].includes('تابع لملف مؤرشف'), 'inherited archive labelled');

    // خطأ في القراءة ⇒ رسالة وزر إعادة محاولة
    listFailsOnce = true;
    await page.click('.ac-tab[data-tab="shipments"]');
    await page.locator('.ac-error').waitFor({timeout:10000});
    assert.ok((await page.locator('.ac-error').textContent()).includes('archive read failed'), 'read error surfaced');
    await page.click('.ac-error [data-action="retry"]');
    await page.waitForFunction(() => document.querySelectorAll('.ac-table tbody tr').length === 2);
    assert.strictEqual(await page.locator('.ac-error').count(), 0, 'retry recovers');

    // بطاقة تفاصيل الشحنة المؤرشفة
    await page.click('.ac-table tbody tr:nth-child(2) [data-open-shipment]');
    await page.locator('.ac-detail .ac-fields').first().waitFor({timeout:10000});
    assert.deepStrictEqual(calls.detail.slice(-2).map(c => c.rpc).sort(), ['card','files'],
      'the card and its attachments are fetched together');
    const detailText = await page.locator('.ac-detail').textContent();
    assert.ok(detailText.includes('ARCH-0001') && detailText.includes('ALPHA TRADING'), 'identifying fields shown');
    assert.ok(detailText.includes('TC-2026-000901'), 'linked trade file shown');
    assert.ok(detailText.includes('D/A 90 DAYS') && detailText.includes('MV TEST'),
      'every field of the shipment payload is rendered');
    assert.ok(detailText.includes('شرط الدفع') && detailText.includes('الباخرة'),
      'known payload keys get their Arabic labels');
    assert.strictEqual(await page.locator('[data-preview-shipment-file]').count(), 2, 'both attachments listed');
    assert.ok(detailText.includes('بوليصة الشحن الموقّعة'), 'attachment label shown');

    // معاينة مرفق الشحنة تطلب رابطاً موقّعاً من دلو الشحنات
    const signedBefore = calls.signedUrl.length;
    const shipmentPopup = page.waitForEvent('popup').catch(() => null);
    await page.click('[data-preview-shipment-file]');
    await shipmentPopup;
    assert.ok(calls.signedUrl.length > signedBefore, 'a signed url was requested');
    assert.ok(calls.signedUrl.at(-1).includes('shipment-files/'),
      'the attachment comes from the shipment-files bucket');
    assert.ok(calls.signedUrl.at(-1).includes('invoice-stamped.pdf'), 'for that exact attachment path');

    // الإغلاق
    await page.click('[data-action="close-detail"]');
    assert.strictEqual(await page.locator('.ac-detail').count(), 0, 'closing hides the card');

    // تبديل التبويب يغلق البطاقة تلقائياً
    await page.click('.ac-table tbody tr:nth-child(2) [data-open-shipment]');
    await page.locator('.ac-detail .ac-fields').first().waitFor({timeout:10000});
    await page.click('.ac-tab[data-tab="files"]');
    await page.waitForFunction(() => document.querySelector('.ac-table th')?.textContent.trim() === 'الملف');
    assert.strictEqual(await page.locator('.ac-detail').count(), 0, 'switching tab closes the card');
    await page.click('.ac-tab[data-tab="shipments"]');
    await page.waitForFunction(() => document.querySelectorAll('.ac-table tbody tr').length === 2);

    // شحنة بلا بطاقة ⇒ رسالة خطأ داخل اللوحة وزر إعادة محاولة
    await page.click('.ac-table tbody tr:nth-child(1) [data-open-shipment]');
    await page.locator('.ac-detail .ac-error').waitFor({timeout:10000});
    assert.ok((await page.locator('.ac-detail .ac-error').textContent()).includes('Archived shipment is not available'),
      'a refused card surfaces the server message');
    await page.click('[data-action="close-detail"]');

    // استعادة شحنة
    page.once('dialog', dialog => dialog.accept());
    await page.click('.ac-table tbody tr:first-child [data-restore="shipment"]');
    await page.waitForFunction(() => document.querySelectorAll('.ac-table tbody tr').length === 1);
    assert.deepStrictEqual(calls.restore.at(-1), {p_kind:'shipment', p_id:SHIP_B, p_archived:false},
      'restore goes through the existing set_bsgt_archive RPC with archived=false');

    // استعادة ملف تجاري ⇒ يفرّغ تبويب الملفات والمستندات
    await page.click('.ac-tab[data-tab="files"]');
    await page.waitForFunction(() => document.querySelectorAll('.ac-table tbody tr').length === 1);
    page.once('dialog', dialog => dialog.accept());
    await page.click('[data-restore="trade_file"]');
    await page.locator('.ac-empty').waitFor({timeout:10000});
    assert.deepStrictEqual(calls.restore.at(-1), {p_kind:'trade_file', p_id:FILE_A, p_archived:false});

    // إلغاء التأكيد لا يستدعي شيئاً
    const before = calls.restore.length;
    await page.click('.ac-tab[data-tab="shipments"]');
    await page.waitForFunction(() => document.querySelectorAll('.ac-table tbody tr').length === 1);
    page.once('dialog', dialog => dialog.dismiss());
    await page.click('[data-restore="shipment"]');
    await page.waitForTimeout(300);
    assert.strictEqual(calls.restore.length, before, 'dismissing the confirm calls nothing');

    // الهاتف: لا تمدد أفقي للصفحة
    await page.setViewportSize({width:390, height:844});
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true,
      'archive center fits a phone width');
    await archiver.close();

    // ---------------------------------------------------------- 3) أرشفة + إدارة ⇒ معاينة
    db.documents.push({id:'cccc3333-3333-4333-8333-333333333333', trade_file_id:FILE_A,
      trade_file_operation_no:'TC-2026-000901', trade_file_status:'final_accepted', document_type:'letter',
      file_name:'خطاب التحصيل الموقّع.pdf', storage_path:`${FILE_A}/letter-r2.pdf`, mime_type:'application/pdf',
      file_size:34567, revision_no:2, is_active:true, document_archived_at:'2026-09-02T12:00:00Z',
      file_archived_at:null, uploaded_by_name:'ARCH MANAGER', created_at:'2026-08-20T09:00:00Z'});
    const manager = await createContext(browser, {role:'staff',
      featureKeys:['shipments.delete', 'bsgt.management.view'], canPreview:true});
    const managerPage = await manager.newPage();
    await openArchive(managerPage);
    await managerPage.click('.ac-tab[data-tab="documents"]');
    await managerPage.locator('[data-preview]').first().waitFor({timeout:10000});
    const popup = managerPage.waitForEvent('popup').catch(() => null);
    await managerPage.click('[data-preview]');
    await popup;
    assert.ok(calls.signedUrl.some(p => p.includes('letter-r2.pdf')),
      'preview asks the storage bucket for a signed url of that exact path');
    await manager.close();

    // ---------------------------------------------------------- 4) المدير يرى القسم دائماً
    const admin = await createContext(browser, {role:'admin', featureKeys:[], canPreview:true});
    const adminPage = await admin.newPage();
    await adminPage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace`, {waitUntil:'domcontentloaded'});
    await adminPage.locator('#viewBsgtWorkspace.active .bsgt-workspace-tab').first().waitFor({timeout:20000});
    assert.strictEqual(await adminPage.locator('.bsgt-workspace-tab', {hasText:'مركز الأرشيف'}).count(), 1,
      'admin sees the archive tab');
    assert.ok(adminPage.url().includes('section=operations'),
      'archive center never becomes the default landing section');
    await admin.close();

    console.log('BSGT archive center browser: passed');
  } finally {
    if(browser) await browser.close();
    server.kill();
  }
}

main().catch(error => { console.error(error); process.exit(1); });
