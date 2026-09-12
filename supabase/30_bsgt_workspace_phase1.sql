-- ============================================================
-- BSGT Workspace - Phase 1 foundation only
-- Additive migration: permissions, trade files, and shipment links.
-- Does not migrate or modify legacy commercial-collection data.
-- ============================================================

create table if not exists public.bsgt_workspace_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  section text not null,
  can_view boolean not null default true,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  constraint bsgt_workspace_permissions_section_check
    check (section in ('operations', 'finance', 'management', 'relations')),
  constraint bsgt_workspace_permissions_user_section_key unique (user_id, section)
);

create index if not exists bsgt_workspace_permissions_user_idx
  on public.bsgt_workspace_permissions(user_id);

alter table public.bsgt_workspace_permissions enable row level security;

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
  select coalesce(
    public.is_active()
    and (
      public.is_admin()
      or exists (
        select 1
        from public.bsgt_workspace_permissions permission
        where permission.user_id = auth.uid()
          and permission.section = p_section
          and permission.can_view
          and (
            not p_require_edit
            or (
              permission.can_edit
              and public.my_role() in ('editor', 'staff', 'bsgt_user')
            )
          )
      )
    ),
    false
  );
$$;

create or replace function public.get_bsgt_workspace_permissions(
  p_user_id uuid default auth.uid()
)
returns table(section text, can_view boolean, can_edit boolean)
language sql
stable
security definer
set search_path = public
as $$
  select allowed.section, true, true
  from (values ('operations'), ('finance'), ('management'), ('relations')) allowed(section)
  where public.is_admin() and p_user_id = auth.uid()

  union all

  select permission.section,
         permission.can_view,
         permission.can_edit and profile.role in ('editor', 'staff', 'bsgt_user')
  from public.bsgt_workspace_permissions permission
  join public.profiles profile on profile.id = permission.user_id
  where permission.user_id = p_user_id
    and profile.active
    and permission.can_view
    and (p_user_id = auth.uid() or public.is_admin())
    and not (public.is_admin() and p_user_id = auth.uid());
$$;

drop policy if exists bsgt_workspace_permissions_select on public.bsgt_workspace_permissions;
create policy bsgt_workspace_permissions_select on public.bsgt_workspace_permissions
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists bsgt_workspace_permissions_admin_insert on public.bsgt_workspace_permissions;
create policy bsgt_workspace_permissions_admin_insert on public.bsgt_workspace_permissions
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists bsgt_workspace_permissions_admin_update on public.bsgt_workspace_permissions;
create policy bsgt_workspace_permissions_admin_update on public.bsgt_workspace_permissions
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists bsgt_workspace_permissions_admin_delete on public.bsgt_workspace_permissions;
create policy bsgt_workspace_permissions_admin_delete on public.bsgt_workspace_permissions
  for delete to authenticated
  using (public.is_admin());

create sequence if not exists public.trade_collection_operation_seq as bigint start with 1;

create or replace function public.next_trade_collection_operation_no()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select 'TC-' || to_char(current_date, 'YYYY') || '-' ||
         lpad(nextval('public.trade_collection_operation_seq')::text, 6, '0');
$$;

create table if not exists public.trade_collection_files (
  id uuid primary key default gen_random_uuid(),
  operation_no text not null default public.next_trade_collection_operation_no(),
  company_id uuid not null default public.bsgt_company_id()
    references public.companies(id) on delete restrict,
  status text not null default 'draft',
  created_by uuid not null default auth.uid()
    references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_to_remitting_at timestamptz,
  management_reviewed_at timestamptz,
  final_accepted_at timestamptz,
  sent_to_collecting_at timestamptz,
  remitting_bank text,
  collecting_bank text,
  metadata jsonb not null default '{}'::jsonb,
  constraint trade_collection_files_operation_no_key unique (operation_no),
  constraint trade_collection_files_operation_no_format_check
    check (operation_no ~ '^TC-[0-9]{4}-[0-9]{6}$'),
  constraint trade_collection_files_status_check
    check (status in (
      'draft',
      'sent_to_remitting',
      'under_management_review',
      'final_accepted',
      'sent_to_collecting'
    ))
);

create index if not exists trade_collection_files_company_idx
  on public.trade_collection_files(company_id);
create index if not exists trade_collection_files_status_idx
  on public.trade_collection_files(status);
create index if not exists trade_collection_files_created_idx
  on public.trade_collection_files(created_at desc);

drop trigger if exists trade_collection_files_touch on public.trade_collection_files;
create trigger trade_collection_files_touch
  before update on public.trade_collection_files
  for each row execute function public.touch_updated_at();

create or replace function public.enforce_bsgt_trade_collection_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bsgt_company_id uuid;
begin
  v_bsgt_company_id := public.bsgt_company_id();
  if v_bsgt_company_id is null then
    raise exception 'BSGT company could not be resolved';
  end if;
  if new.company_id is distinct from v_bsgt_company_id then
    raise exception 'Trade collection files must belong to the BSGT company';
  end if;
  return new;
end;
$$;

drop trigger if exists trade_collection_files_bsgt_company on public.trade_collection_files;
create trigger trade_collection_files_bsgt_company
  before insert or update of company_id on public.trade_collection_files
  for each row execute function public.enforce_bsgt_trade_collection_company();

alter table public.trade_collection_files enable row level security;

