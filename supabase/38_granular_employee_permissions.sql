-- Granular employee permissions for Jahez.
-- Additive and backward-compatible: legacy portal/workspace assignments remain.

create table if not exists public.feature_permission_catalog (
  permission_key text primary key,
  group_key text not null,
  label_ar text not null,
  depends_on text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

insert into public.feature_permission_catalog (permission_key, group_key, label_ar, depends_on)
values
  ('operations_center.view','general','مركز العمليات','{}'),
  ('shipments.create','general','إنشاء شحنة','{}'),
  ('shipments.edit','general','تعديل الشحنات','{}'),
  ('shipments.delete','general','حذف الشحنات','{}'),
  ('client_profiles.view','general','بروفايل الشركات','{}'),
  ('client_profiles.edit','general','تعديل بروفايل الشركات','{client_profiles.view}'),
  ('import_permit.view','portals','فاتورة إذن الاستيراد','{}'),
  ('commercial_collection.view','portals','بوابة التحصيل التجاري','{}'),
  ('bsgt.operations.view','bsgt','عرض مرحلة العمليات','{}'),
  ('bsgt.operations.edit','bsgt','تعديل مرحلة العمليات','{bsgt.operations.view}'),
  ('bsgt.operation_center.view','bsgt','مركز عمليات BSGT','{}'),
  ('bsgt.finance.view','bsgt','عرض المالية','{}'),
  ('bsgt.finance.edit','bsgt','تعديل المالية','{bsgt.finance.view}'),
  ('bsgt.management.view','bsgt','عرض الإدارة','{}'),
  ('bsgt.management.edit','bsgt','تعديل واعتماد الإدارة','{bsgt.management.view}'),
  ('bsgt.relations.view','bsgt','عرض العلاقات التجارية','{}'),
  ('bsgt.relations.edit','bsgt','تعديل العلاقات التجارية','{bsgt.relations.view}'),
  ('shipment_documents.delete','sensitive','حذف مستند مرفوع','{}'),
  ('package.merge','sensitive','دمج الحزمة','{}'),
  ('contracts.edit','sensitive','تعديل العقود','{}'),
  ('client_assets.use','sensitive','استخدام أختام وتوقيعات العملاء','{}')
on conflict (permission_key) do update set
  group_key = excluded.group_key,
  label_ar = excluded.label_ar,
  depends_on = excluded.depends_on;

create table if not exists public.user_feature_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_feature_permissions_user_key unique (user_id, permission_key)
);

create index if not exists user_feature_permissions_user_idx
  on public.user_feature_permissions(user_id);
create index if not exists user_feature_permissions_key_idx
  on public.user_feature_permissions(permission_key);

drop trigger if exists user_feature_permissions_touch on public.user_feature_permissions;
create trigger user_feature_permissions_touch
  before update on public.user_feature_permissions
  for each row execute function public.touch_updated_at();

alter table public.feature_permission_catalog enable row level security;
alter table public.user_feature_permissions enable row level security;

drop policy if exists feature_permission_catalog_read on public.feature_permission_catalog;
create policy feature_permission_catalog_read on public.feature_permission_catalog
  for select to authenticated using (public.is_active());

drop policy if exists user_feature_permissions_select on public.user_feature_permissions;
create policy user_feature_permissions_select on public.user_feature_permissions
  for select to authenticated using (public.is_admin() or user_id = auth.uid());

drop policy if exists user_feature_permissions_admin_insert on public.user_feature_permissions;
create policy user_feature_permissions_admin_insert on public.user_feature_permissions
  for insert to authenticated with check (public.is_admin());

drop policy if exists user_feature_permissions_admin_update on public.user_feature_permissions;
create policy user_feature_permissions_admin_update on public.user_feature_permissions
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists user_feature_permissions_admin_delete on public.user_feature_permissions;
create policy user_feature_permissions_admin_delete on public.user_feature_permissions
  for delete to authenticated using (public.is_admin());

-- Preserve all current portal access.
insert into public.user_feature_permissions (user_id, permission_key, allowed)
select permission.user_id, permission.portal_key || '.view', permission.can_view
from public.user_portal_permissions permission
join public.profiles profile on profile.id = permission.user_id
where profile.active and profile.role <> 'admin'
on conflict (user_id, permission_key) do nothing;

-- Preserve all current BSGT workspace access.
insert into public.user_feature_permissions (user_id, permission_key, allowed)
select permission.user_id, 'bsgt.' || permission.section || '.view', permission.can_view
from public.bsgt_workspace_permissions permission
join public.profiles profile on profile.id = permission.user_id
where profile.active and profile.role <> 'admin'
on conflict (user_id, permission_key) do nothing;

