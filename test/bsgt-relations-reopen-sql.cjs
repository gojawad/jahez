const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async(db,{id,tradeFile,revision2})=>{
  const sql=fs.readFileSync(path.join(__dirname,'../supabase/59_bsgt_reopen_relations_signing.sql'),'utf8');
  const tables=['shipments','trade_collection_files','trade_collection_file_documents','bsgt_operations_revisions','storage.objects'];
  const before=[];for(const table of tables)before.push((await db.query(`select to_jsonb(t) j from ${table} t order by to_jsonb(t)::text`)).rows);
  await db.exec(sql);await db.exec(sql);
  for(let n=0;n<tables.length;n++)assert.deepEqual((await db.query(`select to_jsonb(t) j from ${tables[n]} t order by to_jsonb(t)::text`)).rows,before[n],'installation preserves '+tables[n]);
  const current=async()=>(await db.query('select * from trade_collection_files where id=$1',[tradeFile.id])).rows[0];
  const call=(f,ids=[id],note='Missing stamp')=>db.query('select reopen_bsgt_relations_for_signing($1,$2,$3,$4,$5)',[f.id,f.revision_no,f.updated_at,ids,note]);
  const rejects=async(fn,pattern)=>{await db.exec('savepoint denied');await assert.rejects(fn(),pattern);await db.exec('rollback to denied');};
  for(const mode of ['collection','cad']){
    await db.exec('begin');
    try{
      await db.query("update trade_collection_files set status='final_accepted',revision_no=2,metadata=jsonb_set(metadata,'{collectionMode}',to_jsonb($2::text)) where id=$1",[tradeFile.id,mode]);
      await db.query("update shipments set bsgt_stage='final_accepted' where id=$1",[id]);
      await db.query('select send_bsgt_trade_file_to_collecting($1,$2,$3)',[tradeFile.id,'TEST BANK','TEST ADDRESS']);
      const f=await current(), shipmentBefore=(await db.query('select * from shipments where id=$1',[id])).rows[0];
      const documents=(await db.query('select * from trade_collection_file_documents order by id')).rows;
      await rejects(()=>call(f),/administrator/);
      await db.exec('create or replace function is_admin() returns boolean language sql as $$select true$$');
      await db.exec('create or replace function is_active() returns boolean language sql as $$select false$$');
      await rejects(()=>call(f),/administrator/);
      await db.exec('create or replace function is_active() returns boolean language sql as $$select true$$');
      await rejects(()=>call(f,[id],' '),/reason/);
      await rejects(()=>call(f,[]),/shipments changed/);
      await rejects(()=>call(f,[id,id]),/shipments changed/);
      await rejects(()=>call({...f,revision_no:99}),/changed/);
      await rejects(()=>call({...f,updated_at:'2000-01-01'}),/changed/);
      await call(f);
      const after=await current();assert.equal(after.status,'final_accepted');
      for(const field of ['revision_no','final_accepted_at','final_accepted_by','management_reviewed_at','metadata','collecting_bank'])assert.deepEqual(after[field],f[field],field+' preserved');
      assert.equal(after.sent_to_collecting_at,null);assert.equal(after.sent_to_collecting_by,null);
      const shipmentAfter=(await db.query('select * from shipments where id=$1',[id])).rows[0];
      assert.deepEqual(shipmentAfter.data,shipmentBefore.data,'all source data/QR retained');
      assert.equal(shipmentAfter.operations_revision_id,revision2);assert.equal(shipmentAfter.bsgt_stage,'final_accepted');
      assert.deepEqual((await db.query('select * from trade_collection_file_documents order by id')).rows,documents,'signatures not archived or replaced');
      const history=(await db.query("select text::jsonb j from activity_log where text::jsonb->>'action'='relations_reopened_for_signing'")).rows;
      assert.equal(history.length,1);assert.equal(history[0].j.fileBefore.status,'sent_to_collecting');assert.ok(history[0].j.fileBefore.sent_to_collecting_at);
      await rejects(()=>call(f),/changed/);
      const path=`workflow/${f.id}/2/signed/reopened-${mode}.pdf`;
      await db.query('insert into storage.objects values($1,$2)',['trade-collection-documents',path]);
      await db.query('select register_bsgt_internal_signature($1,2,$2,$3,$4,$5,$6)',[f.id,id,'invoice',path,`${id}/${revision2}/invoice.pdf`,'[{"page":0,"x":0.1,"y":0.1,"width":0.1,"height":0.1}]']);
      await db.query('select send_bsgt_trade_file_to_collecting($1,$2,$3)',[f.id,'TEST BANK','TEST ADDRESS']);
      await call(await current(),[id],'Second correction');
      assert.equal((await db.query("select count(*)::int n from activity_log where text::jsonb->>'action'='relations_reopened_for_signing'")).rows[0].n,2);
      assert.equal((await db.query('select storage_path from trade_collection_file_documents where storage_path=$1 and is_active',[path])).rows[0].storage_path,path);
    }finally{await db.exec('rollback');}
  }
  await db.exec('begin');
  try{
    await db.exec('create or replace function is_admin() returns boolean language sql as $$select true$$');
    await db.query("update trade_collection_files set status='sent_to_collecting',metadata=metadata-'collectionMode' where id=$1",[tradeFile.id]);
    await db.query("update shipments set bsgt_stage='sent_to_collecting' where id=$1",[id]);
    const sid='10000000-0000-4000-8000-000000000091',rid='20000000-0000-4000-8000-000000000091';
    await db.query('insert into shipments(id,company_id,status,bsgt_stage,data) select $1,company_id,status,bsgt_stage,data from shipments where id=$2',[sid,id]);
    await db.query(`insert into bsgt_operations_revisions(id,shipment_id,revision_no,source_fingerprint,shipment_snapshot,documents,package_path,created_by,approved_at)
      select $1::uuid,$2::uuid,1,source_fingerprint,shipment_snapshot,documents,$2::uuid::text||'/'||$1::uuid::text||'/package.pdf',auth.uid(),now() from bsgt_operations_revisions where id=$3`,[rid,sid,revision2]);
    await db.query('update shipments set operations_revision_id=$1 where id=$2',[rid,sid]);
    await db.query('insert into trade_collection_file_shipments(trade_file_id,shipment_id) values($1,$2)',[tradeFile.id,sid]);
    const f=await current();
    await rejects(()=>call(f),/shipments changed/);
    await db.query("update shipments set bsgt_stage='operations_draft' where id=$1",[sid]);
    await rejects(()=>call(f,[sid,id]),/inconsistent/);
    assert.equal((await db.query('select bsgt_stage from shipments where id=$1',[id])).rows[0].bsgt_stage,'sent_to_collecting','no partial group update');
    await db.query("update shipments set bsgt_stage='sent_to_collecting' where id=$1",[sid]);
    await call(f,[sid,id]);
    assert.equal((await db.query("select count(*)::int n from shipments where id=any($1) and bsgt_stage='final_accepted'",[[sid,id]])).rows[0].n,2);
  }finally{await db.exec('rollback');}
  const sig='reopen_bsgt_relations_for_signing(uuid,integer,timestamptz,uuid[],text)';
  assert.equal((await db.query('select has_function_privilege($1,$2,$3) ok',['anon',sig,'execute'])).rows[0].ok,false);
  console.log('SQL 59: standalone/idempotent, no data rewrites, admin-only, stale/group guards, CAD/collection re-sign and re-dispatch, immutable approvals/QR/history: passed');
};
