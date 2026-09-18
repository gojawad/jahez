'use strict';
// Archive (no delete): archived shipments stay out of the loaded records and BSGT lists,
// the archive browser lists and restores them, the shipment page archives through the RPC,
// and the trade-files tab archives a whole file.
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');
const {chromium}=require('playwright-core');

const PORT=5300+Math.floor(Math.random()*100);
const BASE=`http://127.0.0.1:${PORT}`;
const APP=`http://jahez.test:${PORT}`;
const SUPABASE='https://vthcmqqiexaedukduquv.supabase.co';
const profile={id:'admin-1',email:'admin@example.test',display_name:'مدير النظام',role:'admin',active:true,photo_url:'',feature_permissions_initialized:true};
const company={id:'bsgt-company',name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',active:true,is_default:false,sort_order:1,settings:{}};
const liveId='20000000-0000-4000-8000-000000000001', archivedId='20000000-0000-4000-8000-000000000002', tradeId='10000000-0000-4000-8000-000000000009';
function executable(){return [process.env.CHROMIUM_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find(fs.existsSync);}
function jwt(){const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');return `${enc({alg:'HS256'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})}.x`;}
async function waitServer(proc){for(let i=0;i<50;i++){if(proc.exitCode!==null)throw Error('server exited');try{if((await fetch(`${BASE}/healthz`)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}throw Error('server timeout');}

async function main(){
  const browserPath=executable();if(!browserPath)throw Error('Chrome not found');
  const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','inherit','inherit']});let browser;
  try{
    await waitServer(server);browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    const context=await browser.newContext({viewport:{width:1440,height:900}});const exp=Math.floor(Date.now()/1000)+3600;
    await context.addInitScript(({profile,exp,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'r',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})),{profile,exp,token:jwt()});
    const archiveCalls=[];
    const shipments={
      [liveId]:{id:liveId,status:'draft',owner_id:profile.id,company_id:company.id,bsgt_stage:'operations_draft',archived_at:null,archived_by:null,created_at:'2026-09-12T09:00:00Z',updated_at:'2026-09-12T09:00:00Z',data:{operationNo:'BSGTX-2026-0001',consignee:'REAL CLIENT',itemDesc:'REAL GOODS',shipType:'sea'}},
      [archivedId]:{id:archivedId,status:'draft',owner_id:profile.id,company_id:company.id,bsgt_stage:'operations_draft',archived_at:'2026-09-15T09:00:00Z',archived_by:profile.id,created_at:'2026-09-10T09:00:00Z',updated_at:'2026-09-10T09:00:00Z',data:{operationNo:'BSGTX-2026-TEST',consignee:'TEST CLIENT',itemDesc:'TEST GOODS',shipType:'sea'}}
    };
    const tradeFile=()=>({id:tradeId,operation_no:'TC-2026-000009',company_id:company.id,status:'draft',revision_no:1,created_by:profile.id,created_at:'2026-09-12T10:00:00Z',updated_at:'2026-09-12T10:00:00Z',remitting_bank:'ADIB',collecting_bank:null,archived_at:shipments[liveId].archived_at,metadata:{}});
    const filtered=(rows,url)=>{const flag=url.searchParams.get('archived_at');if(flag==='is.null')return rows.filter(row=>!row.archived_at);if(flag==='not.is.null')return rows.filter(row=>row.archived_at);return rows;};
    await context.route(`${SUPABASE}/**`,async route=>{const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':APP,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
      if(url.pathname==='/rest/v1/profiles')return route.fulfill({status:200,headers,body:JSON.stringify([profile])});
      if(url.pathname==='/rest/v1/companies')return route.fulfill({status:200,headers,body:JSON.stringify([company])});
      if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions')return route.fulfill({status:200,headers,body:'[]'});
      if(url.pathname==='/rest/v1/rpc/set_bsgt_archive'){const body=req.postDataJSON();archiveCalls.push(body);const stamp=body.p_archived?'2026-09-18T10:00:00Z':null;
        if(body.p_kind==='shipment'){shipments[body.p_id].archived_at=stamp;return route.fulfill({status:200,headers,body:JSON.stringify({kind:'shipment',id:body.p_id,archived:body.p_archived,tradeFileIds:[]})});}
        shipments[liveId].archived_at=stamp;return route.fulfill({status:200,headers,body:JSON.stringify({kind:'trade_file',id:body.p_id,archived:body.p_archived,shipmentIds:[liveId]})});}
      if(url.pathname==='/rest/v1/shipments'){
        const rows=filtered(Object.values(shipments),url);
        if(req.method()==='HEAD')return route.fulfill({status:200,headers:{...headers,'Content-Range':`0-${Math.max(rows.length-1,0)}/${rows.length}`},body:''});
        const single=String(req.headers().accept||'').includes('vnd.pgrst.object');
        const idFilter=url.searchParams.get('id');const picked=idFilter?.startsWith('eq.')?rows.filter(row=>row.id===idFilter.slice(3)):idFilter?.startsWith('in.(')?rows.filter(row=>idFilter.slice(4,-1).split(',').includes(row.id)):rows;
        return route.fulfill({status:200,headers:{...headers,'Content-Range':`0-${Math.max(picked.length-1,0)}/${picked.length}`},body:JSON.stringify(single?picked[0]||null:picked)});
      }
      if(url.pathname==='/rest/v1/trade_collection_files'){const rows=filtered([tradeFile()],url);const single=String(req.headers().accept||'').includes('vnd.pgrst.object');return route.fulfill({status:200,headers:{...headers,'Content-Range':`0-${Math.max(rows.length-1,0)}/${rows.length}`},body:JSON.stringify(single?rows[0]||null:rows)});}
      if(url.pathname==='/rest/v1/trade_collection_file_shipments')return route.fulfill({status:200,headers,body:JSON.stringify([{id:'link-1',trade_file_id:tradeId,shipment_id:liveId,operations_revision_id:null}])});
      if(req.method()==='HEAD')return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});
      return route.fulfill({status:200,headers,body:'[]'});
    });
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto(`${APP}/#v=records`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof records!=='undefined'&&records.length>0,null,{timeout:20000});
    // 1. Loaded records exclude the archived shipment.
    const loaded=await page.evaluate(()=>records.map(row=>row.operationNo));
    assert.deepStrictEqual(loaded,['BSGTX-2026-0001'],'archived shipment must not be loaded');
    assert.strictEqual(await page.evaluate(()=>window.JahezArchive.isSupported()),true);
    // 2. Archive browser lists it and restores it.
    await page.locator('#archiveBtn').waitFor({state:'visible'});
    await page.locator('#archiveBtn').click();
    await page.locator('#jahezArchiveList [data-jahez-unarchive]').waitFor();
    if(process.env.SHOT_DIR) await page.screenshot({path:path.join(process.env.SHOT_DIR,'archive-modal.png')});
    assert.match(await page.locator('#jahezArchiveList').innerText(),/BSGTX-2026-TEST/);
    await page.locator('#jahezArchiveList [data-jahez-unarchive]').click();
    await page.waitForFunction(()=>records.length===2,null,{timeout:10000});
    assert.deepStrictEqual(archiveCalls.at(-1),{p_kind:'shipment',p_id:archivedId,p_archived:false});
    await page.locator('#jahezArchiveClose').click();
    // 3. Archive from the shipment page.
    await page.evaluate(id=>openDetail(id),liveId);
    await page.locator('#archiveShipmentBtn').waitFor();
    if(process.env.SHOT_DIR) await page.screenshot({path:path.join(process.env.SHOT_DIR,'archive-detail.png'),fullPage:true});
    await page.locator('#archiveShipmentBtn').click();
    await page.waitForFunction(()=>!records.some(row=>row.operationNo==='BSGTX-2026-0001'),null,{timeout:10000});
    assert.deepStrictEqual(archiveCalls.at(-1),{p_kind:'shipment',p_id:liveId,p_archived:true});
    // 4. Trade-files tab: archived filter lists the file; restore the whole file through the RPC.
    await page.goto(`${APP}/#v=bsgtWorkspace&section=tradeFiles`,{waitUntil:'domcontentloaded'});
    await page.locator('#bsgtTradeFiles [data-status]').waitFor({timeout:20000});
    await page.locator('#bsgtTradeFiles .tf-message, #bsgtTradeFiles .tf-file').first().waitFor();
    assert.strictEqual(await page.locator('#bsgtTradeFiles .tf-file').count(),0,'archived trade file hidden by default');
    await page.locator('#bsgtTradeFiles [data-status]').selectOption('__archived');
    await page.locator('#bsgtTradeFiles .tf-file').first().waitFor({timeout:10000});
    assert.match(await page.locator('#bsgtTradeFiles .tf-file').first().innerText(),/مؤرشف/);
    await page.locator('#bsgtTradeFiles .tf-file').first().click();
    await page.locator('[data-archive-file="restore"]').waitFor({timeout:10000});
    if(process.env.SHOT_DIR) await page.screenshot({path:path.join(process.env.SHOT_DIR,'archive-tradefile.png'),fullPage:true});
    await page.locator('[data-archive-file="restore"]').click();
    await page.waitForFunction(()=>records.some(row=>row.operationNo==='BSGTX-2026-0001'),null,{timeout:10000});
    assert.deepStrictEqual(archiveCalls.at(-1),{p_kind:'trade_file',p_id:tradeId,p_archived:false});
    const pageErrors=errors.filter(e=>!/WebSocket|ERR_TUNNEL|net::/.test(e));
    assert.deepStrictEqual(pageErrors,[],'no page errors');
    console.log('archive browser workflow: passed');
  }finally{await browser?.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exit(1);});
