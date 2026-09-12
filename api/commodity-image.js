'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vthcmqqiexaedukduquv.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PROVIDER_URL = 'https://commons.wikimedia.org/w/api.php';
const CACHE_DAYS = 30;
const MEMORY_CACHE = new Map();
const {normalizeItemDesc, normalizeHsCode, buildProviderQuery, isValidHttpsUrl} = require('../commodity-images');

function readRequestBody(req){
  if(req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve,reject)=>{
    let body='';
    req.setEncoding('utf8');
    req.on('data',chunk=>{ body+=chunk; if(body.length>20_000) reject(Object.assign(new Error('Request too large.'),{status:413})); });
    req.on('end',()=>{ try{ resolve(JSON.parse(body||'{}')); }catch{ reject(Object.assign(new Error('Invalid JSON.'),{status:400})); } });
    req.on('error',reject);
  });
}

function serviceHeaders(extra = {}){
  const headers = {apikey:SERVICE_KEY, ...extra};
  if(!SERVICE_KEY.startsWith('sb_secret_')) headers.Authorization = `Bearer ${SERVICE_KEY}`;
  return headers;
}

async function authorize(req){
  const token = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token) throw Object.assign(new Error('يلزم تسجيل الدخول.'), {status:401});
  if(!SERVICE_KEY) throw Object.assign(new Error('خدمة صور الأصناف غير مضبوطة على الخادم.'), {status:503});
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {headers:{apikey:SERVICE_KEY, Authorization:`Bearer ${token}`}});
  if(!userResponse.ok) throw Object.assign(new Error('انتهت جلسة الدخول.'), {status:401});
  const user = await userResponse.json();
  const query = new URLSearchParams({select:'id,role,active', id:`eq.${user.id}`, limit:'1'});
  const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?${query}`, {headers:serviceHeaders()});
  if(!profileResponse.ok) throw Object.assign(new Error('تعذر التحقق من الصلاحية.'), {status:503});
  const [profile] = await profileResponse.json();
  if(!profile || profile.active === false) throw Object.assign(new Error('الحساب غير نشط.'), {status:403});
  return profile;
}

function stripMarkup(value){
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try{ return await fetch(url, {...options, signal:controller.signal}); }
  finally{ clearTimeout(timer); }
}

function publicResult(row, fallbackQuery){
  const thumbnailUrl = isValidHttpsUrl(row?.thumbnail_url || row?.thumbnailUrl) ? (row.thumbnail_url || row.thumbnailUrl) : null;
  const imageUrl = isValidHttpsUrl(row?.image_url || row?.imageUrl) ? (row.image_url || row.imageUrl) : thumbnailUrl;
  return {
    imageUrl,
    thumbnailUrl,
    sourceUrl:isValidHttpsUrl(row?.source_url || row?.sourceUrl) ? (row.source_url || row.sourceUrl) : null,
    sourceName:String(row?.source_name || row?.sourceName || ''),
    attribution:String(row?.attribution || ''),
    query:String(row?.normalized_query || row?.query || fallbackQuery || ''),
    fallback:!thumbnailUrl
  };
}

async function readPersistentCache(normalizedQuery){
  const query = new URLSearchParams({select:'*', normalized_query:`eq.${normalizedQuery}`, expires_at:`gt.${new Date().toISOString()}`, limit:'1'});
  const response = await fetch(`${SUPABASE_URL}/rest/v1/commodity_image_cache?${query}`, {headers:serviceHeaders()});
  if(!response.ok) return null;
  const [row] = await response.json();
  return row || null;
}

async function writePersistentCache(row){
  const response = await fetch(`${SUPABASE_URL}/rest/v1/commodity_image_cache?on_conflict=normalized_query`, {
    method:'POST',
    headers:serviceHeaders({'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal'}),
    body:JSON.stringify(row)
  });
  return response.ok;
}

async function deletePersistentCache(normalizedQuery){
  const query = new URLSearchParams({normalized_query:`eq.${normalizedQuery}`});
  const response = await fetch(`${SUPABASE_URL}/rest/v1/commodity_image_cache?${query}`, {method:'DELETE',headers:serviceHeaders()});
  return response.ok;
}

async function searchWikimedia(itemDesc, hsCode){
  const providerQuery = buildProviderQuery({itemDesc, hsCode});
  const params = new URLSearchParams({
    action:'query', format:'json', formatversion:'2', generator:'search', gsrnamespace:'6',
    gsrsearch:providerQuery, gsrlimit:'8', prop:'imageinfo',
    iiprop:'url|mime|extmetadata', iiurlwidth:'480', origin:'*'
  });
  let response;
  for(let attempt=0; attempt<2; attempt++){
    try{
      response = await fetchWithTimeout(`${PROVIDER_URL}?${params}`, {headers:{'User-Agent':'JahezCommodityImages/1.0 (jahez.swaken.net)'}}, 5000);
      if(response.ok) break;
    }catch(error){
      if(attempt === 1) throw error;
    }
  }
  if(!response?.ok) return publicResult(null, providerQuery);
  const payload = await response.json();
  const candidates = (payload.query?.pages || []).map(page=>({page, info:page.imageinfo?.[0]})).filter(({page,info})=>{
    const mime = String(info?.mime || '').toLowerCase();
    const title = String(page?.title || '').toLowerCase();
    return info && /^image\/(jpeg|png|webp)$/.test(mime) && !/(person|people|portrait|man |woman |child|boy |girl )/.test(title);
  });
  const selected = candidates[0];
  if(!selected) return publicResult(null, providerQuery);
  const meta = selected.info.extmetadata || {};
  return publicResult({
    imageUrl:selected.info.url,
    thumbnailUrl:selected.info.thumburl || selected.info.url,
    sourceUrl:selected.info.descriptionurl,
    sourceName:'Wikimedia Commons',
    attribution:[stripMarkup(meta.Artist?.value || meta.Credit?.value), stripMarkup(meta.LicenseShortName?.value)].filter(Boolean).join(' · '),
    query:providerQuery
  }, providerQuery);
}

async function resolveCommodity(itemDesc, hsCode){
  const normalizedItem = normalizeItemDesc(itemDesc);
  const normalizedHs = normalizeHsCode(hsCode);
  const normalizedQuery = `${normalizedItem}|${normalizedHs}`;
  if(!normalizedItem) throw Object.assign(new Error('وصف الصنف مطلوب.'), {status:400});
  if(MEMORY_CACHE.has(normalizedQuery)) return MEMORY_CACHE.get(normalizedQuery);
  try{
    const cached = await readPersistentCache(normalizedQuery);
    if(cached){ const result = publicResult(cached, buildProviderQuery({itemDesc:normalizedItem, hsCode:normalizedHs})); MEMORY_CACHE.set(normalizedQuery, result); return result; }
  }catch(error){ console.warn('[commodity-image] cache read failed:', error.message); }
  const result = await searchWikimedia(normalizedItem, normalizedHs).catch(error=>{
    console.warn('[commodity-image] provider failed:', error.message);
    return publicResult(null, buildProviderQuery({itemDesc:normalizedItem, hsCode:normalizedHs}));
  });
  MEMORY_CACHE.set(normalizedQuery, result);
  const resolvedAt = new Date();
  const expiresAt = new Date(resolvedAt.getTime() + CACHE_DAYS * 86400000);
  writePersistentCache({
    normalized_query:normalizedQuery, item_desc:normalizedItem,
    image_url:result.imageUrl, thumbnail_url:result.thumbnailUrl, source_url:result.sourceUrl,
    source_name:result.sourceName, attribution:result.attribution,
    resolved_at:resolvedAt.toISOString(), expires_at:expiresAt.toISOString(),
    metadata:{providerQuery:result.query, fallback:result.fallback}
  }).catch(error=>console.warn('[commodity-image] cache write failed:', error.message));
  return result;
}

async function handler(req, res){
  res.setHeader('Cache-Control', 'private, max-age=300');
  try{
    if(!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Method not allowed'});
    const profile = await authorize(req);
    const itemDesc = String(req.query.q || '').slice(0, 160);
    const hsCode = String(req.query.hs || '').slice(0, 12);
    if(req.method === 'POST'){
      if(profile.role !== 'admin') throw Object.assign(new Error('هذا الإجراء متاح لمدير النظام فقط.'), {status:403});
      const body = await readRequestBody(req);
      const normalizedItem = normalizeItemDesc(itemDesc);
      const normalizedHs = normalizeHsCode(hsCode);
      const normalizedQuery = `${normalizedItem}|${normalizedHs}`;
      if(!normalizedItem) throw Object.assign(new Error('وصف الصنف مطلوب.'), {status:400});
      if(body.action === 'refresh'){
        MEMORY_CACHE.delete(normalizedQuery);
        if(!await deletePersistentCache(normalizedQuery)) throw Object.assign(new Error('تعذر تحديث كاش الصورة.'),{status:503});
        return res.status(200).json(await resolveCommodity(normalizedItem, normalizedHs));
      }
      if(body.action === 'override'){
        if(!isValidHttpsUrl(body.imageUrl)) throw Object.assign(new Error('رابط الصورة يجب أن يبدأ بـ https://'), {status:400});
        const providerQuery = buildProviderQuery({itemDesc:normalizedItem,hsCode:normalizedHs});
        const result = publicResult({imageUrl:body.imageUrl,thumbnailUrl:body.imageUrl,sourceUrl:body.sourceUrl,sourceName:'Admin override',attribution:body.attribution,query:providerQuery},providerQuery);
        const now = new Date(), expiresAt = new Date(now.getTime()+365*86400000);
        if(!await writePersistentCache({normalized_query:normalizedQuery,item_desc:normalizedItem,image_url:result.imageUrl,thumbnail_url:result.thumbnailUrl,source_url:result.sourceUrl,source_name:result.sourceName,attribution:result.attribution,resolved_at:now.toISOString(),expires_at:expiresAt.toISOString(),metadata:{manualOverride:true,providerQuery:result.query}})) throw Object.assign(new Error('تعذر حفظ صورة الصنف.'),{status:503});
        MEMORY_CACHE.set(normalizedQuery,result);
        return res.status(200).json(result);
      }
      throw Object.assign(new Error('إجراء غير صالح.'), {status:400});
    }
    return res.status(200).json(await resolveCommodity(itemDesc, hsCode));
  }catch(error){
    return res.status(error.status || 500).json({error:error.message || 'تعذر تحميل صورة الصنف.'});
  }
}

module.exports = handler;
module.exports._test = {stripMarkup, publicResult, searchWikimedia, resolveCommodity, MEMORY_CACHE};
