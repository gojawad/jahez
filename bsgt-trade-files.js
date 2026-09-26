/* Trade-file index; the only mutation here is an administrator-audited correction return. */
(function(){
  'use strict';
  const pageSize=24, esc=value=>escapeHtml(String(value??''));
  const labels={letter:'خطاب التحصيل',undertaking:'خطاب التعهد',exchange:'الكمبيالة',contract:'العقد',proforma:'الفاتورة المبدئية',invoice:'الفاتورة النهائية',packing:'قائمة التعبئة',import_permit:'إذن الاستيراد',certificate_of_origin:'شهادة المنشأ',bill_of_lading:'بوليصة الشحن'};
  function allowed(){return Boolean(window.JahezBsgtWorkspace.permissionFor('tradeFiles',currentAccessProfile(),bsgtWorkspacePermissionRows,currentFeaturePermissionContext()));}
  function status(file){return window.JahezBsgtRelations.STATUS_LABELS[file.status]||window.JahezBsgtFinance.fileStatusLabel(file.status);}
  async function all(query){
    const rows=[];
    for(let offset=0;;offset+=500){
      const result=await query().range(offset,offset+499);if(result.error)throw result.error;
      rows.push(...(result.data||[]));if((result.data||[]).length<500)return rows;
    }
  }
  function mount(container){
    if(!allowed()){container.textContent='ليس لديك صلاحية عرض ملفات العمليات التجارية.';return;}
    container.innerHTML=`<div id="bsgtTradeFiles"><section class="tf-panel"><header><div><h2>ملفات العمليات التجارية</h2><p>كل الملفات المتاحة لحسابك، وشحناتها ومستنداتها المحفوظة في مكان واحد.</p></div><span>${isAdmin()?'عرض وإرجاع':'عرض فقط'}</span></header><div class="tf-tools"><input type="search" data-search aria-label="البحث برقم الملف التجاري" placeholder="ابحث برقم العملية TC…"><select data-status aria-label="حالة الملف"><option value="">جميع الحالات</option>${['draft','sent_to_remitting','under_management_review','final_accepted','sent_to_collecting','returned_to_operations','returned_to_finance'].map(value=>`<option value="${value}">${esc(status({status:value}))}</option>`).join('')}<option value="__archived">مؤرشف (الأرشيف)</option></select><button class="btn btn-ghost" data-refresh>تحديث</button></div><div class="tf-list" data-list aria-live="polite"></div><div class="tf-pages"><button class="btn btn-ghost" data-prev>السابق</button><span data-count></span><button class="btn btn-ghost" data-next>التالي</button></div></section><div data-detail></div></div>`;
    const root=container.querySelector('#bsgtTradeFiles');
    let page=0,selected=null,listRequest=0,detailRequest=0,timer;
    const live=()=>root.isConnected&&allowed();
    async function load(){
      const request=++listRequest,host=root.querySelector('[data-list]');
      host.innerHTML='<p class="tf-message">جاري تحميل الملفات…</p>';
      root.querySelector('[data-prev]').disabled=true;root.querySelector('[data-next]').disabled=true;
      try{
        const companyId=resolveBsgtCompanyId();if(!companyId)throw new Error('تعذر تحديد شركة بحر سواكن.');
        await window.JahezArchive.ready();
        let query=sb.from('trade_collection_files').select('*',{count:'exact'}).eq('company_id',companyId).order('created_at',{ascending:false}).order('id');
        const search=root.querySelector('[data-search]').value.trim(),filter=root.querySelector('[data-status]').value;
        if(search)query=query.ilike('operation_no',`%${search.replace(/[\\%_]/g,'\\$&')}%`);
        // Archived files (test / non-operational) are listed only under the "مؤرشف" filter.
        if(filter==='__archived')query=window.JahezArchive.archivedOnly(query);
        else{query=window.JahezArchive.active(query);if(filter)query=query.eq('status',filter);}
        const result=await query.range(page*pageSize,(page+1)*pageSize-1);if(result.error)throw result.error;
        if(!live()||request!==listRequest)return;
        const files=result.data||[],total=result.count??files.length;
        if(page&&page*pageSize>=total){page=Math.max(0,Math.ceil(total/pageSize)-1);return load();}
        host.innerHTML=files.map(file=>`<button type="button" class="tf-file" data-file="${esc(file.id)}" aria-pressed="${file.id===selected}"><b>${esc(file.operation_no)}</b><span>${esc(status(file))}${file.archived_at?' · مؤرشف':''}</span><small>${esc(file.remitting_bank||'البنك غير محدد')} · المراجعة ${Number(file.revision_no)||1}</small><small>${esc(formatShipmentAuditDate(file.created_at))}</small><span>${icon('eye',14)} عرض التفاصيل والمستندات</span></button>`).join('')||'<p class="tf-message">لا توجد ملفات مطابقة متاحة لحسابك.</p>';
        root.querySelector('[data-count]').textContent=`${total} ملف · صفحة ${page+1} من ${Math.max(1,Math.ceil(total/pageSize))}`;
        root.querySelector('[data-prev]').disabled=page===0;root.querySelector('[data-next]').disabled=(page+1)*pageSize>=total;
        host.querySelectorAll('[data-file]').forEach(button=>button.onclick=()=>open(button.dataset.file));
      }catch(error){if(live()&&request===listRequest)host.innerHTML=`<p class="tf-message">تعذر تحميل الملفات: ${esc(error.message)}</p>`;}
    }
    async function open(id){
      if(!live())return;
      selected=id;const request=++detailRequest,host=root.querySelector('[data-detail]');
      root.querySelectorAll('[data-file]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.file===id)));
      host.innerHTML='<p class="tf-panel tf-message">جاري تحميل تفاصيل الملف…</p>';
      try{
        const fileResult=await sb.from('trade_collection_files').select('*').eq('company_id',resolveBsgtCompanyId()).eq('id',id).single();if(fileResult.error)throw fileResult.error;
        const file=fileResult.data;
        const links=await all(()=>sb.from('trade_collection_file_shipments').select('*').eq('trade_file_id',id).order('id'));
        const documents=await all(()=>sb.from('trade_collection_file_documents').select('*').eq('trade_file_id',id).order('created_at',{ascending:false}).order('id'));
        const attachments=await all(()=>sb.from('trade_collection_relations_attachments').select('*').eq('trade_file_id',id).order('uploaded_at',{ascending:false}).order('id'));
        const events=await all(()=>sb.from('trade_collection_file_events').select('*').eq('trade_file_id',id).order('created_at',{ascending:false}).order('id'));
        const shipments=[],revisions=[],uploads=[];
        // Small batches avoid long URL filters; no stage restriction hides historical files.
        for(let offset=0;offset<links.length;offset+=50){
          const batch=links.slice(offset,offset+50),ids=batch.map(link=>link.shipment_id);
          shipments.push(...await all(()=>sb.from('shipments').select('*').eq('company_id',resolveBsgtCompanyId()).in('id',ids).order('id')));
          const revisionIds=batch.map(link=>link.operations_revision_id).filter(Boolean);
          if(revisionIds.length)revisions.push(...await all(()=>sb.from('bsgt_operations_revisions').select('*').in('id',revisionIds).not('approved_at','is',null).order('id')));
          const legacy=batch.filter(link=>!link.operations_revision_id).map(link=>link.shipment_id);
          if(legacy.length)uploads.push(...await all(()=>sb.from('shipment_files').select('*').in('shipment_id',legacy).order('id')));
        }
        if(!live()||request!==detailRequest)return;
        const rows=links.map(link=>revisions.find(revision=>revision.id===link.operations_revision_id)?.shipment_snapshot||shipments.find(shipment=>shipment.id===link.shipment_id)).filter(Boolean).map(rowToRecord),sources=[];
        function sourceRow(source,title,subtitle){
          const index=sources.push({...source,title})-1;
          return `<div class="tf-row"><div><b>${esc(title)}</b><small>${esc(subtitle)}</small></div><button type="button" class="btn btn-ghost" data-preview="${index}">${icon('eye',14)} معاينة</button></div>`;
        }
        const documentRows=documents.map(doc=>sourceRow({source:'collection',documentId:doc.id},labels[doc.document_type]||doc.document_type,`${doc.document_variant==='finance_original'?'الأصل المالي':doc.document_variant==='administration_signed'?'نسخة موقعة':'مستند محفوظ'} · المراجعة ${doc.revision_no} · ${doc.is_active?'نشط':'سابق'} · ${doc.file_name||''}`)).join('');
        const attachmentRows=attachments.map(doc=>sourceRow({source:'relations',documentId:doc.id},window.JahezBsgtRelations.attachmentLabel(doc.attachment_type),`${doc.original_name} · المراجعة ${doc.revision_no} · ${doc.is_active?'نشط':'مؤرشف'}`)).join('');
        const operationRows=links.map(link=>{
          const revision=revisions.find(row=>row.id===link.operations_revision_id),shipment=rows.find(row=>row.id===link.shipment_id);
          if(!revision)return uploads.filter(doc=>doc.shipment_id===link.shipment_id).map(doc=>sourceRow({source:'uploaded',documentId:doc.id},doc.label||labels[doc.document_type]||doc.name,`${shipment?.operationNo||'شحنة'} · ${doc.name||''}`)).join('');
          const subtitle=`${revision.shipment_snapshot?.data?.operationNo||shipment?.operationNo||'شحنة'} · حزمة العمليات المعتمدة ${revision.revision_no}`;
          return sourceRow({source:'operations',documentId:revision.id,kind:'package'},'الحزمة المدموجة',subtitle)+(revision.documents||[]).map(doc=>sourceRow({source:'operations',documentId:revision.id,kind:doc.kind},labels[doc.kind]||doc.kind,subtitle)).join('');
        }).join('');
        const totals=window.JahezBsgtFinance.summarizeShipments(rows).totals;
        const facts=[['رقم الملف',file.operation_no],['الحالة',status(file)],['المراجعة',file.revision_no||1],['الشحنات المرتبطة',links.length],['إجمالي قيمة الشحنات',Object.entries(totals).map(([currency,amount])=>window.JahezBsgtFinance.formatMoney(currency,amount)).join(' / ')],['البنك المرسل',file.remitting_bank],['البنك المحصل',file.collecting_bank_name||file.collecting_bank],['عنوان البنك المحصل',file.metadata?.collectingBankAddress],['تاريخ الإنشاء',formatShipmentAuditDate(file.created_at)],['الإرسال للبنك المرسل',formatShipmentAuditDate(file.sent_to_remitting_at)],['القبول النهائي',formatShipmentAuditDate(file.final_accepted_at)],['الإرسال للبنك المحصل',formatShipmentAuditDate(file.sent_to_collecting_at)]];
        host.innerHTML=`<section class="tf-panel"><header><div><h3>${esc(file.operation_no)}</h3><p>البيانات والمستندات المحفوظة، دون تعديل أو إعادة توليد.</p></div><div class="tf-head-actions">${window.JahezArchive?.canArchive()?`<button type="button" class="btn btn-ghost jahez-archive-action" data-archive-file="${file.archived_at?'restore':'archive'}" title="${file.archived_at?'إرجاع الملف وشحناته إلى القوائم':'إخراج الملف وكل شحناته من القوائم والحسابات دون حذف'}">${icon(file.archived_at?'refresh':'archive',14)} ${file.archived_at?'إلغاء الأرشفة':'أرشفة الملف'}</button>`:''}<button class="btn btn-ghost" data-close>إغلاق التفاصيل</button></div></header><div class="tf-facts">${facts.map(([key,value])=>`<div><span>${esc(key)}</span><b>${esc(value||'—')}</b></div>`).join('')}</div><section class="tf-section"><h4>الشحنات المرتبطة</h4>${rows.map(row=>`<div class="tf-row"><div><b>${esc(row.operationNo)}</b><span>${esc(row.consignee)} · ${esc(row.itemDesc)}</span><small>الفاتورة ${esc(row.invoiceNo||'—')} · البوليصة ${esc(row.billNo||'—')} · ${esc(row.totalAmount||'')}</small></div></div>`).join('')||'<p>لا توجد شحنات متاحة للعرض.</p>'}</section><section class="tf-section"><h4>مستندات التحصيل والأصول والنسخ الموقعة</h4>${documentRows||'<p>لا توجد نسخ محفوظة متاحة لهذا الملف بعد.</p>'}</section><section class="tf-section"><h4>مرفقات العلاقات التجارية</h4>${attachmentRows||'<p>لا توجد مرفقات محفوظة متاحة.</p>'}</section><section class="tf-section"><h4>حزم ومستندات الشحنات</h4>${operationRows||'<p>لا توجد ملفات محفوظة متاحة للمعاينة.</p>'}</section><section class="tf-section"><h4>سجل الأحداث</h4>${events.map(event=>`<div class="tf-row"><div><b>${esc(bsgtRelationsEventLabel(event))}</b><span>${esc(event.note||'')}</span><small>${esc(formatShipmentAuditDate(event.created_at))} · المراجعة ${Number(event.revision_no)||1}</small></div></div>`).join('')||'<p>لا توجد أحداث مسجلة.</p>'}</section></section>`;
        if(isAdmin()&&file.status==='sent_to_collecting'&&!file.archived_at&&file.metadata?.operationsRevisionWorkflow&&links.length&&shipments.length===links.length){
          const button=document.createElement('button');button.type='button';button.className='btn btn-ghost';button.dataset.reopenDispatched='';
          button.textContent='إرجاع للعمليات للتصحيح';host.querySelector('.tf-head-actions').prepend(button);
          button.onclick=()=>{
            const modal=document.createElement('dialog');modal.className='bsgt-management-modal-card';
            modal.style.cssText='max-width:min(650px,95vw);width:95vw;padding:20px;border:1px solid #e5e7eb;border-radius:16px';
            modal.innerHTML=`<h3>إرجاع ${esc(file.operation_no)} إلى العمليات</h3><p>سيُعاد الملف وكل شحناته (${links.length}) إلى المرحلة الأولى للتصحيح. النسخ السابقة وسجل تسليم البنك محفوظان، لكن النسخة التي استلمها البنك فعليًا لن تُسحب تلقائيًا.</p><p>خلال التصحيح سيظهر تنبيه بدل ملف QR القديم، وبعد إعادة الدمج والاعتماد يلزم تسليم النسخة المصححة للبنك يدويًا.</p><form><label>سبب التصحيح<textarea required maxlength="10000" rows="3" style="width:100%"></textarea></label><p role="alert" data-error></p><div class="tf-head-actions"><button type="submit" class="btn btn-primary">تأكيد الإرجاع</button><button type="button" class="btn btn-ghost" data-cancel>إلغاء</button></div></form>`;
            document.body.append(modal);modal.showModal();modal.querySelector('[data-cancel]').onclick=()=>modal.close();
            modal.addEventListener('close',()=>modal.remove(),{once:true});
            modal.querySelector('form').onsubmit=async event=>{
              event.preventDefault();const submit=modal.querySelector('[type="submit"]'),errorHost=modal.querySelector('[data-error]');
              const note=modal.querySelector('textarea').value.trim();if(!note)return;
              submit.disabled=true;errorHost.textContent='';
              try{
                const result=await sb.rpc('reopen_bsgt_dispatched_for_correction',{
                  p_trade_file_id:file.id,p_revision_no:file.revision_no,p_expected_updated_at:file.updated_at,
                  p_shipment_ids:links.map(link=>link.shipment_id),p_note:note
                });
                if(result.error)throw result.error;
                modal.close();toast('أُعيد الملف وشحناته للعمليات. النسخ السابقة وسجل البنك محفوظان.');
                await loadRecords();await load();await open(id);
              }catch(error){errorHost.textContent=error.message||'تعذر إرجاع الملف. حدّث الصفحة وحاول مرة أخرى.';}
              finally{submit.disabled=false;}
            };
          };
        }
        if(events.some(event=>event.from_status==='sent_to_collecting'&&event.to_status==='returned_to_operations')){
          const notice=document.createElement('p');notice.className='tf-message';
          notice.textContent='أُرسلت مراجعة سابقة للبنك ثم أُعيدت للتصحيح. راجع سجل الأحداث والنسخ السابقة قبل تسليم أي نسخة جديدة.';
          host.querySelector('.tf-facts').before(notice);
        }
        const shipmentSection=host.querySelector('.tf-section');
        const explanation=document.createElement('p');explanation.textContent='ملف واحد لكل شحنة يضم حزمة العمليات والمستندات المالية والنسخ الموقعة ومرفقات العلاقات التجارية المحفوظة للمراجعة الحالية. لا يغيّر حزمة QR.';shipmentSection.querySelector('h4').after(explanation);
        shipmentSection.querySelectorAll('.tf-row').forEach((element,index)=>{
          const row=rows[index],button=document.createElement('button');button.type='button';button.className='btn btn-primary';button.dataset.shipmentPreview=row.id;
          button.innerHTML=`${icon('eye',14)} معاينة الملف الكامل`;
          button.onclick=()=>preview(id,{source:'shipment',documentId:row.id,title:`الملف الكامل للشحنة ${row.operationNo||''}`});element.append(button);
        });
        const archive=document.createElement('details');archive.className='tf-section';
        const summary=document.createElement('summary');summary.textContent='المستندات الفردية والنسخ السابقة';archive.append(summary);
        const sections=Array.from(host.querySelectorAll('section.tf-section')).slice(1,4);sections[0].before(archive);sections.forEach(section=>archive.append(section));
        host.querySelector('[data-archive-file]')?.addEventListener('click',async event=>{
          const button=event.currentTarget,archive=button.dataset.archiveFile==='archive';
          if(!confirm(archive?`أرشفة الملف ${file.operation_no} وكل شحناته المرتبطة (${links.length})؟\n\nلن يُحذف أي شيء: المستندات والسجل ورابط QR تبقى محفوظة، لكن الملف وشحناته يختفون من القوائم والحسابات.`:`إلغاء أرشفة الملف ${file.operation_no} وإرجاعه مع شحناته إلى القوائم؟`))return;
          button.disabled=true;
          try{netStart();await window.JahezArchive.setArchive('trade_file',id,archive);toast(archive?'تمت أرشفة الملف وشحناته.':'تمت استعادة الملف وشحناته.');await loadRecords();renderDashboard?.();load();open(id);}
          catch(error){console.error('archive trade file',error);toast(error.message||'تعذرت العملية.','err');button.disabled=false;}
          finally{netEnd();}
        });
        host.querySelector('[data-close]').onclick=()=>{selected=null;detailRequest++;host.replaceChildren();root.querySelectorAll('[data-file]').forEach(button=>button.setAttribute('aria-pressed','false'));};
        host.querySelectorAll('[data-preview]').forEach(button=>button.onclick=()=>preview(id,sources[Number(button.dataset.preview)]));
        host.scrollIntoView({behavior:'smooth',block:'start'});
      }catch(error){if(live()&&request===detailRequest)host.innerHTML=`<p class="tf-panel tf-message">تعذر تحميل الملف: ${esc(error.message)}</p>`;}
    }
    root.querySelector('[data-prev]').onclick=()=>{page--;load();};root.querySelector('[data-next]').onclick=()=>{page++;load();};
    root.querySelector('[data-refresh]').onclick=()=>{load();if(selected)open(selected);};
    root.querySelector('[data-status]').onchange=()=>{page=0;load();};
    root.querySelector('[data-search]').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{page=0;load();},300);};
    load();
  }
  async function preview(fileId,source){
    if(!allowed())return;
    const dialog=document.createElement('dialog');dialog.className='bsgt-trade-preview';
    dialog.innerHTML=`<header><h3>${esc(source.title)}</h3><div class="tf-preview-actions"><button type="button" class="btn btn-ghost" data-print disabled>${icon('printer',16)} طباعة</button><button type="button" class="btn btn-ghost" data-download disabled>${icon('download',16)} تنزيل</button><button type="button" class="btn btn-ghost" data-close>إغلاق</button></div></header><div data-print-status role="status"></div><div data-pages aria-live="polite">جاري تحميل المعاينة…</div>`;
    let task=null,closed=false,fileUrl=null,mimeType=null,printFrame=null,printTimer=null;
    const printButton=dialog.querySelector('[data-print]'),downloadButton=dialog.querySelector('[data-download]'),printStatus=dialog.querySelector('[data-print-status]');
    downloadButton.onclick=()=>{
      if(!fileUrl||closed)return;
      const extension=mimeType==='application/pdf'?'pdf':mimeType==='image/png'?'png':'jpg';
      const link=document.createElement('a');link.href=fileUrl;link.download=`${String(source.title||'document').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,120)}.${extension}`;
      dialog.append(link);link.click();link.remove();
    };
    printButton.onclick=()=>{
      if(!fileUrl||closed)return;
      if(printFrame)printFrame.remove();clearTimeout(printTimer);printButton.disabled=true;printStatus.textContent='جاري تجهيز الطباعة…';
      const frame=document.createElement('iframe');printFrame=frame;frame.className='tf-print-frame';frame.dataset.printFrame='true';frame.title='طباعة المستند';frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
      const failed=()=>{if(closed||printFrame!==frame)return;clearTimeout(printTimer);printButton.disabled=false;printStatus.textContent='تعذر فتح الطباعة. يمكنك تنزيل الملف وطباعته من قارئ المستندات.';};
      frame.onerror=failed;
      frame.onload=async()=>{
        if(closed||printFrame!==frame)return;
        try{
          if(mimeType!=='application/pdf')await frame.contentDocument.querySelector('img').decode();
          if(closed||printFrame!==frame)return;
          clearTimeout(printTimer);frame.contentWindow.focus();frame.contentWindow.print();
          printButton.disabled=false;printStatus.textContent='';
        }catch{failed();}
      };
      // Print the original PDF in isolation, not the portal or its canvas preview.
      if(mimeType==='application/pdf')frame.src=fileUrl;
      else frame.srcdoc=`<!doctype html><html><head><title>${esc(source.title)}</title><style>@page{margin:10mm}body{margin:0}img{display:block;max-width:100%;max-height:270mm;object-fit:contain;margin:auto}</style></head><body><img src="${esc(fileUrl)}" alt=""></body></html>`;
      printTimer=setTimeout(failed,30000);dialog.append(frame);
    };
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{closed=true;clearTimeout(printTimer);if(task)task.destroy().catch(()=>{});if(fileUrl){const url=fileUrl;setTimeout(()=>URL.revokeObjectURL(url),60000);}dialog.remove();},{once:true});
    document.body.append(dialog);dialog.showModal();
    const host=dialog.querySelector('[data-pages]');
    try{
      const {data:{session}}=await sb.auth.getSession();if(!session)throw new Error('سجل الدخول أولاً.');
      const response=await fetch('/api/bsgt-trade-file-preview',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({fileId,source:source.source,documentId:source.documentId,kind:source.kind})});
      const result=await response.json();if(!response.ok)throw new Error(result.error);if(closed)return;
      const bytes=Uint8Array.from(atob(result.base64),char=>char.charCodeAt(0));
      if(!['application/pdf','image/png','image/jpeg'].includes(result.mimeType))throw new Error('نوع الملف غير مدعوم للمعاينة.');
      mimeType=result.mimeType;fileUrl=URL.createObjectURL(new Blob([bytes],{type:mimeType}));
      host.textContent='';
      if(result.mimeType==='application/pdf'){
        task=pdfjsLib.getDocument({data:bytes});const pdf=await task.promise;
        for(let number=1;number<=pdf.numPages&&!closed;number++){
          const page=await pdf.getPage(number);if(closed)return;
          const viewport=page.getViewport({scale:1.35}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);canvas.setAttribute('aria-label',`صفحة ${number} من ${pdf.numPages}`);host.append(canvas);
          await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;canvas.dataset.rendered='true';
        }
      }else if(['image/png','image/jpeg'].includes(result.mimeType)){
        const image=document.createElement('img');image.alt=source.title;image.src=fileUrl;host.append(image);await image.decode();
      }else throw new Error('نوع الملف غير مدعوم للمعاينة.');
      if(!closed){printButton.disabled=false;downloadButton.disabled=false;}
    }catch(error){if(!closed)host.textContent=error.message||'تعذرت المعاينة.';}
  }
  window.JahezBsgtTradeFiles={mount};
})();
