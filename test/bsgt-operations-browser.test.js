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

async function assertStageGeometry(page, width){
  const geometry = await page.locator('.bsgt-operations-stage-track').evaluate(track=>{
    const items=[...track.querySelectorAll('li')].map(item=>({
      circle:item.querySelector('span').getBoundingClientRect().toJSON(),
      label:item.querySelector('b').getBoundingClientRect().toJSON(),
      detail:item.querySelector('small')?.getBoundingClientRect().toJSON()||null,
      stage:item.dataset.stage
    }));
    const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    return {
      count:items.length,
      circleLabelOverlap:items.some(item=>intersects(item.circle,item.label)),
      adjacentLabelOverlap:items.some((item,index)=>index<items.length-1&&intersects(item.label,items[index+1].label)),
      detailOverlap:items.some(item=>item.detail&&intersects(item.label,item.detail)),
      stages:items.map(item=>item.stage),
      minWidth:parseFloat(getComputedStyle(track).minWidth),
      columns:getComputedStyle(track).gridTemplateColumns.split(' ').length
    };
  });
  assert.strictEqual(geometry.count,4,`${width}px renders four business stages`);
  assert.deepStrictEqual(geometry.stages,['operations','finance','management','relations']);
  assert.strictEqual(geometry.circleLabelOverlap,false,`${width}px circles do not overlap labels`);
  assert.strictEqual(geometry.adjacentLabelOverlap,false,`${width}px adjacent labels do not overlap`);
  assert.strictEqual(geometry.detailOverlap,false,`${width}px detailed state does not overlap its label`);
  if(width<=480) assert.ok(geometry.minWidth>=499,`${width}px uses contained horizontal scrolling`);
  else assert.strictEqual(geometry.minWidth,0,`${width}px fits the four-stage grid without forced scrolling`);
  assert.strictEqual(geometry.columns,4,`${width}px keeps four stage columns`);
}

