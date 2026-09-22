'use strict';
// «المركز المالي» phase 1 browser test (mocked Supabase; no production data).
// Covers: tab + route, permissions (admin / accountant / view-only), keyset list with next/prev,
// creation from an eligible trade file, details reading money with ::text casts and keeping it as
// strings, draft/bank/invoice/client writes through the RPCs with lock_version, admin maker-checker
// override, conflict handling, transition buttons per status, no console errors, phone width.
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');
const {chromium}=require('playwright-core');

const PORT=5600+Math.floor(Math.random()*100);
const BASE=`http://127.0.0.1:${PORT}`;
const APP=`http://jahez.test:${PORT}`;
const SUPABASE='https://vthcmqqiexaedukduquv.supabase.co';
const company={id:'bsgt-company',name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',active:true,is_default:false,sort_order:1,settings:{}};
const FILE_ID='30000000-0000-4000-8000-000000000001', TC_ID='20000000-0000-4000-8000-000000000001';
function executable(){return [process.env.CHROMIUM_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find(fs.existsSync);}
function jwt(id){const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');return `${enc({alg:'HS256'})}.${enc({sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})}.x`;}
async function waitServer(proc){for(let i=0;i<50;i++){if(proc.exitCode!==null)throw Error('server exited');try{if((await fetch(`${BASE}/healthz`)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}throw Error('server timeout');}
const quiet=list=>list.filter(e=>!/WebSocket|ERR_TUNNEL|net::|Failed to load resource/.test(e));

// One mocked database shared by every context; money is always a string here, as in PostgREST ::text / the RPC json helpers.
function makeDb(){
  const file={id:FILE_ID,trade_file_id:TC_ID,company_id:company.id,status:'draft',lock_version:1,consignee_snapshot:'TEST BUYER ONE',consignee_count:1,client_id:null,client_name_snapshot:null,client_confirmed_at:null,client_confirmed_by:null,
    invoice_total_usd:null,documents_value_aed:null,bank_tariff_per_1000_sdg:null,bsgt_tariff_per_1000_sdg:null,bank_cost_sdg:null,bsgt_commission_sdg:null,import_permit_source:null,import_permit_cost_sdg:null,import_permit_no:null,import_permit_issued_at:null,import_permit_expires_at:null,import_permit_issuer:null,
    client_total_sdg:null,calculation_ready:false,last_input_at:'2026-09-20T08:00:00Z',last_input_by:'acc-1',approved_at:null,approved_by:null,client_transferred_at:null,client_transferred_by:null,bank_paid_at:null,bank_paid_by:null,completed_at:null,completed_by:null,failed_at:null,failed_by:null,failure_reason:null,refund_started_at:null,refund_started_by:null,refunded_at:null,refunded_by:null,closed_at:null,closed_by:null,notes:null,created_by:'acc-1',created_at:'2026-09-20T08:00:00Z',updated_at:'2026-09-20T08:00:00Z'};
  const invoices=[
    {id:'inv-1',financial_file_id:FILE_ID,shipment_id:'40000000-0000-4000-8000-000000000001',invoice_no_snapshot:'INV-1',currency_snapshot:'USD',amount_source_text:'USD 1,000.12',amount_usd:null,amount_usd_basis:null,amount_confirmed_at:null,amount_confirmed_by:null,detached_at:null,detached_by:null,created_at:'2026-09-20T08:00:00Z'},
    {id:'inv-2',financial_file_id:FILE_ID,shipment_id:'40000000-0000-4000-8000-000000000002',invoice_no_snapshot:'INV-2',currency_snapshot:'AED',amount_source_text:'AED 1,836.25',amount_usd:null,amount_usd_basis:null,amount_confirmed_at:null,amount_confirmed_by:null,detached_at:null,detached_by:null,created_at:'2026-09-20T08:00:01Z'}
  ];
  const events=[{id:'ev-1',financial_file_id:FILE_ID,event_type:'created',from_status:null,to_status:'draft',lock_version_after:1,actor_id:'acc-1',note:null,changes:{consignees:['TEST BUYER ONE']},created_at:'2026-09-20T08:00:00Z'}];
  const calls=[];
  const recompute=()=>{
    const confirmed=invoices.filter(i=>!i.detached_at);
    file.invoice_total_usd=confirmed.length&&confirmed.every(i=>i.amount_usd!==null)?'1500.123456':null;   // synthetic exact sum for the test fixture
    const ready=file.invoice_total_usd!==null&&file.bank_tariff_per_1000_sdg!==null&&file.bsgt_tariff_per_1000_sdg!==null&&file.import_permit_cost_sdg!==null;
    file.bank_cost_sdg=file.invoice_total_usd!==null&&file.bank_tariff_per_1000_sdg!==null?'225018.518400000000000':null;
    file.bsgt_commission_sdg=file.invoice_total_usd!==null&&file.bsgt_tariff_per_1000_sdg!==null?'300024.691200000000000':null;
    file.client_total_sdg=ready?'1025043.209600000000000':null; file.calculation_ready=ready;
  };
  const bump=()=>{file.lock_version+=1;file.updated_at=new Date().toISOString();};
  const answer=extra=>({file:{...file},financial_file_id:FILE_ID,lock_version:file.lock_version,...extra});
  const rpc={
    list_bsgt_financial_files:body=>{
      const all=[{id:FILE_ID,trade_file_id:TC_ID,operation_no:'TC-2026-000101',trade_status:'draft',trade_archived_at:null,status:file.status,closed_at:file.closed_at,consignee_snapshot:file.consignee_snapshot,consignee_count:1,client_id:file.client_id,client_name_snapshot:file.client_name_snapshot,invoice_total_usd:file.invoice_total_usd,client_total_sdg:file.client_total_sdg,calculation_ready:file.calculation_ready,lock_version:file.lock_version,updated_at:'2026-09-20T09:00:00Z'}];
      for(let i=2;i<=12;i++) all.push({id:`3000000${i}-0000-4000-8000-000000000000`,trade_file_id:`tc-${i}`,operation_no:`TC-2026-0001${String(i).padStart(2,'0')}`,trade_status:'sent_to_collecting',trade_archived_at:i===12?'2026-09-01T00:00:00Z':null,status:'completed',closed_at:null,consignee_snapshot:`CLIENT ${i}`,consignee_count:1,client_id:null,client_name_snapshot:`CLIENT ${i}`,invoice_total_usd:'1500.000000',client_total_sdg:'1025000.000000000000000',calculation_ready:true,lock_version:5,updated_at:`2026-09-${String(20-i).padStart(2,'0')}T09:00:00Z`});
      let rows=all.filter(r=>!body.p_status||r.status===body.p_status).filter(r=>!body.p_search||r.operation_no.includes(body.p_search.toUpperCase())||r.consignee_snapshot.includes(body.p_search));
      if(body.p_after_id){const idx=rows.findIndex(r=>r.id===body.p_after_id);rows=rows.slice(idx+1);}
      return rows.slice(0,body.p_limit||10);
    },
    list_bsgt_financial_eligible_trade_files:()=>[{id:'20000000-0000-4000-8000-000000000009',operation_no:'TC-2026-000109',status:'draft',created_at:'2026-09-19T10:00:00Z',shipment_count:2,consignees:['NEW BUYER']}],
    create_bsgt_financial_file:()=>answer({created:true}),
    update_bsgt_financial_draft:body=>{const p=body.p_patch;if(p.bank_tariff_per_1000_sdg!==undefined)file.bank_tariff_per_1000_sdg=p.bank_tariff_per_1000_sdg;if(p.bsgt_tariff_per_1000_sdg!==undefined)file.bsgt_tariff_per_1000_sdg=p.bsgt_tariff_per_1000_sdg;
      if(p.import_permit_source!==undefined){file.import_permit_source=p.import_permit_source;file.import_permit_cost_sdg=p.import_permit_source==='client'?'0.000000':p.import_permit_source==='bsgt'?p.import_permit_cost_sdg:null;}
      if(p.notes!==undefined)file.notes=p.notes;file.last_input_by='acc-1';recompute();bump();events.unshift({id:'ev-'+events.length,financial_file_id:FILE_ID,event_type:'draft_updated',from_status:'draft',to_status:'draft',lock_version_after:file.lock_version,actor_id:'acc-1',note:null,changes:{bank_tariff_per_1000_sdg:[null,file.bank_tariff_per_1000_sdg]},created_at:new Date().toISOString()});return answer({changed:true});},
    update_bsgt_financial_bank_details:body=>{if(body.p_expected_lock_version!==file.lock_version)throw Object.assign(new Error(`Financial file version changed (expected ${body.p_expected_lock_version}, current ${file.lock_version}); reload and retry`),{status:400});
      const p=body.p_patch;if(p.import_permit_no!==undefined)file.import_permit_no=p.import_permit_no;if(p.documents_value_aed!==undefined)file.documents_value_aed=p.documents_value_aed;bump();return answer({changed:true});},
    confirm_bsgt_financial_invoice:body=>{const inv=invoices.find(i=>i.id===body.p_invoice_id);inv.amount_usd=body.p_amount_usd;inv.amount_usd_basis=inv.currency_snapshot==='USD'?'source_usd':body.p_usd_basis;inv.amount_confirmed_at=new Date().toISOString();inv.amount_confirmed_by='acc-1';recompute();bump();return answer({changed:true,invoice:{...inv}});},
    confirm_bsgt_financial_client:body=>{file.client_id=body.p_client_id;file.client_name_snapshot='TEST BUYER ONE';file.client_confirmed_at=new Date().toISOString();file.client_confirmed_by='acc-1';bump();return answer({changed:true});},
    transition_bsgt_financial_file:body=>{
      if(body.p_action==='approve'){if(file.last_input_by===body.__actor&&!body.p_override_reason)throw Object.assign(new Error('Maker-checker: the last person who entered financial data cannot approve it'),{status:400});file.status='pending_client_transfer';file.approved_at=new Date().toISOString();file.approved_by=body.__actor;}
      else if(body.p_action==='confirm_client_transfer'){file.status='client_transferred';file.client_transferred_at=new Date().toISOString();file.client_transferred_by=body.__actor;}
      else if(body.p_action==='fail'){file.status='failed';file.failed_at=new Date().toISOString();file.failed_by=body.__actor;file.failure_reason=body.p_note;}
      else throw Object.assign(new Error(`Transition ${body.p_action} is not allowed from status ${file.status}`),{status:400});
      bump();events.unshift({id:'ev-'+events.length,financial_file_id:FILE_ID,event_type:body.p_action==='approve'?'approved':body.p_action==='fail'?'failed':'client_transfer_confirmed',from_status:'draft',to_status:file.status,lock_version_after:file.lock_version,actor_id:body.__actor,note:body.p_override_reason?`ADMIN OVERRIDE (maker-checker): ${body.p_override_reason}`:body.p_note,changes:null,created_at:new Date().toISOString()});return answer({event_type:body.p_action});
    }
  };
  return {file,invoices,events,calls,rpc};
}

async function contextFor(browser,db,{role,id,featureKeys,width=1440}){
  const profile={id,email:`${id}@example.test`,display_name:`موظف ${role}`,role,active:true,photo_url:'',feature_permissions_initialized:true};
  const context=await browser.newContext({viewport:{width,height:900}});
  const exp=Math.floor(Date.now()/1000)+3600;
  await context.addInitScript(({profile,exp,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'r',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})),{profile,exp,token:jwt(id)});
  await context.route(`${SUPABASE}/**`,async route=>{const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':APP,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info, accept-profile, content-profile','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    const json=(status,body)=>route.fulfill({status,headers,body:JSON.stringify(body)});
    if(url.pathname==='/rest/v1/profiles'){const filter=url.searchParams.get('id')||'';
      const named=pid=>pid===id?profile:{id:pid,display_name:pid==='admin-1'?'مدير النظام':pid==='fm-1'?'مدير المالية':'المحاسب',email:pid+'@x'};
      if(filter.startsWith('in.('))return json(200,filter.slice(4,-1).split(',').filter(Boolean).map(named));
      if(filter.startsWith('eq.'))return json(200,String(req.headers().accept||'').includes('vnd.pgrst.object')?named(filter.slice(3)):[named(filter.slice(3))]);
      return json(200,[profile]);}
    if(url.pathname==='/rest/v1/companies')return json(200,[company]);
    if(url.pathname==='/rest/v1/rpc/get_user_feature_permissions')return json(200,featureKeys.map(permission_key=>({permission_key,allowed:true})));
    if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions')return json(200,[]);
    if(url.pathname.startsWith('/rest/v1/rpc/')){const name=url.pathname.slice('/rest/v1/rpc/'.length);const body={...(req.postDataJSON()||{}),__actor:id};db.calls.push({name,body:{...body}});
      if(!db.rpc[name])return json(200,[]);try{return json(200,db.rpc[name](body));}catch(error){return json(400,{message:error.message,code:'P0001'});}}
    if(url.pathname==='/rest/v1/bsgt_financial_files'){db.calls.push({name:'GET files',select:url.searchParams.get('select')});return json(200,String(req.headers().accept||'').includes('vnd.pgrst.object')?{...db.file}:[{...db.file}]);}
    if(url.pathname==='/rest/v1/bsgt_financial_file_invoices'){db.calls.push({name:'GET invoices',select:url.searchParams.get('select')});return json(200,db.invoices.map(i=>({...i})));}
    if(url.pathname==='/rest/v1/bsgt_financial_file_events')return json(200,db.events.map(e=>({...e})));
    if(url.pathname==='/rest/v1/trade_collection_files')return json(200,String(req.headers().accept||'').includes('vnd.pgrst.object')?{id:TC_ID,operation_no:'TC-2026-000101',status:'draft',archived_at:null}:[]);
    if(url.pathname==='/rest/v1/clients')return json(200,[{id:'client-1',name:'TEST BUYER ONE',name_ar:'المشتري الأول',name_en:'TEST BUYER ONE'},{id:'client-2',name:'OTHER BUYER',name_ar:null,name_en:null}]);
    if(req.method()==='HEAD')return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});
    return json(200,[]);
  });
  return context;
}
function track(page){const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});return ()=>quiet(errors);}
const section=()=>new URLSearchParams(location.hash.slice(1)).get('section');

async function main(){
  const browserPath=executable();if(!browserPath)throw Error('Chrome not found');
  const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','inherit','inherit']});let browser;
  try{
    await waitServer(server);browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    const shots=process.env.SHOT_DIR;
    const db=makeDb();

    // ---------------------------------------------------------------- accountant (view + edit)
    const acc=await contextFor(browser,db,{role:'staff',id:'acc-1',featureKeys:['bsgt.financial_center.view','bsgt.financial_center.edit']});
    const page=await acc.newPage();const accErrors=track(page);
    await page.goto(`${APP}/#v=bsgtWorkspace&section=financialCenter`,{waitUntil:'domcontentloaded'});
    await page.locator('#bsgtFinancialCenter [data-list-rows] tr[data-open]').first().waitFor({timeout:20000});
    assert.deepStrictEqual(await page.locator('.bsgt-workspace-tab').allTextContents(),['المركز المالي'],'accountant sees only the financial center tab');
    assert.strictEqual(await page.evaluate(section),'financialCenter');
    // keyset list: 10 rows, next → 2 rows, prev → 10 rows
    assert.strictEqual(await page.locator('[data-list-rows] tr[data-open]').count(),10);
    assert.match(await page.locator('[data-list-rows] tr[data-open]').first().innerText(),/TC-2026-000101/);
    if(shots) await page.screenshot({path:path.join(shots,'fc-list.png'),fullPage:true});
    await page.locator('[data-action="next-page"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-list-rows] tr[data-open]').length===2,null,{timeout:10000});
    assert.match(await page.locator('[data-page-info]').innerText(),/صفحة 2/);
    assert.strictEqual(await page.locator('[data-action="next-page"]').isDisabled(),true);
    const listCall=db.calls.filter(c=>c.name==='list_bsgt_financial_files').at(-1);
    assert.strictEqual(listCall.body.p_limit,10);assert.ok(listCall.body.p_after_id&&listCall.body.p_after_updated_at,'keyset cursor sent');
    await page.locator('[data-action="prev-page"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-list-rows] tr[data-open]').length===10,null,{timeout:10000});
    // status filter
    await page.locator('[data-filter="status"]').selectOption('completed');
    await page.locator('[data-action="apply-filters"]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-list-rows]').innerText.includes('TC-2026-000101'),null,{timeout:10000});
    await page.locator('[data-filter="status"]').selectOption('');await page.locator('[data-action="apply-filters"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-list-rows]').innerText.includes('TC-2026-000101'),null,{timeout:10000});
    // creation from an eligible trade file
    await page.locator('[data-action="open-create"]').click();
    await page.locator('[data-create-id]').waitFor({timeout:10000});
    assert.match(await page.locator('.fc-eligible-row').innerText(),/TC-2026-000109/);
    await page.locator('[data-create-id]').click();
    await page.locator('.fc-summary').waitFor({timeout:10000});
    assert.strictEqual(db.calls.find(c=>c.name==='create_bsgt_financial_file').body.p_trade_file_id,'20000000-0000-4000-8000-000000000009');
    // details read with ::text casts and money kept as strings
    const filesGet=db.calls.find(c=>c.name==='GET files');
    for(const col of ['invoice_total_usd::text','bank_cost_sdg::text','client_total_sdg::text','import_permit_cost_sdg::text','documents_value_aed::text']) assert.ok(filesGet.select.includes(col),`select casts ${col}`);
    assert.ok(db.calls.find(c=>c.name==='GET invoices').select.includes('amount_usd::text'));
    assert.strictEqual(await page.locator('[data-transition]').count(),0,'accountant has no transition buttons');
    // draft save: strings in the patch, computed values shown from the response/reload
    await page.fill('[data-form="draft"] [name="bank_tariff_per_1000_sdg"]','150,000');
    await page.fill('[data-form="draft"] [name="bsgt_tariff_per_1000_sdg"]','200000.000000');
    await page.selectOption('[data-form="draft"] [name="import_permit_source"]','bsgt');
    await page.fill('[data-form="draft"] [name="import_permit_cost_sdg"]','500000');
    await page.fill('[data-form="draft"] [name="notes"]','ملاحظة اختبار');
    await page.locator('[data-form="draft"] button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('.fc-summary')?.innerText.includes('النسخة 2'),null,{timeout:10000});
    const draftCall=db.calls.find(c=>c.name==='update_bsgt_financial_draft');
    assert.deepStrictEqual(draftCall.body.p_patch,{bank_tariff_per_1000_sdg:'150000',bsgt_tariff_per_1000_sdg:'200000.000000',import_permit_source:'bsgt',import_permit_cost_sdg:'500000',notes:'ملاحظة اختبار'});
    assert.strictEqual(draftCall.body.p_expected_lock_version,1);
    assert.strictEqual(typeof draftCall.body.p_patch.bank_tariff_per_1000_sdg,'string','tariffs are sent as strings');
    // 7-decimal input is rejected client-side without any RPC
    const before=db.calls.length;
    await page.fill('[data-form="draft"] [name="bank_tariff_per_1000_sdg"]','1.1234567');
    await page.locator('[data-form="draft"] button[type="submit"]').click();
    await page.waitForTimeout(400);
    assert.strictEqual(db.calls.length,before,'no RPC for invalid decimal');
    await page.fill('[data-form="draft"] [name="bank_tariff_per_1000_sdg"]','150000');
    // invoice confirmation: USD without basis, AED requires basis; amounts sent as strings
    await page.locator('[data-invoice="inv-1"] [data-amount]').fill('1000.123456');
    await page.locator('[data-confirm-invoice="inv-1"]').click();
    await page.waitForFunction(()=>document.querySelector('.fc-summary')?.innerText.includes('النسخة 3'),null,{timeout:10000});
    const inv1=db.calls.find(c=>c.name==='confirm_bsgt_financial_invoice');
    assert.strictEqual(inv1.body.p_amount_usd,'1000.123456');assert.strictEqual(inv1.body.p_usd_basis,null);
    await page.locator('[data-invoice="inv-2"] [data-amount]').fill('500');
    const beforeAed=db.calls.length;
    await page.locator('[data-confirm-invoice="inv-2"]').click();
    await page.waitForTimeout(400);
    assert.strictEqual(db.calls.length,beforeAed,'AED invoice without basis is blocked client-side');
    await page.locator('[data-invoice="inv-2"] [data-basis]').fill('سعر البنك 3.6725 بتاريخ الفاتورة');
    await page.locator('[data-confirm-invoice="inv-2"]').click();
    await page.waitForFunction(()=>document.querySelector('.fc-summary')?.innerText.includes('النسخة 4'),null,{timeout:10000});
    assert.strictEqual(db.calls.filter(c=>c.name==='confirm_bsgt_financial_invoice').at(-1).body.p_usd_basis,'سعر البنك 3.6725 بتاريخ الفاتورة');
    // computed costs displayed exactly (full-precision string in title, grouped display)
    const total=page.locator('.fc-costs .fc-total .fc-money');
    assert.strictEqual(await total.getAttribute('title'),'1025043.209600000000000');
    assert.strictEqual((await total.innerText()).trim(),'1,025,043.2096 SDG');
    assert.strictEqual(await page.locator('.fc-costs .fc-money').first().getAttribute('title'),'1500.123456');
    // client confirmation
    await page.fill('[data-client-search]','BUYER');
    await page.locator('[data-action="client-search"]').click();
    await page.locator('[data-client-id="client-1"]').waitFor({timeout:10000});
    await page.locator('[data-client-id="client-1"]').click();
    await page.waitForFunction(()=>document.querySelector('.fc-summary')?.innerText.includes('TEST BUYER ONE')&&document.querySelector('.fc-summary')?.innerText.includes('النسخة 5'),null,{timeout:10000});
    // bank details with a stale lock version → conflict message + reload
    db.file.lock_version+=1; // someone else changed the file
    await page.fill('[data-form="bank"] [name="import_permit_no"]','IP-100');
    await page.fill('[data-form="bank"] [name="documents_value_aed"]','5512.50');
    await page.locator('[data-form="bank"] button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('.fc-summary')?.innerText.includes('النسخة 6'),null,{timeout:10000});
    assert.strictEqual(db.file.import_permit_no,null,'conflicting write was not applied');
    await page.fill('[data-form="bank"] [name="import_permit_no"]','IP-100');
    await page.fill('[data-form="bank"] [name="documents_value_aed"]','5512.50');
    await page.locator('[data-form="bank"] button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('.fc-summary')?.innerText.includes('النسخة 7'),null,{timeout:10000});
    const bank=db.calls.filter(c=>c.name==='update_bsgt_financial_bank_details').at(-1);
    assert.deepStrictEqual(bank.body.p_patch,{import_permit_no:'IP-100',documents_value_aed:'5512.50',import_permit_issued_at:null,import_permit_expires_at:null,import_permit_issuer:null});
    if(shots) await page.screenshot({path:path.join(shots,'fc-detail-accountant.png'),fullPage:true});
    assert.deepStrictEqual(accErrors(),[],'accountant: no page/console errors');
    await acc.close();

    // ---------------------------------------------------------------- admin: transitions + maker-checker override
    db.file.last_input_by='admin-1';   // admin is now the last input → override path
    const admin=await contextFor(browser,db,{role:'admin',id:'admin-1',featureKeys:[]});
    const apage=await admin.newPage();const adminErrors=track(apage);
    const dialogs=[];apage.on('dialog',async d=>{dialogs.push({type:d.type(),message:d.message()});if(d.type()==='prompt')await d.accept('حالة طارئة: مدير المالية في إجازة');else await d.accept();});
    await apage.goto(`${APP}/#v=bsgtWorkspace&section=financialCenter`,{waitUntil:'domcontentloaded'});
    await apage.locator('#bsgtFinancialCenter [data-list-rows] tr[data-open]').first().waitFor({timeout:20000});
    assert.strictEqual(await apage.locator('.bsgt-workspace-tab').count(),9,'admin still sees all nine sections');
    await apage.locator('[data-list-rows] tr[data-open]').first().click();
    await apage.locator('.fc-summary').waitFor({timeout:10000});
    assert.deepStrictEqual(await apage.locator('[data-transition]').evaluateAll(list=>list.map(b=>b.dataset.transition)),['approve','fail']);
    await apage.locator('[data-transition="approve"]').click();
    await apage.waitForFunction(()=>document.querySelector('.fc-summary')?.innerText.includes('بانتظار تحويل العميل'),null,{timeout:10000});
    const approves=db.calls.filter(c=>c.name==='transition_bsgt_financial_file'&&c.body.p_action==='approve');
    assert.strictEqual(approves.length,2,'first attempt hit maker-checker, second carried the override reason');
    assert.strictEqual(approves[0].body.p_override_reason,null);assert.strictEqual(approves[1].body.p_override_reason,'حالة طارئة: مدير المالية في إجازة');
    assert.ok(dialogs.some(d=>d.type==='prompt'),'override reason prompted');
    assert.deepStrictEqual(await apage.locator('[data-transition]').evaluateAll(list=>list.map(b=>b.dataset.transition)),['confirm_client_transfer','reopen','fail']);
    assert.strictEqual(await apage.locator('[data-form="draft"] [name="bank_tariff_per_1000_sdg"]').isDisabled(),true,'financial inputs locked after approval');
    assert.strictEqual(await apage.locator('[data-form="bank"] [name="import_permit_no"]').isDisabled(),false,'bank details still editable before bank payment');
    assert.match(await apage.locator('.fc-events').innerText(),/ADMIN OVERRIDE/);
    await apage.locator('[data-transition="confirm_client_transfer"]').click();
    await apage.waitForFunction(()=>document.querySelector('.fc-summary')?.innerText.includes('تم تحويل العميل'),null,{timeout:10000});
    assert.deepStrictEqual(await apage.locator('[data-transition]').evaluateAll(list=>list.map(b=>b.dataset.transition)),['confirm_bank_payment','fail']);
    if(shots) await apage.screenshot({path:path.join(shots,'fc-detail-admin.png'),fullPage:true});
    // fail requires a reason (prompt) and shows the failure banner
    await apage.locator('[data-transition="fail"]').click();
    await apage.waitForFunction(()=>document.querySelector('.fc-failure'),null,{timeout:10000});
    assert.strictEqual(db.calls.filter(c=>c.name==='transition_bsgt_financial_file'&&c.body.p_action==='fail').at(-1).body.p_note,'حالة طارئة: مدير المالية في إجازة');
    assert.deepStrictEqual(await apage.locator('[data-transition]').evaluateAll(list=>list.map(b=>b.dataset.transition)),['start_refund']);
    assert.deepStrictEqual(adminErrors(),[],'admin: no page/console errors');
    // phone width
    const phone=await admin.newPage();await phone.setViewportSize({width:390,height:844});
    await phone.goto(`${APP}/#v=bsgtWorkspace&section=financialCenter`,{waitUntil:'domcontentloaded'});
    await phone.locator('#bsgtFinancialCenter [data-list-rows] tr[data-open]').first().waitFor({timeout:20000});
    assert.strictEqual(await phone.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'no horizontal overflow on phone');
    if(shots) await phone.screenshot({path:path.join(shots,'fc-phone.png'),fullPage:true});
    await admin.close();

    // ---------------------------------------------------------------- view only
    const viewer=await contextFor(browser,db,{role:'viewer',id:'view-1',featureKeys:['bsgt.financial_center.view']});
    const vpage=await viewer.newPage();const viewerErrors=track(vpage);
    await vpage.goto(`${APP}/#v=bsgtWorkspace&section=financialCenter`,{waitUntil:'domcontentloaded'});
    await vpage.locator('#bsgtFinancialCenter [data-list-rows] tr[data-open]').first().waitFor({timeout:20000});
    assert.strictEqual(await vpage.locator('[data-action="open-create"]').count(),0,'no create button for view-only');
    await vpage.locator('[data-list-rows] tr[data-open]').first().click();
    await vpage.locator('.fc-summary').waitFor({timeout:10000});
    assert.strictEqual(await vpage.locator('[data-transition]').count(),0);
    assert.strictEqual(await vpage.locator('[data-confirm-invoice]').count(),0);
    assert.strictEqual(await vpage.locator('[data-form] button[type="submit"]').count(),0);
    assert.strictEqual(await vpage.locator('[data-form] input:not(:disabled), [data-form] select:not(:disabled), [data-form] textarea:not(:disabled)').count(),0,'all inputs disabled for view-only');
    assert.deepStrictEqual(viewerErrors(),[]);
    await viewer.close();

    // ---------------------------------------------------------------- no key at all
    const none=await contextFor(browser,db,{role:'staff',id:'ops-1',featureKeys:['bsgt.operations.view']});
    const npage=await none.newPage();
    await npage.goto(`${APP}/#v=bsgtWorkspace&section=financialCenter`,{waitUntil:'domcontentloaded'});
    await npage.locator('#viewBsgtWorkspace.active .bsgt-workspace-tab').first().waitFor({timeout:20000});
    assert.deepStrictEqual(await npage.locator('.bsgt-workspace-tab').allTextContents(),['العمليات'],'no financial center without its key');
    assert.strictEqual(await npage.evaluate(section),'operations');
    await none.close();
    console.log('BSGT financial center phase 1 UI: passed');
  }finally{await browser?.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exit(1);});
