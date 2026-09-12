'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {chromium} = require('playwright-core');

const PORT = 4600 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_ORIGIN = `http://jahez.test:${PORT}`;
const SUPABASE_ORIGIN = 'https://vthcmqqiexaedukduquv.supabase.co';

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
  return `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'employee-1',exp,aud:'authenticated'})}.signature`;
}

async function createContext(browser, role, permissions, featureKeys = []){
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  const profile = {id:'employee-1', email:`${role}@example.test`, display_name:`موظف ${role}`, role, active:true, photo_url:'',feature_permissions_initialized:true};
  const expiresAt = Math.floor(Date.now()/1000) + 3600;
  await context.addInitScript(({profile, expiresAt, token})=>{
    localStorage.setItem('shipdocs-auth', JSON.stringify({
      access_token:token, refresh_token:'refresh-token', expires_at:expiresAt,
      expires_in:3600, token_type:'bearer',
      user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}
    }));
  }, {profile, expiresAt, token:fakeJwt(expiresAt)});
  await context.route(`${SUPABASE_ORIGIN}/**`, async route=>{
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'Access-Control-Allow-Origin':APP_ORIGIN,
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info',
      'Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      'Content-Type':'application/json'
    };
    if(request.method()==='OPTIONS') return route.fulfill({status:204, headers, body:''});
    if(url.pathname==='/rest/v1/profiles') return route.fulfill({status:200, headers, body:JSON.stringify([profile])});
    if(url.pathname==='/rest/v1/rpc/get_user_feature_permissions') return route.fulfill({status:200,headers,body:JSON.stringify(featureKeys.map(permission_key=>({permission_key,allowed:true})))});
    if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions') return route.fulfill({status:200, headers, body:JSON.stringify(permissions)});
    if(url.pathname==='/rest/v1/companies') return route.fulfill({status:200, headers, body:JSON.stringify([{id:'bsgt-company',name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',active:true,is_default:false,sort_order:1,settings:{}}])});
    if(url.pathname==='/rest/v1/shipments') return route.fulfill({status:200, headers, body:'[]'});
    if(request.method()==='HEAD') return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});
    return route.fulfill({status:200, headers, body:'[]'});
  });
  return context;
}

async function main(){
  const executablePath = chromiumPath();
  if(!executablePath) throw new Error('Chrome or Chromium executable was not found.');
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env:{...process.env, PORT:String(PORT), BUILD_SHA:'bsgt-workspace-browser-test'},
    stdio:['ignore','inherit','inherit']
  });
  let browser;
  try{
    await waitForServer(server);
    browser = await chromium.launch({executablePath, headless:true, args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});

    const adminContext = await createContext(browser, 'admin', []);
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace`, {waitUntil:'domcontentloaded'});
    await adminPage.locator('#viewBsgtWorkspace.active .bsgt-workspace-tab').first().waitFor({timeout:20000});
    assert.strictEqual(await adminPage.locator('.bsgt-workspace-tab').count(), 5);
    assert.deepStrictEqual(await adminPage.locator('.bsgt-workspace-tab').allTextContents(), ['العمليات','مركز العمليات','المالية','الإدارة','العلاقات التجارية']);
    assert.strictEqual((await adminPage.locator('#navBsgt').textContent()).trim(), 'مساحة BSGT');
    assert.ok(adminPage.url().includes('section=operations'));
    const scopedRequest = adminPage.waitForRequest(request=>{
      const url = new URL(request.url());
      return url.pathname==='/rest/v1/shipments' && url.searchParams.get('company_id')===`eq.bsgt-company`;
    });
    await adminPage.getByRole('button',{name:'مركز العمليات',exact:true}).click();
    await scopedRequest;
    await adminPage.locator('[data-operation-center-root="bsgt"]').waitFor();
    assert.ok(adminPage.url().includes('section=operationCenter'));
    await adminPage.reload({waitUntil:'domcontentloaded'});
    await adminPage.locator('[data-operation-center-root="bsgt"]').waitFor({timeout:20000});
    assert.ok(adminPage.url().includes('section=operationCenter'));
    await adminPage.getByRole('button',{name:'المالية',exact:true}).click();
    await adminPage.goBack();
    await adminPage.locator('[data-operation-center-root="bsgt"]').waitFor({timeout:20000});
    assert.ok(adminPage.url().includes('section=operationCenter'));
    await adminPage.evaluate(()=>switchView('operationCenter'));
    await adminPage.locator('#viewOperationCenter.active [data-operation-center-root="general"]').waitFor();
    await adminContext.close();

    const financeContext = await createContext(browser, 'editor', [{section:'finance',can_view:true,can_edit:true}], ['bsgt.finance.view','bsgt.finance.edit']);
    const financePage = await financeContext.newPage();
    await financePage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=operations`, {waitUntil:'domcontentloaded'});
    await financePage.locator('#viewBsgtWorkspace.active .bsgt-workspace-tab').waitFor({timeout:20000});
    assert.strictEqual(await financePage.locator('.bsgt-workspace-tab').count(), 1);
    assert.strictEqual((await financePage.locator('.bsgt-workspace-tab').textContent()).trim(), 'المالية');
    assert.ok(financePage.url().includes('section=finance'));
    assert.strictEqual(await financePage.locator('.bsgt-workspace-readonly').count(), 0);
    await financeContext.close();

    const viewerContext = await createContext(browser, 'viewer', [{section:'finance',can_view:true,can_edit:true}], ['bsgt.finance.view','bsgt.finance.edit']);
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=finance`, {waitUntil:'domcontentloaded'});
    await viewerPage.locator('#viewBsgtWorkspace.active .bsgt-workspace-readonly').waitFor({timeout:20000});
    assert.strictEqual(await viewerPage.locator('.bsgt-workspace-tab').count(), 1);
    assert.strictEqual(await viewerPage.evaluate(()=>document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await viewerContext.close();

    const centerContext = await createContext(browser, 'staff', [{section:'operations',can_view:true,can_edit:true}], ['bsgt.operation_center.view']);
    const centerPage = await centerContext.newPage();
    await centerPage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=operationCenter`, {waitUntil:'domcontentloaded'});
    await centerPage.locator('[data-operation-center-root="bsgt"]').waitFor({timeout:20000});
    assert.deepStrictEqual(await centerPage.locator('.bsgt-workspace-tab').allTextContents(), ['مركز العمليات']);
    await centerContext.close();

    const operationsContext = await createContext(browser, 'staff', [{section:'operations',can_view:true,can_edit:true}], ['bsgt.operations.view']);
    const operationsPage = await operationsContext.newPage();
    await operationsPage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=operations`, {waitUntil:'domcontentloaded'});
    await operationsPage.locator('.bsgt-operations').waitFor({timeout:20000});
    assert.deepStrictEqual(await operationsPage.locator('.bsgt-workspace-tab').allTextContents(), ['العمليات']);
    assert.strictEqual(await operationsPage.getByText('مركز عمليات BSGT غير مسند إلى حسابك').count(), 0);
    await operationsContext.close();

    const blockedContext = await createContext(browser, 'editor', [], []);
    const blockedPage = await blockedContext.newPage();
    await blockedPage.goto(`${APP_ORIGIN}/#v=bsgtWorkspace&section=finance`, {waitUntil:'domcontentloaded'});
    await blockedPage.locator('#employeeTopNav:not([hidden])').waitFor({timeout:20000});
    await blockedPage.waitForFunction(()=>location.hash === '#v=dashboard', null, {timeout:20000});
    await blockedPage.locator('#viewDashboard.active').waitFor({timeout:20000});
    assert.ok(blockedPage.url().includes('#v=dashboard'));
    await blockedContext.close();

    console.log('BSGT workspace route and browser permissions: passed');
  } finally {
    if(browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch(error=>{ console.error(error); process.exit(1); });
