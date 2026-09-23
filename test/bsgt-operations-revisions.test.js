'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PDFDocument } = require('../experiments/bs-collection/collection-pdf-lib');
const { buildPackage } = require('../api/bsgt-operations-package');

test('merge routing refreshes stale detail state before applying legacy gates', async () => {
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const source=html.slice(html.indexOf('async function requestBsgtPackageMerge('),html.indexOf('async function mergeBsgtPackageLocally('));
  for(const stage of ['operations_draft','ready_for_finance','final_accepted']){
    const latest={id:'shipment',bsgtStage:stage,operationsRevisionId:stage==='ready_for_finance'?'r2':null};
    const calls=[];
    const context={records:[latest],document:{getElementById:()=>null},console,
      fetchLatestShipmentWorkflowState:async()=>{calls.push('read');return {record:latest,files:[]};},
      chooseDocLang:(record,callback,options)=>{assert.equal(options.persist,false);calls.push('language');callback('ar');},
      mergeBsgtOperationsPackage:async(id,lang)=>{assert.equal(lang,'ar');calls.push('operations');},
      window:{JahezRevisionWorkflow:{previewOperations:async()=>calls.push('preview')}},
      ensureBsgtPackageMergeAllowed:async()=>{calls.push('legacy');return {allowed:false};},
      showShipmentWorkflowDialog:async()=>{throw new Error('Unexpected workflow error');}
    };
    vm.createContext(context);vm.runInContext(source,context);
    await context.requestBsgtPackageMerge({id:'shipment',bsgtStage:'ready_for_finance'});
    assert.deepEqual(calls,stage==='operations_draft'?['read','language','operations']:['read',stage==='ready_for_finance'?'preview':'legacy']);
  }
});

test('operations merge respects selected language and refuses the old auto-send backend', async () => {
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../bsgt-revision-workflow.js'),'utf8');
  for(const language of ['ar','en']){
    const rendered=[],requests=[];
    let workflowVersion=1;
    const context={window:{},document:{},console,escapeHtml:String,
      JahezBsgtOperations:{GENERATED_LABELS:{}},JahezBsgtManagement:{DOCUMENTS:{}},
      ensureQrToken:async()=>{},rowToRecord:row=>row,PDFLib:{PDFDocument},
      appendBsgtBrowserlessPagePdf:async(pdf,record,kind,lang)=>{rendered.push([kind,lang]);pdf.addPage();},
      btoa:value=>Buffer.from(value,'binary').toString('base64'),
      sb:{rpc:async()=>({data:{workflowVersion,shipment:{id:'test'},fingerprint:'a'.repeat(32),generated:{contract:true,proforma:true,invoice:true,packing:true}}}),
        auth:{getSession:async()=>({data:{session:{access_token:'test-token'}}})}},
      fetch:async(url,options)=>{requests.push([url,JSON.parse(options.body)]);return {ok:true,json:async()=>({shipment:{id:'test',bsgt_stage:'operations_draft'}})};}
    };
    vm.createContext(context);vm.runInContext(source,context);
    const qrReady=context.window.JahezRevisionWorkflow.hasOperationsQrPackage;
    assert.equal(qrReady({qrToken:'permanent_test_token_12345'}),false,'a generated QR token alone is not a published package');
    assert.equal(qrReady({operationsRevisionId:'revision'}),false,'a QR link is also required');
    assert.equal(qrReady({operationsRevisionId:'revision',qrToken:'permanent_test_token_12345'}),true);
    await assert.rejects(context.window.JahezRevisionWorkflow.mergeOperations({id:'test'},language),/SQL 47/);
    assert.equal(requests.length,0,'old backend cannot be called to auto-send');
    assert.equal(rendered.length,0,'old backend is rejected before rendering');
    workflowVersion=2;
    const saved=await context.window.JahezRevisionWorkflow.mergeOperations({id:'test'},language);
    assert.equal(saved.bsgt_stage,'operations_draft');
    assert.deepEqual(rendered.map(item=>item[1]),Array(4).fill(language));
    assert.equal(requests[0][1].language,language);
    assert.equal(requests[0][0],'/api/bsgt-operations-package');
  }
});

