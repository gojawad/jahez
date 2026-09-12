-- BSGT Workspace - Phase 4: management review only.
-- Additive migration. Existing trade files, shipment data, and legacy merge rules remain intact.

alter table public.trade_collection_files
  add column if not exists revision_no integer not null default 1,
  add column if not exists management_reviewed_by uuid references public.profiles(id),
  add column if not exists final_accepted_by uuid references public.profiles(id);

alter table public.trade_collection_files
  drop constraint if exists trade_collection_files_status_check;

alter table public.trade_collection_files
  add constraint trade_collection_files_status_check check (status in (
    'draft',
    'sent_to_remitting',
    'under_management_review',
    'returned_to_operations',
    'returned_to_finance',
    'final_accepted',
    'sent_to_collecting'
  ));

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

create table if not exists public.trade_collection_file_documents (
  id uuid primary key default gen_random_uuid(),
  trade_file_id uuid not null references public.trade_collection_files(id) on delete cascade,
  revision_no integer not null,
  document_type text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  is_active boolean not null default true,
  uploaded_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint trade_collection_file_documents_revision_check check (revision_no > 0),
  constraint trade_collection_file_documents_type_check check (document_type in ('letter', 'undertaking', 'exchange')),
  constraint trade_collection_file_documents_size_check check (file_size is null or file_size >= 0),
  constraint trade_collection_file_documents_path_key unique (storage_path)
);

create unique index if not exists trade_collection_file_documents_active_key
  on public.trade_collection_file_documents(trade_file_id, revision_no, document_type)
  where is_active;

create index if not exists trade_collection_file_documents_file_idx
  on public.trade_collection_file_documents(trade_file_id, revision_no, created_at desc);

create table if not exists public.trade_collection_file_events (
  id uuid primary key default gen_random_uuid(),
  trade_file_id uuid not null references public.trade_collection_files(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  actor_id uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  revision_no integer not null,
  created_at timestamptz not null default now(),
  constraint trade_collection_file_events_revision_check check (revision_no > 0),
  constraint trade_collection_file_events_type_check check (event_type in (
    'sent_to_remitting',
    'management_review_started',
    'signed_document_uploaded',
    'signed_document_archived',
    'management_note',
    'returned_to_operations',
    'returned_to_finance',
    'final_accepted'
  ))
);

create index if not exists trade_collection_file_events_file_idx
  on public.trade_collection_file_events(trade_file_id, created_at desc);

alter table public.trade_collection_file_documents enable row level security;
alter table public.trade_collection_file_events enable row level security;

drop policy if exists trade_collection_files_select on public.trade_collection_files;
create policy trade_collection_files_select on public.trade_collection_files
  for select to authenticated
  using (
    company_id = public.bsgt_company_id()
    and (
      public.has_bsgt_workspace_permission('operations', false)
      or public.has_bsgt_workspace_permission('finance', false)
      or public.has_bsgt_workspace_permission('management', false)
    )
  );

drop policy if exists trade_collection_file_shipments_select on public.trade_collection_file_shipments;
create policy trade_collection_file_shipments_select on public.trade_collection_file_shipments
  for select to authenticated
  using (
    exists (
      select 1 from public.trade_collection_files trade_file
      where trade_file.id = trade_file_id
        and trade_file.company_id = public.bsgt_company_id()
    )
    and (
      public.has_bsgt_workspace_permission('operations', false)
      or public.has_bsgt_workspace_permission('finance', false)
      or public.has_bsgt_workspace_permission('management', false)
    )
  );

drop policy if exists trade_collection_file_documents_select on public.trade_collection_file_documents;
create policy trade_collection_file_documents_select on public.trade_collection_file_documents
  for select to authenticated
  using (
    exists (
      select 1 from public.trade_collection_files trade_file
      where trade_file.id = trade_file_id
        and trade_file.company_id = public.bsgt_company_id()
    )
    and (
      public.has_bsgt_workspace_permission('operations', false)
      or public.has_bsgt_workspace_permission('finance', false)
      or public.has_bsgt_workspace_permission('management', false)
    )
  );

drop policy if exists trade_collection_file_events_select on public.trade_collection_file_events;
create policy trade_collection_file_events_select on public.trade_collection_file_events
  for select to authenticated
  using (
    exists (
      select 1 from public.trade_collection_files trade_file
      where trade_file.id = trade_file_id
        and trade_file.company_id = public.bsgt_company_id()
    )
    and (
      public.has_bsgt_workspace_permission('operations', false)
      or public.has_bsgt_workspace_permission('finance', false)
      or public.has_bsgt_workspace_permission('management', false)
    )
  );

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
      or (company_id = public.bsgt_company_id() and public.has_bsgt_workspace_permission('management', false))
    )
  );

