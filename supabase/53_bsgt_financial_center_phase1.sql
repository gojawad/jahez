-- BSGT Financial Center — Phase 1: one financial file per trade file, invoices,
-- states/approvals, append-only events, and independent permissions.
-- Approved design: report v4.1. Additive only: no existing table, function,
-- policy or data is modified. All writes go through the RPCs below; the tables
-- are select-only for the app role. Refuses to run on a partial schema.
-- Rollback script: see the commented block at the end of this file.
begin;

-- ===== 0) فحص مسبق: الكائنات يجب ألا تكون موجودة (بند 17) =====
do $$
declare v text;
begin
  foreach v in array array['bsgt_financial_files','bsgt_financial_file_invoices','bsgt_financial_file_events'] loop
    if to_regclass('public.' || v) is not null then
      raise exception 'Object public.% already exists — refusing to run a fresh phase-1 migration on a partial schema', v;
    end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname like 'bsgt_financial%') then
    raise exception 'Functions named bsgt_financial%% already exist — refusing to run';
  end if;
  if exists (select 1 from public.feature_permission_catalog where permission_key like 'bsgt.financial_center.%') then
    raise exception 'Financial center catalog keys already exist — refusing to run';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    raise exception 'pg_trgm extension is expected (installed by migration 22)';
  end if;
  -- كائنات فوق جداول قائمة: يجب أن تكون بأسماء مملوكة لهذه المرحلة وغير موجودة (v4.1-3)
  if to_regclass('public.bff_m53_tcf_operation_no_prefix_idx') is not null then
    raise exception 'Index bff_m53_tcf_operation_no_prefix_idx already exists — refusing to run';
  end if;
end $$;

