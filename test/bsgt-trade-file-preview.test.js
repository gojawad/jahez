'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const handler=require('../api/bsgt-trade-file-preview');
const {buildShipmentBundle}=require('../api/bsgt-trade-file-bundle');
const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');
const fileId='11111111-1111-4111-8111-111111111111',documentId='22222222-2222-4222-8222-222222222222',shipmentId='33333333-3333-4333-8333-333333333333';
test('trade file preview enforces file, document, revision and storage RLS with no mutations',async()=>{
  const savedFetch=global.fetch,savedKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';
  let fileAccess=true,documentAccess=true,linked=true,storageAccess=true,storageReads=0;
  global.fetch=async(url,options)=>{
    assert.equal(options.method||'GET','GET');
    assert.equal(options.headers.Authorization,'Bearer employee-token','never elevate the caller to service role');
    if(url.includes('/rest/v1/trade_collection_files?'))return Response.json(fileAccess?[{id:fileId}]:[]);
    if(url.includes('/rest/v1/trade_collection_file_documents?')||url.includes('/rest/v1/trade_collection_relations_attachments?')){
      assert.ok(url.includes(`trade_file_id=eq.${fileId}`));return Response.json(documentAccess?[{storage_path:'saved/document.pdf'}]:[]);
    }
    if(url.includes('/rest/v1/trade_collection_file_shipments?'))return Response.json(linked?[{shipment_id:shipmentId}]:[]);
    if(url.includes('/rest/v1/shipment_files?'))return Response.json(documentAccess?[{shipment_id:shipmentId,path:'saved/upload.pdf'}]:[]);
    if(url.includes('/rest/v1/bsgt_operations_revisions?')){
      assert.ok(url.includes(`shipment_id=eq.${shipmentId}`));assert.ok(url.includes('approved_at=not.is.null'));
      return Response.json(documentAccess?[{package_path:'saved/package.pdf',documents:[{kind:'invoice',path:'saved/invoice.pdf'}]}]:[]);
    }
    assert.ok(url.includes('/storage/v1/object/authenticated/'));
    assert.ok(!url.includes('attacker'));storageReads++;
    return new Response(storageAccess?'%PDF-test':'Forbidden',{status:storageAccess?200:403});
  };
  async function invoke(source,extra={}){
    const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({method:'POST',headers:{authorization:'Bearer employee-token'},body:{fileId,documentId,source,kind:'invoice',path:'attacker/private.pdf',...extra}},res);return res;
  }
  try{
    for(const source of ['collection','relations','operations','uploaded']){
      const result=await invoke(source);assert.equal(result.code,200);assert.equal(result.body.mimeType,'application/pdf');
      assert.equal(Buffer.from(result.body.base64,'base64').toString(),'%PDF-test');
    }
    assert.equal((await invoke('operations',{kind:'package'})).code,200);
    const before=storageReads;
    fileAccess=false;assert.equal((await invoke('collection')).code,403);fileAccess=true;
    documentAccess=false;assert.equal((await invoke('collection')).code,403);documentAccess=true;
    linked=false;assert.equal((await invoke('operations')).code,403);assert.equal((await invoke('uploaded')).code,403);linked=true;
    assert.equal((await invoke('operations',{kind:'other'})).code,403);
    assert.equal((await invoke('unknown')).code,403);
    assert.equal(storageReads,before,'out-of-scope references must not reach storage');
    storageAccess=false;assert.equal((await invoke('collection')).code,403);
    const res={setHeader(){},status(code){this.code=code;return this;},json(){return this;}};
    await handler({method:'POST',headers:{}},res);assert.equal(res.code,401);
  }finally{global.fetch=savedFetch;if(savedKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=savedKey;}
});

async function pageBytes(width){const pdf=await PDFDocument.create();pdf.addPage([width,700]);return Buffer.from(await pdf.save());}
test('shipment bundle preserves ordered stages, current revisions and shipment boundaries without modifying originals',async()=>{
  const file={id:fileId,revision_no:2},link={trade_file_id:fileId,shipment_id:shipmentId,operations_revision_id:documentId};
  const shipment={id:shipmentId,data:{qrPackagePath:'legacy.pdf'}};
  const revision={id:documentId,shipment_id:shipmentId,approved_at:'2026-09-15',package_path:'operations.pdf'};
  const common={trade_file_id:fileId,revision_no:2,is_active:true};
  const documents=[
    {...common,id:'finance',document_variant:'finance_original',document_type:'letter',storage_path:'finance.pdf'},
    {...common,id:'signed',shipment_id:shipmentId,operations_revision_id:documentId,document_variant:'administration_signed',document_type:'letter',storage_path:'signed.pdf'},
    {...common,id:'duplicate',document_type:'letter',storage_path:'finance.pdf'},
    {...common,id:'sibling',shipment_id:'other',storage_path:'must-not-read.pdf'},
    {...common,id:'archive',is_active:false,storage_path:'must-not-read.pdf'},
    {...common,id:'old',revision_no:1,storage_path:'must-not-read.pdf'},
    {...common,id:'wrong-file',trade_file_id:'other',storage_path:'must-not-read.pdf'},
    {...common,id:'wrong-revision',shipment_id:shipmentId,operations_revision_id:'old',document_variant:'administration_signed',storage_path:'must-not-read.pdf'}
  ];
  const attachments=[{...common,id:'relations',shipment_id:shipmentId,attachment_type:'company_letter',storage_path:'relations.pdf'},
    {...common,id:'sibling',shipment_id:'other',storage_path:'must-not-read.pdf'}];
  const inputs={file,link,shipment,revision,documents,attachments},before=JSON.stringify(inputs),reads=[];
  const sizes={'operations.pdf':201,'legacy.pdf':200,'finance.pdf':202,'signed.pdf':203,'relations.pdf':204};
  const download=async(bucket,path)=>{assert.ok(sizes[path]);reads.push([bucket,path]);return pageBytes(sizes[path]);};
  const result=await buildShipmentBundle({...inputs,download});
  assert.equal(result.sourceCount,4);assert.equal(result.pageCount,4);
  assert.deepEqual((await PDFDocument.load(result.bytes)).getPages().map(p=>p.getWidth()),[201,202,203,204]);
  assert.equal(JSON.stringify(inputs),before,'source records stay unchanged');
  assert.deepEqual(reads.map(r=>r[1]),['operations.pdf','finance.pdf','signed.pdf','relations.pdf']);
  const legacy=await buildShipmentBundle({...inputs,link:{...link,operations_revision_id:null},revision:null,documents:[],attachments:[],download});
  assert.equal((await PDFDocument.load(legacy.bytes)).getPage(0).getWidth(),200);
  assert.equal(reads.at(-1)[0],'shipment-files');
  await assert.rejects(buildShipmentBundle({...inputs,link:{...link,operations_revision_id:null},shipment:{id:shipmentId,data:{}},download}),/OPERATIONS_PACKAGE_MISSING/);
  await assert.rejects(buildShipmentBundle({...inputs,revision:{...revision,approved_at:null},download}),/Approved operations/);
  await assert.rejects(buildShipmentBundle({...inputs,link:{...link,shipment_id:'other'},download}),/outside/);
  await assert.rejects(buildShipmentBundle({...inputs,download:async(bucket,path)=>path==='finance.pdf'?Buffer.from('broken'):pageBytes(201)}),/Unsupported/);
  await assert.rejects(buildShipmentBundle({...inputs,download:async()=>{throw new Error('Storage denied');}}),/Storage denied/);
});

test('complete shipment API resolves authorized stored paths and blocks unrelated shipments',async()=>{
  const savedFetch=global.fetch,savedKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';let linked=true,storageReads=0,legacy=false,missing=false;
  const pdf=await pageBytes(230);
  global.fetch=async(url,options)=>{
    assert.equal(options.method||'GET','GET');assert.equal(options.headers.Authorization,'Bearer employee-token');
    const parsed=new URL(url),table=parsed.pathname.split('/').pop(),params=parsed.searchParams;
    if(table==='trade_collection_files')return Response.json([{id:fileId,revision_no:2}]);
    if(table==='trade_collection_file_shipments'){
      assert.equal(params.get('trade_file_id'),`eq.${fileId}`);assert.equal(params.get('shipment_id'),`eq.${shipmentId}`);
      return Response.json(linked?[{trade_file_id:fileId,shipment_id:shipmentId,operations_revision_id:legacy?null:documentId}]:[]);
    }
    if(table==='shipments')return Response.json([{id:shipmentId,data:{qrPackagePath:missing?null:'legacy.pdf'}}]);
    if(table==='bsgt_operations_revisions'){
      assert.equal(params.get('shipment_id'),`eq.${shipmentId}`);assert.equal(params.get('approved_at'),'not.is.null');
      return Response.json([{id:documentId,shipment_id:shipmentId,approved_at:'2026-09-15',package_path:'operations.pdf'}]);
    }
    if(['trade_collection_file_documents','trade_collection_relations_attachments'].includes(table)){
      assert.equal(params.get('trade_file_id'),`eq.${fileId}`);assert.equal(params.get('revision_no'),'eq.2');assert.equal(params.get('is_active'),'eq.true');
      assert.equal(params.get('or'),`(shipment_id.is.null,shipment_id.eq.${shipmentId})`);return Response.json([]);
    }
    assert.ok(url.includes('/storage/v1/object/authenticated/'));assert.ok(!url.includes('attacker'));storageReads++;
    return new Response(pdf);
  };
  async function invoke(){const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({method:'POST',headers:{authorization:'Bearer employee-token'},body:{fileId,source:'shipment',documentId:shipmentId,path:'attacker.pdf'}},res);return res;}
  try{
    const result=await invoke();assert.equal(result.code,200);assert.equal(result.body.pageCount,1);
    assert.equal((await PDFDocument.load(Buffer.from(result.body.base64,'base64'))).getPageCount(),1);
    linked=false;const before=storageReads;assert.equal((await invoke()).code,403);assert.equal(storageReads,before);
    linked=true;legacy=true;assert.equal((await invoke()).code,200);
    missing=true;assert.equal((await invoke()).code,409);
  }finally{global.fetch=savedFetch;if(savedKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=savedKey;}
});

test('current mode bundles one up-to-date copy of each document with signed versions substituted in place',async()=>{
  const file={id:fileId,revision_no:2},link={trade_file_id:fileId,shipment_id:shipmentId,operations_revision_id:documentId};
  const shipment={id:shipmentId,data:{}};
  const revision={id:documentId,shipment_id:shipmentId,approved_at:'2026-09-15',package_path:'operations.pdf',documents:[{kind:'contract',path:'ops/contract.pdf'},{kind:'invoice',path:'ops/invoice.pdf'}]};
  const common={trade_file_id:fileId,revision_no:2,is_active:true};
  const signedCommon={...common,shipment_id:shipmentId,operations_revision_id:documentId,document_variant:'administration_signed'};
  const documents=[
    {...common,id:'letter',document_variant:'finance_original',document_type:'letter',storage_path:'finance/letter.pdf'},
    {...common,id:'undertaking',document_variant:'finance_original',document_type:'undertaking',storage_path:'finance/undertaking.pdf'},
    {...signedCommon,id:'s-contract-old',document_type:'contract',storage_path:'signed/contract-old.pdf',source_document_path:'ops/contract.pdf',created_at:'2026-09-16'},
    {...signedCommon,id:'s-contract',document_type:'contract',storage_path:'signed/contract.pdf',source_document_path:'ops/contract.pdf',created_at:'2026-09-17'},
    {...signedCommon,id:'s-letter',document_type:'letter',storage_path:'signed/letter.pdf',source_document_path:'finance/letter.pdf',created_at:'2026-09-17'}
  ];
  const attachments=[{...common,id:'relations',shipment_id:shipmentId,attachment_type:'company_letter',storage_path:'relations.pdf'}];
  const sizes={'operations.pdf':100,'ops/contract.pdf':201,'ops/invoice.pdf':202,'finance/letter.pdf':301,'finance/undertaking.pdf':302,'signed/contract.pdf':401,'signed/contract-old.pdf':400,'signed/letter.pdf':402,'relations.pdf':500};
  const reads=[];const download=async(bucket,path)=>{assert.ok(sizes[path],path);reads.push([bucket,path]);return pageBytes(sizes[path]);};
  const result=await buildShipmentBundle({file,link,shipment,revision,documents,attachments,download,mode:'current'});
  assert.deepEqual((await PDFDocument.load(result.bytes)).getPages().map(p=>p.getWidth()),[401,202,402,302,500],'signed contract, original invoice, signed letter, original undertaking, relations attachment');
  assert.ok(!reads.some(r=>r[1]==='operations.pdf'),'the historical merged package is not duplicated in current mode');
  assert.ok(!reads.some(r=>r[1]==='signed/contract-old.pdf'),'only the newest active signed version is used');
  assert.deepEqual(reads.filter(r=>r[1].startsWith('signed/')).map(r=>r[0]),['trade-collection-documents','trade-collection-documents']);
  const historical=await buildShipmentBundle({file,link,shipment,revision,documents,attachments,download});
  assert.equal((await PDFDocument.load(historical.bytes)).getPage(0).getWidth(),100,'default mode still starts with the historical package');
});