insert into storage.buckets (id, name, public)
values ('trade-collection-documents', 'trade-collection-documents', false)
on conflict (id) do update set public = false;

create or replace function public.can_access_bsgt_trade_document_path(
  p_name text,
  p_require_edit boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.has_bsgt_workspace_permission('management', p_require_edit)
    and exists (
      select 1
      from public.trade_collection_files trade_file
      where trade_file.id::text = split_part(p_name, '/', 1)
        and trade_file.company_id = public.bsgt_company_id()
    ),
    false
  );
$$;

drop policy if exists bsgt_trade_documents_read on storage.objects;
create policy bsgt_trade_documents_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'trade-collection-documents'
    and public.can_access_bsgt_trade_document_path(name, false)
  );

drop policy if exists bsgt_trade_documents_upload on storage.objects;
create policy bsgt_trade_documents_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'trade-collection-documents'
    and public.can_access_bsgt_trade_document_path(name, true)
  );

drop policy if exists bsgt_trade_documents_update on storage.objects;
create policy bsgt_trade_documents_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'trade-collection-documents'
    and public.can_access_bsgt_trade_document_path(name, true)
  )
  with check (
    bucket_id = 'trade-collection-documents'
    and public.can_access_bsgt_trade_document_path(name, true)
  );

drop policy if exists bsgt_trade_documents_delete on storage.objects;
create policy bsgt_trade_documents_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'trade-collection-documents'
    and public.can_access_bsgt_trade_document_path(name, true)
  );