-- ===== 1) الجداول والقيود =====
create table public.bsgt_financial_files (
  id uuid primary key default gen_random_uuid(),
  trade_file_id uuid not null references public.trade_collection_files(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  status text not null default 'draft',
  lock_version bigint not null default 1,
  consignee_snapshot text not null,
  consignee_count integer not null,
  client_id uuid references public.clients(id) on delete restrict,
  client_name_snapshot text,
  client_confirmed_at timestamptz,
  client_confirmed_by uuid references public.profiles(id) on delete restrict,
  invoice_total_usd numeric(24,6),
  documents_value_aed numeric(24,6),
  bank_tariff_per_1000_sdg numeric(24,6),
  bsgt_tariff_per_1000_sdg numeric(24,6),
  -- ÷ 1000 is applied as × 0.001: numeric multiplication is always exact (scale 6+6+3 = 15),
  -- whereas numeric division may round to its result scale.
  bank_cost_sdg numeric generated always as (invoice_total_usd * bank_tariff_per_1000_sdg * 0.001) stored,
  bsgt_commission_sdg numeric generated always as (invoice_total_usd * bsgt_tariff_per_1000_sdg * 0.001) stored,
  import_permit_source text,
  import_permit_cost_sdg numeric(24,6),
  import_permit_no text,
  import_permit_issued_at date,
  import_permit_expires_at date,
  import_permit_issuer text,
  client_total_sdg numeric generated always as (
    invoice_total_usd * bank_tariff_per_1000_sdg * 0.001
    + invoice_total_usd * bsgt_tariff_per_1000_sdg * 0.001
    + import_permit_cost_sdg) stored,
  calculation_ready boolean generated always as (
    invoice_total_usd is not null and bank_tariff_per_1000_sdg is not null
    and bsgt_tariff_per_1000_sdg is not null and import_permit_cost_sdg is not null) stored,
  last_input_at timestamptz not null default now(),
  last_input_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  approved_at timestamptz,           approved_by uuid references public.profiles(id) on delete restrict,
  client_transferred_at timestamptz, client_transferred_by uuid references public.profiles(id) on delete restrict,
  bank_paid_at timestamptz,          bank_paid_by uuid references public.profiles(id) on delete restrict,
  completed_at timestamptz,          completed_by uuid references public.profiles(id) on delete restrict,
  failed_at timestamptz,             failed_by uuid references public.profiles(id) on delete restrict,
  failure_reason text,
  refund_started_at timestamptz,     refund_started_by uuid references public.profiles(id) on delete restrict,
  refunded_at timestamptz,           refunded_by uuid references public.profiles(id) on delete restrict,
  closed_at timestamptz,             closed_by uuid references public.profiles(id) on delete restrict,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bff_trade_file_key unique (trade_file_id),
  constraint bff_status_check check (status in ('draft','pending_client_transfer','client_transferred',
    'bank_paid','completed','failed','refund_in_progress','refunded')),
  constraint bff_lock_version_check check (lock_version >= 1),
  constraint bff_consignee_count_check check (consignee_count >= 1),
  constraint bff_client_confirm_check check (
    (client_id is null and client_name_snapshot is null and client_confirmed_at is null and client_confirmed_by is null) or
    (client_id is not null and client_name_snapshot is not null and client_confirmed_at is not null and client_confirmed_by is not null)),
  constraint bff_amounts_check check (
    (invoice_total_usd is null or (invoice_total_usd >= 0 and invoice_total_usd < 'Infinity'::numeric and invoice_total_usd <> 'NaN'::numeric))
    and (documents_value_aed is null or (documents_value_aed >= 0 and documents_value_aed < 'Infinity'::numeric and documents_value_aed <> 'NaN'::numeric))
    and (bank_tariff_per_1000_sdg is null or (bank_tariff_per_1000_sdg >= 0 and bank_tariff_per_1000_sdg < 'Infinity'::numeric and bank_tariff_per_1000_sdg <> 'NaN'::numeric))
    and (bsgt_tariff_per_1000_sdg is null or (bsgt_tariff_per_1000_sdg >= 0 and bsgt_tariff_per_1000_sdg < 'Infinity'::numeric and bsgt_tariff_per_1000_sdg <> 'NaN'::numeric))
    and (import_permit_cost_sdg is null or (import_permit_cost_sdg < 'Infinity'::numeric and import_permit_cost_sdg <> 'NaN'::numeric))),
  constraint bff_permit_source_check check (import_permit_source is null or import_permit_source in ('client','bsgt')),
  constraint bff_permit_dates_check check (import_permit_issued_at is null or import_permit_expires_at is null or import_permit_expires_at >= import_permit_issued_at),
  -- null-safe: every branch yields true/false (a NULL check result would silently pass)
  constraint bff_permit_cost_check check (
    (import_permit_source is null and import_permit_cost_sdg is null) or
    (coalesce(import_permit_source, '') = 'client' and import_permit_cost_sdg is not null and import_permit_cost_sdg = 0) or
    (coalesce(import_permit_source, '') = 'bsgt' and import_permit_cost_sdg is not null and import_permit_cost_sdg > 0)),
  -- أزواج الأختام (بند 10)
  constraint bff_pair_approved   check ((approved_at is null) = (approved_by is null)),
  constraint bff_pair_client_tr  check ((client_transferred_at is null) = (client_transferred_by is null)),
  constraint bff_pair_bank_paid  check ((bank_paid_at is null) = (bank_paid_by is null)),
  constraint bff_pair_completed  check ((completed_at is null) = (completed_by is null)),
  constraint bff_pair_failed     check ((failed_at is null) = (failed_by is null) and (failed_at is null) = (failure_reason is null)),
  constraint bff_pair_refund_st  check ((refund_started_at is null) = (refund_started_by is null)),
  constraint bff_pair_refunded   check ((refunded_at is null) = (refunded_by is null)),
  constraint bff_pair_closed     check ((closed_at is null) = (closed_by is null)),
  -- الحالة ↔ الأختام (تسمح بالإخفاق من المسودة بلا اعتماد)
  constraint bff_state_stamps_check check (
    (status = 'draft' and approved_at is null and client_transferred_at is null and bank_paid_at is null
       and completed_at is null and failed_at is null and refund_started_at is null and refunded_at is null and closed_at is null)
    or (status = 'pending_client_transfer' and approved_at is not null and client_transferred_at is null and bank_paid_at is null and failed_at is null and closed_at is null)
    or (status = 'client_transferred' and approved_at is not null and client_transferred_at is not null and bank_paid_at is null and failed_at is null and closed_at is null)
    or (status = 'bank_paid' and approved_at is not null and client_transferred_at is not null and bank_paid_at is not null and completed_at is null and failed_at is null and closed_at is null)
    or (status = 'completed' and approved_at is not null and client_transferred_at is not null and bank_paid_at is not null and completed_at is not null and failed_at is null)
    or (status = 'failed' and failed_at is not null and refund_started_at is null and refunded_at is null
       and (closed_at is null or client_transferred_at is null))
    or (status = 'refund_in_progress' and failed_at is not null and client_transferred_at is not null and refund_started_at is not null and refunded_at is null and closed_at is null)
    or (status = 'refunded' and failed_at is not null and client_transferred_at is not null and refund_started_at is not null and refunded_at is not null))
);

create table public.bsgt_financial_file_invoices (
  id uuid primary key default gen_random_uuid(),
  financial_file_id uuid not null references public.bsgt_financial_files(id) on delete restrict,
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  invoice_no_snapshot text,
  currency_snapshot text,
  amount_source_text text,
  amount_usd numeric(24,6),
  amount_usd_basis text,
  amount_confirmed_at timestamptz,
  amount_confirmed_by uuid references public.profiles(id) on delete restrict,
  detached_at timestamptz,
  detached_by uuid references public.profiles(id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint bffi_shipment_key unique (financial_file_id, shipment_id),
  constraint bffi_amount_check check (amount_usd is null or (amount_usd >= 0 and amount_usd < 'Infinity'::numeric and amount_usd <> 'NaN'::numeric)),
  constraint bffi_confirm_check check (
    (amount_usd is null and amount_usd_basis is null and amount_confirmed_at is null and amount_confirmed_by is null) or
    (amount_usd is not null and amount_usd_basis is not null and amount_confirmed_at is not null and amount_confirmed_by is not null)),
  constraint bffi_detach_check check ((detached_at is null) = (detached_by is null))
);

create table public.bsgt_financial_file_events (
  id uuid primary key default gen_random_uuid(),
  financial_file_id uuid not null references public.bsgt_financial_files(id) on delete restrict,
  event_type text not null check (event_type in ('created','draft_updated','bank_details_updated','invoices_synced',
    'invoice_confirmed','client_confirmed','approved','reopened','client_transfer_confirmed','bank_payment_confirmed',
    'completed','failed','refund_started','refunded','closed')),
  from_status text,
  to_status text,
  lock_version_after bigint,
  actor_id uuid not null default auth.uid() references public.profiles(id) on delete restrict,
  note text,
  changes jsonb,
  created_at timestamptz not null default now()
);

-- ===== 2) الفهارس (قرار هـ) =====
create index bff_page_idx   on public.bsgt_financial_files (company_id, updated_at desc, id desc);
create index bff_status_idx on public.bsgt_financial_files (company_id, status, updated_at desc, id desc);
create index bff_client_idx on public.bsgt_financial_files (client_id);
create unique index bff_permit_no_uniq on public.bsgt_financial_files (upper(btrim(import_permit_no)))
  where import_permit_no is not null and btrim(import_permit_no) <> '';
create index bff_consignee_trgm   on public.bsgt_financial_files using gin (consignee_snapshot gin_trgm_ops);
create index bff_client_name_trgm on public.bsgt_financial_files using gin (client_name_snapshot gin_trgm_ops);
create index bff_permit_no_trgm   on public.bsgt_financial_files using gin (import_permit_no gin_trgm_ops);
create index bffi_file_active_idx on public.bsgt_financial_file_invoices (financial_file_id) where detached_at is null;
create index bffi_shipment_idx    on public.bsgt_financial_file_invoices (shipment_id);
create index bffe_file_idx        on public.bsgt_financial_file_events (financial_file_id, created_at desc);
create index bff_m53_tcf_operation_no_prefix_idx on public.trade_collection_files (operation_no text_pattern_ops); -- جدول قائم: فهرس مملوك لهذه المرحلة فقط (v4.1-3)

-- ===== 3) الصلاحية والمساعدات الداخلية =====
create function public.bsgt_financial_center_can(p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active() and p_action in ('view','edit','approve')
     and (public.is_admin()
          or (public.has_feature_permission('bsgt.financial_center.' || p_action)
              and (p_action = 'view' or public.my_role() <> 'viewer')));
$$;

-- رفض أي قيمة بأكثر من 6 خانات عشرية بدل تقريبها (بند 6)
create function public.bsgt_financial_scale6(p numeric, p_name text)
returns numeric language plpgsql immutable as $$
begin
  if p is null then return null; end if;
  if p = 'NaN'::numeric or p = 'Infinity'::numeric or p = '-Infinity'::numeric then
    raise exception '% must be a finite decimal (got %)', p_name, p;
  end if;
  if p <> round(p, 6) then raise exception '% has more than 6 decimal places (%); rounding is not allowed', p_name, p; end if;
  if p < 0 then raise exception '% must not be negative', p_name; end if;
  return p;
end $$;

-- JSON views: every money column is emitted as a *string* so JavaScript never parses it as a float.
create function public.bsgt_financial_file_json(f public.bsgt_financial_files)
returns jsonb language sql immutable as $$
  select to_jsonb(f) || jsonb_build_object(
    'invoice_total_usd', f.invoice_total_usd::text,
    'documents_value_aed', f.documents_value_aed::text,
    'bank_tariff_per_1000_sdg', f.bank_tariff_per_1000_sdg::text,
    'bsgt_tariff_per_1000_sdg', f.bsgt_tariff_per_1000_sdg::text,
    'bank_cost_sdg', f.bank_cost_sdg::text,
    'bsgt_commission_sdg', f.bsgt_commission_sdg::text,
    'import_permit_cost_sdg', f.import_permit_cost_sdg::text,
    'client_total_sdg', f.client_total_sdg::text);
$$;
create function public.bsgt_financial_invoice_json(i public.bsgt_financial_file_invoices)
returns jsonb language sql immutable as $$
  select to_jsonb(i) || jsonb_build_object('amount_usd', i.amount_usd::text);
$$;

-- إجمالي الفواتير النشطة المؤكدة (NULL إن بقيت واحدة غير مؤكدة أو لا فواتير نشطة)
create function public.bsgt_financial_total(p_file_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.bsgt_financial_file_invoices i where i.financial_file_id = p_file_id and i.detached_at is null) then null
    when exists (select 1 from public.bsgt_financial_file_invoices i where i.financial_file_id = p_file_id and i.detached_at is null and i.amount_usd is null) then null
    else (select sum(i.amount_usd) from public.bsgt_financial_file_invoices i where i.financial_file_id = p_file_id and i.detached_at is null) end;
$$;

-- أسماء المستلمين المميزة لشحنات TC الحالية (تُستخدم في الإنشاء والمزامنة والاعتماد) — v4.1-1
create function public.bsgt_financial_consignees(p_trade_file_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct nullif(btrim(s.data->>'consignee'),'') order by nullif(btrim(s.data->>'consignee'),'')), '{}')
    from public.trade_collection_file_shipments l join public.shipments s on s.id = l.shipment_id
   where l.trade_file_id = p_trade_file_id and nullif(btrim(s.data->>'consignee'),'') is not null;
