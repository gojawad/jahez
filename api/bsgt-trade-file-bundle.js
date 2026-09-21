'use strict';
const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');
const {createHash}=require('node:crypto');
const {createPreviewCache}=require('./bsgt-preview-cache');
const previewCache=createPreviewCache();
const order=['contract','proforma','invoice','packing','import_permit','certificate_of_origin','bill_of_lading','letter','undertaking','exchange'];

// A transient, internal preview only. Never publish this bundle to the shipment QR.
// mode 'current': one up-to-date copy of each document — every operations and
// finance document is replaced by its active administration-signed version when
// one exists (no duplicates). Default mode keeps the historical layout.
async function buildShipmentBundle({file,link,shipment,revision,documents,attachments,download,mode,cacheScope,optimized=true}){
  if(!file||!link||link.trade_file_id!==file.id||link.shipment_id!==shipment?.id)throw new Error('Shipment is outside this trade file');
  let baseline;
  if(link.operations_revision_id){
    if(revision?.id!==link.operations_revision_id||revision.shipment_id!==shipment.id||!revision.approved_at)throw new Error('Approved operations revision is unavailable');
    baseline={bucket:'bsgt-operations-packages',path:revision.package_path};
  }else{
    baseline={bucket:'shipment-files',path:shipment.data?.qrPackagePath};
  }
  if(!baseline.path)throw new Error('OPERATIONS_PACKAGE_MISSING');
  const current=row=>row.trade_file_id===file.id&&row.is_active===true&&Number(row.revision_no)===Number(file.revision_no||1)&&(row.shipment_id==null||row.shipment_id===shipment.id);
  const sort=(a,b)=>(order.indexOf(a.document_type)-order.indexOf(b.document_type))||String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id).localeCompare(String(b.id));
  const finance=documents.filter(row=>current(row)&&row.document_variant!=='administration_signed').sort(sort);
  const signed=documents.filter(row=>current(row)&&row.document_variant==='administration_signed'&&row.shipment_id===shipment.id&&row.operations_revision_id===link.operations_revision_id).sort(sort);
  const relations=attachments.filter(current).sort((a,b)=>String(a.attachment_type).localeCompare(String(b.attachment_type))||String(a.id).localeCompare(String(b.id)));
  let sources;
  if(mode==='current'){
    const signedBySource=new Map();
    for(const row of signed){const previous=signedBySource.get(row.source_document_path);if(!previous||String(row.created_at||'')>String(previous.created_at||''))signedBySource.set(row.source_document_path,row);}
    const swap=(bucket,path)=>{const row=signedBySource.get(path);return row?{bucket:'trade-collection-documents',path:row.storage_path}:{bucket,path};};
    const operations=link.operations_revision_id&&Array.isArray(revision.documents)&&revision.documents.length
      ?revision.documents.filter(doc=>doc&&typeof doc.path==='string').map(doc=>swap('bsgt-operations-packages',doc.path))
      :[baseline];
    sources=[...operations,...finance.map(row=>swap('trade-collection-documents',row.storage_path)),...relations.map(row=>({bucket:'trade-collection-documents',path:row.storage_path}))];
  }else{
    sources=[baseline,...finance.map(row=>({bucket:'trade-collection-documents',path:row.storage_path})),...signed.map(row=>({bucket:'trade-collection-documents',path:row.storage_path})),...relations.map(row=>({bucket:'trade-collection-documents',path:row.storage_path}))];
  }
  const seen=new Set(),unique=[];
  for(const source of sources){
    if(!source.path)throw new Error('Stored document path is missing');
    const key=`${source.bucket}/${source.path}`;if(seen.has(key))continue;seen.add(key);
    unique.push(source);
  }
  // Read every source using the caller's current Storage authorization, including
  // cache hits. Content hashes detect replacements even at an unchanged path.
  const loaded=[];let totalBytes=0;
  const concurrency=optimized?3:1;
  for(let start=0;start<unique.length;start+=concurrency){
    const batch=await Promise.allSettled(unique.slice(start,start+concurrency).map(async source=>{
      const bytes=await download(source.bucket,source.path);totalBytes+=bytes.length;
      if(totalBytes>64*1024*1024)throw new Error('Bundle too large');
      return {source,bytes};
    }));
    const failed=batch.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    loaded.push(...batch.map(result=>result.value));
  }
  let cacheKey;
  if(optimized&&cacheScope){
    cacheKey=createHash('sha256').update(JSON.stringify({version:1,cacheScope,file,link,shipment,revision,documents,attachments,mode,
      sources:loaded.map(({source,bytes})=>[source.bucket,source.path,createHash('sha256').update(bytes).digest('hex')])})).digest('hex');
    const cached=previewCache.get(cacheKey);if(cached)return {...cached,cacheHit:true};
  }
  const merged=await PDFDocument.create();
  for(const {source,bytes} of loaded){
    if(bytes.subarray(0,5).toString()==='%PDF-'){
      const pdf=await PDFDocument.load(bytes);if(!pdf.getPageCount())throw new Error('Empty document');
      for(const page of await merged.copyPages(pdf,pdf.getPageIndices()))merged.addPage(page);
    }else{
      if(source===baseline)throw new Error('Operations package must be PDF');
      const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      if(!png&&!(bytes[0]===255&&bytes[1]===216))throw new Error('Unsupported bundle document');
      const image=png?await merged.embedPng(bytes):await merged.embedJpg(bytes);
      const page=merged.addPage([595.28,841.89]),scale=Math.min(555.28/image.width,801.89/image.height);
      page.drawImage(image,{x:(595.28-image.width*scale)/2,y:(841.89-image.height*scale)/2,width:image.width*scale,height:image.height*scale});
    }
    if(merged.getPageCount()>500)throw new Error('Bundle has too many pages');
  }
  const result={bytes:Buffer.from(await merged.save()),pageCount:merged.getPageCount(),sourceCount:seen.size};
  if(cacheKey)previewCache.set(cacheKey,result);
  return result;
}
module.exports={buildShipmentBundle};
