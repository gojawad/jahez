'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');
const {chromium}=require('playwright-core');
const PORT=4900+Math.floor(Math.random()*100);
const BASE=`http://127.0.0.1:${PORT}`;
const APP=`http://jahez.test:${PORT}`;
const SUPABASE='https://vthcmqqiexaedukduquv.supabase.co';
const profile={id:'employee-1',email:'manager@example.test',display_name:'مدير الاختبار',role:'editor',active:true,photo_url:''};
const company={id:'bsgt-company',name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',active:true,is_default:false,sort_order:1,settings:{}};
const tradeId='10000000-0000-4000-8000-000000000001';
const shipmentId='20000000-0000-4000-8000-000000000001';
function executable(){return ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);}
function jwt(){const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');return `${enc({alg:'HS256'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})}.x`;}
async function waitServer(proc){for(let i=0;i<50;i++){if(proc.exitCode!==null)throw Error('server exited');try{if((await fetch(`${BASE}/healthz`)).ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('server timeout');}

async function main(){
  const browserPath=executable();if(!browserPath)throw Error('Chrome not found');
  const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','inherit','inherit']});let browser;
  try{
    await waitServer(server);browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    const context=await browser.newContext({viewport:{width:1440,height:900}});const exp=Math.floor(Date.now()/1000)+3600;
    await context.addInitScript(({profile,exp,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'r',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})),{profile,exp,token:jwt()});
    let status='sent_to_remitting',startCalls=0;
    await context.route(`${SUPABASE}/**`,async route=>{const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':APP,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
      if(url.pathname==='/rest/v1/profiles')return route.fulfill({status:200,headers,body:JSON.stringify([profile])});
      if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions')return route.fulfill({status:200,headers,body:JSON.stringify([{section:'management',can_view:true,can_edit:true}])});
      if(url.pathname==='/rest/v1/rpc/start_bsgt_management_review'){startCalls++;status='under_management_review';return route.fulfill({status:200,headers,body:'{}'});}
      if(url.pathname==='/rest/v1/companies')return route.fulfill({status:200,headers,body:JSON.stringify([company])});
      if(url.pathname==='/rest/v1/trade_collection_files')return route.fulfill({status:200,headers,body:JSON.stringify([{id:tradeId,operation_no:'TC-2026-000321',company_id:company.id,status,revision_no:1,created_by:profile.id,created_at:'2026-09-12T10:00:00Z',updated_at:'2026-09-12T10:00:00Z',remitting_bank:'ADIB',metadata:{documentKinds:['letter','undertaking','exchange'],currency:'USD'}}])});
      if(url.pathname==='/rest/v1/trade_collection_file_shipments')return route.fulfill({status:200,headers,body:JSON.stringify([{id:'link',trade_file_id:tradeId,shipment_id:shipmentId}])});
      if(url.pathname==='/rest/v1/trade_collection_file_documents'||url.pathname==='/rest/v1/trade_collection_file_events'||url.pathname==='/rest/v1/shipment_files')return route.fulfill({status:200,headers,body:'[]'});
      if(url.pathname==='/rest/v1/shipments')return route.fulfill({status:200,headers,body:JSON.stringify([{id:shipmentId,status:'sent',owner_id:profile.id,company_id:company.id,bsgt_stage:status==='sent_to_remitting'?'sent_to_remitting':'management_review',created_at:'2026-09-12T09:00:00Z',updated_at:'2026-09-12T09:00:00Z',data:{operationNo:'BSGTX-2026-0099',consignee:'TEST CLIENT',itemDesc:'FABRIC',totalAmount:'USD 100.00'}}])});
      if(req.method()==='HEAD')return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});return route.fulfill({status:200,headers,body:'[]'});
    });
    const page=await context.newPage();await page.goto(`${APP}/#v=bsgtWorkspace&section=management`,{waitUntil:'domcontentloaded'});
    await page.locator('#bsgtManagementWaiting [data-bsgt-management-open]').waitFor({timeout:20000});
    assert.strictEqual(await page.locator('#bsgtManagementWaiting .bsgt-management-card').count(),1);
    await page.locator('#bsgtManagementWaiting [data-bsgt-management-open]').click();
    await page.locator('#bsgtManagementStart').click();
    await page.locator('#bsgtManagementReview [data-bsgt-management-open]').waitFor({timeout:10000});
    assert.strictEqual(startCalls,1);
    assert.strictEqual(await page.locator('#bsgtManagementReview .bsgt-management-card').count(),1);
    assert.strictEqual(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await context.close();console.log('BSGT management browser workflow: passed');
  }finally{if(browser)await browser.close();server.kill('SIGTERM');}
}
main().catch(error=>{console.error(error);process.exit(1);});