$$;

-- الحارس: (v4.1-2) المقفل غير قابل لأي UPDATE؛ نسخة القفل +1؛ updated_by؛ تثبيت الأعمدة الثابتة؛ منع الحالة خارج الانتقال؛ قفل الحقول
create function public.bsgt_financial_files_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.closed_at is not null then
    raise exception 'Closed financial files are immutable';
  end if;
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  new.updated_at := now();
  new.lock_version := old.lock_version + 1;
  new.id := old.id; new.created_by := old.created_by; new.created_at := old.created_at;
  new.trade_file_id := old.trade_file_id; new.company_id := old.company_id;
  if coalesce(current_setting('jahez.financial_sync', true), '') <> 'on' then
    new.consignee_snapshot := old.consignee_snapshot; new.consignee_count := old.consignee_count;   -- تتغير فقط داخل المزامنة (v4.1-1)
  end if;
  if new.status is distinct from old.status and coalesce(current_setting('jahez.financial_transition', true), '') <> 'on' then
    raise exception 'Status changes only through transition_bsgt_financial_file()';
  end if;
  if old.status <> 'draft' and (
       new.invoice_total_usd is distinct from old.invoice_total_usd
    or new.bank_tariff_per_1000_sdg is distinct from old.bank_tariff_per_1000_sdg
    or new.bsgt_tariff_per_1000_sdg is distinct from old.bsgt_tariff_per_1000_sdg
    or new.import_permit_source is distinct from old.import_permit_source
    or new.import_permit_cost_sdg is distinct from old.import_permit_cost_sdg
    or new.client_id is distinct from old.client_id
    or new.client_name_snapshot is distinct from old.client_name_snapshot) then
    raise exception 'Financial values are locked after approval; reopen the file first';
  end if;
  if old.status in ('bank_paid','completed','failed','refund_in_progress','refunded') and (
       new.documents_value_aed is distinct from old.documents_value_aed
    or new.import_permit_no is distinct from old.import_permit_no
    or new.import_permit_issued_at is distinct from old.import_permit_issued_at
    or new.import_permit_expires_at is distinct from old.import_permit_expires_at
    or new.import_permit_issuer is distinct from old.import_permit_issuer) then
    raise exception 'Bank details are locked after bank payment';
  end if;
  return new;
end $$;
create trigger bff_guard before update on public.bsgt_financial_files for each row execute function public.bsgt_financial_files_guard();

create function public.bsgt_financial_file_events_readonly()
returns trigger language plpgsql as $$ begin raise exception 'Financial events are append-only'; end $$;
create trigger bffe_readonly before update or delete on public.bsgt_financial_file_events
  for each row execute function public.bsgt_financial_file_events_readonly();

create function public.bsgt_financial_lock(p_id uuid, p_expected_lock_version bigint, p_allowed_statuses text[])
returns public.bsgt_financial_files language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype;
begin
  select * into f from public.bsgt_financial_files where id = p_id for update;
  if not found then raise exception 'Financial file not found'; end if;
  if p_expected_lock_version is null or f.lock_version <> p_expected_lock_version then
    raise exception 'Financial file version changed (expected %, current %); reload and retry', p_expected_lock_version, f.lock_version;
  end if;
  if f.closed_at is not null then raise exception 'Financial file is closed'; end if;
  if p_allowed_statuses is not null and not (f.status = any(p_allowed_statuses)) then
    raise exception 'Action not allowed in status %', f.status;
  end if;
  return f;
end $$;

create function public.bsgt_financial_log(p_id uuid, p_type text, p_from text, p_to text, p_note text, p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.bsgt_financial_file_events (financial_file_id, event_type, from_status, to_status, lock_version_after, note, changes)
  select p_id, p_type, p_from, p_to, f.lock_version, p_note, p_changes from public.bsgt_financial_files f where f.id = p_id;
end $$;

-- الأهلية: تُستدعى عند الإنشاء وعند الاعتماد (بند 4، قرار أ)
create function public.bsgt_financial_assert_eligible(p_trade_file_id uuid)
returns public.trade_collection_files language plpgsql security definer set search_path = public as $$
declare t public.trade_collection_files%rowtype; v_mode text;
begin
  select * into t from public.trade_collection_files where id = p_trade_file_id for update;
  if not found then raise exception 'Trade file not found'; end if;
  if t.company_id <> public.bsgt_company_id() then raise exception 'Trade file does not belong to BSGT'; end if;
  if t.archived_at is not null then raise exception 'Trade file is archived'; end if;
  if t.status not in ('draft','sent_to_remitting','under_management_review','final_accepted','sent_to_collecting') then
    raise exception 'Trade file status % is not eligible', t.status;
  end if;
  v_mode := t.metadata->>'collectionMode';
  if v_mode is not null and v_mode <> 'collection' then
    raise exception 'Only collection-mode trade files are eligible (mode: %)', v_mode;
  end if;
  if not exists (select 1 from public.trade_collection_file_shipments l where l.trade_file_id = p_trade_file_id) then
    raise exception 'Trade file has no shipments';
  end if;
  if exists (select 1 from public.trade_collection_file_shipments l join public.shipments s on s.id = l.shipment_id
             where l.trade_file_id = p_trade_file_id and public.bsgt_collection_mode(s.data) <> 'collection') then
    raise exception 'Trade file contains CAD / advance-payment shipments and is not eligible';
  end if;
  return t;
end $$;

-- ===== 4) الدوال العامة =====
-- 4.1 الإنشاء (idempotent) — بند 8: لا اشتراط صلاحيات الأقسام القديمة
create function public.create_bsgt_financial_file(p_trade_file_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.trade_collection_files%rowtype; f public.bsgt_financial_files%rowtype; v_names text[];
begin
  if not public.bsgt_financial_center_can('edit') then raise exception 'Financial center edit permission required'; end if;
  t := public.bsgt_financial_assert_eligible(p_trade_file_id);
  v_names := public.bsgt_financial_consignees(p_trade_file_id);
  if cardinality(v_names) = 0 then raise exception 'Trade file shipments have no consignee'; end if;
  insert into public.bsgt_financial_files (trade_file_id, company_id, consignee_snapshot, consignee_count)
    values (p_trade_file_id, t.company_id, array_to_string(v_names, ' | '), cardinality(v_names))
    on conflict (trade_file_id) do nothing returning * into f;
  if f.id is null then
    select * into f from public.bsgt_financial_files where trade_file_id = p_trade_file_id;
    return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'created', false);
  end if;
  insert into public.bsgt_financial_file_invoices (financial_file_id, shipment_id, invoice_no_snapshot, currency_snapshot, amount_source_text)
    select f.id, s.id, s.data->>'invoiceNo', s.data->>'currency', s.data->>'totalAmount'
      from public.trade_collection_file_shipments l join public.shipments s on s.id = l.shipment_id
     where l.trade_file_id = p_trade_file_id;
  perform public.bsgt_financial_log(f.id, 'created', null, 'draft', null, jsonb_build_object('consignees', v_names));
  return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'created', true);
