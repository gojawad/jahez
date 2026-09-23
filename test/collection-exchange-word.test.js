'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');

module.exports=async({page,BASE,OUTPUT})=>{
  const result=await page.evaluate(()=>{
    const original={settings:state.settings,shipments:state.shipments,selected:state.selected,overrides:state.overrides};
    const brandBefore=JSON.stringify(collectionBrandingSettings());
    const layoutsBefore=JSON.stringify(sharedCollectionCompany.settings);
    try{
      // Reference data is temporary test state only, never a production shipment.
      state.settings={...state.settings,collectionDate:'2026-09-14',term:'D/A 180 DAYS FROM BILL OF EXCHANGE DATE',remittingBank:'ABU DHABI ISLAMIC BANK',drawer:'BAHAR SWAKEN GENERAL TRADING LLC',draweeAddress:'PORT SUDAN, SUDAN'};
      state.shipments=[{id:'ref1',invoiceNo:'26HF-005',invoiceDate:'2026-01-30',totalAmount:'AED 200000',consignee:'STANDER FOR IMPORT & EXPORT CO., LTD'},{id:'ref2',invoiceNo:'10/01/TH/XHS26V',invoiceDate:'2026-01-10',totalAmount:'AED 211040',consignee:'STANDER FOR IMPORT & EXPORT CO., LTD'}];
      state.selected=new Set(['ref1','ref2']);state.overrides={};
      const config=CollectionExchangeWordTemplate.config();
      const html=CollectionHtmlTemplates.documentHtml('exchange',config);
      const empty=CollectionHtmlTemplates.documentHtml('exchange',{...config,html:''});
      const plain=CollectionHtmlTemplates.documentHtml('exchange',{...config,header:'none'});
      return {html,plain,emptyMatches:empty===html,brandUnchanged:brandBefore===JSON.stringify(collectionBrandingSettings()),layoutsUnchanged:layoutsBefore===JSON.stringify(sharedCollectionCompany.settings)};
    }finally{Object.assign(state,original);}
  });
  assert.ok(result.brandUnchanged&&result.layoutsUnchanged,'reference body never rewrites saved branding/layouts');
  assert.ok(result.emptyMatches,'an empty HTML draft previews the same built-in template used after save');
  assert.ok(result.html.includes('AED 411040')&&result.html.includes('FOUR HUNDRED ELEVEN THOUSAND FORTY UAE DIRHAMS ONLY'));
  assert.ok(result.html.includes('30 Jan 2026')&&result.html.includes('10 Jan 2026'));
  assert.ok(result.html.includes('D/A 180 DAYS FROM BILL OF EXCHANGE DATE'));
  assert.ok(!result.html.includes('{{'));
  const response=await page.request.post(`${BASE}/api/render-bsgt-pdf`,{data:{html:result.plain}});
  assert.strictEqual(response.status(),200);
  const bytes=await response.body();
  assert.strictEqual((await PDFDocument.load(bytes)).getPageCount(),1);
  fs.writeFileSync(path.join(OUTPUT,'exchange-word-reference.pdf'),bytes);
  const branded=await page.evaluate(async html=>Array.from(new Uint8Array(await CollectionHtmlTemplates.pdf(html))),result.html);
  assert.strictEqual((await PDFDocument.load(Uint8Array.from(branded))).getPageCount(),1);
  fs.writeFileSync(path.join(OUTPUT,'exchange-word-branded.pdf'),Buffer.from(branded));
  const fontAndLong=await page.evaluate(async html=>{
    const frame=document.createElement('iframe');document.body.append(frame);
    try{
      await new Promise(resolve=>{frame.onload=resolve;frame.srcdoc=html;});
      const doc=frame.contentDocument;
      // Force the production fallback even on Windows, where Calibri is installed.
      doc.querySelector('.bank-exchange').style.fontFamily="'Jahez Exchange Sans'";
      await doc.fonts.load('14pt "Jahez Exchange Sans"');
      await doc.fonts.load('bold 14pt "Jahez Exchange Sans"');
      const loaded=doc.fonts.check('14pt "Jahez Exchange Sans"')&&doc.fonts.check('bold 14pt "Jahez Exchange Sans"');
      const invoices=doc.querySelector('.exchange-invoices tbody');
      for(let i=0;i<18;i++){const row=invoices.rows[0].cloneNode(true);row.cells[0].textContent=`ADDITIONAL-INVOICE-${i}`;invoices.append(row);}
      const overlap=doc.querySelector('.exchange-drawn').getBoundingClientRect().top<invoices.getBoundingClientRect().bottom;
      return {loaded,overlap,html:'<!doctype html>'+doc.documentElement.outerHTML};
    }finally{frame.remove();}
  },result.plain);
  assert.ok(fontAndLong.loaded,'PDF-host fallback fonts load locally without an external CDN');
  assert.strictEqual(fontAndLong.overlap,false,'additional invoices push parties down instead of overlapping');
  const longBytes=Buffer.from(await page.evaluate(async html=>Array.from(new Uint8Array(await CollectionHtmlTemplates.pdf(html))),fontAndLong.html));
  assert.ok((await PDFDocument.load(longBytes)).getPageCount()>1,'long invoices flow to another A4 page');
  fs.writeFileSync(path.join(OUTPUT,'exchange-word-long.pdf'),longBytes);
  const checks=await page.evaluate(()=>{
    const original=sharedCollectionCompany.settings.collectionHtmlTemplates;
    try{
      sharedCollectionCompany.settings.collectionHtmlTemplates={...original,exchange:{...CollectionExchangeWordTemplate.config(),html:'<p>EXISTING ADMIN TEMPLATE {{invoiceNo}}</p>'}};
      CollectionHtmlTemplates.open('exchange');
      const preserved=document.getElementById('templateHtml').value.includes('EXISTING ADMIN TEMPLATE');
      document.getElementById('templateSettingsDialog').close();
      return {preserved};
    }finally{sharedCollectionCompany.settings.collectionHtmlTemplates=original;}
  });
  assert.ok(checks.preserved,'explicit administrator HTML is not silently overwritten');
  console.log('Word exchange reference: two dynamic invoices, A4 PDF, unchanged branding/settings and custom template protection passed');
};
