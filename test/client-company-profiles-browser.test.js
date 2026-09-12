'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const {chromium} = require('playwright-core');

const PORT = 4450 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_ORIGIN = `http://jahez.test:${PORT}`;
const SUPABASE_ORIGIN = 'https://vthcmqqiexaedukduquv.supabase.co';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';

function chromiumPath(){
  return [process.env.CHROMIUM_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find(fs.existsSync);
}
async function waitForServer(proc){
  for(let i=0;i<50;i++){
    if(proc.exitCode!==null) throw new Error(`server exited early with code ${proc.exitCode}`);
    try{ if((await fetch(`${BASE}/healthz`)).ok) return; }catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error('server did not start');
}
function fakeJwt(exp){
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'employee-1',exp,aud:'authenticated'})}.signature`;
}
async function contextFor(browser,role,width){
  const context=await browser.newContext({viewport:{width,height:900}});
  const profile={id:'employee-1',email:`${role}@example.test`,display_name:`موظف ${role}`,role,active:true,photo_url:''};
  const client={id:CLIENT_ID,name:'NADIM TRADING ENTERPRISES',name_ar:'شركة نديم التجارية',name_en:'NADIM TRADING ENTERPRISES',phone:'+249 000 000',email:'info@nadim.test',country:'السودان',active:true,created_at:'2026-09-01T00:00:00Z',client_profile_files:[{id:'file-1',file_type:'stamp',is_active:true},{id:'file-2',file_type:'letterhead',is_active:true}]};
  const expiresAt=Math.floor(Date.now()/1000)+3600;
  await context.addInitScript(({profile,expiresAt,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'refresh-token',expires_at:expiresAt,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})),{profile,expiresAt,token:fakeJwt(expiresAt)});
  await context.route(`${SUPABASE_ORIGIN}/**`,async route=>{
    const request=route.request(), url=new URL(request.url());
    const headers={'Access-Control-Allow-Origin':APP_ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};
    if(request.method()==='OPTIONS') return route.fulfill({status:204,headers,body:''});
    if(url.pathname==='/rest/v1/profiles') return route.fulfill({status:200,headers,body:JSON.stringify([profile])});
    if(url.pathname==='/rest/v1/rpc/get_user_feature_permissions') return route.fulfill({status:200,headers,body:JSON.stringify(
      role==='viewer' ? [{permission_key:'client_profiles.view',allowed:true}] : []
    )});
    if(url.pathname==='/rest/v1/clients'){
      const detail=url.searchParams.has('id');
      return route.fulfill({status:200,headers,body:JSON.stringify(detail?client:[client])});
    }
    if(url.pathname==='/rest/v1/client_profile_files' || url.pathname==='/rest/v1/client_authorized_signatories') return route.fulfill({status:200,headers,body:'[]'});
    if(url.pathname==='/rest/v1/companies') return route.fulfill({status:200,headers,body:'[]'});
    if(request.method()==='HEAD') return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});
    return route.fulfill({status:200,headers,body:'[]'});
  });
  return context;
}

async function main(){
  const executablePath=chromiumPath();
  if(!executablePath) throw new Error('Chrome or Chromium executable was not found.');
  const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(PORT),BUILD_SHA:'client-profiles-browser-test'},stdio:['ignore','inherit','inherit']});
  let browser;
  try{
    await waitForServer(server);
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    for(const width of [390,768,1440]){
      const context=await contextFor(browser,'admin',width), page=await context.newPage();
      await page.goto(`${APP_ORIGIN}/#v=clientProfiles`,{waitUntil:'domcontentloaded'});
      await page.locator('#viewClientProfiles.active .ccp-card').waitFor({timeout:20000});
      assert.strictEqual(await page.locator('#navClientProfiles').count(),1);
      assert.ok((await page.locator('.ccp-card').textContent()).includes('شركة نديم التجارية'));
      assert.strictEqual(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
      const columns=await page.locator('.ccp-grid').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);
      assert.strictEqual(columns,width<=700?1:(width<=1100?2:3));
      await page.locator('.ccp-card').click();
      await page.locator('.ccp-profile-head').waitFor();
      assert.strictEqual(await page.locator('.ccp-tab').count(),4);
      assert.strictEqual(await page.locator('#ccpEditProfile').count(),1);
      if(width===1440){
        assert.ok(page.url().includes(`id=${CLIENT_ID}`));
        await page.reload({waitUntil:'domcontentloaded'});
        await page.locator('.ccp-profile-head').waitFor({timeout:20000});
        assert.ok(page.url().includes(`id=${CLIENT_ID}`));
        await page.reload({waitUntil:'domcontentloaded'});
        await page.locator('.ccp-profile-head').waitFor({timeout:20000});
        await page.screenshot({path:path.join(os.tmpdir(),'jahez-client-company-profiles.png'),fullPage:true});
      }
      await context.close();
      console.log(`Client company profiles responsive ${width}px: passed`);
    }
    const viewerContext=await contextFor(browser,'viewer',1440), viewerPage=await viewerContext.newPage();
    await viewerPage.goto(`${APP_ORIGIN}/#v=clientProfiles&id=${CLIENT_ID}`,{waitUntil:'domcontentloaded'});
    await viewerPage.locator('.ccp-profile-head').waitFor({timeout:20000});
    assert.strictEqual(await viewerPage.locator('#ccpEditProfile,#ccpUploadFile').count(),0);
    await viewerPage.locator('[data-tab="assets"]').click();
    assert.strictEqual(await viewerPage.locator('#ccpAssetAdd').count(),0);
    await viewerContext.close();
    console.log('Client company profiles viewer permissions: passed');
  }finally{
    if(browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch(error=>{ console.error(error); process.exit(1); });