end $$;

-- 4.2 تحديث المسودة (مصدر الإذن متسق — بند 12)
create function public.update_bsgt_financial_draft(p_id uuid, p_expected_lock_version bigint, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; n public.bsgt_financial_files%rowtype; v_key text; v_changes jsonb := '{}'::jsonb;
begin
  if not public.bsgt_financial_center_can('edit') then raise exception 'Financial center edit permission required'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Patch must be a JSON object'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('bank_tariff_per_1000_sdg','bsgt_tariff_per_1000_sdg','import_permit_source','import_permit_cost_sdg','notes') then
      raise exception 'Field % cannot be updated through update_bsgt_financial_draft', v_key;
    end if;
  end loop;
  f := public.bsgt_financial_lock(p_id, p_expected_lock_version, array['draft']);
  n := f;
  if p_patch ? 'bank_tariff_per_1000_sdg' then n.bank_tariff_per_1000_sdg := public.bsgt_financial_scale6((p_patch->>'bank_tariff_per_1000_sdg')::numeric, 'bank_tariff_per_1000_sdg'); end if;
  if p_patch ? 'bsgt_tariff_per_1000_sdg' then n.bsgt_tariff_per_1000_sdg := public.bsgt_financial_scale6((p_patch->>'bsgt_tariff_per_1000_sdg')::numeric, 'bsgt_tariff_per_1000_sdg'); end if;
  if p_patch ? 'notes' then n.notes := p_patch->>'notes'; end if;
  if p_patch ? 'import_permit_source' then
    n.import_permit_source := nullif(btrim(p_patch->>'import_permit_source'), '');
    if n.import_permit_source is null then n.import_permit_cost_sdg := null;
    elsif n.import_permit_source = 'client' then n.import_permit_cost_sdg := 0;
    elsif n.import_permit_source = 'bsgt' then
      if not (p_patch ? 'import_permit_cost_sdg') then raise exception 'Import permit cost is required in the same request when BSGT issues the permit'; end if;
      n.import_permit_cost_sdg := public.bsgt_financial_scale6((p_patch->>'import_permit_cost_sdg')::numeric, 'import_permit_cost_sdg');
      if n.import_permit_cost_sdg is null or n.import_permit_cost_sdg <= 0 then raise exception 'Import permit cost must be greater than zero when BSGT issues the permit'; end if;
    else raise exception 'Import permit source must be client or bsgt'; end if;
  elsif p_patch ? 'import_permit_cost_sdg' then
    if f.import_permit_source is null then raise exception 'Import permit cost cannot be set before the import permit source'; end if;
    if f.import_permit_source <> 'bsgt' then raise exception 'Import permit cost can only be set when the source is bsgt'; end if;
    n.import_permit_cost_sdg := public.bsgt_financial_scale6((p_patch->>'import_permit_cost_sdg')::numeric, 'import_permit_cost_sdg');
    if n.import_permit_cost_sdg is null or n.import_permit_cost_sdg <= 0 then raise exception 'Import permit cost must be greater than zero'; end if;
  end if;
  if n.bank_tariff_per_1000_sdg is distinct from f.bank_tariff_per_1000_sdg then v_changes := v_changes || jsonb_build_object('bank_tariff_per_1000_sdg', jsonb_build_array(f.bank_tariff_per_1000_sdg::text, n.bank_tariff_per_1000_sdg::text)); end if;
  if n.bsgt_tariff_per_1000_sdg is distinct from f.bsgt_tariff_per_1000_sdg then v_changes := v_changes || jsonb_build_object('bsgt_tariff_per_1000_sdg', jsonb_build_array(f.bsgt_tariff_per_1000_sdg::text, n.bsgt_tariff_per_1000_sdg::text)); end if;
  if n.import_permit_source is distinct from f.import_permit_source then v_changes := v_changes || jsonb_build_object('import_permit_source', jsonb_build_array(f.import_permit_source, n.import_permit_source)); end if;
  if n.import_permit_cost_sdg is distinct from f.import_permit_cost_sdg then v_changes := v_changes || jsonb_build_object('import_permit_cost_sdg', jsonb_build_array(f.import_permit_cost_sdg::text, n.import_permit_cost_sdg::text)); end if;
  if n.notes is distinct from f.notes then v_changes := v_changes || jsonb_build_object('notes', jsonb_build_object('changed', true)); end if;   -- بلا نص (v4.1-4)
  if v_changes = '{}'::jsonb then
    return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'changed', false);
  end if;
  update public.bsgt_financial_files set
    bank_tariff_per_1000_sdg = n.bank_tariff_per_1000_sdg, bsgt_tariff_per_1000_sdg = n.bsgt_tariff_per_1000_sdg,
    import_permit_source = n.import_permit_source, import_permit_cost_sdg = n.import_permit_cost_sdg, notes = n.notes,
    last_input_at = now(), last_input_by = auth.uid()
  where id = p_id returning * into f;                       -- UPDATE واحد ⇒ lock_version +1
  perform public.bsgt_financial_log(p_id, 'draft_updated', f.status, f.status, null, v_changes);
  return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'changed', true);
end $$;

