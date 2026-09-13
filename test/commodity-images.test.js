'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const images = require('../commodity-images');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const endpoint = fs.readFileSync(path.join(root, 'api', 'commodity-image.js'), 'utf8');
const endpointModule = require('../api/commodity-image');
const migration = fs.readFileSync(path.join(root, 'supabase', '35_commodity_image_cache.sql'), 'utf8');
const operations = require('../bsgt-operations');

async function main(){
  assert.strictEqual(images.normalizeItemDesc('  WOVEN   FABRIC '), 'woven fabric', '1 normalize item description');
  assert.strictEqual(images.normalizeHsCode('HS 6307.90'), '630790', '2 normalize HS code');
  assert.strictEqual(images.buildProviderQuery({itemDesc:'TEXTTILE PIECE GOODS'}), 'textile piece goods fabric product', '3 normalize known typo without changing shipment');
  assert.ok(images.buildProviderQuery({itemDesc:'SCHOOL BAGS'}).includes('backpack product'), '4 object-oriented query');
  assert.strictEqual(images.isValidHttpsUrl('https://upload.wikimedia.org/a.jpg'), true, '5 HTTPS accepted');
  assert.strictEqual(images.isValidHttpsUrl('http://example.com/a.jpg'), false, '6 HTTP rejected');
  assert.strictEqual(images.isValidHttpsUrl('javascript:alert(1)'), false, '7 javascript rejected');
  assert.strictEqual(images.isValidHttpsUrl('data:image/png;base64,abc'), false, '8 data URL rejected');

  const calls = [];
  const resolver = images.createResolver({fetchImage:async payload=>{
    calls.push(payload);
    return {thumbnailUrl:'https://upload.wikimedia.org/thumb.jpg',imageUrl:'https://upload.wikimedia.org/full.jpg',sourceUrl:'https://commons.wikimedia.org/wiki/File:Goods.jpg'};
  }});
  const shipment = {itemDesc:'CURTAIN',hsCode:'6303',consignee:'PRIVATE BUYER',operationNo:'SECRET-1',totalAmount:'999999'};
  const first = await resolver.resolveCommodityImage(shipment);
  assert.strictEqual(calls.length, 1, '9 first item performs one lookup');
  assert.deepStrictEqual(calls[0], {itemDesc:'curtain',hsCode:'6303'}, '10 provider receives item and HS only');
  assert.ok(!JSON.stringify(calls).includes('PRIVATE BUYER'), '11 no customer sent');
  assert.ok(!JSON.stringify(calls).includes('SECRET-1'), '12 no shipment number sent');
  const second = await resolver.resolveCommodityImage({...shipment,consignee:'ANOTHER BUYER'});
  assert.strictEqual(calls.length, 1, '13 same commodity uses cache');
  assert.strictEqual(first, second, '14 selected shipment reuses the same cached image');
  await resolver.resolveUnique([shipment,shipment,{...shipment,consignee:'THIRD'}]);
  assert.strictEqual(calls.length, 1, '15 duplicate page items are batched');

  const failed = images.createResolver({fetchImage:async()=>{throw new Error('provider down');}});
  assert.strictEqual((await failed.resolveCommodityImage({itemDesc:'BLANKET'})).fallback, true, '16 provider failure uses fallback');
  await failed.resolveCommodityImage({itemDesc:'BLANKET'});
  assert.strictEqual(failed.cache.size, 0, 'failed client lookups are not cached');
  const invalid = images.createResolver({fetchImage:async()=>({thumbnailUrl:'file:///tmp/x.png'})});
  assert.strictEqual((await invalid.resolveCommodityImage({itemDesc:'BLANKET'})).fallback, true, '17 invalid provider URL uses fallback');

  const originalFetch = global.fetch;
  let providerCalls = 0;
  let cacheWrites = 0;
  try{
    global.fetch = async (url, options = {})=>{
      if(String(url).includes('/rest/v1/commodity_image_cache')){
        if(options.method === 'POST') cacheWrites++;
        return {ok:false, json:async()=>[]};
      }
      if(String(url).includes('commons.wikimedia.org/w/api.php')){
        providerCalls++;
        return {ok:true, json:async()=>({query:{pages:[]}})};
      }
      throw new Error(`Unexpected image test request: ${url}`);
    };
    endpointModule._test.MEMORY_CACHE.clear();
    const emptyFirst = await endpointModule._test.resolveCommodity('NO MATCH COMMODITY', '9999');
    const emptySecond = await endpointModule._test.resolveCommodity('NO MATCH COMMODITY', '9999');
    assert.strictEqual(emptyFirst.fallback && emptySecond.fallback, true, '18 provider misses use the placeholder');
    assert.ok(providerCalls >= 2, '19 empty provider results are retried instead of cached');
    assert.strictEqual(cacheWrites, 0, '20 empty provider results are not persisted');
  } finally {
    global.fetch = originalFetch;
    endpointModule._test.MEMORY_CACHE.clear();
  }

  let responseStatus = 0;
  let responseBody;
  await endpointModule({method:'GET',headers:{authorization:'Bearer test-token'},query:{q:'CURTAIN'}},{
    setHeader(){},
    status(code){ responseStatus=code; return this; },
    json(value){ responseBody=value; return this; }
  });
  assert.strictEqual(responseStatus, 503, '21 missing service key is reported explicitly');
  assert.match(responseBody.error, /غير مضبوطة/);

  assert.ok(html.includes('loading="lazy" referrerpolicy="no-referrer" alt="صورة توضيحية للصنف"'), '22 lazy and privacy attributes');
  assert.ok(html.includes(".select('id,status,owner_id") && html.includes('.range(from,to)'), '23 list remains server-side paginated');
  assert.ok(!endpoint.includes('shipment_files') && !endpoint.includes('shipment_package_attachments') && !endpoint.includes('recordToRow'), '24 image endpoint is isolated from shipment data and package merge');

  assert.ok(migration.includes('commodity_image_cache') && migration.includes("interval '30 days'"));
  assert.ok(migration.includes('enable row level security') && migration.includes('public.is_active()'));
  assert.ok(endpoint.includes('commons.wikimedia.org/w/api.php') && endpoint.includes('AbortController'));
  assert.strictEqual(operations.evaluateBsgtOperationsReadiness({operationNo:'1',consignee:'A',itemDesc:'B',proformaNo:'P',invoiceNo:'I'},[{document_type:'import_permit'},{document_type:'certificate_of_origin'},{document_type:'bill_of_lading'}]).completedCount,7);
  console.log('Commodity image resolver, isolation, cache, and UI contracts (24 cases): passed');
}

main().catch(error=>{console.error(error);process.exit(1);});