create or replace function public.start_bsgt_management_review(p_trade_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file public.trade_collection_files%rowtype;
  v_linked integer;
  v_ready integer;
  v_now timestamptz := now();
begin
  if not public.has_bsgt_workspace_permission('management', true) then
    raise exception 'BSGT management edit permission is required';
  end if;
  select * into v_file from public.trade_collection_files
  where id = p_trade_file_id and company_id = public.bsgt_company_id()
  for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status <> 'sent_to_remitting' then raise exception 'Trade file is not awaiting management review'; end if;

  perform 1 from public.shipments shipment
  join public.trade_collection_file_shipments link on link.shipment_id = shipment.id
  where link.trade_file_id = p_trade_file_id order by shipment.id for update of shipment;

  select count(*), count(*) filter (where shipment.company_id = public.bsgt_company_id() and shipment.bsgt_stage = 'sent_to_remitting')
  into v_linked, v_ready
  from public.trade_collection_file_shipments link
  join public.shipments shipment on shipment.id = link.shipment_id
  where link.trade_file_id = p_trade_file_id;
  if v_linked < 1 then raise exception 'Trade file has no linked shipments'; end if;
  if v_ready <> v_linked then raise exception 'All linked shipments must be sent to the remitting bank'; end if;

  update public.shipments shipment
  set bsgt_stage = 'management_review', bsgt_stage_updated_at = v_now
  from public.trade_collection_file_shipments link
  where link.trade_file_id = p_trade_file_id and link.shipment_id = shipment.id;

  update public.trade_collection_files
  set status = 'under_management_review', management_reviewed_at = v_now,
      management_reviewed_by = auth.uid(), updated_at = v_now
  where id = p_trade_file_id returning * into v_file;

  insert into public.trade_collection_file_events(trade_file_id, event_type, from_status, to_status, actor_id, revision_no)
  values(p_trade_file_id, 'management_review_started', 'sent_to_remitting', 'under_management_review', auth.uid(), v_file.revision_no);
  return to_jsonb(v_file) || jsonb_build_object('linkedShipmentCount', v_linked);
end;
$$;

create or replace function public.register_bsgt_signed_document(
  p_trade_file_id uuid,
  p_document_type text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text default null,
  p_file_size bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_file public.trade_collection_files%rowtype;
  v_document public.trade_collection_file_documents%rowtype;
begin
  if not public.has_bsgt_workspace_permission('management', true) then
    raise exception 'BSGT management edit permission is required';
  end if;
  select * into v_file from public.trade_collection_files
  where id = p_trade_file_id and company_id = public.bsgt_company_id() for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status <> 'under_management_review' then raise exception 'Trade file is not under management review'; end if;
  if p_document_type not in ('letter', 'undertaking', 'exchange') then raise exception 'Unsupported signed document type'; end if;
  if p_storage_path is null or split_part(p_storage_path, '/', 1) <> p_trade_file_id::text then
    raise exception 'Invalid signed document path';
  end if;
  if not exists(select 1 from storage.objects where bucket_id = 'trade-collection-documents' and name = p_storage_path) then
    raise exception 'Uploaded signed document was not found';
  end if;

  update public.trade_collection_file_documents
  set is_active = false, archived_at = now()
  where trade_file_id = p_trade_file_id and revision_no = v_file.revision_no
    and document_type = p_document_type and is_active;

  insert into public.trade_collection_file_documents(
    trade_file_id, revision_no, document_type, storage_path, file_name, mime_type, file_size, uploaded_by
  ) values (
    p_trade_file_id, v_file.revision_no, p_document_type, p_storage_path,
    coalesce(nullif(trim(p_file_name), ''), p_document_type), nullif(trim(p_mime_type), ''), p_file_size, auth.uid()
  ) returning * into v_document;

  insert into public.trade_collection_file_events(trade_file_id, event_type, note, actor_id, revision_no)
  values(p_trade_file_id, 'signed_document_uploaded', p_document_type, auth.uid(), v_file.revision_no);
  return to_jsonb(v_document);
end;
$$;

create or replace function public.archive_bsgt_signed_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.trade_collection_file_documents%rowtype;
  v_file public.trade_collection_files%rowtype;
begin
  if not public.has_bsgt_workspace_permission('management', true) then
    raise exception 'BSGT management edit permission is required';
  end if;
  select document.* into v_document
  from public.trade_collection_file_documents document
  where document.id = p_document_id for update;
  if not found then raise exception 'Signed document was not found'; end if;
  select * into v_file from public.trade_collection_files
  where id = v_document.trade_file_id and company_id = public.bsgt_company_id() for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status <> 'under_management_review' or v_document.revision_no <> v_file.revision_no then
    raise exception 'Only current review documents can be archived';
  end if;
  update public.trade_collection_file_documents
  set is_active = false, archived_at = now()
  where id = p_document_id and is_active returning * into v_document;
  if not found then raise exception 'Signed document is already archived'; end if;
  insert into public.trade_collection_file_events(trade_file_id, event_type, note, actor_id, revision_no)
  values(v_file.id, 'signed_document_archived', v_document.document_type, auth.uid(), v_file.revision_no);
  return to_jsonb(v_document);
end;
$$;

create or replace function public.add_bsgt_management_note(p_trade_file_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_file public.trade_collection_files%rowtype; v_event public.trade_collection_file_events%rowtype;
begin
  if not public.has_bsgt_workspace_permission('management', true) then raise exception 'BSGT management edit permission is required'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Management note is required'; end if;
  select * into v_file from public.trade_collection_files
  where id = p_trade_file_id and company_id = public.bsgt_company_id() for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status <> 'under_management_review' then raise exception 'Trade file is not under management review'; end if;
  insert into public.trade_collection_file_events(trade_file_id, event_type, note, actor_id, revision_no)
  values(v_file.id, 'management_note', trim(p_note), auth.uid(), v_file.revision_no) returning * into v_event;
  return to_jsonb(v_event);
end;
$$;

create or replace function public.return_bsgt_trade_file(
  p_trade_file_id uuid,
  p_target text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file public.trade_collection_files%rowtype;
  v_target_status text;
  v_shipment_stage text;
  v_event_type text;
  v_now timestamptz := now();
begin
  if not public.has_bsgt_workspace_permission('management', true) then raise exception 'BSGT management edit permission is required'; end if;
  if p_target not in ('operations', 'finance') then raise exception 'Return target must be operations or finance'; end if;
  if nullif(trim(p_note), '') is null then raise exception 'Return note is required'; end if;
  select * into v_file from public.trade_collection_files
  where id = p_trade_file_id and company_id = public.bsgt_company_id() for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status <> 'under_management_review' then raise exception 'Trade file is not under management review'; end if;

  perform 1 from public.shipments shipment
  join public.trade_collection_file_shipments link on link.shipment_id = shipment.id
  where link.trade_file_id = p_trade_file_id order by shipment.id for update of shipment;
  if not exists(select 1 from public.trade_collection_file_shipments where trade_file_id = p_trade_file_id) then
    raise exception 'Trade file has no linked shipments';
  end if;

  if p_target = 'operations' then
    v_target_status := 'returned_to_operations'; v_shipment_stage := 'operations_draft'; v_event_type := 'returned_to_operations';
  else
    v_target_status := 'returned_to_finance'; v_shipment_stage := 'ready_for_finance'; v_event_type := 'returned_to_finance';
  end if;

  update public.shipments shipment
  set bsgt_stage = v_shipment_stage, bsgt_stage_updated_at = v_now
  from public.trade_collection_file_shipments link
  where link.trade_file_id = p_trade_file_id and link.shipment_id = shipment.id;

  update public.trade_collection_files
  set status = v_target_status, revision_no = revision_no + 1, updated_at = v_now
  where id = p_trade_file_id returning * into v_file;

  insert into public.trade_collection_file_events(trade_file_id, event_type, from_status, to_status, note, actor_id, revision_no)
  values(v_file.id, v_event_type, 'under_management_review', v_target_status, trim(p_note), auth.uid(), v_file.revision_no);
  return to_jsonb(v_file);
end;
$$;

create or replace function public.final_accept_bsgt_trade_file(p_trade_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_file public.trade_collection_files%rowtype;
  v_linked integer;
  v_review integer;
  v_required text[];
  v_signed integer;
  v_now timestamptz := now();
begin
  if not public.has_bsgt_workspace_permission('management', true) then raise exception 'BSGT management edit permission is required'; end if;
  select * into v_file from public.trade_collection_files
  where id = p_trade_file_id and company_id = public.bsgt_company_id() for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status <> 'under_management_review' then raise exception 'Trade file is not under management review'; end if;

  perform 1 from public.shipments shipment
  join public.trade_collection_file_shipments link on link.shipment_id = shipment.id
  where link.trade_file_id = p_trade_file_id order by shipment.id for update of shipment;
  select count(*), count(*) filter(where shipment.company_id = public.bsgt_company_id() and shipment.bsgt_stage = 'management_review')
  into v_linked, v_review
  from public.trade_collection_file_shipments link
  join public.shipments shipment on shipment.id = link.shipment_id
  where link.trade_file_id = p_trade_file_id;
  if v_linked < 1 then raise exception 'Trade file has no linked shipments'; end if;
  if v_review <> v_linked then raise exception 'All linked shipments must be under management review'; end if;

  select coalesce(array_agg(distinct kind), array['letter','undertaking','exchange']::text[])
  into v_required
  from jsonb_array_elements_text(
    case when jsonb_typeof(v_file.metadata->'documentKinds') = 'array'
      then v_file.metadata->'documentKinds' else '["letter","undertaking","exchange"]'::jsonb end
  ) required(kind)
  where kind in ('letter','undertaking','exchange');
  if coalesce(cardinality(v_required), 0) = 0 then v_required := array['letter','undertaking','exchange']::text[]; end if;

  select count(distinct document_type) into v_signed
  from public.trade_collection_file_documents
  where trade_file_id = p_trade_file_id and revision_no = v_file.revision_no
    and is_active and document_type = any(v_required);
  if v_signed <> cardinality(v_required) then raise exception 'Current revision signed documents are incomplete'; end if;

  update public.shipments shipment
  set bsgt_stage = 'final_accepted', bsgt_stage_updated_at = v_now
  from public.trade_collection_file_shipments link
  where link.trade_file_id = p_trade_file_id and link.shipment_id = shipment.id;
  update public.trade_collection_files
  set status = 'final_accepted', final_accepted_at = v_now,
      final_accepted_by = auth.uid(), updated_at = v_now
  where id = p_trade_file_id returning * into v_file;
  insert into public.trade_collection_file_events(trade_file_id, event_type, from_status, to_status, actor_id, revision_no)
  values(v_file.id, 'final_accepted', 'under_management_review', 'final_accepted', auth.uid(), v_file.revision_no);
  return to_jsonb(v_file) || jsonb_build_object('linkedShipmentCount', v_linked);
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
  v_from_status text;
  v_sent_at timestamptz := now();
begin
  if not public.has_bsgt_workspace_permission('finance', true) then raise exception 'BSGT finance edit permission is required'; end if;
  select * into v_file from public.trade_collection_files
  where id = p_trade_file_id and company_id = public.bsgt_company_id() for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status not in ('draft', 'returned_to_operations', 'returned_to_finance') then
    raise exception 'Trade file cannot be sent from its current status';
  end if;
  v_from_status := v_file.status;
  if nullif(trim(p_remitting_bank), '') is null then raise exception 'Remitting bank is required'; end if;

  perform 1 from public.shipments shipment
  join public.trade_collection_file_shipments link on link.shipment_id = shipment.id
  where link.trade_file_id = p_trade_file_id order by shipment.id for update of shipment;
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
  if v_currency_count <> 1 or coalesce(v_currency, '') = '' then raise exception 'All linked shipments must use one valid currency'; end if;

  update public.shipments shipment
  set bsgt_stage = 'sent_to_remitting', bsgt_stage_updated_at = v_sent_at
  from public.trade_collection_file_shipments link
  where link.trade_file_id = p_trade_file_id and link.shipment_id = shipment.id;
  update public.trade_collection_files
  set status = 'sent_to_remitting', remitting_bank = trim(p_remitting_bank),
      sent_to_remitting_at = v_sent_at,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('currency', v_currency),
      updated_at = v_sent_at
  where id = p_trade_file_id returning * into v_file;
  insert into public.trade_collection_file_events(trade_file_id, event_type, from_status, to_status, actor_id, revision_no)
  values(v_file.id, 'sent_to_remitting', v_from_status, 'sent_to_remitting', auth.uid(), v_file.revision_no);
  return to_jsonb(v_file) || jsonb_build_object('linkedShipmentCount', v_linked);
end;
$$;

revoke insert, update, delete on public.trade_collection_file_documents from authenticated;
revoke insert, update, delete on public.trade_collection_file_events from authenticated;
grant select on public.trade_collection_file_documents to authenticated;
grant select on public.trade_collection_file_events to authenticated;

revoke all on function public.can_access_bsgt_trade_document_path(text, boolean) from public, anon;
revoke all on function public.start_bsgt_management_review(uuid) from public, anon;
revoke all on function public.register_bsgt_signed_document(uuid, text, text, text, text, bigint) from public, anon;
revoke all on function public.archive_bsgt_signed_document(uuid) from public, anon;
revoke all on function public.add_bsgt_management_note(uuid, text) from public, anon;
revoke all on function public.return_bsgt_trade_file(uuid, text, text) from public, anon;
revoke all on function public.final_accept_bsgt_trade_file(uuid) from public, anon;
revoke all on function public.send_bsgt_trade_file_to_remitting(uuid, text, jsonb) from public, anon;
grant execute on function public.can_access_bsgt_trade_document_path(text, boolean) to authenticated;
grant execute on function public.start_bsgt_management_review(uuid) to authenticated;
grant execute on function public.register_bsgt_signed_document(uuid, text, text, text, text, bigint) to authenticated;
grant execute on function public.archive_bsgt_signed_document(uuid) to authenticated;
grant execute on function public.add_bsgt_management_note(uuid, text) to authenticated;
grant execute on function public.return_bsgt_trade_file(uuid, text, text) to authenticated;
grant execute on function public.final_accept_bsgt_trade_file(uuid) to authenticated;
grant execute on function public.send_bsgt_trade_file_to_remitting(uuid, text, jsonb) to authenticated;

comment on table public.trade_collection_file_documents is
  'Private signed management-review documents, versioned by trade-file revision.';
comment on table public.trade_collection_file_events is
  'Immutable management workflow timeline and notes for BSGT trade files.';

notify pgrst, 'reload schema';
