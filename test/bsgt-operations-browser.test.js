'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {chromium} = require('playwright-core');

const PORT = 4800 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_ORIGIN = `http://jahez.test:${PORT}`;
const SUPABASE_ORIGIN = 'https://vthcmqqiexaedukduquv.supabase.co';
const shipmentId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

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
  return `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:userId,exp,aud:'authenticated'})}.signature`;
}

function shipmentRow(stage = 'operations_draft'){
  return {
    id:shipmentId, owner_id:userId, company_id:companyId, status:'sent', review_note:null,
    due_date:null, credit_days:null, due_from:null, bol_template_id:null,
    workflow_stage:'created', workflow_updated_at:'2026-09-12T06:00:00Z', bank_sent_at:null,
    signed_at:null, accepted_at:null, accepted_by:null, bsgt_stage:stage,
    bsgt_stage_updated_at:'2026-09-12T06:00:00Z', operations_completed_at:stage==='ready_for_finance'?'2026-09-12T07:00:00Z':null,
    operations_completed_by:stage==='ready_for_finance'?userId:null,
    created_at:'2026-09-12T06:00:00Z', updated_at:'2026-09-12T06:00:00Z',
    data:{operationNo:'BSGTX-2026-0099',consignee:'TEST BUYER',itemDesc:'TEST GOODS',proformaNo:'PI-99',invoiceNo:'INV-99',billNo:'BL-99',qty:'10',totalAmount:'USD 100.00'}
  };
}

const files = [
  {id:'44444444-4444-4444-8444-444444444441',shipment_id:shipmentId,document_type:'import_permit',label:'إذن الاستيراد',name:'permit.pdf',path:`${shipmentId}/permit.pdf`,mime:'application/pdf',size_bytes:100,created_at:'2026-09-12T06:10:00Z'},
  {id:'44444444-4444-4444-8444-444444444442',shipment_id:shipmentId,document_type:'certificate_of_origin',label:'شهادة المنشأ',name:'origin.pdf',path:`${shipmentId}/origin.pdf`,mime:'application/pdf',size_bytes:100,created_at:'2026-09-12T06:11:00Z'},
  {id:'44444444-4444-4444-8444-444444444443',shipment_id:shipmentId,document_type:'bill_of_lading',label:'بوليصة الشحن',name:'bol.pdf',path:`${shipmentId}/bol.pdf`,mime:'application/pdf',size_bytes:100,created_at:'2026-09-12T06:12:00Z'}
];

