'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');
const {resolveSignedOperationsPackage,clearPackageCache}=require('../api/qr-signed-package');
async function pdf(pages){const doc=await PDFDocument.create();for(let i=0;i<pages;i++)doc.addPage();return Buffer.from(await doc.save());}

test('signed package resolver rebuilds once per signature set and never touches finance documents',async()=>{
  clearPackageCache();
  const shipmentId='s1',revision={id:'rev1',documents:[{kind:'contract',path:'ops/contract.pdf'},{kind:'invoice',path:'ops/invoice.pdf'}]};
  let signed=[{id:'d1',document_type:'contract',document_variant:'administration_signed',storage_path:'signed/c1.pdf',source_document_path:'ops/contract.pdf',shipment_id:'s1',operations_revision_id:'rev1',revision_no:1,is_active:true,created_at:'2026-09-18T10:00:00Z'},
    {id:'d2',document_type:'letter',document_variant:'administration_signed',storage_path:'signed/letter.pdf',source_document_path:'finance/letter.pdf',shipment_id:'s1',operations_revision_id:'rev1',revision_no:1,is_active:true,created_at:'2026-09-18T10:01:00Z'}];
  const restRows=async query=>{
    if(query.startsWith('trade_collection_file_shipments'))return [{trade_file_id:'f1'}];
    if(query.startsWith('trade_collection_files'))return [{id:'f1',revision_no:1,status:'under_management_review',created_at:'2026-09-18'}];
    if(query.startsWith('trade_collection_file_documents'))return signed;
    throw new Error('unexpected '+query);
  };
  const downloads=[];const download=async(bucket,path)=>{downloads.push(`${bucket}/${path}`);if(path.includes('letter'))throw new Error('finance document requested');return pdf(path==='signed/c1.pdf'?2:1);};
  const first=await resolveSignedOperationsPackage({shipmentId,revision,restRows,download});
  assert.equal(first.pageCount,3);assert.deepEqual(first.signedKinds,['contract']);assert.equal(first.cached,undefined);
  assert.deepEqual(downloads,['trade-collection-documents/signed/c1.pdf','bsgt-operations-packages/ops/invoice.pdf']);
  const second=await resolveSignedOperationsPackage({shipmentId,revision,restRows,download});
  assert.equal(second.cached,true);assert.equal(downloads.length,2,'second scan is served from memory');
  signed=[{...signed[0],id:'d3',storage_path:'signed/c2.pdf',created_at:'2026-09-18T11:00:00Z'},signed[1]];
  const third=await resolveSignedOperationsPackage({shipmentId,revision,restRows,download});
  assert.equal(third.cached,undefined);assert.equal(downloads.length,4,'a new signature rebuilds the package');
  assert.ok(downloads.includes('trade-collection-documents/signed/c2.pdf'));
  signed=[];
  assert.equal(await resolveSignedOperationsPackage({shipmentId,revision,restRows,download}),null,'no signatures → plain package path');
});