insert into public.user_feature_permissions (user_id, permission_key, allowed)
select permission.user_id, 'bsgt.' || permission.section || '.edit', true
from public.bsgt_workspace_permissions permission
join public.profiles profile on profile.id = permission.user_id
where permission.can_edit and profile.active
  and profile.role in ('editor','staff','bsgt_user')
on conflict (user_id, permission_key) do nothing;

-- Existing operations viewers keep access to the BSGT operations center.
insert into public.user_feature_permissions (user_id, permission_key, allowed)
select permission.user_id, 'bsgt.operation_center.view', true
from public.bsgt_workspace_permissions permission
join public.profiles profile on profile.id = permission.user_id
where permission.section = 'operations' and permission.can_view
  and profile.active and profile.role <> 'admin'
on conflict (user_id, permission_key) do nothing;

-- Preserve role-based access that existed before granular assignments.
insert into public.user_feature_permissions (user_id, permission_key, allowed)
select profile.id, permission_key, true
from public.profiles profile
cross join lateral unnest(case
  when profile.role = 'editor' then array['operations_center.view','shipments.create','shipments.edit','shipments.delete','client_profiles.view','client_profiles.edit','shipment_documents.delete']::text[]
  when profile.role = 'staff' then array['shipments.create','shipments.edit','client_profiles.view']::text[]
  when profile.role = 'viewer' then array['operations_center.view','client_profiles.view']::text[]
  else array[]::text[]
end) permission_key
where profile.active and profile.role <> 'admin'
on conflict (user_id, permission_key) do nothing;

-- Existing operations editors could delete uploaded draft documents.
insert into public.user_feature_permissions (user_id, permission_key, allowed)
select permission.user_id, 'shipment_documents.delete', true
from public.bsgt_workspace_permissions permission
join public.profiles profile on profile.id = permission.user_id
where permission.section = 'operations' and permission.can_view and permission.can_edit
  and profile.active and profile.role <> 'admin'
on conflict (user_id, permission_key) do nothing;

-- Existing operations editors keep the contract tools they could already open.
insert into public.user_feature_permissions (user_id, permission_key, allowed)
select permission.user_id, key, true
from public.bsgt_workspace_permissions permission
join public.profiles profile on profile.id = permission.user_id
cross join unnest(array['contracts.edit','client_assets.use']) key
where permission.section = 'operations' and permission.can_view and permission.can_edit
  and profile.active and profile.role in ('editor','staff','bsgt_user')
on conflict (user_id, permission_key) do nothing;

-- Preserve the former client-side merge behavior for existing active employees.
insert into public.user_feature_permissions (user_id, permission_key, allowed)
select profile.id, 'package.merge', true
from public.profiles profile
where profile.active and profile.role <> 'admin'
on conflict (user_id, permission_key) do nothing;

