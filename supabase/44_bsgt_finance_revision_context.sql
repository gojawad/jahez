-- Finance selections are private server-side contexts, not URL shipment lists.
begin;
alter table public.trade_collection_file_shipments
  add column if not exists operations_revision_id uuid references public.bsgt_operations_revisions(id);

create table if not exists public.bsgt_finance_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id),
  sources jsonb not null check (jsonb_typeof(sources) = 'array'),
  trade_file_id uuid references public.trade_collection_files(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
alter table public.bsgt_finance_contexts enable row level security;
revoke all on public.bsgt_finance_contexts from anon, authenticated;

create or replace function public.create_bsgt_finance_context(p_shipment_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare sources jsonb; context_id uuid;
begin
  if not public.has_bsgt_workspace_permission('finance', false) then raise exception 'Finance view permission required'; end if;
  if coalesce(cardinality(p_shipment_ids),0) not between 1 and 200
    or cardinality(p_shipment_ids) <> (select count(distinct value) from unnest(p_shipment_ids) value) then
    raise exception 'Select valid distinct shipments';
  end if;
  perform 1 from public.shipments where id = any(p_shipment_ids) order by id for share;
  select jsonb_agg(jsonb_build_object('shipmentId',s.id,'revisionId',r.id) order by s.id)
    into sources from public.shipments s join public.bsgt_operations_revisions r on r.id = s.operations_revision_id
    where s.id = any(p_shipment_ids) and s.company_id = public.bsgt_company_id()
      and s.bsgt_stage = 'ready_for_finance' and r.approved_at is not null;
  if coalesce(jsonb_array_length(sources),0) <> cardinality(p_shipment_ids) then
    raise exception 'Only approved operations packages ready for finance may be selected';
  end if;
  insert into public.bsgt_finance_contexts(sources) values(sources) returning id into context_id;
  return context_id;
end;
$$;

create or replace function public.get_bsgt_finance_context(p_context_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare context public.bsgt_finance_contexts%rowtype; result jsonb; read_only boolean;
begin
  if not public.has_bsgt_workspace_permission('finance', false) then raise exception 'Finance view permission required'; end if;
  select * into context from public.bsgt_finance_contexts
    where id = p_context_id and user_id = auth.uid() and expires_at > now();
  if not found then raise exception 'Select shipments from Finance Workspace first'; end if;
  if context.trade_file_id is not null and (
    (select array_agg((source->>'shipmentId')::uuid order by (source->>'shipmentId')::uuid) from jsonb_array_elements(context.sources) source)
    is distinct from (select array_agg(l.shipment_id order by l.shipment_id) from public.trade_collection_file_shipments l where l.trade_file_id=context.trade_file_id)
  ) then raise exception 'Finance selection changed; reopen the trade file scope'; end if;
  if exists (
    select 1 from jsonb_array_elements(context.sources) source
    left join public.shipments s on s.id = (source->>'shipmentId')::uuid
    where s.id is null or s.operations_revision_id is distinct from (source->>'revisionId')::uuid
      or s.bsgt_stage = 'operations_draft'
  ) then raise exception 'Finance context is stale; review the latest operations revision'; end if;
  select exists(select 1 from jsonb_array_elements(context.sources) source join public.shipments s
    on s.id=(source->>'shipmentId')::uuid where s.bsgt_stage<>'ready_for_finance') into read_only;
  if read_only and (context.trade_file_id is null or exists(
    select 1 from jsonb_array_elements(context.sources) source where not exists(
      select 1 from public.trade_collection_file_shipments l where l.trade_file_id=context.trade_file_id
        and l.shipment_id=(source->>'shipmentId')::uuid and l.operations_revision_id=(source->>'revisionId')::uuid
    )
  )) then raise exception 'Finance context is stale; open the submitted trade file'; end if;
  select jsonb_agg(jsonb_build_object('shipment',r.shipment_snapshot||jsonb_build_object('bsgt_stage',s.bsgt_stage),'revision',to_jsonb(r)) order by s.id)
    into result from jsonb_array_elements(context.sources) source
    join public.shipments s on s.id = (source->>'shipmentId')::uuid
    join public.bsgt_operations_revisions r on r.id = (source->>'revisionId')::uuid;
  return jsonb_build_object('id',context.id,'tradeFileId',context.trade_file_id,'readOnly',read_only,'shipments',result);
end;
$$;

create or replace function public.bind_bsgt_trade_source_revision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select s.operations_revision_id into new.operations_revision_id
    from public.shipments s where s.id = new.shipment_id;
  return new;
end;
$$;
drop trigger if exists trade_file_capture_operations_revision on public.trade_collection_file_shipments;
create trigger trade_file_capture_operations_revision before insert
  on public.trade_collection_file_shipments for each row execute function public.bind_bsgt_trade_source_revision();

create or replace function public.open_bsgt_finance_context_trade_file(p_context_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare context public.bsgt_finance_contexts%rowtype; ids uuid[]; file_ids uuid[]; result jsonb;
begin
  if not public.has_bsgt_workspace_permission('finance', true) then raise exception 'Finance edit permission required'; end if;
  select * into context from public.bsgt_finance_contexts where id = p_context_id and user_id = auth.uid() for update;
  if not found then raise exception 'Finance context unavailable'; end if;
  if (public.get_bsgt_finance_context(p_context_id)->>'readOnly')::boolean then raise exception 'Submitted context is read only'; end if;
  select array_agg((source->>'shipmentId')::uuid) into ids from jsonb_array_elements(context.sources) source;
  select array_agg(distinct link.trade_file_id) into file_ids
    from public.trade_collection_file_shipments link where link.shipment_id = any(ids);
  if coalesce(cardinality(file_ids),0) = 0 then
    result := public.create_bsgt_trade_collection_file(ids);
  else
    if cardinality(file_ids) <> 1 or exists(
      select 1 from public.trade_collection_file_shipments link
      where link.trade_file_id = file_ids[1] and not (link.shipment_id = any(ids))
    ) or (select count(*) from public.trade_collection_file_shipments where trade_file_id = file_ids[1]) <> cardinality(ids) then
      raise exception 'Selection must match the existing trade file; no cross-file merging is allowed';
    end if;
    select to_jsonb(f) into result from public.trade_collection_files f
      where f.id = file_ids[1] and f.status in ('draft','returned_to_operations','returned_to_finance') for update;
    if result is null then raise exception 'Trade file is not editable'; end if;
  end if;
  update public.bsgt_finance_contexts set trade_file_id = (result->>'id')::uuid where id = context.id;
  return result;
end;
$$;

create or replace function public.return_bsgt_shipment_from_finance(
  p_shipment_id uuid, p_revision_id uuid, p_note text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.shipments%rowtype; r public.bsgt_operations_revisions%rowtype; file_id uuid;
begin
  if not public.has_bsgt_workspace_permission('finance',true) then raise exception 'Finance edit permission required'; end if;
  if nullif(trim(p_note),'') is null or length(p_note)>10000 then raise exception 'A return note is required (maximum 10000 characters)'; end if;
  select link.trade_file_id into file_id from public.trade_collection_file_shipments link where link.shipment_id = p_shipment_id;
  if file_id is not null then
    perform 1 from public.trade_collection_files where id = file_id
      and status in ('draft','returned_to_operations','returned_to_finance') for update;
    if not found then raise exception 'Trade file already submitted'; end if;
  end if;
  select * into s from public.shipments where id = p_shipment_id and company_id = public.bsgt_company_id() for update;
  if not found or s.bsgt_stage <> 'ready_for_finance' or s.operations_revision_id is distinct from p_revision_id then
    raise exception 'Shipment revision is stale or not in finance';
  end if;
  if file_id is distinct from (select link.trade_file_id from public.trade_collection_file_shipments link where link.shipment_id=s.id) then
    raise exception 'Trade file changed during return; retry from finance';
  end if;
  select * into r from public.bsgt_operations_revisions where id = p_revision_id and approved_at is not null;
  if not found then raise exception 'Approved operations revision required'; end if;
  update public.shipments set bsgt_stage = 'operations_draft', bsgt_stage_updated_at = now(),
    data=jsonb_set(data,'{bsgtFinanceReturn}',jsonb_build_object('note',trim(p_note),'at',now(),'by',auth.uid(),'revision',r.revision_no))
    where id = s.id returning * into s;
  if file_id is not null then
    update public.trade_collection_files set status = 'returned_to_operations', updated_at = now() where id = file_id;
    insert into public.trade_collection_file_events(trade_file_id,event_type,note,actor_id,revision_no)
      select id,'returned_to_operations',trim(p_note),auth.uid(),revision_no from public.trade_collection_files where id = file_id;
  end if;
  insert into public.shipment_comments(shipment_id,author_id,kind,body)
    values(s.id,auth.uid(),'return','Finance / Operations Revision ' || r.revision_no || ': ' || trim(p_note));
  insert into public.activity_log(user_id,type,text) values(auth.uid(),'edit',
    jsonb_build_object('action','finance_return','shipment',s.id,'revision',r.revision_no,
      'revisionId',r.id,'actor',auth.uid(),'role',public.my_role(),'at',now(),'note',trim(p_note))::text);
  return to_jsonb(s);
end;
$$;

-- All submission paths, including old RPC/direct writes, encounter this check.
create or replace function public.guard_bsgt_finance_source_revisions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent_to_remitting' and old.status is distinct from new.status then
    if exists(select 1 from public.trade_collection_file_shipments where trade_file_id=new.id and operations_revision_id is not null)
      and exists(select 1 from public.trade_collection_file_shipments where trade_file_id=new.id and operations_revision_id is null) then
      raise exception 'Do not mix legacy shipments with revision-based operations packages';
    end if;
    if exists (
      select 1 from public.trade_collection_file_shipments link
      join public.shipments s on s.id = link.shipment_id
      where link.trade_file_id = new.id and (link.operations_revision_id is not null or s.operations_revision_id is not null)
        and (link.operations_revision_id is distinct from s.operations_revision_id or s.bsgt_stage = 'operations_draft')
    ) then raise exception 'Finance draft refers to a stale operations revision; regenerate before submitting'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trade_file_guard_source_revisions on public.trade_collection_files;
create trigger trade_file_guard_source_revisions before update of status on public.trade_collection_files
  for each row execute function public.guard_bsgt_finance_source_revisions();

revoke all on function public.create_bsgt_finance_context(uuid[]) from public,anon;
revoke all on function public.get_bsgt_finance_context(uuid) from public,anon;
revoke all on function public.open_bsgt_finance_context_trade_file(uuid) from public,anon;
revoke all on function public.return_bsgt_shipment_from_finance(uuid,uuid,text) from public,anon;
grant execute on function public.create_bsgt_finance_context(uuid[]) to authenticated;
grant execute on function public.get_bsgt_finance_context(uuid) to authenticated;
grant execute on function public.open_bsgt_finance_context_trade_file(uuid) to authenticated;
grant execute on function public.return_bsgt_shipment_from_finance(uuid,uuid,text) to authenticated;
revoke all on function public.bind_bsgt_trade_source_revision() from public,anon,authenticated;
revoke all on function public.guard_bsgt_finance_source_revisions() from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
