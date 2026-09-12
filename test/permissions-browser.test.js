'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {chromium} = require('playwright-core');

const PORT = 4700 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_ORIGIN = `http://jahez.test:${PORT}`;
const SUPABASE_ORIGIN = 'https://vthcmqqiexaedukduquv.supabase.co';
const adminId = '11111111-1111-4111-8111-111111111111';
const staffId = '22222222-2222-4222-8222-222222222222';
const viewerId = '33333333-3333-4333-8333-333333333333';

function chromiumPath(){
  return [process.env.CHROMIUM_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find(fs.existsSync);
}

async function waitForServer(process){
  for(let attempt=0;attempt<50;attempt++){
    if(process.exitCode!==null) throw new Error(`server exited early with code ${process.exitCode}`);
    try{if((await fetch(`${BASE}/healthz`)).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error('server did not start');
}

function fakeJwt(userId,exp){
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:userId,exp,aud:'authenticated'})}.signature`;
}

async function configureContext(browser,{role='admin',userId=adminId,featureRows=[]}={}){
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const currentProfile={id:userId,email:`${role}@example.test`,display_name:`موظف ${role}`,role,active:true,photo_url:'',feature_permissions_initialized:true,created_at:'2026-09-12T00:00:00Z'};
  const profiles=role==='admin'?[currentProfile,
    {id:staffId,email:'staff@example.test',display_name:'موظف العمليات',role:'staff',active:true,photo_url:'',feature_permissions_initialized:true,created_at:'2026-09-12T00:01:00Z'},
    {id:viewerId,email:'viewer@example.test',display_name:'موظف المشاهدة',role:'viewer',active:true,photo_url:'',feature_permissions_initialized:true,created_at:'2026-09-12T00:02:00Z'}
  ]:[currentProfile];
  const expiresAt=Math.floor(Date.now()/1000)+3600;
  await context.addInitScript(({profile,expiresAt,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'refresh-token',expires_at:expiresAt,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})),{profile:currentProfile,expiresAt,token:fakeJwt(userId,expiresAt)});
  let savedRows=featureRows.slice();
  let savePayload=null;
  await context.route(`${SUPABASE_ORIGIN}/**`,async route=>{
    const request=route.request();
    const url=new URL(request.url());
    const headers={'Access-Control-Allow-Origin':APP_ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    if(url.pathname==='/auth/v1/user')return route.fulfill({status:200,headers,body:JSON.stringify({id:userId,email:currentProfile.email,aud:'authenticated',role:'authenticated'})});
    if(url.pathname==='/rest/v1/profiles'){
      if(request.method()==='PATCH')return route.fulfill({status:204,headers,body:''});
      return route.fulfill({status:200,headers,body:JSON.stringify(url.searchParams.has('id')?[currentProfile]:profiles)});
    }
    if(url.pathname==='/rest/v1/user_feature_permissions')return route.fulfill({status:200,headers,body:JSON.stringify(savedRows)});
    if(url.pathname==='/rest/v1/user_portal_permissions'||url.pathname==='/rest/v1/bsgt_workspace_permissions')return route.fulfill({status:200,headers,body:'[]'});
    if(url.pathname==='/rest/v1/rpc/get_user_feature_permissions')return route.fulfill({status:200,headers,body:JSON.stringify(featureRows)});
    if(url.pathname==='/rest/v1/rpc/set_user_feature_permissions'){
      savePayload=request.postDataJSON();
      savedRows=(savePayload.p_permission_keys||[]).map(permission_key=>({user_id:savePayload.p_user_id,permission_key,allowed:true}));
      return route.fulfill({status:200,headers,body:JSON.stringify(savedRows)});
    }
    if(url.pathname==='/rest/v1/companies')return route.fulfill({status:200,headers,body:'[]'});
    if(request.method()==='HEAD')return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});
    return route.fulfill({status:200,headers,body:'[]'});
  });
  return {context,getSavePayload:()=>savePayload};
}

async function main(){
  const executablePath=chromiumPath();
  if(!executablePath)throw new Error('Chrome or Chromium executable was not found.');
  const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(PORT),BUILD_SHA:'permissions-browser-test'},stdio:['ignore','inherit','inherit']});
  let browser;
  try{
    await waitForServer(server);
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    const adminFixture=await configureContext(browser);
    const adminPage=await adminFixture.context.newPage();
    await adminPage.goto(`${APP_ORIGIN}/#v=admin`,{waitUntil:'domcontentloaded'});
    const staffRow=adminPage.locator(`.user-row[data-uid="${staffId}"]`);
    await staffRow.waitFor({timeout:20000});
    assert.strictEqual(await adminPage.locator(`.user-row[data-uid="${adminId}"] .permission-admin-card`).count(),1,'admin has unconditional Full Access');
    await staffRow.locator('.user-permissions>summary').click();
    await staffRow.locator('[data-permission-key="import_permit.view"]').check();
    const saveResponse=adminPage.waitForResponse(response=>new URL(response.url()).pathname==='/rest/v1/rpc/set_user_feature_permissions');
    await staffRow.locator('.save-feature-permissions').click();
    await saveResponse;
    assert.deepStrictEqual(adminFixture.getSavePayload(),{p_user_id:staffId,p_permission_keys:['import_permit.view']});
    assert.doesNotMatch(await adminPage.locator('body').textContent(),/ليس لديك الصلاحية/);
    const viewerRow=adminPage.locator(`.user-row[data-uid="${viewerId}"]`);
    await viewerRow.locator('.user-permissions>summary').click();
    assert.strictEqual(await viewerRow.locator('[data-permission-key="shipments.edit"]').isDisabled(),true,'viewer write permissions are disabled');
    await adminFixture.context.close();

    const employeeFixture=await configureContext(browser,{role:'staff',userId:staffId,featureRows:[]});
    const employeePage=await employeeFixture.context.newPage();
    await employeePage.goto(`${APP_ORIGIN}/#v=admin`,{waitUntil:'domcontentloaded'});
    await employeePage.waitForFunction(()=>location.hash==='#v=dashboard',null,{timeout:20000});
    await employeePage.locator('#viewDashboard.active').waitFor();
    assert.ok(employeePage.url().includes('#v=dashboard'),'unassigned direct admin route is blocked');
    assert.strictEqual(await employeePage.locator('#navAdmin').isVisible(),false,'admin navigation never appears for an employee');
    await employeeFixture.context.close();
    console.log('Granular permission admin save, viewer boundary, and direct-route guard: passed');
  }finally{
    if(browser)await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch(error=>{console.error(error);process.exit(1);});
