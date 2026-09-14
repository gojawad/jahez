'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {PDFDocument,PDFName}=require('../experiments/bs-collection/collection-pdf-lib');
const handler=require('../api/bsgt-internal-document');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
async function pdf(){const d=await PDFDocument.create();d.addPage([595,842]);d.addPage([400,600]);return Buffer.from(await d.save());}
test('selective signatures and clones leave original PDF untouched',async()=>{
  const source=await pdf(),before=Buffer.from(source);
  const output=await handler.applySignature(source,PNG,[{page:1,x:.1,y:.2,width:.2,height:.1},{page:1,x:.5,y:.4,width:.2,height:.1,cloned:true}]);
  assert.deepEqual(source,before);
  const signed=await PDFDocument.load(output),original=await PDFDocument.load(source);
  assert.equal(signed.getPageCount(),2);assert.equal(original.getPageCount(),2);
  assert.equal(original.getPage(1).node.Resources()?.get(PDFName.of('XObject')),undefined);
  assert.ok(signed.getPage(1).node.Resources().get(PDFName.of('XObject')));
  for(const placement of [{page:2,x:0,y:0,width:.2,height:.1},{page:0,x:.9,y:0,width:.2,height:.1},{page:0,x:0,y:0,width:0,height:.1}])
    await assert.rejects(handler.applySignature(source,PNG,[placement]),/outside/);
  await assert.rejects(handler.applySignature(source,PNG,[]),/placements/);
});
test('internal API enforces authorization and server-owned document scope',async()=>{
  const savedFetch=global.fetch,savedKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';
  let edit=false,reads=[],writes=[],registered;
  const source=await pdf(),sourceBefore=Buffer.from(source);
  const bundle={file:{id:'case',revision_no:2,status:'under_management_review'},shipments:[{shipment:{id:'shipment'},revision:{documents:[{kind:'invoice',path:'shipment/revision/invoice.pdf'}]}}],documents:[]};
  global.fetch=async(url,options={})=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/has_bsgt_workspace_permission'))return Response.json(edit);
    if(path.endsWith('/bsgt_internal_package'))return Response.json(bundle);
    if(path.endsWith('/register_bsgt_internal_signature')){registered=JSON.parse(options.body);return Response.json({id:'signed'});}
    if(options.method==='POST'){writes.push(path);return Response.json({});}
    reads.push(path);return new Response(source);
  };
  async function call(body,token='test-user'){
    const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
    await handler({method:'POST',headers:{authorization:token?`Bearer ${token}`:''},body},res);return res;
  }
  const body={action:'sign',tradeFileId:'case',revisionNo:2,shipmentId:'shipment',kind:'invoice',path:'private/finance.pdf',image:PNG.toString('base64'),placements:[{page:0,x:.1,y:.1,width:.2,height:.1}]};
  try{
    assert.equal((await call(body,'')).code,401);
    assert.equal((await call(body)).code,409);assert.equal(reads.length,0);
    edit=true;
    assert.equal((await call({...body,shipmentId:'outside'})).code,409);assert.equal(reads.length,0);
    assert.equal((await call({...body,revisionNo:1})).code,409);assert.equal(writes.length,0);
    assert.equal((await call(body)).code,200);
    assert.deepEqual(reads,['/storage/v1/object/bsgt-operations-packages/shipment/revision/invoice.pdf']);
    assert.ok(writes.every(path=>path.startsWith('/storage/v1/object/trade-collection-documents/workflow/case/2/signed/')));
    assert.equal(registered.p_source_path,'shipment/revision/invoice.pdf');assert.deepEqual(source,sourceBefore);
  }finally{global.fetch=savedFetch;if(savedKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=savedKey;}
});