-- 4.3 بيانات البنك والإذن (حتى ما قبل bank_paid) — بند 11 و13
create function public.update_bsgt_financial_bank_details(p_id uuid, p_expected_lock_version bigint, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; n public.bsgt_financial_files%rowtype; v_key text; v_changes jsonb := '{}'::jsonb;
begin
  if not public.bsgt_financial_center_can('edit') then raise exception 'Financial center edit permission required'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Patch must be a JSON object'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('import_permit_no','import_permit_issued_at','import_permit_expires_at','import_permit_issuer','documents_value_aed') then
      raise exception 'Field % cannot be updated through update_bsgt_financial_bank_details', v_key;
    end if;
  end loop;
  f := public.bsgt_financial_lock(p_id, p_expected_lock_version, array['draft','pending_client_transfer','client_transferred']);
  n := f;
  if p_patch ? 'import_permit_no' then
    if f.import_permit_source is null then raise exception 'Set the import permit source first'; end if;
    n.import_permit_no := nullif(btrim(p_patch->>'import_permit_no'), '');
  end if;
  if p_patch ? 'import_permit_issued_at'  then n.import_permit_issued_at  := nullif(btrim(coalesce(p_patch->>'import_permit_issued_at', '')), '')::date; end if;   -- الفراغ = NULL صراحةً (v4.1-5)
  if p_patch ? 'import_permit_expires_at' then n.import_permit_expires_at := nullif(btrim(coalesce(p_patch->>'import_permit_expires_at', '')), '')::date; end if;
  if n.import_permit_issued_at is not null and n.import_permit_expires_at is not null and n.import_permit_expires_at < n.import_permit_issued_at then
    raise exception 'Import permit expiry date (%) must not be before its issue date (%)', n.import_permit_expires_at, n.import_permit_issued_at;
  end if;
  if p_patch ? 'import_permit_issuer'     then n.import_permit_issuer     := nullif(btrim(p_patch->>'import_permit_issuer'), ''); end if;
  if p_patch ? 'documents_value_aed'      then n.documents_value_aed      := public.bsgt_financial_scale6((p_patch->>'documents_value_aed')::numeric, 'documents_value_aed'); end if;
  if n.import_permit_no is distinct from f.import_permit_no then v_changes := v_changes || jsonb_build_object('import_permit_no', jsonb_build_array(f.import_permit_no, n.import_permit_no)); end if;
  if n.import_permit_issued_at is distinct from f.import_permit_issued_at then v_changes := v_changes || jsonb_build_object('import_permit_issued_at', jsonb_build_array(f.import_permit_issued_at, n.import_permit_issued_at)); end if;
  if n.import_permit_expires_at is distinct from f.import_permit_expires_at then v_changes := v_changes || jsonb_build_object('import_permit_expires_at', jsonb_build_array(f.import_permit_expires_at, n.import_permit_expires_at)); end if;
  if n.import_permit_issuer is distinct from f.import_permit_issuer then v_changes := v_changes || jsonb_build_object('import_permit_issuer', jsonb_build_array(f.import_permit_issuer, n.import_permit_issuer)); end if;
  if n.documents_value_aed is distinct from f.documents_value_aed then v_changes := v_changes || jsonb_build_object('documents_value_aed', jsonb_build_array(f.documents_value_aed::text, n.documents_value_aed::text)); end if;
  if v_changes = '{}'::jsonb then
    return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'changed', false);
  end if;
  update public.bsgt_financial_files set
    import_permit_no = n.import_permit_no, import_permit_issued_at = n.import_permit_issued_at,
    import_permit_expires_at = n.import_permit_expires_at, import_permit_issuer = n.import_permit_issuer,
    documents_value_aed = n.documents_value_aed, last_input_at = now(), last_input_by = auth.uid()
  where id = p_id returning * into f;
  perform public.bsgt_financial_log(p_id, 'bank_details_updated', f.status, f.status, null, v_changes);
  return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'changed', true);
end $$;

-- 4.4 مزامنة الفواتير: added / detached / reattached — بند 3
create function public.sync_bsgt_financial_invoices(p_id uuid, p_expected_lock_version bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; v_added uuid[]; v_detached uuid[]; v_reattached uuid[]; v_names text[]; v_snapshot text; v_changes jsonb;
begin
  if not public.bsgt_financial_center_can('edit') then raise exception 'Financial center edit permission required'; end if;
  f := public.bsgt_financial_lock(p_id, p_expected_lock_version, array['draft']);
  with added as (
    insert into public.bsgt_financial_file_invoices (financial_file_id, shipment_id, invoice_no_snapshot, currency_snapshot, amount_source_text)
    select p_id, s.id, s.data->>'invoiceNo', s.data->>'currency', s.data->>'totalAmount'
      from public.trade_collection_file_shipments l join public.shipments s on s.id = l.shipment_id
     where l.trade_file_id = f.trade_file_id
       and not exists (select 1 from public.bsgt_financial_file_invoices i where i.financial_file_id = p_id and i.shipment_id = s.id)
    returning shipment_id)
  select coalesce(array_agg(shipment_id), '{}') into v_added from added;
  with re as (
    update public.bsgt_financial_file_invoices i
       set detached_at = null, detached_by = null,
           invoice_no_snapshot = s.data->>'invoiceNo', currency_snapshot = s.data->>'currency', amount_source_text = s.data->>'totalAmount',
           amount_usd = null, amount_usd_basis = null, amount_confirmed_at = null, amount_confirmed_by = null   -- يلزم تأكيد جديد
      from public.shipments s
     where i.financial_file_id = p_id and i.detached_at is not null and s.id = i.shipment_id
       and exists (select 1 from public.trade_collection_file_shipments l where l.trade_file_id = f.trade_file_id and l.shipment_id = i.shipment_id)
    returning i.shipment_id)
  select coalesce(array_agg(shipment_id), '{}') into v_reattached from re;
  with det as (
    update public.bsgt_financial_file_invoices i set detached_at = now(), detached_by = auth.uid()
     where i.financial_file_id = p_id and i.detached_at is null
       and not exists (select 1 from public.trade_collection_file_shipments l where l.trade_file_id = f.trade_file_id and l.shipment_id = i.shipment_id)
    returning i.shipment_id)
  select coalesce(array_agg(shipment_id), '{}') into v_detached from det;
  -- لقطة المستلمين من كل شحنات TC الحالية (v4.1-1)
  v_names := public.bsgt_financial_consignees(f.trade_file_id);
  if cardinality(v_names) = 0 then raise exception 'Trade file no longer has any shipment with a consignee; sync refused'; end if;
  v_snapshot := array_to_string(v_names, ' | ');
  if cardinality(v_added) = 0 and cardinality(v_detached) = 0 and cardinality(v_reattached) = 0
     and v_snapshot = f.consignee_snapshot and cardinality(v_names) = f.consignee_count then
    return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'changed', false,
                              'added', '[]'::jsonb, 'detached', '[]'::jsonb, 'reattached', '[]'::jsonb);
  end if;
  v_changes := jsonb_build_object('added', to_jsonb(v_added), 'detached', to_jsonb(v_detached), 'reattached', to_jsonb(v_reattached));
  if v_snapshot <> f.consignee_snapshot or cardinality(v_names) <> f.consignee_count then
    v_changes := v_changes || jsonb_build_object('consignee_snapshot', jsonb_build_array(f.consignee_snapshot, v_snapshot),
                                                 'consignee_count', jsonb_build_array(f.consignee_count, cardinality(v_names)));
  end if;
  perform set_config('jahez.financial_sync', 'on', true);
  update public.bsgt_financial_files
     set invoice_total_usd = public.bsgt_financial_total(p_id),
         consignee_snapshot = v_snapshot, consignee_count = cardinality(v_names),
         last_input_at = now(), last_input_by = auth.uid()
   where id = p_id returning * into f;                       -- UPDATE واحد
  perform set_config('jahez.financial_sync', 'off', true);
  perform public.bsgt_financial_log(p_id, 'invoices_synced', 'draft', 'draft', null, v_changes);
  return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'changed', true,
                            'added', to_jsonb(v_added), 'detached', to_jsonb(v_detached), 'reattached', to_jsonb(v_reattached));
end $$;

