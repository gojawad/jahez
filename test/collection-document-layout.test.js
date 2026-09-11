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
  window.supabase={createClient:function(){return {
    auth:{getUser:async()=>({data:{user:{id:'u1',email:'admin@jahez.test'}}}),signOut:async()=>({error:null})},
    from:function(table){
      let updatePayload=null, eqColumn='', eqValue='';
      const result=()=>table==='companies'
        ? {data:[{id:'c1',name_ar:'',name_en:'BAHAR SWAKEN GENERAL TRADING LLC',settings:{}}],error:null}
        : table==='shipments' ? {data:window.__testCollectionShipments,error:null}
        : table==='payments' ? {data:[],error:null}
        : table==='profiles' ? {data:{display_name:'Admin',role:'admin',photo_url:''},error:null}
        : {data:null,error:null};
      const api={
        select(){return api},
        eq(column,value){eqColumn=column;eqValue=value;return api},
        order(){return api},
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
    await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', route=>route.fulfill({
      status:200,
      contentType:'application/javascript',
      body:supabaseStub()
    }));
    await page.goto(`${BASE}/experiments/bs-collection/`, {waitUntil:'domcontentloaded'});
    await page.locator('.shipment-card').first().waitFor();
    const theme = await page.evaluate(()=>( {
      primary:getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim(),
      dark:getComputedStyle(document.documentElement).getPropertyValue('--brand-dark').trim(),
      header:getComputedStyle(document.querySelector('.lab-header')).backgroundImage,
      selected:getComputedStyle(document.querySelector('.section-heading span')).color
    }));
    assert.strictEqual(theme.primary.toUpperCase(), '#EA1B23');
    assert.strictEqual(theme.dark.toUpperCase(), '#D01119');
    assert.ok(theme.header.includes('rgb(25, 27, 32)'));
    assert.strictEqual(theme.selected, 'rgb(208, 17, 25)');
    await page.screenshot({path:path.join(OUTPUT, 'collection-portal.png'), fullPage:false});
    await page.locator('.shipment-card').nth(0).click();
    await page.locator('.shipment-card').nth(1).click();
    await page.locator('[data-step-section="preview-section"]').click();

    await page.locator('[data-preview="undertaking"]').click();
    await page.locator('.undertaking-refs tr').first().waitFor();
    const undertaking = await page.evaluate(()=>({
      rows:document.querySelectorAll('.undertaking-refs tr').length,
      cells:[...document.querySelector('.undertaking-refs tr').cells].map(cell=>cell.textContent.trim()),
      borderStyles:[...document.querySelector('.undertaking-refs tr').cells].map(cell=>getComputedStyle(cell).borderTopStyle),
      overflow:document.querySelector('.collection-a4').scrollWidth-document.querySelector('.collection-a4').clientWidth
    }));
    assert.strictEqual(undertaking.rows, 2);
    assert.deepStrictEqual(undertaking.cells, ['REF #:','HJ2026173','278073887','USD','14896.00']);
    assert.ok(undertaking.borderStyles.every(style=>style === 'none'));
    assert.ok(undertaking.overflow <= 0);
    await page.locator('.collection-a4').screenshot({path:path.join(OUTPUT, 'collection-undertaking.png')});

    await page.locator('[data-preview="exchange"]').click();
    await page.locator('.boe-meta').waitFor();
    const exchange = await page.evaluate(()=>({
      metaCells:[...document.querySelectorAll('.boe-meta td')].map(cell=>cell.textContent.trim()),
      metaBorders:[...document.querySelectorAll('.boe-meta td')].map(cell=>getComputedStyle(cell).borderTopStyle),
      amountBox:(()=>{
        const cell=document.querySelector('.boe-meta td').getBoundingClientRect();
        const label=document.querySelector('[data-text-style-id="boe-amount-label"]').getBoundingClientRect();
        const value=document.querySelector('[data-text-style-id="boe-amount-value"]').getBoundingClientRect();
        return {leftGap:label.left-cell.left,rightGap:cell.right-value.right,separation:value.left-label.right};
      })(),
      invoiceRows:document.querySelectorAll('.boe-invoices tr').length,
      invoiceCells:[...document.querySelector('.boe-invoices tr').cells].map(cell=>cell.textContent.trim()),
      invoiceBorders:[...document.querySelector('.boe-invoices tr').cells].map(cell=>getComputedStyle(cell).borderTopStyle),
      overflow:document.querySelector('.collection-a4').scrollWidth-document.querySelector('.collection-a4').clientWidth
    }));
    assert.strictEqual(exchange.metaCells.length, 2);
    assert.ok(exchange.metaBorders.every(style=>style === 'solid'));
    assert.ok(exchange.amountBox.leftGap < 25);
    assert.ok(exchange.amountBox.rightGap < 25);
    assert.ok(exchange.amountBox.separation > 30);
    assert.strictEqual(exchange.invoiceRows, 2);
    assert.deepStrictEqual(exchange.invoiceCells, ['HJ2026173','Dated:','2026-07-20']);
    assert.ok(exchange.invoiceBorders.every(style=>style === 'none'));
    assert.ok(exchange.overflow <= 0);
    await page.locator('.collection-a4').screenshot({path:path.join(OUTPUT, 'collection-exchange.png')});

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
      history.replaceState(null,'',`?shipment=11111111-1111-4111-8111-111111111111&operation=${encodeURIComponent(operationNo)}`);
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
