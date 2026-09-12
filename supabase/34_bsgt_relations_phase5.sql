-- BSGT Workspace - Phase 5: commercial relations and collecting-bank handoff.
-- Additive migration. Phase 1-4 workflow, legacy fields, and merge package contents remain intact.

alter table public.trade_collection_files
  add column if not exists sent_to_collecting_by uuid references public.profiles(id);

alter table public.trade_collection_file_events
  drop constraint if exists trade_collection_file_events_type_check;

alter table public.trade_collection_file_events
  add constraint trade_collection_file_events_type_check check (event_type in (
    'sent_to_remitting',
    'management_review_started',
    'signed_document_uploaded',
    'signed_document_archived',
    'management_note',
    'returned_to_operations',
    'returned_to_finance',
    'final_accepted',
    'sent_to_collecting'
  ));

create table if not exists public.trade_collection_relations_attachments (
  id uuid primary key default gen_random_uuid(),
  trade_file_id uuid not null references public.trade_collection_files(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  attachment_type text not null,
  original_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  revision_no integer not null,
  is_active boolean not null default true,
  uploaded_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint trade_collection_relations_attachments_type_check
    check (attachment_type in ('company_letter', 'signed_stamped_letterhead')),
  constraint trade_collection_relations_attachments_revision_check check (revision_no > 0),
  constraint trade_collection_relations_attachments_size_check
    check (size_bytes is null or size_bytes between 0 and 15728640),
  constraint trade_collection_relations_attachments_path_key unique (storage_path)
);

create unique index if not exists trade_collection_relations_attachments_active_key
  on public.trade_collection_relations_attachments(trade_file_id, shipment_id, revision_no, attachment_type)
  where is_active;
create index if not exists trade_collection_relations_attachments_file_idx
  on public.trade_collection_relations_attachments(trade_file_id, revision_no, uploaded_at desc);
create index if not exists trade_collection_relations_attachments_shipment_idx
  on public.trade_collection_relations_attachments(shipment_id, revision_no);

create or replace function public.enforce_bsgt_relations_attachment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_file public.trade_collection_files%rowtype;
begin
  select * into v_file from public.trade_collection_files
  where id = new.trade_file_id and company_id = public.bsgt_company_id();
  if not found then raise exception 'Trade file must belong to BSGT'; end if;
  if not exists (
    select 1 from public.trade_collection_file_shipments link
    where link.trade_file_id = new.trade_file_id and link.shipment_id = new.shipment_id
  ) then raise exception 'Shipment is not linked to this trade file'; end if;
  if new.revision_no <> v_file.revision_no then
    raise exception 'Attachment revision must match the current trade file revision';
  end if;
  return new;
end;
$$;

drop trigger if exists trade_collection_relations_attachment_guard
  on public.trade_collection_relations_attachments;
create trigger trade_collection_relations_attachment_guard
  before insert or update of trade_file_id, shipment_id, revision_no
  on public.trade_collection_relations_attachments
  for each row execute function public.enforce_bsgt_relations_attachment();

alter table public.trade_collection_relations_attachments enable row level security;

drop policy if exists trade_collection_relations_attachments_select on public.trade_collection_relations_attachments;
create policy trade_collection_relations_attachments_select
  on public.trade_collection_relations_attachments for select to authenticated
  using (
    public.has_bsgt_workspace_permission('relations', false)
    and exists (
      select 1 from public.trade_collection_files trade_file
      where trade_file.id = trade_file_id and trade_file.company_id = public.bsgt_company_id()
    )
  );
drop policy if exists trade_collection_relations_attachments_insert on public.trade_collection_relations_attachments;
create policy trade_collection_relations_attachments_insert
  on public.trade_collection_relations_attachments for insert to authenticated
  with check (
    public.has_bsgt_workspace_permission('relations', true)
    and uploaded_by = auth.uid()
    and exists (
      select 1 from public.trade_collection_files trade_file
      where trade_file.id = trade_file_id and trade_file.company_id = public.bsgt_company_id()
    )
  );
drop policy if exists trade_collection_relations_attachments_update on public.trade_collection_relations_attachments;
create policy trade_collection_relations_attachments_update
  on public.trade_collection_relations_attachments for update to authenticated
  using (public.has_bsgt_workspace_permission('relations', true))
  with check (public.has_bsgt_workspace_permission('relations', true));

-- Additive read policies keep every previous section's scope unchanged.
drop policy if exists trade_collection_files_relations_select on public.trade_collection_files;
create policy trade_collection_files_relations_select on public.trade_collection_files
  for select to authenticated
  using (company_id = public.bsgt_company_id() and public.has_bsgt_workspace_permission('relations', false));
drop policy if exists trade_collection_file_shipments_relations_select on public.trade_collection_file_shipments;
create policy trade_collection_file_shipments_relations_select on public.trade_collection_file_shipments
  for select to authenticated
  using (
    public.has_bsgt_workspace_permission('relations', false)
    and exists (select 1 from public.trade_collection_files f where f.id = trade_file_id and f.company_id = public.bsgt_company_id())
  );
drop policy if exists trade_collection_file_documents_relations_select on public.trade_collection_file_documents;
create policy trade_collection_file_documents_relations_select on public.trade_collection_file_documents
  for select to authenticated
  using (
    public.has_bsgt_workspace_permission('relations', false)
    and exists (select 1 from public.trade_collection_files f where f.id = trade_file_id and f.company_id = public.bsgt_company_id())
  );
drop policy if exists trade_collection_file_events_relations_select on public.trade_collection_file_events;
create policy trade_collection_file_events_relations_select on public.trade_collection_file_events
  for select to authenticated
  using (
    public.has_bsgt_workspace_permission('relations', false)
    and exists (select 1 from public.trade_collection_files f where f.id = trade_file_id and f.company_id = public.bsgt_company_id())
  );
drop policy if exists shipments_relations_select on public.shipments;
create policy shipments_relations_select on public.shipments
  for select to authenticated
  using (company_id = public.bsgt_company_id() and public.has_bsgt_workspace_permission('relations', false));
drop policy if exists shipmentfiles_relations_select on public.shipment_files;
create policy shipmentfiles_relations_select on public.shipment_files
  for select to authenticated
  using (
    public.has_bsgt_workspace_permission('relations', false)
    and exists (
      select 1 from public.shipments shipment
      where shipment.id = shipment_id and shipment.company_id = public.bsgt_company_id()
    )
  );

insert into storage.buckets (id, name, public)
values ('trade-collection-documents', 'trade-collection-documents', false)
on conflict (id) do update set public = false;

create or replace function public.can_access_bsgt_relations_document_path(
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
    split_part(p_name, '/', 1) = 'relations'
    and public.has_bsgt_workspace_permission('relations', p_require_edit)
    and exists (
      select 1 from public.trade_collection_files trade_file
      where trade_file.id::text = split_part(p_name, '/', 2)
        and trade_file.company_id = public.bsgt_company_id()
        and (
          not p_require_edit
          or (
            trade_file.status = 'final_accepted'
            and trade_file.revision_no::text = split_part(p_name, '/', 3)
            and split_part(p_name, '/', 5) in ('company_letter', 'signed_stamped_letterhead')
            and exists (
              select 1 from public.trade_collection_file_shipments link
              where link.trade_file_id = trade_file.id
                and link.shipment_id::text = split_part(p_name, '/', 4)
            )
          )
        )
    ), false
  );
$$;

drop policy if exists bsgt_relations_documents_read on storage.objects;
create policy bsgt_relations_documents_read on storage.objects
  for select to authenticated
  using (bucket_id = 'trade-collection-documents' and public.can_access_bsgt_relations_document_path(name, false));
drop policy if exists bsgt_relations_documents_upload on storage.objects;
create policy bsgt_relations_documents_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trade-collection-documents' and public.can_access_bsgt_relations_document_path(name, true));
drop policy if exists bsgt_relations_documents_update on storage.objects;
create policy bsgt_relations_documents_update on storage.objects
  for update to authenticated
  using (bucket_id = 'trade-collection-documents' and public.can_access_bsgt_relations_document_path(name, true))
  with check (bucket_id = 'trade-collection-documents' and public.can_access_bsgt_relations_document_path(name, true));
drop policy if exists bsgt_relations_documents_delete on storage.objects;
create policy bsgt_relations_documents_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'trade-collection-documents' and public.can_access_bsgt_relations_document_path(name, true));