-- 4.5 تأكيد مبلغ فاتورة — بند 2 (مخرج يشمل الملف والنسخة) و5 (العملة) و6 (عدم التقريب)
create function public.confirm_bsgt_financial_invoice(p_invoice_id uuid, p_expected_lock_version bigint, p_amount_usd numeric, p_usd_basis text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv public.bsgt_financial_file_invoices%rowtype; old_inv public.bsgt_financial_file_invoices%rowtype; f public.bsgt_financial_files%rowtype; v_basis text; v_amount numeric; v_file_id uuid;
begin
  if not public.bsgt_financial_center_can('edit') then raise exception 'Financial center edit permission required'; end if;
  -- Lock order everywhere: the financial file row first, then its invoice rows. The invoice is
  -- re-read under lock so that a concurrent sync (which also locks the file first) cannot slip in between.
  select financial_file_id into v_file_id from public.bsgt_financial_file_invoices where id = p_invoice_id;
  if v_file_id is null then raise exception 'Invoice not found'; end if;
  f := public.bsgt_financial_lock(v_file_id, p_expected_lock_version, array['draft']);
  select * into inv from public.bsgt_financial_file_invoices where id = p_invoice_id and financial_file_id = f.id for update;
  if not found then raise exception 'Invoice not found'; end if;
  old_inv := inv;
  if inv.detached_at is not null then raise exception 'Detached invoice cannot be confirmed'; end if;
  if p_amount_usd is null then raise exception 'Confirmed USD amount is required'; end if;
  v_amount := public.bsgt_financial_scale6(p_amount_usd, 'amount_usd');
  if upper(btrim(coalesce(inv.currency_snapshot, ''))) = 'USD' then v_basis := 'source_usd';
  else
    if coalesce(btrim(p_usd_basis), '') = '' then
      raise exception 'Invoice currency is "%"; the basis of the USD value must be stated explicitly', coalesce(inv.currency_snapshot, '');
    end if;
    v_basis := btrim(p_usd_basis);
  end if;
  if inv.amount_usd is not distinct from v_amount and inv.amount_usd_basis is not distinct from v_basis then
    return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'changed', false, 'invoice', public.bsgt_financial_invoice_json(inv));
  end if;
  update public.bsgt_financial_file_invoices
     set amount_usd = v_amount, amount_usd_basis = v_basis, amount_confirmed_at = now(), amount_confirmed_by = auth.uid()
   where id = p_invoice_id returning * into inv;
  update public.bsgt_financial_files
     set invoice_total_usd = public.bsgt_financial_total(f.id), last_input_at = now(), last_input_by = auth.uid()
   where id = f.id returning * into f;                       -- UPDATE واحد
  perform public.bsgt_financial_log(f.id, 'invoice_confirmed', 'draft', 'draft', null, jsonb_build_object(   -- قبل/بعد (v4.1-4)
          'shipment_id', inv.shipment_id, 'invoice_id', inv.id,
          'amount_usd', jsonb_build_array(old_inv.amount_usd::text, inv.amount_usd::text),
          'amount_usd_basis', jsonb_build_array(old_inv.amount_usd_basis, inv.amount_usd_basis),
          'amount_confirmed_at', jsonb_build_array(old_inv.amount_confirmed_at, inv.amount_confirmed_at),
          'amount_confirmed_by', jsonb_build_array(old_inv.amount_confirmed_by, inv.amount_confirmed_by)));
  return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'changed', true, 'invoice', public.bsgt_financial_invoice_json(inv));
end $$;

-- 4.6 تأكيد العميل
create function public.confirm_bsgt_financial_client(p_id uuid, p_expected_lock_version bigint, p_client_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; o public.bsgt_financial_files%rowtype; v_name text;
begin
  if not public.bsgt_financial_center_can('edit') then raise exception 'Financial center edit permission required'; end if;
  select name into v_name from public.clients where id = p_client_id and active;
  if v_name is null then raise exception 'Client not found or inactive'; end if;
  f := public.bsgt_financial_lock(p_id, p_expected_lock_version, array['draft']);
  o := f;
  if f.client_id = p_client_id then
    return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'changed', false);
  end if;
  update public.bsgt_financial_files
     set client_id = p_client_id, client_name_snapshot = v_name, client_confirmed_at = now(), client_confirmed_by = auth.uid(),
         last_input_at = now(), last_input_by = auth.uid()
   where id = p_id returning * into f;
  perform public.bsgt_financial_log(p_id, 'client_confirmed', 'draft', 'draft', null, jsonb_build_object(   -- قبل/بعد (v4.1-4)
          'client_id', jsonb_build_array(o.client_id, f.client_id),
          'client_name_snapshot', jsonb_build_array(o.client_name_snapshot, f.client_name_snapshot)));
  return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'changed', true);
end $$;

