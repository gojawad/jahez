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
  async function mergeOperations(record){
    await ensureQrToken(record);
    const input=await rpc('bsgt_operations_package_input',{p_shipment_id:record.id});
    const snapshot=rowToRecord(input.shipment),generated={};
    for(const kind of Object.keys(input.generated)){
      const pdf=await PDFLib.PDFDocument.create();
      await appendBsgtBrowserlessPagePdf(pdf,snapshot,kind,'en');
      generated[kind]=base64(await pdf.save());
    }
    const result=await post('/api/bsgt-operations-package',{shipmentId:record.id,fingerprint:input.fingerprint,generated});
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
  function previewOperations(id){return run(async()=>{const {revision}=await revisionFor(id);await openStored('bsgt-operations-packages',revision.package_path,`حزمة العمليات · Revision ${revision.revision_no}`);});}
  function decorateOperations(record){
    const evaluation=JahezBsgtOperations.evaluateBsgtOperationsReadiness(record,shipmentFilesCache[record.id]||[]);
    const allowed=record.bsgtStage==='operations_draft'&&evaluation.completed&&bsgtOperationsPermission(true)&&JahezPermissions.can('package.merge');
    for(const id of ['bsgtOperationsQuickSend','bsgtSendToFinanceBtn','packageBtn','mergeAllBtn']){
      const button=$(id);if(!button||button.dataset.workflowBusy==='true')continue;
      if(record.operationsRevisionId&&record.bsgtStage!=='operations_draft'){
        button.classList.remove('workflow-merge-locked');button.removeAttribute('aria-disabled');button.removeAttribute('title');
        button.disabled=false;button.textContent='معاينة حزمة العمليات المعتمدة';
        button.onclick=event=>{event.stopImmediatePropagation();previewOperations(record.id);};
      }else if(record.bsgtStage==='operations_draft'){
        button.classList.toggle('workflow-merge-locked',!allowed);button.setAttribute('aria-disabled',String(!allowed));
        button.disabled=!allowed;button.textContent=evaluation.completed?'دمج الحزمة وإرسالها للمالية':`دمج الحزمة (${evaluation.completedCount}/${evaluation.requiredCount})`;
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
      input.disabled=false;
      const cell=input.closest('.bsgt-finance-row')?.lastElementChild;
      if(cell&&!cell.querySelector('[data-revision-preview]')){
        const button=document.createElement('button');button.dataset.revisionPreview=row.id;button.className='btn btn-ghost btn-small';button.textContent='معاينة الشحنة';
        button.onclick=()=>run(()=>previewFinance(row.id));cell.append(button);
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
  window.JahezRevisionWorkflow={mergeOperations,previewOperations,decorateOperations,decorateFinance,updateFinanceSelection,decorateTradeFile,renderInternalPackage};
})();
