-- Operations-only immutable packages. Apply before deploying the new workflow.
-- Existing shipments and QR paths are not backfilled or rewritten.
begin;

create table if not exists public.bsgt_operations_revisions (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  revision_no integer not null check (revision_no > 0),
  source_fingerprint text not null,
  shipment_snapshot jsonb not null,
  documents jsonb not null check (jsonb_typeof(documents) = 'array'),
  package_path text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz
);
create unique index if not exists bsgt_operations_approved_revision_number
  on public.bsgt_operations_revisions(shipment_id, revision_no) where approved_at is not null;

alter table public.shipments add column if not exists operations_revision_id uuid
  references public.bsgt_operations_revisions(id) on delete restrict;

alter table public.bsgt_operations_revisions enable row level security;
revoke all on public.bsgt_operations_revisions from anon, authenticated;
grant select on public.bsgt_operations_revisions to authenticated;
grant all on public.bsgt_operations_revisions to service_role;
drop policy if exists bsgt_operations_revisions_read on public.bsgt_operations_revisions;
create policy bsgt_operations_revisions_read on public.bsgt_operations_revisions
  for select to authenticated using (
    approved_at is not null and (
      public.has_bsgt_workspace_permission('operations', false)
      or public.has_bsgt_workspace_permission('finance', false)
      or public.has_bsgt_workspace_permission('management', false)
      or public.has_bsgt_workspace_permission('relations', false)
    )
  );

insert into storage.buckets(id, name, public)
values ('bsgt-operations-packages', 'bsgt-operations-packages', false)
on conflict (id) do nothing;

drop policy if exists bsgt_operations_package_no_insert on storage.objects;
create policy bsgt_operations_package_no_insert on storage.objects as restrictive
  for insert to authenticated with check (bucket_id <> 'bsgt-operations-packages');
drop policy if exists bsgt_operations_package_no_update on storage.objects;
create policy bsgt_operations_package_no_update on storage.objects as restrictive
  for update to authenticated using (bucket_id <> 'bsgt-operations-packages')
  with check (bucket_id <> 'bsgt-operations-packages');
drop policy if exists bsgt_operations_package_no_delete on storage.objects;
create policy bsgt_operations_package_no_delete on storage.objects as restrictive
  for delete to authenticated using (bucket_id <> 'bsgt-operations-packages');

-- The API alone writes this bucket. Authenticated readers can only open
-- objects explicitly present in an approved revision they can read.
drop policy if exists bsgt_operations_package_read on storage.objects;
create policy bsgt_operations_package_read on storage.objects for select to authenticated
using (bucket_id = 'bsgt-operations-packages' and exists (
  select 1 from public.bsgt_operations_revisions r
  where r.approved_at is not null and (
    r.package_path = name or exists (
      select 1 from jsonb_array_elements(r.documents) d where d->>'path' = name
    )
  )
));

