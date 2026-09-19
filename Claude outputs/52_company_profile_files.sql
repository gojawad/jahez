-- Bahar Swaken company profile: document vault (stamps, signatures, letterhead,
-- logo, licences) with named signatories, mirroring the client profile vault.
-- Additive only: company settings, invoice/collection branding and every existing
-- template keep working unchanged; this vault is an extra signature source.
begin;

create table if not exists public.company_profile_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_type text not null check (file_type in (
    'logo', 'letterhead', 'stamp', 'signature', 'trade_license',
    'registration_certificate', 'tax_certificate', 'bank_document', 'other'
  )),
  title text,
  signatory_name text,
  original_name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  description text,
  is_active boolean not null default true,
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists company_profile_files_company_idx
  on public.company_profile_files(company_id, is_active, file_type, created_at desc);

drop trigger if exists company_profile_files_touch on public.company_profile_files;
create trigger company_profile_files_touch before update on public.company_profile_files
  for each row execute function public.touch_updated_at();

-- Read: anyone who can see client profiles or works in BSGT management (they sign).
create or replace function public.can_view_company_profile()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active() and (
    public.is_admin()
    or public.has_feature_permission('client_profiles.view')
    or public.has_bsgt_workspace_permission('management', false)
  )
$$;
revoke all on function public.can_view_company_profile() from public, anon;
grant execute on function public.can_view_company_profile() to authenticated;

alter table public.company_profile_files enable row level security;
drop policy if exists company_profile_files_read on public.company_profile_files;
create policy company_profile_files_read on public.company_profile_files
  for select to authenticated using (public.can_view_company_profile());
drop policy if exists company_profile_files_insert on public.company_profile_files;
create policy company_profile_files_insert on public.company_profile_files
  for insert to authenticated with check (public.is_active() and public.is_admin() and uploaded_by = auth.uid());
drop policy if exists company_profile_files_update on public.company_profile_files;
create policy company_profile_files_update on public.company_profile_files
  for update to authenticated using (public.is_active() and public.is_admin()) with check (public.is_active() and public.is_admin());
revoke all on public.company_profile_files from anon;
grant select, insert, update on public.company_profile_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-profile-files', 'company-profile-files', false, 15728640,
  array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists company_profile_storage_read on storage.objects;
create policy company_profile_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'company-profile-files' and public.can_view_company_profile()
    and exists (select 1 from public.companies c where c.id::text = (storage.foldername(storage.objects.name))[1])
  );
drop policy if exists company_profile_storage_insert on storage.objects;
create policy company_profile_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'company-profile-files' and public.is_active() and public.is_admin()
    and (storage.foldername(name))[2] in ('logo','letterhead','stamp','signature','trade_license','registration_certificate','tax_certificate','bank_document','other')
    and exists (select 1 from public.companies c where c.id::text = (storage.foldername(storage.objects.name))[1])
  );
drop policy if exists company_profile_storage_update on storage.objects;
create policy company_profile_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'company-profile-files' and public.is_active() and public.is_admin())
  with check (bucket_id = 'company-profile-files' and public.is_active() and public.is_admin());
drop policy if exists company_profile_storage_delete on storage.objects;
create policy company_profile_storage_delete on storage.objects
  for delete to authenticated using (bucket_id = 'company-profile-files' and public.is_active() and public.is_admin());

notify pgrst, 'reload schema';
commit;
