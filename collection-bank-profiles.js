(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.JahezCollectionBanks=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // This is the collection portal's existing list, not the separate bank_book.
  const STORAGE_KEY='bsCollectionDataLists';
  const DEFAULTS=Object.freeze([{bank:'SAUDI SUDANESE BANK',address:'MAIN BRANCH, FREE ZONE AREA, PORT SUDAN, SUDAN'}]);
  const key=profile=>`${profile.bank}|||${profile.address}`;
  const normalize=value=>({...value,bank:String(value?.bank||'').trim(),address:String(value?.address||'').trim()});
  function profiles(saved={}){
    const legacy=Array.isArray(saved.collectingBank)?saved.collectingBank:[];
    const rows=Array.isArray(saved.collectingBankProfile)?saved.collectingBankProfile:legacy.map((bank,index)=>({bank,address:saved.collectingBankAddress?.[index]||''}));
    const unique=new Map();
    for(const row of [...DEFAULTS,...rows].map(normalize)){
      if(row.bank)unique.set(key(row),{...unique.get(key(row)),...row});
    }
    return [...unique.values()];
  }
  function read(storage){
    let saved={};try{saved=JSON.parse(storage.getItem(STORAGE_KEY)||'{}')||{};}catch(_){}
    return profiles(saved);
  }
  return Object.freeze({STORAGE_KEY,DEFAULTS,key,normalize,profiles,read});
});
