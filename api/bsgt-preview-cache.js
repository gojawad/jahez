'use strict';

// Process-local preview output only. Never stores credentials or writes Storage.
function createPreviewCache({maxBytes=32*1024*1024,maxEntryBytes=8*1024*1024,maxEntries=16,ttlMs=120000,now=Date.now}={}){
  const entries=new Map();let bytes=0;
  function remove(key){const entry=entries.get(key);if(entry){bytes-=entry.value.bytes.length;entries.delete(key);}}
  function prune(){for(const [key,entry] of entries)if(entry.expiresAt<=now())remove(key);}
  return {
    get(key){
      prune();const entry=entries.get(key);if(!entry)return null;
      entries.delete(key);entries.set(key,entry);
      return {...entry.value,bytes:Buffer.from(entry.value.bytes)};
    },
    set(key,value){
      prune();remove(key);
      if(value.bytes.length>Math.min(maxBytes,maxEntryBytes))return;
      while(entries.size&&(entries.size>=maxEntries||bytes+value.bytes.length>maxBytes))remove(entries.keys().next().value);
      if(maxEntries<1)return;
      const copy={bytes:Buffer.from(value.bytes),pageCount:value.pageCount,sourceCount:value.sourceCount};
      entries.set(key,{value:copy,expiresAt:now()+ttlMs});bytes+=copy.bytes.length;
    },
    clear(){entries.clear();bytes=0;},
    stats(){prune();return {entries:entries.size,bytes};}
  };
}

module.exports={createPreviewCache};
