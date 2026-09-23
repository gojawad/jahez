const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
// Migration 63: operations merge and send-to-finance work with any available document.
module.exports=async db=>{
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/63_bsgt_optional_operations_requirements.sql'),'utf8');
  const tables=['shipments','shipment_files','bsgt_operations_revisions','storage.objects'];
  const snapshot=async()=>{const out=[];for(const t of tables)out.push((await db.query(`select to_jsonb(t) j from ${t} t order by to_jsonb(t)::text`)).rows);return out;};
  const before=await snapshot();
  await db.exec(sql);await db.exec(sql);
  assert.deepEqual(await snapshot(),before,'63 is idempotent and rewrites no data');
  await db.exec(`
    create or replace function has_bsgt_workspace_permission(text,boolean) returns boolean language sql as $$select true$$;
    create or replace function has_feature_permission(p_permission_key text) returns boolean language sql as $$select true$$;
    set app.uid='00000000-0000-4000-8000-000000000001';
  `);
  const partial='10000000-0000-4000-8000-000000000063',empty='10000000-0000-4000-8000-000000000064';
  await db.query(`insert into shipments(id,company_id,status,data,updated_at) values($1,bsgt_company_id(),'draft',
    '{"operationNo":"BSGTX-PARTIAL","consignee":"TEST","itemDesc":"TEST","qrToken":"partial_permanent_token_1234"}',now()),
    ($2,bsgt_company_id(),'draft','{"qrToken":"empty_permanent_token_123456"}',now())`,[partial,empty]);
  await db.query(`insert into shipment_files(id,shipment_id,document_type,path,name,mime)
    values('30000000-0000-4000-8000-000000000063',$1,'certificate_of_origin','coo.pdf','coo','application/pdf')`,[partial]);
  const input=(await db.query('select bsgt_operations_package_input($1) as r',[partial])).rows[0].r;
  assert.deepEqual(input.generated,{contract:true},'only ready generated kinds are merged');
  assert.deepEqual(input.files.map(f=>f.kind),['certificate_of_origin'],'only available uploads are merged');
  await assert.rejects(db.query('select bsgt_operations_package_input($1)',[empty]),/incomplete/,'a package still needs one document');
  const revision='20000000-0000-4000-8000-000000000063',prefix=`${partial}/${revision}`;
  const docs=['contract','certificate_of_origin'].map(kind=>({kind,path:`${prefix}/${kind}.pdf`,source:'operations',
    sourceId:kind==='contract'?null:'30000000-0000-4000-8000-000000000063'}));
  await db.query(`insert into bsgt_operations_revisions(id,shipment_id,revision_no,source_fingerprint,shipment_snapshot,documents,package_path,created_by)
    values($1,$2,$3,$4,$5,$6,$7,auth.uid())`,[revision,partial,input.revisionNo,input.fingerprint,input.shipment,JSON.stringify(docs),`${prefix}/package.pdf`]);
  for(const name of [...docs.map(d=>d.path),`${prefix}/package.pdf`])await db.query("insert into storage.objects values('bsgt-operations-packages',$1)",[name]);
  await db.query('select approve_bsgt_operations_revision($1)',[revision]);
  await db.query('select complete_bsgt_operations($1)',[partial]);
  assert.equal((await db.query('select bsgt_stage from shipments where id=$1',[partial])).rows[0].bsgt_stage,'ready_for_finance','partial package can be sent to finance');
  console.log('SQL 63: idempotent/no data rewrites; partial operations package merges and sends to finance; empty package still rejected: passed');
};
