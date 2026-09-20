'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');

module.exports=async({page,BASE,OUTPUT})=>{
  const original=await page.evaluate(()=>({role:portalRole,preview:state.preview}));
  const sharedBefore=await page.evaluate(()=>JSON.stringify(sharedCollectionCompany.settings));
  await page.evaluate(()=>{
    portalRole='staff';document.body.classList.add('role-collection-preview-only');
    state.preview='letter';delete state.settings.documentCounts;renderPreview();
  });
  const panel=page.locator('#documentCountsPanel');
  assert.ok(await panel.isVisible(),'employee can see counters without admin layout controls');
  const input=(id,kind)=>panel.locator(`input[data-count-id="${id}"][data-count-kind="${kind}"]`);
  const button=(id,kind,step)=>panel.locator(`button[data-count-id="${id}"][data-count-kind="${kind}"][data-count-step="${step}"]`);
  assert.strictEqual(await input('invoice','original').inputValue(),'2');
  assert.ok(await button('invoice','duplicate',-1).isDisabled());
  await button('invoice','original',1).click();
  assert.strictEqual(await input('invoice','original').inputValue(),'3');
  await button('invoice','original',-1).click();
  assert.strictEqual(await input('invoice','original').inputValue(),'2');
  await input('invoice','original').fill('6');await input('invoice','original').press('Tab');
  await input('origin','duplicate').fill('6');await input('origin','duplicate').press('Tab');
  await input('origin','original').fill('0');await input('origin','original').press('Tab');
  for(const invalid of ['-1','1.5']){
    await input('invoice','original').fill(invalid);await input('invoice','original').press('Tab');
    assert.strictEqual(await input('invoice','original').inputValue(),'6','reject negative/fractional counts');
  }
  await page.waitForFunction(()=>document.querySelector('.collection-html-frame')?.contentDocument?.querySelector('.letter-documents tbody tr:nth-child(2) td:nth-child(3)')?.textContent==='6');
  const checks=await page.evaluate(()=>{
    const parse=html=>new DOMParser().parseFromString(html,'text/html');
    const html=CollectionHtmlTemplates.documentHtml('letter');
    const counts=[...parse(html).querySelectorAll('.letter-documents tbody tr')].map(row=>[row.cells[2].textContent,row.cells[3].textContent]);
    const templateBefore=sharedCollectionCompany.settings.collectionHtmlTemplates;
    const settingsBefore=structuredClone(state.settings);
    try{
      // Saved Word HTML may contain nested formatting and non-default numbers.
      sharedCollectionCompany.settings.collectionHtmlTemplates={...templateBefore,letter:{...CollectionLetterWordTemplate.config(),html:CollectionLetterWordTemplate.config().html.replace('<td>COMMERCIAL INVOICE</td><td>2</td>','<td>COMMERCIAL INVOICE</td><td><b style="font-size:12pt">6</b></td>')}};
      delete state.settings.documentCounts;
      const customDefault=CollectionHtmlTemplates.documentCounts().find(row=>row.id==='invoice').original;
      captureDocumentCounts();state.settings.documentCounts.invoice.original=9;
      const custom=parse(CollectionHtmlTemplates.documentHtml('letter'));
      const preserved=custom.querySelector('.letter-documents tbody tr:nth-child(2) td:nth-child(3) b')?.textContent==='9';
      const batch={shipmentIds:[...state.selected],documentSettings:structuredClone(settingsBefore)};
      applyCollectionBatchSnapshot(batch);
      const restored=state.settings.documentCounts.invoice.original;
      applyCollectionBatchSnapshot({...batch,documentSettings:{}});
      const legacyClean=!state.settings.documentCounts;
      state.settings=structuredClone(settingsBefore);
      state.tradeFile={id:'locked',status:'sent_to_remitting'};renderDocumentCounts();
      const locked=[...document.querySelectorAll('#documentCountsControls button,#documentCountsControls input')].every(node=>node.disabled);
      state.tradeFile=null;
      return {html,counts,customDefault,preserved,restored,legacyClean,locked};
    }finally{sharedCollectionCompany.settings.collectionHtmlTemplates=templateBefore;state.settings=settingsBefore;state.tradeFile=null;renderPreview();}
  });
  assert.deepStrictEqual(checks.counts,[['1','0'],['6','0'],['0','2'],['0','6']]);
  assert.strictEqual(checks.customDefault,6);assert.ok(checks.preserved&&checks.legacyClean&&checks.locked);assert.strictEqual(checks.restored,6);
  const response=await page.request.post(`${BASE}/api/render-bsgt-pdf`,{data:{html:checks.html}});
  assert.strictEqual(response.status(),200);
  const pdf=await response.body();assert.strictEqual((await PDFDocument.load(pdf)).getPageCount(),1);
  fs.writeFileSync(path.join(OUTPUT,'collection-document-counts.pdf'),pdf);
  await page.setViewportSize({width:390,height:844});
  await panel.scrollIntoViewIfNeeded();
  assert.ok(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth),'counters fit mobile');
  await panel.screenshot({path:path.join(OUTPUT,'collection-document-counts-mobile.png')});
  await page.setViewportSize({width:1440,height:1100});
  assert.strictEqual(await page.evaluate(()=>JSON.stringify(sharedCollectionCompany.settings)),sharedBefore,'employee does not alter shared templates');
  await page.evaluate(original=>{portalRole=original.role;state.preview=original.preview;document.body.classList.toggle('role-collection-preview-only',portalRole!=='admin');renderPreview();},original);
  console.log('Document counts: employee +/- controls, validation, custom templates, snapshots, read-only, mobile and PDF passed');
};
