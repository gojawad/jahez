-- Portal assignments are the source of truth for non-admin portal access.
-- Safe to run more than once. Existing access is backfilled before enforcement.

create table if not exists public.user_portal_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  portal_key text not null,
  can_view boolean not null default true,
  created_at timestamptz not null default now(),
  constraint user_portal_permissions_portal_key_check
    check (portal_key in ('import_permit', 'commercial_collection')),
  constraint user_portal_permissions_user_portal_key unique (user_id, portal_key)
);

create index if not exists user_portal_permissions_user_idx
  on public.user_portal_permissions(user_id);

alter table public.user_portal_permissions enable row level security;

drop policy if exists user_portal_permissions_select on public.user_portal_permissions;
create policy user_portal_permissions_select on public.user_portal_permissions
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists user_portal_permissions_admin_insert on public.user_portal_permissions;
create policy user_portal_permissions_admin_insert on public.user_portal_permissions
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists user_portal_permissions_admin_update on public.user_portal_permissions;
create policy user_portal_permissions_admin_update on public.user_portal_permissions
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists user_portal_permissions_admin_delete on public.user_portal_permissions;
create policy user_portal_permissions_admin_delete on public.user_portal_permissions
  for delete to authenticated
  using (public.is_admin());

insert into public.user_portal_permissions (user_id, portal_key, can_view)
select id, 'import_permit', true
from public.profiles
where role in ('editor', 'staff') and active
on conflict (user_id, portal_key) do nothing;

insert into public.user_portal_permissions (user_id, portal_key, can_view)
select id, 'commercial_collection', true
from public.profiles
where role = 'bsgt_user' and active
on conflict (user_id, portal_key) do nothing;

insert into public.user_portal_permissions (user_id, portal_key, can_view)
select distinct permission.user_id, 'commercial_collection', true
from public.bsgt_workspace_permissions permission
join public.profiles profile on profile.id = permission.user_id
where permission.section in ('finance', 'management', 'relations')
  and permission.can_view
  and profile.active
  and profile.role <> 'admin'
on conflict (user_id, portal_key) do nothing;

create or replace function public.get_user_portal_permissions(
  p_user_id uuid default auth.uid()
)
returns table (portal_key text, can_view boolean)
language sql
stable
security definer
set search_path = public
as $$
  select permission.portal_key, permission.can_view
  from public.user_portal_permissions permission
  where permission.user_id = p_user_id
    and (p_user_id = auth.uid() or public.is_admin());
$$;

revoke all on function public.get_user_portal_permissions(uuid) from public;
grant execute on function public.get_user_portal_permissions(uuid) to authenticated;
grant select, insert, update, delete on public.user_portal_permissions to authenticated;

comment on table public.user_portal_permissions is
  'Explicit portal assignments for non-admin users. Admin access is unconditional.';
