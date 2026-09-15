'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{chromium}=require('playwright-core');
const api=require('../sending-data');
const port=5100+Math.floor(Math.random()*100),origin=`http://jahez.test:${port}`,remote='https://vthcmqqiexaedukduquv.supabase.co';
async function main(){
  const proc=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port)},stdio:'ignore'});let browser;
  try{
    for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${port}/healthz`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
    browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    const database=[];let failWrites=false;
    async function context(role='admin',legacy=false){
      const ctx=await browser.newContext({viewport:{width:390,height:844}});
      await ctx.addInitScript(({role,legacy})=>{
        const enc=x=>btoa(JSON.stringify(x)),exp=Math.floor(Date.now()/1000)+3600;
        localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:`${enc({alg:'HS256'})}.${enc({sub:'test-user',exp,aud:'authenticated'})}.x`,refresh_token:'test-refresh',expires_at:exp,token_type:'bearer',user:{id:'test-user',email:'test@example.test',aud:'authenticated',role:'authenticated'}}));
        if(legacy)localStorage.setItem('bsCollectionDataLists',JSON.stringify({term:['LOCAL LEGACY TERM']}));
      },{role,legacy});
      await ctx.route(`${remote}/**`,async route=>{
        const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop();
        const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,prefer,x-client-info','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS','Content-Type':'application/json'};
        const respond=(data,status=200)=>route.fulfill({status,headers,body:JSON.stringify(data)});
        if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
        if(table==='profiles')return respond({id:'test-user',role,active:true,display_name:'Test'});
        if(table==='settings')return respond(null);
        if(table==='companies')return respond([{id:'company',name_ar:'بحر سواكن',settings:{}}]);
        if(table==='get_bsgt_finance_context')return respond({shipments:[],tradeFileId:null});
        if(table==='lookups'){
          if(req.method()==='GET')return respond(database.filter(r=>!url.searchParams.has('list_key')||url.searchParams.get('list_key').includes(r.list_key)));
          assert.notEqual(req.method(),'DELETE','master data never hard-deletes');
          if(role!=='admin'||failWrites)return respond({message:'permission denied',code:'42501'},403);
          const body=req.postDataJSON(),id=url.searchParams.get('id')?.slice(3);
          if(database.some(r=>r.id!==id&&r.list_key===body.list_key&&r.value.trim().toLowerCase()===body.value?.trim().toLowerCase()))return respond({message:'duplicate',code:'23505'},409);
          if(id){const row=database.find(r=>r.id===id);assert.ok(row);Object.assign(row,body);return respond({id});}
          const row={id:`row-${database.length}`,active:true,sort_order:0,...body};database.push(row);return respond({id:row.id},201);
        }
        return respond([]);
      });
      return ctx;
    }
    const ctx=await context('admin',true),page=await ctx.newPage();
    await page.goto(`${origin}/sending-data.html?type=term`);await page.locator('#sendingManager:not([hidden])').waitFor();
    assert.equal(await page.locator('#sendingType option').count(),12);
    assert.match(await page.locator('#sendingItems').innerText(),/LOCAL LEGACY TERM/);
    assert.ok(await page.evaluate(()=>localStorage.getItem('bsCollectionDataLists')),'legacy backup retained');
    const term='90 DAYS FROM BILL OF EXCHANGE DATE';
    await page.locator('#sendingLong').fill(term);await page.locator('#sendingSave').click();await page.getByText('تم الحفظ في قاعدة البيانات.',{exact:true}).waitFor();
    await page.reload();await page.locator('#sendingManager:not([hidden])').waitFor();assert.match(await page.locator('#sendingItems').innerText(),/90 DAYS/);
    await page.locator('#sendingLong').fill(`  ${term.toLowerCase()}  `);await page.locator('#sendingSave').click();await page.getByText(/موجودة بالفعل/).waitFor();assert.equal(database.filter(r=>r.value===term).length,1);
    await page.locator('#sendingType').selectOption('collectingBankProfile');
    await page.locator('#sendingValue').fill('SAUDI SUDANESE BANK');await page.locator('#sendingAddress').fill('MAIN BRANCH, FREE ZONE AREA, PORT SUDAN, SUDAN');await page.locator('#sendingSave').click();await page.getByText('تم الحفظ في قاعدة البيانات.',{exact:true}).waitFor();
    const fresh=await context(),again=await fresh.newPage();await again.goto(`${origin}/sending-data.html?type=term`);await again.locator('#sendingManager:not([hidden])').waitFor();assert.match(await again.locator('#sendingItems').innerText(),/90 DAYS/);
    const portal=await fresh.newPage();await portal.goto(`${origin}/experiments/bs-collection/?financeContext=test-context`);
    await portal.locator('#settingsForm select[name=term] option').filter({hasText:term}).waitFor({state:'attached'});
    await portal.locator('[data-step-section="settings-section"]').click();
    const bankKey='SAUDI SUDANESE BANK|||MAIN BRANCH, FREE ZONE AREA, PORT SUDAN, SUDAN';
    await portal.locator('#settingsForm select[name=collectingBankProfile]').selectOption(bankKey);
    assert.equal(await portal.evaluate(()=>state.settings.collectingBankAddress),'MAIN BRANCH, FREE ZONE AREA, PORT SUDAN, SUDAN');
    await portal.evaluate(value=>{state.settings.term=value;state.settings.collectingBankAddress='OLD SNAPSHOT ADDRESS';populateCollectionSelects();},term);
    const item=again.locator('.sending-row').filter({hasText:term});await item.getByRole('button',{name:'تعديل',exact:true}).click();await again.locator('#sendingLong').fill('120 DAYS');await again.locator('#sendingSave').click();await again.getByText('تم الحفظ في قاعدة البيانات.',{exact:true}).waitFor();
    await again.locator('.sending-row').filter({hasText:'120 DAYS'}).getByRole('button',{name:'تعطيل',exact:true}).click();await again.getByText(/تم حفظ الحالة/).waitFor();
    await portal.evaluate(async()=>{await loadCollectionLists();populateCollectionSelects();});
    assert.equal(await portal.evaluate(()=>state.settings.term),term);assert.equal(await portal.evaluate(()=>state.settings.collectingBankAddress),'OLD SNAPSHOT ADDRESS');
    assert.equal(await portal.locator('#settingsForm select[name=term] option').filter({hasText:'120 DAYS'}).count(),0);
    failWrites=true;await again.locator('#sendingLong').fill('DENIED VALUE');await again.locator('#sendingSave').click();await again.getByText(/permission denied/).waitFor();assert.ok(!database.some(r=>r.value==='DENIED VALUE'));failWrites=false;
    assert.ok(await again.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const viewer=await context('editor'),denied=await viewer.newPage();await denied.goto(`${origin}/sending-data.html`);await denied.getByText(/متاحة لمدير النظام فقط/).waitFor();assert.ok(await denied.locator('#sendingManager').isHidden());
    assert.deepEqual(Object.keys(api.fields),['remittingBank','remittingBankLetterAddress','remittingBankAddress','remittingBankAccountNo','collectingBankProfile','billOfLadingType','billBy','term','drawer','authorizedPerson','title','draweeAddress']);
    console.log('Sending master data: persistence across refresh/fresh login, legacy import, 12 types, paired bank, duplicates, editing, deactivate, snapshots, permissions and mobile passed');
  }finally{await browser?.close();proc.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