-- Relations may preview signed management documents, but never modify them.
drop policy if exists bsgt_trade_documents_relations_read on storage.objects;
create policy bsgt_trade_documents_relations_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'trade-collection-documents'
    and split_part(name, '/', 1) <> 'relations'
    and public.has_bsgt_workspace_permission('relations', false)
    and exists (
      select 1 from public.trade_collection_files trade_file
      where trade_file.id::text = split_part(name, '/', 1)
        and trade_file.company_id = public.bsgt_company_id()
    )
  );

create or replace function public.get_bsgt_relations_trade_files(
  p_page integer default 1,
  p_page_size integer default 25
)
returns table (
  id uuid,
  operation_no text,
  status text,
  revision_no integer,
  remitting_bank text,
  collecting_bank text,
  metadata jsonb,
  final_accepted_at timestamptz,
  sent_to_collecting_at timestamptz,
  shipment_count bigint,
  missing_optional_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_bsgt_workspace_permission('relations', false) then
    raise exception 'BSGT relations view permission is required';
  end if;
  p_page := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 25), 1), 100);
  return query
  with scoped as (
    select trade_file.*,
      (select count(*) from public.trade_collection_file_shipments link where link.trade_file_id = trade_file.id) as linked_count,
      (select count(*) from public.trade_collection_relations_attachments attachment
       where attachment.trade_file_id = trade_file.id
         and attachment.revision_no = trade_file.revision_no and attachment.is_active) as attachment_count
    from public.trade_collection_files trade_file
    where trade_file.company_id = public.bsgt_company_id()
      and trade_file.status in ('final_accepted', 'sent_to_collecting')
      and (
        trade_file.status = 'sent_to_collecting'
        or (
          exists (select 1 from public.trade_collection_file_shipments link where link.trade_file_id = trade_file.id)
          and not exists (
            select 1 from public.trade_collection_file_shipments link
            join public.shipments shipment on shipment.id = link.shipment_id
            where link.trade_file_id = trade_file.id
              and (shipment.company_id is distinct from public.bsgt_company_id()
                or shipment.bsgt_stage is distinct from 'final_accepted')
          )
        )
      )
  )
  select scoped.id, scoped.operation_no, scoped.status, scoped.revision_no,
    scoped.remitting_bank, scoped.collecting_bank, scoped.metadata,
    scoped.final_accepted_at, scoped.sent_to_collecting_at,
    scoped.linked_count,
    greatest(scoped.linked_count * 2 - scoped.attachment_count, 0),
    count(*) over()
  from scoped
  order by coalesce(scoped.sent_to_collecting_at, scoped.final_accepted_at, scoped.updated_at) desc
  offset (p_page - 1) * p_page_size limit p_page_size;
