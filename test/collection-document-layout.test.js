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
  return `window.supabase={createClient:function(){return {
    auth:{getUser:async()=>({data:{user:{id:'u1',email:'admin@jahez.test'}}}),signOut:async()=>({error:null})},
    from:function(table){
      const result=()=>table==='companies'
        ? {data:[{id:'c1',name_ar:'',name_en:'BAHAR SWAKEN GENERAL TRADING LLC',settings:{}}],error:null}
        : table==='shipments' ? {data:${JSON.stringify(shipments)},error:null}
        : table==='payments' ? {data:[],error:null}
        : table==='profiles' ? {data:{display_name:'Admin',role:'admin',photo_url:''},error:null}
        : {data:null,error:null};
      const api={select(){return api},eq(){return api},order(){return api},update(){return api},insert(){return api},maybeSingle(){return Promise.resolve(result())},then(ok,bad){return Promise.resolve(result()).then(ok,bad)}};
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
      invoiceRows:document.querySelectorAll('.boe-invoices tr').length,
      invoiceCells:[...document.querySelector('.boe-invoices tr').cells].map(cell=>cell.textContent.trim()),
      invoiceBorders:[...document.querySelector('.boe-invoices tr').cells].map(cell=>getComputedStyle(cell).borderTopStyle),
      overflow:document.querySelector('.collection-a4').scrollWidth-document.querySelector('.collection-a4').clientWidth
    }));
    assert.strictEqual(exchange.metaCells.length, 2);
    assert.ok(exchange.metaBorders.every(style=>style === 'solid'));
    assert.strictEqual(exchange.invoiceRows, 2);
    assert.deepStrictEqual(exchange.invoiceCells, ['HJ2026173','Dated:','2026-07-20']);
    assert.ok(exchange.invoiceBorders.every(style=>style === 'none'));
    assert.ok(exchange.overflow <= 0);
    await page.locator('.collection-a4').screenshot({path:path.join(OUTPUT, 'collection-exchange.png')});
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
