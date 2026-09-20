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
const secondShipmentId='20000000-0000-4000-8000-000000000006';
function executable(){return [process.env.CHROMIUM_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);}
function jwt(){const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');return `${enc({alg:'HS256'})}.${enc({sub:profile.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})}.x`;}
async function waitServer(proc){for(let i=0;i<50;i++){if(proc.exitCode!==null)throw Error('server exited');try{if((await fetch(`${BASE}/healthz`)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}throw Error('server timeout');}

async function main(){
  const browserPath=executable();if(!browserPath)throw Error('Chrome not found');
  const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','inherit','inherit']});let browser;
  try{
    await waitServer(server);browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    const context=await browser.newContext({viewport:{width:1440,height:900}});const exp=Math.floor(Date.now()/1000)+3600;
    await context.addInitScript(({profile,exp,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'r',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})),{profile,exp,token:jwt()});
    await context.addInitScript(()=>localStorage.setItem('bsCollectionDataLists',JSON.stringify({collectingBankProfile:[{bank:'LOCAL ONLY BANK',address:'NOT A DATABASE VALUE'}]})));
    let status='final_accepted',sendCalls=0,canEditPermission=true,uploadCalls=0,registrations=0;
    const attachments=[];
    let revisionMode=false,signedDocument=null;
    const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');
    const testPdf=await PDFDocument.create();testPdf.addPage([595,842]);const testPdfBytes=Buffer.from(await testPdf.save());
    const file=()=>({id:tradeId,operation_no:'TC-2026-000555',company_id:company.id,status,revision_no:2,created_by:profile.id,created_at:'2026-09-12T10:00:00Z',updated_at:'2026-09-12T10:00:00Z',remitting_bank:'ADIB',collecting_bank:'COLLECTING BANK',final_accepted_at:'2026-09-12T11:00:00Z',final_accepted_by:profile.id,sent_to_collecting_at:status==='sent_to_collecting'?'2026-09-12T12:00:00Z':null,metadata:{operationsRevisionWorkflow:revisionMode,documentKinds:['letter','undertaking','exchange'],currency:'USD',collectingBankAddress:'DUBAI'}});
    await context.route(`${SUPABASE}/**`,async route=>{const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':APP,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
      if(url.pathname==='/rest/v1/profiles')return route.fulfill({status:200,headers,body:JSON.stringify([profile])});
      if(url.pathname==='/rest/v1/rpc/bsgt_internal_package')return route.fulfill({status:200,headers,body:JSON.stringify({file:file(),shipments:[shipmentId,secondShipmentId].map(id=>({shipment:{id,data:{operationNo:id}},revision:{revision_no:1,documents:[{kind:'contract',path:id+'/contract.pdf'},{kind:'invoice',path:id+'/invoice.pdf'}]}})),documents:signedDocument?[signedDocument]:[]})});
      if(url.pathname.includes('/storage/v1/object/')&&url.pathname.includes('/bsgt-operations-packages/'))return route.fulfill({status:200,headers:{...headers,'Content-Type':'application/pdf'},body:testPdfBytes});
      if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions')return route.fulfill({status:200,headers,body:JSON.stringify([{section:'relations',can_view:true,can_edit:canEditPermission}])});
      if(url.pathname==='/rest/v1/rpc/get_bsgt_relations_trade_files')return route.fulfill({status:200,headers,body:JSON.stringify([{...file(),shipment_count:2,missing_optional_count:2-new Set(attachments.filter(a=>a.is_active).map(a=>a.attachment_type)).size,total_count:1}])});
      if(url.pathname==='/rest/v1/rpc/send_bsgt_trade_file_to_collecting'){const body=req.postDataJSON();assert.strictEqual(body.p_trade_file_id,tradeId);assert.strictEqual(body.p_collecting_bank,'COLLECTION SOURCE BANK');assert.strictEqual(body.p_collecting_bank_address,'PORT SUDAN SAVED ADDRESS');sendCalls++;status='sent_to_collecting';return route.fulfill({status:200,headers,body:JSON.stringify(file())});}
      if(url.pathname.startsWith('/storage/v1/object/trade-collection-documents/')){uploadCalls++;assert.ok(url.pathname.includes(`/relations/${tradeId}/2/case/company_letter/`));return route.fulfill({status:200,headers,body:'{}'});}
      if(url.pathname==='/rest/v1/rpc/register_bsgt_relations_attachment'){const body=req.postDataJSON();assert.strictEqual(body.p_shipment_id,null);assert.strictEqual(body.p_trade_file_id,tradeId);registrations++;attachments.filter(a=>a.shipment_id===null&&a.attachment_type===body.p_attachment_type).forEach(a=>a.is_active=false);const attachment={id:`attachment-${registrations}`,shipment_id:null,trade_file_id:tradeId,attachment_type:body.p_attachment_type,storage_path:body.p_storage_path,original_name:body.p_original_name,revision_no:2,is_active:true};attachments.push(attachment);return route.fulfill({status:200,headers,body:JSON.stringify(attachment)});}
      if(url.pathname==='/rest/v1/companies')return route.fulfill({status:200,headers,body:JSON.stringify([company])});
      if(url.pathname==='/rest/v1/bank_book')return route.fulfill({status:200,headers,body:JSON.stringify([{id:'bank-1',nick:'COLLECTING BANK',body:'DUBAI'}])});
      if(url.pathname==='/rest/v1/lookups')return route.fulfill({status:200,headers,body:JSON.stringify([{id:'saved-bank',list_key:'collectionSending.collectingBankProfile',value:'COLLECTION SOURCE BANK|||PORT SUDAN SAVED ADDRESS',linked_address:'PORT SUDAN SAVED ADDRESS',active:true,sort_order:0}])});
      if(url.pathname==='/rest/v1/trade_collection_files')return route.fulfill({status:200,headers,body:JSON.stringify(file())});
      if(url.pathname==='/rest/v1/trade_collection_file_shipments')return route.fulfill({status:200,headers,body:JSON.stringify([shipmentId,secondShipmentId].map((id,index)=>({id:`link-${index}`,trade_file_id:tradeId,shipment_id:id})))});
      if(url.pathname==='/rest/v1/trade_collection_relations_attachments')return route.fulfill({status:200,headers,body:JSON.stringify(attachments)});
      if(url.pathname==='/rest/v1/trade_collection_file_events'||url.pathname==='/rest/v1/shipment_files')return route.fulfill({status:200,headers,body:'[]'});
      if(url.pathname==='/rest/v1/trade_collection_file_documents')return route.fulfill({status:200,headers,body:JSON.stringify(['letter','undertaking','exchange'].map((document_type,index)=>({id:`doc-${index}`,trade_file_id:tradeId,revision_no:2,document_type,storage_path:`${tradeId}/2/${document_type}/file.pdf`,file_name:`${document_type}.pdf`,is_active:true,uploaded_by:profile.id,created_at:'2026-09-12T10:30:00Z'})))});
      if(url.pathname==='/rest/v1/shipments')return route.fulfill({status:200,headers,body:JSON.stringify([shipmentId,secondShipmentId].map((id,index)=>({id,status:'sent',VED:true,owner_id:profile.id,company_id:company.id,bsgt_stage:status,created_at:'2026-09-12T09:00:00Z',updated_at:'2026-09-12T09:00:00Z',data:{operationNo:`BSGTX-2026-010${index+5}`,consignee:'TEST CLIENT',itemDesc:'FABRIC',totalAmount:'USD 100.00'}})))});
      if(req.method()==='HEAD')return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});return route.fulfill({status:200,headers,body:'[]'});
    });
    const page=await context.newPage();await page.goto(`${APP}/#v=bsgtWorkspace&section=relations`,{waitUntil:'domcontentloaded'});
    await page.locator('#bsgtRelationsReady [data-bsgt-relations-open]').waitFor({timeout:20000});
    // Ready panel: one horizontal card with the real workflow track (relations current) and the three actions; no "sent" panel on this page.
    assert.strictEqual(await page.locator('#bsgtRelationsRoot .bsgt-relations-lane').count(),1,'only the ready panel is shown');
    assert.strictEqual(await page.locator('#bsgtRelationsSent').isVisible(),false);
    assert.match(await page.locator('#bsgtRelationsReadyTitle').innerText(),/للبنك المعني/);
    assert.strictEqual(await page.locator('#bsgtRelationsReady .bsgt-relations-track li').count(),4);
    assert.strictEqual(await page.locator('#bsgtRelationsReady .bsgt-relations-track li.is-done').count(),3);
    assert.strictEqual(await page.locator('#bsgtRelationsReady .bsgt-relations-track li.is-current b').innerText(),'العلاقات التجارية');
    assert.strictEqual(await page.locator('#bsgtRelationsReady [data-bsgt-relations-print]').count(),1);
    assert.strictEqual(await page.locator('#bsgtRelationsReady [data-bsgt-relations-send]').count(),1);
    // The saved bank is not a collection-bank profile, so the card button opens the file to pick one instead of sending.
    await page.locator('#bsgtRelationsReady [data-bsgt-relations-send]').click();
    await page.locator('#bsgtRelationsSend').waitFor();
    assert.strictEqual(sendCalls,0);
    assert.strictEqual(await page.locator('#bsgtRelationsConfirm').isVisible(),false);
    await page.locator('#bsgtRelationsReady [data-bsgt-relations-open]').click();
    await page.locator('#bsgtRelationsSend').waitFor();
    assert.match(await page.locator('.bsgt-relations-warning').innerText(),/2/);
    assert.strictEqual(await page.locator('[data-bsgt-relations-upload]').count(),2);
    assert.strictEqual(await page.locator('.bsgt-relations-shipment').count(),2);
    assert.strictEqual(await page.locator('#bsgtRelationsCaseAttachments').count(),1);
    assert.strictEqual(await page.locator('[data-bsgt-relations-generated]').count(),8);
    // Exercise the shared signing UI in the actual relations portal without
    // replacing the existing attachments/history/preview controls.
    const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=20;const x=c.getContext('2d');x.fillRect(0,0,40,20);return c.toDataURL('image/png').split(',')[1];});
    let assetCalls=0;
    await context.route(`${APP}/api/bsgt-internal-document`,async route=>{
      const body=route.request().postDataJSON();assert.equal(body.tradeFileId,tradeId);
      if(body.action==='signing-assets'){
        assetCalls++;assert.equal(body.shipmentId,shipmentId);assert.equal(body.revisionNo,2);
        const asset={label:'Saved image',url:'data:image/png;base64,'+png,placement:{x:.1,y:.2,width:.15}};
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({sources:{'buyer-stamp':[asset],'buyer-signature':[asset],'company-stamp':[asset],'company-signature':[asset]},notes:[]})});
      }
      assert.equal(body.action,'sign');assert.equal(body.placements.length,1);
      signedDocument={document_type:body.kind,shipment_id:body.shipmentId,document_variant:'administration_signed',storage_path:'workflow/relations-signed.pdf'};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({document:signedDocument})});
    });
    revisionMode=true;
    await page.evaluate(()=>loadBsgtRelationsDetail('10000000-0000-4000-8000-000000000005'));
    await page.locator('#bsgtRelationsDetail [data-packages] button').filter({hasText:'إضافة توقيع'}).first().click();
    const signDialog=page.locator('dialog[open]');
    await page.waitForFunction(()=>{const buttons=[...document.querySelectorAll('dialog[open] [data-auto-pick]')];return buttons.length===4&&buttons.every(b=>!b.disabled);});
    assert.equal(assetCalls,1,'relations uses scoped assets without profile access');
    for(const key of ['buyer-stamp','buyer-signature','company-stamp','company-signature']){
      await signDialog.locator(`[data-auto-pick="${key}"]`).click();await signDialog.locator('[data-overlay] img').waitFor();
      assert.equal(await signDialog.locator('[data-overlay] img').evaluate(img=>img.style.left),'10%');
      await signDialog.locator('[data-delete]').click();
    }
    await signDialog.locator('[data-image]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
    await signDialog.locator('[data-add]').click();await signDialog.locator('[data-overlay] img').waitFor();
    await signDialog.locator('[data-save]').click();
    await page.locator('#bsgtRelationsDetail [data-packages] button').filter({hasText:'معاينة الموقّع'}).waitFor();
    assert.ok(signedDocument);assert.equal(await page.locator('[data-bsgt-relations-generated]').count(),8,'previous previews remain');
    assert.equal(await page.locator('#bsgtRelationsDetail [data-packages] button').filter({hasText:'إضافة توقيع'}).count(),4,'remaining originals do not require signing');
    assert.strictEqual(await page.locator('#bsgtRelationsBank option[value="COLLECTING BANK"]').count(),0,'bank_book entries are not choices');
    assert.strictEqual(await page.locator('#bsgtRelationsBank option').filter({hasText:'LOCAL ONLY BANK'}).count(),0,'database is authoritative, not this browser');
    const bankKey='COLLECTION SOURCE BANK|||PORT SUDAN SAVED ADDRESS';
    await page.locator('#bsgtRelationsBank').selectOption(bankKey);
    assert.strictEqual(await page.locator('#bsgtRelationsBankAddress').inputValue(),'PORT SUDAN SAVED ADDRESS');
    assert.strictEqual(await page.locator('#bsgtRelationsBankAddress').getAttribute('readonly'),'');
    const chooserPromise=page.waitForEvent('filechooser');
    await page.locator('[data-bsgt-relations-upload="company_letter"]').click();
    await (await chooserPromise).setFiles({name:'case-letter.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-test')});
    await page.locator('#bsgtRelationsCaseAttachments small').filter({hasText:'case-letter.pdf'}).waitFor();
    assert.strictEqual(uploadCalls,1);assert.strictEqual(registrations,1);
    assert.match(await page.locator('.bsgt-relations-warning').innerText(),/1/);
    attachments.push({id:'legacy',trade_file_id:tradeId,shipment_id:secondShipmentId,attachment_type:'company_letter',revision_no:1,is_active:true,original_name:'legacy-letter.pdf',storage_path:'relations/legacy/file.pdf'});
    canEditPermission=false;await page.reload({waitUntil:'domcontentloaded'});await page.locator('#bsgtRelationsReady [data-bsgt-relations-open]').click();await page.locator('.bsgt-relations-detail').waitFor();
    assert.strictEqual(await page.locator('#bsgtRelationsSend').count(),0);
    assert.strictEqual(await page.locator('#bsgtRelationsReady [data-bsgt-relations-send]').count(),0,'view-only users get no send button on the card');
    assert.strictEqual(await page.locator('[data-bsgt-relations-upload]').count(),0);
    await page.evaluate(()=>JahezRevisionWorkflow.renderInternalPackage(document.getElementById('bsgtRelationsDetail'),bsgtRelationsState.detail.file,'relations'));
    assert.equal(await page.locator('#bsgtRelationsDetail [data-packages] button').filter({hasText:'إضافة توقيع'}).count(),0,'view-only cannot sign');
    canEditPermission=true;await page.reload({waitUntil:'domcontentloaded'});await page.locator('#bsgtRelationsReady [data-bsgt-relations-open]').click();await page.locator('#bsgtRelationsSend').waitFor();
    assert.strictEqual(await page.locator('[data-bsgt-relations-preview="relations/legacy/file.pdf"]').count(),1,'old file still accessible without reparenting');
    assert.strictEqual(attachments.find(a=>a.id==='legacy').shipment_id,secondShipmentId);
    assert.strictEqual(await page.locator('[data-bsgt-relations-upload]').count(),2);
    await page.locator('#bsgtRelationsBank').selectOption(bankKey);
    await page.locator('#bsgtRelationsSend').click();
    assert.match(await page.locator('#bsgtRelationsConfirmMessage').innerText(),/اختيارية/);
    await page.locator('#bsgtRelationsConfirmSubmit').click();
    await page.locator('#bsgtRelationsReady .bsgt-relations-empty').waitFor({timeout:10000});
    assert.strictEqual(sendCalls,1);
    await page.evaluate(async()=>{await openBsgtRelationsFile('10000000-0000-4000-8000-000000000005');await JahezRevisionWorkflow.renderInternalPackage(document.getElementById('bsgtRelationsDetail'),bsgtRelationsState.detail.file,'relations');});
    assert.equal(await page.locator('#bsgtRelationsDetail [data-packages] button').filter({hasText:'إضافة توقيع'}).count(),0,'sent files are read-only');
    assert.strictEqual(await page.locator('#bsgtRelationsSent [data-bsgt-relations-open]').count(),1,'sent record still loaded, just not shown as a panel');
    assert.strictEqual(await page.locator('#bsgtRelationsConfirm').isVisible(),false);
    assert.strictEqual(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await context.close();console.log('BSGT relations browser workflow: passed');
  }finally{if(browser)await browser.close();server.kill('SIGTERM');}
}
main().catch(error=>{console.error(error);process.exit(1);});