create or replace function public.has_feature_permission(p_permission_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_assigned boolean;
  v_legacy boolean := false;
  v_section text;
  v_action text;
begin
  if not public.is_active() then return false; end if;
  if public.is_admin() then return true; end if;

  select permission.allowed into v_assigned
  from public.user_feature_permissions permission
  where permission.user_id = auth.uid()
    and permission.permission_key = p_permission_key;
  if found then return v_assigned; end if;

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
    return v_legacy and (v_action = 'view' or public.my_role() in ('editor','staff','bsgt_user'));
  end if;

  return false;
end;
$$;

create or replace function public.get_user_feature_permissions(p_user_id uuid default auth.uid())
returns table(permission_key text, allowed boolean)
language sql
stable
security definer
set search_path = public
as $$
  select permission.permission_key, permission.allowed
  from public.user_feature_permissions permission
  where permission.user_id = p_user_id
    and (p_user_id = auth.uid() or public.is_admin())
  order by permission.permission_key;
$$;

create or replace function public.set_user_feature_permissions(
  p_user_id uuid,
  p_permission_keys text[] default '{}'::text[]
)
returns table(permission_key text, allowed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_keys text[] := coalesce(p_permission_keys, '{}'::text[]);
  v_unknown text;
begin
  if not public.is_admin() then raise exception 'Admin permission is required'; end if;

  select profile.role into v_role from public.profiles profile where profile.id = p_user_id for update;
  if not found then raise exception 'User profile was not found'; end if;
  if v_role = 'admin' then raise exception 'Admin full access cannot be changed'; end if;

  select key into v_unknown
  from unnest(v_keys) key
  left join public.feature_permission_catalog catalog on catalog.permission_key = key
  where catalog.permission_key is null
  limit 1;
  if v_unknown is not null then raise exception 'Unknown permission key: %', v_unknown; end if;

  -- Edit permissions always imply their view dependencies.
  select coalesce(array_agg(distinct key), '{}'::text[]) into v_keys
  from (
    select unnest(v_keys) key
    union
    select unnest(catalog.depends_on) key
    from public.feature_permission_catalog catalog
    where catalog.permission_key = any(v_keys)
  ) normalized;

  insert into public.user_feature_permissions (user_id, permission_key, allowed)
  select p_user_id, catalog.permission_key, catalog.permission_key = any(v_keys)
  from public.feature_permission_catalog catalog
  on conflict (user_id, permission_key) do update
    set allowed = excluded.allowed, updated_at = now();

  -- Keep legacy adapters synchronized until they can be retired safely.
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
$$;

-- Existing BSGT RPCs now share the central permission decision.
create or replace function public.has_bsgt_workspace_permission(
  p_section text,
  p_require_edit boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_feature_permission(
    'bsgt.' || p_section || case when p_require_edit then '.edit' else '.view' end
  );
$$;

-- Targeted shipment policies retain ownership/role/workflow rules and add feature gates.
drop policy if exists shipments_insert on public.shipments;
create policy shipments_insert on public.shipments
  for insert to authenticated with check (
    public.is_active() and owner_id = auth.uid() and (
      public.has_feature_permission('shipments.create')
      or (company_id = public.bsgt_company_id() and public.has_feature_permission('bsgt.operations.edit'))
    )
  );

drop policy if exists shipments_update on public.shipments;
create policy shipments_update on public.shipments
  for update to authenticated
  using (
    public.is_active() and (
      public.is_admin()
      or (owner_id = auth.uid() and public.has_feature_permission('shipments.edit'))
      or (company_id = public.bsgt_company_id() and public.has_feature_permission('bsgt.operations.edit'))
    )
  )
  with check (
    public.is_admin()
    or (owner_id = auth.uid() and public.has_feature_permission('shipments.edit'))
    or (company_id = public.bsgt_company_id() and public.has_feature_permission('bsgt.operations.edit'))
  );

drop policy if exists shipments_delete on public.shipments;
create policy shipments_delete on public.shipments
  for delete to authenticated using (
    public.is_active()
    and public.has_feature_permission('shipments.delete')
    and (public.is_admin() or owner_id = auth.uid())
  );

-- Client profile metadata and private assets are protected server-side.
drop policy if exists client_signatories_read on public.client_authorized_signatories;
create policy client_signatories_read on public.client_authorized_signatories
  for select to authenticated using (public.has_feature_permission('client_profiles.view'));
drop policy if exists client_signatories_insert on public.client_authorized_signatories;
create policy client_signatories_insert on public.client_authorized_signatories
  for insert to authenticated with check (public.has_feature_permission('client_profiles.edit') and created_by = auth.uid());
drop policy if exists client_signatories_update on public.client_authorized_signatories;
create policy client_signatories_update on public.client_authorized_signatories
  for update to authenticated using (public.has_feature_permission('client_profiles.edit')) with check (public.has_feature_permission('client_profiles.edit'));

drop policy if exists client_profile_files_read on public.client_profile_files;
create policy client_profile_files_read on public.client_profile_files
  for select to authenticated using (public.has_feature_permission('client_profiles.view'));
drop policy if exists client_profile_files_insert on public.client_profile_files;
create policy client_profile_files_insert on public.client_profile_files
  for insert to authenticated with check (public.has_feature_permission('client_profiles.edit') and uploaded_by = auth.uid());
drop policy if exists client_profile_files_update on public.client_profile_files;
create policy client_profile_files_update on public.client_profile_files
  for update to authenticated using (public.has_feature_permission('client_profiles.edit')) with check (public.has_feature_permission('client_profiles.edit'));

drop policy if exists client_profile_storage_read on storage.objects;
create policy client_profile_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'client-profile-files'
    and public.has_feature_permission('client_profiles.view')
    and exists (select 1 from public.clients client where client.id::text = (storage.foldername(storage.objects.name))[1])
  );
drop policy if exists client_profile_storage_insert on storage.objects;
create policy client_profile_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'client-profile-files'
    and public.has_feature_permission('client_profiles.edit')
    and (storage.foldername(name))[2] in ('logo','letterhead','stamp','signature','trade_license','registration_certificate','tax_certificate','bank_document','other')
    and exists (select 1 from public.clients client where client.id::text = (storage.foldername(storage.objects.name))[1])
  );
drop policy if exists client_profile_storage_update on storage.objects;
create policy client_profile_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'client-profile-files' and public.has_feature_permission('client_profiles.edit'))
  with check (bucket_id = 'client-profile-files' and public.has_feature_permission('client_profiles.edit'));
drop policy if exists client_profile_storage_delete on storage.objects;
create policy client_profile_storage_delete on storage.objects
  for delete to authenticated using (bucket_id = 'client-profile-files' and public.has_feature_permission('client_profiles.edit'));

