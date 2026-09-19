'use strict';
// Confidential marker on the collection documents: default position, drag to move, shared save,
// survives reload across documents, and is drawn into the exported PDF as vector glyphs.

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
    const openPreview=async()=>{
      await page.evaluate(()=>{state.tradeFile=null;state.selected.clear();document.body.classList.remove('trade-file-context');renderAll();});
      await page.locator('[data-step-section="picker-section"]').click();
      await page.locator('.shipment-card').first().click();
      await page.locator('[data-step-section="preview-section"]').click();
      await page.locator('.collection-confidential-overlay').waitFor({state:'attached',timeout:20000});
    };
    const markerMm=()=>page.evaluate(()=>{const m=document.querySelector('.collection-confidential-overlay'),p=m.closest('.collection-html-page').getBoundingClientRect(),r=m.getBoundingClientRect();const px=p.width/210;return {xMm:(r.left-p.left)/px,yMm:(r.top-p.top)/px,text:m.textContent,color:getComputedStyle(m).color,movable:m.classList.contains('is-movable')};});
    await openPreview();
    const before=await markerMm();
    assert.strictEqual(before.text,'Confidential');assert.strictEqual(before.color,'rgb(227, 6, 19)');assert.strictEqual(before.movable,false);
    assert.ok(Math.abs(before.xMm-17)<1&&Math.abs(before.yMm-285)<1,'default position 17/285 mm');
    await page.locator('#moveConfidentialBtn').click();
    await page.locator('.collection-confidential-overlay.is-movable').waitFor();
    await page.locator('.collection-confidential-overlay').scrollIntoViewIfNeeded();
    const box=await page.locator('.collection-confidential-overlay').boundingBox();
    const paper=await page.locator('.collection-html-page').boundingBox();
    const px=paper.width/210;
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2+30*px,box.y+box.height/2-20*px,{steps:8});await page.mouse.up();
    await page.waitForFunction(()=>/حُفظ الموضع/.test(document.getElementById('moveConfidentialBtn').textContent),null,{timeout:10000});
    const saved=await page.evaluate(()=>({local:JSON.parse(localStorage.getItem('bsCollectionConfidentialMarkerV1')),shared:JSON.parse(localStorage.getItem('__testSharedCollectionSettings')).collectionDocumentLayouts?.confidential}));
    assert.ok(Math.abs(saved.local.xMm-47)<1.5&&Math.abs(saved.local.yMm-265)<1.5,'dragged by +30/-20 mm');
    assert.deepStrictEqual(saved.shared,saved.local,'admin position is shared through company settings');
    await page.reload({waitUntil:'domcontentloaded'});await page.locator('.shipment-card').first().waitFor({state:'attached'});
    await openPreview();
    await page.locator('[data-preview="exchange"]').click();
    await page.locator('.collection-confidential-overlay').waitFor({state:'attached',timeout:20000});
    const after=await markerMm();
    assert.ok(Math.abs(after.xMm-saved.local.xMm)<1&&Math.abs(after.yMm-saved.local.yMm)<1,'position survives reload and applies to every document');
    const pdfBytes=Buffer.from(await page.evaluate(async()=>Array.from(new Uint8Array(await CollectionHtmlTemplates.exportPdf('letter')))));
    fs.writeFileSync(path.join(OUTPUT,'confidential-moved.pdf'),pdfBytes);
    assert.strictEqual(await page.evaluate(()=>typeof window.fontkit),'object','fontkit is served locally');
    const text=pdfBytes.toString('latin1');
    assert.ok(!/\/BaseFont\s*\/[A-Z]{6}\+?Carlito/.test(text),'marker is vector outlines, not an embedded Carlito font');
    console.log('Collection confidential marker: default, drag & shared save, reload, vector PDF passed');
  } finally { if(browser) await browser.close(); server.kill('SIGTERM'); }
}
main().catch(error=>{console.error(error);process.exit(1);});
