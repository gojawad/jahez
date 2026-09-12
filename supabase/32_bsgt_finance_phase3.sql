-- BSGT Workspace - Phase 3: finance trade files only.
-- Additive migration. Legacy commercial collection fields remain untouched.

do $$
begin
  if exists (
    select 1 from public.trade_collection_file_shipments
    group by shipment_id having count(*) > 1
  ) then
    raise exception 'Cannot enable one-trade-file-per-shipment: duplicate shipment links exist';
  end if;
end;
$$;

create unique index if not exists trade_collection_file_shipments_shipment_key
  on public.trade_collection_file_shipments(shipment_id);

create or replace function public.bsgt_trade_currency(p_data jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(coalesce(
    nullif(trim(p_data->>'currency'), ''),
    nullif((regexp_match(coalesce(p_data->>'totalAmount', ''), '([A-Za-z]{3})'))[1], ''),
    ''
  ));
$$;

create or replace function public.create_bsgt_trade_collection_file(p_shipment_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file public.trade_collection_files%rowtype;
  v_requested integer;
  v_valid integer;
begin
  if not public.has_bsgt_workspace_permission('finance', true) then
    raise exception 'BSGT finance edit permission is required';
  end if;
  v_requested := coalesce(cardinality(p_shipment_ids), 0);
  if v_requested < 1 or exists(select 1 from unnest(p_shipment_ids) as selected(id) where selected.id is null) then
    raise exception 'Select at least one valid shipment';
  end if;
  if (select count(distinct selected.id) from unnest(p_shipment_ids) as selected(id)) <> v_requested then
    raise exception 'Duplicate shipment ids are not allowed';
  end if;

  perform 1 from public.shipments shipment
  where shipment.id = any(p_shipment_ids)
  order by shipment.id
  for update;

  select count(*) into v_valid
  from public.shipments shipment
  where shipment.id = any(p_shipment_ids)
    and shipment.company_id = public.bsgt_company_id()
    and shipment.bsgt_stage = 'ready_for_finance';
  if v_valid <> v_requested then
    raise exception 'All shipments must be BSGT shipments ready for finance';
  end if;
  if exists (
    select 1 from public.trade_collection_file_shipments link
    where link.shipment_id = any(p_shipment_ids)
  ) then
    raise exception 'One or more shipments already belong to a trade file';
  end if;

  insert into public.trade_collection_files(company_id, status, created_by)
  values(public.bsgt_company_id(), 'draft', auth.uid())
  returning * into v_file;

  insert into public.trade_collection_file_shipments(trade_file_id, shipment_id)
  select v_file.id, selected.id from unnest(p_shipment_ids) as selected(id);
  return to_jsonb(v_file);
end;
$$;

create or replace function public.add_bsgt_shipments_to_trade_file(
  p_trade_file_id uuid,
  p_shipment_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file public.trade_collection_files%rowtype;
  v_requested integer;
  v_valid integer;
begin
  if not public.has_bsgt_workspace_permission('finance', true) then
    raise exception 'BSGT finance edit permission is required';
  end if;
  select * into v_file from public.trade_collection_files
  where id = p_trade_file_id and company_id = public.bsgt_company_id()
  for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status <> 'draft' then raise exception 'Only draft trade files can be changed'; end if;
  v_requested := coalesce(cardinality(p_shipment_ids), 0);
  if v_requested < 1 or (select count(distinct selected.id) from unnest(p_shipment_ids) as selected(id)) <> v_requested then
    raise exception 'Select one or more unique shipments';
  end if;
  perform 1 from public.shipments shipment where shipment.id = any(p_shipment_ids) order by shipment.id for update;
  select count(*) into v_valid from public.shipments shipment
  where shipment.id = any(p_shipment_ids)
    and shipment.company_id = public.bsgt_company_id()
    and shipment.bsgt_stage = 'ready_for_finance';
  if v_valid <> v_requested then raise exception 'All shipments must be BSGT shipments ready for finance'; end if;
  if exists(select 1 from public.trade_collection_file_shipments link where link.shipment_id = any(p_shipment_ids)) then
    raise exception 'One or more shipments already belong to a trade file';
  end if;
  insert into public.trade_collection_file_shipments(trade_file_id, shipment_id)
  select p_trade_file_id, selected.id from unnest(p_shipment_ids) as selected(id);
  return jsonb_build_object('tradeFileId', p_trade_file_id, 'added', v_requested);
end;
$$;

create or replace function public.remove_bsgt_shipment_from_trade_file(
  p_trade_file_id uuid,
  p_shipment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file public.trade_collection_files%rowtype;
  v_stage text;
begin
  if not public.has_bsgt_workspace_permission('finance', true) then
    raise exception 'BSGT finance edit permission is required';
  end if;
  select * into v_file from public.trade_collection_files
  where id = p_trade_file_id and company_id = public.bsgt_company_id()
  for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status <> 'draft' then raise exception 'Only draft trade files can be changed'; end if;
  select bsgt_stage into v_stage from public.shipments where id = p_shipment_id for update;
  if v_stage <> 'ready_for_finance' then raise exception 'Shipment is not ready for finance'; end if;
  delete from public.trade_collection_file_shipments
  where trade_file_id = p_trade_file_id and shipment_id = p_shipment_id;
  if not found then raise exception 'Shipment is not linked to this trade file'; end if;
  return jsonb_build_object('tradeFileId', p_trade_file_id, 'removedShipmentId', p_shipment_id);
end;
$$;

create or replace function public.send_bsgt_trade_file_to_remitting(
  p_trade_file_id uuid,
  p_remitting_bank text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file public.trade_collection_files%rowtype;
  v_linked integer;
  v_ready integer;
  v_currency_count integer;
  v_currency text;
  v_sent_at timestamptz := now();
begin
  if not public.has_bsgt_workspace_permission('finance', true) then
    raise exception 'BSGT finance edit permission is required';
  end if;
  select * into v_file from public.trade_collection_files
  where id = p_trade_file_id and company_id = public.bsgt_company_id()
  for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status <> 'draft' then raise exception 'Trade file was already sent'; end if;
  if nullif(trim(p_remitting_bank), '') is null then raise exception 'Remitting bank is required'; end if;

  perform 1 from public.shipments shipment
  join public.trade_collection_file_shipments link on link.shipment_id = shipment.id
  where link.trade_file_id = p_trade_file_id
  order by shipment.id
  for update of shipment;

  select count(*), count(*) filter(where shipment.company_id = public.bsgt_company_id() and shipment.bsgt_stage = 'ready_for_finance')
  into v_linked, v_ready
  from public.trade_collection_file_shipments link
  join public.shipments shipment on shipment.id = link.shipment_id
  where link.trade_file_id = p_trade_file_id;
  if v_linked < 1 then raise exception 'Trade file has no linked shipments'; end if;
  if v_ready <> v_linked then raise exception 'All linked shipments must be ready for finance'; end if;

  select count(distinct public.bsgt_trade_currency(shipment.data)), min(public.bsgt_trade_currency(shipment.data))
  into v_currency_count, v_currency
  from public.trade_collection_file_shipments link
  join public.shipments shipment on shipment.id = link.shipment_id
  where link.trade_file_id = p_trade_file_id;
  if v_currency_count <> 1 or coalesce(v_currency, '') = '' then
    raise exception 'All linked shipments must use one valid currency';
  end if;

  update public.shipments shipment
  set bsgt_stage = 'sent_to_remitting', bsgt_stage_updated_at = v_sent_at
  from public.trade_collection_file_shipments link
  where link.trade_file_id = p_trade_file_id and link.shipment_id = shipment.id;

  update public.trade_collection_files
  set status = 'sent_to_remitting',
      remitting_bank = trim(p_remitting_bank),
      sent_to_remitting_at = v_sent_at,
      metadata = coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('currency', v_currency),
      updated_at = v_sent_at
  where id = p_trade_file_id
  returning * into v_file;
  return to_jsonb(v_file) || jsonb_build_object('linkedShipmentCount', v_linked);
end;
$$;

drop policy if exists shipments_select on public.shipments;
create policy shipments_select on public.shipments
  for select to authenticated
  using (
    public.is_active() and (
      owner_id = auth.uid()
      or public.is_admin()
      or (public.is_bsgt_user() and company_id = public.bsgt_company_id())
      or (company_id = public.bsgt_company_id() and public.has_bsgt_workspace_permission('operations', false))
      or (company_id = public.bsgt_company_id() and public.has_bsgt_workspace_permission('finance', false))
    )
  );

revoke insert, update, delete on public.trade_collection_files from authenticated;
revoke insert, delete on public.trade_collection_file_shipments from authenticated;
revoke all on function public.bsgt_trade_currency(jsonb) from public, anon, authenticated;
revoke all on function public.create_bsgt_trade_collection_file(uuid[]) from public, anon;
revoke all on function public.add_bsgt_shipments_to_trade_file(uuid, uuid[]) from public, anon;
revoke all on function public.remove_bsgt_shipment_from_trade_file(uuid, uuid) from public, anon;
revoke all on function public.send_bsgt_trade_file_to_remitting(uuid, text, jsonb) from public, anon;
grant execute on function public.create_bsgt_trade_collection_file(uuid[]) to authenticated;
grant execute on function public.add_bsgt_shipments_to_trade_file(uuid, uuid[]) to authenticated;
grant execute on function public.remove_bsgt_shipment_from_trade_file(uuid, uuid) to authenticated;
grant execute on function public.send_bsgt_trade_file_to_remitting(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
