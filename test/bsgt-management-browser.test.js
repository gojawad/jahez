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
    let status='sent_to_remitting',startCalls=0,revisionMode=false,savedSignature=null,cadMode=false,acceptCalls=0;
    const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');
    const source=await PDFDocument.create();source.addPage([595,842]);source.addPage([595,842]);const sourceBytes=Buffer.from(await source.save());
    const originals=['letter','undertaking','exchange'].map(kind=>({document_type:kind,document_variant:'finance_original',revision_no:1,is_active:true,storage_path:`workflow/${tradeId}/1/finance/${kind}.pdf`}));
    const stampPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAFCAYAAAB8ZH1oAAAAE0lEQVR4nGM4ISL3nxjMMAQUAgBv3GKjXEl0zgAAAABJRU5ErkJggg==','base64');
    const revision={id:'ops-revision',revision_no:1,documents:['contract','proforma','invoice','packing','import_permit','certificate_of_origin','bill_of_lading'].map(kind=>({kind,path:`${shipmentId}/ops-revision/${kind}.pdf`,source:'operations'}))};
    await context.route(`${SUPABASE}/**`,async route=>{const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':APP,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
      if(url.pathname.endsWith('/company-profile-files/asset.png'))return route.fulfill({status:200,headers:{...headers,'Content-Type':'image/png'},body:stampPng});
      if(url.pathname.includes('/storage/v1/object/sign/company-profile-files/'))return route.fulfill({status:200,headers,body:JSON.stringify({signedURL:'/object/sign/company-profile-files/asset.png?token=t'})});
      if(url.pathname==='/rest/v1/company_profile_files')return route.fulfill({status:200,headers,body:JSON.stringify([{id:'cp-stamp',company_id:company.id,file_type:'stamp',title:'الختم الرسمي',original_name:'stamp.png',storage_path:`${company.id}/stamp/stamp.png`,mime_type:'image/png',is_active:true,created_at:'2026-09-12T10:00:00Z',metadata:{placement:{x:.6,y:.7,width:.25}}},{id:'cp-sig-1',company_id:company.id,file_type:'signature',title:'المدير',signatory_name:'جواد المصري',original_name:'sig1.png',storage_path:`${company.id}/signature/sig1.png`,mime_type:'image/png',is_active:true,created_at:'2026-09-12T10:00:00Z'},{id:'cp-sig-2',company_id:company.id,file_type:'signature',title:'مفوض',signatory_name:'مفوض ثانٍ',original_name:'sig2.png',storage_path:`${company.id}/signature/sig2.png`,mime_type:'image/png',is_active:true,created_at:'2026-09-12T10:00:00Z'}])});
      if(url.pathname==='/rest/v1/clients')return route.fulfill({status:200,headers,body:JSON.stringify([{id:'client-1',name:'BUYER CO',name_ar:'',name_en:'BUYER CO',active:true}])});
      if(url.pathname.includes('/storage/v1/object/sign/client-profile-files/'))return route.fulfill({status:200,headers,body:JSON.stringify({signedURL:'/object/sign/company-profile-files/asset.png?token=c'})});
      if(url.pathname==='/rest/v1/client_profile_files')return route.fulfill({status:200,headers,body:JSON.stringify([{id:'cl-stamp',client_id:'client-1',file_type:'stamp',title:'ختم المشتري',original_name:'b.png',storage_path:'client-1/stamp/b.png',mime_type:'image/png',is_active:true,signatory_id:null,metadata:{placement:{x:.1,y:.8,width:.15}}}])});
      if(url.pathname==='/rest/v1/client_authorized_signatories')return route.fulfill({status:200,headers,body:'[]'});
      if(url.pathname.includes('/storage/v1/object/'))return route.fulfill({status:200,headers:{...headers,'Content-Type':'application/pdf'},body:sourceBytes});
      if(url.pathname==='/rest/v1/rpc/bsgt_internal_package')return route.fulfill({status:200,headers,body:JSON.stringify({file:{id:tradeId,status,revision_no:1},shipments:[{shipment:{id:shipmentId,data:{operationNo:'BSGTX-2026-0099',consignee:'BUYER CO'}},revision}],documents:[...originals,...(savedSignature?[savedSignature]:[])]})});
      if(url.pathname==='/rest/v1/profiles')return route.fulfill({status:200,headers,body:JSON.stringify([profile])});
      if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions')return route.fulfill({status:200,headers,body:JSON.stringify([{section:'management',can_view:true,can_edit:true}])});
      if(url.pathname==='/rest/v1/rpc/start_bsgt_management_review'){startCalls++;status='under_management_review';return route.fulfill({status:200,headers,body:'{}'});}
      if(url.pathname==='/rest/v1/rpc/final_accept_bsgt_trade_file'){acceptCalls++;status='final_accepted';return route.fulfill({status:200,headers,body:'{}'});}
      if(url.pathname==='/rest/v1/companies')return route.fulfill({status:200,headers,body:JSON.stringify([company])});
      if(url.pathname==='/rest/v1/trade_collection_files')return route.fulfill({status:200,headers,body:JSON.stringify([{id:tradeId,operation_no:'TC-2026-000321',company_id:company.id,status,revision_no:1,created_by:profile.id,created_at:'2026-09-12T10:00:00Z',updated_at:'2026-09-12T10:00:00Z',remitting_bank:'ADIB',metadata:{collectionMode:cadMode?'cad':'collection',documentKinds:['letter','undertaking','exchange'],currency:'USD',operationsRevisionWorkflow:revisionMode}}])});
      if(url.pathname==='/rest/v1/trade_collection_file_shipments')return route.fulfill({status:200,headers,body:JSON.stringify([{id:'link',trade_file_id:tradeId,shipment_id:shipmentId}])});
      if(url.pathname==='/rest/v1/trade_collection_file_documents')return route.fulfill({status:200,headers,body:JSON.stringify(revisionMode?originals:[])});
      if(url.pathname==='/rest/v1/trade_collection_file_events'||url.pathname==='/rest/v1/shipment_files')return route.fulfill({status:200,headers,body:'[]'});
      if(url.pathname==='/rest/v1/shipments')return route.fulfill({status:200,headers,body:JSON.stringify([{id:shipmentId,status:'sent',owner_id:profile.id,company_id:company.id,bsgt_stage:status==='sent_to_remitting'?'sent_to_remitting':'management_review',created_at:'2026-09-12T09:00:00Z',updated_at:'2026-09-12T09:00:00Z',data:{operationNo:'BSGTX-2026-0099',consignee:'BUYER CO',itemDesc:'FABRIC',totalAmount:'USD 100.00'}}])});
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
    await page.evaluate(()=>loadBsgtManagement());
    await page.locator('#bsgtManagementReview [data-bsgt-management-open]').click();
    await page.locator('[data-packages] .bsgt-management-doc').first().waitFor();
    assert.equal(await page.locator('[data-packages] .bsgt-management-doc').count(),10);
    await page.locator('[data-packages] button').filter({hasText:'إضافة توقيع'}).first().click();
    const dialog=page.locator('dialog[open]');
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=80;c.height=30;const ctx=c.getContext('2d');ctx.fillStyle='#000080';ctx.fillRect(0,0,80,30);return c.toDataURL('image/png').split(',')[1];});
    await dialog.locator('input[data-image]').setInputFiles({name:'test-signature.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.waitForTimeout(100);
    // Saved signatures are offered automatically: buyer buttons stay disabled (no client profile),
    // company stamp adds directly, company signature offers a choice between the two signatories.
    await page.waitForFunction(()=>!document.querySelector('dialog[open] [data-auto-pick="company-stamp"]').disabled,null,{timeout:10000});
    await page.waitForFunction(()=>!document.querySelector('dialog[open] [data-auto-pick="buyer-stamp"]').disabled,null,{timeout:10000});
    assert.equal(await dialog.locator('[data-auto-pick="buyer-signature"]').isDisabled(),true,'no buyer signature uploaded');
    await dialog.locator('[data-auto-pick="buyer-stamp"]').click();
    await dialog.locator('[data-overlay] img').waitFor();
    const buyerStyle=await page.evaluate(()=>{const s=document.querySelector('dialog[open] [data-overlay] img').style;return {left:s.left,top:s.top,width:s.width};});
    assert.deepStrictEqual(buyerStyle,{left:'10%',top:'80%',width:'15%'},'buyer stamp uses the placement saved in the client profile');
    await dialog.locator('[data-delete]').click();
    await dialog.locator('[data-auto-pick="company-stamp"]').click();
    await dialog.locator('[data-overlay] img').waitFor();
    assert.equal(await dialog.locator('[data-overlay] img').count(),1,'company stamp placed straight onto the page');
    const stampStyle=await page.evaluate(()=>{const s=document.querySelector('dialog[open] [data-overlay] img').style;return {left:s.left,top:s.top,width:s.width};});
    assert.deepStrictEqual(stampStyle,{left:'60%',top:'70%',width:'25%'},'saved profile placement applied on fetch');
    await dialog.locator('[data-auto-pick="company-signature"]').click();
    const chooser=page.locator('dialog[open]').last();
    await chooser.locator('.bsgt-sign-choice').first().waitFor();
    assert.equal(await chooser.locator('.bsgt-sign-choice').count(),2,'two company signatories to choose from');
    assert.match(await chooser.locator('.bsgt-sign-choice').first().innerText(),/جواد المصري/);
    await chooser.locator('.bsgt-sign-choice').first().click();
    await page.waitForFunction(()=>document.querySelectorAll('dialog[open] [data-overlay] img').length===2);
    // stamp and signature keep their own images, and the selected one has a corner resize handle
    const overlayImages=await page.evaluate(()=>[...document.querySelectorAll('dialog[open] [data-overlay] img')].map(img=>img.title));
    assert.deepStrictEqual(overlayImages.map(t=>t.split(' — ')[0]),['ختم بحر سواكن','توقيع بحر سواكن']);
    await dialog.locator('.bsgt-sign-handle').waitFor();await dialog.locator('.bsgt-sign-handle').scrollIntoViewIfNeeded();
    const handleBox=await dialog.locator('.bsgt-sign-handle').boundingBox(), sigBefore=await dialog.locator('[data-overlay] img').nth(1).boundingBox();
    await page.mouse.move(handleBox.x+8,handleBox.y+8);await page.mouse.down();await page.mouse.move(handleBox.x+68,handleBox.y+30,{steps:5});await page.mouse.up();
    const sigAfter=await dialog.locator('[data-overlay] img').nth(1).boundingBox();
    assert.ok(sigAfter.width>sigBefore.width+30,'corner handle resizes the selected signature');
    await dialog.locator('[data-delete]').click();await dialog.locator('[data-delete]').click();
    await page.evaluate(()=>{document.querySelector('dialog[open] [data-overlay]').replaceChildren();});
    await dialog.locator('input[data-image]').setInputFiles({name:'test-signature.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await page.waitForTimeout(100);
    await dialog.locator('[data-add]').click();
    await dialog.locator('[data-overlay] img').waitFor();
    await dialog.locator('[data-size]').fill('30');
    const image=dialog.locator('[data-overlay] img'),box=await image.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+25,box.y+box.height/2+20);await page.mouse.up();
    await dialog.locator('[data-page]').selectOption({value:'1'});
    await page.waitForFunction(()=>document.querySelector('dialog[open] [data-overlay]').children.length===0);
    await dialog.locator('[data-clone]').click();await dialog.locator('[data-overlay] img').waitFor();
    await dialog.locator('[data-clone]').click();assert.equal(await dialog.locator('[data-overlay] img').count(),2);
    await dialog.locator('[data-delete]').click();assert.equal(await dialog.locator('[data-overlay] img').count(),1);
    await page.screenshot({path:path.join(__dirname,'output','bsgt-internal-signature.png')});
    await dialog.locator('[data-save]').click();
    await page.locator('[data-packages] button').filter({hasText:'معاينة الموقّع'}).waitFor();
    assert.ok(savedSignature);
    cadMode=true;savedSignature=null;
    await page.evaluate(()=>loadBsgtManagement());await page.locator('#bsgtManagementReview [data-bsgt-management-open]').click();
    page.on('dialog',d=>d.accept());
    await page.locator('#bsgtManagementAccept').click();
    await page.waitForFunction(()=>!bsgtManagementState.busy);
    assert.equal(acceptCalls,1,'CAD accepts with zero optional signatures');
    await context.close();console.log('BSGT management browser workflow: passed');
  }finally{if(browser)await browser.close();server.kill('SIGTERM');}
}
main().catch(error=>{console.error(error);process.exit(1);});
