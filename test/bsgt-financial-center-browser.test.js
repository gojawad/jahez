'use strict';
// «المركز المالي» phase 0: the empty shell opens from the workspace tab, from a direct
// link, survives a reload, keeps back/forward navigation intact, never becomes the
// default landing section, and adds no page or console errors.
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');
const {chromium}=require('playwright-core');

const PORT=5500+Math.floor(Math.random()*100);
const BASE=`http://127.0.0.1:${PORT}`;
const APP=`http://jahez.test:${PORT}`;
const SUPABASE='https://vthcmqqiexaedukduquv.supabase.co';
const company={id:'bsgt-company',name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',active:true,is_default:false,sort_order:1,settings:{}};
function executable(){return [process.env.CHROMIUM_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find(fs.existsSync);}
function jwt(id){const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');return `${enc({alg:'HS256'})}.${enc({sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})}.x`;}
async function waitServer(proc){for(let i=0;i<50;i++){if(proc.exitCode!==null)throw Error('server exited');try{if((await fetch(`${BASE}/healthz`)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}throw Error('server timeout');}

async function contextFor(browser,role,workspaceRows,featureKeys){
  const profile={id:'employee-1',email:`${role}@example.test`,display_name:`موظف ${role}`,role,active:true,photo_url:'',feature_permissions_initialized:true};
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const exp=Math.floor(Date.now()/1000)+3600;
  await context.addInitScript(({profile,exp,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'r',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})),{profile,exp,token:jwt(profile.id)});
  await context.route(`${SUPABASE}/**`,async route=>{const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':APP,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    if(url.pathname==='/rest/v1/profiles')return route.fulfill({status:200,headers,body:JSON.stringify([profile])});
    if(url.pathname==='/rest/v1/companies')return route.fulfill({status:200,headers,body:JSON.stringify([company])});
    if(url.pathname==='/rest/v1/rpc/get_user_feature_permissions')return route.fulfill({status:200,headers,body:JSON.stringify(featureKeys.map(permission_key=>({permission_key,allowed:true})))});
    if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions')return route.fulfill({status:200,headers,body:JSON.stringify(workspaceRows)});
    if(req.method()==='HEAD')return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});
    return route.fulfill({status:200,headers,body:'[]'});
  });
  return context;
}
function track(page){const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});return ()=>errors.filter(e=>!/WebSocket|ERR_TUNNEL|net::|Failed to load resource/.test(e));}
const section=()=>new URLSearchParams(location.hash.slice(1)).get('section');

async function main(){
  const browserPath=executable();if(!browserPath)throw Error('Chrome not found');
  const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','inherit','inherit']});let browser;
  try{
    await waitServer(server);browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    // 1. Admin: tab sits right after operations; clicking it mounts the shell and updates the hash.
    const admin=await contextFor(browser,'admin',[],[]);const page=await admin.newPage();const errorsOf=track(page);
    await page.goto(`${APP}/#v=bsgtWorkspace`,{waitUntil:'domcontentloaded'});
    await page.locator('#viewBsgtWorkspace.active .bsgt-workspace-tab').first().waitFor({timeout:20000});
    const tabs=await page.locator('.bsgt-workspace-tab').allTextContents();
    assert.strictEqual(tabs[0],'العمليات');assert.strictEqual(tabs[1],'المركز المالي');
    assert.strictEqual(await page.evaluate(section),'operations','default landing stays operations');
    await page.locator('.bsgt-workspace-tab[data-bsgt-section="financialCenter"]').click();
    await page.locator('#bsgtFinancialCenter').waitFor({timeout:10000});
    assert.strictEqual(await page.evaluate(section),'financialCenter');
    assert.strictEqual((await page.locator('#bsgtFinancialCenterTitle').textContent()).trim(),'المركز المالي');
    assert.match(await page.locator('#bsgtFinancialCenter p').first().textContent(),/إدارة الحسابات والتكاليف والتحصيلات المرتبطة بالعمليات/);
    assert.strictEqual(await page.locator('.bsgt-workspace-tab[data-bsgt-section="financialCenter"]').getAttribute('aria-selected'),'true');
    // Empty shell: no inputs, tables, buttons or stat cards inside it.
    assert.strictEqual(await page.locator('#bsgtFinancialCenter input, #bsgtFinancialCenter select, #bsgtFinancialCenter table, #bsgtFinancialCenter button').count(),0);
    // Fills the workspace width (not a small centred box) and stays RTL with the site font.
    const geometry=await page.evaluate(()=>{const host=document.getElementById('bsgtWorkspaceContent').getBoundingClientRect(),box=document.getElementById('bsgtFinancialCenter'),rect=box.getBoundingClientRect(),style=getComputedStyle(box);return {ratio:rect.width/host.width,direction:style.direction,font:style.fontFamily};});
    assert.ok(geometry.ratio>0.9,`shell should span the content area (${geometry.ratio})`);
    assert.strictEqual(geometry.direction,'rtl');assert.match(geometry.font,/IBM Plex Sans Arabic/);
    if(process.env.SHOT_DIR) await page.screenshot({path:path.join(process.env.SHOT_DIR,'financial-center-phase0.png'),fullPage:true});
    // 2. Reload keeps the section; direct link opens it; back button returns to operations.
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#bsgtFinancialCenter').waitFor({timeout:20000});
    assert.strictEqual(await page.evaluate(section),'financialCenter');
    await page.goBack();
    await page.locator('#bsgtOperationsCreateBtn, #bsgtOperationsSearch').first().waitFor({timeout:10000});
    assert.strictEqual(await page.evaluate(section),'operations');
    await page.goForward();
    await page.locator('#bsgtFinancialCenter').waitFor({timeout:10000});
    // 3. The other sections still open after visiting the shell.
    for(const [key,marker] of [['finance','#bsgtFinanceReady, .bsgt-finance-section'],['management','.bsgt-management'],['relations','.bsgt-relations-lane, .bsgt-relations-ready-panel'],['tradeFiles','#bsgtTradeFiles'],['operationCenter','.bsgt-operation-center-embed']]){
      await page.locator(`.bsgt-workspace-tab[data-bsgt-section="${key}"]`).click();
      await page.locator(marker).first().waitFor({timeout:10000});
      assert.strictEqual(await page.evaluate(section),key);
      assert.strictEqual(await page.locator('#bsgtFinancialCenter').count(),0,'shell unmounted when leaving');
    }
    assert.deepStrictEqual(errorsOf(),[],'no page errors');
    await admin.close();
    // 4. A finance-only employee sees the tab, but still lands on finance by default and opens the shell by link.
    const finance=await contextFor(browser,'editor',[{section:'finance',can_view:true,can_edit:true}],['bsgt.finance.view','bsgt.finance.edit']);
    const financePage=await finance.newPage();const financeErrors=track(financePage);
    await financePage.goto(`${APP}/#v=bsgtWorkspace`,{waitUntil:'domcontentloaded'});
    await financePage.locator('#viewBsgtWorkspace.active .bsgt-workspace-tab').first().waitFor({timeout:20000});
    assert.strictEqual(await financePage.evaluate(section),'finance');
    assert.deepStrictEqual(await financePage.locator('.bsgt-workspace-tab').allTextContents(),['المركز المالي','المالية','ملفات العمليات التجارية']);
    await financePage.goto(`${APP}/#v=bsgtWorkspace&section=financialCenter`,{waitUntil:'domcontentloaded'});
    await financePage.locator('#bsgtFinancialCenter').waitFor({timeout:20000});
    assert.strictEqual(await financePage.locator('.bsgt-workspace-readonly').count(),0,'no read-only badge on the shell');
    assert.deepStrictEqual(financeErrors(),[]);
    await finance.close();
    console.log('BSGT financial center phase 0 shell: passed');
  }finally{await browser?.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exit(1);});
