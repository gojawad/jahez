'use strict';
// Company profile: stamps/signatures carry a default placement (position + size), edited on an
// A4 preview and saved online in the file metadata; the signing viewer applies it on fetch.

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');
const {chromium}=require('playwright-core');
const PORT=4900+Math.floor(Math.random()*100);
const BASE=`http://127.0.0.1:${PORT}`;
const APP=`http://jahez.test:${PORT}`;
const SUPABASE='https://vthcmqqiexaedukduquv.supabase.co';
const profile={id:'employee-1',email:'manager@example.test',display_name:'مدير الاختبار',role:'admin',active:true,photo_url:''};
const company={id:'bsgt-company',name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',active:true,is_default:false,sort_order:1,settings:{}};
const tradeId='10000000-0000-4000-8000-000000000001';
const shipmentId='20000000-0000-4000-8000-000000000001';
function executable(){return [process.env.CHROMIUM_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);}
function jwt(){const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');return `${enc({alg:'HS256'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})}.x`;}
async function waitServer(proc){for(let i=0;i<50;i++){if(proc.exitCode!==null)throw Error('server exited');try{if((await fetch(`${BASE}/healthz`)).ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('server timeout');}

async function main(){
  const browserPath=executable();if(!browserPath)throw Error('Chrome not found');
  const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','inherit','inherit']});let browser;
  try{
    await waitServer(server);browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    const context=await browser.newContext({viewport:{width:1440,height:900}});const exp=Math.floor(Date.now()/1000)+3600;
    await context.addInitScript(({profile,exp,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'r',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})),{profile,exp,token:jwt()});
    let placementPatch=null,status='sent_to_remitting',startCalls=0,revisionMode=false,savedSignature=null;
    const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');
    const source=await PDFDocument.create();source.addPage([595,842]);source.addPage([595,842]);const sourceBytes=Buffer.from(await source.save());
    const originals=['letter','undertaking','exchange'].map(kind=>({document_type:kind,document_variant:'finance_original',revision_no:1,is_active:true,storage_path:`workflow/${tradeId}/1/finance/${kind}.pdf`}));
    const stampPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAFCAYAAAB8ZH1oAAAAE0lEQVR4nGM4ISL3nxjMMAQUAgBv3GKjXEl0zgAAAABJRU5ErkJggg==','base64');
    const revision={id:'ops-revision',revision_no:1,documents:['contract','proforma','invoice','packing','import_permit','certificate_of_origin','bill_of_lading'].map(kind=>({kind,path:`${shipmentId}/ops-revision/${kind}.pdf`,source:'operations'}))};
    await context.route(`${SUPABASE}/**`,async route=>{const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':APP,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
      if(url.pathname.endsWith('/company-profile-files/asset.png'))return route.fulfill({status:200,headers:{...headers,'Content-Type':'image/png'},body:stampPng});
      if(url.pathname.includes('/storage/v1/object/sign/company-profile-files/'))return route.fulfill({status:200,headers,body:JSON.stringify({signedURL:'/object/sign/company-profile-files/asset.png?token=t'})});
      if(url.pathname==='/rest/v1/company_profile_files'&&req.method()==='PATCH'){placementPatch=req.postDataJSON();return route.fulfill({status:200,headers,body:'[]'});}
      if(url.pathname==='/rest/v1/company_profile_files')return route.fulfill({status:200,headers,body:JSON.stringify([{id:'cp-stamp',company_id:company.id,file_type:'stamp',title:'الختم الرسمي',original_name:'stamp.png',storage_path:`${company.id}/stamp/stamp.png`,mime_type:'image/png',is_active:true,created_at:'2026-09-12T10:00:00Z',metadata:{placement:{x:.6,y:.7,width:.25}}},{id:'cp-sig-1',company_id:company.id,file_type:'signature',title:'المدير',signatory_name:'جواد المصري',original_name:'sig1.png',storage_path:`${company.id}/signature/sig1.png`,mime_type:'image/png',is_active:true,created_at:'2026-09-12T10:00:00Z'},{id:'cp-sig-2',company_id:company.id,file_type:'signature',title:'مفوض',signatory_name:'مفوض ثانٍ',original_name:'sig2.png',storage_path:`${company.id}/signature/sig2.png`,mime_type:'image/png',is_active:true,created_at:'2026-09-12T10:00:00Z'}])});
      if(url.pathname==='/rest/v1/clients'||url.pathname==='/rest/v1/client_profile_files'||url.pathname==='/rest/v1/client_authorized_signatories')return route.fulfill({status:200,headers,body:'[]'});
      if(url.pathname.includes('/storage/v1/object/'))return route.fulfill({status:200,headers:{...headers,'Content-Type':'application/pdf'},body:sourceBytes});
      if(url.pathname==='/rest/v1/rpc/bsgt_internal_package')return route.fulfill({status:200,headers,body:JSON.stringify({file:{id:tradeId,status,revision_no:1},shipments:[{shipment:{id:shipmentId,data:{operationNo:'BSGTX-2026-0099'}},revision}],documents:[...originals,...(savedSignature?[savedSignature]:[])]})});
      if(url.pathname==='/rest/v1/profiles')return route.fulfill({status:200,headers,body:JSON.stringify([profile])});
      if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions')return route.fulfill({status:200,headers,body:JSON.stringify([{section:'management',can_view:true,can_edit:true}])});
      if(url.pathname==='/rest/v1/rpc/start_bsgt_management_review'){startCalls++;status='under_management_review';return route.fulfill({status:200,headers,body:'{}'});}
      if(url.pathname==='/rest/v1/companies')return route.fulfill({status:200,headers,body:JSON.stringify([company])});
      if(url.pathname==='/rest/v1/trade_collection_files')return route.fulfill({status:200,headers,body:JSON.stringify([{id:tradeId,operation_no:'TC-2026-000321',company_id:company.id,status,revision_no:1,created_by:profile.id,created_at:'2026-09-12T10:00:00Z',updated_at:'2026-09-12T10:00:00Z',remitting_bank:'ADIB',metadata:{documentKinds:['letter','undertaking','exchange'],currency:'USD',operationsRevisionWorkflow:revisionMode}}])});
      if(url.pathname==='/rest/v1/trade_collection_file_shipments')return route.fulfill({status:200,headers,body:JSON.stringify([{id:'link',trade_file_id:tradeId,shipment_id:shipmentId}])});
      if(url.pathname==='/rest/v1/trade_collection_file_documents')return route.fulfill({status:200,headers,body:JSON.stringify(revisionMode?originals:[])});
      if(url.pathname==='/rest/v1/trade_collection_file_events'||url.pathname==='/rest/v1/shipment_files')return route.fulfill({status:200,headers,body:'[]'});
      if(url.pathname==='/rest/v1/shipments')return route.fulfill({status:200,headers,body:JSON.stringify([{id:shipmentId,status:'sent',owner_id:profile.id,company_id:company.id,bsgt_stage:status==='sent_to_remitting'?'sent_to_remitting':'management_review',created_at:'2026-09-12T09:00:00Z',updated_at:'2026-09-12T09:00:00Z',data:{operationNo:'BSGTX-2026-0099',consignee:'TEST CLIENT',itemDesc:'FABRIC',totalAmount:'USD 100.00'}}])});
      if(req.method()==='HEAD')return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});return route.fulfill({status:200,headers,body:'[]'});
    });
    const page=await context.newPage();page.on('pageerror',error=>console.error('browser',error.message));page.on('console',message=>{if(message.type()==='error')console.error(message.text());});await page.goto(`${APP}/#v=bsgtWorkspace&section=management`,{waitUntil:'domcontentloaded'});
    await page.locator('#bsgtManagementWaiting [data-bsgt-management-open]').waitFor({timeout:20000});
    assert.strictEqual(await page.locator('#bsgtManagementWaiting .bsgt-management-card').count(),1);
    await page.locator('#bsgtManagementWaiting [data-bsgt-management-open]').click();
    await page.locator('#bsgtManagementStart').click();
    await page.locator('#bsgtManagementReview [data-bsgt-management-open]').waitFor({timeout:10000});
    assert.strictEqual(startCalls,1);
    assert.strictEqual(await page.locator('#bsgtManagementReview .bsgt-management-card').count(),1);
    assert.strictEqual(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    revisionMode=true;
    await context.route(`${APP}/api/bsgt-internal-document`,async route=>{
      const payload=route.request().postDataJSON();
      assert.equal(payload.action,'sign');assert.equal(payload.shipmentId,shipmentId);
      assert.equal(payload.placements.length,2);assert.deepEqual(payload.placements.map(p=>p.page),[0,1]);
      assert.equal(payload.placements[1].cloned,true);assert.ok(payload.placements[0].width>.2);
      assert.ok(payload.placements.every(p=>typeof p.image==='string'&&p.image.length>20),'each placement carries its own PNG');
      savedSignature={document_type:payload.kind,shipment_id:shipmentId,document_variant:'administration_signed',storage_path:'workflow/signed.pdf'};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({document:savedSignature})});
    });
    await page.goto(`${APP}/#v=admin`,{waitUntil:'domcontentloaded'});
    await page.locator('.admin-tab[data-atab="companyProfile"]').waitFor({timeout:20000});
    await page.locator('.admin-tab[data-atab="companyProfile"]').click();
    await page.locator('#companyProfileRoot .ccp-file-card').first().waitFor({timeout:20000});
    assert.equal(await page.locator('#companyProfileRoot .ccp-chip.is-placed').count(),1,'stamp with saved placement is flagged');
    const sigCard=page.locator('#companyProfileRoot .ccp-file-card').nth(1);
    await sigCard.locator('[data-action="placement"]').click();
    await page.locator('.jahez-placement-dialog[open] [data-image]').waitFor();
    await page.waitForTimeout(400);
    await page.fill('.jahez-placement-dialog[open] [data-width]','30');
    await page.locator('.jahez-placement-dialog[open] [data-width]').dispatchEvent('input');
    const img=page.locator('.jahez-placement-dialog[open] [data-image]');const box=await img.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-60,box.y+box.height/2-80,{steps:6});await page.mouse.up();
    if(process.env.SHOT_DIR) await page.screenshot({path:process.env.SHOT_DIR+'/placement-editor.png'});
    await page.locator('.jahez-placement-dialog[open] [data-save]').click();
    await page.waitForFunction(()=>!document.querySelector('.jahez-placement-dialog[open]'));
    await page.waitForTimeout(500);
    assert.ok(placementPatch&&placementPatch.metadata&&placementPatch.metadata.placement,'placement saved online');
    assert.ok(Math.abs(placementPatch.metadata.placement.width-.3)<.01,'width from the input');
    assert.ok(placementPatch.metadata.placement.y<.7,'dragged upward from the default');
    console.log('Company profile placement editor: passed');
  }finally{if(browser)await browser.close();server.kill('SIGTERM');}
}
main().catch(error=>{console.error(error);process.exit(1);});
