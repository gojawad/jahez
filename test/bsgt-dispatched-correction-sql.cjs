const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

module.exports=async(db,{id,tradeFile,revision2})=>{
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/64_bsgt_reopen_dispatched_for_correction.sql'),'utf8');
  const tables=['shipments','trade_collection_files','trade_collection_file_documents','bsgt_operations_revisions','storage.objects'];
  const baseline=[];
  for(const table of tables)baseline.push((await db.query(`select to_jsonb(t) j from ${table} t order by to_jsonb(t)::text`)).rows);
  await db.exec(sql);await db.exec(sql);
  for(let i=0;i<tables.length;i++)assert.deepEqual(
    (await db.query(`select to_jsonb(t) j from ${tables[i]} t order by to_jsonb(t)::text`)).rows,
    baseline[i],`SQL 64 installation preserves ${tables[i]}`);
  const current=async()=>(await db.query('select * from trade_collection_files where id=$1',[tradeFile.id])).rows[0];
  const call=(f,ids=[id],note='Incorrect import permit')=>db.query(
    'select reopen_bsgt_dispatched_for_correction($1,$2,$3,$4,$5)',
    [f.id,f.revision_no,f.updated_at,ids,note]);
  const rejects=async(fn,pattern)=>{
    await db.exec('savepoint correction_denied');
    await assert.rejects(fn(),pattern);
    await db.exec('rollback to correction_denied');
  };
  await db.exec('begin');
  try{
    await db.query(`update trade_collection_files set status='sent_to_collecting',revision_no=4,
      sent_to_collecting_at=now(),final_accepted_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||'{"operationsRevisionWorkflow":true}'::jsonb,
      updated_at=now() where id=$1`,[tradeFile.id]);
    await db.query("update shipments set bsgt_stage='sent_to_collecting' where id=$1",[id]);
    const f=await current(),before=(await db.query('select * from shipments where id=$1',[id])).rows[0];
    const documents=(await db.query('select * from trade_collection_file_documents order by id')).rows;
    const packages=(await db.query('select * from bsgt_operations_revisions order by id')).rows;
    await db.exec('create or replace function is_admin() returns boolean language sql as $$select false$$');
    await rejects(()=>call(f),/administrator/);
    await db.exec('create or replace function is_admin() returns boolean language sql as $$select true$$');
    await db.exec('create or replace function is_active() returns boolean language sql as $$select false$$');
    await rejects(()=>call(f),/administrator/);
    await db.exec('create or replace function is_active() returns boolean language sql as $$select true$$');
    await rejects(()=>call(f,[id],' '),/reason/);
    await rejects(()=>call({...f,revision_no:3}),/changed/);
    await rejects(()=>call({...f,updated_at:'2000-01-01'}),/changed/);
    await rejects(()=>call(f,[]),/shipments changed/);
    await rejects(()=>call(f,[id,id]),/shipments changed/);
    await db.query("update shipments set bsgt_stage='operations_draft' where id=$1",[id]);
    await rejects(()=>call(f),/inconsistent/);
    await db.query("update shipments set bsgt_stage='sent_to_collecting' where id=$1",[id]);
    await call(f);
    const after=await current(),shipment=(await db.query('select * from shipments where id=$1',[id])).rows[0];
    assert.equal(after.status,'returned_to_operations');assert.equal(after.revision_no,5);
    assert.equal(after.sent_to_collecting_at,null);
    assert.equal(shipment.bsgt_stage,'operations_draft');
    assert.equal(shipment.operations_revision_id,revision2);
    assert.equal(shipment.data.bsgtFinanceReturn.previousRevisionId,revision2);
    assert.equal(shipment.data.bsgtFinanceReturn.source,'sent_to_collecting');
    assert.equal(shipment.data.qrToken,before.data.qrToken);
    assert.equal(shipment.data.qrPackagePath,before.data.qrPackagePath);
    assert.deepEqual((await db.query('select * from trade_collection_file_documents order by id')).rows,documents);
    assert.deepEqual((await db.query('select * from bsgt_operations_revisions order by id')).rows,packages);
    const log=(await db.query("select text::jsonb j from activity_log where text::jsonb->>'action'='dispatched_file_reopened_for_correction'")).rows;
    assert.equal(log.length,1);
    assert.equal(Date.parse(log[0].j.fileBefore.sent_to_collecting_at),f.sent_to_collecting_at.getTime());
    assert.equal((await db.query("select count(*)::int n from trade_collection_file_events where trade_file_id=$1 and from_status='sent_to_collecting' and to_status='returned_to_operations'",[f.id])).rows[0].n,1);
    await rejects(()=>call(f),/changed/);
    assert.equal((await db.query("select has_function_privilege('anon','reopen_bsgt_dispatched_for_correction(uuid,integer,timestamptz,uuid[],text)','execute') ok")).rows[0].ok,false);
  }finally{await db.exec('rollback');}
  console.log('SQL 64: admin-only bank-sent correction, CAS, group guards, preserved PDFs/QR/audit: passed');
};
