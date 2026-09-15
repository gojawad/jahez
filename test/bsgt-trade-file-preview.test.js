'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const handler=require('../api/bsgt-trade-file-preview');
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
