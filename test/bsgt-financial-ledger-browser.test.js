'use strict';
// «المركز المالي» phase 2 browser test (mocked Supabase; no production data).
// Covers: the four tabs, chart initialisation + cash/bank account creation, voucher draft → post
// (maker-checker + admin override) → reverse with lock_version and string money, settlement preview
// and version-bound posting, the ledger card inside a financial file (approve costs, delivery,
// linked vouchers), client statement with opening/closing rows, disabled-activation notice,
// view-only limits, no console errors, phone width.
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {spawn}=require('child_process');
const {chromium}=require('playwright-core');

const PORT=5700+Math.floor(Math.random()*100);
const BASE=`http://127.0.0.1:${PORT}`;
const APP=`http://jahez.test:${PORT}`;
const SUPABASE='https://vthcmqqiexaedukduquv.supabase.co';
const company={id:'bsgt-company',name_ar:'بحر سواكن للتجارة العامة',name_en:'Bahar Swaken General Trading',active:true,is_default:false,sort_order:1,settings:{}};
const FILE_ID='30000000-0000-4000-8000-000000000001', TC_ID='20000000-0000-4000-8000-000000000001', CLIENT_ID='c0000000-0000-4000-8000-000000000001';
function executable(){return [process.env.CHROMIUM_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean).find(fs.existsSync);}
function jwt(id){const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');return `${enc({alg:'HS256'})}.${enc({sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated'})}.x`;}
async function waitServer(proc){for(let i=0;i<50;i++){if(proc.exitCode!==null)throw Error('server exited');try{if((await fetch(`${BASE}/healthz`)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}throw Error('server timeout');}
const quiet=list=>list.filter(e=>!/WebSocket|ERR_TUNNEL|net::|Failed to load resource/.test(e));
const fail=(message)=>{throw Object.assign(new Error(message),{status:400});};

// Mocked ledger database: money is always a string, as PostgREST ::text / the RPC json helpers emit it.
function makeDb(){
  const file={id:FILE_ID,trade_file_id:TC_ID,company_id:company.id,status:'bank_paid',lock_version:9,consignee_snapshot:'TEST BUYER ONE',consignee_count:1,client_id:CLIENT_ID,client_name_snapshot:'TEST BUYER ONE',client_confirmed_at:'2026-09-20T08:00:00Z',client_confirmed_by:'acc-1',
    invoice_total_usd:'1500.000000',documents_value_aed:'5000.000000',bank_tariff_per_1000_sdg:'150000.000000',bsgt_tariff_per_1000_sdg:'200000.000000',bank_cost_sdg:'225000.000000000000000',bsgt_commission_sdg:'300000.000000000000000',import_permit_source:'bsgt',import_permit_cost_sdg:'500000.000000',import_permit_no:'IP-100',import_permit_issued_at:null,import_permit_expires_at:null,import_permit_issuer:null,
    client_total_sdg:'1025000.000000000000000',calculation_ready:true,last_input_at:'2026-09-20T08:00:00Z',last_input_by:'acc-1',approved_at:'2026-09-20T09:00:00Z',approved_by:'fm-1',client_transferred_at:'2026-09-20T10:00:00Z',client_transferred_by:'fm-1',bank_paid_at:'2026-09-20T11:00:00Z',bank_paid_by:'fm-1',completed_at:null,completed_by:null,failed_at:null,failed_by:null,failure_reason:null,refund_started_at:null,refund_started_by:null,refunded_at:null,refunded_by:null,closed_at:null,closed_by:null,notes:null,created_by:'acc-1',created_at:'2026-09-20T08:00:00Z',updated_at:'2026-09-20T11:00:00Z'};
  const settings={company_id:company.id,file_vouchers_enabled:true};
  let ledgerState={financial_file_id:FILE_ID,ledger_mode:'ledger',opened_at:'2026-09-20T09:30:00Z',delivery_confirmed_at:null,delivery_confirmed_by:null,delivery_note:null,approved_bank_cost_sdg:null,approved_permit_cost_sdg:null,costs_approved_at:null,costs_note:null,refund_due_sdg:null,refund_due_at:null,refund_allocated_sdg:null,refund_allocation_approved_at:null,lock_version:1};
  const accounts=[];
  const seed=()=>{if(accounts.length)return 0;[['1100','الصناديق','asset','group',false],['1200','البنوك','asset','group',false],['1410','مدفوع للبنك نيابة عن العملاء','asset','paid_bank',true],['1420','مدفوع لأذونات الاستيراد نيابة عن العملاء','asset','paid_permit',true],['1500','مستحق استرداده من البنوك والجهات','asset','recoverable',true],['2100','حسابات العملاء (أمانات وجارٍ)','liability','client_control',true],['4100','إيراد عمولات BSGT','revenue','commission_revenue',true]]
    .forEach(([code,name_ar,kind,role,postable])=>accounts.push({id:'acc-'+code,code,name_ar,kind,role,parent_id:null,postable,is_system:true,active:true,lock_version:1,debit_total:'0',credit_total:'0',balance:'0'}));return 7;};
  const vouchers=[];const entries=[];const events=[];let seq=0;let no=0;
  const calls=[];
  const totals=()=>({financial_file_id:FILE_ID,ledger_mode:'ledger',delivery_confirmed_at:ledgerState.delivery_confirmed_at,approved_bank_cost_sdg:ledgerState.approved_bank_cost_sdg,approved_permit_cost_sdg:ledgerState.approved_permit_cost_sdg,costs_approved_at:ledgerState.costs_approved_at,
    receipts_sdg:'900000',commission_advance_sdg:'100000',refunds_sdg:'0',allocated_in_sdg:'0',allocated_out_sdg:'0',client_deposit_sdg:'1000000',client_charged_sdg:vouchers.some(v=>v.voucher_type==='settlement'&&v.status==='posted')?'1030000.000000000000000':'0',
    client_balance_sdg:'1000000',balance_for_client_sdg:'1000000',due_from_client_sdg:vouchers.some(v=>v.voucher_type==='settlement'&&v.status==='posted')?'30000.000000000000000':'0',bank_paid_sdg:'230000',permit_paid_sdg:'500000',bank_unbilled_sdg:'0',permit_unbilled_sdg:'0',
    recoverable_outstanding_sdg:'0',recovered_sdg:'0',client_total_computed_sdg:file.client_total_sdg,bank_cost_computed_sdg:file.bank_cost_sdg,commission_sdg:file.bsgt_commission_sdg,settled:vouchers.some(v=>v.voucher_type==='settlement'&&v.status==='posted'),failure_reclassified:false});
  const preview=()=>{if(!ledgerState.costs_approved_at)fail('Approve the actual bank/permit costs first (approve_fin_file_costs)');if(!ledgerState.delivery_confirmed_at)fail('Settlement requires the delivery confirmation (confirm_fin_file_delivery) first');
    return {bank_actual_sdg:ledgerState.approved_bank_cost_sdg,bank_computed_sdg:file.bank_cost_sdg,bank_variance_sdg:'5000.000000000000000',permit_actual_sdg:ledgerState.approved_permit_cost_sdg,permit_entered_sdg:file.import_permit_cost_sdg,permit_variance_sdg:'0.000000',commission_sdg:file.bsgt_commission_sdg,client_total_computed_sdg:file.client_total_sdg,settled_total_sdg:ledgerState.approved_bank_cost_sdg==='230000'?'1030000.000000000000000':'1030000.500000000000000',client_balance_before:'1000000',client_balance_after:'-30000.000000000000000',preview:true,lines:[1,2,3,4],total:'1030000.000000000000000'};};
  const vjson=v=>({...v});
  const rpc={
    list_fin_accounts:()=>accounts.map(a=>({...a})),
    init_fin_chart:()=>({created:seed(),accounts:accounts.map(a=>({...a}))}),
    create_fin_account:body=>{const p=body.p;if(!/^[0-9]{4,12}$/.test(p.code))fail('new row for relation "fin_accounts" violates check constraint "fin_accounts_code_check"');if(accounts.some(a=>a.code===p.code))fail(`Account code ${p.code} already exists`);
      const a={id:'acc-'+p.code,code:p.code,name_ar:p.name_ar,kind:'asset',role:p.role,parent_id:p.role==='cash'?'acc-1100':'acc-1200',postable:true,is_system:false,active:true,lock_version:1,debit_total:'0',credit_total:'0',balance:'0'};accounts.push(a);return {account:{...a}};},
    update_fin_account:body=>{const a=accounts.find(x=>x.id===body.p_id);if(a.lock_version!==body.p_expected_lock_version)fail(`Account version changed (expected ${body.p_expected_lock_version}, current ${a.lock_version}); reload and retry`);a.name_ar=body.p_patch.name_ar??a.name_ar;a.active=body.p_patch.active??a.active;a.lock_version+=1;return {account:{...a},changed:true};},
    list_fin_vouchers:body=>vouchers.filter(v=>!body.p_file||v.financial_file_id===body.p_file).filter(v=>!body.p_status||v.status===body.p_status).slice(0,body.p_limit||10).map(v=>({id:v.id,voucher_no:v.voucher_no,voucher_type:v.voucher_type,status:v.status,voucher_date:v.voucher_date,amount:v.amount,client_id:v.client_id,client_name:v.client_id?'TEST BUYER ONE':null,financial_file_id:v.financial_file_id,operation_no:v.financial_file_id?'TC-2026-000101':null,cash_account_code:accounts.find(a=>a.id===v.cash_account_id)?.code||null,purpose:v.purpose,reference:v.reference,memo:v.memo,lock_version:v.lock_version,created_at:v.created_at,posted_at:v.posted_at})),
    create_fin_voucher:body=>{const p=body.p;if(typeof p.amount==='number')fail('Amount must be sent as a string to preserve precision');
      if(p.request_id){const dup=vouchers.find(v=>v.request_id===p.request_id);if(dup)return {voucher:vjson(dup),voucher_id:dup.id,lock_version:dup.lock_version,created:false};}
      if(p.financial_file_id&&!settings.file_vouchers_enabled)fail('File-linked vouchers are not enabled for this company yet');
      const v={id:'v-'+(vouchers.length+1),request_id:p.request_id||null,voucher_type:p.voucher_type,status:'draft',voucher_no:null,voucher_date:p.voucher_date||'2026-09-21',amount:p.voucher_type==='settlement'?null:(p.amount??null),cash_account_id:p.cash_account_id||null,counter_account_id:p.counter_account_id||null,client_id:p.client_id||(p.financial_file_id?CLIENT_ID:null),financial_file_id:p.financial_file_id||null,target_file_id:null,purpose:p.purpose||(p.voucher_type==='receipt'?(p.financial_file_id?'file_transfer':'other'):null),direction:p.direction||null,reference:p.reference||null,memo:p.memo||null,reason:p.reason||null,
        details:p.voucher_type==='settlement'?preview():{},lock_version:1,last_input_by:body.__actor,journal_entry_id:null,posted_at:null,posted_by:null,reversal_entry_id:null,reversed_at:null,reversal_reason:null,created_at:new Date(Date.now()+vouchers.length*1000).toISOString()};
      vouchers.push(v);events.push({id:events.length+1,entity_type:'voucher',entity_id:v.id,event_type:'created',lock_version_after:1,note:null,changes:{voucher_type:v.voucher_type,amount:v.amount},created_at:new Date().toISOString()});return {voucher:vjson(v),voucher_id:v.id,lock_version:1,created:true};},
    update_fin_voucher_draft:body=>{const v=vouchers.find(x=>x.id===body.p_id);if(v.lock_version!==body.p_expected_lock_version)fail(`Voucher version changed (expected ${body.p_expected_lock_version}, current ${v.lock_version}); reload and retry`);if(v.status!=='draft')fail(`Action not allowed for voucher status ${v.status}`);
      const p=body.p_patch;let changed=false;for(const k of ['amount','memo','reference','voucher_date','cash_account_id','reason']){if(p[k]!==undefined&&p[k]!==v[k]){v[k]=p[k];changed=true;}}
      if(v.voucher_type==='settlement'){const d=preview();if(JSON.stringify(d.settled_total_sdg)!==JSON.stringify(v.details.settled_total_sdg)){v.details=d;changed=true;}}
      if(changed){v.lock_version+=1;v.last_input_by=body.__actor;events.push({id:events.length+1,entity_type:'voucher',entity_id:v.id,event_type:'draft_updated',lock_version_after:v.lock_version,note:null,changes:p,created_at:new Date().toISOString()});}return {voucher:vjson(v),lock_version:v.lock_version,changed};},
    cancel_fin_voucher:body=>{const v=vouchers.find(x=>x.id===body.p_id);if(v.lock_version!==body.p_expected_lock_version)fail('Voucher version changed');v.status='cancelled';v.lock_version+=1;return {voucher:vjson(v),lock_version:v.lock_version};},
    post_fin_voucher:body=>{const v=vouchers.find(x=>x.id===body.p_id);if(v.lock_version!==body.p_expected_lock_version)fail(`Voucher version changed (expected ${body.p_expected_lock_version}, current ${v.lock_version}); reload and retry`);if(v.status==='posted')fail(`Voucher is already posted (${v.voucher_no})`);
      if(v.last_input_by===body.__actor&&!body.p_override_reason)fail('Maker-checker: the last person who entered this voucher cannot post it');
      if(v.voucher_type==='settlement'){const d=preview();if(d.settled_total_sdg!==v.details.settled_total_sdg)fail(`Computed components changed since the draft was reviewed (reviewed ${v.details.settled_total_sdg}, now ${d.settled_total_sdg}); refresh the draft (update_fin_voucher_draft) and review again`);v.amount=d.settled_total_sdg;}
      seq+=1;no+=1;const prefix={receipt:'RV',payment_bank:'PV',transfer:'TR',settlement:'ST',refund:'RF'}[v.voucher_type]||'XX';v.voucher_no=`${prefix}-2026-${String(no).padStart(6,'0')}`;
      const lines=v.voucher_type==='settlement'?[{line_no:1,account_code:'2100',account_name:'حسابات العملاء',debit:v.amount,credit:'0',memo:'settlement'},{line_no:2,account_code:'1410',account_name:'مدفوع للبنك',debit:'0',credit:ledgerState.approved_bank_cost_sdg,memo:''},{line_no:3,account_code:'1420',account_name:'مدفوع للإذن',debit:'0',credit:ledgerState.approved_permit_cost_sdg,memo:''},{line_no:4,account_code:'4100',account_name:'إيراد العمولة',debit:'0',credit:file.bsgt_commission_sdg,memo:''}]
        :[{line_no:1,account_code:accounts.find(a=>a.id===(v.voucher_type==='transfer'?v.counter_account_id:v.cash_account_id))?.code||'1101',account_name:'حساب',debit:v.amount,credit:'0',memo:v.memo},{line_no:2,account_code:v.voucher_type==='transfer'?accounts.find(a=>a.id===v.cash_account_id)?.code:'2100',account_name:'حساب مقابل',debit:'0',credit:v.amount,memo:v.memo}];
      const e={id:'e-'+seq,entry_no:`JE-2026-${String(seq).padStart(6,'0')}`,entry_date:v.voucher_date,voucher_id:v.id,kind:'post',reverses_entry_id:null,total_debit:v.amount,total_credit:v.amount,posting_seq:seq,lines};entries.push(e);
      v.status='posted';v.journal_entry_id=e.id;v.posted_at=new Date().toISOString();v.posted_by=body.__actor;v.lock_version+=1;events.push({id:events.length+1,entity_type:'voucher',entity_id:v.id,event_type:'posted',lock_version_after:v.lock_version,note:body.p_override_reason?`ADMIN OVERRIDE (maker-checker): ${body.p_override_reason}`:null,changes:{voucher_no:v.voucher_no,entry_no:e.entry_no},created_at:new Date().toISOString()});
      return {voucher:vjson(v),entry:{...e},lock_version:v.lock_version};},
    reverse_fin_voucher:body=>{const v=vouchers.find(x=>x.id===body.p_id);if(v.lock_version!==body.p_expected_lock_version)fail('Voucher version changed');if(!body.p_reason||!body.p_reason.trim())fail('Reversal reason is required');if(v.status!=='posted')fail(`Only posted vouchers can be reversed (status ${v.status})`);
      const later=vouchers.find(w=>w.status==='posted'&&w.id!==v.id&&w.financial_file_id===v.financial_file_id&&v.financial_file_id&&w.voucher_type==='refund'&&v.voucher_type==='receipt');if(later)fail(`Reverse the later voucher ${later.voucher_no} (${later.voucher_type}) first`);
      seq+=1;const o=entries.find(e=>e.id===v.journal_entry_id);const e={id:'e-'+seq,entry_no:`JE-2026-${String(seq).padStart(6,'0')}`,entry_date:'2026-09-21',voucher_id:v.id,kind:'reversal',reverses_entry_id:o.id,total_debit:o.total_debit,total_credit:o.total_credit,posting_seq:seq,lines:o.lines.map(l=>({...l,debit:l.credit,credit:l.debit}))};entries.push(e);
      v.status='reversed';v.reversal_entry_id=e.id;v.reversed_at=new Date().toISOString();v.reversal_reason=body.p_reason;v.lock_version+=1;events.push({id:events.length+1,entity_type:'voucher',entity_id:v.id,event_type:'reversed',lock_version_after:v.lock_version,note:body.p_reason,changes:null,created_at:new Date().toISOString()});return {voucher:vjson(v),reversal_entry:{...e},lock_version:v.lock_version};},
    get_fin_voucher:body=>{const v=vouchers.find(x=>x.id===body.p_id);if(!v)fail('Voucher not found');return {voucher:vjson(v),entry:entries.find(e=>e.id===v.journal_entry_id)||null,reversal_entry:entries.find(e=>e.id===v.reversal_entry_id)||null,events:events.filter(e=>e.entity_id===v.id)};},
    fin_file_ledger_totals:()=>totals(),
    fin_file_refund_status:()=>({ledger_mode:'ledger',refund_due_sdg:null,received_after_failure_sdg:'0',refund_total_due_sdg:'0',refunded_cash_sdg:'0',allocated_after_failure_sdg:'0',refund_allocated_approved_sdg:null,refund_allocation_valid:null,refund_remaining_sdg:'0',recoverable_outstanding_sdg:'0'}),
    approve_fin_file_costs:body=>{if(body.p_expected_lock_version!==ledgerState.lock_version)fail(`File ledger version changed (expected ${body.p_expected_lock_version}, current ${ledgerState.lock_version}); reload and retry`);if(typeof body.p_bank_cost!=='string')fail('bank cost must be text');
      if(file.import_permit_source==='bsgt'&&!body.p_permit_cost)fail('Approved permit cost is required for a BSGT-paid permit');ledgerState={...ledgerState,approved_bank_cost_sdg:body.p_bank_cost,approved_permit_cost_sdg:body.p_permit_cost,costs_approved_at:new Date().toISOString(),costs_note:body.p_note,lock_version:ledgerState.lock_version+1};return {state:{...ledgerState}};},
    confirm_fin_file_delivery:body=>{if(body.p_expected_lock_version!==ledgerState.lock_version)fail('File ledger version changed');ledgerState={...ledgerState,delivery_confirmed_at:new Date().toISOString(),delivery_confirmed_by:body.__actor,delivery_note:body.p_note,lock_version:ledgerState.lock_version+1};return {state:{...ledgerState}};},
    preview_fin_settlement:()=>preview(),
    fin_trial_balance:()=>accounts.filter(a=>a.postable).map(a=>({code:a.code,name_ar:a.name_ar,kind:a.kind,role:a.role,is_system:a.is_system,debit_total:a.code==='1101'?'1000.123456':'0',credit_total:a.code==='2100'?'1000.123456':'0',balance_debit:a.code==='1101'?'1000.123456':'0',balance_credit:a.code==='2100'?'1000.123456':'0'})),
    fin_client_statement:body=>{if(!body.p_client)fail('Client is required');return [{row_kind:'opening',entry_date:body.p_from,entry_no:null,entry_kind:null,voucher_no:null,voucher_type:null,financial_file_id:null,operation_no:null,memo:'opening balance',debit:null,credit:null,balance:'1000'},
      {row_kind:'line',entry_date:'2026-09-21',entry_no:'JE-2026-000004',entry_kind:'post',voucher_no:'RV-2026-000002',voucher_type:'receipt',financial_file_id:FILE_ID,operation_no:'TC-2026-000101',memo:'تحويل',debit:'0',credit:'40000',balance:'41000'},
      {row_kind:'closing',entry_date:body.p_to,entry_no:null,entry_kind:null,voucher_no:null,voucher_type:null,financial_file_id:null,operation_no:null,memo:'closing balance',debit:'0',credit:'40000',balance:'41000'}];}
  };
  return {file,settings,get ledgerState(){return ledgerState;},accounts,vouchers,entries,calls,rpc,flags:{failState:false,failNextCreate:false}};
}

async function contextFor(browser,db,{role,id,featureKeys,width=1440}){
  const profile={id,email:`${id}@example.test`,display_name:`موظف ${role}`,role,active:true,photo_url:'',feature_permissions_initialized:true};
  const context=await browser.newContext({viewport:{width,height:900}});
  const exp=Math.floor(Date.now()/1000)+3600;
  await context.addInitScript(({profile,exp,token})=>localStorage.setItem('shipdocs-auth',JSON.stringify({access_token:token,refresh_token:'r',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id:profile.id,email:profile.email,aud:'authenticated',role:'authenticated'}})),{profile,exp,token:jwt(id)});
  await context.route(`${SUPABASE}/**`,async route=>{const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':APP,'Access-Control-Allow-Headers':'authorization, apikey, content-type, prefer, x-client-info, accept-profile, content-profile','Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, DELETE, OPTIONS','Content-Type':'application/json'};
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    const json=(status,body)=>route.fulfill({status,headers,body:JSON.stringify(body)});
    const single=String(req.headers().accept||'').includes('vnd.pgrst.object');
    if(url.pathname==='/rest/v1/profiles'){const filter=url.searchParams.get('id')||'';const named=pid=>pid===id?profile:{id:pid,display_name:pid==='admin-1'?'مدير النظام':pid==='fm-1'?'مدير المالية':'المحاسب',email:pid+'@x'};
      if(filter.startsWith('in.('))return json(200,filter.slice(4,-1).split(',').filter(Boolean).map(named));if(filter.startsWith('eq.'))return json(200,single?named(filter.slice(3)):[named(filter.slice(3))]);return json(200,[profile]);}
    if(url.pathname==='/rest/v1/companies')return json(200,[company]);
    if(url.pathname==='/rest/v1/rpc/get_user_feature_permissions')return json(200,featureKeys.map(permission_key=>({permission_key,allowed:true})));
    if(url.pathname==='/rest/v1/rpc/get_bsgt_workspace_permissions')return json(200,[]);
    if(url.pathname.startsWith('/rest/v1/rpc/')){const name=url.pathname.slice('/rest/v1/rpc/'.length);const body={...(req.postDataJSON()||{}),__actor:id};db.calls.push({name,body:{...body}});
      if(name==='create_fin_voucher'&&db.flags.failNextCreate){db.flags.failNextCreate=false;return route.fulfill({status:503,headers,body:JSON.stringify({message:'upstream timeout'})});}
      if(name==='list_bsgt_financial_files')return json(200,[{id:FILE_ID,trade_file_id:TC_ID,operation_no:'TC-2026-000101',trade_status:'sent_to_collecting',trade_archived_at:null,status:db.file.status,closed_at:null,consignee_snapshot:'TEST BUYER ONE',consignee_count:1,client_id:CLIENT_ID,client_name_snapshot:'TEST BUYER ONE',invoice_total_usd:db.file.invoice_total_usd,client_total_sdg:db.file.client_total_sdg,calculation_ready:true,lock_version:db.file.lock_version,updated_at:db.file.updated_at}]);
      if(!db.rpc[name])return json(200,[]);try{return json(200,db.rpc[name](body));}catch(error){return json(400,{message:error.message,code:'P0001'});}}
    if(url.pathname==='/rest/v1/fin_ledger_settings'){db.calls.push({name:'GET settings'});return json(200,single?{...db.settings}:[{...db.settings}]);}
    if(url.pathname==='/rest/v1/fin_file_ledger_state'){db.calls.push({name:'GET state',select:url.searchParams.get('select')});if(db.flags.failState)return json(500,{message:'connection reset'});return json(200,single?{...db.ledgerState}:[{...db.ledgerState}]);}
    if(url.pathname==='/rest/v1/clients'){db.calls.push({name:'GET clients',q:url.search});return json(200,[{id:CLIENT_ID,name:'TEST BUYER ONE',name_ar:'المشتري الأول',name_en:'TEST BUYER ONE'},{id:'c0000000-0000-4000-8000-000000000002',name:'OTHER BUYER',name_ar:null,name_en:null}]);}
    if(url.pathname==='/rest/v1/bsgt_financial_files')return json(200,single?{...db.file}:[{...db.file}]);
    if(url.pathname==='/rest/v1/bsgt_financial_file_invoices')return json(200,[]);
    if(url.pathname==='/rest/v1/bsgt_financial_file_events')return json(200,[]);
    if(url.pathname==='/rest/v1/trade_collection_files')return json(200,single?{id:TC_ID,operation_no:'TC-2026-000101',status:'sent_to_collecting',archived_at:null}:[]);
    if(req.method()==='HEAD')return route.fulfill({status:200,headers:{...headers,'Content-Range':'0-0/0'},body:''});
    return json(200,[]);
  });
  return context;
}
function track(page){const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});return ()=>quiet(errors);}

async function main(){
  const browserPath=executable();if(!browserPath)throw Error('Chrome not found');
  const server=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:String(PORT)},stdio:['ignore','inherit','inherit']});let browser;
  try{
    await waitServer(server);browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP jahez.test 127.0.0.1']});
    const shots=process.env.SHOT_DIR;
    const db=makeDb();
    const dialogsOf=page=>{const list=[];page.on('dialog',async d=>{list.push({type:d.type(),message:d.message()});if(d.type()==='prompt')await d.accept(page.__promptAnswer||'سبب اختبار');else await d.accept();});return list;};

    // ---------------------------------------------------------------- finance manager (view + edit + approve): accounts, vouchers, reports
    const fm=await contextFor(browser,db,{role:'editor',id:'fm-1',featureKeys:['bsgt.financial_center.view','bsgt.financial_center.edit','bsgt.financial_center.approve']});
    const page=await fm.newPage();const fmErrors=track(page);const fmDialogs=dialogsOf(page);
    await page.goto(`${APP}/#v=bsgtWorkspace&section=financialCenter`,{waitUntil:'domcontentloaded'});
    await page.locator('#bsgtFinancialCenter [data-list-rows] tr[data-open]').first().waitFor({timeout:20000});
    assert.deepStrictEqual(await page.locator('.fc-tab').allTextContents(),['الملفات المالية','السندات','الحسابات','التقارير']);
    // accounts: init chart then create a cash account
    await page.locator('.fc-tab[data-tab="accounts"]').click();
    await page.locator('[data-action="init-chart"]').waitFor({timeout:10000});
    await page.locator('[data-action="init-chart"]').click();
    await page.locator('[data-action="new-account"]').waitFor({timeout:10000});
    assert.strictEqual(await page.locator('.fc-table tbody tr').count(),7,'seven system accounts');
    await page.locator('[data-action="new-account"]').click();
    await page.fill('[data-form="account"] [name="code"]','1101');await page.fill('[data-form="account"] [name="name_ar"]','الصندوق الرئيسي');
    await page.locator('[data-form="account"] button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.fc-table tbody tr').length===8,null,{timeout:10000});
    assert.deepStrictEqual(db.calls.find(c=>c.name==='create_fin_account').body.p,{code:'1101',name_ar:'الصندوق الرئيسي',role:'cash'});
    await page.locator('[data-action="new-account"]').click();
    await page.fill('[data-form="account"] [name="code"]','1201');await page.fill('[data-form="account"] [name="name_ar"]','بنك الخرطوم');await page.selectOption('[data-form="account"] [name="role"]','bank');
    await page.locator('[data-form="account"] button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.fc-table tbody tr').length===9,null,{timeout:10000});
    assert.strictEqual(await page.locator('[data-edit-account]').count(),2,'only non-system accounts editable');
    if(shots) await page.screenshot({path:path.join(shots,'fl-accounts.png'),fullPage:true});
    // vouchers: transfer draft (string amount), maker-checker blocks FM posting own draft
    await page.locator('.fc-tab[data-tab="vouchers"]').click();
    await page.locator('[data-action="new-voucher"]').waitFor({timeout:10000});
    await page.locator('[data-action="new-voucher"]').click();
    // receipt form: file picked by TC number fills the client automatically
    await page.fill('[data-form="voucher"] [data-picker="financial_file_id"] [data-picker-query]','TC-2026-0001');await page.locator('[data-form="voucher"] [data-picker="financial_file_id"] [data-picker-go]').click();
    await page.locator('[data-form="voucher"] [data-picker="financial_file_id"] [data-pick="0"]').waitFor({timeout:10000});await page.locator('[data-form="voucher"] [data-picker="financial_file_id"] [data-pick="0"]').click();
    assert.strictEqual(await page.locator('[data-form="voucher"] [name="client_id"]').inputValue(),CLIENT_ID,'client id filled from the chosen file');
    assert.match(await page.locator('[data-form="voucher"] [data-picker="client_id"] [data-chosen]').innerText(),/TEST BUYER ONE/);
    await page.selectOption('[data-form="voucher"] [name="voucher_type"]','transfer');
    await page.selectOption('[data-form="voucher"] [name="cash_account_id"]','acc-1101');await page.selectOption('[data-form="voucher"] [name="counter_account_id"]','acc-1201');
    await page.fill('[data-form="voucher"] [name="amount"]','1,000.123456');await page.fill('[data-form="voucher"] [name="memo"]','إيداع نقدية');
    db.flags.failNextCreate=true;   // first attempt: the reply is lost (503); the user submits again
    await page.locator('[data-form="voucher"] button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-form="voucher"]')&&!document.querySelector('[data-voucher]'),null,{timeout:10000});
    await page.waitForTimeout(300);
    await page.locator('[data-form="voucher"] button[type="submit"]').click();
    await page.locator('[data-voucher]').waitFor({timeout:10000});
    const createCalls=db.calls.filter(c=>c.name==='create_fin_voucher');
    assert.strictEqual(createCalls.length,2,'two attempts');assert.strictEqual(createCalls[0].body.p.request_id,createCalls[1].body.p.request_id,'retry carries the same request_id');
    assert.strictEqual(db.vouchers.length,1,'one draft despite the retry');
    const created=createCalls[0];
    assert.strictEqual(created.body.p.amount,'1000.123456','amount sent as a normalised string');assert.strictEqual(created.body.p.voucher_type,'transfer');assert.ok(created.body.p.request_id,'idempotency request_id sent');
    assert.match(await page.locator('[data-voucher] h4').innerText(),/مسودة/);
    const beforePost=db.calls.length;
    await page.locator('[data-vaction="post"]').click();
    await page.waitForFunction(n=>document.body.innerText.includes('فصل الإدخال عن الاعتماد')||window.__calls>n,beforePost,{timeout:10000}).catch(()=>{});
    await page.waitForTimeout(300);
    assert.strictEqual(db.vouchers[0].status,'draft','FM cannot post own draft (maker-checker, no override for non-admin)');
    // 7-decimal amount blocked client-side on edit
    await page.locator('[data-vaction="edit"]').click();
    await page.fill('[data-form="voucher"] [name="amount"]','1.1234567');const beforeBad=db.calls.length;
    await page.locator('[data-form="voucher"] button[type="submit"]').click();await page.waitForTimeout(300);
    assert.strictEqual(db.calls.length,beforeBad,'no RPC for 7 decimals');
    await page.fill('[data-form="voucher"] [name="amount"]','1000.123456');await page.fill('[data-form="voucher"] [name="memo"]','إيداع نقدية في البنك');
    await page.locator('[data-form="voucher"] button[type="submit"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-voucher]')?.innerText.includes('النسخة 2'),null,{timeout:10000});
    assert.strictEqual(db.calls.filter(c=>c.name==='update_fin_voucher_draft').at(-1).body.p_expected_lock_version,1);
    if(shots) await page.screenshot({path:path.join(shots,'fl-voucher-draft.png'),fullPage:true});
    // reports: trial balance + statement with opening/closing rows
    await page.locator('.fc-tab[data-tab="reports"]').click();
    await page.locator('[data-action="run-report"]').waitFor({timeout:10000});
    await page.locator('[data-action="run-report"]').click();
    await page.locator('[data-trial]').waitFor({timeout:10000});
    assert.strictEqual(await page.locator('[data-trial] tbody tr').count(),7,'postable accounts only (groups excluded)');
    assert.strictEqual(await page.locator('[data-trial] tbody tr',{hasText:'1101'}).locator('.fc-money').first().getAttribute('title'),'1000.123456');
    await page.selectOption('[data-rf="kind"]','statement');
    await page.fill('[data-picker="client_id"] [data-picker-query]','BUYER');await page.locator('[data-picker="client_id"] [data-picker-go]').click();
    await page.locator('[data-picker="client_id"] [data-pick="0"]').waitFor({timeout:10000});await page.locator('[data-picker="client_id"] [data-pick="0"]').click();
    assert.match(await page.locator('[data-picker="client_id"] [data-chosen]').innerText(),/TEST BUYER ONE/,'client chosen by name');
    await page.fill('[data-picker="financial_file_id"] [data-picker-query]','TC-2026');await page.locator('[data-picker="financial_file_id"] [data-picker-go]').click();
    await page.locator('[data-picker="financial_file_id"] [data-pick="0"]').waitFor({timeout:10000});await page.locator('[data-picker="financial_file_id"] [data-pick="0"]').click();
    assert.match(await page.locator('[data-picker="financial_file_id"] [data-chosen]').innerText(),/TC-2026-000101/,'file chosen by TC number');
    await page.fill('[data-rf="from"]','2026-09-15');await page.fill('[data-rf="to"]','2026-09-21');
    await page.locator('[data-action="run-report"]').click();
    await page.locator('[data-statement]').waitFor({timeout:10000});
    const stmtRows=await page.locator('[data-statement] tbody tr').allInnerTexts();
    assert.strictEqual(stmtRows.length,3);assert.match(stmtRows[0],/رصيد افتتاحي/);assert.match(stmtRows[2],/رصيد ختامي/);
    const stmtCall=db.calls.find(c=>c.name==='fin_client_statement');assert.deepStrictEqual(stmtCall.body,{p_client:CLIENT_ID,p_file:FILE_ID,p_from:'2026-09-15',p_to:'2026-09-21',__actor:'fm-1'});
    assert.ok(db.calls.some(c=>c.name==='list_bsgt_financial_files'&&c.body.p_search==='TC-2026'),'file picker searched by TC number');
    if(shots) await page.screenshot({path:path.join(shots,'fl-statement.png'),fullPage:true});
    // file ledger card: approve costs → delivery → settlement preview + draft → post (version bound)
    await page.locator('.fc-tab[data-tab="files"]').click();
    await page.locator('[data-list-rows] tr[data-open]').first().waitFor({timeout:10000});
    await page.locator('[data-list-rows] tr[data-open]').first().click();
    await page.locator('[data-ledger-card]').waitFor({timeout:10000});
    const stateGet=db.calls.find(c=>c.name==='GET state');assert.ok(stateGet.select.includes('approved_bank_cost_sdg::text')&&stateGet.select.includes('refund_due_sdg::text'),'ledger state money read with ::text');
    assert.match(await page.locator('[data-ledger-card]').innerText(),/أمانة العميل/);
    assert.deepStrictEqual(await page.locator('[data-ledger-card] [data-laction]').evaluateAll(l=>l.map(b=>b.dataset.laction)),['costs','delivery','receipt','payment_bank','payment_permit','refund','recovery','balance_transfer']);
    await page.locator('[data-laction="costs"]').click();
    await page.fill('[data-form="costs"] [name="bank"]','230000');await page.fill('[data-form="costs"] [name="permit"]','500000');await page.fill('[data-form="costs"] [name="note"]','حسب إشعار البنك');
    await page.locator('[data-form="costs"] button[type="submit"]').click();
    await page.waitForFunction(()=>{const t=document.querySelector('[data-ledger-card]')?.innerText||'';return t.includes('230,000.00')&&t.includes('النسخة 2');},null,{timeout:10000});
    const costs=db.calls.find(c=>c.name==='approve_fin_file_costs');assert.deepStrictEqual(costs.body,{p_file:FILE_ID,p_expected_lock_version:1,p_bank_cost:'230000',p_permit_cost:'500000',p_note:'حسب إشعار البنك',__actor:'fm-1'});
    page.__promptAnswer='سُلِّم الاعتماد للعميل';
    await page.locator('[data-laction="delivery"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-ledger-card]')?.innerText.includes('سُلِّم الاعتماد للعميل'),null,{timeout:10000})
    assert.strictEqual(db.calls.find(c=>c.name==='confirm_fin_file_delivery').body.p_expected_lock_version,2);
    await page.locator('[data-laction="settlement"]').click();
    await page.locator('[data-action="create-settlement"]').waitFor({timeout:10000});
    assert.match(await page.locator('[data-ledger-form]').innerText(),/settled_total_sdg/);
    assert.strictEqual(await page.locator('[data-ledger-form] .fc-money').nth(2).getAttribute('title'),'5000.000000000000000','bank variance shown at full scale');
    db.flags.failNextCreate=true;
    await page.locator('[data-action="create-settlement"]').click();
    await page.waitForTimeout(400);
    assert.strictEqual(db.vouchers.filter(v=>v.voucher_type==='settlement').length,0,'no settlement draft after the lost reply');
    await page.locator('[data-action="create-settlement"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-file-vouchers]')?.innerText.includes('تسوية العملية'),null,{timeout:10000});
    const stCalls=db.calls.filter(c=>c.name==='create_fin_voucher'&&c.body.p.voucher_type==='settlement');
    assert.strictEqual(stCalls.length,2);assert.strictEqual(stCalls[0].body.p.request_id,stCalls[1].body.p.request_id,'settlement retry reuses the request_id');
    assert.strictEqual(db.vouchers.filter(v=>v.voucher_type==='settlement').length,1,'one settlement draft');
    if(shots) await page.screenshot({path:path.join(shots,'fl-file-card.png'),fullPage:true});
    assert.deepStrictEqual(fmErrors(),[],'fm: no page/console errors');
    await fm.close();

    // ---------------------------------------------------------------- admin: posts the settlement (version-bound), reverses a receipt, override on own draft
    const admin=await contextFor(browser,db,{role:'admin',id:'admin-1',featureKeys:[]});
    const apage=await admin.newPage();const adminErrors=track(apage);const adminDialogs=dialogsOf(apage);apage.__promptAnswer='قيد مكرر';
    await apage.goto(`${APP}/#v=bsgtWorkspace&section=financialCenter`,{waitUntil:'domcontentloaded'});
    await apage.locator('#bsgtFinancialCenter [data-list-rows] tr[data-open]').first().waitFor({timeout:20000});
    await apage.locator('[data-list-rows] tr[data-open]').first().click();
    await apage.locator('[data-ledger-card]').waitFor({timeout:10000})
    await apage.locator('[data-file-vouchers] [data-open-voucher]').first().click();
    await apage.locator('[data-ledger-voucher] [data-voucher]').waitFor({timeout:10000});
    // components changed after review (approved cost re-entered) → post refused, draft untouched; refresh → post
    db.rpc.approve_fin_file_costs({p_file:FILE_ID,p_expected_lock_version:db.ledgerState.lock_version,p_bank_cost:'230000.5',p_permit_cost:'500000',__actor:'x'});
    const settlement=db.vouchers.find(v=>v.voucher_type==='settlement');
    await apage.locator('[data-ledger-voucher] [data-vaction="post"]').click();
    await apage.waitForTimeout(500);
    assert.strictEqual(settlement.status,'draft','post refused when components changed');assert.strictEqual(settlement.lock_version,1);
    await apage.locator('[data-ledger-voucher] [data-vaction="refresh"]').click();
    await apage.waitForFunction(()=>document.querySelector('[data-ledger-voucher] [data-voucher]')?.innerText.includes('النسخة 2'),null,{timeout:10000});
    db.rpc.approve_fin_file_costs({p_file:FILE_ID,p_expected_lock_version:db.ledgerState.lock_version,p_bank_cost:'230000',p_permit_cost:'500000',__actor:'x'});  // back to the reviewed value
    await apage.locator('[data-ledger-voucher] [data-vaction="refresh"]').click();
    await apage.waitForFunction(()=>document.querySelector('[data-ledger-voucher] [data-voucher]')?.innerText.includes('النسخة 3'),null,{timeout:10000});
    await apage.locator('[data-ledger-voucher] [data-vaction="post"]').click();
    await apage.waitForFunction(()=>document.querySelector('[data-ledger-voucher] [data-voucher]')?.innerText.includes('مرحّل'),null,{timeout:10000});
    assert.strictEqual(settlement.status,'posted');assert.strictEqual(settlement.amount,'1030000.000000000000000');
    assert.strictEqual(await apage.locator('[data-ledger-voucher] .fc-table tbody tr').count(),4,'four settlement lines shown');
    await apage.waitForFunction(()=>document.querySelector('[data-ledger-card]')?.innerText.includes('30,000.00'),null,{timeout:10000});
    // linked receipt from the card: admin creates and posts own draft with override
    await apage.locator('[data-laction="receipt"]').click();
    await apage.selectOption('[data-ledger-form] [name="cash_account_id"]','acc-1201');await apage.fill('[data-ledger-form] [name="amount"]','30000');await apage.fill('[data-ledger-form] [name="reference"]','TT-90');
    await apage.locator('[data-ledger-form] button[type="submit"]').click();
    await apage.waitForFunction(()=>document.querySelector('[data-file-vouchers]')?.innerText.includes('TT-90'),null,{timeout:10000});
    const receipt=db.vouchers.find(v=>v.reference==='TT-90');assert.strictEqual(receipt.financial_file_id,FILE_ID);assert.strictEqual(receipt.client_id,CLIENT_ID);
    await apage.locator(`[data-file-vouchers] [data-open-voucher="${receipt.id}"]`).click();
    await apage.waitForFunction(id=>document.querySelector('[data-ledger-voucher] [data-voucher]')?.dataset.voucher===id,receipt.id,{timeout:10000});
    apage.__promptAnswer='تجاوز طارئ';
    await apage.locator('[data-ledger-voucher] [data-vaction="post"]').click();
    await apage.waitForFunction(()=>document.querySelector('[data-ledger-voucher] [data-voucher]')?.innerText.includes('مرحّل'),null,{timeout:10000});
    const posts=db.calls.filter(c=>c.name==='post_fin_voucher'&&c.body.p_id===receipt.id);
    assert.strictEqual(posts.length,2);assert.strictEqual(posts[0].body.p_override_reason,null);assert.strictEqual(posts[1].body.p_override_reason,'تجاوز طارئ');
    // reverse with reason → mirror entry shown
    apage.__promptAnswer='حُوِّل بالخطأ';
    await apage.locator('[data-ledger-voucher] [data-vaction="reverse"]').click();
    await apage.waitForFunction(()=>document.querySelector('[data-ledger-voucher] [data-voucher]')?.innerText.includes('معكوس'),null,{timeout:10000});
    assert.strictEqual(db.calls.find(c=>c.name==='reverse_fin_voucher').body.p_reason,'حُوِّل بالخطأ');
    assert.match(await apage.locator('[data-ledger-voucher]').innerText(),/قيد العكس/);
    if(shots) await apage.screenshot({path:path.join(shots,'fl-voucher-reversed.png'),fullPage:true});
    assert.deepStrictEqual(adminErrors(),[],'admin: no page/console errors');
    // phone width
    const phone=await admin.newPage();await phone.setViewportSize({width:390,height:844});
    await phone.goto(`${APP}/#v=bsgtWorkspace&section=financialCenter`,{waitUntil:'domcontentloaded'});
    await phone.locator('#bsgtFinancialCenter [data-list-rows] tr[data-open]').first().waitFor({timeout:20000});
    await phone.locator('.fc-tab[data-tab="vouchers"]').click();
    await phone.locator('[data-voucher-rows] tr').first().waitFor({timeout:10000});
    assert.strictEqual(await phone.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'no horizontal overflow on phone');
    if(shots) await phone.screenshot({path:path.join(shots,'fl-phone.png'),fullPage:true});
    await admin.close();

    // ---------------------------------------------------------------- ledger read failure: explicit error + retry, never shown as "no ledger" / "not enabled"
    const acc=await contextFor(browser,db,{role:'staff',id:'acc-1',featureKeys:['bsgt.financial_center.view','bsgt.financial_center.edit']});
    const cpage=await acc.newPage();const accErrors=track(cpage);
    await cpage.goto(`${APP}/#v=bsgtWorkspace&section=financialCenter`,{waitUntil:'domcontentloaded'});
    await cpage.locator('#bsgtFinancialCenter [data-list-rows] tr[data-open]').first().waitFor({timeout:20000});
    db.flags.failState=true;
    await cpage.locator('[data-list-rows] tr[data-open]').first().click();
    await cpage.locator('[data-ledger-host] [data-action="retry-ledger"]').waitFor({timeout:10000});
    const hostText=await cpage.locator('[data-ledger-host]').innerText();
    assert.match(hostText,/تعذر تحميل الدفتر/);assert.doesNotMatch(hostText,/غير مفعّل|لم يُفتح/,'read failure is not presented as missing/disabled ledger');
    assert.strictEqual(await cpage.locator('[data-ledger-card]').count(),0);
    db.flags.failState=false;
    await cpage.locator('[data-ledger-host] [data-action="retry-ledger"]').click();
    await cpage.locator('[data-ledger-card]').waitFor({timeout:10000});
    await cpage.locator('.fc-tab[data-tab="files"]').click();
    await cpage.locator('[data-list-rows] tr[data-open]').first().waitFor({timeout:10000});
    // ---------------------------------------------------------------- activation off: file card shows the notice, no linked-voucher buttons
    db.settings.file_vouchers_enabled=false;
    await cpage.locator('.fc-tab[data-tab="vouchers"]').click();
    await cpage.locator('[data-voucher-rows] tr').first().waitFor({timeout:10000});
    assert.match(await cpage.locator('.fc-panel-head p').first().innerText(),/غير مفعّلة/);
    assert.strictEqual(await cpage.locator('[data-action="new-voucher"]').count(),1,'accountant can still draft cash/bank transfers');
    assert.deepStrictEqual(accErrors(),[]);
    await acc.close();

    // ---------------------------------------------------------------- view only: no write buttons anywhere
    db.settings.file_vouchers_enabled=true;
    const viewer=await contextFor(browser,db,{role:'viewer',id:'view-1',featureKeys:['bsgt.financial_center.view']});
    const vpage=await viewer.newPage();const viewerErrors=track(vpage);
    await vpage.goto(`${APP}/#v=bsgtWorkspace&section=financialCenter`,{waitUntil:'domcontentloaded'});
    await vpage.locator('#bsgtFinancialCenter [data-list-rows] tr[data-open]').first().waitFor({timeout:20000});
    await vpage.locator('.fc-tab[data-tab="vouchers"]').click();
    await vpage.locator('[data-voucher-rows] tr').first().waitFor({timeout:10000});
    assert.strictEqual(await vpage.locator('[data-action="new-voucher"]').count(),0);
    await vpage.locator('[data-voucher-rows] tr[data-open-voucher]').first().click();
    await vpage.locator('[data-voucher-detail] [data-voucher]').waitFor({timeout:10000});
    assert.deepStrictEqual(await vpage.locator('[data-voucher-detail] [data-vaction]').evaluateAll(l=>l.map(b=>b.dataset.vaction)),['close']);
    await vpage.locator('.fc-tab[data-tab="accounts"]').click();
    await vpage.locator('.fc-table tbody tr').first().waitFor({timeout:10000});
    assert.strictEqual(await vpage.locator('[data-action="new-account"], [data-action="init-chart"], [data-edit-account]').count(),0);
    await vpage.locator('.fc-tab[data-tab="files"]').click();
    await vpage.locator('[data-list-rows] tr[data-open]').first().waitFor({timeout:10000});
    await vpage.locator('[data-list-rows] tr[data-open]').first().click();
    await vpage.locator('[data-ledger-card]').waitFor({timeout:10000});
    assert.strictEqual(await vpage.locator('[data-ledger-card] [data-laction]').count(),0,'no ledger actions for view-only');
    assert.deepStrictEqual(viewerErrors(),[]);
    await viewer.close();
    console.log('BSGT financial center phase 2 UI: passed');
  }finally{await browser?.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exit(1);});
