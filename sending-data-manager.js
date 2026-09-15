(async function(){
  'use strict';
  const $=id=>document.getElementById(id),api=window.JahezSendingData;
  const client=supabase.createClient('https://vthcmqqiexaedukduquv.supabase.co','sb_publishable_kYEMmAQ2KTETIabDTMz2ig_fNB8vo02',{auth:{storageKey:'shipdocs-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const store=api.createStore(client);let editing=null,busy=false;
  const status=text=>{$('sendingStatus').textContent=text;};
  const type=()=>$('sendingType').value;
  function render(){
    const meta=api.fields[type()];editing=null;$('sendingForm').reset();$('sendingFormTitle').textContent='إضافة قيمة جديدة';$('sendingCancel').hidden=true;
    $('sendingValue').parentElement.hidden=!!meta.long;$('sendingValue').required=!meta.long;$('sendingLongLabel').hidden=!meta.long;$('sendingLong').required=!!meta.long;
    $('sendingAddressLabel').hidden=!meta.paired;$('sendingAddress').required=!!meta.paired;
    const host=$('sendingItems');host.replaceChildren();
    for(const row of store.list(type(),true)){
      const entry=document.createElement('div');entry.className='sending-row';const p=document.createElement('p'),value=api.display(row);
      p.textContent=meta.paired?`${value.bank}\n${value.address}`:value;entry.append(p);
      const flag=document.createElement('small');flag.textContent=row.active===false?'معطلة':'مفعلة';entry.append(flag);
      const edit=document.createElement('button');edit.type='button';edit.textContent='تعديل';edit.onclick=()=>{
        editing=row.id;$('sendingFormTitle').textContent='تعديل القيمة';$('sendingCancel').hidden=false;
        $(meta.long?'sendingLong':'sendingValue').value=meta.paired?value.bank:value;$('sendingAddress').value=meta.paired?value.address:'';
        $(meta.long?'sendingLong':'sendingValue').focus();
      };entry.append(edit);
      const toggle=document.createElement('button');toggle.type='button';toggle.textContent=row.active===false?'تفعيل':'تعطيل';toggle.onclick=()=>run(async()=>{await store.setActive(type(),row.id,row.active===false);render();status('تم حفظ الحالة. القيم المحفوظة في المعاملات القديمة لا تتغير.');});entry.append(toggle);host.append(entry);
    }
    if(!host.children.length)host.textContent='لا توجد قيم محفوظة لهذا النوع.';
  }
  async function run(action){if(busy)return;busy=true;document.querySelectorAll('button,select').forEach(el=>el.disabled=true);try{await action();}catch(error){status(`تعذر الحفظ أو التحميل: ${error.message||error}`);}finally{busy=false;document.querySelectorAll('button,select').forEach(el=>el.disabled=false);}}
  $('sendingType').onchange=()=>{history.replaceState(null,'',`?type=${encodeURIComponent(type())}`);render();};
  $('sendingCancel').onclick=render;
  $('sendingReload').onclick=()=>run(async()=>{await store.load();render();status('تم تحديث القيم من قاعدة البيانات.');});
  $('sendingForm').onsubmit=event=>{event.preventDefault();run(async()=>{await store.save(type(),$(api.fields[type()].long?'sendingLong':'sendingValue').value,$('sendingAddress').value,editing);render();status('تم الحفظ في قاعدة البيانات.');});};
  try{
    const auth=await JahezSessionNavigation.restoreSession(client);if(auth.status==='network_error')throw auth.error;const session=auth.session;
    if(!session){sessionStorage.setItem('jahez:auth-return-path',location.pathname+location.search);location.replace('/?login=1');return;}
    const profile=await client.from('profiles').select('role,active').eq('id',session.user.id).single();if(profile.error)throw profile.error;
    if(profile.data?.role!=='admin'||profile.data.active===false){status('إدارة القوائم متاحة لمدير النظام فقط حسب الصلاحيات الحالية.');return;}
    await store.load();const migrated=await store.migrate(localStorage);
    $('sendingType').replaceChildren(...Object.entries(api.fields).map(([key,meta])=>{const option=document.createElement('option');option.value=key;option.textContent=meta.label;return option;}));
    const selected=new URLSearchParams(location.search).get('type');if(api.fields[selected])$('sendingType').value=selected;
    render();$('sendingManager').hidden=false;status(migrated.skipped?'تم التحميل. توجد قيم محلية غير مكتملة؛ النسخة المحلية محفوظة، راجع أسماء البنوك وعناوينها.':'القيم محفوظة في قاعدة البيانات ومتاحة عبر الأجهزة.');
  }catch(error){status(`تعذر تحميل القوائم: ${error.message||error}. تأكد من تطبيق تحديث قاعدة البيانات رقم 48.`);}
})();
