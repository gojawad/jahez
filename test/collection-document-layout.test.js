'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {chromium} = require('playwright-core');

const PORT = 4300 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const OUTPUT = path.join(__dirname, 'output');

function chromiumPath() {
  return [
    process.env.CHROMIUM_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean).find(candidate=>fs.existsSync(candidate));
}

async function waitForServer(server) {
  for(let attempt = 0; attempt < 50; attempt++){
    if(server.exitCode !== null) throw new Error(`server exited with ${server.exitCode}`);
    try { if((await fetch(`${BASE}/healthz`)).ok) return; } catch (_) {}
    await new Promise(resolve=>setTimeout(resolve, 200));
  }
  throw new Error('server did not start');
}

function supabaseStub() {
  const shipments = [
    {id:'11111111-1111-4111-8111-111111111111', company_id:'c1', status:'issued', data:{operationNo:'BSGTX-2026-0016', invoiceNo:'HJ2026173', invoiceDate:'2026-07-20', billNo:'278073887', totalAmount:'USD 14896.00', consignee:'STANDER FOR IMPORT AND EXPORT CO.LTD', consigneeAddress:'SOUQ LIBYA BLOCK(4)', itemDesc:'CURTAIN'}},
    {id:'22222222-2222-4222-8222-222222222222', company_id:'c1', status:'issued', data:{operationNo:'BSGTX-2026-0015', invoiceNo:'CY260719', invoiceDate:'2026-07-19', billNo:'NGP3944936', totalAmount:'USD 18795.00', consignee:'STANDER FOR IMPORT AND EXPORT CO.LTD', consigneeAddress:'SOUQ LIBYA BLOCK(4)', itemDesc:'CURTAIN'}}
  ];
  return `window.__testCollectionShipments=${JSON.stringify(shipments)};
  window.__testCollectionCompany={id:'c1',name_ar:'',name_en:'BAHAR SWAKEN GENERAL TRADING LLC',settings:JSON.parse(localStorage.getItem('__testSharedCollectionSettings')||'{}')};
  window.supabase={createClient:function(){return {
    auth:{
      getSession:async()=>({data:{session:{user:{id:'u1',email:'admin@jahez.test'},access_token:'test-token'}},error:null}),
      getUser:async()=>({data:{user:{id:'u1',email:'admin@jahez.test'}}}),
      onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
      signOut:async()=>({error:null})
    },
    rpc:async function(name){
      if(name==='get_user_portal_permissions') return {data:[{portal_key:'commercial_collection',can_view:true}],error:null};
      if(name==='get_user_feature_permissions') return {data:[{permission_key:'commercial_collection.view',allowed:true}],error:null};
      return {data:[],error:null};
    },
    from:function(table){
      let updatePayload=null, eqColumn='', eqValue='';
      const result=()=>{
        if(table==='companies'){
          if(updatePayload){
            Object.assign(window.__testCollectionCompany,updatePayload);
            localStorage.setItem('__testSharedCollectionSettings',JSON.stringify(window.__testCollectionCompany.settings||{}));
          }
          return {data:[window.__testCollectionCompany],error:null};
        }
        if(table==='shipments') return {data:window.__testCollectionShipments,error:null};
        if(table==='trade_collection_files') return {data:{id:'layout-fixture',operation_no:'TC-LAYOUT',status:'draft',metadata:{}},error:null};
        if(table==='trade_collection_file_shipments') return {data:window.__testCollectionShipments.map(row=>({shipment_id:row.id})),error:null};
        if(table==='payments') return {data:[],error:null};
        if(table==='profiles') return {data:{display_name:'Portal User',role:localStorage.getItem('__testPortalRole')||'admin',photo_url:''},error:null};
        return {data:null,error:null};
      };
      const api={
        select(){return api},
        eq(column,value){eqColumn=column;eqValue=value;return api},
        order(){return api},
        range(){return api},
        in(){return api},
        update(payload){updatePayload=payload;return api},
        insert(){return api},
        single(){
          if(table==='shipments'&&updatePayload&&eqColumn==='id'){
            const row=window.__testCollectionShipments.find(item=>item.id===eqValue);
            if(row) Object.assign(row,updatePayload);
            return Promise.resolve({data:row||null,error:row?null:{message:'shipment not found'}});
          }
          return Promise.resolve(result());
        },
        maybeSingle(){return Promise.resolve(result())},
        then(ok,bad){return Promise.resolve(result()).then(ok,bad)}
      };
      return api;
    }
  }}};`;
}

