/* Experimental, read-only collection lab. It never writes to Supabase. */
const SB_URL = 'https://vthcmqqiexaedukduquv.supabase.co';
const SB_KEY = 'sb_publishable_kYEMmAQ2KTETIabDTMz2ig_fNB8vo02';
const sb = supabase.createClient(SB_URL, SB_KEY, {auth:{storageKey:'shipdocs-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
const $ = id => document.getElementById(id);
const AUTH_RETURN_PATH_KEY = 'jahez:auth-return-path';
const state = {shipments:[], payments:{}, selected:new Set(), overrides:{}, preview:'letter', activeOperationNo:'', tradeFile:null, convertToAed:false, exchangeRate:3.6725, settings:{collectionDate:new Date().toISOString().slice(0,10),remittingBank:'Abu Dhabi Islamic Bank',remittingBankLetterAddress:'Abu Dhabi, UAE',remittingBankAddress:'BANIYAS BRANCH BUILDING, 2ND FLOOR, BANIYAS EAST, P.O.BOX 313, ABU DHABI, UAE.',remittingBankAccountNo:'19567664',collectingBank:'SAUDI SUDANESE BANK',collectingBankAddress:'MAIN BRANCH, FREE ZONE AREA, PORT SUDAN, SUDAN',billOfLadingType:'Copy of  Original Bill of Lading',billBy:'KINDLY SEND SWIFT MESSAGE TO COLLECTING BANK FOR DOCS AND SHARE SWIFT COPY WITH US.',term:'D/A 90 DAYS FROM BILL OF EXCHANGE DATE.',drawer:'BAHAR SWAKEN GENERAL TRADING LLC',authorizedPerson:'JAWAD ELMASRI',title:'MANAGER',draweeAddress:''}};
const requestedTradeFileId = new URLSearchParams(location.search).get('tradeFileId');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const collectionListStorageKey = 'bsCollectionDataLists';
const collectionTextOffsetStorageKey = 'bsCollectionTextOffsets';
const collectionTextBlockOffsetStorageKey = 'bsCollectionTextBlockOffsets';
const collectionTextStyleStorageKey = 'bsCollectionTextStyles';
const collectionTextLayerStorageKey = 'bsCollectionTextLayers';
const remittingSubmissionStorageKey = 'bsCollectionRemittingSubmissions';
const sectionCollapseStorageKey = 'bsCollectionSectionCollapsed';
const stampTransformStorageKey = 'bsCollectionStampTransformA4';
const collectionDocumentEditorMetaStorageKey = 'bsCollectionDocumentEditorMetaV1';
const collectionDocumentLabels = {
  // Add future generated documents here; QR inclusion stays opt-in and is off
  // for all commercial-collection documents by design.
  letter:{title:'خطاب التحصيل',subtitle:'Collection Letter',icon:'envelope',enabled:true,qrIncluded:false},
  undertaking:{title:'خطاب التعهد',subtitle:'Undertaking Letter',icon:'check-shield',enabled:true,qrIncluded:false},
  exchange:{title:'الكمبيالة',subtitle:'Bill of Exchange',icon:'receipt',enabled:true,qrIncluded:false}
};
const collectionDocumentKinds = () => Object.entries(collectionDocumentLabels).filter(([,document])=>document.enabled).map(([kind])=>kind);
function createCollectionOperationNo(now=new Date()){
  const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('');
  const time=[String(now.getHours()).padStart(2,'0'),String(now.getMinutes()).padStart(2,'0'),String(now.getSeconds()).padStart(2,'0')].join('');
  return `TC-${date}-${time}-${String(now.getMilliseconds()).padStart(3,'0')}`;
}
function collectionShipmentSnapshot(shipment){
  return Object.fromEntries(['shipmentNo','operationNo','invoiceNo','invoiceDate','billNo','totalAmount','consignee','consigneeAddress','itemDesc'].map(key=>[key,shipment[key]??'']));
}
const portalSectionNames = ['picker-section','draft-section','settings-section','preview-section','collection-portal-section'];
const portalRoleLabels = {admin:'مدير النظام',editor:'محرر',staff:'موظف',viewer:'مشاهد',bsgt_user:'مستخدم BSGT'};
let textBlockEditMode = false;
let selectedTextBlock = null;
let selectedTextStyle = null;
let remittingBatches = [];
let portalRole = '';
let sharedCollectionBranding = {};
let layoutHistory = [];
let layoutRedoHistory = [];
let restoringLayoutHistory = false;
let portalLogoutRequested = false;
const dirtyDocumentLayouts = new Set();
const layoutHistoryKeys = [collectionTextOffsetStorageKey, collectionTextBlockOffsetStorageKey, collectionTextStyleStorageKey, collectionTextLayerStorageKey, stampTransformStorageKey];
function layoutSnapshot(){ return Object.fromEntries(layoutHistoryKeys.map(key=>[key,localStorage.getItem(key)])); }
function updateLayoutHistoryControls(){
  const undo=$('undoLayoutBtn'), redo=$('redoLayoutBtn');
  if(undo) undo.disabled=!layoutHistory.length;
  if(redo) redo.disabled=!layoutRedoHistory.length;
}
function recordLayoutHistory(){
  if(restoringLayoutHistory||portalRole!=='admin') return;
  const snapshot=layoutSnapshot();
  const previous=layoutHistory.at(-1);
  if(previous&&JSON.stringify(previous)===JSON.stringify(snapshot)) return;
  layoutHistory.push(snapshot);
  if(layoutHistory.length>40) layoutHistory.shift();
  layoutRedoHistory=[];
  updateLayoutHistoryControls();
}
function restoreLayoutSnapshot(snapshot){
  restoringLayoutHistory=true;
  Object.entries(snapshot).forEach(([key,value])=>{ if(value===null) localStorage.removeItem(key); else localStorage.setItem(key,value); });
  restoringLayoutHistory=false;
  markDocumentLayoutDirty();
  renderPreview();
  updateLayoutHistoryControls();
}
function undoLayout(){
  if(!layoutHistory.length) return;
  layoutRedoHistory.push(layoutSnapshot());
  restoreLayoutSnapshot(layoutHistory.pop());
}
function redoLayout(){
  if(!layoutRedoHistory.length) return;
  layoutHistory.push(layoutSnapshot());
  restoreLayoutSnapshot(layoutRedoHistory.pop());
}
function documentEditorMeta(){ try { return JSON.parse(localStorage.getItem(collectionDocumentEditorMetaStorageKey)||'{}')||{}; } catch (_) { return {}; } }
function savedAtLabel(value){
  if(!value) return 'لم يتم الحفظ يدوياً بعد';
  try { return `آخر حفظ: ${new Intl.DateTimeFormat('ar-AE',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))}`; }
  catch (_) { return 'تم حفظ إعدادات المستند'; }
}
function updateDocumentEditorState(){
  const info=collectionDocumentLabels[state.preview]||collectionDocumentLabels.letter;
  if($('activeDocumentTitle')) $('activeDocumentTitle').textContent=info.title;
  if($('previewFocusTitle')) $('previewFocusTitle').textContent=`معاينة ${info.title}`;
  const status=$('documentSaveStatus');
  if(status){
    const dirty=dirtyDocumentLayouts.has(state.preview);
    status.textContent=dirty?'توجد تعديلات بعد آخر حفظ':savedAtLabel(documentEditorMeta()[state.preview]?.savedAt);
    status.classList.toggle('is-dirty',dirty);
  }
  document.querySelectorAll('[data-preview]').forEach(button=>button.classList.toggle('active',button.dataset.preview===state.preview));
}
function markDocumentLayoutDirty(){ dirtyDocumentLayouts.add(state.preview); updateDocumentEditorState(); }
function saveCurrentDocumentLayout(){
  if(portalRole!=='admin') return;
  const meta=documentEditorMeta();
  meta[state.preview]={savedAt:new Date().toISOString()};
  try { localStorage.setItem(collectionDocumentEditorMetaStorageKey,JSON.stringify(meta)); }
  catch (_) { alert('تعذّر حفظ إعدادات المستند على هذا الجهاز.'); return; }
  dirtyDocumentLayouts.delete(state.preview);
  updateDocumentEditorState();
  const button=$('saveDocumentLayoutBtn');
  if(button){
    const original=button.innerHTML;
    button.innerHTML='<i class="bx bx-check"></i> تم حفظ المستند';
    button.classList.add('is-saved');
    setTimeout(()=>{ button.innerHTML=original; button.classList.remove('is-saved'); },1600);
  }
}
const collectionListFields = {
  remittingBank:{label:'البنك المُرسِل',defaults:['Abu Dhabi Islamic Bank']}, remittingBankLetterAddress:{label:'عنوان بنك الإرسال للخطاب',defaults:['Abu Dhabi, UAE']}, remittingBankAddress:{label:'عنوان بنك الإرسال للتعهد',defaults:['BANIYAS BRANCH BUILDING, 2ND FLOOR, BANIYAS EAST, P.O.BOX 313, ABU DHABI, UAE.']}, remittingBankAccountNo:{label:'رقم حساب بنك الإرسال',defaults:['19567664']}, collectingBankProfile:{label:'بنك التحصيل وعنوانه',paired:true,defaults:[{bank:'SAUDI SUDANESE BANK',address:'MAIN BRANCH, FREE ZONE AREA, PORT SUDAN, SUDAN'}]},
  billOfLadingType:{label:'نوع بوليصة الشحن',defaults:['Copy of  Original Bill of Lading']},
  billBy:{label:'تعليمات Bill By',defaults:['Kindly send SWIFT message to collecting bank for docs and share SWIFT copy with us.']},
  term:{label:'شرط الدفع',defaults:['D/A 90 DAYS FROM BILL OF EXCHANGE DATE.']}, drawer:{label:'المُصدّر / Drawer',defaults:['BAHAR SWAKEN GENERAL TRADING LLC']},
  authorizedPerson:{label:'الشخص المفوض',defaults:['JAWAD ELMASRI']}, title:{label:'المنصب',defaults:['MANAGER']}, draweeAddress:{label:'عنوان المستورد',defaults:[]}
};
let collectionLists = {};
const collectingBankProfileKey = profile => `${profile.bank}|||${profile.address}`;
const normalizedCollectingBankProfile = value => ({bank:String(value?.bank||'').trim(),address:String(value?.address||'').trim()});
function loadCollectionLists(){
  let saved={}; try { saved=JSON.parse(localStorage.getItem(collectionListStorageKey)||'{}')||{}; } catch (_) {}
  collectionLists=Object.fromEntries(Object.entries(collectionListFields).map(([key,field])=>{
    if(field.paired){
      const legacyBanks=Array.isArray(saved.collectingBank)?saved.collectingBank:[];
      const legacyAddresses=Array.isArray(saved.collectingBankAddress)?saved.collectingBankAddress:[];
      const savedProfiles=Array.isArray(saved[key])?saved[key]:legacyBanks.map((bank,index)=>({bank,address:legacyAddresses[index]||''}));
      const profiles=[...(field.defaults||[]),...savedProfiles].map(normalizedCollectingBankProfile).filter(profile=>profile.bank);
      return [key,profiles.filter((profile,index,list)=>list.findIndex(item=>collectingBankProfileKey(item)===collectingBankProfileKey(profile))===index)];
    }
    return [key,[...new Set([...(field.defaults||[]),...((saved[key]||[]).filter(Boolean))])]];
  }));
}
function saveCollectionLists(){ try { localStorage.setItem(collectionListStorageKey,JSON.stringify(collectionLists)); } catch (_) {} }
function loadRemittingBatches(){ try { remittingBatches=JSON.parse(localStorage.getItem(remittingSubmissionStorageKey)||'[]')||[]; } catch (_) { remittingBatches=[]; } }
function saveRemittingBatches(){ try { localStorage.setItem(remittingSubmissionStorageKey,JSON.stringify(remittingBatches)); } catch (_) {} }
function setPortalUserProfile(user, profile){
  const name=profile?.display_name||user?.email?.split('@')[0]||'زائر';
  portalRole=profile?.role||'';
  document.body.classList.toggle('role-bsgt-portal-user',portalRole==='bsgt_user');
  document.body.classList.toggle('role-collection-preview-only',portalRole!=='admin');
  const role=portalRoleLabels[profile?.role]||'الحساب الحالي';
  $('portalUserName').textContent=name;
  $('portalUserRole').textContent=role;
  const avatar=$('portalUserAvatar'), photo=profile?.photo_url;
  avatar.innerHTML=photo?`<img src="${esc(photo)}" alt="">`:`<span>${esc(name.trim().slice(0,1).toUpperCase()||'U')}</span>`;
}
function setPortalBrand(branding){
  const image=$('portalBrandImage'), icon=$('portalBrandIcon');
  if(branding?.iconImg){ image.src=branding.iconImg; image.hidden=false; icon.hidden=true; return; }
  image.removeAttribute('src'); image.hidden=true; icon.hidden=false;
  icon.className=`bx bx-${branding?.icon||'ship'}`;
}
function rememberPortalLocation(){
  try{ sessionStorage.setItem(AUTH_RETURN_PATH_KEY, location.pathname + location.search + location.hash); }catch(error){}
}
function redirectPortalToLogin(){
  rememberPortalLocation();
  window.location.replace('/?login=1');
}
function denyPortalAccess(){
  const message='ليس لديك صلاحية للوصول إلى هذه البوابة.';
  try{ sessionStorage.setItem(window.JahezPortalAccess?.ACCESS_MESSAGE_KEY||'jahez:portal-access-message',message); }catch(error){}
  window.location.replace('/#v=dashboard');
}
async function restorePortalSession(attempts=3){
  return window.JahezSessionNavigation.restoreSession(sb,{attempts});
}
async function loadPortalHeader(user){
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    const [{data:profile,error:profileError}, {data:branding,error:brandingError}]=await Promise.all([
      sb.from('profiles').select('display_name, role, photo_url, active').eq('id',user.id).maybeSingle(),
      sb.from('settings').select('value').eq('key','branding').maybeSingle()
    ]);
    if(!profileError){
      if(brandingError) console.warn('portal branding',brandingError);
      if(profile?.role==='admin'){
        return {
          profile,
          branding:branding?.value,
          permissions:{portalKeys:Object.keys(window.JahezPortalAccess?.PORTALS||{})}
        };
      }

      const permissionResult=await sb.rpc('get_user_portal_permissions',{p_user_id:user.id});
      if(!permissionResult.error){
        const portalKeys=(permissionResult.data||[])
          .filter(row=>row.can_view!==false)
          .map(row=>row.portal_key);
        return {profile, branding:branding?.value, permissions:{portalKeys}};
      }
      lastError=permissionResult.error;
    }else{
      lastError=profileError;
    }
    if(attempt<2) await new Promise(resolve=>setTimeout(resolve,450*(attempt+1)));
  }
  throw lastError;
}

function showPortalSessionRecovery(error){
  console.warn('collection portal session recovery',error);
  const loader=$('portalAccessLoader');
  if(!loader) return;
  loader.innerHTML='<strong>تعذر تحديث الجلسة مؤقتاً.</strong><small>لم يتم تسجيل خروجك. تحقق من الشبكة ثم أعد المحاولة.</small><button type="button" id="portalSessionRetry">إعادة المحاولة</button>';
  $('portalSessionRetry')?.addEventListener('click',()=>location.reload(),{once:true});
}
function localCollectionBrandingSettings(){
  try { return JSON.parse(localStorage.getItem('baharSwakenInvoicePreviewSettings') || '{}'); }
  catch (_) { return {}; }
}
async function loadSharedCollectionBranding(company){
  const remote=Object.assign({},company?.settings?.collectionBranding||{});
  const local=localCollectionBrandingSettings();
  const hasLocalAssets=Boolean(local.background||local.stamp||local.signature);
  sharedCollectionBranding=remote;
  // The existing admin browser is the migration source for the original A4 artwork.
  if(portalRole==='admin' && hasLocalAssets){
    const merged=Object.assign({},remote,local);
    sharedCollectionBranding=merged;
    if(JSON.stringify(remote)!==JSON.stringify(merged)){
      const settings=Object.assign({},company.settings||{}, {collectionBranding:merged,invoiceBranding:merged});
      const {error}=await sb.from('companies').update({settings}).eq('id',company.id);
      if(error) console.warn('collection branding sync',error);
    }
  }
}
async function logoutPortal(){
  const button=$('portalLogoutBtn');
  if(!confirm('تسجيل الخروج من النظام؟')) return;
  button.disabled=true;
  portalLogoutRequested=true;
  try{ sessionStorage.removeItem(AUTH_RETURN_PATH_KEY); }catch(error){}
  try{
    const {error}=await sb.auth.signOut();
    if(error) throw error;
    window.location.assign('/');
  }catch(error){
    portalLogoutRequested=false;
    button.disabled=false;
    alert(`تعذّر تسجيل الخروج: ${error.message||error}`);
  }
}
function showCollectionNotice(message){ const notice=$('collectionNotice'); if(!notice) return; notice.textContent=message; notice.hidden=false; }
function sectionCollapseState(){ try { return JSON.parse(localStorage.getItem(sectionCollapseStorageKey)||'{}')||{}; } catch (_) { return {}; } }
function setSectionCollapsed(sectionName, collapsed){
  const section=document.querySelector(`.${sectionName}`), button=document.querySelector(`[data-collapse-section="${sectionName}"]`); if(!section||!button) return;
  section.classList.toggle('section-is-collapsed',collapsed);
  button.setAttribute('aria-expanded',String(!collapsed));
  button.title=collapsed?'فتح القسم':'طي القسم';
  button.setAttribute('aria-label',button.title);
  button.innerHTML=collapsed?'<i class="bx bx-chevron-down"></i>':'<i class="bx bx-chevron-up"></i>';
  const state=sectionCollapseState(); state[sectionName]=collapsed;
  try { localStorage.setItem(sectionCollapseStorageKey,JSON.stringify(state)); } catch (_) {}
  renderPortalStepGrid();
}
function renderPortalStepGrid(){
  document.querySelectorAll('[data-step-section]').forEach(card=>{
    const sectionName=card.dataset.stepSection, section=document.querySelector(`.${sectionName}`);
    const isActive=Boolean(section&&!section.classList.contains('section-is-collapsed'));
    card.classList.toggle('is-active',isActive);
    card.setAttribute('aria-current',isActive?'step':'false');
    const source=section?.querySelector('.section-heading > p');
    const description=card.querySelector('[data-step-description]');
    if(source&&description) description.textContent=source.textContent.trim();
  });
}
function openPortalSection(sectionName){
  portalSectionNames.forEach(name=>setSectionCollapsed(name,name!==sectionName));
  renderPortalStepGrid();
  document.querySelector(`.${sectionName}`)?.scrollIntoView({behavior:'smooth',block:'start'});
}
function collectionTextOffsets(){ try { return JSON.parse(localStorage.getItem(collectionTextOffsetStorageKey)||'{}')||{}; } catch (_) { return {}; } }
function textOffsetForPreview(){ return Object.assign({x:0,y:0,scale:100}, collectionTextOffsets()[state.preview]||{}); }
function updateTextOffsetControls(){
  const x=$('textOffsetX'), y=$('textOffsetY'); if(!x||!y) return;
  const offset=textOffsetForPreview(); x.value=offset.x; y.value=offset.y;
  $('textOffsetXValue').textContent=`${offset.x} mm`;
  $('textOffsetYValue').textContent=`${offset.y} mm`;
  if($('documentTextScale')) $('documentTextScale').value=offset.scale;
  if($('documentTextScaleValue')) $('documentTextScaleValue').textContent=`${offset.scale}%`;
}
function saveTextOffset(axis, value){
  recordLayoutHistory();
  const offsets=collectionTextOffsets(), current=Object.assign({x:0,y:0,scale:100},offsets[state.preview]||{});
  current[axis]=Number(value)||0; offsets[state.preview]=current;
  try { localStorage.setItem(collectionTextOffsetStorageKey,JSON.stringify(offsets)); } catch (_) {}
  markDocumentLayoutDirty();
  renderPreview();
}
function collectionTextBlockOffsets(){ try { return JSON.parse(localStorage.getItem(collectionTextBlockOffsetStorageKey)||'{}')||{}; } catch (_) { return {}; } }
function textBlockOffset(preview, index){ return Object.assign({x:0,y:0}, collectionTextBlockOffsets()[preview]?.[index]||{}); }
function saveTextBlockOffset(preview, index, offset){
  recordLayoutHistory();
  const offsets=collectionTextBlockOffsets(); offsets[preview]=offsets[preview]||{}; offsets[preview][index]=offset;
  try { localStorage.setItem(collectionTextBlockOffsetStorageKey,JSON.stringify(offsets)); } catch (_) {}
  markDocumentLayoutDirty();
}
function collectionTextStyles(){ try { return JSON.parse(localStorage.getItem(collectionTextStyleStorageKey)||'{}')||{}; } catch (_) { return {}; } }
function collectionTextLayers(){ try { return JSON.parse(localStorage.getItem(collectionTextLayerStorageKey)||'{}')||{}; } catch (_) { return {}; } }
function textLayerFor(preview,index){ return Object.assign({hidden:false,zIndex:index+1},collectionTextLayers()[preview]?.[index]||{}); }
function saveTextLayer(preview,index,layer){
  recordLayoutHistory();
  const layers=collectionTextLayers(); layers[preview]=layers[preview]||{}; layers[preview][index]=layer;
  try { localStorage.setItem(collectionTextLayerStorageKey,JSON.stringify(layers)); } catch (_) {}
  markDocumentLayoutDirty();
}
function textLayerLabel(block,index){
  const label=block.matches('table')?'جدول':block.matches('h1,h2,h3')?'عنوان':(block.innerText||block.textContent||'نص').replace(/\s+/g,' ').trim();
  return `${index+1}. ${label.slice(0,42)||'طبقة نص'}`;
}
function ensureTextLayerControls(){
  $('undoLayoutBtn')?.addEventListener('click',undoLayout);
  $('redoLayoutBtn')?.addEventListener('click',redoLayout);
  $('selectParagraphForArrowsBtn')?.addEventListener('click',()=>{
    if(!selectedTextBlock||selectedTextBlock.preview!==state.preview){ alert('اختر الفقرة أولاً من الورقة أو من طبقات النص.'); return; }
    selectedTextStyle={preview:state.preview,id:`block-${selectedTextBlock.index}`};
    textBlockEditMode=true;
    renderPreview();
  });
  $('resetCurrentPreviewBtn')?.addEventListener('click',resetCurrentPreviewLayout);
  $('textLayersPanel')?.addEventListener('click',event=>{
    if(portalRole!=='admin') return;
    const button=event.target.closest('button[data-layer-action]'); if(!button) return;
    const index=Number(button.dataset.layerIndex); if(!Number.isFinite(index)) return;
    const action=button.dataset.layerAction;
    if(action==='select'){
      selectedTextBlock={preview:state.preview,index}; selectedTextStyle={preview:state.preview,id:`block-${index}`}; textBlockEditMode=true;
    }else if(action==='toggle'){
      const layer=textLayerFor(state.preview,index); layer.hidden=!layer.hidden; saveTextLayer(state.preview,index,layer);
    }else if(action==='move'){
      const offset=textBlockOffset(state.preview,index); offset.y+=(button.dataset.direction==='up'?-2:2); saveTextBlockOffset(state.preview,index,offset);
      selectedTextBlock={preview:state.preview,index}; selectedTextStyle={preview:state.preview,id:`block-${index}`};
    }else if(action==='front'||action==='back'){
      const values=[...document.querySelectorAll('#documentPreview [data-text-block]')].map(block=>Number(block.dataset.textBlock)).filter(layerIndex=>layerIndex!==index).map(layerIndex=>textLayerFor(state.preview,layerIndex).zIndex);
      const layer=textLayerFor(state.preview,index); layer.zIndex=action==='front'?Math.max(index+1,...values)+1:Math.min(index+1,...values)-1; saveTextLayer(state.preview,index,layer);
    }
    renderPreview();
  });
  updateLayoutHistoryControls();
}
function renderTextLayers(content){
  const panel=$('textLayersPanel'); if(!panel) return;
  if(portalRole!=='admin'){ panel.innerHTML=''; return; }
  const blocks=[...content.querySelectorAll('[data-text-block]')];
  panel.innerHTML=blocks.length?blocks.map(block=>{
    const index=Number(block.dataset.textBlock),layer=textLayerFor(state.preview,index),selected=selectedTextBlock?.preview===state.preview&&selectedTextBlock.index===index;
    return `<div class="text-layer-row ${selected?'is-selected':''} ${layer.hidden?'is-hidden':''}"><button type="button" class="layer-eye" data-layer-action="toggle" data-layer-index="${index}" title="${layer.hidden?'إظهار':'إخفاء'} الطبقة"><i class="bx bx-${layer.hidden?'hide':'show'}"></i></button><button type="button" class="layer-name" data-layer-action="select" data-layer-index="${index}" title="اختيار الطبقة وتحريكها بالأسهم">${esc(textLayerLabel(block,index))}</button><span class="layer-actions"><button type="button" data-layer-action="move" data-direction="up" data-layer-index="${index}" title="تحريك لأعلى"><i class="bx bx-up-arrow-alt"></i></button><button type="button" data-layer-action="move" data-direction="down" data-layer-index="${index}" title="تحريك لأسفل"><i class="bx bx-down-arrow-alt"></i></button><button type="button" data-layer-action="front" data-layer-index="${index}" title="تقديم أمام الطبقات"><i class="bx bx-chevrons-up"></i></button><button type="button" data-layer-action="back" data-layer-index="${index}" title="إرسال خلف الطبقات"><i class="bx bx-chevrons-down"></i></button></span></div>`;
  }).join(''):'<p>لا توجد طبقات نص في هذا المستند.</p>';
}
function renderTextCompare(content){
  const panel=$('textComparePanel'); if(!panel) return;
  if(portalRole!=='admin'){ panel.innerHTML=''; return; }
  const index=selectedTextBlock?.preview===state.preview?selectedTextBlock.index:null;
  const block=index===null?null:content.querySelector(`[data-text-block="${index}"]`);
  if(!block){ panel.innerHTML='<p>اختر طبقة من القائمة أو من المستند لعرض النص.</p>'; return; }
  const original=(block.dataset.originalText||block.innerText||'').trim();
  const current=(block.innerText||'').trim();
  panel.innerHTML=`<div class="text-compare-columns"><section><strong>الأصلي</strong><pre>${esc(original)}</pre></section><section><strong>المعاينة</strong><pre>${esc(current)}</pre></section></div><small>${original===current?'التعديل الحالي على الموضع أو التنسيق فقط.':'هناك اختلاف في النص المعروض.'}</small>`;
}
function textStyleFor(preview, id){
  return Object.assign({weight:'',size:0,fontSize:0,fontFamily:'',fontStyle:'',textDecoration:'',textAlign:'',lineHeight:0,letterSpacing:null,marginTop:null,marginBottom:null,x:0,y:0},collectionTextStyles()[preview]?.[id]||{});
}
function saveTextStyle(preview, id, style){
  recordLayoutHistory();
  const styles=collectionTextStyles(); styles[preview]=styles[preview]||{}; styles[preview][id]=style;
  try { localStorage.setItem(collectionTextStyleStorageKey,JSON.stringify(styles)); } catch (_) {}
  markDocumentLayoutDirty();
}
function applyTextStyle(node){
  const style=textStyleFor(state.preview,node.dataset.textStyleId);
  node.style.fontWeight=style.weight||'';
  node.style.fontSize=style.fontSize?`${style.fontSize}px`:(style.size?`calc(1em + ${style.size}px)`:'');
  node.style.fontFamily=style.fontFamily||'';
  node.style.fontStyle=style.fontStyle||'';
  node.style.textDecoration=style.textDecoration||'';
  node.style.textAlign=style.textAlign||'';
  node.style.lineHeight=style.lineHeight||'';
  node.style.letterSpacing=Number.isFinite(style.letterSpacing)?`${style.letterSpacing}px`:'';
  node.style.marginTop=Number.isFinite(style.marginTop)?`${style.marginTop}px`:'';
  node.style.marginBottom=Number.isFinite(style.marginBottom)?`${style.marginBottom}px`:'';
  if(!node.dataset.textBlock){
    node.style.display=style.x||style.y?'inline-block':'';
    node.style.transform=style.x||style.y?`translate(${style.x}px, ${style.y}px)`:'';
  }
}
function selectedTextNode(){
  if(!selectedTextStyle||selectedTextStyle.preview!==state.preview) return null;
  return [...document.querySelectorAll('#documentPreview [data-text-style-id]')].find(node=>node.dataset.textStyleId===selectedTextStyle.id)||null;
}
function selectedTextPosition(){
  if(!selectedTextStyle||selectedTextStyle.preview!==state.preview) return {x:0,y:0};
  const blockId=`block-${selectedTextBlock?.index}`;
  return selectedTextStyle.id===blockId?textBlockOffset(state.preview,selectedTextBlock.index):textStyleFor(state.preview,selectedTextStyle.id);
}
function updateTextStyleControls(){
  const enabled=Boolean(selectedTextStyle&&selectedTextStyle.preview===state.preview);
  const controlIds=['textStyleNormalBtn','textStyleBoldBtn','textStyleItalicBtn','textStyleUnderlineBtn','textStyleSmallerBtn','textStyleLargerBtn','textFontFamily','textFontSize','textFontWeight','textAlignment','textLineHeight','textLetterSpacing','textMarginTop','textMarginBottom','selectedTextX','selectedTextY'];
  controlIds.forEach(id=>{ if($(id)) $(id).disabled=!enabled; });
  const hint=$('editorSelectionHint');
  if(!enabled){
    if(hint) hint.textContent='فعّل التحديد ثم اختر فقرة من الورقة';
    ['textFontFamily','textFontSize','textFontWeight','textAlignment','textLineHeight','textLetterSpacing','textMarginTop','textMarginBottom','selectedTextX','selectedTextY'].forEach(id=>{ if($(id)) $(id).value=''; });
    return;
  }
  const style=textStyleFor(state.preview,selectedTextStyle.id), node=selectedTextNode(), position=selectedTextPosition();
  if(hint){
    const block=node?.closest('[data-text-block]');
    hint.textContent=block?textLayerLabel(block,Number(block.dataset.textBlock)):'تم اختيار النص';
  }
  $('textFontFamily').value=style.fontFamily||'';
  $('textFontSize').value=style.fontSize||'';
  $('textFontSize').placeholder=node?`${Math.round(parseFloat(getComputedStyle(node).fontSize)*10)/10} px`:'px';
  $('textFontWeight').value=style.weight||'';
  $('textAlignment').value=style.textAlign||'';
  $('textLineHeight').value=style.lineHeight||'';
  $('textLetterSpacing').value=Number.isFinite(style.letterSpacing)?style.letterSpacing:'';
  $('textMarginTop').value=Number.isFinite(style.marginTop)?style.marginTop:'';
  $('textMarginBottom').value=Number.isFinite(style.marginBottom)?style.marginBottom:'';
  $('selectedTextX').value=Math.round((Number(position.x)||0)*10)/10;
  $('selectedTextY').value=Math.round((Number(position.y)||0)*10)/10;
  $('textStyleBoldBtn').classList.toggle('is-active',style.weight==='700');
  $('textStyleItalicBtn').classList.toggle('is-active',style.fontStyle==='italic');
  $('textStyleUnderlineBtn').classList.toggle('is-active',style.textDecoration==='underline');
}
function setSelectedTextStyle(change){
  if(!selectedTextStyle||selectedTextStyle.preview!==state.preview) return;
  const style=Object.assign(textStyleFor(selectedTextStyle.preview,selectedTextStyle.id),change);
  saveTextStyle(selectedTextStyle.preview,selectedTextStyle.id,style);
  renderPreview();
}
function resetSelectedTextFormatting(){
  if(!selectedTextStyle||selectedTextStyle.preview!==state.preview) return;
  recordLayoutHistory();
  const styles=collectionTextStyles();
  if(styles[state.preview]) delete styles[state.preview][selectedTextStyle.id];
  try { localStorage.setItem(collectionTextStyleStorageKey,JSON.stringify(styles)); } catch (_) {}
  markDocumentLayoutDirty();
  renderPreview();
}
function setSelectedPosition(axis,value){
  if(!selectedTextStyle||!selectedTextBlock||selectedTextStyle.preview!==state.preview) return;
  const numeric=Number(value)||0;
  if(selectedTextStyle.id===`block-${selectedTextBlock.index}`){
    const offset=textBlockOffset(state.preview,selectedTextBlock.index); offset[axis]=numeric; saveTextBlockOffset(state.preview,selectedTextBlock.index,offset);
  }else{
    const style=textStyleFor(state.preview,selectedTextStyle.id); style[axis]=numeric; saveTextStyle(state.preview,selectedTextStyle.id,style);
  }
  renderPreview();
}
function updateTextBlockControls(){
  if(portalRole!=='admin') return;
  const reset=$('resetSelectedTextBlockBtn'); if(!reset) return;
  reset.hidden=!selectedTextBlock || selectedTextBlock.preview!==state.preview;
  $('toggleTextBlockModeBtn').classList.toggle('is-active',textBlockEditMode);
  $('toggleTextBlockModeBtn').innerHTML=textBlockEditMode?'<i class="bx bx-check"></i> وضع تحريك النص والفقرة مفعّل':'<i class="bx bx-target-lock"></i> تحريك النص أو الفقرة';
  const paragraphArrows=$('selectParagraphForArrowsBtn');
  if(paragraphArrows) paragraphArrows.disabled=!selectedTextBlock||selectedTextBlock.preview!==state.preview;
  updateTextStyleControls();
}
function prepareTextBlocks(content){
  if(portalRole!=='admin'){
    textBlockEditMode=false;
    selectedTextBlock=null;
    selectedTextStyle=null;
  }
  if(selectedTextBlock && selectedTextBlock.preview!==state.preview) selectedTextBlock=null;
  if(selectedTextStyle && selectedTextStyle.preview!==state.preview) selectedTextStyle=null;
  const blocks=[...content.children].filter(node=>!node.classList.contains('collection-flow-seals'));
  content.classList.toggle('is-text-layout-editing',textBlockEditMode);
  blocks.forEach((block,index)=>{
    const offset=textBlockOffset(state.preview,index);
    const layer=textLayerFor(state.preview,index);
    block.dataset.textBlock=String(index);
    block.dataset.originalText=block.innerText||block.textContent||'';
    block.dataset.textStyleId=block.dataset.textStyleId||`block-${index}`;
    block.style.transform=`translate(${offset.x}px, ${offset.y}px)`;
    block.style.position='relative';
    block.style.zIndex=String(layer.zIndex);
    block.style.visibility=layer.hidden?'hidden':'visible';
    block.classList.toggle('is-text-block-selected',selectedTextBlock?.preview===state.preview&&selectedTextBlock.index===index);
    applyTextStyle(block);
    const textNodes=[];
    const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT,{acceptNode(node){
      const styledParent=node.parentElement?.closest('[data-text-style-id]');
      if(!node.nodeValue.trim()||(styledParent&&styledParent!==block)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }});
    while(walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node,textIndex)=>{
      const segment=document.createElement('span');
      segment.dataset.textStyleId=`block-${index}-text-${textIndex}`;
      node.parentNode.replaceChild(segment,node);
      segment.append(node);
    });
    block.querySelectorAll('[data-text-style-id]').forEach(node=>{
      applyTextStyle(node);
      node.classList.toggle('is-text-style-selected',selectedTextStyle?.preview===state.preview&&selectedTextStyle.id===node.dataset.textStyleId);
    });
  });
  renderTextLayers(content);
  renderTextCompare(content);
  if(portalRole==='admin'&&textBlockEditMode) wireTextBlockDrag(content);
  if(portalRole==='admin'&&textBlockEditMode) content.addEventListener('click',event=>{
    const block=event.target.closest('[data-text-block]'); if(!block||!content.contains(block)) return;
    event.preventDefault(); selectedTextBlock={preview:state.preview,index:Number(block.dataset.textBlock)};
    const styleTarget=event.target.closest('[data-text-style-id]')||block;
    selectedTextStyle={preview:state.preview,id:styleTarget.dataset.textStyleId};
    content.querySelectorAll('[data-text-block]').forEach(node=>node.classList.toggle('is-text-block-selected',node===block));
    content.querySelectorAll('[data-text-style-id]').forEach(node=>node.classList.toggle('is-text-style-selected',node===styleTarget));
    updateTextBlockControls();
    renderTextCompare(content);
  });
  updateTextBlockControls();
}
function wireTextBlockDrag(content){
  content.addEventListener('pointerdown',event=>{
    const block=event.target.closest('[data-text-block]'); if(!block||!content.contains(block)) return;
    event.preventDefault();
    const index=Number(block.dataset.textBlock);
    const styleTarget=event.target.closest('[data-text-style-id]');
    const isInlineText=styleTarget&&styleTarget!==block;
    selectedTextBlock={preview:state.preview,index};
    selectedTextStyle={preview:state.preview,id:isInlineText?styleTarget.dataset.textStyleId:`block-${index}`};
    updateTextBlockControls();
    renderTextCompare(content);
    const start={x:event.clientX,y:event.clientY,offset:isInlineText?textStyleFor(state.preview,styleTarget.dataset.textStyleId):textBlockOffset(state.preview,index)};
    const paper=content.closest('.collection-a4'); paper?.classList.add('is-text-guiding');
    const target=isInlineText?styleTarget:block;
    target.setPointerCapture(event.pointerId);
    const move=point=>{
      const next={x:start.offset.x+point.clientX-start.x,y:start.offset.y+point.clientY-start.y};
      if(isInlineText){ target.style.display='inline-block'; target.style.transform=`translate(${next.x}px, ${next.y}px)`; }
      else block.style.transform=`translate(${next.x}px, ${next.y}px)`;
    };
    const finish=point=>{
      const next={x:start.offset.x+point.clientX-start.x,y:start.offset.y+point.clientY-start.y};
      if(isInlineText){
        const style=textStyleFor(state.preview,styleTarget.dataset.textStyleId);
        saveTextStyle(state.preview,styleTarget.dataset.textStyleId,Object.assign(style,next));
      }else saveTextBlockOffset(state.preview,index,next);
      paper?.classList.remove('is-text-guiding');
      target.removeEventListener('pointermove',move); target.removeEventListener('pointerup',finish); target.removeEventListener('pointercancel',finish);
      renderPreview();
    };
    target.addEventListener('pointermove',move); target.addEventListener('pointerup',finish); target.addEventListener('pointercancel',finish);
  });
}
function keepTextBlocksVisible(content){
  const paper=content.closest('.collection-a4');
  if(!paper) return;
  const paperRect=paper.getBoundingClientRect();
  const pxPerMm=(paperRect.width||1)/210;
  const safeTop=content.getBoundingClientRect().top+49*pxPerMm;
  const safeBottom=content.getBoundingClientRect().bottom-28*pxPerMm;
  const overflow=[...content.querySelectorAll('[data-text-block]')].some(block=>{
    const rect=block.getBoundingClientRect();
    return rect.top<safeTop-1||rect.bottom>safeBottom+1||rect.left<paperRect.left-1||rect.right>paperRect.right+1;
  });
  paper.classList.toggle('has-layout-overflow',overflow);
  const notice=$('documentOverflowNotice');
  if(notice) notice.hidden=!overflow;
}
function scheduleTextOverflowCheck(content){
  keepTextBlocksVisible(content);
  requestAnimationFrame(()=>requestAnimationFrame(()=>keepTextBlocksVisible(content)));
}
function populateCollectionSelects(){
  Object.keys(collectionListFields).forEach(key=>{
    const select=$('settingsForm').elements[key]; if(!select) return;
    if(collectionListFields[key].paired){
      const profiles=collectionLists[key]||[];
      const current={bank:state.settings.collectingBank||'',address:state.settings.collectingBankAddress||''};
      const selected=profiles.find(profile=>profile.bank===current.bank&&profile.address===current.address)||profiles.find(profile=>profile.bank===current.bank)||profiles[0];
      if(selected){ state.settings.collectingBank=selected.bank; state.settings.collectingBankAddress=selected.address; }
      select.innerHTML=profiles.map(profile=>`<option value="${esc(collectingBankProfileKey(profile))}">${esc(profile.bank)} - ${esc(profile.address)}</option>`).join('');
      select.value=selected?collectingBankProfileKey(selected):'';
      return;
    }
    const values=[...(collectionLists[key]||[])];
    if(state.settings[key] && !values.includes(state.settings[key])) values.push(state.settings[key]);
    const auto=key==='draweeAddress'?'<option value="">من الشحنة المختارة تلقائياً</option>':'';
    select.innerHTML=auto+values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
    select.value=state.settings[key]||'';
  });
}
function renderCollectionListManager(){
  const field=$('collectionListField'), values=$('collectionListValues'), valueInput=$('collectionListValue'), addressInput=$('collectionListAddress'), addButton=$('addCollectionListValue'); if(!field||!values) return;
  if(!field.options.length) field.innerHTML=Object.entries(collectionListFields).map(([key,meta])=>`<option value="${key}">${esc(meta.label)}</option>`).join('');
  const key=field.value||'remittingBank';
  const paired=Boolean(collectionListFields[key]?.paired);
  valueInput.placeholder=paired?'اسم بنك التحصيل':'اكتب القيمة الجديدة';
  addressInput.hidden=!paired;
  addButton.textContent=paired?'إضافة البنك والعنوان':'إضافة للقائمة';
  values.innerHTML=(collectionLists[key]||[]).length?(collectionLists[key]||[]).map((value,index)=>{
    const text=paired?`${value.bank} - ${value.address}`:value;
    return `<span class="collection-list-value"><span title="${esc(text)}">${esc(text)}</span><button type="button" title="حذف" data-remove-list-index="${index}">×</button></span>`;
  }).join(''):'<small>لا توجد قيم محفوظة بعد.</small>';
}
const rowToShipment = row => Object.assign({}, row.data||{}, JahezShipmentWorkflow.fromRow(row), {id:row.id,status:row.status,companyId:row.company_id,bsgtStage:row.bsgt_stage||null,operationsCompletedAt:row.operations_completed_at||null,shipmentNo:row.data?.operationNo||row.task_ref||row.id.slice(0,8)});
function shipmentDataForUpdate(shipment){
  const data=Object.assign({},shipment);
  ['id','status','companyId','shipmentNo','workflowStage','workflowUpdatedAt','bankSentAt','signedAt','acceptedAt','acceptedBy'].forEach(key=>delete data[key]);
  return data;
}
async function saveShipmentCollectionState(rows, stateName, batch){
  const updates=await Promise.all(rows.map(async shipment=>{
    const sourceShipment=state.shipments.find(item=>item.id===shipment.id)||shipment;
    const data=shipmentDataForUpdate(sourceShipment);
    const operations=Array.isArray(data.commercialCollectionOperations)?data.commercialCollectionOperations.map(operation=>({...operation})):[];
    if(stateName==='sent'){
      const sentAt=batch.sentAt||new Date().toISOString();
      data.collectionStatus='sent';
      data.collectionSentAt=sentAt;
      data.collectionBatchId=batch.id;
      data.collectionOperationNo=batch.operationNo;
      data.collectionRemittingBank=batch.remittingBank;
      data.collectionAmount=batch.amount;
      data.collectionDocumentSettings=batch.documentSettings;
      data.collectionDocumentKinds=batch.documentKinds;
      data.collectionConvertToAed=batch.convertToAed;
      data.collectionExchangeRate=batch.exchangeRate;
      const operation={id:batch.id,operationNo:batch.operationNo,status:'sent',sentAt,remittingBank:batch.remittingBank,amount:batch.amount,documentSettings:batch.documentSettings,documentKinds:batch.documentKinds,qrIncluded:false,convertToAed:batch.convertToAed,exchangeRate:batch.exchangeRate,shipmentSnapshot:collectionShipmentSnapshot(shipment)};
      const existingIndex=operations.findIndex(item=>item.id===batch.id);
      if(existingIndex>=0) operations[existingIndex]=operation; else operations.push(operation);
    }else{
      const activeBatchId=data.collectionBatchId;
      const completedAt=new Date().toISOString();
      operations.forEach(operation=>{
        if(operation.id===activeBatchId){ operation.status=stateName||'cancelled'; operation.completedAt=completedAt; }
      });
      ['collectionStatus','collectionSentAt','collectionBatchId','collectionRemittingBank','collectionAmount','collectionDocumentSettings','collectionDocumentKinds','collectionConvertToAed','collectionExchangeRate'].forEach(key=>delete data[key]);
    }
    data.commercialCollectionOperations=operations;
    const updatePayload={data};
    if(stateName==='sent') Object.assign(updatePayload,JahezShipmentWorkflow.bankSentFields(data.collectionSentAt));
    const {data:updated,error}=await sb.from('shipments').update(updatePayload).eq('id',shipment.id).select().single();
    if(error) throw error;
    return rowToShipment(updated);
  }));
  const replacements=new Map(updates.map(shipment=>[shipment.id,shipment]));
  state.shipments=state.shipments.map(shipment=>replacements.get(shipment.id)||shipment);
}
function rebuildRemittingBatches(){
  const grouped=new Map();
  state.shipments.filter(shipment=>shipment.collectionStatus==='sent').forEach(shipment=>{
    const id=shipment.collectionBatchId||`restored-${shipment.id}`;
    const savedOperation=(shipment.commercialCollectionOperations||[]).find(operation=>operation.id===id)||{};
    const operationNo=shipment.collectionOperationNo||savedOperation.operationNo||`TC-LEGACY-${String(id).slice(-8).toUpperCase()}`;
    const batch=grouped.get(id)||{id,operationNo,shipmentIds:[],snapshotsByShipment:{},remittingBank:shipment.collectionRemittingBank||savedOperation.remittingBank||'البنك المُرسل',amount:shipment.collectionAmount||savedOperation.amount||'',sentAt:shipment.collectionSentAt||savedOperation.sentAt||new Date().toISOString(),documentSettings:shipment.collectionDocumentSettings||savedOperation.documentSettings||null,documentKinds:shipment.collectionDocumentKinds||savedOperation.documentKinds||collectionDocumentKinds(),convertToAed:Boolean(shipment.collectionConvertToAed??savedOperation.convertToAed),exchangeRate:Number(shipment.collectionExchangeRate||savedOperation.exchangeRate)||3.6725,qrIncluded:false};
    batch.shipmentIds.push(shipment.id);
    batch.snapshotsByShipment[shipment.id]=savedOperation.shipmentSnapshot||collectionShipmentSnapshot(shipment);
    grouped.set(id,batch);
  });
  remittingBatches=[...grouped.values()];
  saveRemittingBatches();
}
async function migrateLegacyRemittingBatches(legacyBatches){
  for(const batch of legacyBatches){
    const rows=(batch.shipmentIds||[]).map(id=>state.shipments.find(shipment=>shipment.id===id)).filter(shipment=>shipment&&!shipment.collectionStatus);
    if(rows.length) await saveShipmentCollectionState(rows,'sent',Object.assign({operationNo:createCollectionOperationNo(new Date(batch.sentAt||Date.now())),documentSettings:{...state.settings},documentKinds:collectionDocumentKinds(),convertToAed:false,exchangeRate:3.6725},batch));
  }
}
const moneyInfo = value => { const text=String(value||''); const currency=(text.match(/\b[A-Z]{3}\b/)||[])[0]||''; const number=parseFloat((text.match(/-?[\d,]+(?:\.\d+)?/)||['0'])[0].replace(/,/g,'')); return {currency:currency||'—',number:Number.isFinite(number)?number:0}; };
const paidOf = id => (state.payments[id]||[]).reduce((sum,payment)=>sum+(Number(payment.amount)||0),0);
const remainingOf = shipment => Math.max(0,moneyInfo(shipment.totalAmount).number-paidOf(shipment.id));
const collectionState = shipment => { const total=moneyInfo(shipment.totalAmount).number, paid=paidOf(shipment.id); return paid>=total-.01&&total>0?'settled':paid>0?'partial':''; };
const effective = shipment => Object.assign({}, shipment, state.overrides[shipment.id]||{});
const selectedShipments = () => state.shipments.filter(s=>state.selected.has(s.id)).map(effective);
const valueOrDash = v => v === undefined || v === null || v === '' ? '-' : v;
function amountWords(number){
  if(!Number.isFinite(number)) return 'ZERO'; if(number===0) return 'ZERO';
  const ones=['','ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE','TEN','ELEVEN','TWELVE','THIRTEEN','FOURTEEN','FIFTEEN','SIXTEEN','SEVENTEEN','EIGHTEEN','NINETEEN'];
  const tens=['','','TWENTY','THIRTY','FORTY','FIFTY','SIXTY','SEVENTY','EIGHTY','NINETY'];
  const chunk=n=>{let out=''; if(n>=100){out+=ones[Math.floor(n/100)]+' HUNDRED';n%=100;if(n)out+=' ';} if(n>=20){out+=tens[Math.floor(n/10)];if(n%10)out+=' '+ones[n%10];}else if(n)out+=ones[n];return out;};
  const parts=[[1000000000,'BILLION'],[1000000,'MILLION'],[1000,'THOUSAND'],[1,'']]; let left=Math.round(number*100)/100, whole=Math.floor(left), out=[];
  parts.forEach(([size,label])=>{if(whole>=size){const n=Math.floor(whole/size);out.push(chunk(n)+(label?' '+label:''));whole%=size;}}); if(left%1) out.push('AND '+Math.round((left%1)*100)+'/100'); return out.join(' ');
}
function collectionDateText(value){
  const parts=String(value||'').split('-'); if(parts.length!==3) return value||'';
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${parts[2]}-${months[Number(parts[1])-1]||parts[1]}-${parts[0]}`;
}
function detected(){const rows=selectedShipments();const currencies=[...new Set(rows.map(r=>moneyInfo(r.totalAmount).currency).filter(c=>c!=='—'))];const consignees=[...new Set(rows.map(r=>r.consignee).filter(Boolean))];const totals={};rows.forEach(r=>{const m=moneyInfo(r.totalAmount);if(m.currency!=='—') totals[m.currency]=(totals[m.currency]||0)+m.number;});return {rows,currencies,consignees,totals};}
function formatMoney(currency, value){return `${currency} ${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;}
function collectionMoney(value){
  const source=moneyInfo(value), rate=Number(state.exchangeRate)||0;
  if(state.convertToAed&&source.currency!=='AED'&&rate>0) return {source,currency:'AED',number:source.number*rate,converted:true,rate};
  return {source,currency:source.currency,number:source.number,converted:false,rate};
}
function collectionTotal(rows){
  const sourceCurrency=moneyInfo(rows[0]?.totalAmount).currency;
  const sourceTotal=rows.reduce((sum,row)=>sum+moneyInfo(row.totalAmount).number,0);
  return collectionMoney(`${sourceCurrency} ${sourceTotal}`);
}
function updateConversionControls(){
  const button=$('convertToAedBtn'), rate=$('collectionExchangeRate'), preview=$('collectionConversionPreview');
  if(!button||!rate||!preview)return;
  button.classList.toggle('is-active',state.convertToAed);
  rate.disabled=!state.convertToAed; rate.value=state.exchangeRate||'';
  const rows=selectedShipments();
  const currencyLabel=$('compactCollectionCurrency');
  if(!rows.length){ if(currencyLabel) currencyLabel.textContent='AED'; preview.textContent='اختر شحنة لعرض التحويل.'; return; }
  const result=collectionTotal(rows);
  if(currencyLabel) currencyLabel.textContent=state.convertToAed?'AED':result.source.currency;
  button.title=state.convertToAed?'المستندات بالدرهم AED - اضغط للعودة للعملة الأصلية':'اضغط للتحويل إلى AED';
  preview.textContent=result.converted?`${formatMoney(result.source.currency,result.source.number)} × ${result.rate} = ${formatMoney('AED',result.number)}`:state.convertToAed?'الشحنة بعملة AED بالفعل.':'يظهر التحويل هنا بعد التفعيل.';
}
function renderCollectionSummary(){
  const {rows,currencies}=detected(), action=$('compactRecordCollectionBtn');
  const collection=rows.length&&currencies.length===1?collectionTotal(rows):null;
  $('compactCollectionCount').textContent=rows.length;
  $('compactShipmentCount').textContent=rows.length;
  $('compactCollectionTotal').textContent=collection?formatMoney(collection.currency,collection.number):(rows.length?'عملات متعددة':'-');
  action.disabled=!rows.length;
}
function renderPicker(){
  const search=$('searchInput').value.trim().toLowerCase(), cur=$('currencyFilter').value, consignee=$('consigneeFilter').value;
  const list=state.shipments.filter(s=>{const m=moneyInfo(s.totalAmount);const hay=[s.shipmentNo,s.itemDesc,s.invoiceNo,s.billNo,s.consignee].join(' ').toLowerCase();return (!search||hay.includes(search))&&(!cur||m.currency===cur)&&(!consignee||s.consignee===consignee);});
  $('shipmentCount').textContent=state.tradeFile?`${list.length} شحنة مرتبطة بالملف ${state.tradeFile.operation_no} — الاختيار مقفل`:`${list.length} شحنة BSGT متاحة للقراءة`;
  $('shipmentList').innerHTML=list.length?list.map(s=>{const m=moneyInfo(s.totalAmount),status=collectionState(s),paid=paidOf(s.id);const statusTag=status==='settled'?'<span class="collection-status settled">تم التحصيل بالكامل</span>':status==='partial'?`<span class="collection-status partial">تحصيل جزئي: ${esc(formatMoney(m.currency,paid))}</span>`:'';return `<label class="shipment-card ${state.selected.has(s.id)?'is-selected':''}"><input type="checkbox" data-select="${esc(s.id)}" ${state.selected.has(s.id)?'checked':''} ${state.tradeFile?'disabled':''}><div><h3>${esc(s.itemDesc||'-')}</h3><p>${esc(s.consignee||'-')}</p><div class="shipment-meta"><span class="shipment-ref">${esc(s.shipmentNo)}</span><span>${esc(s.invoiceNo||'-')}</span><span>${esc(m.currency)} ${m.number?m.number.toLocaleString('en-US'):'-'}</span></div>${statusTag}</div></label>`}).join(''):'<div class="empty-state">لا توجد نتائج مطابقة.</div>';
  if(!state.tradeFile) document.querySelectorAll('[data-select]').forEach(input=>input.addEventListener('change',()=>{input.checked?state.selected.add(input.dataset.select):state.selected.delete(input.dataset.select);state.activeOperationNo='';renderAll();}));
}
function renderDraft(){
  const {rows,currencies,consignees,totals}=detected(); $('selectionHint').textContent=rows.length?`${rows.length} شحنة مختارة في مسودة الإرسال المحلية.`:'اختر شحنة واحدة أو أكثر لبدء المعاينة.';
  $('warnings').innerHTML=(currencies.length>1?'<div class="warning currency">الشحنات المختارة تحتوي على أكثر من عملة. لا يمكن إنشاء حزمة تحصيل واحدة متعددة العملات؛ أنشئ حزمة منفصلة لكل عملة.</div>':'')+(consignees.length>1?'<div class="warning consignee">الشحنات المختارة تحتوي على أكثر من مستورد / Drawee. المعاينة متاحة، لكن مستندات التحصيل عادة تحتاج مستورداً واحداً داخل الحزمة.</div>':'');
  $('selectedTableWrap').innerHTML=rows.length?`<table class="draft-table"><thead><tr><th>Shipment</th><th>Invoice No</th><th>Invoice Date</th><th>B/L No</th><th>Consignee</th><th>Currency</th><th>Amount</th><th></th></tr></thead><tbody>${rows.map(r=>{const original=state.shipments.find(s=>s.id===r.id),changed=state.overrides[r.id]||{},m=moneyInfo(r.totalAmount);return `<tr><td>${esc(r.shipmentNo)}</td>${['invoiceNo','invoiceDate','billNo','totalAmount'].map(key=>`<td class="${changed[key]!==undefined?'changed':''}">${esc(valueOrDash(r[key]))}${changed[key]!==undefined?'<span class="override-tag">قيمة معدلة للمعاينة فقط</span>':''}</td>`).join('')}<td>${esc(valueOrDash(r.consignee))}</td><td>${esc(m.currency)}</td><td>${esc(formatMoney(m.currency,m.number))}</td><td><button class="mini-btn" data-edit="${esc(r.id)}">تعديل لهذا التحصيل فقط</button></td></tr>${changed._editing?`<tr><td colspan="8"><div class="edit-grid"><label>Invoice No <input data-override="invoiceNo" data-id="${esc(r.id)}" value="${esc(r.invoiceNo||'')}"></label> <label>Invoice Date <input type="date" data-override="invoiceDate" data-id="${esc(r.id)}" value="${esc(r.invoiceDate||'')}"></label> <label>B/L No <input data-override="billNo" data-id="${esc(r.id)}" value="${esc(r.billNo||'')}"></label> <label>Amount <input data-override="totalAmount" data-id="${esc(r.id)}" value="${esc(r.totalAmount||'')}"></label></div></td></tr>`:''}`}).join('')}</tbody></table>`:'<div class="empty-state">لا توجد شحنات مختارة بعد.</div>';
  const converted=currencies.length===1&&rows.length?collectionTotal(rows):null;
  const conversionCard=converted?.converted?`<div class="total-card"><span>إجمالي التحصيل بالدرهم (${converted.source.currency} × ${converted.rate})</span><strong>${esc(formatMoney('AED',converted.number))}</strong><span>قيمة التحصيل الفعلية</span></div>`:'';
  $('totalsBar').innerHTML=Object.entries(totals).map(([c,n])=>`<div class="total-card"><span>${currencies.length===1?'TOTAL COLLECTION AMOUNT':c+' Total'}</span><strong>${esc(formatMoney(c,n))}</strong><span>${esc(amountWords(n))} ONLY</span></div>`).join('')+conversionCard;
  $('groupByConsignee').hidden=consignees.length<2;$('consigneeGroups').hidden=true;
  document.querySelectorAll('[data-edit]').forEach(btn=>btn.addEventListener('click',()=>{const id=btn.dataset.edit;state.overrides[id]=Object.assign({},state.overrides[id],{_editing:!state.overrides[id]?true:!state.overrides[id]._editing});renderAll();}));
  document.querySelectorAll('[data-override]').forEach(input=>input.addEventListener('input',()=>{const id=input.dataset.id;state.overrides[id]=Object.assign({},state.overrides[id],{[input.dataset.override]:input.value,_editing:true});renderAll();}));
}
function docRows(rows){return rows.map(r=>{const m=collectionMoney(r.totalAmount);return `<tr><td>${esc(valueOrDash(r.invoiceNo))}</td><td>${esc(valueOrDash(r.invoiceDate))}</td><td>${esc(valueOrDash(r.billNo))}</td><td>${esc(formatMoney(m.currency,m.number))}</td></tr>`}).join('');}
function renderPreview(){
  const {rows,currencies,consignees,totals}=detected(), s=state.settings, c=currencies[0]||'—', n=totals[c]||0, amount=formatMoney(c,n), words=`${c} ${amountWords(n)} ONLY`, drawee=consignees.join(' / ')||'-', refs=rows.map(r=>`${r.invoiceNo||'-'} (${r.invoiceDate||'-'})`).join(', ')||'-';
  let body='';
  if(!rows.length) body='<div class="empty-state">اختر شحنات أولاً لعرض مستندات التحصيل.</div>';
  else if(state.preview==='application') body=`<article class="document-paper"><h2>COLLECTION APPLICATION</h2><p><b>Date:</b> ${esc(s.collectionDate)}<br><b>Remitting Bank:</b> ${esc(s.remittingBank)}<br><b>Collecting Bank:</b> ${esc(s.collectingBank)}</p><h3>Documents / Commercial Invoices</h3><table><thead><tr><th>Invoice No</th><th>Date</th><th>B/L No</th><th>Total Amount</th></tr></thead><tbody>${docRows(rows)}</tbody></table><div class="document-total"><span>TOTAL AMOUNT</span><span>${esc(amount)}</span></div><p><b>Drawer:</b> ${esc(s.drawer)}<br><b>Drawee:</b> ${esc(drawee)}<br><b>Term:</b> ${esc(s.term)}</p></article>`;
  else if(state.preview==='letter') body=`<article class="document-paper"><h2>COLLECTION LETTER</h2><p>Date: ${esc(s.collectionDate)}<br>The Manager<br>${esc(s.remittingBank)}<br>Trade Finance Department<br>Abu Dhabi, UAE</p><p>Dear Sir/Madam,</p><p>Please forward the enclosed documents for collection through <b>${esc(s.collectingBank)}</b>${s.collectingBankAddress?' — '+esc(s.collectingBankAddress):''}, and advise us of payment at maturity.</p><p><b>Amount:</b> ${esc(amount)}<br><b>Amount in Words:</b> ${esc(words)}<br><b>Tenor:</b> ${esc(s.term)}<br><b>Drawee:</b> ${esc(drawee)}<br><b>Drawee Address:</b> ${esc(s.draweeAddress||rows[0].consigneeAddress||'-')}</p><h3>Documents Enclosed</h3><table><thead><tr><th>Invoice No</th><th>Date</th><th>B/L No</th><th>Total Amount</th></tr></thead><tbody>${docRows(rows)}</tbody></table><div class="signature">${esc(s.drawer)}<br>${esc(s.authorizedPerson)}<br>${esc(s.title)}</div></article>`;
  else if(state.preview==='undertaking') body=`<article class="document-paper"><h2>UNDERTAKING LETTER</h2><p>Date: ${esc(s.collectionDate)}</p><table><thead><tr><th>REF #</th><th>B/L No</th><th>Currency</th><th>Amount</th></tr></thead><tbody>${rows.map(r=>{const m=moneyInfo(r.totalAmount);return `<tr><td>${esc(r.shipmentNo)}</td><td>${esc(valueOrDash(r.billNo))}</td><td>${esc(m.currency)}</td><td>${esc(formatMoney(m.currency,m.number))}</td></tr>`}).join('')}</tbody></table><p>We hereby undertake that the enclosed documents are submitted for collection according to the stated terms and that the collection amount is ${esc(amount)} (${esc(words)}).</p><div class="signature">${esc(s.drawer)}<br>${esc(s.authorizedPerson)}<br>${esc(s.title)}<br><br>Signature</div></article>`;
  else body=`<article class="document-paper"><h2>BILL OF EXCHANGE</h2><p><b>Date:</b> ${esc(s.collectionDate)}<br><b>For:</b> ${esc(amount)}<br><b>Amount in Words:</b> ${esc(words)}</p><p>At ${esc(s.term)}, pay to the order of <b>${esc(s.drawer)}</b> the sum of <b>${esc(amount)}</b> for value received against commercial invoices: ${esc(refs)}.</p><p><b>To:</b> ${esc(drawee)}<br><b>Address:</b> ${esc(s.draweeAddress||rows[0].consigneeAddress||'-')}</p><div class="signature">Drawer: ${esc(s.drawer)}<br>${esc(s.authorizedPerson)}<br>${esc(s.title)}</div></article>`;
  $('documentPreview').innerHTML=body;
}
function renderDebug(){const d=detected();$('debugOutput').textContent=JSON.stringify({selectedShipmentIds:[...state.selected],originalValues:state.shipments.filter(s=>state.selected.has(s.id)),overrides:state.overrides,totals:d.totals,detectedCurrency:d.currencies,detectedConsignee:d.consignees},null,2);}
function applyCollectionBatchSnapshot(batch){
  state.selected=new Set(batch.shipmentIds||[]);
  state.activeOperationNo=batch.operationNo||'';
  state.overrides={};
  Object.entries(batch.snapshotsByShipment||{}).forEach(([shipmentId,snapshot])=>{ state.overrides[shipmentId]=Object.assign({},snapshot); });
  if(batch.documentSettings) Object.assign(state.settings,batch.documentSettings);
  state.convertToAed=Boolean(batch.convertToAed);
  state.exchangeRate=Number(batch.exchangeRate)||3.6725;
  populateCollectionSelects();
  Object.entries(state.settings).forEach(([key,value])=>{ const input=$('settingsForm').elements[key]; if(input) input.value=value; });
  renderAll();
}
function restoreRequestedCollectionOperation(){
  const params=new URLSearchParams(location.search);
  const operationNo=params.get('operation');
  const requestedShipmentId=params.get('shipment');
  if(!operationNo) return false;
  const matches=state.shipments.map(shipment=>({
    shipment,
    operation:(shipment.commercialCollectionOperations||[]).find(item=>item.operationNo===operationNo)
  })).filter(item=>item.operation&&(!requestedShipmentId||item.shipment.id===requestedShipmentId));
  if(!matches.length) return false;
  const first=matches[0].operation;
  const operationId=first.id;
  const related=state.shipments.map(shipment=>({
    shipment,
    operation:(shipment.commercialCollectionOperations||[]).find(item=>item.id===operationId||item.operationNo===operationNo)
  })).filter(item=>item.operation);
  applyCollectionBatchSnapshot({
    id:operationId,
    operationNo,
    shipmentIds:related.map(item=>item.shipment.id),
    snapshotsByShipment:Object.fromEntries(related.map(item=>[item.shipment.id,item.operation.shipmentSnapshot||collectionShipmentSnapshot(item.shipment)])),
    remittingBank:first.remittingBank,
    amount:first.amount,
    sentAt:first.sentAt,
    documentSettings:first.documentSettings,
    documentKinds:first.documentKinds||collectionDocumentKinds(),
    convertToAed:first.convertToAed,
    exchangeRate:first.exchangeRate,
    qrIncluded:false
  });
  openPortalSection('preview-section');
  return true;
}
function updateActiveCollectionOperationRef(){
  const element=$('activeCollectionOperationRef');
  if(element) element.textContent=state.activeOperationNo?`رقم عملية التحصيل: ${state.activeOperationNo}`:'عملية جديدة غير محفوظة';
}
function renderCollectionPortal(){
  const list=$('pendingCollectionList'); if(!list) return;
  const batches=remittingBatches.map(batch=>Object.assign({},batch,{rows:batch.shipmentIds.map(id=>state.shipments.find(row=>row.id===id)).filter(Boolean)})).filter(batch=>batch.rows.length);
  list.innerHTML=batches.length?batches.map(batch=>`<article class="pending-collection-card"><div><span class="pending-status"><i class="bx bx-time-five"></i> بانتظار التحصيل</span><h3>${esc(batch.operationNo)} · ${esc(batch.rows.length)} شحنة</h3><p>${esc(batch.remittingBank)} · ${esc(new Date(batch.sentAt).toLocaleString('ar-EG'))} · ${esc(batch.amount)}</p><small>خطاب التحصيل · التعهد · الكمبيالة · مستبعدة من حزمة QR</small></div><div class="pending-collection-actions"><button type="button" class="mini-btn pending-preview-btn" data-preview-batch="${esc(batch.id)}"><i class="bx bx-show"></i> معاينة المستندات</button><button type="button" class="mini-btn pending-collect-btn" data-collect-batch="${esc(batch.id)}"><i class="bx bx-wallet"></i> بدء التحصيل</button><button type="button" class="mini-btn pending-cancel-btn" data-cancel-batch="${esc(batch.id)}"><i class="bx bx-undo"></i> إلغاء الإرسال</button></div></article>`).join(''):'<div class="empty-state">لا توجد عمليات تحصيل تجاري بانتظار التحصيل.</div>';
  list.querySelectorAll('[data-preview-batch]').forEach(button=>button.addEventListener('click',()=>{
    const batch=remittingBatches.find(item=>item.id===button.dataset.previewBatch); if(!batch) return;
    applyCollectionBatchSnapshot(batch);
    document.querySelector('.preview-section')?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
  list.querySelectorAll('[data-collect-batch]').forEach(button=>button.addEventListener('click',()=>{
    const batch=remittingBatches.find(item=>item.id===button.dataset.collectBatch); if(!batch) return;
    applyCollectionBatchSnapshot(batch); recordCollection();
  }));
  list.querySelectorAll('[data-cancel-batch]').forEach(button=>button.addEventListener('click',async ()=>{
    const batch=remittingBatches.find(item=>item.id===button.dataset.cancelBatch); if(!batch) return;
    if(!confirm(`إلغاء إرسال ${batch.shipmentIds.length} شحنة للبنك المُرسل؟ ستعود لحالتها العادية ولن يُسجل عليها تحصيل.`)) return;
    const rows=batch.shipmentIds.map(id=>state.shipments.find(row=>row.id===id)).filter(Boolean);
    button.disabled=true;
    try{
      await saveShipmentCollectionState(rows,'cancelled');
      rebuildRemittingBatches(); state.activeOperationNo=''; renderAll();
      showCollectionNotice('تم إلغاء الإرسال. عادت الشحنات إلى حالتها العادية ويمكن تجهيزها من جديد.');
    }catch(error){
      alert(`تعذّر إلغاء الإرسال. ${error?.message||error}`);
    }finally{ button.disabled=false; }
  }));
}
async function sendToRemittingBank(){
  const {rows,currencies}=detected();
  if(!rows.length){ alert('اختر شحنة واحدة على الأقل قبل الإرسال للبنك المُرسل.'); return; }
  if(currencies.length!==1){ alert('أرسل كل عملة في حزمة مستقلة حتى تبقى المستندات متسقة.'); return; }
  const total=collectionTotal(rows);
  if(!confirm(`سيتم تجهيز ${rows.length} شحنة للإرسال إلى ${state.settings.remittingBank}.\n${formatMoney(total.currency,total.number)}\n\nهل تؤكد الإرسال؟`)) return;
  const sentAt=new Date();
  const batch={id:state.tradeFile?.id||(crypto.randomUUID?crypto.randomUUID():`send-${sentAt.getTime()}`),operationNo:state.tradeFile?.operation_no||createCollectionOperationNo(sentAt),shipmentIds:rows.map(row=>row.id),snapshotsByShipment:Object.fromEntries(rows.map(row=>[row.id,collectionShipmentSnapshot(row)])),remittingBank:state.settings.remittingBank,amount:formatMoney(total.currency,total.number),sentAt:sentAt.toISOString(),documentSettings:{...state.settings},documentKinds:collectionDocumentKinds(),convertToAed:state.convertToAed,exchangeRate:state.exchangeRate,qrIncluded:false};
  try{
    if(state.tradeFile){
      if(state.tradeFile.status!=='draft') throw new Error('تم إرسال ملف العملية مسبقاً وأصبح للقراءة فقط.');
      const metadata={documentSettings:batch.documentSettings,documentKinds:batch.documentKinds,amountSnapshot:total.number,currency:total.currency,shipmentNumbers:rows.map(row=>row.shipmentNo),convertToAed:batch.convertToAed,exchangeRate:batch.exchangeRate,qrIncluded:false};
      const {data,error}=await sb.rpc('send_bsgt_trade_file_to_remitting',{p_trade_file_id:state.tradeFile.id,p_remitting_bank:batch.remittingBank,p_metadata:metadata});
      if(error) throw error;
      state.tradeFile=Object.assign({},state.tradeFile,data||{},{status:'sent_to_remitting',sent_to_remitting_at:sentAt.toISOString(),remitting_bank:batch.remittingBank,metadata});
      state.shipments=state.shipments.map(shipment=>Object.assign({},shipment,{bsgtStage:'sent_to_remitting'}));
    }else await saveShipmentCollectionState(rows,'sent',batch);
    state.activeOperationNo=batch.operationNo;
    if(!state.tradeFile) rebuildRemittingBatches(); renderAll();
    showCollectionNotice(`تم إنشاء عملية التحصيل التجاري ${batch.operationNo}. المستندات مرتبطة بالشحنات ومُستبعدة من حزمة QR.`);
    document.querySelector('.collection-portal-section')?.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){
    alert(`تعذّر حفظ حالة الإرسال للشحنات. ${error?.message||error}`);
  }
}

async function financeTradeContextAllowed(profile){
  if(!requestedTradeFileId) return false;
  if(profile?.role==='admin') return true;
  const {data,error}=await sb.rpc('get_bsgt_workspace_permissions',{});
  if(error) throw error;
  return (data||[]).some(permission=>['finance','management','relations'].includes(permission.section)&&permission.can_view);
}

async function loadTradeFileContext(){
  const {data:file,error:fileError}=await sb.from('trade_collection_files').select('*').eq('id',requestedTradeFileId).single();
  if(fileError) throw fileError;
  const {data:links,error:linkError}=await sb.from('trade_collection_file_shipments').select('shipment_id').eq('trade_file_id',requestedTradeFileId);
  if(linkError) throw linkError;
  const ids=(links||[]).map(link=>link.shipment_id);
  if(!ids.length) throw new Error('ملف العملية لا يحتوي على شحنات مرتبطة.');
  const [{data:rows,error:shipmentError},{data:paymentRows,error:paymentError}]=await Promise.all([
    sb.from('shipments').select('*').in('id',ids),
    sb.from('payments').select('*').in('shipment_id',ids).order('paid_on')
  ]);
  if(shipmentError) throw shipmentError; if(paymentError) console.warn('payments',paymentError);
  state.tradeFile=file;
  state.shipments=(rows||[]).map(rowToShipment);
  state.selected=new Set(state.shipments.map(shipment=>shipment.id));
  state.activeOperationNo=file.operation_no;
  if(file.metadata?.documentSettings) Object.assign(state.settings,file.metadata.documentSettings);
  if(file.remitting_bank) state.settings.remittingBank=file.remitting_bank;
  state.payments={}; (paymentRows||[]).forEach(payment=>(state.payments[payment.shipment_id]??=[]).push(payment));
  document.body.classList.add('trade-file-context');
  document.querySelector('[data-step-section="settings-section"]')?.classList.remove('admin-document-settings');
  document.querySelector('.settings-section')?.classList.remove('admin-document-settings');
}
function renderAll(){renderPicker();renderDraft();renderCollectionSummary();renderPreview();updateConversionControls();renderCollectionPortal();updateActiveCollectionOperationRef();renderDebug();}
function fillFilters(){const currencies=[...new Set(state.shipments.map(s=>moneyInfo(s.totalAmount).currency).filter(c=>c!=='—'))].sort(), consignees=[...new Set(state.shipments.map(s=>s.consignee).filter(Boolean))].sort();$('currencyFilter').innerHTML='<option value="">كل العملات</option>'+currencies.map(v=>`<option>${esc(v)}</option>`).join('');$('consigneeFilter').innerHTML='<option value="">كل المستوردين</option>'+consignees.map(v=>`<option>${esc(v)}</option>`).join('');}
async function recordCollection(){
  const rows=selectedShipments();
  const eligible=rows.filter(row=>moneyInfo(row.totalAmount).number>0&&remainingOf(row)>.01);
  if(!eligible.length){ alert('كل الشحنات المختارة مسجلة كمحصلة بالفعل، أو لا تحتوي على مبلغ صالح للتحصيل.'); return; }
  const currencies=[...new Set(eligible.map(row=>moneyInfo(row.totalAmount).currency))];
  if(currencies.length!==1){ alert('سجل التحصيل لكل عملة في حزمة منفصلة حتى تكون قيمة التحويل صحيحة.'); return; }
  if(state.convertToAed&&currencies[0]!=='AED'&&!(Number(state.exchangeRate)>0)){ alert('أدخل سعر صرف صحيحاً قبل التحويل إلى AED.'); return; }
  const totalByCurrency={}; eligible.forEach(row=>{const info=moneyInfo(row.totalAmount);totalByCurrency[info.currency]=(totalByCurrency[info.currency]||0)+remainingOf(row);});
  const sourceSummary=Object.entries(totalByCurrency).map(([currency,total])=>formatMoney(currency,total)).join('\n');
  const convertedTotal=collectionTotal(eligible);
  const summary=convertedTotal.converted?`${sourceSummary}\n= ${formatMoney('AED',convertedTotal.number)} بسعر ${convertedTotal.rate}`:sourceSummary;
  if(!confirm(`سيتم تسجيل التحصيل الكامل المتبقي لـ ${eligible.length} شحنة:\n${summary}\n\nهل تؤكد تسجيل التحصيل؟`)) return;
  const buttons=[...document.querySelectorAll('[data-collect-batch]')];
  const originals=buttons.map(button=>button.innerHTML);
  buttons.forEach(button=>{button.disabled=true;button.textContent='جارٍ تسجيل التحصيل...';});
  try{
    const paidOn=state.settings.collectionDate||new Date().toISOString().slice(0,10);
    const rowsToInsert=eligible.map(row=>{const source=moneyInfo(row.totalAmount), converted=collectionMoney(`${source.currency} ${remainingOf(row)}`), operationNo=row.collectionOperationNo||state.activeOperationNo||''; return {shipment_id:row.id,amount:remainingOf(row),currency:source.currency,paid_on:paidOn,method:'تحصيل مستندات BSGT',reference:operationNo||row.invoiceNo||row.shipmentNo,note:`تم التسجيل من بوابة التحصيل التجاري${operationNo?` | رقم العملية: ${operationNo}`:''}${converted.converted?` | تم التحصيل فعلياً: ${formatMoney('AED',converted.number)} بسعر صرف ${converted.rate}`:''}`};});
    const {data,error}=await sb.from('payments').insert(rowsToInsert).select();
    if(error) throw error;
    (data||[]).forEach(payment=>(state.payments[payment.shipment_id]??=[]).push(payment));
    await saveShipmentCollectionState(eligible,'collected');
    const collectedIds=new Set(eligible.map(row=>row.id));
    remittingBatches=remittingBatches.map(batch=>Object.assign({},batch,{shipmentIds:batch.shipmentIds.filter(id=>!collectedIds.has(id))})).filter(batch=>batch.shipmentIds.length);
    saveRemittingBatches();
    state.activeOperationNo='';
    renderAll();
    alert(`تم تسجيل تحصيل ${eligible.length} شحنة بنجاح. ستظهر الآن ضمن «محصّلة» في قائمة التحصيل الرئيسية.`);
  }catch(error){
    const message=error?.message||String(error);
    alert(`تعذّر تسجيل التحصيل. ${message.includes('payments')?'تأكد من تشغيل ملف 6_التحصيل_والمستحقات.sql في Supabase ومن صلاحية المستخدم.':message}`);
  }finally{ buttons.forEach((button,index)=>{button.disabled=false;button.innerHTML=originals[index];}); }
}
async function init(){
  const auth=await restorePortalSession();
  if(auth.status==='network_error'){ showPortalSessionRecovery(auth.error); return; }
  if(auth.status!=='authenticated' || !auth.session){ redirectPortalToLogin(); return; }
  const session=auth.session;
  let portalContext;
  try{ portalContext=await loadPortalHeader(session.user); }
  catch(error){
    console.error('collection portal profile',error);
    const loader=$('portalAccessLoader');
    if(loader) loader.innerHTML='<strong>تعذّر التحقق من صلاحية البوابة. حدّث الصفحة وحاول مرة أخرى.</strong>';
    return;
  }
  if(!portalContext?.profile || !window.JahezPortalAccess?.canAccessPortal('commercial_collection',portalContext.profile,portalContext.permissions)){
    denyPortalAccess();
    return;
  }
  setPortalUserProfile(session.user,portalContext.profile);
  setPortalBrand(portalContext.branding);
  document.body.classList.remove('portal-access-loading');
  ensureTextLayerControls();
  loadCollectionLists();
  loadRemittingBatches();
  const legacyRemittingBatches=[...remittingBatches];
  const collapsed=sectionCollapseState();
  const activeSection=portalSectionNames.find(name=>collapsed[name]===false)||'picker-section';
  portalSectionNames.forEach(name=>setSectionCollapsed(name,name!==activeSection));
  populateCollectionSelects();
  renderCollectionListManager();
  Object.entries(state.settings).forEach(([key, value])=>{
    const input = $('settingsForm').elements[key];
    if(input) input.value = value;
  });
  try{const {data:companies,error:ce}=await sb.from('companies').select('*');if(ce)throw ce;const bsgt=(companies||[]).find(c=>/بحر\s*سواكن|bahar\s*swaken/i.test(`${c.name_ar||''} ${c.name_en||''}`));if(!bsgt)throw new Error('لم يتم العثور على شركة بحر سواكن في بيانات الشركات.');await loadSharedCollectionBranding(bsgt);if(requestedTradeFileId){await loadTradeFileContext();}else{const [{data:rows,error:se},{data:paymentRows,error:pe}]=await Promise.all([sb.from('shipments').select('*').order('updated_at',{ascending:false}),sb.from('payments').select('*').order('paid_on')]);if(se)throw se;if(pe)console.warn('payments',pe);state.payments={};(paymentRows||[]).forEach(payment=>(state.payments[payment.shipment_id]??=[]).push(payment));state.shipments=(rows||[]).map(rowToShipment).filter(s=>s.companyId===bsgt.id);await migrateLegacyRemittingBatches(legacyRemittingBatches);rebuildRemittingBatches();}fillFilters();renderAll();if(!requestedTradeFileId)restoreRequestedCollectionOperation();}catch(error){$('shipmentList').innerHTML=`<div class="empty-state">تعذّر تحميل بوابة التحصيل التجاري: ${esc(error.message||error)}. تأكد من تسجيل الدخول في النظام الأساسي أولاً.</div>`;$('shipmentCount').textContent='لم تُحمّل البيانات';}}
['searchInput','currencyFilter','consigneeFilter'].forEach(id=>$(id).addEventListener('input',renderPicker));
$('settingsForm').addEventListener('input',event=>{if(!event.target.name)return;state.settings[event.target.name]=event.target.value;renderPreview();renderDebug();});
$('settingsForm').addEventListener('change',event=>{
  if(!event.target.name)return;
  if(event.target.name==='collectingBankProfile'){
    const profile=(collectionLists.collectingBankProfile||[]).find(item=>collectingBankProfileKey(item)===event.target.value);
    if(profile){ state.settings.collectingBank=profile.bank; state.settings.collectingBankAddress=profile.address; }
  }else state.settings[event.target.name]=event.target.value;
  renderPreview();renderDebug();
});
$('convertToAedBtn').addEventListener('click',()=>{state.convertToAed=!state.convertToAed;renderAll();});
$('collectionExchangeRate').addEventListener('input',event=>{state.exchangeRate=Number(event.target.value)||0;renderAll();});
$('compactRecordCollectionBtn').addEventListener('click',sendToRemittingBank);
$('collectionListField').addEventListener('change',renderCollectionListManager);
$('addCollectionListValue').addEventListener('click',()=>{
  const key=$('collectionListField').value, input=$('collectionListValue'), addressInput=$('collectionListAddress'), value=input.value.trim();
  if(!value){ input.focus(); return; }
  if(collectionListFields[key]?.paired){
    const address=addressInput.value.trim();
    if(!address){ addressInput.focus(); return; }
    const profile={bank:value,address};
    if(!(collectionLists[key]||[]).some(item=>collectingBankProfileKey(item)===collectingBankProfileKey(profile))) collectionLists[key].push(profile);
    state.settings.collectingBank=profile.bank; state.settings.collectingBankAddress=profile.address; input.value=''; addressInput.value='';
  }else{
    if(!collectionLists[key].includes(value)) collectionLists[key].push(value);
    state.settings[key]=value; input.value='';
  }
  saveCollectionLists(); populateCollectionSelects(); renderCollectionListManager(); renderPreview(); renderDebug();
});
$('collectionListValues').addEventListener('click',event=>{
  const button=event.target.closest('[data-remove-list-index]'); if(!button) return;
  const key=$('collectionListField').value, index=Number(button.dataset.removeListIndex), value=(collectionLists[key]||[])[index];
  collectionLists[key]=(collectionLists[key]||[]).filter((_,itemIndex)=>itemIndex!==index);
  if(collectionListFields[key]?.paired){
    if(value&&state.settings.collectingBank===value.bank&&state.settings.collectingBankAddress===value.address){
      const next=collectionLists[key][0]||{bank:'',address:''}; state.settings.collectingBank=next.bank; state.settings.collectingBankAddress=next.address;
    }
  }else if(state.settings[key]===value) state.settings[key]=key==='draweeAddress'?'':(collectionLists[key][0]||'');
  saveCollectionLists(); populateCollectionSelects(); renderCollectionListManager(); renderPreview(); renderDebug();
});
$('previewTabs').addEventListener('click',event=>{const button=event.target.closest('[data-preview]');if(!button)return;state.preview=button.dataset.preview;selectedTextBlock=null;selectedTextStyle=null;textBlockEditMode=false;renderPreview();});
$('groupByConsignee').addEventListener('click',()=>{const groups={};selectedShipments().forEach(r=>(groups[r.consignee||'غير محدد']??=[]).push(r));$('consigneeGroups').hidden=false;$('consigneeGroups').innerHTML=Object.entries(groups).map(([name,rows])=>`<b>${esc(name)}</b>: ${rows.map(r=>esc(r.shipmentNo)).join('، ')}`).join('<br>');});
$('resetBtn').addEventListener('click',()=>{state.selected.clear();state.activeOperationNo='';state.overrides={};$('settingsForm').reset();Object.assign(state.settings,{collectionDate:new Date().toISOString().slice(0,10),remittingBank:'Abu Dhabi Islamic Bank',remittingBankLetterAddress:'Abu Dhabi, UAE',remittingBankAddress:'BANIYAS BRANCH BUILDING, 2ND FLOOR, BANIYAS EAST, P.O.BOX 313, ABU DHABI, UAE.',remittingBankAccountNo:'19567664',collectingBank:'SAUDI SUDANESE BANK',collectingBankAddress:'MAIN BRANCH, FREE ZONE AREA, PORT SUDAN, SUDAN',billOfLadingType:'Copy of Original Bill of Lading',billBy:'KINDLY SEND SWIFT MESSAGE TO COLLECTING BANK FOR DOCS AND SHARE SWIFT COPY WITH US.',term:'D/A 90 DAYS FROM BILL OF EXCHANGE DATE.',drawer:'BAHAR SWAKEN GENERAL TRADING L.L.C',authorizedPerson:'JAWAD ELMASRI',title:'Manager',draweeAddress:''});populateCollectionSelects();Object.entries(state.settings).forEach(([key,value])=>{const input=$('settingsForm').elements[key];if(input)input.value=value;});renderAll();});
$('printBtn').addEventListener('click',()=>window.print());
$('recordCollectionBtn').addEventListener('click',sendToRemittingBank);
$('portalBackBtn').addEventListener('click',()=>{
  window.JahezSessionNavigation.navigateBackToJahez({fallback:requestedTradeFileId?'/#v=bsgtWorkspace&section=finance':'/#v=dashboard'});
});
$('portalLogoutBtn').addEventListener('click',logoutPortal);
document.querySelectorAll('[data-collapse-section]').forEach(button=>button.addEventListener('click',()=>{
  const sectionName=button.dataset.collapseSection;
  setSectionCollapsed(sectionName,!document.querySelector(`.${sectionName}`)?.classList.contains('section-is-collapsed'));
}));
document.querySelectorAll('[data-step-section]').forEach(card=>card.addEventListener('click',()=>openPortalSection(card.dataset.stepSection)));
$('printAllBtn').addEventListener('click', printAllCollectionDocuments);
$('saveDocumentLayoutBtn').addEventListener('click',saveCurrentDocumentLayout);
$('previewFocusBtn').addEventListener('click',()=>{ document.querySelector('.preview-section')?.classList.add('is-preview-focus'); updateDocumentEditorState(); });
$('closePreviewFocusBtn').addEventListener('click',()=>document.querySelector('.preview-section')?.classList.remove('is-preview-focus'));
$('resetStampBtn').addEventListener('click',()=>{ recordLayoutHistory(); try { localStorage.removeItem('bsCollectionStampOffset'); localStorage.removeItem(stampTransformStorageKey); } catch (_) {} markDocumentLayoutDirty(); renderPreview(); });
$('textOffsetX').addEventListener('input',event=>saveTextOffset('x',event.target.value));
$('textOffsetY').addEventListener('input',event=>saveTextOffset('y',event.target.value));
$('documentTextScale').addEventListener('input',event=>saveTextOffset('scale',event.target.value));
$('resetTextOffsetBtn').addEventListener('click',()=>{
  recordLayoutHistory();
  const offsets=collectionTextOffsets(); delete offsets[state.preview];
  try { localStorage.setItem(collectionTextOffsetStorageKey,JSON.stringify(offsets)); } catch (_) {}
  markDocumentLayoutDirty();
  renderPreview();
});
function resetCurrentPreviewLayout(){
  recordLayoutHistory();
  const clearPreview=(key)=>{
    try {
      const stored=JSON.parse(localStorage.getItem(key)||'{}')||{};
      delete stored[state.preview];
      localStorage.setItem(key,JSON.stringify(stored));
    } catch (_) {}
  };
  clearPreview(collectionTextOffsetStorageKey);
  clearPreview(collectionTextBlockOffsetStorageKey);
  clearPreview(collectionTextStyleStorageKey);
  clearPreview(collectionTextLayerStorageKey);
  try {
    const stamp=JSON.parse(localStorage.getItem(stampTransformStorageKey)||'{}')||{};
    if(stamp.positions) delete stamp.positions[state.preview];
    localStorage.setItem(stampTransformStorageKey,JSON.stringify(stamp));
  } catch (_) {}
  markDocumentLayoutDirty();
  selectedTextBlock=null;
  selectedTextStyle=null;
  textBlockEditMode=false;
  renderPreview();
}
$('toggleTextBlockModeBtn').addEventListener('click',()=>{ if(portalRole==='admin'){ textBlockEditMode=!textBlockEditMode; renderPreview(); } });
$('textStyleNormalBtn').addEventListener('click',resetSelectedTextFormatting);
$('textStyleBoldBtn').addEventListener('click',()=>{ if(!selectedTextStyle)return; const style=textStyleFor(selectedTextStyle.preview,selectedTextStyle.id); setSelectedTextStyle({weight:style.weight==='700'?'':'700'}); });
$('textStyleItalicBtn').addEventListener('click',()=>{ if(!selectedTextStyle)return; const style=textStyleFor(selectedTextStyle.preview,selectedTextStyle.id); setSelectedTextStyle({fontStyle:style.fontStyle==='italic'?'':'italic'}); });
$('textStyleUnderlineBtn').addEventListener('click',()=>{ if(!selectedTextStyle)return; const style=textStyleFor(selectedTextStyle.preview,selectedTextStyle.id); setSelectedTextStyle({textDecoration:style.textDecoration==='underline'?'':'underline'}); });
$('textStyleSmallerBtn').addEventListener('click',()=>{
  if(!selectedTextStyle) return; const style=textStyleFor(selectedTextStyle.preview,selectedTextStyle.id), node=selectedTextNode(); const current=style.fontSize||parseFloat(getComputedStyle(node).fontSize)||12; setSelectedTextStyle({fontSize:Math.max(6,current-.5),size:0});
});
$('textStyleLargerBtn').addEventListener('click',()=>{
  if(!selectedTextStyle) return; const style=textStyleFor(selectedTextStyle.preview,selectedTextStyle.id), node=selectedTextNode(); const current=style.fontSize||parseFloat(getComputedStyle(node).fontSize)||12; setSelectedTextStyle({fontSize:Math.min(32,current+.5),size:0});
});
[['textFontFamily','fontFamily'],['textFontWeight','weight'],['textAlignment','textAlign']].forEach(([id,key])=>$(id).addEventListener('change',event=>setSelectedTextStyle({[key]:event.target.value})));
[['textFontSize','fontSize'],['textLineHeight','lineHeight'],['textLetterSpacing','letterSpacing'],['textMarginTop','marginTop'],['textMarginBottom','marginBottom']].forEach(([id,key])=>$(id).addEventListener('change',event=>setSelectedTextStyle({[key]:event.target.value===''?(key==='letterSpacing'||key.startsWith('margin')?null:0):Number(event.target.value),...(key==='fontSize'?{size:0}:{})})));
document.querySelectorAll('.editor-control-grid input').forEach(input=>input.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); input.blur(); } }));
$('selectedTextX').addEventListener('change',event=>setSelectedPosition('x',event.target.value));
$('selectedTextY').addEventListener('change',event=>setSelectedPosition('y',event.target.value));
$('resetSelectedTextBlockBtn').addEventListener('click',()=>{
  if(!selectedTextBlock) return;
  recordLayoutHistory();
  const offsets=collectionTextBlockOffsets();
  if(offsets[selectedTextBlock.preview]) delete offsets[selectedTextBlock.preview][selectedTextBlock.index];
  try { localStorage.setItem(collectionTextBlockOffsetStorageKey,JSON.stringify(offsets)); } catch (_) {}
  const styles=collectionTextStyles();
  if(styles[selectedTextBlock.preview]) Object.keys(styles[selectedTextBlock.preview]).filter(id=>id===`block-${selectedTextBlock.index}`||id.startsWith(`block-${selectedTextBlock.index}-text-`)).forEach(id=>delete styles[selectedTextBlock.preview][id]);
  try { localStorage.setItem(collectionTextStyleStorageKey,JSON.stringify(styles)); } catch (_) {}
  markDocumentLayoutDirty();
  renderPreview();
});
document.addEventListener('keydown',event=>{
  if(portalRole!=='admin') return;
  if(['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement?.tagName)) return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){
    event.preventDefault();
    if(event.shiftKey) redoLayout(); else undoLayout();
    return;
  }
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){
    event.preventDefault(); redoLayout(); return;
  }
  if(!textBlockEditMode||!selectedTextBlock||selectedTextBlock.preview!==state.preview) return;
  const movement={ArrowLeft:['x',-1],ArrowRight:['x',1],ArrowUp:['y',-1],ArrowDown:['y',1]}[event.key];
  if(!movement) return;
  event.preventDefault();
  const [axis,direction]=movement, step=event.shiftKey?5:1;
  if(selectedTextStyle&&selectedTextStyle.preview===state.preview&&selectedTextStyle.id!==`block-${selectedTextBlock.index}`){
    const style=textStyleFor(selectedTextStyle.preview,selectedTextStyle.id);
    style[axis]+=direction*step;
    saveTextStyle(selectedTextStyle.preview,selectedTextStyle.id,style);
  }else{
    const offset=textBlockOffset(selectedTextBlock.preview,selectedTextBlock.index);
    offset[axis]+=direction*step;
    saveTextBlockOffset(selectedTextBlock.preview,selectedTextBlock.index,offset);
  }
  renderPreview();
});

function printAllCollectionDocuments(){
  if(!selectedShipments().length){ alert('اختر شحنة واحدة على الأقل قبل طباعة المستندات.'); return; }
  const originalPreview = state.preview;
  const previews = ['letter','undertaking','exchange'].map(kind=>{
    state.preview = kind;
    renderPreview();
    return $('documentPreview').innerHTML;
  });
  state.preview = originalPreview;
  renderPreview();
  const brandCss = document.getElementById('collectionBrandStyle')?.textContent || '';
  const popup = window.open('', '_blank');
  if(!popup){ alert('المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى.'); return; }
  popup.opener = null;
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>BSGT Collection Documents</title><link rel="stylesheet" href="/experiments/bs-collection/collection-lab.css?v=20260905-6"><link rel="stylesheet" href="/experiments/bs-collection/collection-lists.css?v=20260910-boe-meta-2"><style>${brandCss}.print-page{break-after:page;page-break-after:always}.print-page:last-child{break-after:auto;page-break-after:auto}@media screen{body{background:#eaf0f6}.print-page{padding:12mm 0}}</style></head><body>${previews.map(page=>`<section class="print-page">${page}</section>`).join('')}</body></html>`);
  popup.document.close();
  popup.onload = ()=>setTimeout(()=>popup.print(), 450);
}
function referenceDocumentsEnclosed(){
  return `<table><thead><tr><th>No</th><th>Type of Document</th><th>Original</th><th>Duplicate</th></tr></thead><tbody>
    <tr><td>1</td><td>BILL OF EXCHANGE</td><td>1</td><td>0</td></tr>
    <tr><td>2</td><td>COMMERCIAL INVOICE</td><td>2</td><td>0</td></tr>
    <tr><td>3</td><td>COPY B/L</td><td>0</td><td>2</td></tr>
    <tr><td>4</td><td>Certificate of Origin</td><td>2</td><td>0</td></tr>
  </tbody></table>`;
}

function renderPreview(){
  const {rows,currencies,consignees,totals}=detected();
  const s=state.settings;
  updateDocumentEditorState();
  const overflowNotice=$('documentOverflowNotice'); if(overflowNotice) overflowNotice.hidden=true;
  if(!rows.length){ $('documentPreview').innerHTML='<div class="empty-state">اختر شحنات أولاً لعرض مستندات التحصيل.</div>'; renderTextLayers($('documentPreview')); updateTextStyleControls(); return; }
  if(currencies.length!==1){ $('documentPreview').innerHTML='<div class="empty-state">لا يمكن إنشاء معاينة موحدة لمستند تحصيل متعدد العملات. اختر شحنات بعملة واحدة.</div>'; renderTextLayers($('documentPreview')); updateTextStyleControls(); return; }
  const collection=collectionTotal(rows), currency=collection.currency, total=collection.number, amount=formatMoney(currency,total), words=`${currency} ${amountWords(total)} ONLY`;
  const drawee=consignees.join(' / ')||'-';
  const draweeAddress=s.draweeAddress||rows[0].consigneeAddress||'-';
  const invoiceRefs=rows.map(r=>`${r.invoiceNo||'-'} dated ${r.invoiceDate||'-'}`).join('; ');
  const undertakingRows=rows.map((r,index)=>{const value=collectionMoney(r.totalAmount);const referenceLabel=index===0?`<th scope="rowgroup" rowspan="${rows.length}" data-text-style-id="undertaking-ref-label">REF #:</th>`:'';return `<tr>${referenceLabel}<td data-text-style-id="undertaking-invoice-${index}">${esc(r.invoiceNo||r.shipmentNo||'-')}</td><td data-text-style-id="undertaking-bill-${index}">${esc(r.billNo||'-')}</td><td data-text-style-id="undertaking-currency-${index}">${esc(value.currency)}</td><td data-text-style-id="undertaking-amount-${index}">${esc(value.number.toFixed(2))}</td></tr>`;}).join('');
  let body='';
  if(state.preview==='application'){
    body=`<article class="document-paper"><h2>COLLECTION APPLICATION</h2><p><b>REMITTING BANK:</b> ${esc(s.remittingBank)}<br><b>REMITTING BANK ADD:</b> ${esc(s.remittingBank)}<br><b>COLLECTING BANK:</b> ${esc(s.collectingBank)}<br><b>COLLECTING BANK ADD:</b> ${esc(s.collectingBankAddress||'-')}<br><b>Consignee:</b> ${esc(drawee)}<br><b>Con Address:</b> ${esc(draweeAddress)}</p><table><thead><tr><th>INVOICE NO.</th><th>DATE</th><th>B/L NO.</th><th>Total Amount</th></tr></thead><tbody>${docRows(rows)}</tbody></table><div class="document-total"><span>TOTAL AMOUNT</span><span>${esc(amount)}</span></div><h3>DOCUMENTS ENCLOSED</h3>${referenceDocumentsEnclosed()}<p><b>Bill of Lading Type:</b> ${esc(s.billOfLadingType)}<br><b>Bill By:</b> ${esc(s.billBy)}<br><b>Term Of Payment:</b> ${esc(s.term)}</p></article>`;
  }else if(state.preview==='letter'){
    body=`<article class="document-paper word-page-1"><p class="word-date">Date: <b>${esc(collectionDateText(s.collectionDate))}</b></p><p class="word-recipient">The Manager<br>${esc(s.remittingBank)}<br>Trade Finance Department<br>${esc(s.remittingBankLetterAddress)}</p><p>Dear sir,</p><p>We enclose herewith the following documents and request you to forward the same to collecting bank without any responsibility on your part requesting them to release the documents to drawee only against their <b>acceptance for payment on due date</b> without any responsibility on collecting bank and ${esc(s.remittingBank)}’s part and only upon receipt of funds from them, please credit the <b>proceeds</b> to our account no <b>${esc(s.remittingBankAccountNo)}</b> held with you after deduction of your charges under advice to us.</p><p><b>All bank charges outside UAE are to be collected from buyer/drawee</b></p><p class="word-collection-title">COLLECTION DOCUMENTS for:</p><p class="word-collection-data">Amount: <b>${esc(amount)}</b> SAY: <b>${esc(words)}</b></p><p>Tenor: <b>${esc(s.term)}</b></p><p class="word-bank-label">COLLECTING BANK<br><b>${esc(s.collectingBank)}</b><br><i>${esc(s.collectingBankAddress||'')}</i></p><p class="word-drawee">DRAWEE.<br><b>${esc(drawee)}</b><br><i>${esc(draweeAddress)}</i></p><p class="word-docs-title">DOCUMENTS ENCLOSED:</p><table class="word-documents"><thead><tr><th>No</th><th>Type of Document</th><th>Original</th><th>Duplicate</th></tr></thead><tbody><tr><td>1</td><td>BILL OF EXCHANGE</td><td>1</td><td>0</td></tr><tr><td>2</td><td>COMMERCIAL INVOICE</td><td>2</td><td>0</td></tr><tr><td>3</td><td>COPY B/L</td><td>0</td><td>2</td></tr><tr><td>4</td><td>Certificate of Origin</td><td>2</td><td>0</td></tr></tbody></table><p class="word-bill-by"><b>${esc(s.billBy)}</b></p><div class="word-signature">Yours faithfully,<br><br>For and on behalf of<br>${esc(s.drawer)}<br><br><b>${esc(s.authorizedPerson)}</b><br><b>${esc(s.title)}</b></div></article>`;
  }else if(state.preview==='undertaking'){
    body=`<article class="document-paper word-page-2"><div class="undertaking-head"><div class="undertaking-date">Dated: <b>${esc(collectionDateText(s.collectionDate))}</b></div><div>THE MANAGER<br>TRADE FINANCE DEPARTMENT<br>${esc(s.remittingBank)}<br>${esc(s.remittingBankAddress)}</div></div><h2>UNDERTAKING LETTER UNDER Export Collection Docs</h2><table class="undertaking-refs" aria-label="Shipment references"><tbody>${undertakingRows}</tbody></table><p class="undertaking-dear">Dear Sir / Madam,</p><ol class="undertaking-terms"><li>We hereby certify to ${esc(s.remittingBank)} PJSC (the “<u><b>Bank</b></u>”) that all enclosed Documents and any other document in relation to the underlying shipment or goods as described in the enclosed documents are accurate, correct and complete documents in full force and effect at the date of this letter.</li><li>[We hereby acknowledge that we have submitted <mark>${esc(s.billOfLadingType)}</mark> and certify that the Bank is the only bank handling the collection as the remitting bank and that we have not submitted (nor will we submit) the above Documents as a duplicate presentation to any other bank inside or outside the United Arab Emirates. The Bank may take any action which the Bank considers, in its sole and absolute discretion, required or appropriate to comply with laws, regulations, sanctions regimes, international guidance, the Bank's policies and procedures and/or requests of courts or regulatory authorities relating to the detection and prevention of money laundering and terrorism financing.]</li><li>The Bank shall be under no obligation to make any payment to us as seller/exporter/drawer in respect of the collection until it has received full payment from the collecting/presenting bank.</li><li>The Bank is entitled to deduct any charges for its services rendered under this letter.</li><li>The Bank is not obliged to check the Documents before sending them to the collecting/presenting bank.</li><li>The Bank shall not be liable for any losses or damages arising out of any delay or failure by the Bank in performing its services under this letter.</li><li>We hereby agree to indemnify the Bank and hold it harmless against all actions, proceedings and claims brought or threatened against it, and against all losses, damages, costs and expenses (including legal or attorney's fees) relating thereto, where such actions, proceedings, claims, losses, damages, costs and expenses have arisen out of or are in connection with our instruction under this letter <mark>including us submitting “${esc(s.billOfLadingType)}” as transport document(s).</mark></li><li>We hereby agree that the collection documents will be handled in accordance with the Uniform Rules for Collections, ICC publication number 522 (URC 522) or any subsequent revision thereof to the extent these rules are consistent with the federal laws of the United Arab Emirates and the laws of the Emirate of Abu Dhabi and with the rules and principles Islamic Shariah as interpreted by the Internal Shariah Supervisory Committee of the Bank.</li></ol><div class="undertaking-signature">Sincerely,<br><br>For and on behalf of:<br><br><b>${esc(s.drawer)}</b><br><br>Name:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${esc(s.authorizedPerson)}<br>Title:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${esc(s.title)}<br><br><br>Signature:</div></article>`;
  }else{
    body=`<article class="document-paper word-page-3"><h2>BILL OF EXCHANGE</h2><table class="boe-meta"><tbody><tr><td><div class="boe-meta-box"><span class="boe-meta-label" data-text-style-id="boe-amount-label">Amount:</span><strong class="boe-meta-value" data-text-style-id="boe-amount-value">${esc(amount)}</strong></div></td><td><div class="boe-meta-box"><span class="boe-meta-label" data-text-style-id="boe-date-label">DATED:</span><strong class="boe-meta-value" data-text-style-id="boe-date-value">${esc(collectionDateText(s.collectionDate))}</strong></div></td></tr></tbody></table><p class="boe-order"><b>AT&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${esc(s.term)} PAY TO THE ORDER OF</b><br>${esc(s.remittingBank)}, ABU DHABI - UAE&nbsp;&nbsp;&nbsp; <b>A SUM OF ${esc(amount)}</b></p><p class="boe-words">${esc(amountWords(total).toLowerCase())} ${esc(currency)} only <b>BEING VALUE DRAWN UNDER INVOICE #</b></p><table class="boe-invoices" aria-label="Invoice references"><tbody>${rows.map((r,index)=>`<tr><th scope="row" data-text-style-id="boe-invoice-${index}">${esc(r.invoiceNo||r.shipmentNo||'-')}</th><td data-text-style-id="boe-dated-label-${index}">Dated:</td><td data-text-style-id="boe-invoice-date-${index}">${esc(r.invoiceDate||'-')}</td></tr>`).join('')}</tbody></table><div class="boe-drawn"><b>Drawn On</b><br>${esc(drawee)}<br>${esc(draweeAddress)}</div><div class="boe-drawer"><b>Drawer</b><br>${esc(s.drawer)}<br>307, ALWAHA 1 DEIRA, DUBAI - UAE +97145773892</div></article>`;
  }
  $('documentPreview').innerHTML=body;
  $('documentPreview').querySelectorAll('mark').forEach(mark=>mark.replaceWith(...mark.childNodes));
  applyCollectionBranding();
  updateTextOffsetControls();
}

function collectionBrandingSettings(){
  return Object.assign({},localCollectionBrandingSettings(),sharedCollectionBranding);
}

function applyCollectionBranding(){
  const paper = document.querySelector('#documentPreview .document-paper');
  if(!paper) return;
  const settings = collectionBrandingSettings();
  const stamp = settings.showStamp === false ? '' : (settings.stamp || '');
  const signature = settings.signature || '';
  const stampPos = Object.assign({xPercent:78,yPercent:78,widthPercent:13,rotate:0}, settings.stampPosition || {});
  const signaturePos = Object.assign({xPercent:10,yPercent:81,widthPercent:23,rotate:0}, settings.signaturePosition || {});
  if(!document.getElementById('collectionBrandStyle')){
    document.head.insertAdjacentHTML('beforeend', `<style id="collectionBrandStyle">
      .collection-a4{position:relative;isolation:isolate;width:210mm!important;height:297mm!important;min-height:297mm!important;max-height:297mm!important;padding:0!important;overflow:hidden!important}
      .collection-a4>.collection-brand-layer{position:absolute;display:block;pointer-events:none}
      .collection-a4>.collection-brand-bg{inset:0;width:100%;height:100%;object-fit:fill;z-index:0}
      .collection-a4>.collection-page-content{position:relative;z-index:1;display:flex;flex-direction:column;height:297mm;padding:49mm 17mm 28mm;overflow-wrap:anywhere;transform-origin:top left}
      .collection-a4 .signature{margin-top:8mm!important;width:64mm!important;font-size:9.5px!important;line-height:1.25!important}
      .collection-a4 table,.collection-a4 table th,.collection-a4 table td{background:transparent!important;border-color:#000!important}
      .collection-a4 .document-total{background:transparent!important}
      .collection-a4 .collection-flow-seals{display:flex;align-items:flex-end;justify-content:space-between;gap:16mm;min-height:30mm;margin-top:auto;padding-top:8mm}
      .collection-a4 .collection-flow-seals img{position:relative;display:block;object-fit:contain;max-height:31mm;transform-origin:center}
      .collection-a4 .collection-stamp-overlay{position:absolute;z-index:3;display:block;pointer-events:auto!important;cursor:grab;touch-action:none;transform-origin:center}
      .collection-a4 .collection-stamp-overlay>img{width:100%;height:auto;max-height:none!important;pointer-events:none}
      .collection-a4 .collection-stamp-overlay:active{cursor:grabbing}
      .collection-a4 .collection-stamp-overlay.is-selected{outline:1px dashed #1768bd;outline-offset:4px}
      .collection-a4 .stamp-resize-handle{display:none;position:absolute;width:8px;height:8px;border:1px solid #1768bd;border-radius:2px;background:#fff;z-index:3}
      .collection-a4 .collection-stamp-overlay.is-selected .stamp-resize-handle{display:block}
      .collection-a4 .stamp-resize-handle.nw{top:-8px;left:-8px;cursor:nwse-resize}.collection-a4 .stamp-resize-handle.n{top:-8px;left:50%;margin-left:-4px;cursor:ns-resize}.collection-a4 .stamp-resize-handle.ne{top:-8px;right:-8px;cursor:nesw-resize}.collection-a4 .stamp-resize-handle.e{top:50%;right:-8px;margin-top:-4px;cursor:ew-resize}.collection-a4 .stamp-resize-handle.se{right:-8px;bottom:-8px;cursor:nwse-resize}.collection-a4 .stamp-resize-handle.s{bottom:-8px;left:50%;margin-left:-4px;cursor:ns-resize}.collection-a4 .stamp-resize-handle.sw{bottom:-8px;left:-8px;cursor:nesw-resize}.collection-a4 .stamp-resize-handle.w{top:50%;left:-8px;margin-top:-4px;cursor:ew-resize}
      .collection-a4 .text-move-guides{display:none;position:absolute;inset:0;z-index:2;pointer-events:none;background-image:linear-gradient(rgba(23,104,189,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(23,104,189,.12) 1px,transparent 1px);background-size:10mm 10mm}.collection-a4.is-text-guiding .text-move-guides{display:block}.collection-a4 .text-move-guides .guide-v,.collection-a4 .text-move-guides .guide-h{position:absolute;background:#1768bd;opacity:.72}.collection-a4 .text-move-guides .guide-v{top:0;bottom:0;left:50%;width:1px}.collection-a4 .text-move-guides .guide-h{left:0;right:0;top:50%;height:1px}
      .preview-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.preview-tools .preview-tabs{margin-bottom:0}.preview-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.stamp-hint{font-size:10px;color:#637d98}
      @media print{@page{size:A4;margin:0}.collection-a4{width:210mm!important;height:297mm!important;min-height:297mm!important;max-height:297mm!important;margin:0!important;box-shadow:none!important}.collection-a4>.collection-page-content{height:297mm;padding:49mm 17mm 28mm}.collection-a4 .stamp-resize-handle,.collection-a4 .text-move-guides{display:none!important}.collection-a4 .collection-stamp-overlay{outline:0!important}}
    </style>`);
  }
  paper.classList.add('collection-a4');
  const content = document.createElement('div');
  content.className = 'collection-page-content';
  const textOffset=textOffsetForPreview();
  content.style.setProperty('--collection-text-x', `${textOffset.x}mm`);
  content.style.setProperty('--collection-text-y', `${textOffset.y}mm`);
  Array.from(paper.childNodes).forEach(node=>content.append(node));
  const flowImage = (className, source, position) => source ? `<img class="${className}" src="${esc(source)}" alt="" style="width:${Math.max(10,Math.min(Number(position.widthPercent)||16,35))}%;transform:rotate(${Number(position.rotate)||0}deg)">` : '';
  const stampHandles=state.preview==='letter'?'<span class="stamp-resize-handle nw" data-resize="nw"></span><span class="stamp-resize-handle n" data-resize="n"></span><span class="stamp-resize-handle ne" data-resize="ne"></span><span class="stamp-resize-handle e" data-resize="e"></span><span class="stamp-resize-handle se" data-resize="se"></span><span class="stamp-resize-handle s" data-resize="s"></span><span class="stamp-resize-handle sw" data-resize="sw"></span><span class="stamp-resize-handle w" data-resize="w"></span>':'';
  const stampOverlay = stamp ? `<div class="collection-stamp-overlay" style="left:${Number(stampPos.xPercent)||78}%;top:${Number(stampPos.yPercent)||78}%;width:${Math.max(10,Math.min(Number(stampPos.widthPercent)||16,35))}%;transform:rotate(${Number(stampPos.rotate)||0}deg)" title="${state.preview==='letter'?'اسحب الختم أو استخدم المقابض لتحديد الحجم الموحد':'اسحب الختم لتحريك موضعه في هذه الصفحة'}"><img src="${esc(stamp)}" alt="">${stampHandles}</div>` : '';
  if(signature) content.insertAdjacentHTML('beforeend', `<div class="collection-flow-seals">${flowImage('collection-flow-signature', signature, signaturePos)}</div>`);
  paper.append(content);
  const background = settings.background ? `<img class="collection-brand-layer collection-brand-bg" src="${esc(settings.background)}" alt="">` : '';
  paper.insertAdjacentHTML('afterbegin', background);
  paper.insertAdjacentHTML('beforeend','<div class="text-move-guides" aria-hidden="true"><span class="guide-v"></span><span class="guide-h"></span></div>');
  paper.insertAdjacentHTML('beforeend', stampOverlay);
  prepareTextBlocks(content);
  applyDocumentTextScale(content);
  fitCollectionContent(content);
  scheduleTextOverflowCheck(content);
  wireCollectionStampDrag(paper);
}

function applyDocumentTextScale(content){
  const scale=Math.max(70,Math.min(115,Number(textOffsetForPreview().scale)||100))/100;
  if(scale===1) return;
  const nodes=[...content.querySelectorAll('[data-text-block], [data-text-block] *')];
  const sizes=nodes.map(node=>parseFloat(getComputedStyle(node).fontSize));
  nodes.forEach((node,index)=>{ if(Number.isFinite(sizes[index])) node.style.fontSize=`${sizes[index]*scale}px`; });
}

function fitCollectionContent(content){
  const translate = 'translate(var(--collection-text-x), var(--collection-text-y))';
  content.style.transform = translate;
  content.style.width = '';
  content.dataset.fitScale='1';
}

function wireCollectionStampDrag(paper){
  const stamp = paper.querySelector('.collection-stamp-overlay');
  if(!stamp || portalRole!=='admin') return;
  const preview=state.preview;
  const canResize=preview==='letter';
  let saved = {widthMm:0,positions:{}};
  try { saved = Object.assign(saved, JSON.parse(localStorage.getItem(stampTransformStorageKey) || '{}')); } catch (_) {}
  saved.positions=saved.positions||{};
  const paperRect=paper.getBoundingClientRect();
  const pxPerMm=(paperRect.width||1)/210;
  const stampRect=stamp.getBoundingClientRect();
  const defaultWidthMm=stampRect.width/pxPerMm;
  const defaultHeightMm=stampRect.height/pxPerMm;
  // Migrate the earlier shared position once, then retain one position per document page.
  if(!saved.widthMm){
    saved.widthMm=defaultWidthMm*(Number(saved.scale)||1);
  }
  const position=saved.positions[preview]||{
    xMm:Number.isFinite(saved.xMm)?saved.xMm:(stampRect.left-paperRect.left)/pxPerMm,
    yMm:Number.isFinite(saved.yMm)?saved.yMm:(stampRect.top-paperRect.top)/pxPerMm
  };
  saved.positions[preview]=position;
  const apply = () => {
    stamp.style.left = `${position.xMm*pxPerMm}px`;
    stamp.style.top = `${position.yMm*pxPerMm}px`;
    stamp.style.width = `${Math.max(12,saved.widthMm)*pxPerMm}px`;
  };
  apply();
  stamp.addEventListener('pointerdown', event=>{
    event.preventDefault();
    recordLayoutHistory();
    stamp.classList.add('is-selected');
    const handle=canResize?(event.target.dataset.resize||''):'';
    const start = {x:event.clientX,y:event.clientY,baseX:position.xMm,baseY:position.yMm,baseWidth:saved.widthMm};
    stamp.setPointerCapture(event.pointerId);
    const move = point=>{
      const dx=(point.clientX-start.x)/pxPerMm, dy=(point.clientY-start.y)/pxPerMm;
      if(!handle){
        position.xMm = start.baseX + dx;
        position.yMm = start.baseY + dy;
      }else{
        const horizontal=handle.includes('e')||handle.includes('w');
        const vertical=handle.includes('n')||handle.includes('s');
        const delta=horizontal ? (handle.includes('e')?dx:-dx) : (handle.includes('s')?dy:-dy)*(defaultWidthMm/defaultHeightMm);
        saved.widthMm=Math.max(12,Math.min(110,start.baseWidth+delta));
        if(horizontal&&handle.includes('w')) position.xMm=start.baseX+(start.baseWidth-saved.widthMm);
        if(vertical&&handle.includes('n')) position.yMm=start.baseY+(start.baseWidth-saved.widthMm)*(defaultHeightMm/defaultWidthMm);
      }
      apply();
    };
    const finish = ()=>{ try { localStorage.setItem(stampTransformStorageKey, JSON.stringify(saved)); } catch (_) {} markDocumentLayoutDirty(); stamp.removeEventListener('pointermove', move); stamp.removeEventListener('pointerup', finish); stamp.removeEventListener('pointercancel', finish); };
    stamp.addEventListener('pointermove', move);
    stamp.addEventListener('pointerup', finish);
    stamp.addEventListener('pointercancel', finish);
  });
}

window.addEventListener('beforeprint',()=>document.querySelectorAll('.collection-page-content').forEach(fitCollectionContent));
window.addEventListener('resize',()=>{ const content=document.querySelector('#documentPreview .collection-page-content'); if(content) scheduleTextOverflowCheck(content); });
sb.auth.onAuthStateChange((event,session)=>{
  if(event!=='SIGNED_OUT' || session || portalLogoutRequested) return;
  setTimeout(redirectPortalToLogin,0);
});
init();