-- 4.7 الانتقالات
create function public.transition_bsgt_financial_file(p_id uuid, p_expected_lock_version bigint, p_action text, p_note text default null, p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; t public.trade_collection_files%rowtype; v_from text; v_to text; v_event text; v_note text := p_note; v_uid uuid := auth.uid();
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  f := public.bsgt_financial_lock(p_id, p_expected_lock_version, null);   -- يرفض المقفل
  v_from := f.status;
  perform set_config('jahez.financial_transition', 'on', true);
  case
    when p_action = 'approve' and f.status = 'draft' then
      t := public.bsgt_financial_assert_eligible(f.trade_file_id);      -- إعادة فحص الأهلية (بند 4)
      if exists (select 1 from public.bsgt_financial_file_invoices i where i.financial_file_id = p_id and i.detached_at is null and i.amount_usd is null) then
        raise exception 'Unconfirmed invoice amounts remain'; end if;
      if f.invoice_total_usd is null or f.invoice_total_usd <= 0 then raise exception 'Confirmed invoice total must be positive'; end if;
      -- عضوية الفواتير = روابط TC: نفس العدد، لا تكرار، نفس المجموعة (v4.1-6)
      if (select count(*) from public.bsgt_financial_file_invoices where financial_file_id = p_id and detached_at is null)
         <> (select count(*) from public.trade_collection_file_shipments where trade_file_id = f.trade_file_id)
         or (select count(*) - count(distinct shipment_id) from public.bsgt_financial_file_invoices where financial_file_id = p_id and detached_at is null) <> 0
         or (select count(*) - count(distinct shipment_id) from public.trade_collection_file_shipments where trade_file_id = f.trade_file_id) <> 0
         or (select coalesce(array_agg(shipment_id order by shipment_id), '{}') from public.bsgt_financial_file_invoices where financial_file_id = p_id and detached_at is null)
         <> (select coalesce(array_agg(shipment_id order by shipment_id), '{}') from public.trade_collection_file_shipments where trade_file_id = f.trade_file_id) then
        raise exception 'Trade file shipments changed; run invoice sync before approval'; end if;
      -- لقطة المستلمين تمثل الشحنات الحالية (v4.1-1)
      if array_to_string(public.bsgt_financial_consignees(f.trade_file_id), ' | ') <> f.consignee_snapshot
         or cardinality(public.bsgt_financial_consignees(f.trade_file_id)) <> f.consignee_count then
        raise exception 'Consignee snapshot is stale; run invoice sync before approval'; end if;
      if f.bank_tariff_per_1000_sdg is null or f.bsgt_tariff_per_1000_sdg is null then raise exception 'Both tariffs are required'; end if;
      if f.import_permit_source is null then raise exception 'Import permit source is required'; end if;
      if f.import_permit_source = 'client' and coalesce(btrim(f.import_permit_no), '') = '' then raise exception 'Client-provided import permit number is required before approval'; end if;
      if f.client_id is null then raise exception 'Billing client must be confirmed'; end if;
      if not f.calculation_ready then raise exception 'Cost calculation is incomplete'; end if;
      if f.last_input_by = v_uid then                                    -- maker-checker (بند 1، قرار د)
        if not public.is_admin() or coalesce(btrim(p_override_reason), '') = '' then
          raise exception 'Maker-checker: the last person who entered financial data cannot approve it';
        end if;
        v_note := concat_ws(' | ', p_note, 'ADMIN OVERRIDE (maker-checker): ' || btrim(p_override_reason));
      end if;
      v_to := 'pending_client_transfer'; v_event := 'approved';
      update public.bsgt_financial_files set status = v_to, approved_at = now(), approved_by = v_uid where id = p_id returning * into f;
    when p_action = 'reopen' and f.status = 'pending_client_transfer' then
      v_to := 'draft'; v_event := 'reopened';
      update public.bsgt_financial_files set status = v_to, approved_at = null, approved_by = null where id = p_id returning * into f;
    when p_action = 'confirm_client_transfer' and f.status = 'pending_client_transfer' then
      v_to := 'client_transferred'; v_event := 'client_transfer_confirmed';
      update public.bsgt_financial_files set status = v_to, client_transferred_at = now(), client_transferred_by = v_uid where id = p_id returning * into f;
    when p_action = 'confirm_bank_payment' and f.status = 'client_transferred' then
      if coalesce(btrim(f.import_permit_no), '') = '' then raise exception 'Import permit number is required before bank payment'; end if;   -- قرار ب
      if f.documents_value_aed is null or f.documents_value_aed <= 0 then raise exception 'Bank documents value (AED) must be entered before bank payment'; end if;  -- بند 11
      v_to := 'bank_paid'; v_event := 'bank_payment_confirmed';
      update public.bsgt_financial_files set status = v_to, bank_paid_at = now(), bank_paid_by = v_uid where id = p_id returning * into f;
    when p_action = 'complete' and f.status = 'bank_paid' then
      select * into t from public.trade_collection_files where id = f.trade_file_id;
      if t.status <> 'sent_to_collecting' then raise exception 'Trade file must be sent to the collecting bank first'; end if;   -- قرار ج
      v_to := 'completed'; v_event := 'completed';
      update public.bsgt_financial_files set status = v_to, completed_at = now(), completed_by = v_uid where id = p_id returning * into f;
    when p_action = 'fail' and f.status in ('draft','pending_client_transfer','client_transferred','bank_paid') then
      if coalesce(btrim(p_note), '') = '' then raise exception 'Failure reason is required'; end if;
      v_to := 'failed'; v_event := 'failed';                             -- لا أختام اعتماد وهمية (بند 9)
      update public.bsgt_financial_files set status = v_to, failed_at = now(), failed_by = v_uid, failure_reason = btrim(p_note) where id = p_id returning * into f;
    when p_action = 'start_refund' and f.status = 'failed' and f.client_transferred_at is not null then
      v_to := 'refund_in_progress'; v_event := 'refund_started';
      update public.bsgt_financial_files set status = v_to, refund_started_at = now(), refund_started_by = v_uid where id = p_id returning * into f;
    when p_action = 'confirm_refund' and f.status = 'refund_in_progress' then
      v_to := 'refunded'; v_event := 'refunded';
      update public.bsgt_financial_files set status = v_to, refunded_at = now(), refunded_by = v_uid where id = p_id returning * into f;
    when p_action = 'close' and (f.status in ('completed','refunded') or (f.status = 'failed' and f.client_transferred_at is null)) then
      v_to := f.status; v_event := 'closed';
      update public.bsgt_financial_files set closed_at = now(), closed_by = v_uid where id = p_id returning * into f;
    else
      raise exception 'Transition % is not allowed from status %', p_action, f.status;
  end case;
  perform set_config('jahez.financial_transition', 'off', true);
  perform public.bsgt_financial_log(p_id, v_event, v_from, v_to, v_note, null);
  return jsonb_build_object('file', public.bsgt_financial_file_json(f), 'financial_file_id', f.id, 'lock_version', f.lock_version, 'event_type', v_event);
end $$;

-- 4.8 القائمة (definer، keyset فقط) — بند 7 و15
create function public.list_bsgt_financial_files(
  p_status text default null, p_search text default null, p_closed boolean default null,
  p_limit integer default 10, p_after_updated_at timestamptz default null, p_after_id uuid default null)
returns table (id uuid, trade_file_id uuid, operation_no text, trade_status text, trade_archived_at timestamptz,
  status text, closed_at timestamptz, consignee_snapshot text, consignee_count integer, client_id uuid, client_name_snapshot text,
  invoice_total_usd text, client_total_sdg text, calculation_ready boolean, lock_version bigint, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_search text := nullif(left(btrim(coalesce(p_search, '')), 64), ''); v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if not public.bsgt_financial_center_can('view') then raise exception 'Financial center view permission required'; end if;
  if (p_after_updated_at is null) <> (p_after_id is null) then raise exception 'Cursor requires both updated_at and id'; end if;
  return query
  select f.id, f.trade_file_id, t.operation_no, t.status, t.archived_at, f.status, f.closed_at, f.consignee_snapshot, f.consignee_count,
         f.client_id, f.client_name_snapshot, f.invoice_total_usd::text, f.client_total_sdg::text, f.calculation_ready, f.lock_version, f.updated_at
    from public.bsgt_financial_files f join public.trade_collection_files t on t.id = f.trade_file_id
   where f.company_id = public.bsgt_company_id()
     and (p_status is null or f.status = p_status)
     and (p_closed is null or (f.closed_at is not null) = p_closed)
     and (v_search is null
          or t.operation_no like upper(v_search) || '%'
          or f.consignee_snapshot ilike '%' || v_search || '%'
          or f.client_name_snapshot ilike '%' || v_search || '%'
          or f.import_permit_no ilike '%' || v_search || '%')
     and (p_after_updated_at is null or (f.updated_at, f.id) < (p_after_updated_at, p_after_id))
   order by f.updated_at desc, f.id desc
   limit v_limit;
end $$;

-- 4.9 ملفات TC المؤهلة للاختيار (definer، edit) — بند 8
create function public.list_bsgt_financial_eligible_trade_files(
  p_search text default null, p_limit integer default 10, p_after_created_at timestamptz default null, p_after_id uuid default null)
returns table (id uuid, operation_no text, status text, created_at timestamptz, shipment_count bigint, consignees text[])
language plpgsql stable security definer set search_path = public as $$
declare v_search text := nullif(left(btrim(coalesce(p_search, '')), 64), ''); v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if not public.bsgt_financial_center_can('edit') then raise exception 'Financial center edit permission required'; end if;
  if (p_after_created_at is null) <> (p_after_id is null) then raise exception 'Cursor requires both created_at and id'; end if;
  return query
  select t.id, t.operation_no, t.status, t.created_at,
         (select count(*) from public.trade_collection_file_shipments l where l.trade_file_id = t.id),
         (select coalesce(array_agg(distinct nullif(btrim(s.data->>'consignee'),'')), '{}')
            from public.trade_collection_file_shipments l join public.shipments s on s.id = l.shipment_id where l.trade_file_id = t.id)
    from public.trade_collection_files t
   where t.company_id = public.bsgt_company_id() and t.archived_at is null
     and t.status in ('draft','sent_to_remitting','under_management_review','final_accepted','sent_to_collecting')
     and (t.metadata->>'collectionMode' is null or t.metadata->>'collectionMode' = 'collection')
     and exists (select 1 from public.trade_collection_file_shipments l where l.trade_file_id = t.id)
     and not exists (select 1 from public.trade_collection_file_shipments l join public.shipments s on s.id = l.shipment_id
                      where l.trade_file_id = t.id and public.bsgt_collection_mode(s.data) <> 'collection')
     and not exists (select 1 from public.bsgt_financial_files f where f.trade_file_id = t.id)
     and (v_search is null or t.operation_no like upper(v_search) || '%')
     and (p_after_created_at is null or (t.created_at, t.id) < (p_after_created_at, p_after_id))
   order by t.created_at desc, t.id desc
   limit v_limit;
end $$;

-- ===== 5) الكتالوج =====
insert into public.feature_permission_catalog (permission_key, group_key, label_ar, depends_on) values
  ('bsgt.financial_center.view',    'bsgt', 'عرض المركز المالي',            '{}'),
  ('bsgt.financial_center.edit',    'bsgt', 'إدخال وتعديل الملفات المالية',  '{bsgt.financial_center.view}'),
  ('bsgt.financial_center.approve', 'bsgt', 'اعتماد وإقفال الملفات المالية', '{bsgt.financial_center.view,bsgt.financial_center.edit}');

-- ===== 6) RLS: select فقط =====
alter table public.bsgt_financial_files         enable row level security;
alter table public.bsgt_financial_file_invoices enable row level security;
alter table public.bsgt_financial_file_events   enable row level security;
create policy bff_select  on public.bsgt_financial_files         for select to authenticated using (public.bsgt_financial_center_can('view'));
create policy bffi_select on public.bsgt_financial_file_invoices for select to authenticated using (public.bsgt_financial_center_can('view'));
create policy bffe_select on public.bsgt_financial_file_events   for select to authenticated using (public.bsgt_financial_center_can('view'));

