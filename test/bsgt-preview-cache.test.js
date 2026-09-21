'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createPreviewCache}=require('../api/bsgt-preview-cache');
const {buildShipmentBundle}=require('../api/bsgt-trade-file-bundle');
const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');

test('preview cache bounds memory, expires entries and isolates buffers',()=>{
  let now=0;
  const cache=createPreviewCache({maxBytes:6,maxEntryBytes:4,maxEntries:2,ttlMs:10,now:()=>now});
  const value={bytes:Buffer.from('abc'),pageCount:1,sourceCount:1};
  cache.set('a',value);value.bytes[0]=0;
  assert.equal(cache.get('a').bytes.toString(),'abc');
  const hit=cache.get('a');hit.bytes[0]=0;
  assert.equal(cache.get('a').bytes.toString(),'abc');
  cache.set('b',{...value,bytes:Buffer.from('def')});cache.get('a');
  cache.set('c',{...value,bytes:Buffer.from('ghi')});
  assert.equal(cache.get('b'),null);assert.equal(cache.stats().bytes,6);
  cache.set('large',{...value,bytes:Buffer.alloc(5)});assert.equal(cache.get('large'),null);
  now=10;assert.equal(cache.get('a'),null);assert.deepEqual(cache.stats(),{entries:0,bytes:0});
  cache.set('d',value);cache.clear();assert.equal(cache.stats().entries,0);
  const disabled=createPreviewCache({maxEntries:0});disabled.set('x',value);assert.equal(disabled.get('x'),null);
});

async function fixture(scope){
  const file={id:'file',revision_no:1};
  const link={trade_file_id:'file',shipment_id:'shipment',operations_revision_id:'revision'};
  const shipment={id:'shipment',data:{qrPackagePath:'original-qr.pdf'}};
  const paths=['contract','proforma','invoice','packing','permit','origin'];
  const revision={id:'revision',shipment_id:'shipment',approved_at:'2026-09-21',package_path:'baseline',documents:paths.map(path=>({path}))};
  const bytes={};
  for(let i=0;i<paths.length;i++){
    const pdf=await PDFDocument.create();pdf.addPage([200+i,700]);bytes[paths[i]]=Buffer.from(await pdf.save());
  }
  bytes.baseline=bytes.contract;
  return {args:{file,link,shipment,revision,documents:[],attachments:[],mode:'current',cacheScope:scope},bytes};
}
async function widths(result){return (await PDFDocument.load(result.bytes)).getPages().map(page=>page.getWidth());}

test('bounded parallel reads preserve page order, input records and deduplication',async()=>{
  const {args,bytes}=await fixture('ordered');
  args.revision.documents.push({path:'contract'});
  const before=JSON.stringify(args);let active=0,peak=0;const completed=[],reads=[];
  const download=async(bucket,path)=>{
    reads.push(path);active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,path==='contract'?30:5));
    active--;completed.push(path);return bytes[path];
  };
  const result=await buildShipmentBundle({...args,download});
  assert.equal(peak,3);assert.equal(active,0);assert.notEqual(completed[0],'contract');
  assert.equal(reads.length,6);assert.deepEqual(await widths(result),[200,201,202,203,204,205]);
  assert.equal(JSON.stringify(args),before);
  peak=0;reads.length=0;
  const sequential=await buildShipmentBundle({...args,download,optimized:false});
  assert.equal(peak,1);assert.equal(sequential.cacheHit,undefined);
  assert.deepEqual(await widths(sequential),await widths(result));
});

test('cache revalidates source bytes, scope, signatures, archive state and revision',async()=>{
  const {args,bytes}=await fixture('invalidation');let reads=0;
  const download=async(bucket,path)=>{reads++;assert.ok(bytes[path],path);return bytes[path];};
  const run=(changes={})=>buildShipmentBundle({...args,download,...changes});
  assert.equal((await run()).cacheHit,undefined);
  assert.equal((await run()).cacheHit,true);assert.equal(reads,12,'cache still reads every authorized source');
  assert.equal((await run({cacheScope:'another-user'})).cacheHit,undefined);
  bytes.contract=bytes.origin;
  const changed=await run();assert.equal(changed.cacheHit,undefined);assert.equal((await widths(changed))[0],205);
  assert.equal((await run()).cacheHit,true);
  const signed={id:'signed',trade_file_id:'file',revision_no:1,is_active:true,shipment_id:'shipment',operations_revision_id:'revision',document_variant:'administration_signed',source_document_path:'contract',storage_path:'proforma',document_type:'contract'};
  const updated=await run({documents:[signed]});assert.equal(updated.cacheHit,undefined);
  assert.deepEqual(await widths(updated),[201,201,202,203,204,205],'signed copy replaces the first page in place, retaining the other originals');
  const archived=await run({documents:[{...signed,is_active:false}]});assert.equal(archived.cacheHit,undefined);assert.equal((await widths(archived))[0],205);
  assert.equal((await run({file:{...args.file,revision_no:2}})).cacheHit,undefined);
  assert.equal((await run({mode:undefined})).pageCount,1);
  assert.equal((await run({cacheScope:undefined})).cacheHit,undefined);
  assert.equal((await run({optimized:false})).cacheHit,undefined);
  await assert.rejects(run({download:async()=>{throw new Error('Storage denied');}}),/Storage denied/);
  await assert.rejects(run({download:async()=>Buffer.from('corrupt')}),/Unsupported/);
  assert.equal((await run()).cacheHit,true,'failures do not overwrite a good entry or serve it without authorization');
  await assert.rejects(run({link:{...args.link,shipment_id:'other'}}),/outside/);
});

test('failed download batch settles and does not start further downloads',async()=>{
  const {args,bytes}=await fixture('failure');let active=0;const reads=[];
  await assert.rejects(buildShipmentBundle({...args,download:async(bucket,path)=>{
    reads.push(path);active++;
    try{await new Promise(resolve=>setTimeout(resolve,5));if(path==='contract')throw new Error('Denied');return bytes[path];}
    finally{active--;}
  }}),/Denied/);
  assert.equal(active,0);assert.equal(reads.length,3);
});

test('synthetic latency comparison keeps identical page order',async t=>{
  const {args,bytes}=await fixture('synthetic-benchmark');
  const download=async(bucket,path)=>{
    await new Promise(resolve=>setTimeout(resolve,40));return bytes[path];
  };
  const results=[];
  for(const [label,optimized] of [['sequential',false],['parallel cold',true],['parallel warm',true]]){
    const start=performance.now();
    const result=await buildShipmentBundle({...args,download,optimized});
    const elapsed=Math.round(performance.now()-start);
    assert.deepEqual(await widths(result),[200,201,202,203,204,205]);
    results.push(`${label}: ${elapsed} ms`);
    if(label==='parallel warm')assert.equal(result.cacheHit,true);
  }
  t.diagnostic(`Synthetic only: 6 one-page PDFs, 40 ms per read; ${results.join('; ')}. Not a production latency guarantee.`);
});
