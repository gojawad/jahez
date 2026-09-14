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
      state.settings={...state.settings,collectionDate:'2026-09-14',remittingBank:'Abu Dhabi Islamic Bank',remittingBankAddress:'BANIYAS BRANCH BUILDING, 2ND FLOOR, BANIYAS EAST, P.O.BOX 313, ABU DHABI, UAE.',billOfLadingType:'Copy of Original Bill of Lading',drawer:'BAHAR SWAKEN GENERAL TRADING LLC',authorizedPerson:'JAWAD ELMASRI',title:'MANAGER'};
      state.shipments=[{id:'ref1',invoiceNo:'26HF-005',billNo:'QGD2604043',totalAmount:'AED 190840',consignee:'TEST CONSIGNEE'},{id:'ref2',invoiceNo:'10/01/TH/XHS26V',billNo:'SZBD60004600',totalAmount:'AED 44040',consignee:'TEST CONSIGNEE'}];
      state.selected=new Set(['ref1','ref2']);state.overrides={};
      const config=CollectionUndertakingWordTemplate.config();
      const html=CollectionHtmlTemplates.documentHtml('undertaking',config);
      const plain=CollectionHtmlTemplates.documentHtml('undertaking',{...config,header:'none'});
      const empty=CollectionHtmlTemplates.documentHtml('undertaking',{...config,html:''});
      return {html,plain,emptyMatches:empty===html,unchanged:settingsBefore===JSON.stringify(sharedCollectionCompany.settings)&&brandBefore===JSON.stringify(collectionBrandingSettings())};
    }finally{Object.assign(state,original);}
  });
  assert.ok(result.unchanged,'built-in undertaking preserves branding and saved settings');
  assert.ok(result.emptyMatches,'empty HTML uses the same Word undertaking as saved preview');
  assert.ok(result.html.includes('190840.00')&&result.html.includes('44040.00'));
  assert.ok(result.html.includes('QGD2604043')&&result.html.includes('SZBD60004600'));
  assert.ok(!result.html.includes('{{'));
  const response=await page.request.post(`${BASE}/api/render-bsgt-pdf`,{data:{html:result.plain}});
  assert.strictEqual(response.status(),200);
  const bytes=await response.body();
  assert.strictEqual((await PDFDocument.load(bytes)).getPageCount(),1,'reference undertaking fits one A4 page');
  fs.writeFileSync(path.join(OUTPUT,'undertaking-word-reference.pdf'),bytes);
  const branded=await page.evaluate(async html=>Array.from(new Uint8Array(await CollectionHtmlTemplates.pdf(html))),result.html);
  assert.strictEqual((await PDFDocument.load(Uint8Array.from(branded))).getPageCount(),1);
  fs.writeFileSync(path.join(OUTPUT,'undertaking-word-branded.pdf'),Buffer.from(branded));
  const layout=await page.evaluate(async html=>{
    const frame=document.createElement('iframe');document.body.append(frame);
    try{
      await new Promise(resolve=>{frame.onload=resolve;frame.srcdoc=html;});
      const doc=frame.contentDocument,root=doc.querySelector('.bank-undertaking');
      const terms=doc.querySelector('.undertaking-terms');
      const refs=doc.querySelector('.undertaking-refs tbody');
      const font=frame.contentWindow.getComputedStyle(terms).fontFamily;
      const size=frame.contentWindow.getComputedStyle(terms).fontSize;
      const termCount=terms.children.length;
      for(let index=0;index<55;index++){
        const row=refs.rows[0].cloneNode(true);row.cells[0].textContent='';row.cells[1].textContent=`LONG-INVOICE-${index}`;refs.append(row);
      }
      return {font,size,termCount,overflow:root.scrollWidth-root.clientWidth,overlap:terms.getBoundingClientRect().top<refs.getBoundingClientRect().bottom,html:'<!doctype html>'+doc.documentElement.outerHTML};
    }finally{frame.remove();}
  },result.plain);
  assert.match(layout.font,/Cambria/);
  assert.ok(Math.abs(parseFloat(layout.size)-13.3333)<.01);
  assert.strictEqual(layout.termCount,8,'all eight bank terms are retained');
  assert.strictEqual(layout.overlap,false,'additional invoice rows push text down');
  assert.ok(layout.overflow<=0);
  const longResponse=await page.request.post(`${BASE}/api/render-bsgt-pdf`,{data:{html:layout.html}});
  assert.strictEqual(longResponse.status(),200);
  const longBytes=await longResponse.body();
  assert.ok((await PDFDocument.load(longBytes)).getPageCount()>1);
  fs.writeFileSync(path.join(OUTPUT,'undertaking-word-long.pdf'),longBytes);
  const preserved=await page.evaluate(()=>{
    const original=sharedCollectionCompany.settings.collectionHtmlTemplates;
    try{
      sharedCollectionCompany.settings.collectionHtmlTemplates={...original,undertaking:{...CollectionUndertakingWordTemplate.config(),html:'<p>EXISTING UNDERTAKING {{invoiceNo}}</p>'}};
      CollectionHtmlTemplates.open('undertaking');
      const intact=document.getElementById('templateHtml').value.includes('EXISTING UNDERTAKING');
      document.getElementById('templateSettingsDialog').close();
      return intact;
    }finally{sharedCollectionCompany.settings.collectionHtmlTemplates=original;}
  });
  assert.ok(preserved,'administrator-authored undertaking is not silently overwritten');
  console.log('Word undertaking: dynamic references, eight terms, A4 PDF, long-table flow and saved branding/template protection passed');
};
