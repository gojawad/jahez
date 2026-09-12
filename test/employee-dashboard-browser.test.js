'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {chromium} = require('playwright-core');

const PORT = 4200 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_ORIGIN = `http://jahez.test:${PORT}`;
const SUPABASE_ORIGIN = 'https://vthcmqqiexaedukduquv.supabase.co';
const ROLE_PORTALS = {
  admin:['بوابة التحصيل التجاري', 'فاتورة إذن الاستيراد'],
  editor:['فاتورة إذن الاستيراد'],
  staff:['فاتورة إذن الاستيراد'],
  viewer:[],
  bsgt_user:['بوابة التحصيل التجاري']
};
const ROLE_PORTAL_KEYS = {
  editor:['import_permit'],
  staff:['import_permit'],
  viewer:[],
  bsgt_user:['commercial_collection']
};
const SHIPMENTS = Array.from({length:6}, (_, index) => ({
  id:`00000000-0000-4000-8000-${String(index + 1).padStart(12,'0')}`,
  status:index < 4 ? 'sent' : 'draft',
  owner_id:'employee-1',
  company_id:'bsgt-company',
  created_at:`2026-0${4 + index}-05T08:00:00.000Z`,
  updated_at:`2026-0${4 + index}-0${6 + index}T10:00:00.000Z`,
  data:{
    operationNo:`BSGTX-2026-${String(index + 1).padStart(4,'0')}`,
    invoiceDate:`2026-0${4 + index}-0${6 + index}`,
    totalAmount:`AED ${12000 + index * 1750}`,
    exporter:index % 2 ? 'BAHAR SWAKEN GENERAL TRADING LLC' : 'NADIM TRADING ENTERPRISES',
    consignee:index % 2 ? 'STANDER FOR IMPORT AND EXPORT CO.LTD' : 'ABUKLEEWA TRADING TRANSPORT & SERVICES CO.LTD',
    shipType:index % 3 === 0 ? 'sea' : 'land'
  }
}));

function chromiumPath() {
  return [
    process.env.CHROMIUM_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean).find(candidate => fs.existsSync(candidate));
}

async function waitForServer(proc) {
  for(let attempt=0; attempt<50; attempt++){
    if(proc.exitCode !== null) throw new Error(`server exited early with code ${proc.exitCode}`);
    try{ if((await fetch(`${BASE}/healthz`)).ok) return; }catch{}
    await new Promise(resolve=>setTimeout(resolve, 200));
  }
  throw new Error('server did not start');
}

