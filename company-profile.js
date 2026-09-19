/* Bahar Swaken company profile: details (read from the company record) plus a document
   vault (stamps, signatures with signatory names, letterhead, logo, licences) in
   public.company_profile_files / bucket company-profile-files. Requires
   supabase/52_company_profile_files.sql. The identity studio, invoice and collection
   branding stay untouched; this vault is an additional signature source. */
(function(root, factory){
  const api = factory(root);
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.JahezCompanyProfile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root){
  'use strict';
  const BUCKET='company-profile-files', TABLE='company_profile_files', MAX_FILE_SIZE=15*1024*1024;
  const ALLOWED_MIME=Object.freeze(['image/png','image/jpeg','image/webp','application/pdf']);
  const FILE_TYPES=Object.freeze({logo:'الشعار',letterhead:'الترويسة',stamp:'الختم',signature:'التوقيع',trade_license:'الرخصة التجارية',registration_certificate:'شهادة التسجيل',tax_certificate:'الشهادة الضريبية',bank_document:'مستند بنكي',other:'مستند آخر'});
  const ASSET_TYPES=Object.freeze(['letterhead','stamp','signature','logo']);
  const DOCUMENT_TYPES=Object.freeze(['trade_license','registration_certificate','tax_certificate','bank_document','other']);
  const state={company:null,files:[],uploaders:new Map(),urls:new Map(),tab:'assets',loaded:false};

  const esc=value=>String(value==null?'':value).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  const fmtDate=value=>{ if(!value) return '—'; try{ return new Intl.DateTimeFormat('ar-AE',{year:'numeric',month:'short',day:'numeric'}).format(new Date(value)); }catch(_){ return String(value); } };
  const fmtSize=bytes=>{ const v=Number(bytes||0); if(!v) return '—'; return v<1048576?Math.max(1,Math.round(v/1024))+' KB':(v/1048576).toFixed(1)+' MB'; };
  const notify=(message,kind)=>{ if(typeof toast==='function') toast(message,kind); else if(kind==='err') alert(message); };
  const busy=on=>{ if(on&&typeof netStart==='function') netStart(); if(!on&&typeof netEnd==='function') netEnd(); };
  const currentId=()=>typeof currentUser!=='undefined'&&currentUser?currentUser.id:null;
  function canManage(){ return typeof isAdmin==='function'?isAdmin():false; }
  function company(){
    if(state.company) return state.company;
    if(typeof baharCompanyEntry==='function') state.company=baharCompanyEntry()||null;
    return state.company;
  }

  async function loadFiles(){
    const entry=company(); if(!entry) throw new Error('تعذر تحديد شركة بحر سواكن.');
    const {data,error}=await sb.from(TABLE).select('*').eq('company_id',entry.id).eq('is_active',true).order('created_at',{ascending:false});
    if(error) throw error;
    state.files=data||[]; state.loaded=true;
    const ids=[...new Set(state.files.map(file=>file.uploaded_by).filter(Boolean))];
    if(ids.length){ const result=await sb.from('profiles').select('id,display_name,email').in('id',ids); (result.data||[]).forEach(row=>state.uploaders.set(row.id,row.display_name||row.email||'—')); }
    return state.files;
  }
  async function signedUrl(file){
    const cached=state.urls.get(file.id); if(cached&&cached.expires>Date.now()) return cached.url;
    const {data,error}=await sb.storage.from(BUCKET).createSignedUrl(file.storage_path,300); if(error) throw error;
    state.urls.set(file.id,{url:data.signedUrl,expires:Date.now()+240000}); return data.signedUrl;
  }
  // Image data URL for signing (stamp / signature), fetched through a signed URL.
  async function imageDataUrl(file){
    const url=await signedUrl(file); const response=await fetch(url); if(!response.ok) throw new Error('تعذر تحميل الصورة.');
    const blob=await response.blob();
    return new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(blob); });
  }
  // Active stamps / signatures for the signature viewer (empty when the table is missing).
  async function signingAssets(){
    try{ if(!state.loaded) await loadFiles(); }catch(error){ console.warn('company profile assets',error); return {stamps:[],signatures:[]}; }
    const images=state.files.filter(file=>file.mime_type&&file.mime_type.startsWith('image/'));
    return {stamps:images.filter(file=>file.file_type==='stamp'),signatures:images.filter(file=>file.file_type==='signature')};
  }

  function rootEl(){ return document.getElementById('companyProfileRoot'); }
  function render(){
    const box=rootEl(); if(!box) return;
    const entry=company();
    if(!entry){ box.innerHTML='<div class="ccp-empty">تعذر تحديد شركة بحر سواكن في قائمة الشركات.</div>'; return; }
    const manager=canManage();
    const name=entry.name_ar||entry.name_en||'بحر سواكن';
    box.innerHTML=`<div class="ccp-shell">
      <section class="ccp-profile-head">
        <div class="ccp-identity"><div class="ccp-logo" id="cpCompanyLogo">${esc((name||'BS').slice(0,2))}</div><div><h2>${esc(name)}</h2><p>${esc(entry.name_en||'')} · شركتنا — مصدر الأختام والتوقيعات</p></div></div>
        <div class="ccp-actions">${manager?'<button class="ccp-btn primary" id="cpUploadFile">رفع ملف</button>':''}</div>
      </section>
      <nav class="ccp-tabs" aria-label="أقسام بروفايل بحر سواكن">
        ${[['assets','الأختام والتوقيعات'],['documents','المستندات'],['overview','بيانات الشركة']].map(([key,label])=>`<button class="ccp-tab ${state.tab===key?'active':''}" data-tab="${key}">${label}</button>`).join('')}
      </nav>
      <section class="ccp-profile-body" id="cpProfileBody">${state.tab==='documents'?renderDocuments():state.tab==='overview'?renderOverview():renderAssets()}</section>
    </div>`;
    box.querySelectorAll('[data-tab]').forEach(tab=>tab.addEventListener('click',()=>{ state.tab=tab.dataset.tab; render(); }));
    box.querySelector('#cpUploadFile')?.addEventListener('click',()=>openUploadModal(state.tab==='documents'?'trade_license':'stamp'));
    bindActions(); hydrateImages();
  }
  function renderOverview(){
    const c=company(), s=c.settings||{};
    const fields=[['الاسم بالعربية',c.name_ar],['الاسم بالإنجليزية',c.name_en],['الرمز',c.code],['الشعار الوصفي',c.tagline],['العنوان',s.address||s.addressEn||s.addressAr],['الهاتف',s.phone||s.phones],['البريد الإلكتروني',s.email],['الموقع',s.website]].filter(([,v])=>String(v||'').trim());
    return `<div class="ccp-section-head"><div><h3>بيانات الشركة</h3><p>للعرض من سجل الشركة الحالي. التعديل من لوحة التحكم → الشركات (استوديو الهوية) كما هو.</p></div></div><div class="ccp-overview">${fields.length?fields.map(([label,value])=>`<div class="ccp-info"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join(''):'<div class="ccp-empty">لا توجد بيانات إضافية مسجلة.</div>'}</div>`;
  }
  function renderAssets(){
    const groups=[['stamp','الأختام'],['signature','التوقيعات'],['letterhead','الترويسة'],['logo','الشعار']];
    return `<div class="ccp-section-head"><div><h3>الأختام والتوقيعات</h3><p>تُستجلب تلقائياً في نافذة التوقيع لدى الإدارة (ختم بحر سواكن / توقيع بحر سواكن). الفواتير ومستندات التحصيل تستخدم استوديو الهوية كما هو.</p></div>${canManage()?'<button class="ccp-btn primary" id="cpAssetAdd">إضافة ختم أو توقيع</button>':''}</div>
      ${groups.map(([type,label])=>{ const files=state.files.filter(file=>file.file_type===type); return `<div class="ccp-asset-group"><h4>${label} <span class="ccp-chip">${files.length}</span></h4><div class="ccp-file-grid">${files.length?files.map(fileCard).join(''):`<div class="ccp-empty">لا يوجد ${label} بعد.</div>`}</div></div>`; }).join('')}`;
  }
  function fileCard(file){
    const image=file.mime_type&&file.mime_type.startsWith('image/');
    const uploader=state.uploaders.get(file.uploaded_by)||'—';
    const placeable=image&&['stamp','signature'].includes(file.file_type), placement=placeable&&window.JahezSignaturePlacement?.fromMetadata(file);
    const actions=`<button data-action="preview">معاينة</button><button data-action="download">تنزيل</button>${canManage()?`${placeable?'<button data-action="placement">ضبط الموضع والحجم</button>':''}<button data-action="replace">استبدال</button><button data-action="archive">أرشفة</button>`:''}`;
    return `<article class="ccp-file-card" data-file-id="${esc(file.id)}"><div class="ccp-preview">${image?`<img data-profile-image="${esc(file.id)}" alt="${esc(FILE_TYPES[file.file_type])}">`:'<div class="ccp-pdf-mark">PDF</div>'}</div><div class="ccp-file-content"><h4>${esc(file.title||FILE_TYPES[file.file_type])}${placeable?` <span class="ccp-chip ${placement?'is-placed':''}" title="${placement?`العرض ${(placement.width*100).toFixed(0)}% · من اليسار ${(placement.x*100).toFixed(0)}% · من الأعلى ${(placement.y*100).toFixed(0)}%`:'لم يُضبط بعد — يُستخدم الافتراضي عند الاستجلاب'}">${placement?'الموضع مضبوط':'الموضع افتراضي'}</span>`:''}</h4>${file.signatory_name?`<p><b>الموقّع:</b> ${esc(file.signatory_name)}</p>`:''}<p title="${esc(file.original_name)}">${esc(file.original_name)}</p><small>${esc(fmtDate(file.created_at))} · ${esc(fmtSize(file.size_bytes))} · ${esc(uploader)}</small><div class="ccp-file-actions">${actions}</div></div></article>`;
  }
  function renderDocuments(){
    const docs=state.files.filter(file=>DOCUMENT_TYPES.includes(file.file_type));
    return `<div class="ccp-section-head"><div><h3>مكتبة المستندات</h3><p>${docs.length} مستند نشط لشركة بحر سواكن.</p></div>${canManage()?'<button class="ccp-btn primary" id="cpDocumentAdd">رفع مستند</button>':''}</div><div class="ccp-doc-list">${docs.length?docs.map(documentRow).join(''):'<div class="ccp-empty">لا توجد مستندات بعد.</div>'}</div>`;
  }
  function documentRow(file){
    const actions=`<button data-action="preview">معاينة</button><button data-action="download">تنزيل</button>${canManage()?'<button data-action="replace">استبدال</button><button data-action="archive">أرشفة</button>':''}`;
    return `<article class="ccp-doc-row" data-file-id="${esc(file.id)}"><div class="ccp-doc-icon">${file.mime_type==='application/pdf'?'PDF':'IMG'}</div><div class="ccp-doc-main"><b>${esc(file.title||FILE_TYPES[file.file_type])}</b><span>${esc(file.original_name)}</span></div><div class="ccp-doc-cell">${esc(FILE_TYPES[file.file_type])}</div><div class="ccp-doc-cell">${esc(fmtDate(file.created_at))}</div><div class="ccp-doc-cell">${esc(fmtSize(file.size_bytes))}</div><div class="ccp-file-actions">${actions}</div></article>`;
  }
  function bindActions(){
    const body=document.getElementById('cpProfileBody'); if(!body) return;
    body.querySelector('#cpAssetAdd')?.addEventListener('click',()=>openUploadModal('stamp'));
    body.querySelector('#cpDocumentAdd')?.addEventListener('click',()=>openUploadModal('trade_license'));
    body.querySelectorAll('[data-file-id] [data-action]').forEach(button=>button.addEventListener('click',async()=>{
      const file=state.files.find(item=>item.id===button.closest('[data-file-id]').dataset.fileId); if(!file) return;
      const action=button.dataset.action;
      if(action==='preview') return previewFile(file);
      if(action==='download') return downloadFile(file);
      if(action==='replace') return openUploadModal(file.file_type,file);
      if(action==='archive') return archiveFile(file);
      if(action==='placement') return editPlacement(file);
    }));
  }
  async function editPlacement(file){
    if(!canManage()||!window.JahezSignaturePlacement) return;
    try{
      const url=await signedUrl(file);
      const placement=await window.JahezSignaturePlacement.open({imageUrl:url,type:file.file_type,placement:file.metadata?.placement,title:`ضبط ${FILE_TYPES[file.file_type]}: ${file.title||file.signatory_name||''}`});
      if(!placement) return;
      busy(true);
      const metadata=Object.assign({},file.metadata||{},{placement});
      const {error}=await sb.from(TABLE).update({metadata}).eq('id',file.id); if(error) throw error;
      file.metadata=metadata; render(); notify('تم حفظ الموضع والحجم الافتراضي — سيُطبَّق تلقائياً عند الاستجلاب.');
    }catch(error){ console.error(error); notify('تعذر حفظ الإعداد: '+(error.message||''),'err'); }
    finally{ busy(false); }
  }
  async function hydrateImages(){
    const logo=state.files.find(file=>file.file_type==='logo'&&file.mime_type?.startsWith('image/'));
    if(logo){ try{ const url=await signedUrl(logo); const el=document.getElementById('cpCompanyLogo'); if(el) el.innerHTML=`<img src="${esc(url)}" alt="شعار الشركة">`; }catch(error){ console.warn(error); } }
    document.querySelectorAll('#companyProfileRoot [data-profile-image]').forEach(async image=>{ const file=state.files.find(item=>item.id===image.dataset.profileImage); if(!file) return; try{ image.src=await signedUrl(file); }catch(_){ image.alt='تعذر تحميل المعاينة'; } });
  }
  async function previewFile(file){ try{ busy(true); window.open(await signedUrl(file),'_blank','noopener'); }catch(error){ notify('تعذر فتح الملف.','err'); }finally{ busy(false); } }
  async function downloadFile(file){ try{ busy(true); const url=await signedUrl(file); const a=document.createElement('a'); a.href=url; a.download=file.original_name||'file'; a.target='_blank'; a.rel='noopener'; document.body.append(a); a.click(); a.remove(); }catch(error){ notify('تعذر تنزيل الملف.','err'); }finally{ busy(false); } }

  function injectModal(){
    if(document.getElementById('cpUploadModal')) return;
    const host=document.createElement('div'); host.innerHTML=`<div class="ccp-modal" id="cpUploadModal"><div class="ccp-dialog"><div class="ccp-modal-head"><h3 id="cpUploadTitle">رفع ملف جديد</h3><button class="ccp-close" type="button">×</button></div><form id="cpUploadForm" class="ccp-modal-body">
      <div class="ccp-form-grid">
        <div class="ccp-field"><label>نوع الملف *</label><select name="fileType">${Object.entries(FILE_TYPES).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></div>
        <div class="ccp-field"><label>العنوان</label><input name="title" placeholder="مثال: الختم الرسمي"></div>
        <div class="ccp-field" id="cpSignatoryField" hidden><label>اسم الموقّع *</label><input name="signatoryName" placeholder="مثال: جواد المصري — المدير"></div>
        <div class="ccp-field full"><label>الملف *</label><input name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" required><small>للأختام والتوقيعات يفضل PNG بخلفية شفافة.</small></div>
        <div class="ccp-field full"><label>ملاحظات</label><textarea name="description" rows="2"></textarea></div>
      </div><div class="ccp-modal-foot"><button class="ccp-btn primary" type="submit">رفع وحفظ</button><button class="ccp-btn ccp-cancel" type="button">إلغاء</button></div></form></div></div>`;
    while(host.firstChild) document.body.appendChild(host.firstChild);
    const modal=document.getElementById('cpUploadModal');
    modal.querySelector('.ccp-close').addEventListener('click',()=>modal.classList.remove('open'));
    modal.querySelector('.ccp-cancel').addEventListener('click',()=>modal.classList.remove('open'));
    const form=document.getElementById('cpUploadForm');
    form.addEventListener('submit',saveUpload);
    form.elements.fileType.addEventListener('change',refreshSignatoryField);
  }
  function refreshSignatoryField(){ const form=document.getElementById('cpUploadForm'); const wrap=document.getElementById('cpSignatoryField'); wrap.hidden=form.elements.fileType.value!=='signature'; form.elements.signatoryName.required=!wrap.hidden; }
  function openUploadModal(type,replacing){
    if(!canManage()) return; injectModal();
    const form=document.getElementById('cpUploadForm'); form.reset(); form.dataset.replaceId=replacing?replacing.id:'';
    form.elements.fileType.value=type||'stamp'; form.elements.title.value=replacing?.title||''; form.elements.signatoryName.value=replacing?.signatory_name||'';
    document.getElementById('cpUploadTitle').textContent=replacing?'استبدال الملف':'رفع ملف جديد';
    refreshSignatoryField(); document.getElementById('cpUploadModal').classList.add('open');
  }
  function validateFile(file){ if(!file) return 'اختر ملفاً للرفع.'; if(!ALLOWED_MIME.includes(file.type)) return 'الملفات المسموحة: PNG أو JPG أو WEBP أو PDF فقط.'; if(file.size>MAX_FILE_SIZE) return 'حجم الملف أكبر من 15MB.'; return ''; }
  const cleanFileName=name=>{ const ext=String(name||'').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'')||'bin'; return Date.now()+'-'+Math.random().toString(36).slice(2,10)+'.'+ext; };
  async function saveUpload(event){
    event.preventDefault(); if(!canManage()) return;
    const form=event.currentTarget, file=form.elements.file.files[0], problem=validateFile(file); if(problem) return notify(problem,'err');
    const type=form.elements.fileType.value; if(!FILE_TYPES[type]) return notify('نوع الملف غير صالح.','err');
    const entry=company(); if(!entry) return notify('تعذر تحديد شركة بحر سواكن.','err');
    const previous=state.files.find(item=>item.id===form.dataset.replaceId);
    const path=`${entry.id}/${type}/${cleanFileName(file.name)}`; let uploaded=false, insertedId=null;
    try{
      busy(true);
      const up=await sb.storage.from(BUCKET).upload(path,file,{contentType:file.type,cacheControl:'3600',upsert:false}); if(up.error) throw up.error; uploaded=true;
      const row={company_id:entry.id,file_type:type,title:form.elements.title.value.trim()||null,signatory_name:type==='signature'?form.elements.signatoryName.value.trim()||null:null,original_name:file.name,storage_path:path,mime_type:file.type,size_bytes:file.size,description:form.elements.description.value.trim()||null,uploaded_by:currentId(),metadata:{replaces:previous?.id||null}};
      const {data,error}=await sb.from(TABLE).insert(row).select().single(); if(error) throw error; insertedId=data.id;
      if(previous){ const archived=await sb.from(TABLE).update({is_active:false}).eq('id',previous.id); if(archived.error) throw archived.error; }
      document.getElementById('cpUploadModal').classList.remove('open');
      if(typeof addLog==='function') addLog(previous?'edit':'add',(previous?'استبدال ':'رفع ')+FILE_TYPES[type]+' لبروفايل بحر سواكن');
      notify(previous?'تم استبدال الملف.':'تم رفع الملف.');
      state.tab=ASSET_TYPES.includes(type)?'assets':'documents'; await loadFiles(); render();
    }catch(error){
      if(insertedId){ try{ await sb.from(TABLE).update({is_active:false}).eq('id',insertedId); }catch(_){} }
      if(uploaded){ try{ await sb.storage.from(BUCKET).remove([path]); }catch(_){} }
      console.error(error); notify('تعذّر حفظ الملف: '+(error.message||'خطأ غير معروف'),'err');
    }finally{ busy(false); }
  }
  async function archiveFile(file){
    if(!canManage()||!confirm(`أرشفة "${file.title||FILE_TYPES[file.file_type]}"؟\nسيختفي من البروفايل دون حذف الملف نهائياً.`)) return;
    try{ busy(true); const {error}=await sb.from(TABLE).update({is_active:false}).eq('id',file.id); if(error) throw error; state.files=state.files.filter(item=>item.id!==file.id); render(); notify('تمت الأرشفة.'); }
    catch(error){ console.error(error); notify('تعذّرت أرشفة الملف.','err'); } finally{ busy(false); }
  }

  async function open(){
    const box=rootEl(); if(!box) return;
    state.company=null; injectModal();
    box.innerHTML='<div class="ccp-empty">جاري تحميل بروفايل بحر سواكن…</div>';
    try{ await loadFiles(); render(); }
    catch(error){ console.error('company profile',error); box.innerHTML=`<div class="ccp-empty">تعذر تحميل البروفايل: ${esc(error.message||'')}<br><small>لو لم يُشغَّل ملف supabase/52_company_profile_files.sql بعد، شغّله أولاً.</small></div>`; }
  }
  return Object.freeze({FILE_TYPES,open,render,loadFiles,signingAssets,imageDataUrl,signedUrl});
});
