'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const assets = require('../contract-client-assets');
const resolver = require('../consignee-client-resolver');

const index = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const wizard = fs.readFileSync(path.join(__dirname,'..','company-wizard.js'),'utf8');
const importPermit = fs.readFileSync(path.join(__dirname,'..','import-permit.js'),'utf8');
const collection = fs.readFileSync(path.join(__dirname,'..','experiments','bs-collection','collection-lab.js'),'utf8');
let checks = 0;
async function check(name, fn){ await fn(); checks += 1; console.log(`✔ ${name}`); }

function repository(files, signatories){
  return {
    async loadFiles(){ return files; },
    async loadSignatories(){ return signatories; },
    async createSignedUrl(storagePath){ return `signed://${storagePath}`; }
  };
}

async function main(){
  const clients=[{id:'client-a',name:'ALPHA LLC'},{id:'client-b',name:'BETA LLC'}];
  const stampA={id:'stamp-a',client_id:'client-a',file_type:'stamp',is_active:true,storage_path:'client-a/stamp/a.png'};
  const signatureA={id:'signature-a',client_id:'client-a',file_type:'signature',is_active:true,storage_path:'client-a/signature/a.png',signatory_id:'person-a'};
  const stampB={id:'stamp-b',client_id:'client-b',file_type:'stamp',is_active:true,storage_path:'client-b/stamp/b.png'};
  const personA={id:'person-a',client_id:'client-a',name:'Ahmed Ali',title:'Manager',active:true};

  await check('consignee A resolves client A through the central resolver', () => {
    const result=assets.resolveContractClient({record:{consignee:' alpha llc '},clients,resolver});
    assert.strictEqual(result.client.id,'client-a');
  });
  await check('client B assets are excluded from client A context', () => {
    const scoped=assets.scopeAssets([stampA,stampB],[personA],'client-a');
    assert.deepStrictEqual(scoped.files.map(file=>file.id),['stamp-a']);
    const checked=assets.validateApproval(
      {client:clients[0],files:[Object.assign({},stampB,{signedUrl:'signed://client-b/stamp/b.png'})],signatories:[]},
      {clientId:'client-a',stampFileId:'stamp-b',useStamp:true}
    );
    assert.strictEqual(checked.stamp,null);
  });
  await check('only client A stamp is available to contract A', async () => {
    const record={consignee:'ALPHA LLC',clientContractApproval:{clientId:'client-a',stampFileId:'stamp-a',useStamp:true}};
    const context=await assets.loadContractClientAssets({record,clients,resolver,repository:repository([stampA,stampB],[personA])});
    assert.strictEqual(record.__clientContractAssets.stampFileId,'stamp-a');
    assert.ok(!context.files.some(file=>file.id==='stamp-b'));
  });
  await check('signature resolves its authorized signatory', async () => {
    const record={consignee:'ALPHA LLC',clientContractApproval:{clientId:'client-a',signatureFileId:'signature-a',signatoryId:'person-a',useSignature:true}};
    await assets.loadContractClientAssets({record,clients,resolver,repository:repository([signatureA],[personA])});
    assert.strictEqual(record.__clientContractAssets.signatory.name,'Ahmed Ali');
  });
  await check('archived selected asset is never used', () => {
    const context={client:clients[0],files:[],signatories:[]};
    const checked=assets.validateApproval(context,{clientId:'client-a',stampFileId:'archived',useStamp:true});
    assert.strictEqual(checked.stamp,null);
    assert.match(checked.warnings.join(' '),/مؤرشف/);
  });
  await check('asset is not rendered when its private signed URL fails', () => {
    const context={client:clients[0],files:[Object.assign({},stampA,{signedUrl:'',signedUrlError:'expired'})],signatories:[]};
    const checked=assets.validateApproval(context,{clientId:'client-a',stampFileId:'stamp-a',useStamp:true});
    assert.strictEqual(checked.stamp,null);
    assert.match(checked.warnings.join(' '),/تعذر فتح ختم/);
  });
  await check('saved approval survives a record refresh', () => {
    const saved={clientId:'client-a',stampFileId:'stamp-a',useStamp:true,buyerStampX:61};
    assert.deepStrictEqual(assets.approvalFromRecord({data:{clientContractApproval:saved}}).stampFileId,'stamp-a');
    assert.strictEqual(assets.approvalFromRecord({clientContractApproval:saved}).buyerStampX,61);
  });
  await check('seller contract assets remain in contractBranding', () => {
    assert.ok(index.includes("settings.useContractStamp === true"));
    assert.ok(index.includes('bahar-contract-stamp'));
    assert.ok(wizard.includes('contractBranding:clone(draft)'));
  });
  await check('buyer assets are isolated to the contract renderer', () => {
    assert.ok(index.includes('bahar-contract-buyer-stamp'));
    assert.ok(index.includes('bahar-contract-buyer-signature'));
    assert.ok(!/function baharSwakenInvoiceSheet[\s\S]*?bahar-contract-buyer-stamp/.test(index.slice(index.indexOf('function baharSwakenInvoiceSheet'),index.indexOf('function baharSwakenContractSheet'))));
  });
  await check('invoice BOL collection and import permit paths have no buyer layers', () => {
    const invoiceSegment=index.slice(index.indexOf('function baharSwakenInvoiceSheet'),index.indexOf('function baharSwakenContractSheet'));
    const bolSegment=index.slice(index.indexOf('function bolSheet(r)'),index.indexOf('function baharSwakenInvoiceSheet'));
    for(const source of [invoiceSegment,bolSegment,collection,importPermit]){
      assert.ok(!source.includes('bahar-contract-buyer-stamp'));
      assert.ok(!source.includes('clientContractApproval'));
    }
  });
  await check('preview print and PDF paths prepare the same verified assets', () => {
    assert.ok(wizard.includes('prepareBaharContractClientAssets'));
    assert.ok(!wizard.includes("if(typeof syncConsigneeClientsFromApp === 'function') await syncConsigneeClientsFromApp()"));
    assert.ok(index.includes("if(kind === 'contract' && isBsgtRecord(r)) await prepareBaharContractClientAssets(r)"));
    assert.ok(index.includes("if(kind === 'contract' && isBsgtRecord(record)) await prepareBaharContractClientAssets(record)"));
  });

  assert.strictEqual(checks,11);
  console.log(`\n${checks} contract client asset checks passed`);
}

main().catch(error=>{ console.error(error); process.exit(1); });
