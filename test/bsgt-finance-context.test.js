'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const code=fs.readFileSync(require('node:path').join(__dirname,'../experiments/bs-collection/collection-revision-context.js'),'utf8');
function fixture(){
  const calls=[],alerts=[],file={id:'case',operation_no:'TC-1',status:'draft',revision_no:1,metadata:{}};
  const scope={shipments:[{shipment:{id:'selected',bsgt_stage:'ready_for_finance'}}],tradeFileId:'case',readOnly:false};
  const state={settings:{remittingBank:'BANK'},exchangeRate:3.67};
  const sb={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='get_bsgt_finance_context')return {data:scope};
    if(name==='bsgt_internal_package')return {data:{file}};
    if(name==='send_bsgt_trade_file_to_remitting')return {data:{...file,status:'sent_to_remitting'}};
    return {data:file};
  },from(table){assert.equal(table,'payments');return {select(){return this},in(column,ids){assert.equal(column,'shipment_id');assert.deepEqual([...ids],['selected']);return this},order:async()=>({data:[{shipment_id:'selected',amount:10}]})};},auth:{getSession:async()=>({data:{session:{access_token:'user'}}})}};
  const env={window:{},sb,state,requestedFinanceContext:'private-context',rowToShipment:row=>row,
    document:{body:{classList:{add(){}}}},confirm:()=>true,$:()=>null,
    selectedShipments:()=>[...state.selected].map(id=>({id,shipmentNo:id})),
    detected:()=>({rows:[{id:'selected',shipmentNo:'S1'}],currencies:['USD']}),collectionTotal:()=>({number:100,currency:'USD'}),
    collectionDocumentKinds:()=>['letter','undertaking','exchange'],CollectionHtmlTemplates:{exportPdf:async()=>new Uint8Array([1,2,3])},
    btoa:s=>Buffer.from(s,'binary').toString('base64'),renderAll(){},showCollectionNotice(){},alert:message=>alerts.push(message),
    fetch:async(url,options)=>{calls.push({name:url,args:JSON.parse(options.body)});return {ok:true,json:async()=>({file})};}
  };
  vm.runInNewContext(code,env);return {api:env.window.CollectionRevisionContext,calls,alerts,state,scope};
}
test('finance loads only scoped snapshots/payments and stores all three original templates before send',async()=>{
  const f=fixture();await f.api.load();assert.deepEqual(f.state.shipments.map(s=>s.id),['selected']);
  assert.equal(f.state.payments.selected[0].amount,10);
  await f.api.send();assert.deepEqual(f.alerts,[]);
  const store=f.calls.findIndex(c=>c.name==='/api/bsgt-internal-document'),send=f.calls.findIndex(c=>c.name==='send_bsgt_trade_file_to_remitting');
  assert.ok(store>=0&&send>store);assert.deepEqual(Object.keys(f.calls[store].args.generated).sort(),['exchange','letter','undertaking']);
  assert.equal(f.calls[store].args.contextId,'private-context');assert.equal(f.state.tradeFile.status,'sent_to_remitting');
});
test('tampered selection and submitted context cannot generate or submit documents',async()=>{
  const f=fixture();await f.api.load();f.state.selected.add('outside');await f.api.send();
  assert.equal(f.alerts.length,1);assert.equal(f.calls.some(c=>c.name==='open_bsgt_finance_context_trade_file'),false);
  f.state.selected.delete('outside');f.scope.readOnly=true;await f.api.send();
  assert.equal(f.alerts.length,2);assert.equal(f.calls.some(c=>c.name==='/api/bsgt-internal-document'),false);
});
