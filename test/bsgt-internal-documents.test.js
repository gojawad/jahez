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
  let edit=false,section='management',reads=[],writes=[],registered;
  const source=await pdf(),sourceBefore=Buffer.from(source);
  const bundle={file:{id:'case',revision_no:2,status:'under_management_review'},shipments:[{shipment:{id:'shipment'},revision:{documents:[{kind:'invoice',path:'shipment/revision/invoice.pdf'}]}}],documents:[]};
  global.fetch=async(url,options={})=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/has_bsgt_workspace_permission'))return Response.json(edit&&JSON.parse(options.body).p_section===section);
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
    bundle.file.status='final_accepted';
    const before=writes.length;
    assert.equal((await call(body)).code,409,'management permission alone cannot sign in relations');assert.equal(writes.length,before);
    section='relations';assert.equal((await call(body)).code,200,'relations editor signs after final acceptance');
    bundle.file.status='under_management_review';assert.equal((await call(body)).code,409,'relations cannot sign during management review');
    bundle.file.status='sent_to_collecting';assert.equal((await call(body)).code,409,'dispatched file is read-only');
    bundle.file.status='final_accepted';edit=false;assert.equal((await call(body)).code,409,'relations viewer cannot sign');
  }finally{global.fetch=savedFetch;if(savedKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=savedKey;}
});

