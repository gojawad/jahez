-- Reopen a dispatched revision-based trade file for operations correction.
-- Installation changes no rows. The prior bank handover, PDFs and QR token remain in history.
begin;

create or replace function public.reopen_bsgt_dispatched_for_correction(
  p_trade_file_id uuid, p_revision_no integer, p_expected_updated_at timestamptz,
  p_shipment_ids uuid[], p_note text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare f public.trade_collection_files%rowtype; linked_ids uuid[]; prior jsonb; s public.shipments%rowtype;
begin
  if auth.uid() is null or not public.is_active() or not public.is_admin() then
    raise exception 'Active administrator required';
  end if;
  if nullif(btrim(p_note),'') is null or length(btrim(p_note))>10000 then
    raise exception 'A correction reason is required (maximum 10000 characters)';
  end if;
  select * into f from public.trade_collection_files
    where id=p_trade_file_id and company_id=public.bsgt_company_id() for update;
  if not found or f.status<>'sent_to_collecting' or f.revision_no is distinct from p_revision_no
    or f.updated_at is distinct from p_expected_updated_at then
    raise exception 'Dispatched file changed; refresh before reopening';
  end if;
  if f.sent_to_collecting_at is null or to_jsonb(f)->>'archived_at' is not null then
    raise exception 'An active dispatched file is required';
  end if;
  if coalesce((f.metadata->>'operationsRevisionWorkflow')::boolean,false) is not true then
    raise exception 'This correction path requires revision-based operations';
  end if;
  perform 1 from public.shipments shipment join public.trade_collection_file_shipments link
    on link.shipment_id=shipment.id where link.trade_file_id=f.id order by shipment.id for update of shipment;
  select array_agg(link.shipment_id order by link.shipment_id) into linked_ids
    from public.trade_collection_file_shipments link where link.trade_file_id=f.id;
  if linked_ids is null or linked_ids is distinct from
    (select array_agg(x order by x) from unnest(p_shipment_ids) x) then
    raise exception 'Linked shipments changed; refresh the file';
  end if;
  if exists(select 1 from public.trade_collection_file_shipments link
    left join public.shipments shipment on shipment.id=link.shipment_id
    left join public.bsgt_operations_revisions revision on revision.id=shipment.operations_revision_id
      and revision.shipment_id=shipment.id
    where link.trade_file_id=f.id and (shipment.company_id is distinct from public.bsgt_company_id()
      or shipment.bsgt_stage is distinct from 'sent_to_collecting'
      or to_jsonb(shipment)->>'archived_at' is not null or revision.approved_at is null
      or link.operations_revision_id is distinct from shipment.operations_revision_id)) then
    raise exception 'Dispatched shipment revisions are inconsistent; nothing was reopened';
  end if;
  select jsonb_agg(to_jsonb(shipment) order by shipment.id) into prior
    from public.shipments shipment where shipment.id=any(linked_ids);
  insert into public.activity_log(user_id,type,text) values(auth.uid(),'edit',jsonb_build_object(
    'action','dispatched_file_reopened_for_correction','fileBefore',to_jsonb(f),
    'shipmentsBefore',prior,'reason',btrim(p_note),'actor',auth.uid(),'at',now())::text);
  for s in select shipment.* from public.shipments shipment
    where shipment.id=any(linked_ids) order by shipment.id
  loop
    update public.shipments set bsgt_stage='operations_draft',bsgt_stage_updated_at=now(),
      data=jsonb_set(coalesce(data,'{}'::jsonb),'{bsgtFinanceReturn}',jsonb_build_object(
        'correction',true,'source','sent_to_collecting','note',btrim(p_note),'at',now(),
        'by',auth.uid(),'fileId',f.id,'previousRevisionId',s.operations_revision_id,
        'fileRevision',f.revision_no)) where id=s.id;
    insert into public.shipment_comments(shipment_id,author_id,kind,body)
      values(s.id,auth.uid(),'return','Dispatched file reopened for correction: '||btrim(p_note));
  end loop;
  update public.trade_collection_files set status='returned_to_operations',revision_no=revision_no+1,
    final_accepted_at=null,final_accepted_by=null,management_reviewed_at=null,
    management_reviewed_by=null,sent_to_remitting_at=null,sent_to_collecting_at=null,
    sent_to_collecting_by=null,updated_at=now() where id=f.id;
  insert into public.trade_collection_file_events(trade_file_id,event_type,from_status,to_status,note,actor_id,revision_no)
    values(f.id,'returned_to_operations','sent_to_collecting','returned_to_operations',
      'Correction after bank handover: '||btrim(p_note),auth.uid(),f.revision_no+1);
  return jsonb_build_object('reopened',true,'fileId',f.id,'revisionNo',f.revision_no+1,
    'shipmentCount',cardinality(linked_ids));
end;
$$;

revoke all on function public.reopen_bsgt_dispatched_for_correction(uuid,integer,timestamptz,uuid[],text) from public,anon;
grant execute on function public.reopen_bsgt_dispatched_for_correction(uuid,integer,timestamptz,uuid[],text) to authenticated;
notify pgrst,'reload schema';
commit;