async function fixture() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const bytes = Buffer.from(await doc.save());
  return {
    bytes,
    input: { shipment: { id: 'shipment' },
      generated: { contract:true, proforma:true, invoice:true, packing:true },
      files: ['import_permit','certificate_of_origin','bill_of_lading'].map(kind => ({kind,id:kind,path:`source/${kind}`})) },
    generated: Object.fromEntries(['contract','proforma','invoice','packing'].map(kind => [kind,bytes.toString('base64')]))
  };
}

test('package stores only approved operations sources and immutable revision paths', async () => {
  const f = await fixture(), writes = new Map(), reads = [];
  const result = await buildPackage(f.input, f.generated, async path => { reads.push(path); return f.bytes; },
    async (path,bytes) => writes.set(path,bytes), 'revision-1');
  assert.equal(result.documents.length, Object.keys(f.input.generated).length + f.input.files.length);
  assert.deepEqual(reads,f.input.files.map(file => file.path));
  assert.ok(result.documents.every(doc => doc.source === 'operations' && doc.path.startsWith('shipment/revision-1/')));
  const pdf = await PDFDocument.load(writes.get(result.packagePath));
  assert.equal(pdf.getPageCount(), result.documents.length);
  const first = writes.get(result.packagePath);
  await buildPackage(f.input, f.generated, async () => f.bytes, async (path,bytes) => writes.set(path,bytes), 'revision-2');
  assert.strictEqual(writes.get(result.packagePath), first);
});

test('finance/admin documents cannot be appended by manipulating generated or uploaded scope', async () => {
  const f = await fixture();
  await assert.rejects(buildPackage(f.input, {...f.generated,letter:f.generated.invoice},async()=>f.bytes,async()=>{},'r'), /scope/);
  const poisoned = {...f.input,files:[...f.input.files,{kind:'signed_document',path:'private/signature.pdf'}]};
  await assert.rejects(buildPackage(poisoned,f.generated,async path=>{
    assert.notEqual(path,'private/signature.pdf'); return f.bytes;
  },async()=>{},'r'), /scope/);
});

test('merged PDF restores legacy order and saved preferences without changing document contents or scope', async () => {
  const defaults = ['contract','import_permit','proforma','invoice','certificate_of_origin','bill_of_lading','packing'];
  const sources = new Map();
  for (const [index,kind] of defaults.entries()) {
    const pdf = await PDFDocument.create();
    pdf.addPage([300 + index * 10, 700]);
    pdf.addPage([301 + index * 10, 700]);
    sources.set(kind, Buffer.from(await pdf.save()));
  }
  const cases = [
    [undefined, defaults],
    [null, defaults],
    ['invalid', defaults],
    [[], defaults],
    [['packing','bol','invoice','cert','proforma','contract'],
      ['contract','import_permit','packing','bill_of_lading','invoice','certificate_of_origin','proforma']],
    [['invoice','invoice','letter','signed_document','optionalAttachment','__proto__',null,{},'importPermit','contract'],
      ['contract','import_permit','invoice','proforma','certificate_of_origin','bill_of_lading','packing']]
  ];
  for (const [docOrder,expected] of cases) {
    const f = await fixture(), writes = new Map();
    f.input.shipment.data = {docOrder};
    // SQL supplies uploads alphabetically, not in the bank's document order.
    f.input.files.sort((a,b) => a.kind.localeCompare(b.kind));
    for (const kind of Object.keys(f.generated)) f.generated[kind] = sources.get(kind).toString('base64');
    const before = JSON.stringify(f.input);
    const result = await buildPackage(f.input,f.generated,
      async path => sources.get(path.split('/').pop()),
      async (path,bytes) => writes.set(path,bytes),'ordered-revision');
    assert.deepEqual(result.documents.map(doc => doc.kind),expected);
    const merged = await PDFDocument.load(writes.get(result.packagePath));
    assert.deepEqual(merged.getPages().map(page => page.getWidth()),expected.flatMap(kind => {
      const index = defaults.indexOf(kind); return [300 + index * 10,301 + index * 10];
    }));
    for (const doc of result.documents) {
      assert.deepEqual(writes.get(doc.path),sources.get(doc.kind),'individual PDFs remain unchanged');
      assert.equal(doc.sourceId,f.input.files.find(file => file.kind === doc.kind)?.id || null);
    }
    assert.equal(JSON.stringify(f.input),before,'saved shipment and source order remain unchanged');
  }
});

