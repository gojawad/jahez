-- Make granular feature permissions authoritative for initialized employees.
-- Legacy permission tables remain available only for accounts explicitly left uninitialized.

do $preflight$
begin
  if to_regclass('public.feature_permission_catalog') is null
     or to_regclass('public.user_feature_permissions') is null then
    raise exception 'Migration 38 must be applied before migration 39';
  end if;
end;
$preflight$;

alter table public.profiles
  add column if not exists feature_permissions_initialized boolean not null default true;

-- Migration 38 already copied existing access into user_feature_permissions.
-- Mark every existing profile initialized so runtime role/legacy grants cannot reappear.
update public.profiles
set feature_permissions_initialized = true
where feature_permissions_initialized is distinct from true;

create or replace function public.has_feature_permission(p_permission_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $permission$
declare
  v_role text;
  v_initialized boolean;
  v_assigned boolean;
  v_legacy boolean := false;
  v_section text;
  v_action text;
begin
  select profile.role, profile.feature_permissions_initialized
    into v_role, v_initialized
  from public.profiles profile
  where profile.id = auth.uid() and profile.active;

  if not found then return false; end if;
  if v_role = 'admin' then return true; end if;

  -- Viewer is a hard read-only account boundary in both UI and database helpers.
  if v_role = 'viewer' and p_permission_key in (
    'shipments.create', 'shipments.edit', 'shipments.delete',
    'client_profiles.edit',
    'bsgt.operations.edit', 'bsgt.finance.edit',
    'bsgt.management.edit', 'bsgt.relations.edit',
    'shipment_documents.delete', 'package.merge',
    'contracts.edit', 'client_assets.use'
  ) then
    return false;
  end if;

  select permission.allowed into v_assigned
  from public.user_feature_permissions permission
  where permission.user_id = auth.uid()
    and permission.permission_key = p_permission_key;
  if found then return v_assigned; end if;

  if coalesce(v_initialized, false) then return false; end if;

  -- Transitional fallback for a deliberately uninitialized legacy account only.
  if p_permission_key in ('import_permit.view', 'commercial_collection.view') then
    select coalesce(bool_or(permission.can_view), false) into v_legacy
    from public.user_portal_permissions permission
    where permission.user_id = auth.uid()
      and permission.portal_key = split_part(p_permission_key, '.', 1);
    return v_legacy;
  end if;

  if p_permission_key ~ '^bsgt\.(operations|finance|management|relations)\.(view|edit)$' then
    v_section := split_part(p_permission_key, '.', 2);
    v_action := split_part(p_permission_key, '.', 3);
    select coalesce(bool_or(permission.can_view and (v_action = 'view' or permission.can_edit)), false)
      into v_legacy
    from public.bsgt_workspace_permissions permission
    where permission.user_id = auth.uid() and permission.section = v_section;
    return v_legacy and (v_action = 'view' or v_role in ('editor','staff','bsgt_user'));
  end if;

  return false;
end;
$permission$;

create or replace function public.get_user_feature_permissions(p_user_id uuid default auth.uid())
returns table(permission_key text, allowed boolean)
language plpgsql
stable
security definer
set search_path = public
as $permission$
begin
  if auth.uid() is null then raise exception 'Authenticated session is required'; end if;
  if p_user_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Admin permission is required';
  end if;

  return query
  select permission.permission_key, permission.allowed
  from public.user_feature_permissions permission
  where permission.user_id = p_user_id
  order by permission.permission_key;
end;
$permission$;

create or replace function public.set_user_feature_permissions(
  p_user_id uuid,
  p_permission_keys text[] default '{}'::text[]
)
returns table(permission_key text, allowed boolean)
language plpgsql
security definer
set search_path = public
as $permission$
declare
  v_caller public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_keys text[] := coalesce(p_permission_keys, '{}'::text[]);
  v_unknown text;
  v_viewer_write text;
begin
  if auth.uid() is null then raise exception 'Admin session not recognized: authenticated session is required'; end if;

  select * into v_caller
  from public.profiles profile
  where profile.id = auth.uid();
  if not found then raise exception 'Admin session not recognized: profile was not found'; end if;
  if not v_caller.active then raise exception 'Admin session not recognized: profile is inactive'; end if;
  if v_caller.role <> 'admin' then raise exception 'Admin permission is required'; end if;

  select * into v_target
  from public.profiles profile
  where profile.id = p_user_id
  for update;
  if not found then raise exception 'User profile was not found'; end if;
  if v_target.role = 'admin' then raise exception 'Admin full access cannot be changed'; end if;

  select key into v_unknown
  from unnest(v_keys) key
  left join public.feature_permission_catalog catalog on catalog.permission_key = key
  where catalog.permission_key is null
  limit 1;
  if v_unknown is not null then raise exception 'Unknown permission key: %', v_unknown; end if;

  select coalesce(array_agg(distinct key), '{}'::text[]) into v_keys
  from (
    select unnest(v_keys) key
    union
    select unnest(catalog.depends_on) key
    from public.feature_permission_catalog catalog
    where catalog.permission_key = any(v_keys)
  ) normalized;

  if v_target.role = 'viewer' then
    select key into v_viewer_write
    from unnest(v_keys) key
    where key in (
      'shipments.create', 'shipments.edit', 'shipments.delete',
      'client_profiles.edit',
      'bsgt.operations.edit', 'bsgt.finance.edit',
      'bsgt.management.edit', 'bsgt.relations.edit',
      'shipment_documents.delete', 'package.merge',
      'contracts.edit', 'client_assets.use'
    )
    limit 1;
    if v_viewer_write is not null then
      raise exception 'Viewer accounts cannot receive write permission: %', v_viewer_write;
    end if;
  end if;

  insert into public.user_feature_permissions (user_id, permission_key, allowed)
  select p_user_id, catalog.permission_key, catalog.permission_key = any(v_keys)
  from public.feature_permission_catalog catalog
  on conflict (user_id, permission_key) do update
    set allowed = excluded.allowed, updated_at = now();

  update public.profiles
  set feature_permissions_initialized = true
  where id = p_user_id;

  -- Keep legacy tables synchronized for archive/rollback compatibility only.
  delete from public.user_portal_permissions where user_id = p_user_id;
  insert into public.user_portal_permissions (user_id, portal_key, can_view)
  select p_user_id, split_part(key, '.', 1), true
  from unnest(v_keys) key
  where key in ('import_permit.view','commercial_collection.view')
  on conflict (user_id, portal_key) do update set can_view = true;

  delete from public.bsgt_workspace_permissions where user_id = p_user_id;
  insert into public.bsgt_workspace_permissions (user_id, section, can_view, can_edit)
  select p_user_id, section, true, ('bsgt.' || section || '.edit') = any(v_keys)
  from unnest(array['operations','finance','management','relations']) section
  where ('bsgt.' || section || '.view') = any(v_keys)
  on conflict (user_id, section) do update
    set can_view = excluded.can_view, can_edit = excluded.can_edit;

  return query
  select permission.permission_key, permission.allowed
  from public.user_feature_permissions permission
  where permission.user_id = p_user_id
  order by permission.permission_key;
end;
$permission$;

-- Remove the old role-based BSGT read grant. Initialized employees can read
-- BSGT shipments only through an assigned feature permission.
drop policy if exists shipments_select on public.shipments;
create policy shipments_select on public.shipments
  for select to authenticated
  using (
    public.is_active() and (
      owner_id = auth.uid()
      or public.is_admin()
      or (
        company_id = public.bsgt_company_id()
        and (
          public.has_feature_permission('bsgt.operations.view')
          or public.has_feature_permission('bsgt.operation_center.view')
          or public.has_feature_permission('bsgt.finance.view')
          or public.has_feature_permission('bsgt.management.view')
          or public.has_feature_permission('bsgt.relations.view')
        )
      )
    )
  );

revoke all on function public.has_feature_permission(text) from public, anon;
revoke all on function public.get_user_feature_permissions(uuid) from public, anon;
revoke all on function public.set_user_feature_permissions(uuid, text[]) from public, anon;
grant execute on function public.has_feature_permission(text) to authenticated;
grant execute on function public.get_user_feature_permissions(uuid) to authenticated;
grant execute on function public.set_user_feature_permissions(uuid, text[]) to authenticated;

comment on column public.profiles.feature_permissions_initialized is
  'When true, user_feature_permissions is authoritative and legacy runtime fallback is disabled.';

notify pgrst, 'reload schema';