-- Uploaded BSGT document deletion requires both operations edit and the sensitive permission.
drop policy if exists shipmentfiles_delete on public.shipment_files;
create policy shipmentfiles_delete on public.shipment_files
  for delete to authenticated using (
    public.is_active() and exists (
      select 1 from public.shipments shipment
      where shipment.id = shipment_id
        and case
          when shipment.company_id = public.bsgt_company_id()
               and public.is_bsgt_operations_uploaded_document(document_type, label)
            then shipment.bsgt_stage = 'operations_draft'
                 and public.has_feature_permission('bsgt.operations.edit')
                 and public.has_feature_permission('shipment_documents.delete')
          else public.has_feature_permission('shipment_documents.delete')
               and (
                 shipment.owner_id = auth.uid()
                 or public.is_admin()
                 or (shipment.company_id = public.bsgt_company_id()
                     and public.has_feature_permission('bsgt.operations.edit'))
               )
        end
    )
  );

drop policy if exists shipmentfiles_remove on storage.objects;
create policy shipmentfiles_remove on storage.objects
  for delete to authenticated using (
    bucket_id = 'shipment-files' and public.is_active() and (
      not exists (select 1 from public.shipment_files file where file.path = storage.objects.name)
      or exists (
        select 1 from public.shipment_files file
        join public.shipments shipment on shipment.id = file.shipment_id
        where file.path = storage.objects.name
          and case
            when shipment.company_id = public.bsgt_company_id()
                 and public.is_bsgt_operations_uploaded_document(file.document_type, file.label)
              then shipment.bsgt_stage = 'operations_draft'
                   and public.has_feature_permission('bsgt.operations.edit')
                   and public.has_feature_permission('shipment_documents.delete')
            else public.has_feature_permission('shipment_documents.delete')
                 and (
                   shipment.owner_id = auth.uid()
                   or public.is_admin()
                   or (shipment.company_id = public.bsgt_company_id()
                       and public.has_feature_permission('bsgt.operations.edit'))
                 )
          end
      )
    )
  );

create or replace function public.delete_bsgt_operations_document(p_shipment_id uuid, p_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.shipments%rowtype;
  v_file public.shipment_files%rowtype;
begin
  if not public.has_feature_permission('bsgt.operations.edit') then raise exception 'BSGT operations edit permission is required'; end if;
  if not public.has_feature_permission('shipment_documents.delete') then raise exception 'Shipment document delete permission is required'; end if;
  select * into v_shipment from public.shipments shipment
    where shipment.id = p_shipment_id and shipment.company_id = public.bsgt_company_id() for update;
  if not found then raise exception 'BSGT shipment was not found'; end if;
  if v_shipment.bsgt_stage <> 'operations_draft' then raise exception 'Shipment documents are read-only outside operations draft'; end if;
  select * into v_file from public.shipment_files file
    where file.id = p_file_id and file.shipment_id = p_shipment_id for update;
  if not found then raise exception 'Shipment document was not found'; end if;
  if not public.is_bsgt_operations_uploaded_document(v_file.document_type, v_file.label) then raise exception 'Only uploaded operations documents can be deleted'; end if;
  delete from public.shipment_files file where file.id = p_file_id and file.shipment_id = p_shipment_id;
  return to_jsonb(v_file);
end;
$$;

-- Contract editors can update only the BSGT contract-branding settings branch.
create or replace function public.save_bsgt_contract_branding(p_company_id uuid, p_contract_branding jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_settings jsonb;
begin
  if not public.has_feature_permission('contracts.edit') then raise exception 'Contract edit permission is required'; end if;
  if p_company_id is distinct from public.bsgt_company_id() then raise exception 'Contract editor is limited to the BSGT company'; end if;
  update public.companies company
  set settings = jsonb_set(coalesce(company.settings, '{}'::jsonb), '{contractBranding}', coalesce(p_contract_branding, '{}'::jsonb), true)
  where company.id = p_company_id
  returning company.settings into v_settings;
  if not found then raise exception 'BSGT company was not found'; end if;
  return v_settings;
end;
$$;

revoke all on public.feature_permission_catalog from anon;
revoke all on public.user_feature_permissions from anon;
grant select on public.feature_permission_catalog to authenticated;
grant select, insert, update, delete on public.user_feature_permissions to authenticated;
revoke all on function public.has_feature_permission(text) from public, anon;
revoke all on function public.get_user_feature_permissions(uuid) from public, anon;
revoke all on function public.set_user_feature_permissions(uuid, text[]) from public, anon;
revoke all on function public.save_bsgt_contract_branding(uuid, jsonb) from public, anon;
grant execute on function public.has_feature_permission(text) to authenticated;
grant execute on function public.get_user_feature_permissions(uuid) to authenticated;
grant execute on function public.set_user_feature_permissions(uuid, text[]) to authenticated;
grant execute on function public.save_bsgt_contract_branding(uuid, jsonb) to authenticated;

comment on table public.user_feature_permissions is 'Granular employee feature assignments. Admin access is unconditional.';
notify pgrst, 'reload schema';
