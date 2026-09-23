'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');

module.exports=async({page,BASE,OUTPUT})=>{
  const result=await page.evaluate(()=>{
    const original={settings:state.settings,shipments:state.shipments,selected:state.selected,overrides:state.overrides};
    const settingsBefore=JSON.stringify(sharedCollectionCompany.settings);
    const brandBefore=JSON.stringify(collectionBrandingSettings());
    try{
      state.settings={...state.settings,collectionDate:'2026-09-14',remittingBank:'Abu Dhabi Islamic Bank',remittingBankLetterAddress:'Abu Dhabi, UAE',remittingBankAccountNo:'19567664',collectingBank:'SAUDI SUDANESE BANK',collectingBankAddress:'PORT SUDAN BEANCH, ALSOQ ALKABEER, SUDAN TEL: +2499183483102, E-MAIL: amani.hussein@ssb-sd.com',draweeAddress:'PORT SUDAN, SUDAN',term:'D/A 180 DAYS FROM BILL OF EXCHANGE DATE.',billBy:'KINDLY SEND SWIFT MESSAGE TO COLLECTING BANK FOR DOCS AND SHARE SWIFT COPY WITH US',drawer:'BAHAR SWAKEN GENERAL TRADING LLC',authorizedPerson:'JAWAD ELMASRI',title:'Manager'};
      state.shipments=[{id:'letter1',invoiceNo:'26HF-005',totalAmount:'AED 200000',consignee:'STANDER FOR IMPORT & EXPORT CO., LTD'},{id:'letter2',invoiceNo:'10/01/TH/XHS26V',totalAmount:'AED 211040',consignee:'STANDER FOR IMPORT & EXPORT CO., LTD'}];
      state.selected=new Set(['letter1','letter2']);state.overrides={};
      const config=CollectionLetterWordTemplate.config();
      const html=CollectionHtmlTemplates.documentHtml('letter',config);
      const plain=CollectionHtmlTemplates.documentHtml('letter',{...config,header:'none'});
      const emptyMatches=CollectionHtmlTemplates.documentHtml('letter',{...config,html:''})===html;
      state.overrides.letter1={totalAmount:'AED 100000'};
      const updated=CollectionHtmlTemplates.documentHtml('letter',config);
      return {html,plain,updated,emptyMatches,unchanged:settingsBefore===JSON.stringify(sharedCollectionCompany.settings)&&brandBefore===JSON.stringify(collectionBrandingSettings())};
    }finally{Object.assign(state,original);}
  });
  assert.ok(result.unchanged&&result.emptyMatches);
  assert.ok(result.html.includes('411040')&&result.html.includes('FOUR HUNDRED ELEVEN THOUSAND FORTY UAE DIRHAMS ONLY'));
  assert.ok(result.updated.includes('311040')&&!result.updated.includes('411040'),'amounts follow the existing selection/override calculation');
  assert.ok(!result.html.includes('{{'));
  assert.ok(result.html.includes('DATE.</b>')&&!result.html.includes('DATE..'));
  fs.writeFileSync(path.join(OUTPUT,'collection-letter-word-reference.html'),result.plain);
  for(const [label,url] of [['local',`${BASE}/api/render-bsgt-pdf`],...(process.env.COLLECTION_PDF_TEST_URL?[['linux',process.env.COLLECTION_PDF_TEST_URL]]:[])]){
    const response=await page.request.post(url,{data:{html:result.plain}});
    assert.strictEqual(response.status(),200);
    const bytes=await response.body();
    fs.writeFileSync(path.join(OUTPUT,`collection-letter-word-${label}.pdf`),bytes);
    assert.strictEqual((await PDFDocument.load(bytes)).getPageCount(),1,`reference collection letter fits one A4 page (${label})`);
  }
  const layout=await page.evaluate(async html=>{
    const frame=document.createElement('iframe');document.body.append(frame);
    try{
      await new Promise(resolve=>{frame.onload=resolve;frame.srcdoc=html;});
      const doc=frame.contentDocument,root=doc.querySelector('.bank-collection-letter');
      const table=doc.querySelector('.letter-documents');
      const borderless=[...table.querySelectorAll('td,th')].every(cell=>frame.contentWindow.getComputedStyle(cell).borderTopStyle==='none');
      const counts=[...table.tBodies[0].rows].map(row=>[row.cells[2].textContent,row.cells[3].textContent]);
      const fontSize=frame.contentWindow.getComputedStyle(root).fontSize;
      for(let i=0;i<35;i++)table.tBodies[0].append(table.tBodies[0].rows[0].cloneNode(true));
      return {borderless,counts,fontSize,overflow:root.scrollWidth-root.clientWidth,overlap:doc.querySelector('.letter-signature').getBoundingClientRect().top<table.getBoundingClientRect().bottom,html:'<!doctype html>'+doc.documentElement.outerHTML};
    }finally{frame.remove();}
  },result.plain);
  assert.ok(layout.borderless&&layout.overflow<=0&&!layout.overlap);
  assert.strictEqual(layout.fontSize,'16px');
  assert.deepStrictEqual(layout.counts,[['1','0'],['2','0'],['0','2'],['2','0']],'existing document quantities are preserved rather than copied from reference data');
  const long=await page.request.post(`${BASE}/api/render-bsgt-pdf`,{data:{html:layout.html}});
  assert.strictEqual(long.status(),200);
  assert.ok((await PDFDocument.load(await long.body())).getPageCount()>1,'genuinely long documents paginate without clipping');
  const preserved=await page.evaluate(()=>{
    const original=sharedCollectionCompany.settings.collectionHtmlTemplates;
    try{
      sharedCollectionCompany.settings.collectionHtmlTemplates={...original,letter:{...CollectionLetterWordTemplate.config(),html:'<p>SAVED LETTER {{invoiceNo}}</p>'}};
      return CollectionHtmlTemplates.documentHtml('letter').includes('SAVED LETTER');
    }finally{sharedCollectionCompany.settings.collectionHtmlTemplates=original;}
  });
  assert.ok(preserved,'administrator HTML remains authoritative');
  console.log('Word collection letter: dynamic amounts/settings, borderless table, preserved counts, one-page PDF and custom template protection passed');
};
