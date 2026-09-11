-- Client company profiles, document vault, and authorized signatories.
-- Additive only: public.clients remains the source of truth.

alter table public.clients add column if not exists name_ar text;
alter table public.clients add column if not exists name_en text;
alter table public.clients add column if not exists email text;
alter table public.clients add column if not exists address text;
alter table public.clients add column if not exists country text;
alter table public.clients add column if not exists trade_license_no text;
alter table public.clients add column if not exists tax_registration_no text;
alter table public.clients add column if not exists website text;
alter table public.clients add column if not exists updated_at timestamptz;

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

create table if not exists public.client_authorized_signatories (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  title text,
  phone text,
  email text,
  active boolean not null default true,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists client_signatories_client_idx
  on public.client_authorized_signatories(client_id, active, created_at desc);

drop trigger if exists client_signatories_touch on public.client_authorized_signatories;
create trigger client_signatories_touch before update on public.client_authorized_signatories
  for each row execute function public.touch_updated_at();

create table if not exists public.client_profile_files (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  file_type text not null check (file_type in (
    'logo', 'letterhead', 'stamp', 'signature', 'trade_license',
    'registration_certificate', 'tax_certificate', 'bank_document', 'other'
  )),
  title text,
  original_name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  description text,
  is_active boolean not null default true,
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  signatory_id uuid references public.client_authorized_signatories(id) on delete set null
);

create index if not exists client_profile_files_client_idx
  on public.client_profile_files(client_id, is_active, file_type, created_at desc);
create index if not exists client_profile_files_signatory_idx
  on public.client_profile_files(signatory_id)
  where signatory_id is not null;

create or replace function public.validate_client_profile_signatory()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.signatory_id is not null and new.file_type <> 'signature' then
    raise exception 'An authorized signatory can only be linked to a signature file';
  end if;

  if new.signatory_id is not null and not exists (
    select 1
    from public.client_authorized_signatories s
    where s.id = new.signatory_id
      and s.client_id = new.client_id
  ) then
    raise exception 'The authorized signatory must belong to the same client';
  end if;
  return new;
end;
$$;

drop trigger if exists client_profile_files_validate_signatory on public.client_profile_files;
create trigger client_profile_files_validate_signatory
  before insert or update of client_id, signatory_id on public.client_profile_files
  for each row execute function public.validate_client_profile_signatory();

drop trigger if exists client_profile_files_touch on public.client_profile_files;
create trigger client_profile_files_touch before update on public.client_profile_files
  for each row execute function public.touch_updated_at();

alter table public.client_authorized_signatories enable row level security;
alter table public.client_profile_files enable row level security;

drop policy if exists client_signatories_read on public.client_authorized_signatories;
create policy client_signatories_read on public.client_authorized_signatories
  for select to authenticated
  using (public.is_active() and public.my_role() in ('admin','editor','staff','viewer'));

drop policy if exists client_signatories_insert on public.client_authorized_signatories;
create policy client_signatories_insert on public.client_authorized_signatories
  for insert to authenticated
  with check (
    public.is_active()
    and public.my_role() in ('admin','editor')
    and created_by = auth.uid()
  );

drop policy if exists client_signatories_update on public.client_authorized_signatories;
create policy client_signatories_update on public.client_authorized_signatories
  for update to authenticated
  using (public.is_active() and public.my_role() in ('admin','editor'))
  with check (public.is_active() and public.my_role() in ('admin','editor'));

drop policy if exists client_profile_files_read on public.client_profile_files;
create policy client_profile_files_read on public.client_profile_files
  for select to authenticated
  using (public.is_active() and public.my_role() in ('admin','editor','staff','viewer'));

drop policy if exists client_profile_files_insert on public.client_profile_files;
create policy client_profile_files_insert on public.client_profile_files
  for insert to authenticated
  with check (
    public.is_active()
    and public.my_role() in ('admin','editor')
    and uploaded_by = auth.uid()
  );

drop policy if exists client_profile_files_update on public.client_profile_files;
create policy client_profile_files_update on public.client_profile_files
  for update to authenticated
  using (public.is_active() and public.my_role() in ('admin','editor'))
  with check (public.is_active() and public.my_role() in ('admin','editor'));

revoke all on public.client_authorized_signatories from anon;
revoke all on public.client_profile_files from anon;
grant select, insert, update on public.client_authorized_signatories to authenticated;
grant select, insert, update on public.client_profile_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-profile-files',
  'client-profile-files',
  false,
  15728640,
  array['image/png','image/jpeg','image/webp','application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists client_profile_storage_read on storage.objects;
create policy client_profile_storage_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-profile-files'
    and public.is_active()
    and public.my_role() in ('admin','editor','viewer')
    and exists (
      select 1 from public.clients c
      where c.id::text = (storage.foldername(storage.objects.name))[1]
    )
  );

drop policy if exists client_profile_storage_insert on storage.objects;
create policy client_profile_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-profile-files'
    and public.is_active()
    and public.my_role() in ('admin','editor')
    and (storage.foldername(name))[2] in (
      'logo', 'letterhead', 'stamp', 'signature', 'trade_license',
      'registration_certificate', 'tax_certificate', 'bank_document', 'other'
    )
    and exists (
      select 1 from public.clients c
      where c.id::text = (storage.foldername(storage.objects.name))[1]
    )
  );

drop policy if exists client_profile_storage_update on storage.objects;
create policy client_profile_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'client-profile-files'
    and public.is_active()
    and public.my_role() in ('admin','editor')
  )
  with check (
    bucket_id = 'client-profile-files'
    and public.is_active()
    and public.my_role() in ('admin','editor')
  );

-- Storage deletion is only used to roll back a failed upload. The UI archives
-- profile records and never exposes permanent deletion.
drop policy if exists client_profile_storage_delete on storage.objects;
create policy client_profile_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'client-profile-files'
    and public.is_active()
    and public.my_role() in ('admin','editor')
  );

notify pgrst, 'reload schema';
