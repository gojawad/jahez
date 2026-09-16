-- Administrator-only correction of accepted, not-yet-dispatched trade files.
-- Old packages, source files and finance documents remain immutable history.
begin;

create or replace function public.bsgt_correction_context(p_shipment_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.trade_collection_files%rowtype; items jsonb;
begin
  if auth.uid() is null or not public.is_active() or not public.is_admin() then
    raise exception 'Active administrator required';
  end if;
  select file.* into f from public.trade_collection_files file
    join public.trade_collection_file_shipments link on link.trade_file_id=file.id
    where link.shipment_id=p_shipment_id and file.company_id=public.bsgt_company_id();
  if not found or f.status<>'final_accepted' or f.sent_to_collecting_at is not null then
    raise exception 'Only accepted files not sent to the collecting bank can be reopened';
  end if;
  if exists(select 1 from public.trade_collection_file_shipments link
    left join public.shipments s on s.id=link.shipment_id
    left join public.bsgt_operations_revisions r on r.id=s.operations_revision_id and r.shipment_id=s.id
    where link.trade_file_id=f.id and (s.company_id is distinct from public.bsgt_company_id()
      or s.bsgt_stage is distinct from 'final_accepted' or r.approved_at is null
      or link.operations_revision_id is distinct from s.operations_revision_id)) then
    raise exception 'Accepted shipment revisions are inconsistent; correction was not opened';
  end if;
  select jsonb_agg(jsonb_build_object('id',s.id,'operationNo',s.data->>'operationNo',
    'revisionId',s.operations_revision_id) order by s.id) into items
    from public.trade_collection_file_shipments link join public.shipments s on s.id=link.shipment_id
    where link.trade_file_id=f.id;
  return jsonb_build_object('fileId',f.id,'operationNo',f.operation_no,'revisionNo',f.revision_no,'shipments',items);
end;
$$;

create or replace function public.reopen_bsgt_accepted_for_correction(
  p_shipment_id uuid, p_file_id uuid, p_revision_no integer, p_note text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.trade_collection_files%rowtype; s public.shipments%rowtype; context jsonb; prior jsonb;
begin
  if auth.uid() is null or not public.is_active() or not public.is_admin() then
    raise exception 'Active administrator required';
  end if;
  if nullif(trim(p_note),'') is null or length(p_note)>10000 then
    raise exception 'A correction reason is required (maximum 10000 characters)';
  end if;
  -- Use the same lock order as finance and management transitions.
  select * into f from public.trade_collection_files
    where id=p_file_id and company_id=public.bsgt_company_id() for update;
  if not found or f.revision_no is distinct from p_revision_no then
    raise exception 'Trade file changed; reopen the correction confirmation';
  end if;
  perform 1 from public.shipments shipment join public.trade_collection_file_shipments link
    on link.shipment_id=shipment.id where link.trade_file_id=f.id order by shipment.id for update of shipment;
  context := public.bsgt_correction_context(p_shipment_id);
  if (context->>'fileId')::uuid is distinct from f.id then raise exception 'Shipment is outside this trade file'; end if;
  select jsonb_agg(to_jsonb(shipment) order by shipment.id) into prior
    from public.shipments shipment join public.trade_collection_file_shipments link on link.shipment_id=shipment.id
    where link.trade_file_id=f.id;
  insert into public.activity_log(user_id,type,text) values(auth.uid(),'edit',jsonb_build_object(
    'action','accepted_file_reopened_for_correction','fileBefore',to_jsonb(f),'shipmentsBefore',prior,
    'actor',auth.uid(),'at',now(),'reason',trim(p_note),'requestedShipment',p_shipment_id)::text);
  for s in select shipment.* from public.shipments shipment join public.trade_collection_file_shipments link
    on link.shipment_id=shipment.id where link.trade_file_id=f.id order by shipment.id
  loop
    update public.shipments set bsgt_stage='operations_draft',bsgt_stage_updated_at=now(),
      data=jsonb_set(coalesce(data,'{}'),'{bsgtFinanceReturn}',jsonb_build_object(
        'correction',true,'note',trim(p_note),'at',now(),'by',auth.uid(),'fileId',f.id,
        'previousRevisionId',s.operations_revision_id,'fileRevision',f.revision_no)) where id=s.id;
    insert into public.shipment_comments(shipment_id,author_id,kind,body)
      values(s.id,auth.uid(),'return','Reopened accepted file for correction: '||trim(p_note));
  end loop;
  update public.trade_collection_files set status='returned_to_operations',revision_no=revision_no+1,
    final_accepted_at=null,final_accepted_by=null,management_reviewed_at=null,management_reviewed_by=null,
    sent_to_remitting_at=null,updated_at=now() where id=f.id;
  insert into public.trade_collection_file_events(trade_file_id,event_type,from_status,to_status,note,actor_id,revision_no)
    values(f.id,'returned_to_operations','final_accepted','returned_to_operations',trim(p_note),auth.uid(),f.revision_no+1);
  return context || jsonb_build_object('reopened',true);
end;
$$;

revoke all on function public.bsgt_correction_context(uuid) from public,anon;
revoke all on function public.reopen_bsgt_accepted_for_correction(uuid,uuid,integer,text) from public,anon;
grant execute on function public.bsgt_correction_context(uuid) to authenticated;
grant execute on function public.reopen_bsgt_accepted_for_correction(uuid,uuid,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
