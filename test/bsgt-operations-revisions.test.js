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
      submitBsgtOperationsToFinance:async()=>calls.push('operations'),
      window:{JahezRevisionWorkflow:{previewOperations:async()=>calls.push('preview')}},
      ensureBsgtPackageMergeAllowed:async()=>{calls.push('legacy');return {allowed:false};},
      showShipmentWorkflowDialog:async()=>{throw new Error('Unexpected workflow error');}
    };
    vm.createContext(context);vm.runInContext(source,context);
    await context.requestBsgtPackageMerge({id:'shipment',bsgtStage:'ready_for_finance'});
    assert.deepEqual(calls,['read',stage==='operations_draft'?'operations':stage==='ready_for_finance'?'preview':'legacy']);
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

test('missing or invalid sources fail rather than publishing an incomplete PDF', async () => {
  const f = await fixture();
  await assert.rejects(buildPackage({...f.input,files:f.input.files.slice(1)},f.generated,async()=>f.bytes,async()=>{},'r'), /Missing/);
  await assert.rejects(buildPackage(f.input,f.generated,async()=>Buffer.from('not a document'),async()=>{},'r'), /Unsupported/);
});
