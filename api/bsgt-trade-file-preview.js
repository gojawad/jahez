'use strict';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES=64*1024*1024;
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  const authorization=String(req.headers.authorization||'');
  if(!/^Bearer [^\s]+$/.test(authorization))return res.status(401).json({error:'سجل الدخول أولاً.'});
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)return res.status(503).json({error:'خدمة المعاينة غير متاحة.'});
  const base=(process.env.SUPABASE_URL||'https://vthcmqqiexaedukduquv.supabase.co').replace(/\/$/,'');
  // The caller's JWT is used for ALL reads, including storage. No RLS bypass.
  const headers={apikey:key,Authorization:authorization};
  async function rows(path){
    const response=await fetch(`${base}/rest/v1/${path}`,{headers,signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('Record is not accessible');
    return response.json();
  }
  try{
    let body=req.body;
    if(!body){let text='';for await(const chunk of req){text+=chunk;if(text.length>4096)throw new Error('Request too large');}body=JSON.parse(text);}
    if(typeof body==='string')body=JSON.parse(body);
    const {fileId,source,documentId,kind}=body;
    if(!UUID.test(fileId||'')||!UUID.test(documentId||''))throw new Error('Invalid reference');
    const files=await rows(`trade_collection_files?id=eq.${fileId}&select=id`);
    if(!files.length)throw new Error('File is not accessible');
    let bucket,path;
    if(source==='collection'||source==='relations'){
      const table=source==='collection'?'trade_collection_file_documents':'trade_collection_relations_attachments';
      const documents=await rows(`${table}?id=eq.${documentId}&trade_file_id=eq.${fileId}&select=storage_path`);
      path=documents[0]?.storage_path;bucket='trade-collection-documents';
    }else if(source==='operations'){
      const links=await rows(`trade_collection_file_shipments?trade_file_id=eq.${fileId}&operations_revision_id=eq.${documentId}&select=shipment_id`);
      if(!links.length)throw new Error('Revision is outside this trade file');
      const revisions=await rows(`bsgt_operations_revisions?id=eq.${documentId}&shipment_id=eq.${links[0].shipment_id}&approved_at=not.is.null&select=documents,package_path`);
      const revision=revisions[0];
      path=kind==='package'?revision?.package_path:revision?.documents?.find(document=>document.kind===kind)?.path;
      bucket='bsgt-operations-packages';
    }else if(source==='uploaded'){
      const documents=await rows(`shipment_files?id=eq.${documentId}&select=shipment_id,path`);
      const document=documents[0];if(!document)throw new Error('Attachment is not accessible');
      const links=await rows(`trade_collection_file_shipments?trade_file_id=eq.${fileId}&shipment_id=eq.${document.shipment_id}&select=shipment_id`);
      if(!links.length)throw new Error('Attachment is outside this trade file');
      path=document.path;bucket='shipment-files';
    }else throw new Error('Unsupported source');
    if(!path||path.split('/').some(part=>!part||part==='..'||part==='.')||path.includes('\\'))throw new Error('Invalid stored path');
    const response=await fetch(`${base}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,{headers,signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw new Error('Storage access denied');
    if(Number(response.headers.get('content-length'))>MAX_BYTES)throw new Error('File too large');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>MAX_BYTES)throw new Error('File too large');chunks.push(Buffer.from(chunk));}
    const bytes=Buffer.concat(chunks);
    const mimeType=bytes.subarray(0,5).toString()==='%PDF-'?'application/pdf':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':null;
    if(!mimeType)throw new Error('Unsupported file type');
    return res.status(200).json({mimeType,base64:bytes.toString('base64')});
  }catch(error){
    console.warn('Trade file preview:',error.message);
    return res.status(403).json({error:'تعذرت معاينة الملف. قد لا يكون متاحاً أو ليست لديك صلاحية عرضه.'});
  }
};