const initialFiles = [
  {id:'44444444-4444-4444-8444-444444444441',shipment_id:shipmentId,document_type:'import_permit',label:'إذن الاستيراد',name:'permit.pdf',path:`${shipmentId}/permit.pdf`,mime:'application/pdf',size_bytes:100,created_at:'2026-09-12T06:10:00Z'},
  {id:'44444444-4444-4444-8444-444444444442',shipment_id:shipmentId,document_type:'certificate_of_origin',label:'شهادة المنشأ',name:'origin.pdf',path:`${shipmentId}/origin.pdf`,mime:'application/pdf',size_bytes:100,created_at:'2026-09-12T06:11:00Z'},
  {id:'44444444-4444-4444-8444-444444444443',shipment_id:shipmentId,document_type:'bill_of_lading',label:'بوليصة الشحن',name:'bol.pdf',path:`${shipmentId}/bol.pdf`,mime:'application/pdf',size_bytes:100,created_at:'2026-09-12T06:12:00Z'},
  {id:'44444444-4444-4444-8444-444444444444',shipment_id:shipmentId,document_type:'optional_attachment',label:'ملف إضافي اختياري',name:'optional.pdf',path:`${shipmentId}/optional.pdf`,mime:'application/pdf',size_bytes:100,created_at:'2026-09-12T06:13:00Z'}
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
    const profile = {id:userId,email:'operations@example.test',display_name:'موظف العمليات',role:'editor',active:true,photo_url:'',feature_permissions_initialized:true};
    const expiresAt = Math.floor(Date.now()/1000)+3600;
    await context.addInitScript(({profile,expiresAt,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'refresh-token',expires_at:expiresAt,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})), {profile,expiresAt,token:fakeJwt(expiresAt)});
    let shipmentFileReads = 0;
    let completeCalls = 0;
    let deleteCalls = 0;
    let storageDeleteCalls = 0;
    let currentStage = 'operations_draft';
    let files = initialFiles.map(file=>({...file}));
    let imageApiCalls = 0;
    const shipmentPageRequests = [];
    await context.route('https://upload.wikimedia.org/jahez-test.png', route=>route.fulfill({
      status:200,
      contentType:'image/svg+xml',
      body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d01119"/></svg>'
    }));
    await context.route(`${APP_ORIGIN}/api/commodity-image**`, route=>{
      imageApiCalls++;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({imageUrl:'https://upload.wikimedia.org/jahez-test.png',thumbnailUrl:'https://upload.wikimedia.org/jahez-test.png',sourceName:'Wikimedia Commons',fallback:false})});
    });
    await context.route(`${SUPABASE_ORIGIN}/**`, async route=>{
      const request = route.request();
      const url = new URL(request.url());
      const headers = {'Access-Control-Allow-Origin':APP_ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};
      if(request.method()==='OPTIONS') return route.fulfill({status:204,headers,body:''});
      if(url.pathname==='/storage/v1/object/shipment-files' && request.method()==='DELETE'){
        storageDeleteCalls++;
        return route.fulfill({status:200,headers,body:'{}'});
      }
      if(url.pathname==='/rest/v1/profiles') return route.fulfill({status:200,headers,body:JSON.stringify([profile])});
      if(url.pathname==='/rest/v1/rpc/get_user_feature_permissions') return route.fulfill({status:200,headers,body:JSON.stringify([
        {permission_key:'bsgt.operations.view',allowed:true},
        {permission_key:'bsgt.operations.edit',allowed:true},
        {permission_key:'bsgt.operation_center.view',allowed:true},
        {permission_key:'shipment_documents.delete',allowed:true}
      ])});
      if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions') return route.fulfill({status:200,headers,body:JSON.stringify([{section:'operations',can_view:true,can_edit:true}])});
      if(url.pathname==='/rest/v1/rpc/complete_bsgt_operations'){
        completeCalls++;
        currentStage = 'ready_for_finance';
        return route.fulfill({status:200,headers,body:JSON.stringify(shipmentRow(currentStage))});
      }
      if(url.pathname==='/rest/v1/rpc/delete_bsgt_operations_document'){
        const payload=request.postDataJSON();
        const index=files.findIndex(file=>file.id===payload.p_file_id&&file.shipment_id===payload.p_shipment_id);
        if(index<0 || currentStage!=='operations_draft') return route.fulfill({status:403,headers,body:JSON.stringify({message:'Shipment document cannot be deleted'})});
        deleteCalls++;
        const [deleted]=files.splice(index,1);
        return route.fulfill({status:200,headers,body:JSON.stringify(deleted)});
      }
      if(url.pathname==='/rest/v1/companies') return route.fulfill({status:200,headers,body:JSON.stringify([{id:companyId,name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',active:true,is_default:false,sort_order:1,settings:{}}])});
      if(url.pathname==='/rest/v1/shipments'){
        if(url.searchParams.get('select')==='data') return route.fulfill({status:200,headers,body:JSON.stringify([
          {data:{consignee:'TEST BUYER'}},
          {data:{consignee:'STANDER FOR IMPORT AND EXPORT CO.LTD'}}
        ])});
        if(request.method()==='GET'){
          shipmentPageRequests.push(url.toString());
        }
        const single = String(request.headers().accept||'').includes('vnd.pgrst.object');
        const total=String(request.headers().prefer||'').includes('count=exact')?11:1;
        return route.fulfill({status:200,headers:{...headers,'Content-Range':`0-0/${total}`},body:JSON.stringify(single?shipmentRow(currentStage):[shipmentRow(currentStage)])});
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
    let mainNavigations = 0;
    page.on('console',message=>{if(message.type()==='error') consoleErrors.push(message.text());});
    page.on('framenavigated',frame=>{if(frame===page.mainFrame()) mainNavigations++;});
    page.on('dialog', dialog=>dialog.accept());
    await page.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=operations`, {waitUntil:'domcontentloaded'});
    await page.locator('.bsgt-operations-row:not(.is-head)').waitFor({timeout:20000});
    mainNavigations = 0;
    assert.strictEqual(await page.locator('.bsgt-operations-row:not(.is-head)').count(), 1);
    assert.strictEqual(await page.locator('.bsgt-operations-list').count(), 1, 'only the master navigator list is rendered');
    assert.strictEqual(await page.locator('.bsgt-operations-row.is-head').count(), 0, 'the legacy table header is not rendered');
    assert.strictEqual((await page.locator('.bsgt-operations-row-copy em').textContent()).replace(/\s+/g,' ').trim(), '7/7 متطلبات');
    assert.strictEqual(shipmentFileReads, 1, 'the paginated list must use one bulk file query');
    const assetState = await page.evaluate(()=>{
      const assets = [...document.querySelectorAll('link[rel="stylesheet"],script[src]')].map(node=>node.getAttribute('href')||node.getAttribute('src'));
      const indexOf = suffix=>assets.findIndex(asset=>asset?.includes(suffix));
      return {
        assets,
        brand:indexOf('brand-theme.css'),
        workspace:indexOf('bsgt-workspace.css'),
        operations:indexOf('bsgt-operations.css')
      };
    });
    assert.ok(assetState.brand < assetState.workspace && assetState.workspace < assetState.operations, 'CSS order is base/brand, workspace, then operations');
    assert.strictEqual(assetState.assets.filter(asset=>asset?.includes('bsgt-finance.css')).length, 1, 'finance CSS is loaded once');
    assert.strictEqual(assetState.assets.filter(asset=>asset?.includes('bsgt-finance.js')).length, 1, 'finance script is loaded once');
    assert.ok(assetState.assets.some(asset=>asset?.includes('bsgt-operations.css?v=20260913-operations-filter-1')), 'operations CSS uses the filter-layout cache version');
    assert.ok(assetState.assets.some(asset=>asset?.includes('bsgt-operations.js?v=20260912-full-shipment-1')), 'operations JS uses the full-shipment cache version');
    assert.ok(assetState.assets.some(asset=>asset?.includes('commodity-images.js?v=20260913-wide-images-1')), 'commodity images use the repaired cache version');
    await page.waitForFunction(()=>document.querySelectorAll('#bsgtOperationsConsignee option').length===3);
    assert.deepStrictEqual(await page.locator('#bsgtOperationsConsignee option').allTextContents(), ['كل المرسل إليهم','STANDER FOR IMPORT AND EXPORT CO.LTD','TEST BUYER'], 'consignee filter uses current BSGT shipment values');
    assert.strictEqual(await page.locator('.bsgt-operations-row .bsgt-commodity-thumb').count(), 0, 'the shipment list has no commodity images or placeholders');
    assert.strictEqual(await page.locator('.bsgt-operations-detail .bsgt-commodity-thumb').count(), 0, 'the detail header has no commodity image or placeholder');
    assert.strictEqual(await page.locator('#bsgtCommodityImageAdmin').count(), 0, 'the commodity image change action is not rendered');
    await page.waitForTimeout(200);
    assert.strictEqual(imageApiCalls, 0, 'Operations does not request the commodity image API');

    await page.locator('#bsgtOperationsSearch').fill('TEST');
    await page.waitForTimeout(400);
    assert.ok(new URL(shipmentPageRequests.at(-1)).searchParams.get('or')?.includes('TEST'), 'search is applied to the server-side query');
    await page.locator('#bsgtOperationsConsignee').selectOption('TEST BUYER');
    await page.waitForTimeout(100);
    let latestShipmentQuery=new URL(shipmentPageRequests.at(-1));
    assert.strictEqual(latestShipmentQuery.searchParams.get('data->>consignee'), 'eq.TEST BUYER', 'consignee is applied to the server-side query');
    assert.ok(latestShipmentQuery.searchParams.get('or')?.includes('TEST'), 'search and consignee filter are combined');
    assert.match(await page.locator('.bsgt-operations-row').first().textContent(), /TEST BUYER/, 'selected consignee results remain visible');
    await page.locator('#bsgtOperationsSearch').fill('');
    await page.waitForTimeout(400);
    await page.locator('#bsgtOperationsConsignee').selectOption('');
    await page.waitForTimeout(100);
    latestShipmentQuery=new URL(shipmentPageRequests.at(-1));
    assert.strictEqual(latestShipmentQuery.searchParams.has('data->>consignee'), false, 'all consignees clears the server-side filter');
    await page.evaluate(()=>{bsgtOperationsListState.total=11;renderBsgtOperationsRows();});
    const requestsBeforePaging=shipmentPageRequests.length;
    await page.locator('[data-bsgt-page="2"]').click();
    await page.waitForFunction(()=>bsgtOperationsListState.page===2);
    await page.waitForTimeout(100);
    assert.ok(shipmentPageRequests.length>requestsBeforePaging, 'pagination requests the next server-side page');
    await page.evaluate(()=>{bsgtOperationsListState.page=1;bsgtOperationsListState.total=11;renderBsgtOperationsRows();});

    for(const {width,height} of [{width:390,height:844},{width:768,height:900}]){
      await page.setViewportSize({width,height});
      assert.strictEqual(await page.locator('.bsgt-operations-navigator').isVisible(), true, `${width}px shows the list first`);
      assert.strictEqual(await page.locator('.bsgt-operations-detail').isVisible(), false, `${width}px hides details before selection`);
      assert.strictEqual(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), true, `${width}px has no horizontal overflow`);
      await page.locator('[data-bsgt-operation-open]').click();
      assert.strictEqual(await page.locator('.bsgt-operations-detail').isVisible(), true, `${width}px opens full detail`);
      assert.strictEqual(await page.locator('.bsgt-operations-mobile-back').isVisible(), true, `${width}px provides a back button`);
      await assertStageGeometry(page,width);
      const progressSeparation = await page.evaluate(()=>{
        const bar=document.querySelector('.bsgt-operations-progress-bar');
        const stage=document.querySelector('.bsgt-operations-stage-region');
        return Boolean(bar&&stage&&bar.parentElement===stage.parentElement&&!bar.contains(stage)&&stage.offsetTop>bar.offsetTop+bar.offsetHeight);
      });
      assert.strictEqual(progressSeparation,true,`${width}px keeps document readiness separate from workflow stages`);
      await page.locator('#bsgtOperationsMobileBack').click();
    }
    for(const viewport of [{width:1920,height:1080},{width:1536,height:864},{width:1440,height:900},{width:1366,height:768},{width:1024,height:768}]){
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(()=>{
        const workspace=document.querySelector('#viewBsgtWorkspace .bsgt-operations-workspace');
        const view=document.querySelector('#viewBsgtWorkspace');
        const sidebar=document.querySelector('.app-sidebar');
        const navigator=workspace?.querySelector(':scope > .bsgt-operations-navigator');
        const detail=workspace?.querySelector(':scope > .bsgt-operations-detail');
        const box = element=>element?.getBoundingClientRect().toJSON();
        return {
          display:workspace&&getComputedStyle(workspace).display,
          columns:workspace&&getComputedStyle(workspace).gridTemplateColumns,
          workspace:box(workspace), view:box(view), sidebar:box(sidebar), navigator:box(navigator), detail:box(detail),
          viewportWidth:window.innerWidth,
          overflow:document.documentElement.scrollWidth<=window.innerWidth,
          workspaces:document.querySelectorAll('#viewBsgtWorkspace .bsgt-operations-workspace').length,
          navigators:document.querySelectorAll('#viewBsgtWorkspace .bsgt-operations-navigator').length,
          details:document.querySelectorAll('#viewBsgtWorkspace .bsgt-operations-detail').length
        };
      });
      assert.strictEqual(layout.display, 'grid', `${viewport.width}px keeps the desktop grid`);
      assert.match(layout.columns, /^(320|360)px\s/, `${viewport.width}px keeps a fixed navigator column`);
      assert.strictEqual(layout.workspaces, 1, `${viewport.width}px renders one workspace`);
      assert.strictEqual(layout.navigators, 1, `${viewport.width}px renders one navigator`);
      assert.strictEqual(layout.details, 1, `${viewport.width}px renders one detail panel`);
      assert.ok(Math.abs(layout.navigator.top-layout.detail.top)<=1, `${viewport.width}px aligns navigator and detail tops`);
      assert.ok(layout.detail.top < layout.navigator.bottom, `${viewport.width}px keeps detail beside, not below, navigator`);
      assert.ok(layout.detail.width > layout.navigator.width, `${viewport.width}px gives detail the remaining width`);
      if(viewport.width >= 1366){
        const availableWidth = layout.viewportWidth - layout.sidebar.width;
        assert.ok(layout.view.width >= availableWidth * .94, `${viewport.width}px uses at least 94% of the available width`);
      }
      assert.strictEqual(layout.overflow, true, `${viewport.width}px has no horizontal overflow`);
      await assertStageGeometry(page,viewport.width);
    }
    const stagePresentations = await page.evaluate(stages=>Object.fromEntries(stages.map(stage=>{
      const host=document.createElement('div');
      host.innerHTML=renderBsgtOperationsStageTrack({bsgtStage:stage},null);
      return [stage,{
        current:host.querySelector('li.is-current')?.dataset.stage||null,
        completed:host.querySelectorAll('li.is-done').length,
        detail:host.querySelector('.bsgt-operations-stage-track small')?.textContent.trim()||'',
        completeBadge:Boolean(host.querySelector('.bsgt-operations-complete-badge'))
      }];
    })),['operations_draft','ready_for_finance','sent_to_remitting','management_review','final_accepted','sent_to_collecting']);
    assert.deepStrictEqual(stagePresentations.operations_draft,{current:'operations',completed:0,detail:'مسودة',completeBadge:false});
    assert.deepStrictEqual(stagePresentations.ready_for_finance,{current:'finance',completed:1,detail:'جاهزة للمالية',completeBadge:false});
    assert.deepStrictEqual(stagePresentations.sent_to_remitting,{current:'management',completed:2,detail:'تم الإرسال للبنك المرسل',completeBadge:false});
    assert.deepStrictEqual(stagePresentations.management_review,{current:'management',completed:2,detail:'قيد مراجعة الإدارة',completeBadge:false});
    assert.deepStrictEqual(stagePresentations.final_accepted,{current:'relations',completed:3,detail:'القبول النهائي · جاهزة للإرسال',completeBadge:false});
    assert.deepStrictEqual(stagePresentations.sent_to_collecting,{current:null,completed:4,detail:'تم الإرسال للبنك المحصل',completeBadge:true});
    assert.strictEqual(await page.locator('.bsgt-operations-kpi').count(), 3, 'operations KPIs are rendered');
    assert.strictEqual(await page.locator('.bsgt-operations-row.is-selected').count(), 1, 'the selected shipment is highlighted');
    assert.strictEqual(await page.locator('.bsgt-operations-detail .bsgt-commodity-thumb').count(), 0, 'the detail remains image-free after responsive checks');
    await page.locator('[data-bsgt-operation-open]').click();
    await page.locator('[data-bsgt-ops-tab="documents"]').click();
    await page.locator('#bsgtOperationsQuickDocumentsPanel').waitFor();
    await page.waitForFunction(()=>document.querySelector('#bsgtOperationsQuickDocumentsPanel')?.textContent.includes('7 / 7'));
    assert.strictEqual(await page.locator('#bsgtOperationsQuickDocumentsPanel [data-bsgt-upload], #bsgtOperationsQuickDocumentsPanel [data-bsgt-file-delete]').count(), 0, 'quick overview does not duplicate document write controls');
    assert.strictEqual(await page.locator('#bsgtOperationsOpenFull').count(), 1, 'quick overview provides the full shipment action');
    await page.locator('#bsgtOperationsOpenFull').click();
    await page.locator('#overlay.bsgt-workspace-overlay.open .bsgt-detail-card').waitFor();
    await page.locator('#bsgtOperationsDocumentsPanel').waitFor();
    await page.waitForFunction(()=>document.querySelector('#bsgtOperationsDocumentsPanel')?.textContent.includes('7 / 7'));
    assert.ok(page.url().includes(`#v=records&id=${shipmentId}`), 'full shipment view has a stable records route');
    assert.ok(page.url().includes('returnTo=operations'), 'full shipment view preserves its operations source');
    assert.match(await page.locator('.bsgt-detail-card').textContent(), /مركز العملية/, 'full shipment view keeps the operation center');
    assert.strictEqual(await page.locator('#bsgtOperationsDetail #bsgtOperationsDocumentsPanel').count(), 0, 'quick overview and full view never duplicate the execution panel id');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#overlay.bsgt-workspace-overlay.open .bsgt-detail-card').waitFor({timeout:20000});
    await page.waitForFunction(()=>document.querySelector('#bsgtOperationsDocumentsPanel')?.textContent.includes('7 / 7'));
    mainNavigations = 0;
    assert.ok(page.url().includes('returnTo=operations'), 'refresh remains on the same full shipment route');
    assert.strictEqual(await page.locator('.bsgt-operations-group').count(), 2, 'generated and uploaded document groups are rendered');
    assert.strictEqual(await page.locator('.bsgt-operations-group').first().locator('.bsgt-operation-doc-card').count(), 4, 'all four generated document cards are rendered');
    assert.strictEqual(await page.locator('.bsgt-operation-doc-card').first().evaluate(element=>getComputedStyle(element).display), 'flex', 'document cards keep their component styling');
    assert.match(await page.locator('.bsgt-operations-group').nth(1).textContent(), /المستندات المرفوعة/, 'uploaded documents section is rendered');
    const requiredCards=page.locator('[data-bsgt-document-kind="uploaded"][data-bsgt-file-id]').filter({hasNotText:'ملف اختياري'});
    assert.strictEqual(await requiredCards.count(), 3, 'all uploaded required documents are rendered');
    for(let index=0;index<await requiredCards.count();index++){
      const card=requiredCards.nth(index);
      assert.strictEqual(await card.locator('[data-bsgt-file-open]').count(), 1, 'uploaded required document provides preview');
      assert.strictEqual(await card.locator('[data-bsgt-upload]').count(), 1, 'uploaded required document provides replace');
      assert.strictEqual(await card.locator('[data-bsgt-file-delete]').count(), 1, 'uploaded required document provides delete');
    }
    assert.strictEqual(await page.locator('[data-bsgt-document-kind="generated"] [data-bsgt-file-delete]').count(), 0, 'generated documents never provide delete');
    assert.strictEqual(await page.locator('#packageBtn, #mergeAllBtn').count(), 0, 'merge actions are hidden without package.merge permission');
    const optionalCard=page.locator(`[data-bsgt-file-id="${initialFiles[3].id}"]`);
    assert.strictEqual(await optionalCard.locator('[data-bsgt-file-open], [data-bsgt-upload], [data-bsgt-file-delete]').count(), 3, 'optional uploaded document provides preview, replace, and delete');

    const operationsUploadAccess=await page.evaluate(()=>({
      importPermitPortal:window.JahezPermissions.can('import_permit.view'),
      operationUploads:document.querySelectorAll('#bsgtOperationsDocumentsPanel [data-bsgt-upload]').length
    }));
    assert.strictEqual(operationsUploadAccess.importPermitPortal,false,'import permit portal permission is not assigned');
    assert.ok(operationsUploadAccess.operationUploads>=4,'operations.edit alone permits uploaded import-document actions');

    await page.evaluate(id=>{
      currentUser.role='admin';
      if(currentUser.profile) currentUser.profile.role='admin';
      bsgtWorkspacePermissionRows=[];
      currentFeaturePermissionRows=[];
      syncCurrentPermissionContext();
      refreshBsgtOperationsPanel(records.find(record=>record.id===id));
    },shipmentId);
    assert.ok(await page.locator('#bsgtOperationsDocumentsPanel [data-bsgt-upload]').count()>=4,'admin sees operations uploads without granular rows');
    assert.ok(await page.locator('#bsgtOperationsDocumentsPanel [data-bsgt-file-delete]').count()>=4,'admin sees operations deletes during operations draft');
    await page.evaluate(id=>{
      currentUser.role='editor';
      if(currentUser.profile) currentUser.profile.role='editor';
      bsgtWorkspacePermissionRows=[{section:'operations',can_view:true,can_edit:true}];
      currentFeaturePermissionRows=[
        {permission_key:'bsgt.operations.view',allowed:true},
        {permission_key:'bsgt.operations.edit',allowed:true},
        {permission_key:'bsgt.operation_center.view',allowed:true},
        {permission_key:'shipment_documents.delete',allowed:true}
      ];
      syncCurrentPermissionContext();
      refreshBsgtOperationsPanel(records.find(record=>record.id===id));
    },shipmentId);

    await page.evaluate(id=>{
      bsgtWorkspacePermissionRows=[{section:'operations',can_view:true,can_edit:false}];
      currentFeaturePermissionRows=[
        {permission_key:'bsgt.operations.view',allowed:true},
        {permission_key:'bsgt.operation_center.view',allowed:true}
      ];
      syncCurrentPermissionContext();
      refreshBsgtOperationsPanel(records.find(record=>record.id===id));
    },shipmentId);
    assert.strictEqual(await page.locator('[data-bsgt-file-delete]').count(), 0, 'viewer does not see delete actions');
    assert.strictEqual(await page.locator('[data-bsgt-document-kind="uploaded"] [data-bsgt-file-open]').count(), 4, 'viewer keeps uploaded-document preview actions');
    await page.evaluate(id=>{
      bsgtWorkspacePermissionRows=[{section:'operations',can_view:true,can_edit:true}];
      currentFeaturePermissionRows=[
        {permission_key:'bsgt.operations.view',allowed:true},
        {permission_key:'bsgt.operations.edit',allowed:true},
        {permission_key:'bsgt.operation_center.view',allowed:true},
        {permission_key:'shipment_documents.delete',allowed:true}
      ];
      syncCurrentPermissionContext();
      refreshBsgtOperationsPanel(records.find(record=>record.id===id));
    },shipmentId);

    const crossShipmentResult=await page.evaluate(async ({fileId})=>{
      const {data,error}=await sb.rpc('delete_bsgt_operations_document',{p_shipment_id:'55555555-5555-4555-8555-555555555555',p_file_id:fileId});
      return {data,error:Boolean(error)};
    },{fileId:initialFiles[0].id});
    assert.strictEqual(crossShipmentResult.error, true, 'cross-shipment delete is rejected');
    assert.strictEqual(deleteCalls, 0, 'cross-shipment rejection does not delete a row');
    await page.waitForTimeout(50);
    assert.ok(consoleErrors.every(message=>message.includes('403')), `unexpected console errors before delete: ${consoleErrors.join(' | ')}`);
    consoleErrors.length=0;

    await page.locator(`[data-bsgt-file-delete="${initialFiles[0].id}"]`).click();
    const deleteDialog=page.locator('#shipmentWorkflowDialog');
    assert.strictEqual(await deleteDialog.locator('h3').textContent(), 'هل تريد حذف هذا المستند؟');
    assert.match(await deleteDialog.textContent(), /إذن الاستيراد/);
    assert.match(await deleteDialog.textContent(), /permit\.pdf/);
    await deleteDialog.locator('[data-workflow-dialog="confirm"]').click();
    await page.waitForFunction(()=>document.querySelector('#bsgtOperationsDocumentsPanel')?.textContent.includes('6 / 7'));
    assert.strictEqual(deleteCalls, 1, 'required file is deleted once');
    assert.strictEqual(storageDeleteCalls, 1, 'required storage object is removed once');
    assert.strictEqual(mainNavigations, 0, 'delete refreshes the current shipment without a page reload');
    assert.strictEqual(await page.locator('#bsgtSendToFinanceBtn:not([disabled])').count(), 0, 'required deletion disables send to finance');
    assert.match(await page.locator('.bsgt-operations-missing').textContent(), /إذن الاستيراد/, 'required deletion shows the missing document');

    files=initialFiles.map(file=>({...file}));
    await page.evaluate(async id=>{await loadShipmentFiles(id);refreshBsgtOperationsPanel(records.find(record=>record.id===id));},shipmentId);
    await page.waitForFunction(()=>document.querySelector('#bsgtOperationsDocumentsPanel')?.textContent.includes('7 / 7'));
    await page.locator(`[data-bsgt-file-delete="${initialFiles[3].id}"]`).click();
    await page.locator('#shipmentWorkflowDialog [data-workflow-dialog="confirm"]').click();
    await page.waitForFunction(name=>!document.querySelector('#bsgtOperationsDocumentsPanel')?.textContent.includes(name),initialFiles[3].name);
    assert.strictEqual(deleteCalls, 2, 'optional file is deleted once');
    assert.strictEqual(storageDeleteCalls, 2, 'optional storage object is removed once');
    assert.strictEqual(await page.locator('#bsgtSendToFinanceBtn:not([disabled])').count(), 1);
    await page.locator('#bsgtSendToFinanceBtn').click();
    await page.waitForFunction(()=>document.querySelector('#bsgtOperationsDocumentsPanel')?.textContent.includes('تم إرسالها من العمليات'));
    assert.strictEqual(completeCalls, 1);
    assert.ok(shipmentFileReads >= 2, 'list is bulk-loaded and submit must re-fetch files');
    assert.strictEqual(currentStage, 'ready_for_finance');
    assert.strictEqual(await page.locator('[data-bsgt-file-delete]').count(), 0, 'ready-for-finance documents are read-only');
    assert.strictEqual(await page.locator('[data-bsgt-upload]').count(), 0, 'ready-for-finance replacement and upload are hidden');
    await page.locator('#closeDetail').click();
    await page.waitForFunction(()=>location.hash==='#v=bsgtWorkspace&section=operations');
    assert.strictEqual(await page.locator('#overlay.open').count(), 0, 'full shipment back closes the overlay');
    assert.ok(page.url().includes('#v=bsgtWorkspace&section=operations'), 'back returns to the operations source');
    await page.evaluate(()=>switchView('bsgtWorkspace',{section:'operationCenter'}));
    await page.locator('[data-operation-center-root="bsgt"] [data-operation-open]').waitFor();
    await page.locator('[data-operation-center-root="bsgt"] [data-operation-open]').click();
    await page.locator('#overlay.bsgt-workspace-overlay.open .bsgt-detail-card').waitFor();
    assert.ok(page.url().includes('returnTo=operationCenter'), 'operation center opens the same full shipment route with its source');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#overlay.bsgt-workspace-overlay.open .bsgt-detail-card').waitFor({timeout:20000});
    await page.locator('#closeDetail').click();
    await page.waitForFunction(()=>location.hash==='#v=bsgtWorkspace&section=operationCenter');
    assert.ok(page.url().includes('#v=bsgtWorkspace&section=operationCenter'), 'back returns to the BSGT operation center source');
    assert.deepStrictEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(' | ')}`);
    await context.close();
    console.log('BSGT operations list, readiness, re-verification, and submit: passed');
  } finally {
    if(browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch(error=>{console.error(error);process.exit(1);});
