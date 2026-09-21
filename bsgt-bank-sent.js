(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.JahezBsgtSentFiles=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PAGE_SIZE=10;
  const text=value=>String(value??'').trim();
  const timestamp=value=>Date.parse(value)||0;
  function day(value){
    const date=new Date(value);if(!value||!Number.isFinite(date.getTime()))return '';
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function bank(file){return text(file.collecting_bank)||'البنك غير مسجل';}
  function customers(file){return [...new Set((file.shipments||[]).map(s=>text(s.data?.consignee)).filter(Boolean))];}
  function filterFiles(files,filters={}){
    const search=text(filters.search).toLocaleLowerCase();
    return files.filter(file=>{
      if(file.status!=='sent_to_collecting'||file.archived_at)return false;
      if(filters.bank&&bank(file)!==filters.bank)return false;
      if(filters.client&&!customers(file).includes(filters.client))return false;
      const date=day(file.sent_to_collecting_at);
      if((filters.from&&(!date||date<filters.from))||(filters.to&&(!date||date>filters.to)))return false;
      if(search){
        const values=[file.operation_no,bank(file),file.remitting_bank,...customers(file),...(file.shipments||[]).flatMap(s=>[s.data?.operationNo,s.data?.invoiceNo,s.data?.billNo])];
        if(!values.some(value=>text(value).toLocaleLowerCase().includes(search)))return false;
      }
      return true;
    }).sort((a,b)=>(filters.sort==='oldest'?1:-1)*(timestamp(a.sent_to_collecting_at)-timestamp(b.sent_to_collecting_at))||text(a.id).localeCompare(text(b.id)));
  }
  function summary(files){return {
    files:files.length,
    shipments:new Set(files.flatMap(f=>(f.shipments||[]).map(s=>s.id))).size,
    banks:new Set(files.map(bank)).size,
    clients:new Set(files.flatMap(customers)).size
  };}
  function allowed(){return Boolean(window.JahezBsgtWorkspace.permissionFor('bankSent',currentAccessProfile(),bsgtWorkspacePermissionRows,currentFeaturePermissionContext()));}
  async function readAll(query,live){
    const rows=[];
    for(let offset=0;live();offset+=250){
      const result=await query().range(offset,offset+249);if(result.error)throw result.error;
      rows.push(...(result.data||[]));if((result.data||[]).length<250)return rows;
    }
    return [];
  }
  function mount(container){
    if(!allowed()){container.textContent='ليس لديك صلاحية عرض سجل الإرسال للبنك.';return;}
    const esc=value=>escapeHtml(text(value));
    bsgtRelationsState.detailId=null;bsgtRelationsState.detail=null;
    container.innerHTML=`<div id="bsgtBankSent" dir="rtl">
      <header class="bsent-heading"><div><h2>الملفات المُرسلة للبنك</h2><p>سجل موحّد للإرسال والمستندات</p></div><div class="bsent-stats" aria-label="ملخص نتائج البحث" data-stats></div></header>
      <section class="bsent-panel"><header class="bsent-section-head"><div><h3>سجل الملفات</h3><p>البنك المعني هو البنك المحصل المسجل عند الإرسال. الأحدث أولاً.</p></div><button type="button" class="btn btn-ghost" data-refresh>${icon('refresh',14)} تحديث السجل</button></header>
        <form class="bsent-filters" data-filters><label class="bsent-search">بحث سريع<input name="search" type="search" placeholder="رقم الملف، الشحنة، الفاتورة أو البوليصة…"></label>
          <label>البنك المعني<select name="bank"><option value="">كل البنوك</option></select></label><label>العميل<select name="client"><option value="">كل العملاء</option></select></label>
          <label>الإرسال من<input name="from" type="date"></label><label>الإرسال إلى<input name="to" type="date"></label><label>الترتيب<select name="sort"><option value="newest">الأحدث إرسالاً</option><option value="oldest">الأقدم إرسالاً</option></select></label>
          <button type="reset" class="btn btn-ghost">مسح الفلاتر</button></form>
        <p class="bsent-result" data-result role="status"></p><div class="bsent-list" data-list aria-live="polite"></div><nav class="bsent-pages" data-pages aria-label="صفحات الملفات المُرسلة"></nav>
      </section><div id="bsgtRelationsDetail" class="bsgt-relations"></div>
    </div>`;
    const root=container.querySelector('#bsgtBankSent'),form=root.querySelector('form'),list=root.querySelector('[data-list]');
    let files=[],page=1,requestId=0,selected=null;
    const live=()=>root.isConnected&&allowed();
    const filters=()=>Object.fromEntries(new FormData(form));
    function render(){
      if(!live())return;
      const values=filters(),invalid=values.from&&values.to&&values.from>values.to;
      const matches=invalid?[]:filterFiles(files,values),stats=summary(matches);
      root.querySelector('[data-stats]').innerHTML=[['files','ملف'],['shipments','شحنة'],['banks','بنك'],['clients','عميل']].map(([key,label])=>`<span class="bsent-stat"><strong>${stats[key]}</strong> ${label}</span>`).join('');
      const pages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));page=Math.min(page,pages);
      root.querySelector('[data-result]').textContent=invalid?'تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.':`${matches.length} ملف من ${files.length} · صفحة ${page} من ${pages}`;
      const rows=matches.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(file=>{
        const clients=customers(file),shipments=file.shipments||[];
        return `<tr class="bsent-row${selected===file.id?' is-selected':''}">
          <th scope="row"><b class="bsent-file-number" dir="ltr">${esc(file.operation_no)}</b><span class="bsent-mode">${file.metadata?.collectionMode==='cad'?'CAD · بدون تحصيل':'تحصيل مستندي'} · م${esc(file.revision_no||1)}</span></th>
          <td class="bsent-client" data-label="العميل"><span dir="auto">${esc(clients.join(' / ')||'العميل غير متاح')}</span></td>
          <td class="bsent-bank" data-label="البنك المعني"><span dir="auto">${esc(bank(file))}</span></td>
          <td class="bsent-date" data-label="تاريخ الإرسال">${esc(formatShipmentAuditDate(file.sent_to_collecting_at)||'غير مسجل')}</td>
          <td class="bsent-shipment-cell"><details><summary aria-label="عرض الشحنات المرتبطة بالملف ${esc(file.operation_no)}">${shipments.length} <span>شحنة</span></summary><div class="bsent-shipments">${shipments.map(s=>`<span dir="ltr">${esc(s.data?.operationNo||s.id)}</span>`).join('')||'<span>لا توجد شحنات متاحة للعرض</span>'}</div></details></td>
          <td class="bsent-row-action"><button type="button" class="btn btn-ghost" data-open="${esc(file.id)}" aria-label="فتح الملف والمستندات ${esc(file.operation_no)}">${icon('eye',14)} فتح</button></td></tr>`;
      }).join('');
      list.innerHTML=rows?`<table class="bsent-table" aria-label="الملفات المُرسلة للبنك"><thead><tr><th scope="col">رقم الملف / النوع</th><th scope="col">العميل</th><th scope="col">البنك المعني</th><th scope="col">تاريخ الإرسال</th><th scope="col">الشحنات</th><th scope="col">الملف</th></tr></thead><tbody>${rows}</tbody></table>`:`<div class="bsent-empty">${icon('folder',30)}<h4>${files.length?'لا توجد نتائج مطابقة':'لا توجد ملفات مُرسلة للبنك حاليًا'}</h4><p>${files.length?'جرّب تغيير البنك أو العميل أو مسح الفلاتر.':'ستظهر الملفات هنا بعد تسجيل إرسالها للبنك.'}</p></div>`;
      const buttons=new Set([1,pages,page-1,page,page+1]);let previous=0;
      root.querySelector('[data-pages]').innerHTML=`<button type="button" data-page="${page-1}" ${page===1?'disabled':''}>السابق</button><div>${[...buttons].filter(n=>n>0&&n<=pages).sort((a,b)=>a-b).map(n=>{const dots=previous&&n-previous>1?'<span>…</span>':'';previous=n;return `${dots}<button type="button" data-page="${n}" ${n===page?'aria-current="page"':''}>${n}</button>`;}).join('')}</div><button type="button" data-page="${page+1}" ${page===pages?'disabled':''}>التالي</button>`;
    }
    async function load(){
      const request=++requestId,active=()=>live()&&request===requestId;
      root.querySelector('[data-refresh]').disabled=true;root.setAttribute('aria-busy','true');
      list.innerHTML='<div class="bsent-empty" role="status">جاري تحميل سجل الإرسال…</div>';root.querySelector('[data-pages]').replaceChildren();
      root.querySelector('[data-result]').textContent='';root.querySelector('[data-stats]').replaceChildren();
      try{
        const companyId=resolveBsgtCompanyId();if(!companyId)throw Error('تعذر تحديد شركة بحر سواكن.');
        await window.JahezArchive.ready();
        // Read every authorized page, then filter joined clients without truncating to the first server page.
        const records=await readAll(()=>window.JahezArchive.active(sb.from('trade_collection_files').select('id,operation_no,status,revision_no,collecting_bank,remitting_bank,sent_to_collecting_at,metadata,updated_at').eq('company_id',companyId).eq('status','sent_to_collecting')).order('sent_to_collecting_at',{ascending:false}).order('id'),active);
        const links=[];
        for(let i=0;i<records.length&&active();i+=50)links.push(...await readAll(()=>sb.from('trade_collection_file_shipments').select('id,trade_file_id,shipment_id').in('trade_file_id',records.slice(i,i+50).map(f=>f.id)).order('id'),active));
        const ids=[...new Set(links.map(l=>l.shipment_id))],shipments=[];
        for(let i=0;i<ids.length&&active();i+=50)shipments.push(...await readAll(()=>sb.from('shipments').select('id,data').eq('company_id',companyId).in('id',ids.slice(i,i+50)).order('id'),active));
        if(!active())return;
        const byId=new Map(shipments.map(s=>[s.id,s])),byFile=new Map();
        links.forEach(l=>{if(!byFile.has(l.trade_file_id))byFile.set(l.trade_file_id,[]);const s=byId.get(l.shipment_id);if(s)byFile.get(l.trade_file_id).push(s);});
        files=records.filter(f=>f.status==='sent_to_collecting'&&!f.archived_at).map(f=>({...f,shipments:byFile.get(f.id)||[]}));
        for(const [name,options,label] of [['bank',files.map(bank),'كل البنوك'],['client',files.flatMap(customers),'كل العملاء']]){
          const select=form.elements.namedItem(name),value=select.value,choices=[...new Set(options)].sort((a,b)=>a.localeCompare(b,'ar'));
          select.innerHTML=`<option value="">${label}</option>`+choices.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
          if(value&&!choices.includes(value))select.add(new Option(value,value));select.value=value;
        }
        render();
      }catch(error){if(active()){files=[];list.innerHTML=`<div class="bsent-empty" role="alert"><h4>تعذر تحميل سجل الإرسال</h4><p>${esc(error.message)}</p><p>اضغط «تحديث السجل» للمحاولة مجددًا.</p></div>`;}}
      finally{if(active()){root.querySelector('[data-refresh]').disabled=false;root.removeAttribute('aria-busy');}}
    }
    form.onsubmit=event=>event.preventDefault();
    form.oninput=()=>{page=1;render();};form.onchange=()=>{page=1;render();};
    form.onreset=()=>setTimeout(()=>{page=1;render();},0);
    root.querySelector('[data-refresh]').onclick=()=>{selected=null;bsgtRelationsState.detailId=null;bsgtRelationsState.detail=null;root.querySelector('#bsgtRelationsDetail').replaceChildren();load();};
    root.querySelector('[data-pages]').onclick=event=>{const button=event.target.closest('[data-page]');if(button&&!button.disabled){page=Number(button.dataset.page);render();}};
    list.onclick=async event=>{
      const button=event.target.closest('[data-open]');if(!button||!live())return;
      selected=button.dataset.open;render();await openBsgtRelationsFile(selected);
      if(!live())return;
      // A file may have been returned by another admin since the list was read.
      if(bsgtRelationsState.detail?.file&&(bsgtRelationsState.detail.file.status!=='sent_to_collecting'||bsgtRelationsState.detail.file.archived_at)){
        root.querySelector('#bsgtRelationsDetail').innerHTML='<div class="bsent-empty">حالة الملف تغيرت. حدّث السجل وراجعه في مرحلته الحالية.</div>';
        bsgtRelationsState.detailId=null;bsgtRelationsState.detail=null;
      }
    };
    load();
  }
  return {mount,filterFiles,summary,day,PAGE_SIZE};
});
