'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {chromium} = require('playwright-core');

const PORT = 4600 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_ORIGIN = `http://jahez.test:${PORT}`;
const SUPABASE_ORIGIN = 'https://vthcmqqiexaedukduquv.supabase.co';

function chromiumPath(){
  return [process.env.CHROMIUM_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find(fs.existsSync);
}

async function waitForServer(process){
  for(let attempt=0; attempt<50; attempt++){
    if(process.exitCode !== null) throw new Error(`server exited early with code ${process.exitCode}`);
    try{ if((await fetch(`${BASE}/healthz`)).ok) return; }catch{}
    await new Promise(resolve=>setTimeout(resolve, 200));
  }
  throw new Error('server did not start');
}

function fakeJwt(exp){
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'employee-1',exp,aud:'authenticated'})}.signature`;
}

async function createContext(browser, role, permissions, featureKeys = []){
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  const profile = {id:'employee-1', email:`${role}@example.test`, display_name:`موظف ${role}`, role, active:true, photo_url:'',feature_permissions_initialized:true};
  const expiresAt = Math.floor(Date.now()/1000) + 3600;
  await context.addInitScript(({profile, expiresAt, token})=>{
    localStorage.setItem('shipdocs-auth', JSON.stringify({
      access_token:token, refresh_token:'refresh-token', expires_at:expiresAt,
      expires_in:3600, token_type:'bearer',
      user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}
    }));
  }, {profile, expiresAt, token:fakeJwt(expiresAt)});
  await context.route(`${SUPABASE_ORIGIN}/**`, async route=>{
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'Access-Control-Allow-Origin':APP_ORIGIN,
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info',
      'Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      'Content-Type':'application/json'
    };
    if(request.method()==='OPTIONS') return route.fulfill({status:204, headers, body:''});
    if(url.pathname==='/rest/v1/profiles') return route.fulfill({status:200, headers, body:JSON.stringify([profile])});
    if(url.pathname==='/rest/v1/rpc/get_user_feature_permissions') return route.fulfill({status:200,headers,body:JSON.stringify(featureKeys.map(permission_key=>({permission_key,allowed:true})))});
    if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions') return route.fulfill({status:200, headers, body:JSON.stringify(permissions)});
    if(url.pathname==='/rest/v1/companies') return route.fulfill({status:200, headers, body:JSON.stringify([{id:'bsgt-company',name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',active:true,is_default:false,sort_order:1,settings:{}}])});
    if(url.pathname==='/rest/v1/shipments') return route.fulfill({status:200, headers, body:'[]'});
    if(request.method()==='HEAD') return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});
    return route.fulfill({status:200, headers, body:'[]'});
  });
  return context;
}

async function main(){
  const executablePath = chromiumPath();
  if(!executablePath) throw new Error('Chrome or Chromium executable was not found.');
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env:{...process.env, PORT:String(PORT), BUILD_SHA:'bsgt-workspace-browser-test'},
    stdio:['ignore','inherit','inherit']
  });
  let browser;
  try{
    await waitForServer(server);
    browser = await chromium.launch({executablePath, headless:true, args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});

    const adminContext = await createContext(browser, 'admin', []);
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace`, {waitUntil:'domcontentloaded'});
    await adminPage.locator('#viewBsgtWorkspace.active .bsgt-workspace-tab').first().waitFor({timeout:20000});
    assert.strictEqual(await adminPage.locator('.bsgt-workspace-tab').count(), 9);
    assert.deepStrictEqual(await adminPage.locator('.bsgt-workspace-tab').allTextContents(), ['العمليات','المركز المالي','المالية','الإدارة','العلاقات التجارية','ملفات العمليات التجارية','الملفات المُرسلة للبنك','مركز العمليات','مركز الأرشيف']);
    assert.strictEqual((await adminPage.locator('#navBsgt').textContent()).trim(), 'مساحة BSGT');
    assert.ok(adminPage.url().includes('section=operations'));
    const fileId='11111111-1111-4111-8111-111111111111',shipmentId='22222222-2222-4222-8222-222222222222',revisionId='33333333-3333-4333-8333-333333333333';
    const documents=[{id:'44444444-4444-4444-8444-444444444444',document_type:'letter',document_variant:'finance_original',is_active:true,revision_no:2,file_name:'original.pdf'},
      {id:'55555555-5555-4555-8555-555555555555',document_type:'letter',document_variant:'administration_signed',is_active:false,revision_no:1,file_name:'signed-history.pdf'}];
    const files=Array.from({length:25},(_,i)=>({id:i===0?fileId:`file-${i}`,company_id:'bsgt-company',operation_no:`TC-2026-${String(i+1).padStart(6,'0')}`,status:i===0?'sent_to_collecting':'draft',revision_no:2,created_at:'2026-09-15T00:00:00Z',remitting_bank:'TEST BANK'}));
    const previewRequests=[],tableReads=[];
    await adminPage.evaluate(()=>{
      window.__tradePrintCalls=[];
      document.addEventListener('load',event=>{
        const frame=event.target;if(!frame.matches?.('iframe[data-print-frame]'))return;
        frame.contentWindow.print=()=>window.__tradePrintCalls.push({src:frame.src,srcdoc:frame.srcdoc});
      },true);
    });
    async function verifyPreviewActions(expectedBytes,extension='pdf'){
      await adminPage.locator('.bsgt-trade-preview [data-download]:not([disabled])').waitFor();
      const pending=adminPage.waitForEvent('download');
      await adminPage.locator('.bsgt-trade-preview [data-download]').click();
      const download=await pending,chunks=[];
      for await(const chunk of await download.createReadStream())chunks.push(chunk);
      assert.deepStrictEqual(Buffer.concat(chunks),expectedBytes,'download preserves exact preview bytes');
      assert.ok(download.suggestedFilename().endsWith(`.${extension}`));
      const before=await adminPage.evaluate(()=>window.__tradePrintCalls.length);
      await adminPage.locator('.bsgt-trade-preview [data-print]').click();
      await adminPage.waitForFunction(count=>window.__tradePrintCalls.length===count+1,before);
      const print=await adminPage.evaluate(()=>window.__tradePrintCalls.at(-1));
      assert.ok(extension==='pdf'?print.src.startsWith('blob:'):print.srcdoc.includes('<img'),'print only the document in an isolated frame');
      await adminPage.setViewportSize({width:390,height:844});
      assert.strictEqual(await adminPage.locator('.bsgt-trade-preview').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'print/download toolbar fits mobile');
      await adminPage.setViewportSize({width:1440,height:900});
    }
    await adminContext.route(`${SUPABASE_ORIGIN}/rest/v1/trade_collection*`,async route=>{
      const request=route.request(),url=new URL(request.url()),table=url.pathname.split('/').pop();
      assert.strictEqual(request.method(),'GET','trade file portal is read-only');tableReads.push(table);
      let data=[];const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':APP_ORIGIN,'Access-Control-Expose-Headers':'Content-Range'};
      if(table==='trade_collection_files'){
        if(url.searchParams.has('id'))data=files[0];
        else{
          assert.strictEqual(url.searchParams.get('company_id'),'eq.bsgt-company');
          let matches=files;
          if(url.searchParams.has('operation_no'))matches=matches.filter(f=>f.operation_no.includes('000025'));
          if(url.searchParams.has('status'))matches=matches.filter(f=>f.status===url.searchParams.get('status').slice(3));
          const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||24);
          data=matches.slice(offset,offset+limit);headers['Content-Range']=`${offset}-${offset+data.length-1}/${matches.length}`;
        }
      }else if(table==='trade_collection_file_shipments')data=[{id:'link',shipment_id:shipmentId,operations_revision_id:revisionId},{id:'link-2',shipment_id:'77777777-7777-4777-8777-777777777777',operations_revision_id:'88888888-8888-4888-8888-888888888888'}];
      else if(table==='trade_collection_file_documents')data=documents;
      else if(table==='trade_collection_relations_attachments')data=[{id:'66666666-6666-4666-8666-666666666666',attachment_type:'company_letter',original_name:'company.pdf',revision_no:2,is_active:true}];
      else if(table==='trade_collection_file_events')data=[{id:'event',event_type:'sent_to_collecting',revision_no:2,created_at:'2026-09-15',note:'Test event'}];
      return route.fulfill({status:200,headers,body:JSON.stringify(data)});
    });
    await adminContext.route(`${SUPABASE_ORIGIN}/rest/v1/bsgt_operations_revisions*`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:revisionId,revision_no:3,shipment_snapshot:{id:shipmentId,data:{operationNo:'BSGTX-2026-0001'}},documents:[{kind:'invoice',path:'unused'}]},{id:'88888888-8888-4888-8888-888888888888',revision_no:2,shipment_snapshot:{id:'77777777-7777-4777-8777-777777777777',data:{operationNo:'BSGTX-2026-0002'}},documents:[{kind:'packing',path:'unused-2'}]}])}));
    const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');const pdf=await PDFDocument.create();pdf.addPage();const encoded=Buffer.from(await pdf.save()).toString('base64');
    await adminContext.route(`${APP_ORIGIN}/api/bsgt-trade-file-preview`,route=>{previewRequests.push(route.request().postDataJSON());return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({mimeType:'application/pdf',base64:encoded})});});
    await adminPage.getByRole('button',{name:'ملفات العمليات التجارية',exact:true}).click();
    await adminPage.locator('#bsgtTradeFiles [data-file]').first().waitFor();
    assert.strictEqual(await adminPage.locator('#bsgtTradeFiles [data-file]').count(),24);
    await adminPage.locator('#bsgtTradeFiles [data-next]').click();
    await adminPage.getByText('TC-2026-000025',{exact:true}).waitFor();
    assert.strictEqual(await adminPage.locator('#bsgtTradeFiles [data-file]').count(),1);
    await adminPage.locator('#bsgtTradeFiles [data-search]').fill('000025');
    await adminPage.waitForFunction(()=>document.querySelector('#bsgtTradeFiles [data-count]').textContent.startsWith('1 ملف'));
    await adminPage.locator('#bsgtTradeFiles [data-search]').fill('');
    await adminPage.locator('#bsgtTradeFiles [data-status]').selectOption('sent_to_collecting');
    await adminPage.locator(`#bsgtTradeFiles [data-file="${fileId}"]`).waitFor();
    await adminPage.locator(`#bsgtTradeFiles [data-file="${fileId}"]`).click();
    await adminPage.locator('#bsgtTradeFiles [data-shipment-preview]').first().waitFor();
    assert.strictEqual(await adminPage.locator('#bsgtTradeFiles [data-shipment-preview]').count(),2,'one complete preview per linked shipment');
    assert.strictEqual(await adminPage.locator('#bsgtTradeFiles [data-preview]').first().isVisible(),false,'individual documents are secondary, collapsed by default');
    for(const id of [shipmentId,'77777777-7777-4777-8777-777777777777']){
      await adminPage.locator(`#bsgtTradeFiles [data-shipment-preview="${id}"]`).click();
      await adminPage.locator('.bsgt-trade-preview canvas[data-rendered=true]').waitFor();
      await verifyPreviewActions(Buffer.from(encoded,'base64'));
      await adminPage.locator('.bsgt-trade-preview [data-close]').click();
      await adminPage.locator('iframe[data-print-frame]').waitFor({state:'detached'});
      assert.strictEqual(await adminPage.locator('iframe[data-print-frame]').count(),0,'closing preview removes print frame');
      assert.strictEqual(previewRequests.at(-1).documentId,id);
    }
    await adminPage.locator('#bsgtTradeFiles details summary').click();
    assert.match(await adminPage.locator('#bsgtTradeFiles [data-detail]').innerText(),/نسخة موقعة.*المراجعة 1/);
    assert.strictEqual(await adminPage.locator('#bsgtTradeFiles [data-preview]').count(),7,'original, historical signed, relations attachment and saved sources for BOTH shipments');
    assert.match(await adminPage.locator('#bsgtTradeFiles [data-detail]').innerText(),/BSGTX-2026-0002/);
    for(const i of [0,2,3]){
      await adminPage.locator('#bsgtTradeFiles [data-preview]').nth(i).click();
      await adminPage.locator('.bsgt-trade-preview canvas[data-rendered=true]').waitFor();
      await adminPage.locator('.bsgt-trade-preview [data-close]').click();
    }
    assert.deepStrictEqual(previewRequests.map(r=>r.source),['shipment','shipment','collection','relations','operations']);
    assert.ok(previewRequests.every(r=>r.fileId===fileId&&!r.path));
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S0AAAAASUVORK5CYII=','base64');
    await adminContext.route(`${APP_ORIGIN}/api/bsgt-trade-file-preview`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({mimeType:'image/png',base64:png.toString('base64')})}));
    await adminPage.locator('#bsgtTradeFiles [data-preview]').first().click();
    await verifyPreviewActions(png,'png');
    await adminPage.locator('.bsgt-trade-preview [data-close]').click();
    await adminContext.route(`${APP_ORIGIN}/api/bsgt-trade-file-preview`,route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Preview denied'})}));
    await adminPage.locator('#bsgtTradeFiles [data-preview]').first().click();
    await adminPage.getByText('Preview denied',{exact:true}).waitFor();
    assert.ok(await adminPage.locator('.bsgt-trade-preview [data-print]').isDisabled());
    assert.ok(await adminPage.locator('.bsgt-trade-preview [data-download]').isDisabled());
    await adminPage.locator('.bsgt-trade-preview [data-close]').click();
    await adminPage.setViewportSize({width:390,height:844});
    assert.strictEqual(await adminPage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'trade files fit mobile width');
    await adminPage.setViewportSize({width:1440,height:900});
    await adminPage.reload({waitUntil:'domcontentloaded'});
    await adminPage.locator('#bsgtTradeFiles').waitFor({timeout:20000});
    assert.ok(adminPage.url().includes('section=tradeFiles'),'refresh stays in the independent portal');
    await adminContext.unroute(`${SUPABASE_ORIGIN}/rest/v1/trade_collection*`);
    const scopedRequest = adminPage.waitForRequest(request=>{
      const url = new URL(request.url());
      return url.pathname==='/rest/v1/shipments' && url.searchParams.get('company_id')===`eq.bsgt-company`;
    });
    await adminPage.getByRole('button',{name:'مركز العمليات',exact:true}).click();
    await scopedRequest;
    await adminPage.locator('[data-operation-center-root="bsgt"]').waitFor();
    assert.ok(adminPage.url().includes('section=operationCenter'));
    await adminPage.reload({waitUntil:'domcontentloaded'});
    await adminPage.locator('[data-operation-center-root="bsgt"]').waitFor({timeout:20000});
    assert.ok(adminPage.url().includes('section=operationCenter'));
    await adminPage.getByRole('button',{name:'المالية',exact:true}).click();
    await adminPage.goBack();
    await adminPage.locator('[data-operation-center-root="bsgt"]').waitFor({timeout:20000});
    assert.ok(adminPage.url().includes('section=operationCenter'));
    await adminPage.evaluate(()=>switchView('operationCenter'));
    await adminPage.locator('#viewOperationCenter.active [data-operation-center-root="general"]').waitFor();
    await adminContext.close();

    const financeContext = await createContext(browser, 'editor', [{section:'finance',can_view:true,can_edit:true}], ['bsgt.finance.view','bsgt.finance.edit']);
    const financePage = await financeContext.newPage();
    await financePage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=operations`, {waitUntil:'domcontentloaded'});
    await financePage.locator('#viewBsgtWorkspace.active .bsgt-workspace-tab').first().waitFor({timeout:20000});
    assert.strictEqual(await financePage.locator('.bsgt-workspace-tab').count(), 2);
    assert.deepStrictEqual(await financePage.locator('.bsgt-workspace-tab').allTextContents(), ['المالية','ملفات العمليات التجارية']);
    assert.ok(financePage.url().includes('section=finance'));
    assert.strictEqual(await financePage.locator('.bsgt-workspace-readonly').count(), 0);
    await financeContext.close();

    const viewerContext = await createContext(browser, 'viewer', [{section:'finance',can_view:true,can_edit:true}], ['bsgt.finance.view','bsgt.finance.edit']);
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=finance`, {waitUntil:'domcontentloaded'});
    await viewerPage.locator('#viewBsgtWorkspace.active .bsgt-workspace-readonly').waitFor({timeout:20000});
    assert.strictEqual(await viewerPage.locator('.bsgt-workspace-tab').count(), 2);
    assert.strictEqual(await viewerPage.evaluate(()=>document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await viewerContext.close();

    const centerContext = await createContext(browser, 'staff', [{section:'operations',can_view:true,can_edit:true}], ['bsgt.operations.view','bsgt.operation_center.view']);
    const centerPage = await centerContext.newPage();
    await centerPage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=operationCenter`, {waitUntil:'domcontentloaded'});
    await centerPage.locator('[data-operation-center-root="bsgt"]').waitFor({timeout:20000});
    assert.deepStrictEqual(await centerPage.locator('.bsgt-workspace-tab').allTextContents(), ['العمليات','مركز العمليات']);
    await centerContext.close();

    const operationsContext = await createContext(browser, 'staff', [{section:'operations',can_view:true,can_edit:true}], ['bsgt.operations.view']);
    const operationsPage = await operationsContext.newPage();
    await operationsPage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=operations`, {waitUntil:'domcontentloaded'});
    await operationsPage.locator('.bsgt-operations').waitFor({timeout:20000});
    assert.deepStrictEqual(await operationsPage.locator('.bsgt-workspace-tab').allTextContents(), ['العمليات']);
    assert.strictEqual(await operationsPage.getByText('مركز عمليات BSGT غير مسند إلى حسابك').count(), 0);
    await operationsContext.close();

    const blockedContext = await createContext(browser, 'editor', [], []);
    const blockedPage = await blockedContext.newPage();
    await blockedPage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=finance`, {waitUntil:'domcontentloaded'});
    await blockedPage.locator('#employeeTopNav:not([hidden])').waitFor({timeout:20000});
    await blockedPage.waitForFunction(()=>location.hash === '#v=dashboard', null, {timeout:20000});
    await blockedPage.locator('#viewDashboard.active').waitFor({timeout:20000});
    assert.ok(blockedPage.url().includes('#v=dashboard'));
    await blockedContext.close();

    console.log('BSGT workspace route and browser permissions: passed');
  } finally {
    if(browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch(error=>{ console.error(error); process.exit(1); });
