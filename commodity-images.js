'use strict';

(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  if(root) root.JahezCommodityImages = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  const QUERY_HINTS = [
    [/texttile|textile piece goods/i, 'textile piece goods fabric product'],
    [/woven fabric/i, 'woven textile fabric material'],
    [/school bags?|backpacks?/i, 'school backpack product isolated'],
    [/incense burner/i, 'incense burner product object'],
    [/curtains?/i, 'curtain textile product'],
    [/blankets?/i, 'blanket textile product']
  ];

  function normalizeItemDesc(value){
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US').slice(0, 160);
  }

  function normalizeHsCode(value){
    return String(value || '').replace(/[^0-9]/g, '').slice(0, 12);
  }

  function buildProviderQuery(input){
    const itemDesc = normalizeItemDesc(input && input.itemDesc);
    if(!itemDesc) return '';
    const mapped = QUERY_HINTS.find(([pattern])=>pattern.test(itemDesc));
    const base = mapped ? mapped[1] : `${itemDesc} product object`;
    const hsCode = normalizeHsCode(input && input.hsCode);
    return hsCode ? `${base} HS ${hsCode}` : base;
  }

  function isValidHttpsUrl(value){
    try{
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && Boolean(url.hostname);
    }catch{
      return false;
    }
  }

  function safeResult(value, itemDesc, hsCode){
    if(!value || !isValidHttpsUrl(value.thumbnailUrl || value.imageUrl)){
      return {itemDesc, hsCode, query:buildProviderQuery({itemDesc, hsCode}), imageUrl:null, thumbnailUrl:null, sourceUrl:null, sourceName:null, attribution:null, fallback:true};
    }
    return {
      itemDesc,
      hsCode,
      query:String(value.query || buildProviderQuery({itemDesc, hsCode})),
      imageUrl:isValidHttpsUrl(value.imageUrl) ? value.imageUrl : value.thumbnailUrl,
      thumbnailUrl:isValidHttpsUrl(value.thumbnailUrl) ? value.thumbnailUrl : value.imageUrl,
      sourceUrl:isValidHttpsUrl(value.sourceUrl) ? value.sourceUrl : null,
      sourceName:String(value.sourceName || ''),
      attribution:String(value.attribution || ''),
      fallback:false
    };
  }

  function createResolver(options = {}){
    if(typeof options.fetchImage !== 'function') throw new TypeError('fetchImage is required');
    const cache = options.cache || new Map();
    const pending = new Map();
    async function resolveCommodityImage(shipment){
      const itemDesc = normalizeItemDesc(shipment && shipment.itemDesc);
      const hsCode = normalizeHsCode(shipment && (shipment.hsCode || shipment.hs_code));
      if(!itemDesc) return safeResult(null, itemDesc, hsCode);
      const key = `${itemDesc}|${hsCode}`;
      if(cache.has(key)) return cache.get(key);
      if(pending.has(key)) return pending.get(key);
      const request = Promise.resolve()
        .then(()=>options.fetchImage({itemDesc, hsCode}))
        .then(value=>safeResult(value, itemDesc, hsCode))
        .catch(()=>safeResult(null, itemDesc, hsCode))
        .then(value=>{ cache.set(key, value); pending.delete(key); return value; });
      pending.set(key, request);
      return request;
    }
    async function resolveUnique(shipments){
      const unique = new Map();
      (shipments || []).forEach(shipment=>{
        const itemDesc = normalizeItemDesc(shipment && shipment.itemDesc);
        const hsCode = normalizeHsCode(shipment && (shipment.hsCode || shipment.hs_code));
        const key = `${itemDesc}|${hsCode}`;
        if(itemDesc && !unique.has(key)) unique.set(key, {itemDesc, hsCode});
      });
      return Promise.all([...unique.values()].map(resolveCommodityImage));
    }
    function invalidate(shipment){
      const itemDesc = normalizeItemDesc(shipment && shipment.itemDesc);
      const hsCode = normalizeHsCode(shipment && (shipment.hsCode || shipment.hs_code));
      cache.delete(`${itemDesc}|${hsCode}`);
    }
    return {resolveCommodityImage, resolveUnique, invalidate, cache};
  }

  return {normalizeItemDesc, normalizeHsCode, buildProviderQuery, isValidHttpsUrl, createResolver};
});
