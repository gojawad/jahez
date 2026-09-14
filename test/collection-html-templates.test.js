'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const zlib=require('zlib');
const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');

// A small real DOCX ZIP containing only page-layout XML is sufficient for this importer.
function wordFile(){
  const xml=Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DO NOT IMPORT THIS TEXT</w:t></w:r></w:p><w:sectPr><w:pgMar w:top="1440" w:bottom="1134" w:left="720" w:right="900" w:header="360" w:footer="280"/></w:sectPr></w:body></w:document>');
  const name=Buffer.from('word/document.xml'),data=zlib.deflateRawSync(xml);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(data.length,18);local.writeUInt32LE(xml.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(data.length,20);central.writeUInt32LE(xml.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+data.length,16);
  return Buffer.concat([local,name,data,central,name,end]);
}
module.exports=async({page,BASE,OUTPUT})=>{
  await page.locator('[data-step-section="preview-section"]').click();
  const oldSettings=await page.evaluate(()=>JSON.parse(localStorage.getItem('__testSharedCollectionSettings')));
  await page.locator('[data-preview="letter"]').click();
  assert.strictEqual(await page.locator('#templateSettingsDialog').isVisible(),true);
  assert.strictEqual(await page.locator('.document-editor-panel').isVisible(),false);
  assert.match(await page.locator('#templateSettingsTitle').textContent(),/إعداد خطاب التحصيل/);
  const html='<style>h1{color:#D01119}td,th{border:1px solid black;padding:5px}</style><div dir="ltr"><h1>{{document_title}}</h1><p>{{consignee}}</p><p>{{remittingBank}} / {{amount}}</p><table><thead><tr><th>Invoice</th><th>Bill</th></tr></thead><tbody>{{#each rows}}<tr><td>{{invoiceNo}}</td><td>{{billNo}}</td></tr>{{/each}}</tbody></table></div>';
  await page.locator('#templateHtml').fill(html);
  await page.locator('#template_top').fill('21');
  await page.screenshot({path:path.join(OUTPUT,'collection-template-settings.png')});
  const requestPromise=page.waitForRequest(request=>request.url().endsWith('/api/render-bsgt-pdf'));
  const pdfPromise=page.waitForResponse(response=>response.url().endsWith('/api/render-bsgt-pdf'));
  await page.locator('#templatePreview').click();
  const response=await pdfPromise;
  assert.strictEqual(response.status(),200);
  const previewBytes=await response.body();
  const sent=(await requestPromise).postDataJSON().html;
  assert.ok(sent.includes('HJ2026173')&&sent.includes('CY260719')&&sent.includes('278073887'));
  assert.ok(sent.includes('margin:21mm 12.7mm 25mm 12.7mm'));
  assert.ok(!sent.includes('{{invoiceNo}}'));
  await page.locator('#templatePreviewDialog').waitFor({state:'visible'});
  assert.deepStrictEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('__testSharedCollectionSettings'))),oldSettings,'preview never persists settings');
  fs.writeFileSync(path.join(OUTPUT,'collection-template-preview.pdf'),previewBytes);
  const pdf=await PDFDocument.load(previewBytes);
  assert.strictEqual(pdf.getPageCount(),1);
  assert.ok(Math.abs(pdf.getPage(0).getWidth()-595.28)<1);
  await page.locator('#templatePreviewBack').click();
  assert.strictEqual(await page.locator('#templateHtml').inputValue(),html);

  await page.locator('#templateWordFile').setInputFiles({name:'layout.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:wordFile()});
  await page.waitForFunction(()=>document.getElementById('template_top').value==='25.4');
  assert.strictEqual(await page.locator('#template_left').inputValue(),'12.7');
  assert.strictEqual(await page.locator('#template_headerSize').inputValue(),'6.35');
  assert.strictEqual(await page.locator('#templateHtml').inputValue(),html);
  await page.locator('#templateWordFile').setInputFiles({name:'bad.doc',mimeType:'application/msword',buffer:Buffer.from('invalid')});
  await page.waitForFunction(()=>document.getElementById('templateError').textContent.includes('تعذر قراءة'));
  assert.strictEqual(await page.locator('#template_top').inputValue(),'25.4');
  assert.strictEqual(await page.locator('#templateHtml').inputValue(),html);
  await page.locator('#templateUnit').selectOption('cm');
  assert.strictEqual(await page.locator('#template_top').inputValue(),'2.54');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#templateForm button[type="submit"]').click();
  await page.locator('#templateSettingsDialog').waitFor({state:'hidden'});
  const afterSave=await page.evaluate(()=>JSON.parse(localStorage.getItem('__testSharedCollectionSettings')));
  assert.strictEqual(afterSave.collectionHtmlTemplates.letter.html,html);
  assert.strictEqual(afterSave.collectionHtmlTemplates.undertaking,undefined);
  assert.deepStrictEqual(afterSave.collectionDocumentLayouts,oldSettings.collectionDocumentLayouts);
  await page.locator('.collection-html-frame').waitFor();
  const rendered=page.frameLocator('.collection-html-frame');
  assert.strictEqual(await rendered.locator('tbody tr').count(),2);
  await page.evaluate(()=>{window.__templateXss=false;});
  const security=await page.evaluate(()=>CollectionHtmlTemplates.documentHtml('letter',{
    ...sharedCollectionCompany.settings.collectionHtmlTemplates.letter,
    html:'<script>parent.__templateXss=true</script><img src="https://attacker.invalid/track" onerror="parent.__templateXss=true"><a href="javascript:alert(1)">Link</a><iframe srcdoc="bad"></iframe><style>@import "https://attacker.invalid/a";p{background:u\\72l(https://attacker.invalid/b);color:red}</style><p onclick="alert(1)">{{consignee}}</p>'
  }));
  assert.ok(!security.includes('attacker.invalid')&&!security.includes('<script')&&!security.includes('onclick=')&&!security.includes('onerror=')&&!security.includes('javascript:'));
  assert.ok(security.includes('color:red'));
  const docxMissing=await page.evaluate(async()=>{try{await CollectionHtmlTemplates.importWord(new File(['bad'],'a.docx'));return false;}catch(_){return true;}});
  assert.strictEqual(docxMissing,true);

  const longHtml=await page.evaluate(()=>CollectionHtmlTemplates.documentHtml('letter',{
    ...sharedCollectionCompany.settings.collectionHtmlTemplates.letter,
    html:'<div dir="rtl"><h1>اختبار الصفحات</h1>'+Array.from({length:100},(_,i)=>`<p>ROW ${i} / Shipping documents and collection information.</p>`).join('')+'</div>'
  }));
  const longResponse=await page.request.post(`${BASE}/api/render-bsgt-pdf`,{data:{html:longHtml}});
  assert.strictEqual(longResponse.status(),200);
  const longBytes=await longResponse.body();
  const longPdf=await PDFDocument.load(longBytes);
  assert.ok(longPdf.getPageCount()>2,'long HTML flows to multiple A4 pages');
  fs.writeFileSync(path.join(OUTPUT,'collection-template-multipage.pdf'),longBytes);
  const brandedHtml=await page.evaluate(()=>{
    const company=sharedCollectionCompany.settings;
    const image=(text,color)=>{
      const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=100;
      const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,1000,100);ctx.fillStyle='white';ctx.font='40px Arial';ctx.fillText(text,30,65);
      return canvas.toDataURL('image/png');
    };
    const originalHeader=company.letterheadImg,originalFooter=company.footerImg;
    company.letterheadImg=image('EXISTING COMPANY LETTERHEAD','#D01119');company.footerImg=image('EXISTING COMPANY FOOTER','#333333');
    try{return CollectionHtmlTemplates.documentHtml('letter',{...company.collectionHtmlTemplates.letter,header:'company',unit:'mm',top:10,bottom:10,headerSize:20,footerSize:15,html:'<h1>HEADER AND FOOTER TEST</h1>'+Array.from({length:60},(_,i)=>`<p>Document row ${i}</p>`).join('')});}
    finally{company.letterheadImg=originalHeader;company.footerImg=originalFooter;}
  });
  assert.ok(brandedHtml.includes('class="template-header"')&&brandedHtml.includes('class="template-footer"'));
  assert.ok(brandedHtml.includes('margin:30mm'));
  const brandBytes=await page.evaluate(async html=>Array.from(new Uint8Array(await CollectionHtmlTemplates.pdf(html))),brandedHtml);
  fs.writeFileSync(path.join(OUTPUT,'collection-template-header-footer.pdf'),Buffer.from(brandBytes));
  assert.ok((await PDFDocument.load(Uint8Array.from(brandBytes))).getPageCount()>1,'artwork preserves every generated page');
  await page.locator('#printAllBtn').click();
  await page.locator('#templatePreviewDialog').waitFor({state:'visible',timeout:30000});
  const combined=await page.evaluate(async()=>Array.from(new Uint8Array(await (await fetch(document.getElementById('templatePdfPreview').src)).arrayBuffer())));
  assert.strictEqual((await PDFDocument.load(Uint8Array.from(combined))).getPageCount(),3,'saved HTML and two legacy documents share one PDF bundle');
  await page.locator('#templatePreviewBack').click();

  await page.locator('[data-preview="undertaking"]').click();
  await page.locator('#templateHtml').fill('<p>UNSAVED</p>');
  await page.locator('#templateCancel').click();
  assert.strictEqual(await page.evaluate(()=>sharedCollectionCompany.settings.collectionHtmlTemplates.undertaking),undefined);
  await page.locator('[data-preview="letter"]').click();
  assert.strictEqual(await page.locator('#templateHtml').inputValue(),html);
  await page.setViewportSize({width:390,height:844});
  const mobile=await page.evaluate(()=>{const dialog=document.getElementById('templateSettingsDialog');return {client:dialog.clientWidth,scroll:dialog.scrollWidth};});
  assert.ok(mobile.scroll<=mobile.client);
  await page.locator('#templateCancel').click();
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>localStorage.setItem('__testPortalRole','staff'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.shipment-card').first().waitFor({state:'attached'});
  await page.locator('[data-step-section="preview-section"]').click();
  await page.locator('[data-preview="letter"]').click();
  assert.strictEqual(await page.locator('#templateSettingsDialog').isVisible(),false,'employee cannot open template settings');
  assert.strictEqual(await page.evaluate(()=>CollectionHtmlTemplates.hasTemplate('letter')),true,'saved template reaches employees');
  await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;
    const ctx=canvas.getContext('2d');ctx.fillStyle='blue';ctx.fillRect(0,0,100,100);
    sharedCollectionBranding.stamp=canvas.toDataURL('image/png');renderPreview();
  });
  await page.locator('#moveStampBtn').click();
  const frameStamp=page.locator('.collection-html-page > .template-stamp');
  await frameStamp.waitFor();
  await frameStamp.scrollIntoViewIfNeeded();
  const stampBox=await frameStamp.boundingBox();
  await page.mouse.move(stampBox.x+stampBox.width/2,stampBox.y+stampBox.height/2);
  await page.mouse.down();await page.mouse.move(stampBox.x+stampBox.width/2-25,stampBox.y+stampBox.height/2-25,{steps:5});await page.mouse.up();
  assert.ok((await frameStamp.boundingBox()).x<stampBox.x-20,'existing employee stamp movement works with HTML templates');
  await page.locator('#moveStampBtn').click();
  await page.evaluate(()=>localStorage.setItem('__testPortalRole','admin'));
  console.log('Collection HTML templates: drafts, save, variables, DOCX, sanitization, multi-page PDF, mixed legacy bundle, mobile and employee permissions passed');
};