-- ===== 7) Grants / Revokes (بند 16) =====
revoke all on public.bsgt_financial_files, public.bsgt_financial_file_invoices, public.bsgt_financial_file_events from public, anon, authenticated;
grant select on public.bsgt_financial_files, public.bsgt_financial_file_invoices, public.bsgt_financial_file_events to authenticated;
-- المساعدات الداخلية: لا تنفيذ لأي دور
revoke all on function public.bsgt_financial_scale6(numeric, text) from public, anon, authenticated;
revoke all on function public.bsgt_financial_total(uuid) from public, anon, authenticated;
revoke all on function public.bsgt_financial_files_guard() from public, anon, authenticated;
revoke all on function public.bsgt_financial_file_events_readonly() from public, anon, authenticated;
revoke all on function public.bsgt_financial_lock(uuid, bigint, text[]) from public, anon, authenticated;
revoke all on function public.bsgt_financial_log(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.bsgt_financial_assert_eligible(uuid) from public, anon, authenticated;
revoke all on function public.bsgt_financial_consignees(uuid) from public, anon, authenticated;
revoke all on function public.bsgt_financial_file_json(public.bsgt_financial_files) from public, anon, authenticated;
revoke all on function public.bsgt_financial_invoice_json(public.bsgt_financial_file_invoices) from public, anon, authenticated;
-- الدوال العامة: authenticated فقط
revoke all on function public.bsgt_financial_center_can(text) from public, anon;
revoke all on function public.create_bsgt_financial_file(uuid) from public, anon;
revoke all on function public.update_bsgt_financial_draft(uuid, bigint, jsonb) from public, anon;
revoke all on function public.update_bsgt_financial_bank_details(uuid, bigint, jsonb) from public, anon;
revoke all on function public.sync_bsgt_financial_invoices(uuid, bigint) from public, anon;
revoke all on function public.confirm_bsgt_financial_invoice(uuid, bigint, numeric, text) from public, anon;
revoke all on function public.confirm_bsgt_financial_client(uuid, bigint, uuid) from public, anon;
revoke all on function public.transition_bsgt_financial_file(uuid, bigint, text, text, text) from public, anon;
revoke all on function public.list_bsgt_financial_files(text, text, boolean, integer, timestamptz, uuid) from public, anon;
revoke all on function public.list_bsgt_financial_eligible_trade_files(text, integer, timestamptz, uuid) from public, anon;
grant execute on function public.bsgt_financial_center_can(text) to authenticated;
grant execute on function public.create_bsgt_financial_file(uuid) to authenticated;
grant execute on function public.update_bsgt_financial_draft(uuid, bigint, jsonb) to authenticated;
grant execute on function public.update_bsgt_financial_bank_details(uuid, bigint, jsonb) to authenticated;
grant execute on function public.sync_bsgt_financial_invoices(uuid, bigint) to authenticated;
grant execute on function public.confirm_bsgt_financial_invoice(uuid, bigint, numeric, text) to authenticated;
grant execute on function public.confirm_bsgt_financial_client(uuid, bigint, uuid) to authenticated;
grant execute on function public.transition_bsgt_financial_file(uuid, bigint, text, text, text) to authenticated;
grant execute on function public.list_bsgt_financial_files(text, text, boolean, integer, timestamptz, uuid) to authenticated;
grant execute on function public.list_bsgt_financial_eligible_trade_files(text, integer, timestamptz, uuid) to authenticated;

-- ===== 8) التهيئة: لا منح جماعي. المدير عبر is_admin(). المحاسب/مدير المالية يدوياً من لوحة التحكم بعد التنفيذ. =====
notify pgrst, 'reload schema';
commit;

-- ===== 9) Rollback كامل (لا يمس أي كائن قائم) =====
-- begin;
-- drop function if exists public.list_bsgt_financial_eligible_trade_files(text,integer,timestamptz,uuid);
-- drop function if exists public.list_bsgt_financial_files(text,text,boolean,integer,timestamptz,uuid);
-- drop function if exists public.transition_bsgt_financial_file(uuid,bigint,text,text,text);
-- drop function if exists public.confirm_bsgt_financial_client(uuid,bigint,uuid);
-- drop function if exists public.confirm_bsgt_financial_invoice(uuid,bigint,numeric,text);
-- drop function if exists public.sync_bsgt_financial_invoices(uuid,bigint);
-- drop function if exists public.update_bsgt_financial_bank_details(uuid,bigint,jsonb);
-- drop function if exists public.update_bsgt_financial_draft(uuid,bigint,jsonb);
-- drop function if exists public.create_bsgt_financial_file(uuid);
-- drop function if exists public.bsgt_financial_assert_eligible(uuid);
-- drop function if exists public.bsgt_financial_consignees(uuid);
-- drop function if exists public.bsgt_financial_file_json(public.bsgt_financial_files);
-- drop function if exists public.bsgt_financial_invoice_json(public.bsgt_financial_file_invoices);
-- drop function if exists public.bsgt_financial_log(uuid,text,text,text,text,jsonb);
-- drop function if exists public.bsgt_financial_lock(uuid,bigint,text[]);
-- drop table if exists public.bsgt_financial_file_events;
-- drop table if exists public.bsgt_financial_file_invoices;
-- drop table if exists public.bsgt_financial_files;
-- drop function if exists public.bsgt_financial_file_events_readonly();
-- drop function if exists public.bsgt_financial_files_guard();
-- drop function if exists public.bsgt_financial_total(uuid);
-- drop function if exists public.bsgt_financial_scale6(numeric,text);
-- drop function if exists public.bsgt_financial_center_can(text);
-- drop index if exists public.bff_m53_tcf_operation_no_prefix_idx;   -- فهرس هذه المرحلة فقط؛ لا يُمس أي فهرس سابق (v4.1-3)
-- delete from public.user_feature_permissions where permission_key like 'bsgt.financial_center.%';
-- delete from public.feature_permission_catalog where permission_key like 'bsgt.financial_center.%';
-- notify pgrst, 'reload schema';
-- commit;
