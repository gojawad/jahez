'use strict';
const {PDFDocument}=require('../experiments/bs-collection/collection-pdf-lib');
const order=['contract','proforma','invoice','packing','import_permit','certificate_of_origin','bill_of_lading','letter','undertaking','exchange'];

// A transient, internal preview only. Never publish this bundle to the shipment QR.
async function buildShipmentBundle({file,link,shipment,revision,documents,attachments,download}){
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
  const sources=[baseline,...finance.map(row=>({bucket:'trade-collection-documents',path:row.storage_path})),...signed.map(row=>({bucket:'trade-collection-documents',path:row.storage_path})),...relations.map(row=>({bucket:'trade-collection-documents',path:row.storage_path}))];
  const merged=await PDFDocument.create(),seen=new Set();let totalBytes=0;
  for(const source of sources){
    if(!source.path)throw new Error('Stored document path is missing');
    const key=`${source.bucket}/${source.path}`;if(seen.has(key))continue;seen.add(key);
    const bytes=await download(source.bucket,source.path);totalBytes+=bytes.length;
    if(totalBytes>64*1024*1024)throw new Error('Bundle too large');
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
  return {bytes:Buffer.from(await merged.save()),pageCount:merged.getPageCount(),sourceCount:seen.size};
}
module.exports={buildShipmentBundle};