test('duplicate uploads are rejected before reading or storing package sources', async () => {
  const f = await fixture();
  f.input.files.push(f.input.files[0]);
  await assert.rejects(buildPackage(f.input,f.generated,
    async () => assert.fail('must not download'),async () => assert.fail('must not store'),'duplicate'),/scope/);
});

test('partial packages merge only the available documents; empty or invalid sources fail', async () => {
  const f = await fixture();
  const partial = await buildPackage({...f.input,generated:{contract:true},files:f.input.files.slice(1)},{contract:f.generated.contract},async()=>f.bytes,async()=>{},'r');
  assert.deepEqual(partial.documents.map(d=>d.kind).sort(), ['bill_of_lading','certificate_of_origin','contract']);
  await assert.rejects(buildPackage({...f.input,generated:{},files:[]},{},async()=>f.bytes,async()=>{},'r'), /No operations documents/);
  await assert.rejects(buildPackage({...f.input,generated:{contract:true}},f.generated,async()=>f.bytes,async()=>{},'r'), /Unexpected generated/);
  await assert.rejects(buildPackage(f.input,f.generated,async()=>Buffer.from('not a document'),async()=>{},'r'), /Unsupported/);
});

test('package preview returns only the caller-accessible approved PDF without modifying records', async () => {
  const handler=require('../api/bsgt-operations-package');
  const originalFetch=global.fetch, originalKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const shipment='11111111-1111-4111-8111-111111111111',revision='55555555-5555-4555-8555-555555555555';
  const {bytes}=await fixture();let access=true,approved=true,downloads=0;
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-key';
  global.fetch=async(url,options={})=>{
    assert.equal(options.method||'GET','GET','preview must not write production data');
    if(url.includes('/auth/v1/user'))return Response.json({id:'user'});
    if(url.includes('/rest/v1/shipments?')){
      assert.equal(options.headers.Authorization,'Bearer caller-token');
      return Response.json(access?[{operations_revision_id:revision}]:[]);
    }
    if(url.includes('/rest/v1/bsgt_operations_revisions?')){
      assert.equal(options.headers.Authorization,'Bearer caller-token');
      assert.ok(url.includes('approved_at=not.is.null'));
      return Response.json(approved?[{package_path:`${shipment}/${revision}/package.pdf`}]:[]);
    }
    assert.ok(url.endsWith(`/bsgt-operations-packages/${shipment}/${revision}/package.pdf`));
    downloads++;return new Response(bytes);
  };
  const invoke=async(token='Bearer caller-token')=>{
    const res={setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    await handler({method:'POST',headers:{authorization:token},body:{action:'preview',shipmentId:shipment,path:'private/unrelated.pdf'}},res);
    return res;
  };
  try{
    const success=await invoke();assert.equal(success.statusCode,200);
    assert.deepEqual(Buffer.from(success.body.pdfBase64,'base64'),bytes);
    assert.equal((await invoke('')).statusCode,401);
    access=false;assert.equal((await invoke()).statusCode,409);
    access=true;approved=false;assert.equal((await invoke()).statusCode,409);
    assert.equal(downloads,1,'denied and unapproved packages never reach privileged storage');
  }finally{
    global.fetch=originalFetch;
    if(originalKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=originalKey;
  }
});
