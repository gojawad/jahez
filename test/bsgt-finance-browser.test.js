'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {chromium} = require('playwright-core');

const PORT = 4900 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_ORIGIN = `http://jahez.test:${PORT}`;
const SUPABASE_ORIGIN = 'https://vthcmqqiexaedukduquv.supabase.co';
const companyId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const shipmentIds = ['11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111112'];
const tradeFileId = '55555555-5555-4555-8555-555555555555';

function chromiumPath(){ return [process.env.CHROMIUM_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find(fs.existsSync); }
async function waitForServer(process){ for(let attempt=0;attempt<50;attempt++){ if(process.exitCode!==null) throw new Error(`server exited early with code ${process.exitCode}`); try{if((await fetch(`${BASE}/healthz`)).ok)return;}catch{} await new Promise(resolve=>setTimeout(resolve,200)); } throw new Error('server did not start'); }
function fakeJwt(exp){ const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url'); return `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:userId,exp,aud:'authenticated'})}.signature`; }
function shipmentRow(id,index,stage='ready_for_finance'){
  return {id,owner_id:userId,company_id:companyId,status:'sent',review_note:null,due_date:null,credit_days:null,due_from:null,bol_template_id:null,workflow_stage:'created',workflow_updated_at:'2026-09-12T06:00:00Z',bank_sent_at:null,signed_at:null,accepted_at:null,accepted_by:null,bsgt_stage:stage,bsgt_stage_updated_at:'2026-09-12T07:00:00Z',operations_completed_at:'2026-09-12T07:00:00Z',operations_completed_by:userId,created_at:'2026-09-12T06:00:00Z',updated_at:'2026-09-12T07:00:00Z',data:{operationNo:`BSGTX-2026-010${index}`,consignee:`BUYER ${index}`,itemDesc:`GOODS ${index}`,invoiceNo:`INV-${index}`,billNo:`BL-${index}`,currency:'USD',totalAmount:`USD ${index*1000}.00`}};
}

async function main(){
  const executablePath=chromiumPath(); if(!executablePath) throw new Error('Chrome or Chromium executable was not found.');
  const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(PORT),BUILD_SHA:'bsgt-finance-browser-test'},stdio:['ignore','inherit','inherit']});
  let browser;
  try{
    await waitForServer(server); browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    const context=await browser.newContext({viewport:{width:1440,height:900}}), profile={id:userId,email:'finance@example.test',display_name:'موظف المالية',role:'editor',active:true,photo_url:''};
    const expiresAt=Math.floor(Date.now()/1000)+3600;
    await context.addInitScript(({profile,expiresAt,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'refresh-token',expires_at:expiresAt,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})),{profile,expiresAt,token:fakeJwt(expiresAt)});
    let created=false,sent=false,createCalls=0,sendCalls=0;
    await context.route(`${SUPABASE_ORIGIN}/**`,async route=>{
      const request=route.request(), url=new URL(request.url());
      const headers={'Access-Control-Allow-Origin':APP_ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};
      if(request.method()==='OPTIONS') return route.fulfill({status:204,headers,body:''});
      if(url.pathname==='/rest/v1/profiles') return route.fulfill({status:200,headers,body:JSON.stringify([profile])});
      if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions') return route.fulfill({status:200,headers,body:JSON.stringify([{section:'finance',can_view:true,can_edit:true}])});
      if(url.pathname==='/rest/v1/rpc/create_bsgt_trade_collection_file'){ createCalls++; created=true; return route.fulfill({status:200,headers,body:JSON.stringify({id:tradeFileId,operation_no:'TC-2026-000123',company_id:companyId,status:'draft',created_by:userId,created_at:'2026-09-12T08:00:00Z',metadata:{}})}); }
      if(url.pathname==='/rest/v1/rpc/send_bsgt_trade_file_to_remitting'){ sendCalls++; sent=true; return route.fulfill({status:200,headers,body:JSON.stringify({id:tradeFileId,operation_no:'TC-2026-000123',company_id:companyId,status:'sent_to_remitting',created_by:userId,created_at:'2026-09-12T08:00:00Z',sent_to_remitting_at:'2026-09-12T09:00:00Z',remitting_bank:'Abu Dhabi Islamic Bank',metadata:{currency:'USD'}})}); }
      if(url.pathname==='/rest/v1/companies') return route.fulfill({status:200,headers,body:JSON.stringify([{id:companyId,name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',active:true,is_default:false,sort_order:1,settings:{}}])});
      if(url.pathname==='/rest/v1/trade_collection_files') return route.fulfill({status:200,headers,body:JSON.stringify(created?[{id:tradeFileId,operation_no:'TC-2026-000123',company_id:companyId,status:sent?'sent_to_remitting':'draft',created_by:userId,created_at:'2026-09-12T08:00:00Z',sent_to_remitting_at:sent?'2026-09-12T09:00:00Z':null,remitting_bank:sent?'Abu Dhabi Islamic Bank':null,metadata:{}}]:[])});
      if(url.pathname==='/rest/v1/trade_collection_file_shipments') return route.fulfill({status:200,headers,body:JSON.stringify(created?shipmentIds.map((shipment_id,index)=>({id:`66666666-6666-4666-8666-66666666666${index}`,trade_file_id:tradeFileId,shipment_id,created_at:'2026-09-12T08:00:00Z'})):[])});
      if(url.pathname==='/rest/v1/shipments'){
        const rows=shipmentIds.map((id,index)=>shipmentRow(id,index+1,sent?'sent_to_remitting':'ready_for_finance'));
        return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-1/2'},body:JSON.stringify(rows)});
      }
      if(request.method()==='HEAD') return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});
      return route.fulfill({status:200,headers,body:'[]'});
    });
    const page=await context.newPage(); page.on('dialog',dialog=>dialog.accept());
    await page.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=finance`,{waitUntil:'domcontentloaded'});
    await page.locator('[data-bsgt-finance-select]').first().waitFor({timeout:20000});
    assert.strictEqual(await page.locator('[data-bsgt-finance-select]').count(),2);
    await page.locator('[data-bsgt-finance-select]').first().check();
    await page.locator('[data-bsgt-finance-select]').last().check();
    assert.strictEqual(await page.locator('#bsgtFinanceSelectedCount').textContent(),'2');
    await page.locator('#bsgtFinanceCreateBtn').click();
    await page.locator('#bsgtFinanceConfirm:not([hidden])').waitFor();
    assert.ok((await page.locator('#bsgtFinanceConfirmBody').textContent()).includes('BSGTX-2026-0101'));
    await page.locator('#bsgtFinanceConfirmSubmit').click();
    await page.locator('.bsgt-finance-detail').waitFor();
    assert.strictEqual(createCalls,1);
    assert.ok((await page.locator('.bsgt-finance-detail-header').textContent()).includes('TC-2026-000123'));
    assert.ok((await page.locator('.bsgt-finance-detail').textContent()).includes('2'));
    assert.ok((await page.locator('.bsgt-finance-detail-actions a').getAttribute('href')).includes(`tradeFileId=${tradeFileId}`));
    await page.locator('#bsgtTradeSend').click();
    await page.waitForFunction(()=>document.querySelector('.bsgt-finance-detail')?.textContent.includes('تم الإرسال للبنك المرسل'));
    assert.strictEqual(sendCalls,1); assert.strictEqual(sent,true);
    await context.close(); console.log('BSGT finance multi-select, trade-file details, portal link, and send: passed');
  } finally { if(browser) await browser.close(); server.kill('SIGTERM'); }
}

main().catch(error=>{console.error(error);process.exit(1);});