test('signing appends to current PDF, preserves prior versions, and rejects stale or concurrent saves',async()=>{
  const savedFetch=global.fetch,savedKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';
  const source=await pdf(),original=Buffer.from(source),files=new Map([['s/r/invoice.pdf',source],['finance/letter.pdf',source]]);
  const bundle={file:{id:'case',revision_no:2,status:'final_accepted'},shipments:[{shipment:{id:'s'},revision:{id:'r',documents:[{kind:'invoice',path:'s/r/invoice.pdf'}]}}],documents:[{document_variant:'finance_original',document_type:'letter',storage_path:'finance/letter.pdf'}]};
  const history=[],reads=[];let registered=0,uploads=0,failRead=false,pauseStore=null,enteredStore=null,changeDuringStore=false;
  global.fetch=async(input,options={})=>{
    const path=new URL(input).pathname;
    if(path.endsWith('/has_bsgt_workspace_permission'))return Response.json(true);
    if(path.endsWith('/bsgt_internal_package'))return Response.json(bundle);
    if(path.endsWith('/register_bsgt_internal_signature')){
      const args=JSON.parse(options.body);registered++;
      bundle.documents=bundle.documents.filter(d=>d.document_variant!=='administration_signed'||d.document_type!==args.p_kind);
      const row={id:'signed-'+registered,trade_file_id:'case',revision_no:2,is_active:true,document_type:args.p_kind,shipment_id:'s',operations_revision_id:'r',document_variant:'administration_signed',storage_path:args.p_path,source_document_path:args.p_source_path,signature_placements:args.p_placements};
      bundle.documents.push(row);history.push(row);return Response.json(row);
    }
    const stored=decodeURIComponent(path.replace(/^\/storage\/v1\/object\/[^/]+\//,''));
    if(options.method==='POST'){
      uploads++;files.set(stored,Buffer.from(options.body));
      if(changeDuringStore){bundle.file.status='sent_to_collecting';changeDuringStore=false;}
      if(pauseStore){enteredStore();await pauseStore;}
      return Response.json({});
    }
    reads.push(stored);if(failRead)return new Response('',{status:503});
    assert.ok(files.has(stored),'only server-owned PDF paths are read');return new Response(files.get(stored));
  };
  const body={action:'sign',tradeFileId:'case',revisionNo:2,shipmentId:'s',kind:'invoice',baseSignatureId:null,baseOperationsRevisionId:'r',image:PNG.toString('base64'),placements:[{page:0,x:.1,y:.1,width:.1,height:.1}]};
  async function call(extra={}){const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};await handler({method:'POST',headers:{authorization:'Bearer employee'},body:{...body,...extra}},res);return res;}
  async function images(bytes){const doc=await PDFDocument.load(bytes);return doc.getPages().map(p=>p.node.Resources()?.lookup(PDFName.of('XObject'))?.keys().length||0);}
  try{
    const first=await call();assert.equal(first.code,200);const firstBytes=Buffer.from(files.get(first.body.document.storage_path));
    assert.deepEqual(await images(firstBytes),[1,0]);
    const second=await call({baseSignatureId:first.body.document.id});assert.equal(second.code,200);
    const secondBytes=Buffer.from(files.get(second.body.document.storage_path));assert.deepEqual(await images(secondBytes),[2,0]);
    assert.equal(reads.at(-1),first.body.document.storage_path,'second signature starts from signed PDF, not original');
    assert.equal(second.body.document.signature_placements.length,2);assert.equal(second.body.document.source_document_path,'s/r/invoice.pdf');
    assert.deepEqual(files.get(first.body.document.storage_path),firstBytes);assert.deepEqual(files.get('s/r/invoice.pdf'),original);
    const count=uploads;
    for(const extra of [{},{baseSignatureId:first.body.document.id},{baseSignatureId:'foreign'},{baseSignatureId:second.body.document.id,baseOperationsRevisionId:'old'}])assert.equal((await call(extra)).code,409);
    assert.equal(uploads,count,'stale and forged versions fail before writing');
    failRead=true;assert.equal((await call({baseSignatureId:second.body.document.id})).code,409);failRead=false;
    assert.equal(registered,2,'unavailable signed PDF cannot fall back to original');
    let release;pauseStore=new Promise(resolve=>{release=resolve;});const started=new Promise(resolve=>{enteredStore=resolve;});
    const pending=call({baseSignatureId:second.body.document.id,placements:[{page:1,x:.2,y:.2,width:.1,height:.1}]});await started;
    assert.equal((await call({baseSignatureId:second.body.document.id})).code,409,'overlapping save is blocked');
    assert.equal((await call({baseSignatureId:second.body.document.id})).code,409,'blocked request must not release the first request lock');
    release();pauseStore=null;const third=await pending;assert.equal(third.code,200);
    assert.deepEqual(await images(files.get(third.body.document.storage_path)),[2,1]);
    const {buildSignedOperationsPackage,pickSignedRows}=require('../api/qr-signed-package');
    const qr=await buildSignedOperationsPackage({documents:bundle.shipments[0].revision.documents,signedRows:pickSignedRows(bundle.documents,{shipmentId:'s',revisionId:'r',revisionNo:2}),download:async(bucket,path)=>files.get(path)});
    assert.deepEqual(await images(qr.bytes),[2,1],'QR includes all accumulated signatures without changing the source-document link');
    assert.deepEqual(files.get(second.body.document.storage_path),secondBytes);assert.equal(third.body.document.signature_placements.length,3);
    assert.equal((await call({baseSignatureId:second.body.document.id})).code,409,'old tab remains stale after concurrent save completes');
    const finance=await call({kind:'letter'});assert.equal(finance.code,200);
    const financeAgain=await call({kind:'letter',baseSignatureId:finance.body.document.id});assert.equal(financeAgain.code,200);
    assert.deepEqual(await images(files.get(financeAgain.body.document.storage_path)),[2,0]);assert.deepEqual(files.get('finance/letter.pdf'),original);
    assert.equal(bundle.documents.find(d=>d.document_type==='invoice').id,third.body.document.id,'signing another document leaves the invoice active');
    const before=registered;changeDuringStore=true;assert.equal((await call({baseSignatureId:third.body.document.id})).code,409);assert.equal(registered,before,'changed workflow cannot activate a newly rendered PDF');
  }finally{global.fetch=savedFetch;if(savedKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=savedKey;}
});

test('relations saved assets are scoped to authorized package owners and client-use permission',async()=>{
  const savedFetch=global.fetch,savedKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-service';
  let edit=true,clientUse=true,packageDenied=false,failCompany=false,duplicateClient=false;
  const requests=[],signed=[];
  const bundle={file:{id:'case',company_id:'company',revision_no:2,status:'final_accepted'},shipments:[{shipment:{id:'shipment',data:{consignee:' Client   A '}},revision:{documents:[]}}]};
  const file=(owner,type,extra={})=>({id:type,file_type:type,title:type,storage_path:`${owner}/${type}/image.png`,is_active:true,mime_type:'image/png',metadata:{private:'never exposed',placement:{x:.1,y:.2,width:.15}},...extra});
  global.fetch=async(input,options={})=>{
    const url=new URL(input),path=url.pathname;requests.push({path,query:url.searchParams});
    if(path.endsWith('/bsgt_internal_package')){
      assert.equal(options.headers.Authorization,'Bearer employee');
      return packageDenied?new Response('',{status:403}):Response.json(bundle);
    }
    if(path.endsWith('/has_bsgt_workspace_permission')){assert.deepEqual(JSON.parse(options.body),{p_section:'relations',p_require_edit:true});return Response.json(edit);}
    if(path.endsWith('/has_feature_permission')){assert.equal(JSON.parse(options.body).p_permission_key,'client_assets.use');return Response.json(clientUse);}
    assert.equal(options.headers.Authorization,'Bearer test-service');
    if(path==='/rest/v1/company_profile_files'){
      if(failCompany)return new Response('',{status:500});
      assert.equal(url.searchParams.get('company_id'),'eq.company');
      return Response.json([
        file('company','stamp',{company_id:'company'}),file('company','signature',{company_id:'company',signatory_name:'Authorized company signer'}),
        file('other','stamp',{company_id:'other'}),file('company','bank_document',{company_id:'company'}),
        file('company','stamp',{company_id:'company',is_active:false}),file('other','stamp',{company_id:'company'}),
        file('company','stamp',{company_id:'company',mime_type:'application/pdf'})
      ]);
    }
    if(path==='/rest/v1/clients'){
      assert.equal(url.searchParams.get('select'),'id,name');assert.equal(url.searchParams.get('name'),'ilike.client%a');
      return Response.json([{id:'client',name:'CLIENT A'},...(duplicateClient?[{id:'duplicate',name:'client a'}]:[])]);
    }
    if(path==='/rest/v1/client_profile_files'){
      assert.equal(url.searchParams.get('client_id'),'eq.client');
      return Response.json([file('client','stamp',{client_id:'client'}),file('client','signature',{client_id:'client',signatory_id:'person'}),file('client','signature',{client_id:'client',signatory_id:'inactive'})]);
    }
    if(path==='/rest/v1/client_authorized_signatories')return Response.json([{id:'person',client_id:'client',active:true,name:'Authorized buyer',title:'Manager'}]);
    if(path.startsWith('/storage/v1/object/sign/')){
      assert.deepEqual(JSON.parse(options.body),{expiresIn:120});signed.push(path);
      return Response.json({signedURL:path.replace('/storage/v1','')+'?token=short-lived'});
    }
    throw Error('Unexpected request: '+path);
  };
  async function call(overrides={},token='employee'){
    const res={setHeader(){},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};
    await handler({method:'POST',headers:{authorization:token?`Bearer ${token}`:''},body:{action:'signing-assets',tradeFileId:'case',revisionNo:2,shipmentId:'shipment',...overrides}},res);return res;
  }
  try{
    assert.equal((await call({},'')).code,401);assert.equal(requests.length,0);
    packageDenied=true;assert.equal((await call()).code,409);packageDenied=false;
    edit=false;assert.equal((await call()).code,409);edit=true;
    assert.equal((await call({shipmentId:'other'})).code,409);
    assert.equal((await call({revisionNo:1})).code,409);
    for(const status of ['under_management_review','sent_to_collecting']){bundle.file.status=status;assert.equal((await call()).code,409);}
    assert.equal(signed.length,0);assert.equal(requests.filter(r=>!r.path.includes('/rpc/')).length,0);
    bundle.file.status='final_accepted';
    const result=await call({clientId:'other',companyId:'other',storagePath:'other/private.pdf'});
    assert.equal(result.code,200);
    for(const key of ['buyer-stamp','buyer-signature','company-stamp','company-signature'])assert.equal(result.body.sources[key].length,1,key);
    assert.equal(result.body.sources['buyer-signature'][0].label,'Authorized buyer');
    assert.deepEqual(result.body.sources['buyer-stamp'][0].placement,{x:.1,y:.2,width:.15});
    assert.ok(signed.every(path=>!path.includes('/other/')&&!path.includes('/bank_document/')));
    assert.ok(!JSON.stringify(result.body).includes('never exposed'));
    const before=requests.length;clientUse=false;
    const denied=await call();assert.equal(denied.code,200);assert.equal(denied.body.sources['buyer-stamp'].length,0);
    assert.match(denied.body.notes.join(' '),/صلاحية/);
    assert.ok(!requests.slice(before).some(r=>/\/clients$|\/client_profile_files$/.test(r.path)));
    clientUse=true;duplicateClient=true;assert.equal((await call()).body.sources['buyer-stamp'].length,0);
    failCompany=true;assert.equal((await call()).code,409,'read errors must not become an empty vault');
  }finally{global.fetch=savedFetch;if(savedKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=savedKey;}
});
