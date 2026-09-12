-- BSGT Workspace - Phase 2: operations only.
-- Additive migration. Legacy shipment status/workflow fields and package merge are untouched.

alter table public.shipments
  add column if not exists bsgt_stage text,
  add column if not exists bsgt_stage_updated_at timestamptz,
  add column if not exists operations_completed_at timestamptz,
  add column if not exists operations_completed_by uuid references public.profiles(id);

alter table public.shipments
  drop constraint if exists shipments_bsgt_stage_check;

alter table public.shipments
  add constraint shipments_bsgt_stage_check check (
    bsgt_stage is null or bsgt_stage in (
      'operations_draft',
      'ready_for_finance',
      'sent_to_remitting',
      'management_review',
      'final_accepted',
      'sent_to_collecting'
    )
  );

create index if not exists shipments_company_bsgt_stage_idx
  on public.shipments(company_id, bsgt_stage);

update public.shipments
set bsgt_stage = 'operations_draft',
    bsgt_stage_updated_at = coalesce(bsgt_stage_updated_at, now())
where company_id = public.bsgt_company_id()
  and bsgt_stage is null;

create or replace function public.initialize_bsgt_operations_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id = public.bsgt_company_id() and new.bsgt_stage is null then
    new.bsgt_stage := 'operations_draft';
    new.bsgt_stage_updated_at := coalesce(new.bsgt_stage_updated_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists shipments_initialize_bsgt_operations on public.shipments;
create trigger shipments_initialize_bsgt_operations
  before insert or update of company_id on public.shipments
  for each row execute function public.initialize_bsgt_operations_stage();

create or replace function public.bsgt_operations_readiness(p_shipment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, storage
as $$
  with shipment as (
    select s.*
    from public.shipments s
    where s.id = p_shipment_id
      and s.company_id = public.bsgt_company_id()
  ), files as (
    select f.id, f.document_type, f.label,
      case
        when f.document_type in ('import_permit','certificate_of_origin','bill_of_lading') then f.document_type
        when f.label = 'إذن الاستيراد' then 'import_permit'
        when f.label in ('شهادة المنشأ', 'شهادة المنشأ (بحر سواكن)') then 'certificate_of_origin'
        when f.label in ('بوليصة الشحن', 'بوليصة الشحن (بحر سواكن)') then 'bill_of_lading'
        else null
      end as required_type
    from public.shipment_files f
    join shipment s on s.id = f.shipment_id
  ), checks as (
    select
      coalesce(nullif(trim(s.data->>'operationNo'), ''), null) is not null
        and coalesce(nullif(trim(s.data->>'consignee'), ''), null) is not null
        and coalesce(nullif(trim(s.data->>'itemDesc'), ''), null) is not null as contract_ready,
      coalesce(nullif(trim(s.data->>'proformaNo'), ''), null) is not null as proforma_ready,
      coalesce(nullif(trim(s.data->>'invoiceNo'), ''), null) is not null as invoice_ready,
      coalesce(nullif(trim(s.data->>'invoiceNo'), ''), null) is not null as packing_ready,
      exists(select 1 from files where document_type = 'import_permit' or label = 'إذن الاستيراد') as import_permit_ready,
      exists(select 1 from files where document_type = 'certificate_of_origin' or label in ('شهادة المنشأ', 'شهادة المنشأ (بحر سواكن)')) as origin_ready,
      exists(select 1 from files where document_type = 'bill_of_lading' or label in ('بوليصة الشحن', 'بوليصة الشحن (بحر سواكن)')) as bol_ready,
      coalesce((select jsonb_agg(id order by id) from files where required_type is not null), '[]'::jsonb) as uploaded_ids,
      coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',required_type) order by id) from files where required_type is not null), '[]'::jsonb) as uploaded_documents
    from shipment s
  )
  select jsonb_build_object(
    'completed', contract_ready and proforma_ready and invoice_ready and packing_ready
      and import_permit_ready and origin_ready and bol_ready,
    'generated', jsonb_build_object('contract',contract_ready,'proforma',proforma_ready,'invoice',invoice_ready,'packing',packing_ready),
    'uploaded', jsonb_build_object('importPermit',import_permit_ready,'certificateOfOrigin',origin_ready,'billOfLading',bol_ready),
    'uploadedDocumentIds', uploaded_ids,
    'uploadedDocuments', uploaded_documents
  )
  from checks;
$$;

create or replace function public.guard_bsgt_operations_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_readiness jsonb;
  v_completed_at timestamptz := now();
begin
  if new.company_id is distinct from public.bsgt_company_id()
     or new.bsgt_stage is not distinct from old.bsgt_stage then
    return new;
  end if;

  if new.bsgt_stage = 'ready_for_finance' then
    if not public.has_bsgt_workspace_permission('operations', true) then
      raise exception 'BSGT operations edit permission is required';
    end if;
    if coalesce(old.bsgt_stage, 'operations_draft') <> 'operations_draft' then
      raise exception 'Shipment is not in operations draft stage';
    end if;
    v_readiness := public.bsgt_operations_readiness(old.id);
    if not coalesce((v_readiness->>'completed')::boolean, false) then
      raise exception 'BSGT operations requirements are incomplete';
    end if;
    new.bsgt_stage_updated_at := v_completed_at;
    new.operations_completed_at := v_completed_at;
    new.operations_completed_by := auth.uid();
    new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{bsgtOperationsSnapshot}', jsonb_build_object(
      'completedAt', v_completed_at,
      'generatedKinds', jsonb_build_array('contract','proforma','invoice','packing'),
      'uploadedDocumentIds', coalesce(v_readiness->'uploadedDocumentIds', '[]'::jsonb),
      'uploadedDocuments', coalesce(v_readiness->'uploadedDocuments', '[]'::jsonb)
    ), true);
  end if;
  return new;
