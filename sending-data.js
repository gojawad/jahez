(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.JahezSendingData=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const prefix='collectionSending.';
  const fields=Object.freeze({
    remittingBank:{label:'البنك المُرسِل'},remittingBankLetterAddress:{label:'عنوان بنك الإرسال للخطاب',long:true},
    remittingBankAddress:{label:'عنوان بنك الإرسال للتعهد',long:true},remittingBankAccountNo:{label:'رقم حساب بنك الإرسال'},
    collectingBankProfile:{label:'بنك التحصيل وعنوانه',paired:true},billOfLadingType:{label:'نوع بوليصة الشحن'},
    billBy:{label:'تعليمات Bill By',long:true},term:{label:'شرط الدفع',long:true},drawer:{label:'المُصدّر / Drawer'},
    authorizedPerson:{label:'الشخص المفوض'},title:{label:'المنصب'},draweeAddress:{label:'عنوان المستورد',long:true}
  });
  const clean=value=>String(value??'').trim();
  const identity=value=>clean(value).toLowerCase();
  function encode(type,value,address=''){
    if(!fields[type])throw new Error('نوع القائمة غير معروف.');
    value=clean(value);address=clean(address);
    if(!value)throw new Error('أدخل قيمة للقائمة.');
    if(fields[type].paired&&!address)throw new Error('أدخل عنوان البنك المرتبط.');
    return {list_key:prefix+type,value:fields[type].paired?`${value}|||${address}`:value,linked_address:fields[type].paired?address:null};
  }
  function display(row){
    const type=row.list_key.slice(prefix.length);
    if(!fields[type]?.paired)return row.value;
    const suffix=`|||${row.linked_address||''}`;
    return {bank:row.value.endsWith(suffix)?row.value.slice(0,-suffix.length):row.value,address:row.linked_address||''};
  }
  function createStore(client){
    let rows=[];
    async function load(){
      const next=[];
      for(let offset=0;;offset+=500){
        const result=await client.from('lookups').select('id,list_key,value,linked_address,active,sort_order').in('list_key',Object.keys(fields).map(key=>prefix+key)).order('sort_order').order('id').range(offset,offset+499);
        if(result.error)throw result.error;next.push(...(result.data||[]));if((result.data||[]).length<500)break;
      }
      rows=next;return rows;
    }
    const list=(type,includeInactive=false)=>rows.filter(row=>row.list_key===prefix+type&&(includeInactive||row.active!==false));
    const values=type=>list(type).map(display);
    async function save(type,value,address,id){
      const data=encode(type,value,address);
      if(list(type,true).some(row=>row.id!==id&&identity(row.value)===identity(data.value)))throw new Error('هذه القيمة موجودة بالفعل في هذه القائمة، وقد تكون معطلة.');
      const query=id?client.from('lookups').update(data).eq('id',id).eq('list_key',prefix+type):client.from('lookups').insert(data);
      const result=await query.select('id').single();
      if(result.error){if(result.error.code==='23505')throw new Error('هذه القيمة موجودة بالفعل في هذه القائمة.');throw result.error;}
      await load();return result.data;
    }
    async function setActive(type,id,active){
      if(!fields[type])throw new Error('نوع القائمة غير معروف.');
      const result=await client.from('lookups').update({active}).eq('id',id).eq('list_key',prefix+type).select('id').single();if(result.error)throw result.error;await load();
    }
    // Import each legacy value once on this browser; never delete its local backup
    // or re-create a value that an administrator later edited/deactivated remotely.
    async function migrate(storage){
      const raw=storage.getItem('bsCollectionDataLists');if(!raw)return {imported:0,skipped:0};
      const saved=JSON.parse(raw),markerKey='jahez:sending-data-imported:v1';
      let marked=[];try{marked=JSON.parse(storage.getItem(markerKey)||'[]');}catch{}
      const done=new Set(marked),items=[];
      for(const [type,field] of Object.entries(fields)){
        let entries=Array.isArray(saved[type])?saved[type]:[];
        if(field.paired)entries=[...entries,...(Array.isArray(saved.collectingBank)?saved.collectingBank.map((bank,i)=>({bank,address:saved.collectingBankAddress?.[i]||''})):[])];
        for(const entry of entries)items.push({type,value:field.paired?entry?.bank:entry,address:field.paired?entry?.address:''});
      }
      let imported=0,skipped=0;
      for(const item of items){
        let data;try{data=encode(item.type,item.value,item.address);}catch{skipped++;continue;}
        const key=data.list_key+'\n'+identity(data.value);if(done.has(key))continue;
        if(!list(item.type,true).some(row=>identity(row.value)===identity(data.value))){
          try{await save(item.type,item.value,item.address);imported++;}catch(error){if(!String(error.message).includes('موجودة بالفعل'))throw error;}
        }
        done.add(key);storage.setItem(markerKey,JSON.stringify([...done]));
      }
      return {imported,skipped};
    }
    return {load,list,values,save,setActive,migrate};
  }
  return Object.freeze({fields,prefix,encode,display,createStore});
});