function fakeJwt(exp) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'employee-1',exp,aud:'authenticated'})}.signature`;
}

async function prepareRoleContext(browser, role) {
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  const profile = {
    id:'employee-1', email:`${role}@example.test`, display_name:`موظف ${role}`,
    role, active:true, photo_url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E'
  };
  const expiresAt = Math.floor(Date.now()/1000) + 3600;
  await context.addInitScript(({profile, expiresAt, token})=>{
    localStorage.setItem('shipdocs-auth', JSON.stringify({
      access_token:token, refresh_token:'refresh-token', expires_at:expiresAt,
      expires_in:3600, token_type:'bearer', user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}
    }));
  }, {profile, expiresAt, token:fakeJwt(expiresAt)});
  for(const pattern of [
    'https://fonts.googleapis.com/**',
    'https://fonts.gstatic.com/**',
    'https://unpkg.com/**'
  ]){
    await context.route(pattern, route=>route.fulfill({status:200,body:'',contentType:'text/css'}));
  }
  await context.route(`${SUPABASE_ORIGIN}/**`, async route=>{
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'Access-Control-Allow-Origin':APP_ORIGIN,
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info',
      'Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      'Content-Type':'application/json'
    };
    if(request.method()==='OPTIONS') return route.fulfill({status:204,headers,body:''});
    if(url.pathname==='/rest/v1/rpc/get_user_portal_permissions'){
      const rows=(ROLE_PORTAL_KEYS[role]||[]).map(portal_key=>({portal_key,can_view:true}));
      return route.fulfill({status:200,headers,body:JSON.stringify(rows)});
    }
    if(url.pathname==='/rest/v1/profiles') return route.fulfill({status:200,headers,body:JSON.stringify([profile])});
    if(url.pathname==='/rest/v1/companies') return route.fulfill({status:200,headers,body:JSON.stringify([{id:'bsgt-company',name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',settings:{}}])});
    if(url.pathname==='/rest/v1/shipments') return route.fulfill({status:200,headers,body:JSON.stringify(SHIPMENTS)});
    if(request.method()==='HEAD') return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});
    return route.fulfill({status:200,headers,body:'[]'});
  });
  return {context, profile};
}

async function main() {
  const executablePath = chromiumPath();
  if(!executablePath) throw new Error('Chrome or Chromium executable was not found.');
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env:{...process.env,PORT:String(PORT),BUILD_SHA:'employee-dashboard-browser-test'},
    stdio:['ignore','inherit','inherit']
  });
  let browser;
  try{
    await waitForServer(server);
    browser = await chromium.launch({
      executablePath,
      headless:true,
      args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']
    });
    for(const role of Object.keys(ROLE_PORTALS)){
      const {context, profile} = await prepareRoleContext(browser, role);
      const page = await context.newPage();
      const browserErrors = [];
      page.on('pageerror', error=>browserErrors.push(error.message));
      page.on('console', message=>{ if(message.type()==='error') browserErrors.push(message.text()); });
      await page.goto(`${APP_ORIGIN}/#v=dashboard`, {waitUntil:'domcontentloaded'});
      await page.locator('#employeeTopNav:not([hidden])').waitFor({timeout:20000});
      await page.locator('#viewDashboard.active .shipment-dashboard').waitFor({timeout:20000});
      assert.ok((await page.locator('.db-hero h2').textContent()).includes(profile.display_name));
      assert.ok(await page.locator('.db-employee-avatar img').count());
      assert.strictEqual(await page.locator('.db-stat').count(), 4);
      assert.ok((await page.locator('.db-stat-value').first().textContent()).includes('٦'));
      assert.strictEqual(await page.locator('.db-company .db-stars').count(), 0);
      assert.deepStrictEqual(await page.locator('#employeePortalLinks a span').allTextContents(), ROLE_PORTALS[role]);
      assert.strictEqual(await page.locator('#employeeDashboardNav').getAttribute('class'), 'active');
      if(role==='viewer') assert.strictEqual(await page.locator('#navCreateShip').evaluate(node=>getComputedStyle(node).display), 'none');
      if(role==='bsgt_user') assert.strictEqual(await page.locator('#navTasks').evaluate(node=>getComputedStyle(node).display), 'none');
      if(role==='admin') assert.notStrictEqual(await page.locator('#navAdmin').evaluate(node=>getComputedStyle(node).display), 'none');
      await page.reload({waitUntil:'domcontentloaded'});
      await page.locator('#viewDashboard.active .shipment-dashboard').waitFor({timeout:20000});
      assert.ok(page.url().endsWith('/#v=dashboard'));

      if(role==='admin'){
        fs.mkdirSync(path.join(__dirname,'output'), {recursive:true});
        for(const width of [390,768,1440]){
          await page.setViewportSize({width,height:900});
          await page.locator('.db-hero').waitFor({state:'visible'});
          await page.waitForTimeout(350);
          const overflow = await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
          assert.ok(overflow <= 1, `dashboard overflowed by ${overflow}px at ${width}px`);
          assert.notStrictEqual(await page.locator('.db-chart svg').evaluate(node=>getComputedStyle(node).display), 'none');
          if(width < 900){
            assert.strictEqual(await page.locator('.app-sidebar').evaluate(node=>node.classList.contains('is-open')), false);
            const sidebarPosition = await page.locator('.app-sidebar').evaluate(node=>({
              left:node.getBoundingClientRect().left,
              right:node.getBoundingClientRect().right,
              width:node.getBoundingClientRect().width,
              viewport:window.innerWidth,
              transform:getComputedStyle(node).transform
            }));
            assert.ok(sidebarPosition.left >= sidebarPosition.viewport, `sidebar remained visible at ${width}px: ${JSON.stringify(sidebarPosition)}`);
            const dashboardFlow = await page.locator('.db-three-grid').evaluate(node=>({
              display:getComputedStyle(node).display,
              direction:getComputedStyle(node).flexDirection
            }));
            assert.deepStrictEqual(dashboardFlow, {display:'flex',direction:'column'});
          }
          await page.screenshot({path:path.join(__dirname,'output',`employee-dashboard-${width}.png`),fullPage:true});
        }
      }

      if(role==='editor'){
        await page.goto(`${APP_ORIGIN}/experiments/bs-collection/`, {waitUntil:'domcontentloaded'});
        await page.waitForURL(`${APP_ORIGIN}/#v=dashboard`, {timeout:20000});
      }
      if(role==='bsgt_user'){
        await page.goto(`${APP_ORIGIN}/experiments/bs-collection/`, {waitUntil:'domcontentloaded'});
        await page.locator('body:not(.portal-access-loading) .lab-header').waitFor({timeout:20000});
        assert.ok((await page.locator('#portalUserName').textContent()).includes(profile.display_name));
      }
      assert.deepStrictEqual(browserErrors, []);
      await context.close();
      console.log(`Employee dashboard browser role ${role}: passed`);
    }
  } finally {
    if(browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch(error=>{ console.error(error); process.exit(1); });