drop policy if exists trade_collection_files_select on public.trade_collection_files;
create policy trade_collection_files_select on public.trade_collection_files
  for select to authenticated
  using (
    company_id = public.bsgt_company_id()
    and public.has_bsgt_workspace_permission('finance', false)
  );

drop policy if exists trade_collection_files_insert on public.trade_collection_files;
create policy trade_collection_files_insert on public.trade_collection_files
  for insert to authenticated
  with check (
    company_id = public.bsgt_company_id()
    and created_by = auth.uid()
    and public.has_bsgt_workspace_permission('finance', true)
  );

drop policy if exists trade_collection_files_update on public.trade_collection_files;
create policy trade_collection_files_update on public.trade_collection_files
  for update to authenticated
  using (
    company_id = public.bsgt_company_id()
    and public.has_bsgt_workspace_permission('finance', true)
  )
  with check (
    company_id = public.bsgt_company_id()
    and public.has_bsgt_workspace_permission('finance', true)
  );

drop policy if exists trade_collection_files_delete on public.trade_collection_files;
create policy trade_collection_files_delete on public.trade_collection_files
  for delete to authenticated
  using (
    company_id = public.bsgt_company_id()
    and public.has_bsgt_workspace_permission('finance', true)
  );

create table if not exists public.trade_collection_file_shipments (
  id uuid primary key default gen_random_uuid(),
  trade_file_id uuid not null references public.trade_collection_files(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint trade_collection_file_shipments_unique unique (trade_file_id, shipment_id)
);

create index if not exists trade_collection_file_shipments_file_idx
  on public.trade_collection_file_shipments(trade_file_id);
create index if not exists trade_collection_file_shipments_shipment_idx
  on public.trade_collection_file_shipments(shipment_id);

create or replace function public.enforce_bsgt_trade_collection_shipment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bsgt_company_id uuid;
  v_shipment_company_id uuid;
  v_trade_company_id uuid;
begin
  v_bsgt_company_id := public.bsgt_company_id();
  select shipment.company_id into v_shipment_company_id
  from public.shipments shipment where shipment.id = new.shipment_id;
  select trade_file.company_id into v_trade_company_id
  from public.trade_collection_files trade_file where trade_file.id = new.trade_file_id;

  if v_bsgt_company_id is null
     or v_shipment_company_id is distinct from v_bsgt_company_id
     or v_trade_company_id is distinct from v_bsgt_company_id then
    raise exception 'Only BSGT shipments can be linked to BSGT trade collection files';
  end if;
  return new;
end;
$$;

drop trigger if exists trade_collection_file_shipments_bsgt_only
  on public.trade_collection_file_shipments;
create trigger trade_collection_file_shipments_bsgt_only
  before insert or update of trade_file_id, shipment_id
  on public.trade_collection_file_shipments
  for each row execute function public.enforce_bsgt_trade_collection_shipment();

alter table public.trade_collection_file_shipments enable row level security;

drop policy if exists trade_collection_file_shipments_select
  on public.trade_collection_file_shipments;
create policy trade_collection_file_shipments_select
  on public.trade_collection_file_shipments
  for select to authenticated
  using (
    public.has_bsgt_workspace_permission('finance', false)
    and exists (
      select 1 from public.trade_collection_files trade_file
      where trade_file.id = trade_file_id
        and trade_file.company_id = public.bsgt_company_id()
    )
  );

drop policy if exists trade_collection_file_shipments_insert
  on public.trade_collection_file_shipments;
create policy trade_collection_file_shipments_insert
  on public.trade_collection_file_shipments
  for insert to authenticated
  with check (
    public.has_bsgt_workspace_permission('finance', true)
    and exists (
      select 1 from public.trade_collection_files trade_file
      where trade_file.id = trade_file_id
        and trade_file.company_id = public.bsgt_company_id()
    )
    and exists (
      select 1 from public.shipments shipment
      where shipment.id = shipment_id
        and shipment.company_id = public.bsgt_company_id()
    )
  );

drop policy if exists trade_collection_file_shipments_delete
  on public.trade_collection_file_shipments;
create policy trade_collection_file_shipments_delete
  on public.trade_collection_file_shipments
  for delete to authenticated
  using (public.has_bsgt_workspace_permission('finance', true));

grant select, insert, update, delete on public.bsgt_workspace_permissions to authenticated;
grant select, insert, update, delete on public.trade_collection_files to authenticated;
grant select, insert, delete on public.trade_collection_file_shipments to authenticated;

revoke all on function public.next_trade_collection_operation_no() from public;
revoke all on function public.has_bsgt_workspace_permission(text, boolean) from public;
revoke all on function public.get_bsgt_workspace_permissions(uuid) from public;
grant execute on function public.next_trade_collection_operation_no() to authenticated;
grant execute on function public.has_bsgt_workspace_permission(text, boolean) to authenticated;
grant execute on function public.get_bsgt_workspace_permissions(uuid) to authenticated;

comment on table public.bsgt_workspace_permissions is
  'Section assignments for the BSGT workspace. Phase 1 foundation.';
comment on table public.trade_collection_files is
  'Independent BSGT trade collection files. Legacy collection records are intentionally not migrated.';
comment on table public.trade_collection_file_shipments is
  'Many-to-many links between BSGT trade files and BSGT shipments.';
