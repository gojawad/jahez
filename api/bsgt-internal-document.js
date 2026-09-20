'use strict';
const {randomUUID} = require('node:crypto');
const {PDFDocument} = require('../experiments/bs-collection/collection-pdf-lib');
const {readBody,serviceHeaders} = require('./bsgt-operations-package');
const FINANCE = ['exchange','letter','undertaking'];
const {normalizeConsigneeName}=require('../consignee-client-resolver');
const {fromMetadata}=require('../signature-placement');
// The deployed Node server is a single process. Reject overlapping saves for a
// trade file; the expected signed-version ID also rejects stale browser tabs.
const signingFiles=new Set();
function currentSignature(bundle,shipment,kind,sourcePath){
  return bundle.documents.find(d=>d.is_active===true&&d.trade_file_id===bundle.file.id
    &&d.revision_no===bundle.file.revision_no&&d.shipment_id===shipment.shipment.id
    &&d.operations_revision_id===shipment.revision.id&&d.document_type===kind
    &&d.document_variant==='administration_signed'&&d.source_document_path===sourcePath)||null;
}

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
  async function assetRows(table,params) {
    const rows=[];
    for(let offset=0;;offset+=1000){
      const query=new URLSearchParams({...params,limit:'1000',offset:String(offset)});
      const response=await fetch(`${base}/rest/v1/${table}?${query}`,{headers:service,signal:AbortSignal.timeout(15000)});
      if(!response.ok) throw new Error('Signing assets unavailable');
      const page=await response.json();
      if(!Array.isArray(page)) throw new Error('Invalid signing assets');
      rows.push(...page);if(page.length<1000)return rows;
    }
  }
  async function assetUrl(bucket,path,owner,type) {
    const parts=String(path||'').split('/');
    if(parts[0]!==owner||parts[1]!==type||parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\'))) throw new Error('Invalid asset ownership');
    const response=await fetch(`${base}/storage/v1/object/sign/${bucket}/${parts.map(encodeURIComponent).join('/')}`,{
      method:'POST',headers:{...service,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:120}),signal:AbortSignal.timeout(15000)
    });
    if(!response.ok) throw new Error('Signing image unavailable');
    const data=await response.json(),value=data.signedURL||data.signedUrl;
    if(typeof value!=='string') throw new Error('Signing image URL missing');
    const url=new URL(value.startsWith('/object/')?'/storage/v1'+value:value,base);
    if(url.origin!==new URL(base).origin||!url.pathname.startsWith(`/storage/v1/object/sign/${bucket}/`)) throw new Error('Invalid signing image URL');
    return url.href;
  }
  let signingFile=null;
  try {
    const body=await readBody(req);
    if(body.action==='sign'){
      if(typeof body.tradeFileId!=='string'||!body.tradeFileId)throw new Error('Invalid trade file');
      const lockKey=body.tradeFileId.toLowerCase();
      if(signingFiles.has(lockKey))return res.status(409).json({error:'يجري حفظ توقيع لهذا الملف الآن. انتظر اكتماله ثم أعد فتح نافذة التوقيع.'});
      signingFile=lockKey;signingFiles.add(signingFile);
    }
    if(body.action==='signing-assets') {
      // Resolve owners from the authorized immutable shipment, never request IDs.
      const bundle=await rpc('bsgt_internal_package',{p_file_id:body.tradeFileId});
      if(bundle.file.status!=='final_accepted'||bundle.file.revision_no!==body.revisionNo) throw new Error('Relations signing stage changed');
      if(await rpc('has_bsgt_workspace_permission',{p_section:'relations',p_require_edit:true})!==true) throw new Error('Relations edit permission required');
      const shipment=bundle.shipments.find(s=>s.shipment.id===body.shipmentId)?.shipment;
      if(!shipment||!bundle.file.company_id) throw new Error('Shipment is outside this package');
      const sources={'buyer-stamp':[],'buyer-signature':[],'company-stamp':[],'company-signature':[]},notes=[];
      const columns='id,file_type,title,storage_path,mime_type,is_active,metadata';
      async function append(table,ownerColumn,owner,prefix){
        const files=await assetRows(table,{select:`${columns},${ownerColumn},${prefix==='company'?'signatory_name':'signatory_id'}`,[ownerColumn]:`eq.${owner}`,is_active:'eq.true',file_type:'in.(stamp,signature)',order:'created_at.desc,id.asc'});
        const people=prefix==='buyer'&&files.some(f=>f.signatory_id)?await assetRows('client_authorized_signatories',{select:'id,client_id,name,title,active',client_id:`eq.${owner}`,active:'eq.true',order:'id.asc'}):[];
        for(const file of files){
          if(file[ownerColumn]!==owner||file.is_active!==true||!['stamp','signature'].includes(file.file_type))continue;
          const person=people.find(p=>p.id===file.signatory_id&&p.client_id===owner&&p.active===true);
          if(prefix==='buyer'&&file.signatory_id&&!person)continue;
          if(!['image/png','image/jpeg','image/webp'].includes(file.mime_type)){notes.push('يوجد ختم أو توقيع بصيغة غير صورية؛ الاستجلاب يحتاج صورة PNG أو JPEG أو WEBP.');continue;}
          try{
            const url=await assetUrl(prefix==='company'?'company-profile-files':'client-profile-files',file.storage_path,owner,file.file_type);
            sources[`${prefix}-${file.file_type}`].push({label:person?.name||file.signatory_name||file.title||(file.file_type==='stamp'?'ختم':'توقيع'),detail:person?.title||'',url,placement:fromMetadata(file)});
          }catch(_){notes.push('تعذر فتح إحدى صور البروفايل. راجع الملف المحفوظ؛ لم يتم استبداله بصورة أخرى.');}
        }
      }
      await append('company_profile_files','company_id',bundle.file.company_id,'company');
      if(await rpc('has_feature_permission',{p_permission_key:'client_assets.use'})===true){
        const name=normalizeConsigneeName(shipment.data?.consignee);
        if(name){
          const pattern=name.replace(/[\\%_*]/g,'\\$&').replace(/\s+/g,'%');
          const candidates=await assetRows('clients',{select:'id,name',name:`ilike.${pattern}`,order:'id.asc'});
          const matches=candidates.filter(client=>normalizeConsigneeName(client.name)===name);
          if(matches.length===1)await append('client_profile_files','client_id',matches[0].id,'buyer');
          else notes.push(matches.length?'يوجد أكثر من بروفايل مطابق للمشتري؛ يلزم تصحيح الربط قبل استجلاب توقيعه.':'لم يتم العثور على بروفايل مطابق للمشتري في الشحنة.');
        }else notes.push('اسم المشتري غير متوفر في نسخة الشحنة المعتمدة.');
      }else notes.push('استجلاب أختام وتوقيعات المشتري يحتاج صلاحية «استخدام أختام وتوقيعات العملاء».');
      return res.status(200).json({sources,notes:[...new Set(notes)]});
    }
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
      const bundle=await rpc('bsgt_internal_package',{p_file_id:body.tradeFileId});
      const signingSection=bundle.file.status==='under_management_review'?'management':bundle.file.status==='final_accepted'?'relations':null;
      if(!signingSection||bundle.file.revision_no!==body.revisionNo) throw new Error('Signing stage or revision changed');
      if(!await rpc('has_bsgt_workspace_permission',{p_section:signingSection,p_require_edit:true})) throw new Error('Stage edit permission required');
      const shipment=bundle.shipments.find(s=>s.shipment.id===body.shipmentId);
      if(!shipment) throw new Error('Shipment is outside this package');
      const isFinance=FINANCE.includes(body.kind);
      const source=isFinance?bundle.documents.find(d=>d.document_variant==='finance_original'&&d.document_type===body.kind)
        :shipment.revision.documents.find(d=>d.kind===body.kind);
      if(!source) throw new Error('Original document unavailable');
      if(typeof body.image!=='string'||body.image.length>4000000) throw new Error('Signature image too large');
      const sourcePath=isFinance?source.storage_path:source.path;
      const previous=currentSignature(bundle,shipment,body.kind,sourcePath);
      if((body.baseSignatureId??null)!==(previous?.id||null)
        ||(body.baseOperationsRevisionId!==undefined&&body.baseOperationsRevisionId!==shipment.revision.id))throw new Error('SIGNATURE_CHANGED');
      const bytes=await download(previous||isFinance?'trade-collection-documents':'bsgt-operations-packages',previous?.storage_path||sourcePath);
      const signed=await applySignature(bytes,Buffer.from(body.image,'base64'),body.placements);
      const path=`workflow/${bundle.file.id}/${body.revisionNo}/signed/${randomUUID()}.pdf`;
      await store(path,signed);
      const latest=await rpc('bsgt_internal_package',{p_file_id:bundle.file.id});
      const latestShipment=latest.shipments.find(s=>s.shipment.id===body.shipmentId);
      if(latest.file.status!==bundle.file.status||latest.file.revision_no!==body.revisionNo
        ||latestShipment?.revision.id!==shipment.revision.id
        ||(currentSignature(latest,latestShipment,body.kind,sourcePath)?.id||null)!==(previous?.id||null))throw new Error('SIGNATURE_CHANGED');
      const document=await rpc('register_bsgt_internal_signature',{p_file_id:bundle.file.id,p_revision_no:body.revisionNo,
        p_shipment_id:body.shipmentId,p_kind:body.kind,p_path:path,p_source_path:sourcePath,
        p_placements:[...(Array.isArray(previous?.signature_placements)?placementRecords(previous.signature_placements):[]),...placementRecords(body.placements)]});
      return res.status(200).json({document});
    }
    return res.status(400).json({error:'Unknown document action'});
  } catch(error) {
    console.error('Internal workflow document:',error.message);
    if(error.message==='SIGNATURE_CHANGED')return res.status(409).json({error:'تغيرت النسخة الموقعة أثناء العمل. أغلق نافذة التوقيع وافتحها من جديد لإضافة توقيعك فوق أحدث نسخة دون فقد التوقيعات السابقة.'});
    return res.status(409).json({error:'تعذر حفظ المستند. تحقق من الصلاحيات ومن أن مراجعة الملف لم تتغير.'});
  } finally {if(signingFile)signingFiles.delete(signingFile);}
}
module.exports=handler;
module.exports.applySignature=applySignature;
