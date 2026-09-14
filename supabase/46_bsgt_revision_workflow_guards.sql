-- Enable the operations merge gate only after migrations 43-45 are installed.
begin;
-- The existing management return RPC sends an already-completed shipment back
-- to finance. Do not run the initial operations completion guard on that path.
do $$
declare definition text; needle text; replacement text;
begin
  definition:=pg_get_functiondef('public.guard_bsgt_operations_transition()'::regprocedure);
  needle:='  if new.bsgt_stage = ''ready_for_finance'' then';
  replacement:='  if old.bsgt_stage = ''management_review'' and new.bsgt_stage = ''ready_for_finance''
    and public.has_bsgt_workspace_permission(''management'', true)
    and exists(select 1 from public.trade_collection_file_shipments l join public.trade_collection_files f on f.id=l.trade_file_id
      where l.shipment_id=old.id and f.status=''under_management_review'') then
    return new;
  end if;
'||needle;
  if position(replacement in definition)=0 then
    if position(needle in definition)=0 then raise exception 'Unexpected operations transition guard'; end if;
    execute replace(definition,needle,replacement);
  end if;
end;
$$;
create or replace function public.guard_bsgt_revision_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is distinct from public.bsgt_company_id() then return new; end if;
  if old.bsgt_stage='operations_draft' and new.bsgt_stage='ready_for_finance' then
    if new.operations_revision_id is null or new.operations_revision_id is not distinct from old.operations_revision_id
      or not exists(select 1 from public.bsgt_operations_revisions where id=new.operations_revision_id
        and shipment_id=new.id and approved_at=now() and created_by=auth.uid()) then
      raise exception 'Merge and approve an operations package before sending to finance';
    end if;
  end if;
  if old.operations_revision_id is not null and old.bsgt_stage<>'operations_draft'
    and (new.data - array['bsgtFinanceReturn','collectionStatus','collectionSentAt','collectionBatchId','collectionOperationNo',
      'collectionRemittingBank','collectionAmount','collectionDocumentSettings','collectionDocumentKinds','collectionConvertToAed',
      'collectionExchangeRate','commercialCollectionOperations']) is distinct from
    (old.data - array['bsgtFinanceReturn','collectionStatus','collectionSentAt','collectionBatchId','collectionOperationNo',
      'collectionRemittingBank','collectionAmount','collectionDocumentSettings','collectionDocumentKinds','collectionConvertToAed',
      'collectionExchangeRate','commercialCollectionOperations']) then
    raise exception 'Operations data is read only after package approval; return to operations first';
  end if;
  return new;
end;
$$;
drop trigger if exists shipments_revision_workflow_guard on public.shipments;
create trigger shipments_revision_workflow_guard before update on public.shipments
  for each row execute function public.guard_bsgt_revision_workflow();
revoke all on function public.guard_bsgt_revision_workflow() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
