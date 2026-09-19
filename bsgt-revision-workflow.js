/* Revision-based BSGT workflow. Existing templates and legacy cases stay intact. */
(function () {
  'use strict';
  const $=id=>document.getElementById(id);
  const labels={...JahezBsgtOperations.GENERATED_LABELS,import_permit:'إذن الاستيراد',certificate_of_origin:'شهادة المنشأ',bill_of_lading:'بوليصة الشحن',...JahezBsgtManagement.DOCUMENTS};
  const esc=escapeHtml;
  let sessionSignature='',sessionSignatureRatio=1;
  async function rpc(name,args){const {data,error}=await sb.rpc(name,args);if(error)throw error;return data;}
  async function run(action){try{return await action();}catch(error){console.error('BSGT revision workflow',error);toast(error.message||'تعذر إكمال العملية.','err');}}
  function base64(bytes){let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result);}
  async function post(path,body){
    const {data:{session}}=await sb.auth.getSession();
    if(!session)throw new Error('سجّل الدخول أولاً.');
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'تعذر حفظ الحزمة.');return result;
  }
  async function mergeOperations(record,language){
    if(!['ar','en'].includes(language))throw new Error('اختر لغة الحزمة أولاً.');
    await ensureQrToken(record);
    const input=await rpc('bsgt_operations_package_input',{p_shipment_id:record.id});
    if(input.workflowVersion!==2)throw new Error('يلزم تطبيق تحديث فصل الدمج عن الإرسال للمالية أولاً (SQL 47).');
    const snapshot=rowToRecord(input.shipment),generated={};
    // The four generated documents are rendered concurrently (each is an
    // independent server render); their order in the package is fixed by the
    // server from the shipment's document order, not by completion time.
    const kinds=Object.keys(input.generated);
    const rendered=await Promise.all(kinds.map(async kind=>{
      const pdf=await PDFLib.PDFDocument.create();
      await appendBsgtBrowserlessPagePdf(pdf,snapshot,kind,language);
      return base64(await pdf.save());
    }));
    kinds.forEach((kind,index)=>{generated[kind]=rendered[index];});
    const result=await post('/api/bsgt-operations-package',{shipmentId:record.id,fingerprint:input.fingerprint,generated,language});
    return result.shipment;
  }
  async function revisionFor(shipmentId){
    const {data:shipment,error}=await sb.from('shipments').select('*').eq('id',shipmentId).single();if(error)throw error;
    if(!shipment.operations_revision_id)throw new Error('لم تُعتمد حزمة العمليات بعد.');
    const result=await sb.from('bsgt_operations_revisions').select('*').eq('id',shipment.operations_revision_id).single();
    if(result.error)throw result.error;return {shipment,revision:result.data};
  }
  async function openStored(bucket,path,title){
    const {data,error}=await sb.storage.from(bucket).createSignedUrl(path,300);if(error)throw error;
    openPdfPreview(data.signedUrl,title);
  }
  // Opens the approved merged operations package (revision.package_path) in a
  // real browser tab so it can be compared side by side with original documents.
  // The tab is opened synchronously from the click so popup blockers allow it.
  function openMergedPackageTab(shipmentId){
    const tab=window.open('about:blank','_blank');
    return run(async()=>{
      try{
        const {revision}=await revisionFor(shipmentId);
        if(!revision.package_path)throw new Error('لا يوجد ملف مدموج لهذه المراجعة.');
        // The preview API returns the approved package with any administration
        // signatures already in place, so the tab always shows the current state.
        const result=await post('/api/bsgt-operations-package',{action:'preview',shipmentId});
        const bytes=Uint8Array.from(atob(result.pdfBase64),char=>char.charCodeAt(0));
        const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));setTimeout(()=>URL.revokeObjectURL(url),10*60*1000);
        if(tab&&!tab.closed){tab.location.replace(url);try{tab.focus();}catch(e){}}
        else{toast('اسمح للنوافذ المنبثقة لفتح الملف المدموج في تبويب مستقل.','err');openPdfPreview(url,'الحزمة الكاملة المدموجة');}
        addLog('edit',JSON.stringify({action:'finance_package_opened',shipment:shipmentId,revision:revision.revision_no,signed:result.signedKinds||[]}));
      }catch(error){if(tab&&!tab.closed)tab.close();throw error;}
    });
  }
  let previewTask=null,previewSequence=0;
  function closeOperationsPreview(){
    previewSequence++;
    if(previewTask){previewTask.destroy().catch(()=>{});previewTask=null;}
    $('bsgtPackagePreviewContent')?.remove();
    $('bsgtPackagePreviewActions')?.remove();
    $('pdfPreviewFrame').style.display='';
  }
  function previewOperations(id){return run(async()=>{
    const result=await post('/api/bsgt-operations-package',{action:'preview',shipmentId:id});
    closeOperationsPreview();
    const sequence=previewSequence;
    const bytes=Uint8Array.from(atob(result.pdfBase64),char=>char.charCodeAt(0));
    openPdfPreview('about:blank','الحزمة الكاملة المدموجة');
    const frame=$('pdfPreviewFrame');frame.style.display='none';
    const content=document.createElement('div');content.id='bsgtPackagePreviewContent';
    content.style.cssText='flex:1;min-height:0;overflow:auto;background:#f3f4f6;padding:12px';
    content.textContent='جاري تجهيز المعاينة…';frame.after(content);
    const actions=document.createElement('div');actions.id='bsgtPackagePreviewActions';
    actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;padding:10px';
    const download=document.createElement('button');download.className='btn btn-ghost';download.textContent='تحميل PDF';
    download.onclick=()=>{const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const link=document.createElement('a');link.href=url;link.download='shipment-package.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);};
    actions.append(download);
    if(bsgtOperationsPermission(true)){
      const send=document.createElement('button');send.id='bsgtPackagePreviewSend';send.className='btn btn-primary';
      send.addEventListener('click',()=>submitBsgtOperationsToFinance(id,send));actions.append(send);
    }
    content.before(actions);decorateOperations(records.find(record=>record.id===id));
    // Render pages ourselves: browser PDF/download preferences cannot hijack this preview.
    previewTask=pdfjsLib.getDocument({data:bytes.slice()});
    try{
    const pdf=await previewTask.promise;
    if(sequence!==previewSequence)return;
    content.textContent='';
    for(let number=1;number<=pdf.numPages;number++){
      const page=await pdf.getPage(number);if(sequence!==previewSequence)return;
      const viewport=page.getViewport({scale:1.4});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      canvas.setAttribute('aria-label',`صفحة ${number} من ${pdf.numPages}`);
      canvas.style.cssText='display:block;width:100%;height:auto;margin:0 auto 12px;background:white';content.append(canvas);
      await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
      if(sequence!==previewSequence)return;
      canvas.dataset.rendered='true';
    }
    }catch(error){if(sequence===previewSequence)throw error;}
  });}
  function hasOperationsQrPackage(record){
    if(record?.bsgtStage==='operations_draft'&&record.bsgtFinanceReturn?.correction&&
      record.bsgtFinanceReturn.previousRevisionId===record.operationsRevisionId)return false;
    return Boolean(record?.operationsRevisionId&&/^[A-Za-z0-9_-]{20,64}$/.test(record.qrToken||''));
  }
  async function reopenAcceptedForCorrection(record){
    if(!isAdmin())return;
    const context=await rpc('bsgt_correction_context',{p_shipment_id:record.id});
    const node=dialog('إعادة فتح للتصحيح'),host=node.querySelector('[data-content]');
    host.innerHTML=`<p>سيُعاد ملف التحصيل <b>${esc(context.operationNo)}</b> وجميع الشحنات التالية إلى العمليات:</p>
      <ul>${context.shipments.map(s=>`<li>${esc(s.operationNo)}</li>`).join('')}</ul>
      <p>ستبقى النسخ السابقة محفوظة. يلزم استبدال المستند ثم إعادة الدمج والإرسال للمالية والمراجعة، ولا يتم إرسال شيء للبنك تلقائياً. سيظل QR يعرض آخر حزمة محفوظة إلى أن تُحفظ الحزمة الجديدة.</p>
      <form><label>سبب التصحيح<textarea required maxlength="10000" rows="4" style="width:100%" data-correction-note></textarea></label>
      <p data-correction-error role="alert"></p><button type="submit" class="btn btn-primary">تأكيد إعادة الفتح للتصحيح</button></form>`;
    host.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const button=host.querySelector('[type="submit"]'),errorHost=host.querySelector('[data-correction-error]');
      const note=host.querySelector('textarea').value.trim();if(!note)return;
      button.disabled=true;errorHost.textContent='';
      try{
        await rpc('reopen_bsgt_accepted_for_correction',{p_shipment_id:record.id,p_file_id:context.fileId,p_revision_no:context.revisionNo,p_note:note});
        node.close();
        await fetchLatestShipmentWorkflowState(record.id);
        await loadBsgtOperationsPage();
        openDetail(record.id,{returnTo:'operations'});
        toast('أُعيد الملف للعمليات للتصحيح. النسخ السابقة محفوظة.');
      }catch(error){errorHost.textContent=error.message||'تعذر إعادة فتح الملف.';}
      finally{button.disabled=false;}
    };
  }
  function decorateOperations(record){
    if(!record)return;
    for(const [id,anchor] of [
      ['bsgtReopenCorrection',$('detailCard')?.querySelector('#packageBtn')],
      ['bsgtOperationsReopenCorrection',$('bsgtOperationsOpenFull')]
    ]){
      const previous=$(id);
      if(previous&&(!isAdmin()||record.bsgtStage!=='final_accepted'||previous.dataset.shipmentId!==record.id))previous.remove();
      if(anchor&&isAdmin()&&record.bsgtStage==='final_accepted'&&!$(id)){
        const button=document.createElement('button');button.id=id;button.dataset.shipmentId=record.id;
        button.type='button';button.className='btn btn-ghost';button.textContent='إعادة فتح للتصحيح';
        button.onclick=()=>run(()=>reopenAcceptedForCorrection(record));anchor.after(button);
      }
    }
    const evaluation=JahezBsgtOperations.evaluateBsgtOperationsReadiness(record,shipmentFilesCache[record.id]||[]);
    const allowed=!bsgtOperationsActionInFlight.has(record.id)&&record.bsgtStage==='operations_draft'&&evaluation.completed&&bsgtOperationsPermission(true)&&JahezPermissions.can('package.merge');
    const qrReady=hasOperationsQrPackage(record);
    const qrStatus=document.querySelector('#detailCard [data-bsgt-qr-package-status]');
    if(qrStatus&&(qrReady||record.qrPackagePath)) qrStatus.innerHTML='<b>حزمة QR جاهزة.</b> تم حفظ الحزمة؛ المسح يفتح ملف PDF المدموج مباشرة.';
    if(qrStatus&&!qrReady&&record.bsgtFinanceReturn?.correction)qrStatus.textContent='الملف قيد التصحيح. QR يعرض الحزمة السابقة؛ أعد الدمج لحفظ النسخة الجديدة قبل الإرسال للمالية.';
    for(const id of ['bsgtOperationsQuickSend','bsgtOperationsDocumentsSend','bsgtSendToFinanceBtn','bsgtPackagePreviewSend']){
      const button=$(id);if(!button||button.dataset.workflowBusy==='true')continue;
      button.hidden=!qrReady;button.style.display=qrReady?'':'none';
      const canSend=allowed&&qrReady;
      button.disabled=!canSend;button.innerHTML=`${icon('plane',14)} ${record.bsgtStage==='operations_draft'?'إرسال للمالية':'تم الإرسال للمالية'}`;
      button.title=canSend?'إرسال الحزمة المدموجة للمالية':record.bsgtStage==='operations_draft'?'ادمج الحزمة أولاً من تفاصيل الشحنة.':'';
      button.onclick=null;
    }
    const mergeButton=$('packageBtn');
    if(mergeButton&&qrReady&&!$('bsgtApprovedPackagePreview')){
      const button=document.createElement('button');button.id='bsgtApprovedPackagePreview';button.className='btn btn-ghost';
      button.innerHTML=`${icon('eye',14)} معاينة الحزمة المدموجة`;
      button.onclick=()=>previewOperations(record.id);mergeButton.after(button);
    }
    for(const id of ['packageBtn','mergeAllBtn']){
      const button=$(id);if(!button||button.dataset.workflowBusy==='true')continue;
      if(record.operationsRevisionId&&record.bsgtStage!=='operations_draft'){
        button.classList.remove('workflow-merge-locked');button.removeAttribute('aria-disabled');button.removeAttribute('title');
        button.disabled=false;button.textContent='معاينة حزمة العمليات المعتمدة';
        button.onclick=event=>{event.stopImmediatePropagation();previewOperations(record.id);};
      }else if(record.bsgtStage==='operations_draft'){
        button.classList.toggle('workflow-merge-locked',!allowed);button.setAttribute('aria-disabled',String(!allowed));
        button.disabled=!allowed;
        button.innerHTML=id==='packageBtn'?`${icon('printer')} ${qrReady||record.qrPackagePath?'تحديث الحزمة الكاملة PDF':'تجميع الحزمة الكاملة PDF'}`:`${icon('doc')} دمج الحزمة في ملف واحد`;
        button.title=allowed?'جاهزة للدمج':'أكمل متطلبات العمليات وتأكد من صلاحية الدمج.';
        button.onclick=null;
      }
    }
  }
  function dialog(title){
    const node=document.createElement('dialog');node.className='bsgt-management-modal-card';
    node.style.cssText='max-width:min(1100px,95vw);width:95vw;max-height:92dvh;overflow:auto;border:1px solid #e5e7eb;border-radius:16px;padding:20px';
    node.innerHTML=`<header style="display:flex;justify-content:space-between;gap:16px"><h3>${esc(title)}</h3><button type="button" class="btn btn-ghost" data-close>إغلاق</button></header><div data-content></div>`;
    node.querySelector('[data-close]').onclick=()=>node.close();node.addEventListener('close',()=>node.remove(),{once:true});document.body.append(node);node.showModal();return node;
  }
  async function openFinance(ids){
    if(!ids.length)return;
    const context=await rpc('create_bsgt_finance_context',{p_shipment_ids:ids});
    location.assign(`/experiments/bs-collection/?financeContext=${encodeURIComponent(context)}`);
  }
  function updateFinanceSelection(){const button=$('bsgtFinancePortalSelection');if(button){button.disabled=!bsgtFinanceState.selected.size||[...bsgtFinanceState.selected].some(id=>!bsgtFinanceState.readyRows.find(row=>row.id===id)?.operationsRevisionId);button.textContent=`فتح بوابة التحصيل (${bsgtFinanceState.selected.size})`;}}
  function decorateFinance(){
    const actions=document.querySelector('.bsgt-finance-selection');
    if(actions&&!$('bsgtFinancePortalSelection')){
      const button=document.createElement('button');button.id='bsgtFinancePortalSelection';button.className='btn btn-primary';button.type='button';
      button.onclick=()=>run(()=>openFinance([...bsgtFinanceState.selected]));actions.append(button);
    }
    document.querySelectorAll('[data-bsgt-finance-select]').forEach(input=>{
      const row=bsgtFinanceState.readyRows.find(r=>r.id===input.dataset.bsgtFinanceSelect);
      if(!row?.operationsRevisionId)return;
      // Keep shipments that already belong to a trade file unselectable (the list marks them as linked).
      input.disabled=(typeof bsgtFinanceLinkedSet==='function')&&bsgtFinanceLinkedSet().has(row.id);
      if(input.disabled&&bsgtFinanceState.selected.has(row.id)){bsgtFinanceState.selected.delete(row.id);input.checked=false;}
      const cell=input.closest('.bsgt-finance-row')?.lastElementChild;
      if(cell&&!cell.querySelector('[data-revision-preview]')){
        const iconButton=(label,tip,iconName)=>{const b=document.createElement('button');b.type='button';b.className='btn btn-ghost btn-small bsgt-icon-btn';b.title=tip;b.setAttribute('aria-label',label);b.dataset.tip=label;b.innerHTML=`${icon(iconName,16)} <span class="bsgt-icon-label">${esc(label)}</span>`;return b;};
        const tools=document.createElement('span');tools.className='bsgt-finance-row-tools';
        const button=iconButton('معاينة الشحنة','معاينة بيانات الشحنة ومستندات العمليات الأصلية','eye');button.dataset.revisionPreview=row.id;
        button.onclick=()=>run(()=>previewFinance(row.id));tools.append(button);
        const packageButton=iconButton('فتح الملف المدموج','فتح الحزمة المدموجة كاملة في تبويب جديد بالمتصفح','doc');packageButton.dataset.revisionPackage=row.id;
        packageButton.onclick=()=>openMergedPackageTab(row.id);tools.append(packageButton);
        cell.append(tools);
      }
    });updateFinanceSelection();
  }
  async function previewFinance(id){
    const {shipment,revision}=await revisionFor(id),row=rowToRecord(revision.shipment_snapshot);
    const node=dialog(`معاينة الشحنة ${row.operationNo} · Revision ${revision.revision_no}`),host=node.querySelector('[data-content]');
    const fields=bsgtOperationsOverviewFields(row);
    host.innerHTML=`<dl>${fields.map(field=>`<div style="display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding:8px"><dt>${esc(field[0])}</dt><dd>${esc(String(field[1]??'—'))}</dd></div>`).join('')}</dl>
      <h4>مستندات العمليات الأصلية · قراءة فقط</h4><div data-documents></div><div data-actions style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px"></div>`;
    const docs=host.querySelector('[data-documents]');
    revision.documents.forEach(d=>{const b=document.createElement('button');b.className='btn btn-ghost';b.textContent=labels[d.kind]||d.kind;b.onclick=()=>run(()=>openStored('bsgt-operations-packages',d.path,b.textContent));docs.append(b);});
    if(revision.package_path){
      const merged=document.createElement('button');merged.className='btn btn-ghost';merged.type='button';merged.dataset.revisionPackage=id;
      merged.textContent='فتح الملف المدموج كاملاً في تبويب';merged.title='يفتح الحزمة المدموجة في تبويب جديد بالمتصفح للمطابقة مع المستندات الأصلية';
      merged.onclick=()=>openMergedPackageTab(id);host.querySelector('[data-actions]').append(merged);
    }
    if(shipment.bsgt_stage==='ready_for_finance'){
      const actions=host.querySelector('[data-actions]'),open=document.createElement('button');open.className='btn btn-primary';open.textContent='فتح بوابة التحصيل';open.onclick=()=>run(()=>openFinance([id]));actions.append(open);
      if(bsgtFinancePermission(true)){
        const back=document.createElement('button');back.className='btn btn-ghost';back.textContent='إرجاع للعمليات';back.onclick=()=>returnToOperations(shipment,revision,node);actions.append(back);
      }
    }
    addLog('edit',JSON.stringify({action:'finance_previewed',shipment:id,revision:revision.revision_no}));
  }
  function returnToOperations(shipment,revision,preview){
    const node=dialog('إرجاع الشحنة للعمليات'),host=node.querySelector('[data-content]');
    host.innerHTML='<form><label>الملاحظة<textarea required maxlength="10000" rows="4" style="width:100%"></textarea></label><button class="btn btn-primary" type="submit">إرجاع للعمليات</button></form>';
    host.querySelector('form').onsubmit=event=>{event.preventDefault();run(async()=>{
      const button=host.querySelector('button');button.disabled=true;
      try{await rpc('return_bsgt_shipment_from_finance',{p_shipment_id:shipment.id,p_revision_id:revision.id,p_note:host.querySelector('textarea').value});node.close();preview.close();await loadBsgtFinance();toast('تم الإرجاع وحفظ الملاحظة.');}
      finally{button.disabled=false;}
    });};
  }
  function decorateTradeFile(host,file,shipments){
    if(!shipments.length||!shipments.every(s=>s.operationsRevisionId))return;
    if(shipments.every(s=>s.bsgtStage==='ready_for_finance'))host.querySelectorAll('a[href*="tradeFileId"]').forEach(a=>{a.onclick=event=>{event.preventDefault();run(()=>openFinance(shipments.map(s=>s.id)));};});
    const send=$('bsgtTradeSend');if(send){send.disabled=true;send.title='افتح بوابة التحصيل لحفظ المستندات الأصلية الثلاثة قبل الإرسال.';}
  }
  async function renderInternalPackage(host,file){
    return run(async()=>{
      const bundle=await rpc('bsgt_internal_package',{p_file_id:file.id});
      if(bsgtManagementState.detailId!==file.id||!host.isConnected)return;
      const sections=[...host.querySelectorAll('.bsgt-management-section')].filter(section=>['مستندات العمليات','مستندات التحصيل','المستندات الموقعة','حزمة المستندات الداخلية'].includes(section.querySelector('h4')?.textContent));
      if(!sections.length)return;
      const section=sections[0];sections.slice(1).forEach(s=>s.remove());
      section.innerHTML='<header><h4>حزمة المستندات الداخلية</h4><small>الأصول محفوظة · التوقيع اختياري · لا يؤثر على QR</small></header><div data-packages></div>';
      const root=section.querySelector('[data-packages]');
      for(const entry of bundle.shipments){
        const shipment=entry.shipment,ops=entry.revision;
        const sources=ops.documents.map(d=>({...d,bucket:'bsgt-operations-packages'})).concat(bundle.documents.filter(d=>d.document_variant==='finance_original').map(d=>({kind:d.document_type,path:d.storage_path,bucket:'trade-collection-documents',source:'finance'})));
        const title=document.createElement('h4');title.textContent=`${shipment.data.operationNo} · Revision ${ops.revision_no} · ${sources.length} مستند`;root.append(title);
        for(const source of sources){
          const signed=bundle.documents.find(d=>d.document_variant==='administration_signed'&&d.shipment_id===shipment.id&&d.document_type===source.kind);
          const row=document.createElement('div');row.className='bsgt-management-doc';
          row.innerHTML=`<div><b>${esc(labels[source.kind]||source.kind)}</b><small>${source.source==='finance'?'المالية':'العمليات'} · ${signed?'توجد نسخة موقعة':'الأصل'}</small></div><div data-actions></div>`;
          const actions=row.querySelector('[data-actions]'),view=document.createElement('button');view.className='btn btn-ghost btn-small';view.textContent='معاينة الأصل';view.onclick=()=>run(()=>openStored(source.bucket,source.path,labels[source.kind]));actions.append(view);
          if(signed){const b=document.createElement('button');b.className='btn btn-ghost btn-small';b.textContent='معاينة الموقّع';b.onclick=()=>run(()=>openStored('trade-collection-documents',signed.storage_path,labels[source.kind]));actions.append(b);}
          if(bsgtManagementPermission(true)&&file.status==='under_management_review'){
            const sign=document.createElement('button');sign.className='btn btn-primary btn-small';sign.textContent='إضافة توقيع';sign.onclick=()=>run(()=>signatureViewer(bundle,shipment.id,source,()=>renderInternalPackage(host,file)));actions.append(sign);
          }root.append(row);
        }
      }
    });
  }
  async function signatureViewer(bundle,shipmentId,source,onSaved){
    const result=await sb.storage.from(source.bucket).download(source.path);if(result.error)throw result.error;
    const bytes=new Uint8Array(await result.data.arrayBuffer());
    const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
    const node=dialog(`توقيع ${labels[source.kind]||source.kind}`),host=node.querySelector('[data-content]');
    host.innerHTML='<div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0"><label>صورة التوقيع <input data-image type="file" accept="image/png,image/jpeg"></label><label>الصفحة <select data-page></select></label><button type="button" class="btn btn-ghost" data-add>إضافة توقيع</button><button type="button" class="btn btn-ghost" data-clone>نسخ التوقيع</button><button type="button" class="btn btn-ghost" data-delete>حذف التوقيع</button><label>الحجم <input data-size type="range" min="3" max="50" value="20"></label><button type="button" class="btn btn-primary" data-save>حفظ النسخة الموقعة</button></div><div data-error role="status"></div><div data-paper style="position:relative;direction:ltr;max-width:100%;margin:auto"><canvas style="display:block;width:100%;height:auto"></canvas><div data-overlay style="position:absolute;inset:0"></div></div>';
    const select=host.querySelector('[data-page]'),paper=host.querySelector('[data-paper]'),canvas=host.querySelector('canvas'),overlay=host.querySelector('[data-overlay]');
    for(let i=0;i<pdf.numPages;i++){const option=document.createElement('option');option.value=i;option.textContent=i+1;select.append(option);}
    let image=sessionSignature,imageRatio=sessionSignatureRatio,pageIndex=0,selected=-1,placements=[],rendering=null;
    function draw(){
      overlay.replaceChildren();placements.forEach((p,index)=>{
        if(p.page!==pageIndex)return;
        const img=document.createElement('img');img.src=image;img.draggable=false;img.alt='التوقيع';
        img.style.cssText=`position:absolute;left:${p.x*100}%;top:${p.y*100}%;width:${p.width*100}%;height:${p.height*100}%;cursor:move;touch-action:none;outline:${index===selected?'2px solid #EA1B23':'1px dashed #999'}`;
        img.onpointerdown=event=>{
          selected=index;host.querySelector('[data-size]').value=p.width*100;
          const rect=overlay.getBoundingClientRect(),startX=event.clientX,startY=event.clientY,x=p.x,y=p.y;
          img.setPointerCapture(event.pointerId);
          img.onpointermove=e=>{p.x=Math.max(0,Math.min(1-p.width,x+(e.clientX-startX)/rect.width));p.y=Math.max(0,Math.min(1-p.height,y+(e.clientY-startY)/rect.height));img.style.left=`${p.x*100}%`;img.style.top=`${p.y*100}%`;};
          img.onpointerup=()=>{img.onpointermove=null;draw();};
        };overlay.append(img);
      });
    }
    async function render(){
      if(rendering){rendering.cancel();await rendering.promise.catch(()=>{});}
      const requested=Number(select.value),page=await pdf.getPage(requested+1);
      if(requested!==Number(select.value))return;
      pageIndex=requested;
      const viewport=page.getViewport({scale:1.25,rotation:0});canvas.width=viewport.width;canvas.height=viewport.height;paper.style.width=`${viewport.width}px`;
      rendering=page.render({canvasContext:canvas.getContext('2d'),viewport});await rendering.promise;draw();
    }
    select.onchange=()=>run(render);
    host.querySelector('[data-image]').onchange=()=>run(async()=>{
      const file=host.querySelector('[data-image]').files[0];if(!file)return;
      if(file.size>3000000)throw new Error('اختر صورة أصغر من 3MB.');
      const bitmap=await createImageBitmap(file),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;c.getContext('2d').drawImage(bitmap,0,0);image=c.toDataURL('image/png');imageRatio=bitmap.height/bitmap.width;sessionSignature=image;sessionSignatureRatio=imageRatio;bitmap.close();placements=[];selected=-1;draw();
    });
    host.querySelector('[data-add]').onclick=()=>{
      if(!image){host.querySelector('[data-error]').textContent='اختر صورة التوقيع أولاً.';return;}
      placements.push({page:pageIndex,x:.4,y:.5,width:.2,height:Math.min(.4,.2*imageRatio*canvas.width/canvas.height)});selected=placements.length-1;draw();
    };
    host.querySelector('[data-clone]').onclick=()=>{if(selected<0)return;const p=placements[selected];placements.push({...p,page:pageIndex,x:Math.min(1-p.width,p.x+.03),y:Math.min(1-p.height,p.y+.03),cloned:true});selected=placements.length-1;draw();};
    host.querySelector('[data-delete]').onclick=()=>{if(selected>=0)placements.splice(selected,1);selected=-1;draw();};
    host.querySelector('[data-size]').oninput=event=>{const p=placements[selected];if(!p||p.page!==pageIndex)return;p.width=Number(event.target.value)/100;p.height=Math.min(.8,p.width*imageRatio*canvas.width/canvas.height);p.x=Math.min(p.x,1-p.width);p.y=Math.min(p.y,1-p.height);draw();};
    host.querySelector('[data-save]').onclick=()=>run(async()=>{
      if(!placements.length)throw new Error('أضف التوقيع قبل الحفظ.');
      const button=host.querySelector('[data-save]');button.disabled=true;
      try{await post('/api/bsgt-internal-document',{action:'sign',tradeFileId:bundle.file.id,revisionNo:bundle.file.revision_no,shipmentId,kind:source.kind,image:image.split(',')[1],placements});node.close();await onSaved();toast('حُفظت النسخة الموقعة داخلياً. الأصل وQR لم يتغيرا.');}
      finally{button.disabled=false;}
    });
    node.addEventListener('close',()=>{rendering?.cancel();pdf.destroy();},{once:true});await render();
  }
  window.JahezRevisionWorkflow={mergeOperations,previewOperations,closeOperationsPreview,hasOperationsQrPackage,decorateOperations,decorateFinance,updateFinanceSelection,decorateTradeFile,renderInternalPackage};
})();
