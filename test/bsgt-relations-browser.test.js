'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');
const {chromium}=require('playwright-core');
const PORT=5000+Math.floor(Math.random()*100);
const BASE=`http://127.0.0.1:${PORT}`;
const APP=`http://jahez.test:${PORT}`;
const SUPABASE='https://vthcmqqiexaedukduquv.supabase.co';
const profile={id:'employee-1',email:'relations@example.test',display_name:'موظف العلاقات',role:'editor',active:true,photo_url:''};
const company={id:'bsgt-company',name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',active:true,is_default:false,sort_order:1,settings:{}};
const tradeId='10000000-0000-4000-8000-000000000005';
const shipmentId='20000000-0000-4000-8000-000000000005';
function executable(){return ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);}
function jwt(){const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');return `${enc({alg:'HS256'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})}.x`;}
async function waitServer(proc){for(let i=0;i<50;i++){if(proc.exitCode!==null)throw Error('server exited');try{if((await fetch(`${BASE}/healthz`)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}throw Error('server timeout');}

async function main(){
  const browserPath=executable();if(!browserPath)throw Error('Chrome not found');
  const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','inherit','inherit']});let browser;
  try{
    await waitServer(server);browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    const context=await browser.newContext({viewport:{width:1440,height:900}});const exp=Math.floor(Date.now()/1000)+3600;
    await context.addInitScript(({profile,exp,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'r',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})),{profile,exp,token:jwt()});
    let status='final_accepted',sendCalls=0,canEditPermission=true;
    const file=()=>({id:tradeId,operation_no:'TC-2026-000555',company_id:company.id,status,revision_no:2,created_by:profile.id,created_at:'2026-09-12T10:00:00Z',updated_at:'2026-09-12T10:00:00Z',remitting_bank:'ADIB',collecting_bank:'COLLECTING BANK',final_accepted_at:'2026-09-12T11:00:00Z',final_accepted_by:profile.id,sent_to_collecting_at:status==='sent_to_collecting'?'2026-09-12T12:00:00Z':null,metadata:{documentKinds:['letter','undertaking','exchange'],currency:'USD',collectingBankAddress:'DUBAI'}});
    await context.route(`${SUPABASE}/**`,async route=>{const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':APP,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
      if(url.pathname==='/rest/v1/profiles')return route.fulfill({status:200,headers,body:JSON.stringify([profile])});
      if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions')return route.fulfill({status:200,headers,body:JSON.stringify([{section:'relations',can_view:true,can_edit:canEditPermission}])});
      if(url.pathname==='/rest/v1/rpc/get_bsgt_relations_trade_files')return route.fulfill({status:200,headers,body:JSON.stringify([{...file(),shipment_count:1,missing_optional_count:2,total_count:1}])});
      if(url.pathname==='/rest/v1/rpc/send_bsgt_trade_file_to_collecting'){sendCalls++;status='sent_to_collecting';return route.fulfill({status:200,headers,body:JSON.stringify(file())});}
      if(url.pathname==='/rest/v1/companies')return route.fulfill({status:200,headers,body:JSON.stringify([company])});
      if(url.pathname==='/rest/v1/bank_book')return route.fulfill({status:200,headers,body:JSON.stringify([{id:'bank-1',nick:'COLLECTING BANK',body:'DUBAI'}])});
      if(url.pathname==='/rest/v1/trade_collection_files')return route.fulfill({status:200,headers,body:JSON.stringify(file())});
      if(url.pathname==='/rest/v1/trade_collection_file_shipments')return route.fulfill({status:200,headers,body:JSON.stringify([{id:'link',trade_file_id:tradeId,shipment_id:shipmentId}])});
      if(url.pathname==='/rest/v1/trade_collection_relations_attachments'||url.pathname==='/rest/v1/trade_collection_file_events'||url.pathname==='/rest/v1/shipment_files')return route.fulfill({status:200,headers,body:'[]'});
      if(url.pathname==='/rest/v1/trade_collection_file_documents')return route.fulfill({status:200,headers,body:JSON.stringify(['letter','undertaking','exchange'].map((document_type,index)=>({id:`doc-${index}`,trade_file_id:tradeId,revision_no:2,document_type,storage_path:`${tradeId}/2/${document_type}/file.pdf`,file_name:`${document_type}.pdf`,is_active:true,uploaded_by:profile.id,created_at:'2026-09-12T10:30:00Z'})))});
      if(url.pathname==='/rest/v1/shipments')return route.fulfill({status:200,headers,body:JSON.stringify([{id:shipmentId,status:'sent',VED:true,owner_id:profile.id,company_id:company.id,bsgt_stage:status,created_at:'2026-09-12T09:00:00Z',updated_at:'2026-09-12T09:00:00Z',data:{operationNo:'BSGTX-2026-0105',consignee:'TEST CLIENT',itemDesc:'FABRIC',totalAmount:'USD 100.00'}}])});
      if(req.method()==='HEAD')return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});return route.fulfill({status:200,headers,body:'[]'});
    });
    const page=await context.newPage();await page.goto(`${APP}/#v=bsgtWorkspace&section=relations`,{waitUntil:'domcontentloaded'});
    await page.locator('#bsgtRelationsReady [data-bsgt-relations-open]').waitFor({timeout:20000});
    await page.locator('#bsgtRelationsReady [data-bsgt-relations-open]').click();
    await page.locator('#bsgtRelationsSend').waitFor();
    assert.match(await page.locator('.bsgt-relations-warning').innerText(),/2/);
    assert.strictEqual(await page.locator('[data-bsgt-relations-upload]').count(),2);
    canEditPermission=false;await page.reload({waitUntil:'domcontentloaded'});await page.locator('#bsgtRelationsReady [data-bsgt-relations-open]').click();await page.locator('.bsgt-relations-detail').waitFor();
    assert.strictEqual(await page.locator('#bsgtRelationsSend').count(),0);
    assert.strictEqual(await page.locator('[data-bsgt-relations-upload]').count(),0);
    canEditPermission=true;await page.reload({waitUntil:'domcontentloaded'});await page.locator('#bsgtRelationsReady [data-bsgt-relations-open]').click();await page.locator('#bsgtRelationsSend').waitFor();
    await page.locator('#bsgtRelationsSend').click();
    assert.match(await page.locator('#bsgtRelationsConfirmMessage').innerText(),/اختيارية/);
    await page.locator('#bsgtRelationsConfirmSubmit').click();
    await page.locator('#bsgtRelationsSent [data-bsgt-relations-open]').waitFor({timeout:10000});
    assert.strictEqual(sendCalls,1);
    assert.strictEqual(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await context.close();console.log('BSGT relations browser workflow: passed');
  }finally{if(browser)await browser.close();server.kill('SIGTERM');}
}
main().catch(error=>{console.error(error);process.exit(1);});
