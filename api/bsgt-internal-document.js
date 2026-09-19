'use strict';
const {randomUUID} = require('node:crypto');
const {PDFDocument} = require('../experiments/bs-collection/collection-pdf-lib');
const {readBody,serviceHeaders} = require('./bsgt-operations-package');
const FINANCE = ['exchange','letter','undertaking'];

// Each placement may carry its own PNG (stamp and signature together); without one the
// shared image applies. Identical images are embedded once.
async function applySignature(bytes, image, placements) {
  if (!Array.isArray(placements) || !placements.length || placements.length>100) throw new Error('Invalid signature placements');
  const document = await PDFDocument.load(bytes);
  const embedded = new Map();
  const assetFor = async source => {
    const key = source.toString('base64').slice(0, 64) + ':' + source.length;
    if (!embedded.has(key)) embedded.set(key, await document.embedPng(source));
    return embedded.get(key);
  };
  for(const p of placements) {
    if(!Number.isInteger(p.page) || p.page<0 || p.page>=document.getPageCount()
      || !['x','y','width','height'].every(key=>Number.isFinite(p[key])&&p[key]>=0&&p[key]<=1)
      || p.width<=0 || p.height<=0 || p.x+p.width>1.000001 || p.y+p.height>1.000001) throw new Error('Signature is outside the document');
    if (p.image !== undefined && (typeof p.image !== 'string' || p.image.length > 4000000)) throw new Error('Signature image too large');
    const asset = await assetFor(typeof p.image === 'string' && p.image ? Buffer.from(p.image, 'base64') : image);
    const page=document.getPage(p.page),size=page.getSize();
    page.drawImage(asset,{x:p.x*size.width,y:(1-p.y-p.height)*size.height,width:p.width*size.width,height:p.height*size.height});
  }
  return Buffer.from(await document.save());
}
// Placement geometry only, for the database record.
function placementRecords(placements) {
  return placements.map(({page,x,y,width,height,cloned}) => ({page,x,y,width,height,...(cloned ? {cloned:true} : {})}));
}

async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'POST required'});
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const base=(process.env.SUPABASE_URL||'https://vthcmqqiexaedukduquv.supabase.co').replace(/\/$/,'');
  if(!key) return res.status(503).json({error:'Internal document service is not configured'});
  const authorization=String(req.headers.authorization||'');
  if(!/^Bearer [^\s]+$/.test(authorization)) return res.status(401).json({error:'Authentication required'});
  const headers={apikey:key,Authorization:authorization,'Content-Type':'application/json'};
  const service=serviceHeaders(key);
  async function rpc(name,args) {
    const response=await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(60000)});
    if(!response.ok) throw new Error(`Workflow validation failed (${response.status})`);
    return response.json();
  }
  async function store(path,bytes) {
    const response=await fetch(`${base}/storage/v1/object/trade-collection-documents/${path}`,{
      method:'POST',headers:{...service,'Content-Type':'application/pdf','x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(60000)
    });
    if(!response.ok) throw new Error('Internal PDF upload failed');
  }
  async function download(bucket,path) {
    const response=await fetch(`${base}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,{headers:service,signal:AbortSignal.timeout(60000)});
    if(!response.ok) throw new Error('Original document unavailable');
    return Buffer.from(await response.arrayBuffer());
  }
  try {
    const body=await readBody(req);
    if(body.action==='finance') {
      if(!await rpc('has_bsgt_workspace_permission',{p_section:'finance',p_require_edit:true})) throw new Error('Finance edit permission required');
      const context=await rpc('get_bsgt_finance_context',{p_context_id:body.contextId});
      if(!context.tradeFileId) throw new Error('Open the trade file first');
      const bundle=await rpc('bsgt_internal_package',{p_file_id:context.tradeFileId});
      if(bundle.file.status!=='draft' || bundle.file.revision_no!==body.revisionNo) throw new Error('Finance draft changed');
      if(JSON.stringify(Object.keys(body.generated||{}).sort())!==JSON.stringify(FINANCE)) throw new Error('Only the existing three finance documents are allowed');
      const documents=[];
      for(const kind of FINANCE) {
        const bytes=Buffer.from(body.generated[kind],'base64');
        const pdf=await PDFDocument.load(bytes);
        if(!pdf.getPageCount()) throw new Error('Empty finance PDF');
        const path=`workflow/${bundle.file.id}/${body.revisionNo}/finance/${randomUUID()}-${kind}.pdf`;
        await store(path,bytes); documents.push({kind,path});
      }
      const file=await rpc('register_bsgt_finance_originals',{p_context_id:body.contextId,p_revision_no:body.revisionNo,p_documents:documents,p_settings:body.settings||{}});
      return res.status(200).json({file});
    }
    if(body.action==='sign') {
      if(!await rpc('has_bsgt_workspace_permission',{p_section:'management',p_require_edit:true})) throw new Error('Management edit permission required');
      const bundle=await rpc('bsgt_internal_package',{p_file_id:body.tradeFileId});
      if(bundle.file.status!=='under_management_review'||bundle.file.revision_no!==body.revisionNo) throw new Error('Management review changed');
      const shipment=bundle.shipments.find(s=>s.shipment.id===body.shipmentId);
      if(!shipment) throw new Error('Shipment is outside this package');
      const isFinance=FINANCE.includes(body.kind);
      const source=isFinance?bundle.documents.find(d=>d.document_variant==='finance_original'&&d.document_type===body.kind)
        :shipment.revision.documents.find(d=>d.kind===body.kind);
      if(!source) throw new Error('Original document unavailable');
      if(typeof body.image!=='string'||body.image.length>4000000) throw new Error('Signature image too large');
      const sourcePath=isFinance?source.storage_path:source.path;
      const bytes=await download(isFinance?'trade-collection-documents':'bsgt-operations-packages',sourcePath);
      const signed=await applySignature(bytes,Buffer.from(body.image,'base64'),body.placements);
      const path=`workflow/${bundle.file.id}/${body.revisionNo}/signed/${randomUUID()}.pdf`;
      await store(path,signed);
      const document=await rpc('register_bsgt_internal_signature',{p_file_id:bundle.file.id,p_revision_no:body.revisionNo,
        p_shipment_id:body.shipmentId,p_kind:body.kind,p_path:path,p_source_path:sourcePath,p_placements:placementRecords(body.placements)});
      return res.status(200).json({document});
    }
    return res.status(400).json({error:'Unknown document action'});
  } catch(error) {
    console.error('Internal workflow document:',error.message);
    return res.status(409).json({error:'تعذر حفظ المستند. تحقق من الصلاحيات ومن أن مراجعة الملف لم تتغير.'});
  }
}
module.exports=handler;
module.exports.applySignature=applySignature;