end;
$$;

drop trigger if exists shipments_guard_bsgt_operations_transition on public.shipments;
create trigger shipments_guard_bsgt_operations_transition
  before update of bsgt_stage on public.shipments
  for each row execute function public.guard_bsgt_operations_transition();

create or replace function public.complete_bsgt_operations(p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.shipments%rowtype;
  v_readiness jsonb;
begin
  if not public.has_bsgt_workspace_permission('operations', true) then
    raise exception 'BSGT operations edit permission is required';
  end if;

  select * into v_shipment
  from public.shipments
  where id = p_shipment_id
    and company_id = public.bsgt_company_id()
  for update;

  if not found then raise exception 'BSGT shipment was not found'; end if;
  if coalesce(v_shipment.bsgt_stage, 'operations_draft') <> 'operations_draft' then
    raise exception 'Shipment is not in operations draft stage';
  end if;

  v_readiness := public.bsgt_operations_readiness(p_shipment_id);
  if not coalesce((v_readiness->>'completed')::boolean, false) then
    raise exception 'BSGT operations requirements are incomplete';
  end if;

  update public.shipments
  set bsgt_stage = 'ready_for_finance'
  where id = p_shipment_id
  returning * into v_shipment;

  return to_jsonb(v_shipment);
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
    )
  );

drop policy if exists shipments_insert on public.shipments;
create policy shipments_insert on public.shipments
  for insert to authenticated
  with check (
    public.is_active() and owner_id = auth.uid() and (
      public.my_role() in ('admin','editor','staff')
      or (company_id = public.bsgt_company_id() and public.has_bsgt_workspace_permission('operations', true))
    )
  );

drop policy if exists shipments_update on public.shipments;
create policy shipments_update on public.shipments
  for update to authenticated
  using (
    public.is_active() and (
      public.is_admin()
      or (owner_id = auth.uid() and public.my_role() = 'editor')
      or (owner_id = auth.uid() and public.my_role() = 'staff' and status in ('draft','rework','review'))
      or (public.is_bsgt_user() and company_id = public.bsgt_company_id())
      or (company_id = public.bsgt_company_id() and public.has_bsgt_workspace_permission('operations', true))
    )
  )
  with check (
    public.is_admin()
    or (owner_id = auth.uid() and public.my_role() = 'editor')
    or (owner_id = auth.uid() and public.my_role() = 'staff' and status in ('draft','review'))
    or (public.is_bsgt_user() and company_id = public.bsgt_company_id())
    or (company_id = public.bsgt_company_id() and public.has_bsgt_workspace_permission('operations', true))
  );

drop policy if exists shipmentfiles_select on public.shipment_files;
create policy shipmentfiles_select on public.shipment_files
  for select to authenticated
  using (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (
        s.owner_id = auth.uid()
        or public.is_admin()
        or (public.is_bsgt_user() and s.company_id = public.bsgt_company_id())
        or (s.company_id = public.bsgt_company_id() and public.has_bsgt_workspace_permission('operations', false))
      )
    )
  );

drop policy if exists shipmentfiles_write on public.shipment_files;
create policy shipmentfiles_write on public.shipment_files
  for insert to authenticated
  with check (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (
        s.owner_id = auth.uid()
        or public.is_admin()
        or (public.is_bsgt_user() and s.company_id = public.bsgt_company_id())
        or (s.company_id = public.bsgt_company_id() and public.has_bsgt_workspace_permission('operations', true))
      )
    )
  );

drop policy if exists shipmentfiles_delete on public.shipment_files;
create policy shipmentfiles_delete on public.shipment_files
  for delete to authenticated
  using (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (
        s.owner_id = auth.uid()
        or public.is_admin()
        or (public.is_bsgt_user() and s.company_id = public.bsgt_company_id())
        or (s.company_id = public.bsgt_company_id() and public.has_bsgt_workspace_permission('operations', true))
      )
    )
  );

revoke all on function public.bsgt_operations_readiness(uuid) from public, anon, authenticated;
revoke all on function public.guard_bsgt_operations_transition() from public, anon, authenticated;
revoke all on function public.complete_bsgt_operations(uuid) from public, anon;
grant execute on function public.complete_bsgt_operations(uuid) to authenticated;

notify pgrst, 'reload schema';