end;
$$;

create or replace function public.register_bsgt_relations_attachment(
  p_trade_file_id uuid,
  p_shipment_id uuid,
  p_attachment_type text,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_file public.trade_collection_files%rowtype;
  v_attachment public.trade_collection_relations_attachments%rowtype;
begin
  if not public.has_bsgt_workspace_permission('relations', true) then
    raise exception 'BSGT relations edit permission is required';
  end if;
  select * into v_file from public.trade_collection_files
  where id = p_trade_file_id and company_id = public.bsgt_company_id() for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status <> 'final_accepted' then raise exception 'Attachments can only change before collecting-bank send'; end if;
  if p_attachment_type not in ('company_letter', 'signed_stamped_letterhead') then raise exception 'Unsupported attachment type'; end if;
  if lower(coalesce(p_mime_type, '')) not in ('application/pdf', 'image/png', 'image/jpeg') then raise exception 'Unsupported attachment MIME type'; end if;
  if p_size_bytes is null or p_size_bytes < 0 or p_size_bytes > 15728640 then raise exception 'Attachment size is invalid'; end if;
  if nullif(trim(p_original_name), '') is null then raise exception 'Attachment name is required'; end if;
  if split_part(p_storage_path, '/', 1) <> 'relations'
     or split_part(p_storage_path, '/', 2) <> v_file.id::text
     or split_part(p_storage_path, '/', 3) <> v_file.revision_no::text
     or split_part(p_storage_path, '/', 4) <> p_shipment_id::text
     or split_part(p_storage_path, '/', 5) <> p_attachment_type then
    raise exception 'Attachment storage path is invalid';
  end if;
  if not exists (
    select 1 from public.trade_collection_file_shipments link
    where link.trade_file_id = v_file.id and link.shipment_id = p_shipment_id
  ) then raise exception 'Shipment is not linked to this trade file'; end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'trade-collection-documents' and object.name = p_storage_path
  ) then raise exception 'Uploaded storage object was not found'; end if;

  update public.trade_collection_relations_attachments
  set is_active = false, archived_at = now()
  where trade_file_id = v_file.id and shipment_id = p_shipment_id
    and revision_no = v_file.revision_no and attachment_type = p_attachment_type and is_active;
  insert into public.trade_collection_relations_attachments(
    trade_file_id, shipment_id, attachment_type, original_name, storage_path,
    mime_type, size_bytes, revision_no, uploaded_by
  ) values (
    v_file.id, p_shipment_id, p_attachment_type, trim(p_original_name), p_storage_path,
    lower(p_mime_type), p_size_bytes, v_file.revision_no, auth.uid()
  ) returning * into v_attachment;
  return to_jsonb(v_attachment);