async function main() {
  const executablePath = chromiumPath();
  if(!executablePath) throw new Error('Chrome or Chromium executable was not found.');
  fs.mkdirSync(OUTPUT, {recursive:true});
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env:{...process.env, PORT:String(PORT), BUILD_SHA:'collection-layout-test'},
    stdio:['ignore', 'inherit', 'inherit']
  });
  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({executablePath, headless:true, args:['--no-sandbox']});
    const page = await browser.newPage({viewport:{width:1440,height:1000}, deviceScaleFactor:1});
    const consoleErrors=[];
    page.on('console',message=>{ if(message.type()==='error') consoleErrors.push(message.text()); });
    await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route=>route.fulfill({
      status:200,
      contentType:'application/javascript',
      body:supabaseStub()
    }));
    await page.goto(`${BASE}/healthz`);
    await page.evaluate(()=>{
      if(localStorage.getItem('__testCollectionLayoutSeeded')) return;
      localStorage.setItem('__testCollectionLayoutSeeded','1');
      localStorage.setItem('bsCollectionTextOffsets',JSON.stringify({letter:{x:5,y:0,scale:100}}));
      localStorage.setItem('bsCollectionDocumentEditorMetaV1',JSON.stringify({letter:{savedAt:'2026-09-12T08:00:00.000Z'}}));
    });
    await page.goto(`${BASE}/experiments/bs-collection/?tradeFileId=layout-fixture`, {waitUntil:'domcontentloaded'});
    await page.locator('.shipment-card').first().waitFor();
    // Layout/legacy document tests use only the scoped fixture's two rows.
    // Scope authorization and the new submission flow have separate tests.
    await page.evaluate(()=>{state.tradeFile=null;state.selected.clear();document.body.classList.remove('trade-file-context');renderAll();});
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('__testSharedCollectionSettings')||'{}').collectionDocumentLayouts?.documents?.letter?.textOffset?.x===5);
    const theme = await page.evaluate(()=>( {
      primary:getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim(),
      dark:getComputedStyle(document.documentElement).getPropertyValue('--brand-dark').trim(),
      header:getComputedStyle(document.querySelector('.lab-header')).backgroundImage,
      selected:getComputedStyle(document.querySelector('.section-heading span')).color,
      // Step 05 (collection log) is hidden on this portal; only the visible step cards are measured.
      stageRects:[...document.querySelectorAll('.portal-step-card')].filter(card=>card.getClientRects().length).map(card=>card.getBoundingClientRect().toJSON()),
      stageTitleSize:parseFloat(getComputedStyle(document.querySelector('.portal-step-card strong')).fontSize),
      activeStageBackground:getComputedStyle(document.querySelector('.portal-step-card.is-active')).backgroundImage,
      searchHeight:document.querySelector('.filters label').getBoundingClientRect().height,
      sectionRadius:parseFloat(getComputedStyle(document.querySelector('.picker-section')).borderRadius),
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
    }));
    assert.strictEqual(theme.primary.toUpperCase(), '#EA1B23');
    assert.strictEqual(theme.dark.toUpperCase(), '#D01119');
    assert.ok(theme.header.includes('rgb(25, 27, 32)'));
    assert.strictEqual(theme.selected, 'rgb(208, 17, 25)');
    assert.strictEqual(theme.stageRects.length,4,'four visible stage cards (the collection log step is hidden)');
    assert.ok(theme.stageRects.every(rect=>Math.abs(rect.top-theme.stageRects[0].top)<1),'desktop stages stay in one row');
    assert.ok(theme.stageRects.every(rect=>Math.abs(rect.height-theme.stageRects[0].height)<1),'desktop stage cards have equal height');
    assert.ok(theme.stageTitleSize>=13);
    assert.notStrictEqual(theme.activeStageBackground,'none');
    assert.ok(theme.searchHeight>=50&&theme.searchHeight<=54);
    assert.ok(theme.sectionRadius>=18);
    assert.ok(theme.overflow<=0);

    await page.locator('[data-step-section="preview-section"]').click();
    await page.locator('#textOffsetX').evaluate(element=>{
      element.value='7';
      element.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await page.evaluate(()=>saveCurrentDocumentLayout());
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('__testSharedCollectionSettings')||'{}').collectionDocumentLayouts?.documents?.letter?.textOffset?.x===7);
    const sharedLayout=await page.evaluate(()=>JSON.parse(localStorage.getItem('__testSharedCollectionSettings')).collectionDocumentLayouts);
    assert.strictEqual(sharedLayout.documents.letter.textOffset.x,7);
    assert.ok(sharedLayout.meta.letter.savedAt);

    await page.evaluate(()=>{
      localStorage.setItem('__testPortalRole','staff');
      localStorage.setItem('bsCollectionTextOffsets',JSON.stringify({letter:{x:-4,y:0,scale:100}}));
    });
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.shipment-card').first().waitFor({state:'attached'});
    await page.evaluate(()=>{state.tradeFile=null;state.selected.clear();document.body.classList.remove('trade-file-context');renderAll();});
    assert.strictEqual(await page.evaluate(()=>textOffsetForPreview().x),7,'employee receives the centrally saved layout instead of stale local formatting');
    assert.strictEqual(await page.locator('#saveDocumentLayoutBtn').isVisible(),false,'employee cannot edit or publish document layouts');

    await page.locator('[data-step-section="picker-section"]').click();
    await page.locator('.shipment-card').first().click();
    await page.locator('[data-step-section="preview-section"]').click();
    await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;
      const context=canvas.getContext('2d');context.fillStyle='blue';context.beginPath();context.arc(50,50,45,0,Math.PI*2);context.fill();
      sharedCollectionBranding.stamp=canvas.toDataURL('image/png');
      renderPreview();
    });
    const employeeBefore=await page.evaluate(()=>({
      template:localStorage.getItem('__testSharedCollectionSettings'),
      stamp:localStorage.getItem('bsCollectionStampTransformA4'),
      texts:localStorage.getItem('bsCollectionTextOffsets')
    }));
    await page.locator('#moveStampBtn').click();
    const stamp=page.locator('#documentPreview .collection-stamp-overlay');
    await stamp.scrollIntoViewIfNeeded();
    const stampBefore=await stamp.boundingBox();
    await page.mouse.move(stampBefore.x+stampBefore.width/2,stampBefore.y+stampBefore.height/2);
    await page.mouse.down();
    await page.mouse.move(stampBefore.x+stampBefore.width/2-40,stampBefore.y+stampBefore.height/2-30,{steps:5});
    await page.mouse.up();
    const moved=await stamp.evaluate(node=>({left:node.style.left,top:node.style.top}));
    assert.ok((await stamp.boundingBox()).x<stampBefore.x-30,'employee can drag the stamp');
    assert.strictEqual(await stamp.locator('.stamp-resize-handle').count(),0,'employee cannot resize the stamp');
    await page.locator('#moveStampBtn').click();
    assert.deepStrictEqual(await stamp.evaluate(node=>({left:node.style.left,top:node.style.top})),moved,'placement survives preview regeneration used by printing');
    const employeeAfter=await page.evaluate(()=>({
      template:localStorage.getItem('__testSharedCollectionSettings'),
      stamp:localStorage.getItem('bsCollectionStampTransformA4'),
      texts:localStorage.getItem('bsCollectionTextOffsets')
    }));
    assert.deepStrictEqual(employeeAfter,employeeBefore,'employee placement does not change shared or local template settings');
    assert.strictEqual(await page.locator('.document-editor-panel').isVisible(),false);
    const printed=await page.evaluate(()=>{
      return collectionDocumentKinds().map(kind=>{
        const doc=new DOMParser().parseFromString(CollectionHtmlTemplates.documentHtml(kind),'text/html');
        const node=doc.querySelector('.collection-stamp-overlay');
        return {left:node.style.left,top:node.style.top};
      });
    });
    assert.strictEqual(printed.length,3);
    const letterMargins=await page.evaluate(()=>CollectionLetterWordTemplate.config());
    const movedPosition=await page.evaluate(()=>employeeStampPositions.get(JSON.stringify([requestedTradeFileId||'',[...state.selected].sort(),'letter'])));
    assert.ok(Math.abs(parseFloat(printed[0].left)+letterMargins.left-movedPosition.xMm)<.01,'printed collection letter preserves employee X placement relative to page margins');
    assert.ok(Math.abs(parseFloat(printed[0].top)+letterMargins.top-movedPosition.yMm)<.01,'printed collection letter preserves employee Y placement relative to page margins');
    assert.notDeepStrictEqual(printed[1],moved,'other document positions remain independent');
    await page.locator('[data-step-section="picker-section"]').click();
    await page.locator('.shipment-card').first().click();
    await page.locator('.shipment-card').nth(1).click();
    await page.locator('[data-step-section="preview-section"]').click();
    assert.notDeepStrictEqual(await stamp.evaluate(node=>({left:node.style.left,top:node.style.top})),moved,'another shipment does not inherit employee placement');

    await page.evaluate(()=>localStorage.setItem('__testPortalRole','admin'));
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.shipment-card').first().waitFor({state:'attached'});
    await page.evaluate(()=>{state.tradeFile=null;state.selected.clear();document.body.classList.remove('trade-file-context');renderAll();});
    await page.locator('[data-step-section="picker-section"]').click();
    await page.screenshot({path:path.join(OUTPUT, 'collection-portal.png'), fullPage:false});
    await page.locator('.shipment-card').nth(0).click();
    await page.locator('.shipment-card').nth(1).click();
    await page.locator('[data-step-section="preview-section"]').click();

    await page.locator('[data-preview="undertaking"]').click();
    await page.locator('#templateCancel').click();
    const undertakingFrame=page.frameLocator('.collection-html-frame');
    await undertakingFrame.locator('.undertaking-refs tr').first().waitFor();
    const undertaking = await undertakingFrame.locator('.bank-undertaking').evaluate(node=>({
      rows:node.querySelectorAll('.undertaking-refs tr').length,
      cells:[...node.querySelector('.undertaking-refs tr').cells].map(cell=>cell.textContent.trim()),
      borderStyles:[...node.querySelector('.undertaking-refs tr').cells].map(cell=>getComputedStyle(cell).borderTopStyle),
      overflow:node.scrollWidth-node.clientWidth
    }));
    assert.strictEqual(undertaking.rows, 2);
    assert.deepStrictEqual(undertaking.cells, ['REF #:','HJ2026173','278073887','USD','14896.00']);
    assert.ok(undertaking.borderStyles.every(style=>style === 'none'));
    assert.ok(undertaking.overflow <= 0);
    await page.locator('.collection-html-page').screenshot({path:path.join(OUTPUT, 'collection-undertaking.png')});
    await require('./collection-undertaking-word.test')({page,BASE,OUTPUT});

    await page.locator('[data-preview="exchange"]').click();
    await page.locator('#templateCancel').click();
    const exchangeFrame=page.frameLocator('.collection-html-frame');
    await exchangeFrame.locator('.exchange-meta').waitFor();
    const exchange = await exchangeFrame.locator('.bank-exchange').evaluate(node=>({
      metaCells:[...node.querySelectorAll('.exchange-meta td')].map(cell=>cell.textContent.trim()),
      metaBorders:[...node.querySelectorAll('.exchange-meta td')].map(cell=>getComputedStyle(cell).borderTopStyle),
      metaAlign:[...node.querySelectorAll('.exchange-meta td')].map(cell=>getComputedStyle(cell).textAlign),
      invoiceRows:node.querySelectorAll('.exchange-invoices tr').length,
      invoiceCells:[...node.querySelector('.exchange-invoices tr').cells].map(cell=>cell.textContent.trim()),
      invoiceBorders:[...node.querySelector('.exchange-invoices tr').cells].map(cell=>getComputedStyle(cell).borderTopStyle),
      overflow:node.scrollWidth-node.clientWidth
    }));
    assert.strictEqual(exchange.metaCells.length, 2);
    assert.ok(exchange.metaBorders.every(style=>style === 'solid'));
    assert.deepStrictEqual(exchange.metaAlign,['center','center'],'each box follows the Word reference');
    assert.strictEqual(exchange.invoiceRows, 2);
    assert.deepStrictEqual(exchange.invoiceCells, ['HJ2026173','Dated:','20 Jul 2026']);
    assert.ok(exchange.invoiceBorders.every(style=>style === 'none'));
    assert.ok(exchange.overflow <= 0);
    await page.locator('.collection-html-page').screenshot({path:path.join(OUTPUT, 'collection-exchange.png')});
    await require('./collection-exchange-word.test')({page,BASE,OUTPUT});
    await require('./collection-letter-word.test')({page,BASE,OUTPUT});

    page.once('dialog', dialog=>dialog.accept());
    await page.locator('#recordCollectionBtn').click();
    await page.waitForFunction(()=>document.getElementById('activeCollectionOperationRef')?.textContent.includes('TC-'));
    const operation = await page.evaluate(()=>{
      const rows=window.__testCollectionShipments;
      return {
        numbers:rows.map(row=>row.data.collectionOperationNo),
        statuses:rows.map(row=>row.data.collectionStatus),
        reviewStatuses:rows.map(row=>row.status),
        workflowStages:rows.map(row=>row.workflow_stage),
        workflowUpdatedAt:rows.map(row=>row.workflow_updated_at),
        bankSentAt:rows.map(row=>row.bank_sent_at),
        operations:rows.map(row=>row.data.commercialCollectionOperations?.at(-1)),
        activeRef:document.getElementById('activeCollectionOperationRef')?.textContent||''
      };
    });
    assert.match(operation.numbers[0], /^TC-\d{8}-\d{6}-\d{3}$/);
    assert.strictEqual(operation.numbers[0], operation.numbers[1]);
    assert.deepStrictEqual(operation.statuses, ['sent','sent']);
    assert.deepStrictEqual(operation.reviewStatuses, ['issued','issued']);
    assert.deepStrictEqual(operation.workflowStages, ['bank_sent','bank_sent']);
    assert.ok(operation.workflowUpdatedAt.every(Boolean));
    assert.deepStrictEqual(operation.bankSentAt, operation.workflowUpdatedAt);
    assert.ok(operation.operations.every(item=>item.operationNo===operation.numbers[0]));
    assert.ok(operation.operations.every(item=>item.qrIncluded===false));
    assert.ok(operation.operations.every(item=>JSON.stringify(item.documentKinds)===JSON.stringify(['letter','undertaking','exchange'])));
    assert.ok(operation.activeRef.includes(operation.numbers[0]));
    const restored = await page.evaluate(operationNo=>{
      history.replaceState(null,'',`?tradeFileId=layout-fixture&shipment=11111111-1111-4111-8111-111111111111&operation=${encodeURIComponent(operationNo)}`);
      state.selected.clear();
      state.activeOperationNo='';
      const found=restoreRequestedCollectionOperation();
      return {found,selected:[...state.selected],activeOperationNo:state.activeOperationNo};
    },operation.numbers[0]);
    assert.strictEqual(restored.found,true);
    assert.deepStrictEqual(restored.selected.sort(),[
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    ]);
    assert.strictEqual(restored.activeOperationNo,operation.numbers[0]);
    await require('./collection-html-templates.test')({page,BASE,OUTPUT});

    await page.setViewportSize({width:390,height:844});
    await page.goto(`${BASE}/experiments/bs-collection/?tradeFileId=layout-fixture`,{waitUntil:'domcontentloaded'});
    await page.locator('.shipment-card').first().waitFor({state:'attached'});
    await page.evaluate(()=>{state.tradeFile=null;document.body.classList.remove('trade-file-context');renderAll();});
    await page.locator('[data-step-section="picker-section"]').click();
    const mobile=await page.evaluate(()=>({
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      stageOverflow:document.querySelector('.portal-step-grid').scrollWidth-document.querySelector('.portal-step-grid').clientWidth,
      filterColumns:getComputedStyle(document.querySelector('.filters')).gridTemplateColumns,
      searchWidth:document.querySelector('.filters label').getBoundingClientRect().width,
      panelWidth:document.querySelector('.picker-section').getBoundingClientRect().width
    }));
    assert.ok(mobile.overflow<=0,'mobile page has no horizontal overflow');
    assert.ok(mobile.stageOverflow>0,'mobile stages use their contained horizontal scroller');
    assert.ok(!mobile.filterColumns.includes(' '),'mobile filters form one column');
    assert.ok(mobile.searchWidth<=mobile.panelWidth,'mobile search stays inside the panel');
    assert.deepStrictEqual(consoleErrors,[],'collection portal has no console errors');
    console.log('Collection document reference tables: passed');
  } finally {
    if(browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch(error=>{
  console.error(error);
  process.exit(1);
});
