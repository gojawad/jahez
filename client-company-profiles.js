(function(root, factory){
  const api = factory(root);
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.ClientCompanyProfiles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root){
  'use strict';

  const BUCKET = 'client-profile-files';
  const MAX_FILE_SIZE = 15 * 1024 * 1024;
  const ALLOWED_MIME = Object.freeze(['image/png','image/jpeg','image/webp','application/pdf']);
  const FILE_TYPES = Object.freeze({
    logo:'الشعار',
    letterhead:'الترويسة',
    stamp:'الختم',
    signature:'التوقيع',
    trade_license:'الرخصة التجارية',
    registration_certificate:'شهادة التسجيل',
    tax_certificate:'الشهادة الضريبية',
    bank_document:'مستند بنكي',
    other:'مستند آخر'
  });
  const ASSET_TYPES = Object.freeze(['logo','letterhead','stamp','signature']);
  const DOCUMENT_TYPES = Object.freeze(['trade_license','registration_certificate','tax_certificate','bank_document','other']);
  const WRITE_ROLES = Object.freeze(['admin','editor']);
  const READ_ROLES = Object.freeze(['admin','editor','staff','viewer']);
  const state = {clients:[], selected:null, files:[], signatories:[], uploaders:new Map(), tab:'overview', query:'', status:'all', docsPage:1, urls:new Map()};

  function canRead(role){ return READ_ROLES.includes(role); }
  function canManage(role){ return WRITE_ROLES.includes(role); }
  function canArchive(role){ return role === 'admin'; }
  function canAccessFile(role){ return ['admin','editor','viewer'].includes(role); }
  function summarizeClient(client){
    const active = (client.client_profile_files || []).filter(file=>file.is_active !== false);
    return {
      fileCount:active.length,
      hasStamp:active.some(file=>file.file_type === 'stamp'),
      hasLetterhead:active.some(file=>file.file_type === 'letterhead'),
      hasLogo:active.some(file=>file.file_type === 'logo')
    };
  }
  function clientDisplayName(client){ return (client && (client.name_ar || client.name_en || client.name)) || 'عميل بدون اسم'; }
  function esc(value){
    return String(value == null ? '' : value).replace(/[&<>'"]/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }
  function fmtDate(value){
    if(!value) return '—';
    try{ return new Intl.DateTimeFormat('ar-AE',{year:'numeric',month:'short',day:'numeric'}).format(new Date(value)); }
    catch(error){ return String(value); }
  }
  function fmtSize(bytes){
    const value = Number(bytes || 0);
    if(!value) return '—';
    if(value < 1024 * 1024) return Math.max(1, Math.round(value / 1024)) + ' KB';
    return (value / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function initials(value){
    return String(value || 'ش').trim().split(/\s+/).slice(0,2).map(part=>part[0] || '').join('').toUpperCase();
  }
  function currentRole(){ return typeof currentUser !== 'undefined' && currentUser ? currentUser.role : ''; }
  function currentId(){ return typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null; }
  function notify(message, kind){
    if(typeof toast === 'function') toast(message, kind);
    else if(kind === 'err') alert(message);
  }
  function startBusy(){ if(typeof netStart === 'function') netStart(); }
  function endBusy(){ if(typeof netEnd === 'function') netEnd(); }
  function logAction(type, text){ if(typeof addLog === 'function') addLog(type, text); }
  function rootEl(){ return typeof document === 'undefined' ? null : document.getElementById('clientProfilesRoot'); }
  function iconMarkup(name){
    if(typeof icon === 'function') return icon(name, 22);
    return '<span aria-hidden="true">◆</span>';
  }

  async function loadClients(){
    const box = rootEl();
    if(box) box.innerHTML = '<div class="ccp-loading"><b>جاري تحميل بروفايلات الشركات</b>لحظات ونجهز البيانات الحالية.</div>';
    const {data,error} = await sb.from('clients').select('id,name,phone,note,active,created_at,name_ar,name_en,email,address,country,trade_license_no,tax_registration_no,website,updated_at,client_profile_files(id,file_type,is_active)').order('name');
    if(error) throw error;
    state.clients = data || [];
    if(!state.selected) renderList();
  }

  function filteredClients(){
    const q = state.query.trim().toLowerCase();
    return state.clients.filter(client=>{
      if(state.status === 'active' && client.active === false) return false;
      if(state.status === 'inactive' && client.active !== false) return false;
      if(!q) return true;
      return [client.name,client.name_ar,client.name_en,client.phone,client.email,client.trade_license_no]
        .some(value=>String(value || '').toLowerCase().includes(q));
    });
  }

  function renderList(){
    const box = rootEl();
    if(!box) return;
    const rows = filteredClients();
    box.innerHTML = `
      <div class="ccp-shell">
        <section class="ccp-hero">
          <div class="ccp-hero-copy"><div class="ccp-hero-icon">${iconMarkup('building')}</div><div><h2>بروفايل الشركات</h2><p>بيانات العملاء، هويتهم ومستنداتهم المعتمدة في مكان واحد.</p></div></div>
          <div class="ccp-count">${state.clients.length.toLocaleString('ar-EG')} شركة عميلة</div>
        </section>
        <div class="ccp-toolbar">
          <div class="ccp-search"><span>${iconMarkup('search')}</span><input id="ccpSearch" value="${esc(state.query)}" placeholder="ابحث باسم الشركة، الهاتف أو رقم الرخصة..."></div>
          <select class="ccp-filter" id="ccpStatus"><option value="all">كل الشركات</option><option value="active">النشطة فقط</option><option value="inactive">غير النشطة</option></select>
        </div>
        <div class="ccp-grid" id="ccpGrid">
          ${rows.length ? rows.map(clientCard).join('') : '<div class="ccp-empty"><b>لا توجد نتائج مطابقة</b>غيّر كلمات البحث أو حالة الشركة.</div>'}
        </div>
      </div>`;
    box.querySelector('#ccpStatus').value = state.status;
    box.querySelector('#ccpSearch').addEventListener('input', event=>{ state.query = event.target.value; renderList(); requestAnimationFrame(()=>{ const input=document.getElementById('ccpSearch'); if(input){ input.focus(); input.setSelectionRange(input.value.length,input.value.length); } }); });
    box.querySelector('#ccpStatus').addEventListener('change', event=>{ state.status = event.target.value; renderList(); });
    box.querySelectorAll('[data-client-id]').forEach(card=>card.addEventListener('click', ()=>openClient(card.dataset.clientId)));
  }

  function clientCard(client){
    const summary = summarizeClient(client);
    return `<article class="ccp-card" data-client-id="${esc(client.id)}" tabindex="0" role="button">
      <div class="ccp-card-head">
        <div class="ccp-monogram">${esc(initials(clientDisplayName(client)))}</div>
        <div class="ccp-card-title"><h3>${esc(clientDisplayName(client))}</h3><p>${esc(client.name_en || client.email || client.phone || 'لا توجد بيانات اتصال')}</p></div>
        <span class="ccp-status ${client.active === false ? 'off' : ''}">${client.active === false ? 'غير نشطة' : 'نشطة'}</span>
      </div>
      <div class="ccp-card-meta">
        <span class="ccp-chip ${summary.hasLetterhead?'ready':''}">ترويسة ${summary.hasLetterhead?'موجودة':'غير مضافة'}</span>
        <span class="ccp-chip ${summary.hasStamp?'ready':''}">ختم ${summary.hasStamp?'موجود':'غير مضاف'}</span>
        <span class="ccp-chip">${summary.fileCount} ملف</span>
      </div>
      <div class="ccp-card-foot"><span>${esc(client.phone || client.country || 'بيانات أساسية فقط')}</span><span class="ccp-open">فتح البروفايل ←</span></div>
    </article>`;
  }

  async function openClient(clientId, options){
    const box = rootEl();
    if(!box) return;
    const cached = state.clients.find(client=>client.id === clientId);
    state.selected = cached || {id:clientId,name:'...'};
    state.tab = (options && options.tab) || 'overview';
    state.docsPage = 1;
    renderProfileLoading();
    try{
      const [clientResult, filesResult, signResult] = await Promise.all([
        sb.from('clients').select('id,name,phone,note,active,created_at,name_ar,name_en,email,address,country,trade_license_no,tax_registration_no,website,updated_at').eq('id',clientId).single(),
        sb.from('client_profile_files').select('*').eq('client_id',clientId).eq('is_active',true).order('created_at',{ascending:false}),
        sb.from('client_authorized_signatories').select('*').eq('client_id',clientId).eq('active',true).order('created_at',{ascending:false})
      ]);
      if(clientResult.error) throw clientResult.error;
      if(filesResult.error) throw filesResult.error;
      if(signResult.error) throw signResult.error;
      state.selected = clientResult.data;
      state.files = filesResult.data || [];
      state.signatories = signResult.data || [];
      state.uploaders = new Map();
      const uploaderIds = [...new Set(state.files.map(file=>file.uploaded_by).filter(Boolean))];
      if(uploaderIds.length){
        const uploaderResult = await sb.from('profiles').select('id,display_name,email').in('id',uploaderIds);
        if(uploaderResult.error) console.warn('profile file uploaders', uploaderResult.error);
        else (uploaderResult.data || []).forEach(profile=>state.uploaders.set(profile.id,profile.display_name || profile.email || 'مستخدم'));
      }
      const listClient = state.clients.find(client=>client.id===clientId);
      if(listClient) listClient.client_profile_files = state.files.map(file=>({id:file.id,file_type:file.file_type,is_active:file.is_active}));
      renderProfile();
      if(!(options && options.route === false) && typeof updateHash === 'function') updateHash('clientProfiles', clientId);
    }catch(error){
      console.error('client profile', error);
      box.innerHTML = `<div class="ccp-shell"><div class="ccp-empty"><b>تعذّر فتح بروفايل الشركة</b>${esc(error.message || 'حاول مرة أخرى.')}</div></div>`;
    }
  }

  function renderProfileLoading(){
    const box=rootEl();
    if(box) box.innerHTML='<div class="ccp-shell"><button class="ccp-back" id="ccpBack">→ العودة للقائمة</button><div class="ccp-loading" style="margin-top:14px"><b>جاري فتح البروفايل</b>يتم تحميل ملفات هذه الشركة فقط.</div></div>';
    document.getElementById('ccpBack')?.addEventListener('click', backToList);
  }
  function backToList(){
    state.selected=null; state.files=[]; state.signatories=[]; state.uploaders=new Map();
    renderList();
    if(typeof updateHash === 'function') updateHash('clientProfiles');
  }

  function renderProfile(){
    const box=rootEl(); if(!box || !state.selected) return;
    const client=state.selected;
    const manager=canManage(currentRole());
    box.innerHTML=`<div class="ccp-shell">
      <button class="ccp-back" id="ccpBack">→ العودة لقائمة الشركات</button>
      <section class="ccp-profile-head" style="margin-top:12px">
        <div class="ccp-identity"><div class="ccp-logo" id="ccpCompanyLogo">${esc(initials(clientDisplayName(client)))}</div><div><h2>${esc(clientDisplayName(client))}</h2><p>${esc(client.name_en || client.name || '')}${client.phone ? ' · '+esc(client.phone) : ''}</p></div></div>
        <div class="ccp-actions">${manager ? '<button class="ccp-btn" id="ccpEditProfile">تعديل البيانات</button><button class="ccp-btn primary" id="ccpUploadFile">رفع ملف</button>' : ''}</div>
      </section>
      <nav class="ccp-tabs" aria-label="أقسام بروفايل الشركة">
        ${[['overview','نظرة عامة'],['assets','الأختام والتوقيعات'],['documents','المستندات'],['signatories','الأشخاص المفوضون']].map(([key,label])=>`<button class="ccp-tab ${state.tab===key?'active':''}" data-tab="${key}">${label}</button>`).join('')}
      </nav>
      <section class="ccp-profile-body" id="ccpProfileBody">${renderTab()}</section>
    </div>`;
    box.querySelector('#ccpBack').addEventListener('click',backToList);
    box.querySelectorAll('[data-tab]').forEach(tab=>tab.addEventListener('click',()=>{ state.tab=tab.dataset.tab; state.docsPage=1; renderProfile(); }));
    box.querySelector('#ccpEditProfile')?.addEventListener('click', openProfileModal);
    box.querySelector('#ccpUploadFile')?.addEventListener('click', ()=>openUploadModal());
    bindTabActions();
    hydrateProfileImages();
  }

  function renderTab(){
    if(state.tab==='assets') return renderAssets();
    if(state.tab==='documents') return renderDocuments();
    if(state.tab==='signatories') return renderSignatories();
    return renderOverview();
  }
  function renderOverview(){
    const c=state.selected;
    const fields=[
      ['الاسم المسجل',c.name],['الاسم بالعربية',c.name_ar],['الاسم بالإنجليزية',c.name_en],['الهاتف',c.phone],['البريد الإلكتروني',c.email],['الدولة',c.country],['العنوان',c.address],['رقم الرخصة التجارية',c.trade_license_no],['الرقم الضريبي',c.tax_registration_no],['الموقع الإلكتروني',c.website],['ملاحظات',c.note],['تاريخ الإضافة',fmtDate(c.created_at)]
    ].filter(([,value])=>String(value || '').trim());
    return `<div class="ccp-section-head"><div><h3>بيانات الشركة</h3><p>البيانات المسجلة على حساب العميل نفسه.</p></div></div><div class="ccp-overview">${fields.length ? fields.map(([label,value])=>`<div class="ccp-info"><span>${esc(label)}</span><b>${label==='الموقع الإلكتروني'?`<a href="${esc(safeWebsite(value))}" target="_blank" rel="noopener">${esc(value)}</a>`:esc(value)}</b></div>`).join('') : '<div class="ccp-empty"><b>لا توجد بيانات إضافية</b>يمكن للمدير أو المحرر إكمالها من تعديل البيانات.</div>'}</div>`;
  }
  function safeWebsite(value){
    const text=String(value || '').trim();
    return /^https?:\/\//i.test(text) ? text : 'https://' + text;
  }
  function renderAssets(){
    const groups=[['letterhead','الترويسة'],['stamp','الختم'],['signature','التوقيعات'],['logo','الشعار']];
    return `<div class="ccp-section-head"><div><h3>الأختام والتوقيعات</h3><p>أصول الهوية محفوظة بأمان ولا تدخل تلقائياً في أي مستند في هذه المرحلة.</p></div>${canManage(currentRole())?'<button class="ccp-btn primary" id="ccpAssetAdd">إضافة أصل</button>':''}</div>${groups.map(([type,label])=>{ const files=state.files.filter(file=>file.file_type===type); return `<div class="ccp-asset-group"><h4 class="ccp-asset-group-title">${label}</h4><div class="ccp-file-grid">${files.length?files.map(fileCard).join(''):'<div class="ccp-empty" style="padding:28px 18px"><b>غير مضاف</b>لا يوجد ملف نشط من هذا النوع.</div>'}</div></div>`; }).join('')}`;
  }
  function fileCard(file){
    const image=file.mime_type && file.mime_type.startsWith('image/');
    const uploader=state.uploaders.get(file.uploaded_by) || 'غير معروف';
    const fileActions=canAccessFile(currentRole())?`<button data-action="preview">معاينة</button><button data-action="download">تنزيل</button>${canManage(currentRole())?'<button data-action="replace">استبدال</button>':''}${canArchive(currentRole())?'<button data-action="archive">أرشفة</button>':''}`:'<span class="ccp-chip">الأصل محفوظ</span>';
    return `<article class="ccp-file-card" data-file-id="${esc(file.id)}"><div class="ccp-preview">${image?`<img data-profile-image="${esc(file.id)}" alt="${esc(FILE_TYPES[file.file_type])}">`:'<div class="ccp-pdf-mark">PDF</div>'}</div><div class="ccp-file-content"><h4>${esc(file.title || FILE_TYPES[file.file_type])}</h4><p title="${esc(file.original_name)}">${esc(file.original_name)}</p><div class="ccp-file-meta"><span>${fmtSize(file.size_bytes)}</span><span>${fmtDate(file.created_at)}</span><span>بواسطة ${esc(uploader)}</span></div><div class="ccp-file-actions">${fileActions}</div></div></article>`;
  }
  function renderDocuments(){
    const docs=state.files.filter(file=>DOCUMENT_TYPES.includes(file.file_type));
    const perPage=10, pages=Math.max(1,Math.ceil(docs.length/perPage));
    state.docsPage=Math.min(state.docsPage,pages);
    const visible=docs.slice((state.docsPage-1)*perPage,state.docsPage*perPage);
    return `<div class="ccp-section-head"><div><h3>مكتبة المستندات</h3><p>${docs.length} مستند نشط لهذه الشركة.</p></div>${canManage(currentRole())?'<button class="ccp-btn primary" id="ccpDocumentAdd">رفع مستند</button>':''}</div><div class="ccp-doc-list">${visible.length?visible.map(documentRow).join(''):'<div class="ccp-empty"><b>لا توجد مستندات</b>لم تُرفع مستندات لهذه الشركة بعد.</div>'}</div>${pages>1?`<div class="ccp-pagination">${Array.from({length:pages},(_,i)=>`<button class="${state.docsPage===i+1?'active':''}" data-page="${i+1}">${i+1}</button>`).join('')}</div>`:''}`;
  }
  function documentRow(file){
    const uploader=state.uploaders.get(file.uploaded_by) || 'غير معروف';
    const fileActions=canAccessFile(currentRole())?`<button data-action="preview">معاينة</button><button data-action="download">تنزيل</button>${canManage(currentRole())?'<button data-action="replace">استبدال</button>':''}${canArchive(currentRole())?'<button data-action="archive">أرشفة</button>':''}`:'<span class="ccp-chip">المستند محفوظ</span>';
    return `<article class="ccp-doc-row" data-file-id="${esc(file.id)}"><div class="ccp-doc-icon">${file.mime_type==='application/pdf'?'PDF':'IMG'}</div><div class="ccp-doc-main"><b>${esc(file.title || FILE_TYPES[file.file_type])}</b><span>${esc(file.original_name)}</span></div><div class="ccp-doc-cell">${esc(FILE_TYPES[file.file_type])}</div><div class="ccp-doc-cell">${fmtSize(file.size_bytes)} · ${fmtDate(file.created_at)}<br>بواسطة ${esc(uploader)}</div><div class="ccp-file-actions">${fileActions}</div></article>`;
  }
  function renderSignatories(){
    return `<div class="ccp-section-head"><div><h3>الأشخاص المفوضون</h3><p>جهات التفويض الخاصة بالشركة، وليست حسابات مستخدمين في المنصة.</p></div>${canManage(currentRole())?'<button class="ccp-btn primary" id="ccpSignatoryAdd">إضافة شخص مفوض</button>':''}</div><div class="ccp-sign-grid">${state.signatories.length?state.signatories.map(signatoryCard).join(''):'<div class="ccp-empty"><b>لا يوجد أشخاص مفوضون</b>لم تتم إضافة مفوضين لهذه الشركة.</div>'}</div>`;
  }
  function signatoryCard(person){
    const signatures=state.files.filter(file=>file.file_type==='signature' && file.signatory_id===person.id).length;
    return `<article class="ccp-sign-card" data-signatory-id="${esc(person.id)}"><div class="ccp-sign-top"><div class="ccp-sign-avatar">${esc(initials(person.name))}</div><div><h4>${esc(person.name)}</h4><p>${esc(person.title || 'بدون مسمى وظيفي')}</p></div></div><div class="ccp-sign-contact">${person.phone?`الهاتف: ${esc(person.phone)}<br>`:''}${person.email?`البريد: ${esc(person.email)}<br>`:''}التوقيعات المرتبطة: ${signatures}</div>${canManage(currentRole())?`<div class="ccp-sign-actions"><button class="ccp-btn" data-action="edit-signatory">تعديل</button>${canArchive(currentRole())?' <button class="ccp-btn danger" data-action="archive-signatory">أرشفة</button>':''}</div>`:''}</article>`;
  }

  function bindTabActions(){
    const body=document.getElementById('ccpProfileBody'); if(!body) return;
    body.querySelector('#ccpAssetAdd')?.addEventListener('click',()=>openUploadModal('stamp'));
    body.querySelector('#ccpDocumentAdd')?.addEventListener('click',()=>openUploadModal('trade_license'));
    body.querySelector('#ccpSignatoryAdd')?.addEventListener('click',()=>openSignatoryModal());
    body.querySelectorAll('[data-file-id]').forEach(card=>card.addEventListener('click',event=>{
      const button=event.target.closest('[data-action]'); if(!button) return;
      const file=state.files.find(item=>item.id===card.dataset.fileId); if(!file) return;
      const action=button.dataset.action;
      if(action==='preview') previewFile(file);
      if(action==='download') downloadFile(file);
      if(action==='replace') openUploadModal(file.file_type,file);
      if(action==='archive') archiveFile(file);
    }));
    body.querySelectorAll('[data-signatory-id]').forEach(card=>card.addEventListener('click',event=>{
      const button=event.target.closest('[data-action]'); if(!button) return;
      const person=state.signatories.find(item=>item.id===card.dataset.signatoryId); if(!person) return;
      if(button.dataset.action==='edit-signatory') openSignatoryModal(person);
      if(button.dataset.action==='archive-signatory') archiveSignatory(person);
    }));
    body.querySelectorAll('[data-page]').forEach(button=>button.addEventListener('click',()=>{ state.docsPage=Number(button.dataset.page); renderProfile(); }));
  }

  async function signedUrl(file){
    const cached=state.urls.get(file.id);
    if(cached && cached.expires>Date.now()) return cached.url;
    const {data,error}=await sb.storage.from(BUCKET).createSignedUrl(file.storage_path,300);
    if(error) throw error;
    state.urls.set(file.id,{url:data.signedUrl,expires:Date.now()+240000});
    return data.signedUrl;
  }
  async function hydrateProfileImages(){
    if(!canAccessFile(currentRole())) return;
    const logo=state.files.find(file=>file.file_type==='logo' && file.mime_type?.startsWith('image/'));
    if(logo){ try{ const url=await signedUrl(logo); const el=document.getElementById('ccpCompanyLogo'); if(el) el.innerHTML=`<img src="${esc(url)}" alt="شعار الشركة">`; }catch(error){ console.warn(error); } }
    document.querySelectorAll('[data-profile-image]').forEach(async image=>{
      const file=state.files.find(item=>item.id===image.dataset.profileImage); if(!file) return;
      try{ image.src=await signedUrl(file); }catch(error){ image.alt='تعذر تحميل المعاينة'; }
    });
  }
  async function previewFile(file){
    try{
      startBusy(); const url=await signedUrl(file); const modal=document.getElementById('ccpPreviewModal');
      document.getElementById('ccpPreviewTitle').textContent=file.title || FILE_TYPES[file.file_type];
      const body=document.getElementById('ccpPreviewBody');
      body.innerHTML=file.mime_type?.startsWith('image/')?`<img src="${esc(url)}" alt="${esc(file.title || file.original_name)}">`:`<iframe src="${esc(url)}" title="${esc(file.title || file.original_name)}"></iframe>`;
      modal.classList.add('open');
    }catch(error){ notify('تعذّرت معاينة الملف.', 'err'); console.error(error); } finally{ endBusy(); }
  }
  async function downloadFile(file){
    try{ startBusy(); const url=await signedUrl(file); const link=document.createElement('a'); link.href=url; link.download=file.original_name; link.target='_blank'; link.rel='noopener'; document.body.appendChild(link); link.click(); link.remove(); }
    catch(error){ notify('تعذّر تنزيل الملف.', 'err'); console.error(error); } finally{ endBusy(); }
  }

  function openProfileModal(){
    if(!canManage(currentRole())) return;
    const c=state.selected, form=document.getElementById('ccpProfileForm');
    [['name','name'],['nameAr','name_ar'],['nameEn','name_en'],['phone','phone'],['email','email'],['country','country'],['address','address'],['license','trade_license_no'],['tax','tax_registration_no'],['website','website'],['note','note']].forEach(([id,key])=>{ form.elements[id].value=c[key] || ''; });
    document.getElementById('ccpProfileModal').classList.add('open');
  }
  async function saveProfile(event){
    event.preventDefault(); if(!canManage(currentRole())) return;
    const form=event.currentTarget;
    const row={name:form.elements.name.value.trim(),name_ar:form.elements.nameAr.value.trim()||null,name_en:form.elements.nameEn.value.trim()||null,phone:form.elements.phone.value.trim()||null,email:form.elements.email.value.trim()||null,country:form.elements.country.value.trim()||null,address:form.elements.address.value.trim()||null,trade_license_no:form.elements.license.value.trim()||null,tax_registration_no:form.elements.tax.value.trim()||null,website:form.elements.website.value.trim()||null,note:form.elements.note.value.trim()||null};
    if(!row.name){ notify('الاسم المسجل مطلوب.', 'err'); return; }
    try{ startBusy(); const {data,error}=await sb.from('clients').update(row).eq('id',state.selected.id).select().single(); if(error) throw error; state.selected=data; const idx=state.clients.findIndex(item=>item.id===data.id); if(idx>=0) state.clients[idx]=Object.assign({},state.clients[idx],data); closeModal('ccpProfileModal'); renderProfile(); logAction('edit','تحديث بروفايل الشركة: '+clientDisplayName(data)); notify('تم حفظ بيانات الشركة.'); }
    catch(error){ notify('تعذّر حفظ بيانات الشركة.', 'err'); console.error(error); } finally{ endBusy(); }
  }

  function openUploadModal(type, replacing){
    if(!canManage(currentRole())) return;
    const form=document.getElementById('ccpUploadForm'); form.reset();
    form.dataset.replaceId=replacing ? replacing.id : '';
    form.elements.fileType.value=type || 'stamp'; form.elements.title.value=replacing?.title || '';
    document.getElementById('ccpUploadTitle').textContent=replacing?'استبدال الملف':'رفع ملف جديد';
    refreshSignatoryField(); document.getElementById('ccpUploadModal').classList.add('open');
  }
  function refreshSignatoryField(){
    const form=document.getElementById('ccpUploadForm'); const wrap=document.getElementById('ccpSignatoryField'); const select=form.elements.signatory;
    wrap.hidden=form.elements.fileType.value!=='signature';
    select.innerHTML='<option value="">بدون ربط بشخص</option>'+state.signatories.map(person=>`<option value="${esc(person.id)}">${esc(person.name)}</option>`).join('');
  }
  function validateFile(file){
    if(!file) return 'اختر ملفاً للرفع.';
    if(!ALLOWED_MIME.includes(file.type)) return 'الملفات المسموحة: PNG أو JPG أو WEBP أو PDF فقط.';
    if(file.size>MAX_FILE_SIZE) return 'حجم الملف أكبر من 15MB.';
    return '';
  }
  function cleanFileName(name){
    const ext=String(name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'') || 'bin';
    return Date.now()+'-'+Math.random().toString(36).slice(2,10)+'.'+ext;
  }
  async function saveUpload(event){
    event.preventDefault(); if(!canManage(currentRole())) return;
    const form=event.currentTarget, file=form.elements.file.files[0], problem=validateFile(file); if(problem){ notify(problem,'err'); return; }
    const type=form.elements.fileType.value;
    if(!FILE_TYPES[type]){ notify('نوع الملف غير صالح.','err'); return; }
    const previous=state.files.find(item=>item.id===form.dataset.replaceId);
    const path=`${state.selected.id}/${type}/${cleanFileName(file.name)}`;
    let uploaded=false, insertedId=null;
    try{
      startBusy();
      const {error:uploadError}=await sb.storage.from(BUCKET).upload(path,file,{contentType:file.type,cacheControl:'3600',upsert:false}); if(uploadError) throw uploadError; uploaded=true;
      const row={client_id:state.selected.id,file_type:type,title:form.elements.title.value.trim()||null,original_name:file.name,storage_path:path,mime_type:file.type,size_bytes:file.size,description:form.elements.description.value.trim()||null,uploaded_by:currentId(),metadata:{replaces:previous?.id||null},signatory_id:type==='signature'?(form.elements.signatory.value||null):null};
      const {data,error}=await sb.from('client_profile_files').insert(row).select().single(); if(error) throw error; insertedId=data.id;
      if(previous){ const {error:archiveError}=await sb.from('client_profile_files').update({is_active:false}).eq('id',previous.id); if(archiveError) throw archiveError; }
      closeModal('ccpUploadModal'); logAction(previous?'edit':'add',(previous?'استبدال ':'رفع ')+FILE_TYPES[type]+' للشركة: '+clientDisplayName(state.selected)); notify(previous?'تم استبدال الملف.':'تم رفع الملف.'); await openClient(state.selected.id,{route:false,tab:ASSET_TYPES.includes(type)?'assets':'documents'});
    }catch(error){
      if(insertedId){ try{ await sb.from('client_profile_files').update({is_active:false}).eq('id',insertedId); }catch(cleanupError){ console.warn('metadata rollback',cleanupError); } }
      if(uploaded){ try{ await sb.storage.from(BUCKET).remove([path]); }catch(cleanupError){ console.warn('upload rollback',cleanupError); } }
      notify('تعذّر حفظ الملف: '+(error.message||'خطأ غير معروف'),'err'); console.error(error);
    }finally{ endBusy(); }
  }
  async function archiveFile(file){
    if(!canArchive(currentRole()) || !confirm(`أرشفة "${file.title || FILE_TYPES[file.file_type]}"؟\nسيختفي من البروفايل دون حذف الملف نهائياً.`)) return;
    try{ startBusy(); const {error}=await sb.from('client_profile_files').update({is_active:false}).eq('id',file.id); if(error) throw error; state.files=state.files.filter(item=>item.id!==file.id); logAction('edit','أرشفة '+FILE_TYPES[file.file_type]+' للشركة: '+clientDisplayName(state.selected)); renderProfile(); notify('تمت أرشفة الملف.'); }
    catch(error){ notify('تعذّرت أرشفة الملف.','err'); console.error(error); } finally{ endBusy(); }
  }

  function openSignatoryModal(person){
    if(!canManage(currentRole())) return;
    const form=document.getElementById('ccpSignatoryForm'); form.reset(); form.dataset.id=person?.id||'';
    form.elements.name.value=person?.name||''; form.elements.title.value=person?.title||''; form.elements.phone.value=person?.phone||''; form.elements.email.value=person?.email||'';
    document.getElementById('ccpSignatoryTitle').textContent=person?'تعديل شخص مفوض':'إضافة شخص مفوض'; document.getElementById('ccpSignatoryModal').classList.add('open');
  }
  async function saveSignatory(event){
    event.preventDefault(); if(!canManage(currentRole())) return;
    const form=event.currentTarget, id=form.dataset.id, row={client_id:state.selected.id,name:form.elements.name.value.trim(),title:form.elements.title.value.trim()||null,phone:form.elements.phone.value.trim()||null,email:form.elements.email.value.trim()||null};
    if(!row.name){ notify('اسم الشخص المفوض مطلوب.','err'); return; }
    try{ startBusy(); let result; if(id) result=await sb.from('client_authorized_signatories').update(row).eq('id',id).select().single(); else result=await sb.from('client_authorized_signatories').insert(Object.assign(row,{created_by:currentId()})).select().single(); if(result.error) throw result.error; closeModal('ccpSignatoryModal'); logAction(id?'edit':'add',(id?'تعديل':'إضافة')+' شخص مفوض للشركة: '+clientDisplayName(state.selected)); notify('تم حفظ بيانات الشخص المفوض.'); await openClient(state.selected.id,{route:false,tab:'signatories'}); }
    catch(error){ notify('تعذّر حفظ الشخص المفوض.','err'); console.error(error); } finally{ endBusy(); }
  }
  async function archiveSignatory(person){
    if(!canArchive(currentRole()) || !confirm(`أرشفة الشخص المفوض "${person.name}"؟`)) return;
    try{ startBusy(); const {error}=await sb.from('client_authorized_signatories').update({active:false}).eq('id',person.id); if(error) throw error; state.signatories=state.signatories.filter(item=>item.id!==person.id); renderProfile(); notify('تمت أرشفة الشخص المفوض.'); }
    catch(error){ notify('تعذّرت أرشفة الشخص المفوض.','err'); console.error(error); } finally{ endBusy(); }
  }

  function closeModal(id){ document.getElementById(id)?.classList.remove('open'); }
  function injectModals(){
    if(document.getElementById('ccpProfileModal')) return;
    const host=document.createElement('div'); host.innerHTML=`
      <div class="ccp-modal" id="ccpProfileModal"><div class="ccp-dialog"><div class="ccp-modal-head"><h3>تعديل بيانات الشركة</h3><button class="ccp-close" type="button">×</button></div><form id="ccpProfileForm"><div class="ccp-modal-body"><div class="ccp-form-grid">
        <div class="ccp-field full"><label>الاسم المسجل *</label><input name="name" required></div><div class="ccp-field"><label>الاسم بالعربية</label><input name="nameAr"></div><div class="ccp-field"><label>الاسم بالإنجليزية</label><input name="nameEn" dir="ltr"></div><div class="ccp-field"><label>الهاتف</label><input name="phone" dir="ltr"></div><div class="ccp-field"><label>البريد الإلكتروني</label><input name="email" type="email" dir="ltr"></div><div class="ccp-field"><label>الدولة</label><input name="country"></div><div class="ccp-field"><label>الموقع الإلكتروني</label><input name="website" dir="ltr"></div><div class="ccp-field"><label>رقم الرخصة التجارية</label><input name="license"></div><div class="ccp-field"><label>الرقم الضريبي</label><input name="tax"></div><div class="ccp-field full"><label>العنوان</label><textarea name="address"></textarea></div><div class="ccp-field full"><label>ملاحظات</label><textarea name="note"></textarea></div>
      </div></div><div class="ccp-modal-foot"><button class="ccp-btn primary" type="submit">حفظ البيانات</button><button class="ccp-btn ccp-cancel" type="button">إلغاء</button></div></form></div></div>
      <div class="ccp-modal" id="ccpUploadModal"><div class="ccp-dialog"><div class="ccp-modal-head"><h3 id="ccpUploadTitle">رفع ملف جديد</h3><button class="ccp-close" type="button">×</button></div><form id="ccpUploadForm"><div class="ccp-modal-body"><div class="ccp-form-grid">
        <div class="ccp-field"><label>نوع الملف *</label><select name="fileType">${Object.entries(FILE_TYPES).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></div><div class="ccp-field"><label>العنوان</label><input name="title" placeholder="عنوان واضح للملف"></div><div class="ccp-field full" id="ccpSignatoryField" hidden><label>الشخص المفوض المرتبط</label><select name="signatory"></select></div><div class="ccp-field full"><label>وصف اختياري</label><textarea name="description"></textarea></div><div class="ccp-field full"><label>الملف *</label><input name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" required><div class="ccp-help">PNG أو JPG أو WEBP أو PDF، بحد أقصى 15MB.</div></div>
      </div></div><div class="ccp-modal-foot"><button class="ccp-btn primary" type="submit">رفع وحفظ</button><button class="ccp-btn ccp-cancel" type="button">إلغاء</button></div></form></div></div>
      <div class="ccp-modal" id="ccpSignatoryModal"><div class="ccp-dialog"><div class="ccp-modal-head"><h3 id="ccpSignatoryTitle">إضافة شخص مفوض</h3><button class="ccp-close" type="button">×</button></div><form id="ccpSignatoryForm"><div class="ccp-modal-body"><div class="ccp-form-grid"><div class="ccp-field full"><label>الاسم *</label><input name="name" required></div><div class="ccp-field"><label>المسمى الوظيفي</label><input name="title"></div><div class="ccp-field"><label>الهاتف</label><input name="phone" dir="ltr"></div><div class="ccp-field full"><label>البريد الإلكتروني</label><input name="email" type="email" dir="ltr"></div></div></div><div class="ccp-modal-foot"><button class="ccp-btn primary" type="submit">حفظ</button><button class="ccp-btn ccp-cancel" type="button">إلغاء</button></div></form></div></div>
      <div class="ccp-modal" id="ccpPreviewModal"><div class="ccp-dialog ccp-preview-dialog"><div class="ccp-modal-head"><h3 id="ccpPreviewTitle">معاينة الملف</h3><button class="ccp-close" type="button">×</button></div><div class="ccp-preview-body" id="ccpPreviewBody"></div></div></div>`;
    while(host.firstChild) document.body.appendChild(host.firstChild);
    document.querySelectorAll('.ccp-modal').forEach(modal=>{ modal.querySelector('.ccp-close')?.addEventListener('click',()=>modal.classList.remove('open')); modal.querySelector('.ccp-cancel')?.addEventListener('click',()=>modal.classList.remove('open')); modal.addEventListener('click',event=>{ if(event.target===modal) modal.classList.remove('open'); }); });
    document.getElementById('ccpProfileForm').addEventListener('submit',saveProfile);
    document.getElementById('ccpUploadForm').addEventListener('submit',saveUpload);
    document.getElementById('ccpUploadForm').elements.fileType.addEventListener('change',refreshSignatoryField);
    document.getElementById('ccpSignatoryForm').addEventListener('submit',saveSignatory);
  }

  async function open(){
    if(!canRead(currentRole())) return;
    injectModals();
    const route=typeof parseHash==='function'?parseHash():{};
    const desiredId=route.v==='clientProfiles' ? route.id : '';
    if(state.selected) renderProfile();
    else try{ await loadClients(); if(desiredId && state.selected?.id!==desiredId) await openClient(desiredId); }catch(error){ console.error(error); const box=rootEl(); if(box) box.innerHTML=`<div class="ccp-shell"><div class="ccp-empty"><b>تعذّر تحميل بروفايلات الشركات</b>${esc(error.message||'حاول مرة أخرى.')}</div></div>`; }
  }
  function init(){
    injectModals();
    const route=typeof parseHash==='function'?parseHash():{};
    if(typeof currentUser!=='undefined' && currentUser && route.v==='clientProfiles') open().then(()=>{ if(route.id) openClient(route.id,{route:false}); });
  }
  if(typeof document!=='undefined'){
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
    root.addEventListener?.('jahez:session-ready',()=>{ const route=typeof parseHash==='function'?parseHash():{}; if(route.v==='clientProfiles') open().then(()=>{ if(route.id) openClient(route.id,{route:false}); }); });
  }
  return Object.freeze({BUCKET,MAX_FILE_SIZE,ALLOWED_MIME,FILE_TYPES,ASSET_TYPES,DOCUMENT_TYPES,READ_ROLES,WRITE_ROLES,canRead,canManage,canArchive,canAccessFile,summarizeClient,clientDisplayName,validateFile,open,openClient});
});