create or replace function public.bsgt_operations_package_input(p_shipment_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.shipments%rowtype;
  readiness jsonb;
  files jsonb;
  snapshot jsonb;
begin
  if not public.has_bsgt_workspace_permission('operations', true)
     or not public.has_feature_permission('package.merge') then
    raise exception 'Operations edit and package merge permissions are required';
  end if;
  select * into s from public.shipments
    where id = p_shipment_id and company_id = public.bsgt_company_id();
  if not found or s.bsgt_stage <> 'operations_draft' then
    raise exception 'Shipment must be in operations draft';
  end if;
  readiness := public.bsgt_operations_readiness(s.id);
  if not coalesce((readiness->>'completed')::boolean, false) then
    raise exception 'Operations requirements are incomplete';
  end if;
  if coalesce(s.data->>'qrToken','') !~ '^[A-Za-z0-9_-]{20,64}$' then
    raise exception 'A permanent QR token is required before rendering';
  end if;
  -- Required types come from the existing requirements implementation.
  -- Select one current source per type; never include internal attachments.
  select coalesce(jsonb_agg(to_jsonb(chosen) order by chosen.kind),'[]') into files
  from (
    select distinct on (d->>'type') f.id, d->>'type' as kind, f.path, f.name, f.mime
    from jsonb_array_elements(readiness->'uploadedDocuments') d
    join public.shipment_files f on f.id = (d->>'id')::uuid
    where f.shipment_id = s.id
    order by d->>'type', f.created_at desc, f.id desc
  ) chosen;
  snapshot := to_jsonb(s) - 'updated_at';
  return jsonb_build_object(
    'shipment', snapshot, 'files', files, 'generated', readiness->'generated',
    'fingerprint', md5(snapshot::text || files::text),
    'revisionNo', coalesce((select max(r.revision_no) from public.bsgt_operations_revisions r
      where r.shipment_id = s.id and r.approved_at is not null),0) + 1
  );
end;
$$;

create or replace function public.guard_bsgt_approved_operations_revision()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.approved_at is not null then
    raise exception 'Approved operations revisions are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists bsgt_operations_revision_immutable on public.bsgt_operations_revisions;
create trigger bsgt_operations_revision_immutable before update or delete
  on public.bsgt_operations_revisions for each row
  execute function public.guard_bsgt_approved_operations_revision();

create or replace function public.approve_bsgt_operations_revision(p_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  r public.bsgt_operations_revisions%rowtype;
  s public.shipments%rowtype;
  input jsonb;
  item jsonb;
  required_kinds text[];
  actual_kinds text[];
begin
  select * into r from public.bsgt_operations_revisions where id = p_revision_id;
  if not found or r.created_by is distinct from auth.uid() then
    raise exception 'Revision not available to this user';
  end if;
  select * into s from public.shipments where id = r.shipment_id for update;
  if r.approved_at is not null then
    if s.operations_revision_id = r.id then return to_jsonb(s); end if;
    raise exception 'Revision is no longer current';
  end if;
  input := public.bsgt_operations_package_input(s.id);
  if r.source_fingerprint is distinct from input->>'fingerprint'
     or r.revision_no <> (input->>'revisionNo')::integer then
    raise exception 'Shipment changed during merge; reload and merge again';
  end if;
  select array_agg(kind order by kind) into required_kinds from (
    select jsonb_object_keys(input->'generated') kind
    union all select f->>'kind' from jsonb_array_elements(input->'files') f
  ) kinds;
  select array_agg(d->>'kind' order by d->>'kind') into actual_kinds
    from jsonb_array_elements(r.documents) d;
  if required_kinds is distinct from actual_kinds then
    raise exception 'Revision document scope does not match operations requirements';
  end if;
  if r.package_path <> s.id::text || '/' || r.id::text || '/package.pdf'
     or not exists(select 1 from storage.objects where bucket_id = 'bsgt-operations-packages' and name = r.package_path) then
    raise exception 'Operations package upload is incomplete';
  end if;
  for item in select value from jsonb_array_elements(r.documents) loop
    if item->>'source' is distinct from 'operations'
       or item->>'path' is distinct from s.id::text || '/' || r.id::text || '/' || (item->>'kind') || '.pdf'
       or not exists(select 1 from storage.objects where bucket_id = 'bsgt-operations-packages' and name = item->>'path') then
      raise exception 'Operations document upload is incomplete';
    end if;
    if exists(select 1 from jsonb_array_elements(input->'files') f
      where f->>'kind' = item->>'kind' and f->>'id' is distinct from item->>'sourceId') then
      raise exception 'Operations source document does not match snapshot';
    end if;
  end loop;
  if jsonb_array_length(r.documents) < 1 then raise exception 'Empty package'; end if;
  update public.bsgt_operations_revisions set approved_at = now() where id = r.id;
  update public.shipments set operations_revision_id = r.id, bsgt_stage = 'ready_for_finance'
    where id = s.id returning * into s;
  insert into public.activity_log(user_id,type,text) values(auth.uid(),'edit',
    jsonb_build_object('action','operations_package_approved','shipment',s.id,
      'revision',r.revision_no,'actor',auth.uid(),'role',public.my_role(),
      'sentTo','finance','at',now())::text);
  return to_jsonb(s);
end;
$$;

create or replace function public.guard_bsgt_operations_revision_pointer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.operations_revision_id is not null then
      raise exception 'An operations revision cannot be supplied on shipment creation';
    end if;
    return new;
  end if;
  if new.operations_revision_id is distinct from old.operations_revision_id then
    if new.operations_revision_id is null or not exists (
      select 1 from public.bsgt_operations_revisions r
      where r.id = new.operations_revision_id and r.shipment_id = new.id
        and r.approved_at = now() and r.created_by = auth.uid()
    ) then raise exception 'Operations revision can only change through approval'; end if;
  end if;
  if old.operations_revision_id is not null then
    if new.data->>'qrToken' is distinct from old.data->>'qrToken'
       or new.data->>'qrPackagePath' is distinct from old.data->>'qrPackagePath' then
      raise exception 'QR belongs to the approved operations revision';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists shipments_guard_operations_revision_pointer on public.shipments;
create trigger shipments_guard_operations_revision_pointer before insert or update on public.shipments
  for each row execute function public.guard_bsgt_operations_revision_pointer();

revoke all on function public.bsgt_operations_package_input(uuid) from public,anon;
revoke all on function public.approve_bsgt_operations_revision(uuid) from public,anon;
grant execute on function public.bsgt_operations_package_input(uuid) to authenticated;
grant execute on function public.approve_bsgt_operations_revision(uuid) to authenticated;
revoke all on function public.guard_bsgt_approved_operations_revision() from public,anon,authenticated;
revoke all on function public.guard_bsgt_operations_revision_pointer() from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