async function main(){
  const executablePath = chromiumPath();
  if(!executablePath) throw new Error('Chrome or Chromium executable was not found.');
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {env:{...process.env,PORT:String(PORT),BUILD_SHA:'bsgt-operations-browser-test'},stdio:['ignore','inherit','inherit']});
  let browser;
  try{
    await waitForServer(server);
    browser = await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    const context = await browser.newContext({viewport:{width:1440,height:900}});
    const profile = {id:userId,email:'operations@example.test',display_name:'موظف العمليات',role:'editor',active:true,photo_url:''};
    const expiresAt = Math.floor(Date.now()/1000)+3600;
    await context.addInitScript(({profile,expiresAt,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'refresh-token',expires_at:expiresAt,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})), {profile,expiresAt,token:fakeJwt(expiresAt)});
    let shipmentFileReads = 0;
    let completeCalls = 0;
    let currentStage = 'operations_draft';
    await context.route(`${APP_ORIGIN}/api/commodity-image**`, route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({imageUrl:null,thumbnailUrl:null,fallback:true})}));
    await context.route(`${SUPABASE_ORIGIN}/**`, async route=>{
      const request = route.request();
      const url = new URL(request.url());
      const headers = {'Access-Control-Allow-Origin':APP_ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};
      if(request.method()==='OPTIONS') return route.fulfill({status:204,headers,body:''});
      if(url.pathname==='/rest/v1/profiles') return route.fulfill({status:200,headers,body:JSON.stringify([profile])});
      if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions') return route.fulfill({status:200,headers,body:JSON.stringify([{section:'operations',can_view:true,can_edit:true}])});
      if(url.pathname==='/rest/v1/rpc/complete_bsgt_operations'){
        completeCalls++;
        currentStage = 'ready_for_finance';
        return route.fulfill({status:200,headers,body:JSON.stringify(shipmentRow(currentStage))});
      }
      if(url.pathname==='/rest/v1/companies') return route.fulfill({status:200,headers,body:JSON.stringify([{id:companyId,name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',active:true,is_default:false,sort_order:1,settings:{}}])});
      if(url.pathname==='/rest/v1/shipments'){
        const single = String(request.headers().accept||'').includes('vnd.pgrst.object');
        return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/1'},body:JSON.stringify(single?shipmentRow(currentStage):[shipmentRow(currentStage)])});
      }
      if(url.pathname==='/rest/v1/shipment_files'){
        shipmentFileReads++;
        return route.fulfill({status:200,headers,body:JSON.stringify(files)});
      }
      if(request.method()==='HEAD') return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});
      return route.fulfill({status:200,headers,body:'[]'});
    });

    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console',message=>{if(message.type()==='error') consoleErrors.push(message.text());});
    page.on('dialog', dialog=>dialog.accept());
    await page.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=operations`, {waitUntil:'domcontentloaded'});
    await page.locator('.bsgt-operations-row:not(.is-head)').waitFor({timeout:20000});
    assert.strictEqual(await page.locator('.bsgt-operations-row:not(.is-head)').count(), 1);
    assert.strictEqual((await page.locator('.bsgt-operations-row-copy em').textContent()).replace(/\s+/g,' ').trim(), '7/7 متطلبات');
    assert.strictEqual(shipmentFileReads, 1, 'the paginated list must use one bulk file query');

    for(const width of [390,768]){
      await page.setViewportSize({width,height:900});
      assert.strictEqual(await page.locator('.bsgt-operations-navigator').isVisible(), true, `${width}px shows the list first`);
      assert.strictEqual(await page.locator('.bsgt-operations-detail').isVisible(), false, `${width}px hides details before selection`);
      assert.strictEqual(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), true, `${width}px has no horizontal overflow`);
      await page.locator('[data-bsgt-operation-open]').click();
      assert.strictEqual(await page.locator('.bsgt-operations-detail').isVisible(), true, `${width}px opens full detail`);
      assert.strictEqual(await page.locator('.bsgt-operations-mobile-back').isVisible(), true, `${width}px provides a back button`);
      await page.locator('#bsgtOperationsMobileBack').click();
    }
    await page.setViewportSize({width:1440,height:900});
    assert.strictEqual(await page.locator('.bsgt-operations-navigator').isVisible(), true, 'desktop shows navigator');
    assert.strictEqual(await page.locator('.bsgt-operations-detail').isVisible(), true, 'desktop shows inline detail');
    assert.strictEqual(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), true, 'desktop has no horizontal overflow');
    await page.locator('[data-bsgt-operation-open]').click();
    await page.locator('[data-bsgt-ops-tab="documents"]').click();
    await page.locator('#bsgtOperationsDocumentsPanel').waitFor();
    await page.waitForFunction(()=>document.querySelector('#bsgtOperationsDocumentsPanel')?.textContent.includes('7 / 7'));
    assert.strictEqual(await page.locator('#bsgtSendToFinanceBtn:not([disabled])').count(), 1);
    await page.locator('#bsgtSendToFinanceBtn').click();
    await page.waitForFunction(()=>document.querySelector('#bsgtOperationsDocumentsPanel')?.textContent.includes('تم الإرسال للمالية'));
    assert.strictEqual(completeCalls, 1);
    assert.ok(shipmentFileReads >= 2, 'list is bulk-loaded and submit must re-fetch files');
    assert.strictEqual(currentStage, 'ready_for_finance');
    assert.deepStrictEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(' | ')}`);
    await context.close();
    console.log('BSGT operations list, readiness, re-verification, and submit: passed');
  } finally {
    if(browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch(error=>{console.error(error);process.exit(1);});
