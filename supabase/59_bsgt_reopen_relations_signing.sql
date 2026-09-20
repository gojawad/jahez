-- Urgent, standalone after 57. Does NOT depend on 58 or Letters migrations.
-- Installation changes no records. Existing approvals/PDFs/QR tokens stay intact.
begin;

create or replace function public.reopen_bsgt_relations_for_signing(
  p_trade_file_id uuid,p_revision_no integer,p_expected_updated_at timestamptz,
  p_shipment_ids uuid[],p_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare f public.trade_collection_files%rowtype; linked_ids uuid[]; prior jsonb;
begin
  if auth.uid() is null or not public.is_active() or not public.is_admin() then
    raise exception 'Active administrator required';
  end if;
  if nullif(trim(p_note),'') is null or length(p_note)>10000 then
    raise exception 'A reason is required (maximum 10000 characters)';
  end if;
  select * into f from public.trade_collection_files
    where id=p_trade_file_id and company_id=public.bsgt_company_id() for update;
  if not found or f.status<>'sent_to_collecting' or f.revision_no is distinct from p_revision_no
    or f.updated_at is distinct from p_expected_updated_at then
    raise exception 'Dispatched file changed; refresh before reopening';
  end if;
  if f.final_accepted_at is null or f.final_accepted_by is null or to_jsonb(f)->>'archived_at' is not null then
    raise exception 'An active file with valid management approval is required';
  end if;
  -- Same file-then-shipments lock order as signing and dispatch RPCs.
  perform 1 from public.shipments s join public.trade_collection_file_shipments l on l.shipment_id=s.id
    where l.trade_file_id=f.id order by s.id for update of s;
  select array_agg(l.shipment_id order by l.shipment_id) into linked_ids
    from public.trade_collection_file_shipments l where l.trade_file_id=f.id;
  if linked_ids is null or linked_ids is distinct from
    (select array_agg(x order by x) from unnest(p_shipment_ids) x) then
    raise exception 'Linked shipments changed; refresh the file';
  end if;
  if exists(select 1 from public.trade_collection_file_shipments l
    left join public.shipments s on s.id=l.shipment_id
    left join public.bsgt_operations_revisions r on r.id=s.operations_revision_id and r.shipment_id=s.id
    where l.trade_file_id=f.id and (s.company_id is distinct from public.bsgt_company_id()
      or s.bsgt_stage is distinct from 'sent_to_collecting' or to_jsonb(s)->>'archived_at' is not null
      or r.approved_at is null or l.operations_revision_id is distinct from s.operations_revision_id)) then
    raise exception 'Approved shipment revisions are inconsistent; nothing was reopened';
  end if;
  select jsonb_agg(to_jsonb(s) order by s.id) into prior from public.shipments s where s.id=any(linked_ids);
  insert into public.activity_log(user_id,type,text) values(auth.uid(),'edit',jsonb_build_object(
    'action','relations_reopened_for_signing','fileBefore',to_jsonb(f),'shipmentsBefore',prior,
    'reason',trim(p_note),'actor',auth.uid(),'at',now())::text);
  update public.shipments set bsgt_stage='final_accepted',bsgt_stage_updated_at=now() where id=any(linked_ids);
  update public.trade_collection_files set status='final_accepted',sent_to_collecting_at=null,
    sent_to_collecting_by=null,updated_at=now() where id=f.id;
  insert into public.trade_collection_file_events(trade_file_id,event_type,from_status,to_status,note,actor_id,revision_no)
    values(f.id,'management_note','sent_to_collecting','final_accepted',
      'Reopened for relations signatures: '||trim(p_note),auth.uid(),f.revision_no);
  return jsonb_build_object('reopened',true,'fileId',f.id,'revisionNo',f.revision_no,'shipmentCount',cardinality(linked_ids));
end;
$$;

revoke all on function public.reopen_bsgt_relations_for_signing(uuid,integer,timestamptz,uuid[],text) from public,anon;
grant execute on function public.reopen_bsgt_relations_for_signing(uuid,integer,timestamptz,uuid[],text) to authenticated;
notify pgrst,'reload schema';
commit;