end;
$$;

create or replace function public.archive_bsgt_relations_attachment(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attachment public.trade_collection_relations_attachments%rowtype;
  v_file public.trade_collection_files%rowtype;
begin
  if not public.has_bsgt_workspace_permission('relations', true) then
    raise exception 'BSGT relations edit permission is required';
  end if;
  select * into v_attachment from public.trade_collection_relations_attachments
  where id = p_attachment_id for update;
  if not found then raise exception 'Attachment was not found'; end if;
  select * into v_file from public.trade_collection_files
  where id = v_attachment.trade_file_id and company_id = public.bsgt_company_id() for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status <> 'final_accepted' or v_attachment.revision_no <> v_file.revision_no then
    raise exception 'Only current attachments can be archived before send';
  end if;
  update public.trade_collection_relations_attachments
  set is_active = false, archived_at = now()
  where id = p_attachment_id and is_active returning * into v_attachment;
  if not found then raise exception 'Attachment is already archived'; end if;
  return to_jsonb(v_attachment);
end;
$$;

create or replace function public.send_bsgt_trade_file_to_collecting(
  p_trade_file_id uuid,
  p_collecting_bank text,
  p_collecting_bank_address text default null
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
  v_required text[];
  v_signed integer;
  v_now timestamptz := now();
begin
  if not public.has_bsgt_workspace_permission('relations', true) then
    raise exception 'BSGT relations edit permission is required';
  end if;
  select * into v_file from public.trade_collection_files
  where id = p_trade_file_id and company_id = public.bsgt_company_id() for update;
  if not found then raise exception 'Trade file was not found'; end if;
  if v_file.status <> 'final_accepted' then raise exception 'Trade file is not final accepted'; end if;
  if v_file.final_accepted_at is null or v_file.final_accepted_by is null then
    raise exception 'Management acceptance is no longer valid';
  end if;
  if nullif(trim(p_collecting_bank), '') is null then raise exception 'Collecting bank is required'; end if;

  perform 1 from public.shipments shipment
  join public.trade_collection_file_shipments link on link.shipment_id = shipment.id
  where link.trade_file_id = v_file.id order by shipment.id for update of shipment;
  select count(*), count(*) filter (
    where shipment.company_id = public.bsgt_company_id() and shipment.bsgt_stage = 'final_accepted'
  ) into v_linked, v_ready
  from public.trade_collection_file_shipments link
  join public.shipments shipment on shipment.id = link.shipment_id
  where link.trade_file_id = v_file.id;
  if v_linked < 1 then raise exception 'Trade file has no linked shipments'; end if;
  if v_ready <> v_linked then raise exception 'All linked shipments must be final accepted'; end if;

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
  where trade_file_id = v_file.id and revision_no = v_file.revision_no
    and is_active and document_type = any(v_required);
  if v_signed <> cardinality(v_required) then raise exception 'Management acceptance documents are incomplete'; end if;

  update public.shipments shipment
  set bsgt_stage = 'sent_to_collecting', bsgt_stage_updated_at = v_now
  from public.trade_collection_file_shipments link
  where link.trade_file_id = v_file.id and link.shipment_id = shipment.id;
  update public.trade_collection_files
  set status = 'sent_to_collecting', sent_to_collecting_at = v_now,
      sent_to_collecting_by = auth.uid(), collecting_bank = trim(p_collecting_bank),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'collectingBankAddress', coalesce(trim(p_collecting_bank_address), '')
      ), updated_at = v_now
  where id = v_file.id returning * into v_file;
  insert into public.trade_collection_file_events(
    trade_file_id, event_type, from_status, to_status, note, actor_id, revision_no
  ) values (
    v_file.id, 'sent_to_collecting', 'final_accepted', 'sent_to_collecting',
    trim(p_collecting_bank), auth.uid(), v_file.revision_no
  );
  return to_jsonb(v_file) || jsonb_build_object('linkedShipmentCount', v_linked);
end;
$$;

revoke insert, update, delete on public.trade_collection_relations_attachments from authenticated;
grant select on public.trade_collection_relations_attachments to authenticated;

revoke all on function public.enforce_bsgt_relations_attachment() from public, anon, authenticated;
revoke all on function public.can_access_bsgt_relations_document_path(text, boolean) from public, anon;
revoke all on function public.get_bsgt_relations_trade_files(integer, integer) from public, anon;
revoke all on function public.register_bsgt_relations_attachment(uuid, uuid, text, text, text, text, bigint) from public, anon;
revoke all on function public.archive_bsgt_relations_attachment(uuid) from public, anon;
revoke all on function public.send_bsgt_trade_file_to_collecting(uuid, text, text) from public, anon;

grant execute on function public.can_access_bsgt_relations_document_path(text, boolean) to authenticated;
grant execute on function public.get_bsgt_relations_trade_files(integer, integer) to authenticated;
grant execute on function public.register_bsgt_relations_attachment(uuid, uuid, text, text, text, text, bigint) to authenticated;
grant execute on function public.archive_bsgt_relations_attachment(uuid) to authenticated;
grant execute on function public.send_bsgt_trade_file_to_collecting(uuid, text, text) to authenticated;

comment on table public.trade_collection_relations_attachments is
  'Optional, shipment-level commercial-relations attachments versioned with the existing BSGT trade file.';
comment on function public.send_bsgt_trade_file_to_collecting(uuid, text, text) is
  'Atomically hands a final-accepted BSGT trade file and all linked shipments to the collecting bank.';

notify pgrst, 'reload schema';
