-- Fix permission saves after migration 39 without changing stored assignments.
-- The RPC returns permission_key, so its conflict target must name the unique
-- constraint explicitly to avoid PL/pgSQL output-column ambiguity.

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
  on conflict on constraint user_feature_permissions_user_key do update
    set allowed = excluded.allowed, updated_at = now();

  update public.profiles
  set feature_permissions_initialized = true
  where id = p_user_id;

  -- Keep the legacy adapters synchronized for archive/rollback compatibility.
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

revoke all on function public.set_user_feature_permissions(uuid, text[]) from public, anon;
grant execute on function public.set_user_feature_permissions(uuid, text[]) to authenticated;

notify pgrst, 'reload schema';
