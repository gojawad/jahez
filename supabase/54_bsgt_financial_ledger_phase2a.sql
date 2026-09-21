-- BSGT Financial Center — Phase 2a: ledger foundation (chart of accounts, vouchers,
-- balanced double-entry journal, protections, reports). Additive only: no existing
-- table, function, policy or data is modified. All writes go through the RPCs below;
-- the tables are select-only for the app role. Money is unconstrained numeric (no
-- typmod, no rounding); inputs are validated to <= 6 decimals; every JSON/list output
-- emits money as text. File-linked vouchers stay DISABLED (fin_ledger_settings) until
-- the phase-1 transitions are wired to the ledger in a later migration — there is no
-- RPC in this file that enables them. Refuses to run on a partial schema.
-- Rollback script: see the commented block at the end of this file.
begin;

-- ===== 0) فحص مسبق =====
do $$
declare v text;
begin
  if to_regclass('public.bsgt_financial_files') is null or to_regprocedure('public.bsgt_financial_center_can(text)') is null
     or to_regprocedure('public.bsgt_financial_scale6(numeric,text)') is null then
    raise exception 'Migration 53 (financial center phase 1) must be applied first';
  end if;
  foreach v in array array['fin_accounts','fin_vouchers','fin_journal_entries','fin_journal_lines','fin_file_ledger_state',
                          'fin_ledger_settings','fin_counters','fin_ledger_events'] loop
    if to_regclass('public.' || v) is not null then
      raise exception 'Object public.% already exists — refusing to run a fresh phase-2a migration on a partial schema', v;
    end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fin\_%') then
    raise exception 'Functions named fin_%% already exist — refusing to run';
  end if;
end $$;

-- ===== 1) الجداول =====
-- 1.1 الإعدادات: السندات المرتبطة بالملفات معطّلة افتراضياً (لا RPC هنا يفعّلها)
create table public.fin_ledger_settings (
  company_id uuid primary key references public.companies(id) on delete restrict,
  file_vouchers_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete restrict
);

-- 1.2 دليل الحسابات
create table public.fin_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  code text not null,
  name_ar text not null,
  kind text not null,
  role text not null,
  parent_id uuid references public.fin_accounts(id) on delete restrict,
  postable boolean not null default true,
  is_system boolean not null default false,
  active boolean not null default true,
  lock_version bigint not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete restrict,
  constraint fin_accounts_code_check check (code ~ '^[0-9]{4,12}$'),
  constraint fin_accounts_name_check check (btrim(name_ar) <> ''),
  constraint fin_accounts_kind_check check (kind in ('asset','liability','equity','revenue','expense')),
  constraint fin_accounts_role_check check (role in ('group','cash','bank','client_control','paid_bank','paid_permit','recoverable','commission_revenue')),
  constraint fin_accounts_group_check check ((role = 'group') = (postable = false)),
  constraint fin_accounts_system_check check (not is_system or role in ('group','client_control','paid_bank','paid_permit','recoverable','commission_revenue')),
  constraint fin_accounts_company_code_uniq unique (company_id, code)
);
-- حساب نظامي واحد لكل دور تحكّم في الشركة
create unique index fin_accounts_system_role_uniq on public.fin_accounts (company_id, role) where is_system and role <> 'group';

-- 1.3 السندات
create table public.fin_vouchers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  request_id uuid,                                   -- منع تكرار الإنشاء عند إعادة الطلب
  voucher_type text not null,
  status text not null default 'draft',
  voucher_no text,                                   -- يُمنح عند الترحيل فقط
  voucher_date date not null,
  amount numeric,                                    -- يدوي؛ NULL للأنواع المحسوبة (settlement/failure_reclass) حتى الترحيل
  cash_account_id uuid references public.fin_accounts(id) on delete restrict,
  counter_account_id uuid references public.fin_accounts(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  financial_file_id uuid references public.bsgt_financial_files(id) on delete restrict,
  target_file_id uuid references public.bsgt_financial_files(id) on delete restrict,
  purpose text,
  direction text,
  reference text,
  memo text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  lock_version bigint not null default 1,
  last_input_at timestamptz not null default now(),
  last_input_by uuid not null references public.profiles(id) on delete restrict,
  journal_entry_id uuid,
  posted_seq bigint,                                 -- = posting_seq لقيد الترحيل
  posted_at timestamptz,   posted_by uuid references public.profiles(id) on delete restrict,
  reversal_entry_id uuid,
  reversed_at timestamptz, reversed_by uuid references public.profiles(id) on delete restrict,
  reversal_reason text,
  cancelled_at timestamptz, cancelled_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete restrict,
  constraint fin_vouchers_type_check check (voucher_type in ('receipt','payment_bank','payment_permit','refund','recovery','transfer','settlement','failure_reclass','balance_transfer','adjustment')),
  constraint fin_vouchers_status_check check (status in ('draft','posted','reversed','cancelled')),
  constraint fin_vouchers_amount_check check (amount is null or (amount > 0 and amount <> 'NaN'::numeric and amount <> 'Infinity'::numeric and amount <> '-Infinity'::numeric)),
  constraint fin_vouchers_purpose_check check (purpose is null or purpose in ('file_transfer','commission_advance','other')),
  constraint fin_vouchers_direction_check check (direction is null or direction in ('charge','credit')),
  constraint fin_vouchers_posted_check check ((status in ('posted','reversed')) = (posted_at is not null and posted_by is not null and journal_entry_id is not null and voucher_no is not null and posted_seq is not null)),
  constraint fin_vouchers_reversed_check check ((status = 'reversed') = (reversed_at is not null and reversal_entry_id is not null and coalesce(btrim(reversal_reason),'') <> '')),
  constraint fin_vouchers_cancelled_check check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint fin_vouchers_request_uniq unique (company_id, request_id),
  constraint fin_vouchers_no_uniq unique (company_id, voucher_no)
);
-- تسوية واحدة مرحّلة وإعادة تصنيف إخفاق واحدة مرحّلة لكل ملف
create unique index fin_vouchers_settlement_uniq on public.fin_vouchers (financial_file_id) where voucher_type = 'settlement' and status = 'posted';
create unique index fin_vouchers_failure_uniq    on public.fin_vouchers (financial_file_id) where voucher_type = 'failure_reclass' and status = 'posted';
create index fin_vouchers_page_idx   on public.fin_vouchers (company_id, created_at desc, id desc);
create index fin_vouchers_file_idx   on public.fin_vouchers (financial_file_id, status);
create index fin_vouchers_client_idx on public.fin_vouchers (client_id, status);

-- 1.4 القيود (غير قابلة للتعديل أو الحذف)
create sequence public.fin_posting_seq;
create table public.fin_journal_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  entry_no text not null,
  entry_date date not null,
  voucher_id uuid not null references public.fin_vouchers(id) on delete restrict,
  kind text not null,
  reverses_entry_id uuid references public.fin_journal_entries(id) on delete restrict,
  memo text,
  total_debit numeric not null,
  total_credit numeric not null,
  posting_seq bigint not null default nextval('public.fin_posting_seq'),   -- ترتيب ترحيل ثابت يحسم تعادل now()
  posted_at timestamptz not null default now(),
  posted_by uuid not null references public.profiles(id) on delete restrict,
  constraint fin_entries_posting_seq_uniq unique (posting_seq),
  constraint fin_entries_kind_check check (kind in ('post','reversal')),
  constraint fin_entries_reversal_check check ((kind = 'reversal') = (reverses_entry_id is not null)),
  constraint fin_entries_balanced_check check (total_debit = total_credit and total_debit > 0),
  constraint fin_entries_no_uniq unique (company_id, entry_no),
  constraint fin_entries_voucher_kind_uniq unique (voucher_id, kind),          -- ترحيل واحد وعكس واحد لكل سند
  constraint fin_entries_reverses_uniq unique (reverses_entry_id)              -- قيد الأصل يُعكس مرة واحدة
);
alter table public.fin_vouchers add constraint fin_vouchers_entry_fk foreign key (journal_entry_id) references public.fin_journal_entries(id) on delete restrict;
alter table public.fin_vouchers add constraint fin_vouchers_reversal_fk foreign key (reversal_entry_id) references public.fin_journal_entries(id) on delete restrict;

create table public.fin_journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.fin_journal_entries(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  line_no integer not null,
  account_id uuid not null references public.fin_accounts(id) on delete restrict,
  debit numeric not null default 0,
  credit numeric not null default 0,
  client_id uuid references public.clients(id) on delete restrict,
  financial_file_id uuid references public.bsgt_financial_files(id) on delete restrict,
  memo text,
  constraint fin_lines_amounts_check check (debit >= 0 and credit >= 0 and ((debit > 0) <> (credit > 0))
    and debit <> 'NaN'::numeric and credit <> 'NaN'::numeric and debit <> 'Infinity'::numeric and credit <> 'Infinity'::numeric),
  constraint fin_lines_entry_line_uniq unique (entry_id, line_no)
);
create index fin_lines_account_idx on public.fin_journal_lines (account_id, entry_id);
create index fin_lines_file_idx    on public.fin_journal_lines (financial_file_id) where financial_file_id is not null;
create index fin_lines_client_idx  on public.fin_journal_lines (client_id) where client_id is not null;

-- 1.5 حالة دفتر الملف (تُفتح صراحةً؛ الملفات القديمة بنمط pre_ledger بلا قيود تاريخية)
create table public.fin_file_ledger_state (
  financial_file_id uuid primary key references public.bsgt_financial_files(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  ledger_mode text not null,
  opened_at timestamptz not null default now(),
  opened_by uuid not null references public.profiles(id) on delete restrict,
  note text,
  delivery_confirmed_at timestamptz,
  delivery_confirmed_by uuid references public.profiles(id) on delete restrict,
  delivery_note text,
  -- التكلفة الفعلية المعتمدة (مستقلة عن المدفوع؛ التسوية تحمّلها للعميل وتشترط تساوي المدفوع المرحّل معها)
  approved_bank_cost_sdg numeric,
  approved_permit_cost_sdg numeric,
  costs_approved_at timestamptz,
  costs_approved_by uuid references public.profiles(id) on delete restrict,
  costs_note text,
  lock_version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete restrict,
  constraint fin_file_ledger_mode_check check (ledger_mode in ('ledger','pre_ledger')),
  constraint fin_file_ledger_delivery_check check ((delivery_confirmed_at is null) = (delivery_confirmed_by is null)),
  constraint fin_file_ledger_costs_check check (
    (approved_bank_cost_sdg is null or (approved_bank_cost_sdg >= 0 and approved_bank_cost_sdg <> 'NaN'::numeric and approved_bank_cost_sdg <> 'Infinity'::numeric))
    and (approved_permit_cost_sdg is null or (approved_permit_cost_sdg >= 0 and approved_permit_cost_sdg <> 'NaN'::numeric and approved_permit_cost_sdg <> 'Infinity'::numeric))
    and ((costs_approved_at is null) = (approved_bank_cost_sdg is null)))
);

-- 1.6 عدادات الترقيم
create table public.fin_counters (
  company_id uuid not null references public.companies(id) on delete restrict,
  prefix text not null,
  year integer not null,
  last_no bigint not null default 0,
  primary key (company_id, prefix, year)
);

-- 1.7 أحداث الدفتر (append-only)
create table public.fin_ledger_events (
  id bigserial primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  from_status text,
  to_status text,
  lock_version_after bigint,
  note text,
  changes jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  constraint fin_events_entity_check check (entity_type in ('voucher','account','file_ledger'))
);
create index fin_events_entity_idx on public.fin_ledger_events (entity_type, entity_id, created_at desc);

-- ===== 2) المساعدات الداخلية =====
create function public.fin_company()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare c uuid := public.bsgt_company_id();
begin
  if c is null then raise exception 'BSGT company is not configured'; end if;
  return c;
end $$;

-- مبلغ مُدخل: منتهٍ، ≤ 6 خانات، > 0 (لا تقريب)
create function public.fin_amount(p numeric, p_name text)
returns numeric language plpgsql immutable as $$
begin
  if p is null then raise exception '% is required', p_name; end if;
  perform public.bsgt_financial_scale6(p, p_name);
  if p <= 0 then raise exception '% must be greater than zero', p_name; end if;
  return p;
end $$;

create function public.fin_money_text(p numeric) returns text language sql immutable as $$ select p::text $$;

create function public.fin_account_json(a public.fin_accounts)
returns jsonb language sql immutable as $$ select to_jsonb(a) $$;

create function public.fin_state_json(s public.fin_file_ledger_state)
returns jsonb language sql immutable as $$
  select to_jsonb(s) || jsonb_build_object('approved_bank_cost_sdg', s.approved_bank_cost_sdg::text, 'approved_permit_cost_sdg', s.approved_permit_cost_sdg::text);
$$;

create function public.fin_voucher_json(v public.fin_vouchers)
returns jsonb language sql immutable as $$
  select to_jsonb(v) || jsonb_build_object('amount', v.amount::text);
$$;

create function public.fin_line_json(l public.fin_journal_lines)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(l) || jsonb_build_object('debit', l.debit::text, 'credit', l.credit::text,
    'account_code', (select a.code from public.fin_accounts a where a.id = l.account_id),
    'account_name', (select a.name_ar from public.fin_accounts a where a.id = l.account_id));
$$;

create function public.fin_entry_json(e public.fin_journal_entries)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(e) || jsonb_build_object('total_debit', e.total_debit::text, 'total_credit', e.total_credit::text,
    'lines', (select coalesce(jsonb_agg(public.fin_line_json(l) order by l.line_no), '[]'::jsonb) from public.fin_journal_lines l where l.entry_id = e.id));
$$;

create function public.fin_log(p_entity text, p_id uuid, p_type text, p_from text, p_to text, p_lock bigint, p_note text, p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.fin_ledger_events (company_id, entity_type, entity_id, event_type, from_status, to_status, lock_version_after, note, changes, created_by)
  values (public.fin_company(), p_entity, p_id, p_type, p_from, p_to, p_lock, p_note, p_changes, auth.uid());
end $$;

-- الحساب النظامي لدور معيّن
create function public.fin_system_account(p_role text)
returns public.fin_accounts language plpgsql stable security definer set search_path = public as $$
declare a public.fin_accounts%rowtype;
begin
  select * into a from public.fin_accounts where company_id = public.fin_company() and is_system and role = p_role;
  if not found then raise exception 'System account for role % is missing; run init_fin_chart() first', p_role; end if;
  return a;
end $$;

-- بذر الحسابات النظامية (بلا حسابات نقدية فعلية وبلا أرصدة)
create function public.fin_seed_system_accounts(p_company uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; v_cash uuid; v_bank uuid;
begin
  insert into public.fin_accounts (company_id, code, name_ar, kind, role, postable, is_system, created_by, updated_by)
  select p_company, s.code, s.name_ar, s.kind, s.role, s.postable, true, auth.uid(), auth.uid()
    from (values
      ('1100', 'الصناديق', 'asset', 'group', false),
      ('1200', 'البنوك', 'asset', 'group', false),
      ('1410', 'مدفوع للبنك نيابة عن العملاء', 'asset', 'paid_bank', true),
      ('1420', 'مدفوع لأذونات الاستيراد نيابة عن العملاء', 'asset', 'paid_permit', true),
      ('1500', 'مستحق استرداده من البنوك والجهات', 'asset', 'recoverable', true),
      ('2100', 'حسابات العملاء (أمانات وجارٍ)', 'liability', 'client_control', true),
      ('4100', 'إيراد عمولات BSGT', 'revenue', 'commission_revenue', true)) as s(code, name_ar, kind, role, postable)
   where not exists (select 1 from public.fin_accounts a where a.company_id = p_company and a.code = s.code);
  get diagnostics n = row_count;
  return n;
end $$;

-- الترقيم: RV/PV/RF/RC/TR/ST/FR/BT/AJ للسندات، JE للقيود؛ لكل شركة وسنة
create function public.fin_next_no(p_company uuid, p_prefix text, p_date date)
returns text language plpgsql security definer set search_path = public as $$
declare v bigint; y integer := extract(year from p_date)::integer;
begin
  insert into public.fin_counters (company_id, prefix, year, last_no) values (p_company, p_prefix, y, 1)
    on conflict (company_id, prefix, year) do update set last_no = public.fin_counters.last_no + 1
    returning last_no into v;
  return format('%s-%s-%s', p_prefix, y, lpad(v::text, 6, '0'));
end $$;

create function public.fin_prefix(p_type text) returns text language sql immutable as $$
  select case p_type when 'receipt' then 'RV' when 'payment_bank' then 'PV' when 'payment_permit' then 'PV' when 'refund' then 'RF'
                     when 'recovery' then 'RC' when 'transfer' then 'TR' when 'settlement' then 'ST' when 'failure_reclass' then 'FR'
                     when 'balance_transfer' then 'BT' when 'adjustment' then 'AJ' end;
$$;

-- رصيد العميل المتاح (2100): دائن − مدين للبعد (عميل، ملف). موجب = رصيد للعميل، سالب = مطلوب منه
create function public.fin_client_balance(p_client uuid, p_file uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.credit - l.debit), 0)
    from public.fin_journal_lines l join public.fin_accounts a on a.id = l.account_id
   where a.role = 'client_control' and l.client_id = p_client and l.financial_file_id is not distinct from p_file;
$$;

-- أمانة العميل للبعد (عميل، ملف): قبض + تخصيص وارد − رد − تخصيص صادر (بلا تحميلات التسوية/التعديل) — ما يمكن ردّه أو تخصيصه
create function public.fin_client_deposit(p_client uuid, p_file uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.credit - l.debit), 0)
    from public.fin_journal_lines l join public.fin_accounts a on a.id = l.account_id
    join public.fin_journal_entries e on e.id = l.entry_id join public.fin_vouchers v on v.id = e.voucher_id
   where a.role = 'client_control' and l.client_id = p_client and l.financial_file_id is not distinct from p_file
     and v.voucher_type in ('receipt','refund','balance_transfer');
$$;

-- المحمَّل على العميل للبعد (عميل، ملف) من التسوية والتعديلات (مدين − دائن على 2100)
create function public.fin_client_charged(p_client uuid, p_file uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.debit - l.credit), 0)
    from public.fin_journal_lines l join public.fin_accounts a on a.id = l.account_id
    join public.fin_journal_entries e on e.id = l.entry_id join public.fin_vouchers v on v.id = e.voucher_id
   where a.role = 'client_control' and l.client_id = p_client and l.financial_file_id is not distinct from p_file
     and v.voucher_type in ('settlement','adjustment');
$$;

-- صافي حساب تحكّم لملف (مدين − دائن): 1410/1420/1500
create function public.fin_file_role_net(p_file uuid, p_role text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.debit - l.credit), 0)
    from public.fin_journal_lines l join public.fin_accounts a on a.id = l.account_id
   where a.role = p_role and l.financial_file_id = p_file;
$$;

create function public.fin_file_has_posted(p_file uuid, p_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fin_vouchers v where v.financial_file_id = p_file and v.voucher_type = p_type and v.status = 'posted');
$$;

-- قفل الملف المالي (صف الملف + قفل استشاري للعميل) — ترتيب ثابت: العميل ← الملفات بترتيب id ← السند ← العدادات
create function public.fin_lock_file(p_file uuid)
returns public.bsgt_financial_files language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype;
begin
  select * into f from public.bsgt_financial_files where id = p_file for update;
  if not found then raise exception 'Financial file not found'; end if;
  if f.company_id <> public.fin_company() then raise exception 'Financial file does not belong to BSGT'; end if;
  return f;
end $$;

create function public.fin_lock_client(p_client uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_client is not null then perform pg_advisory_xact_lock(hashtext('fin_client:' || p_client::text)); end if;
end $$;

create function public.fin_lock_voucher(p_id uuid, p_expected bigint, p_allowed text[])
returns public.fin_vouchers language plpgsql security definer set search_path = public as $$
declare v public.fin_vouchers%rowtype;
begin
  select * into v from public.fin_vouchers where id = p_id for update;
  if not found then raise exception 'Voucher not found'; end if;
  if v.company_id <> public.fin_company() then raise exception 'Voucher does not belong to BSGT'; end if;
  if p_expected is null or v.lock_version <> p_expected then
    raise exception 'Voucher version changed (expected %, current %); reload and retry', p_expected, v.lock_version;
  end if;
  if p_allowed is not null and not (v.status = any(p_allowed)) then
    raise exception 'Action not allowed for voucher status %', v.status;
  end if;
  return v;
end $$;

create function public.fin_require_file_ledger(p_file uuid)
returns public.fin_file_ledger_state language plpgsql stable security definer set search_path = public as $$
declare s public.fin_file_ledger_state%rowtype;
begin
  select * into s from public.fin_file_ledger_state where financial_file_id = p_file;
  if not found then raise exception 'Ledger is not opened for this financial file; open it first (open_fin_file_ledger)'; end if;
  return s;
end $$;

create function public.fin_file_vouchers_enabled()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.file_vouchers_enabled from public.fin_ledger_settings s where s.company_id = public.bsgt_company_id()), false);
$$;

-- ===== 3) الحرّاس =====
create function public.fin_immutable()
returns trigger language plpgsql as $$ begin raise exception 'Posted journal entries and lines are immutable (% on %)', tg_op, tg_table_name; end $$;
create trigger fin_entries_immutable before update or delete on public.fin_journal_entries for each row execute function public.fin_immutable();
create trigger fin_lines_immutable   before update or delete on public.fin_journal_lines   for each row execute function public.fin_immutable();
create trigger fin_events_immutable  before update or delete on public.fin_ledger_events   for each row execute function public.fin_immutable();

-- توازن كل قيد عند الالتزام (قيد مؤجَّل) + سطران على الأقل + مطابقة الإجمالي المخزَّن
create function public.fin_entry_balance_check()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_entry uuid;
begin
  v_entry := case when tg_table_name = 'fin_journal_lines' then (to_jsonb(new)->>'entry_id')::uuid else (to_jsonb(new)->>'id')::uuid end;
  select e.id, e.total_debit, e.total_credit, coalesce(sum(l.debit), 0) d, coalesce(sum(l.credit), 0) c, count(l.id) n
    into r from public.fin_journal_entries e left join public.fin_journal_lines l on l.entry_id = e.id
   where e.id = v_entry group by e.id, e.total_debit, e.total_credit;
  if r.n < 2 then raise exception 'Journal entry % needs at least two lines', r.id; end if;
  if r.d <> r.c then raise exception 'Journal entry % is not balanced (debit %, credit %)', r.id, r.d, r.c; end if;
  if r.d <> r.total_debit or r.c <> r.total_credit then raise exception 'Journal entry % totals do not match its lines', r.id; end if;
  return null;
end $$;
create constraint trigger fin_lines_balanced after insert on public.fin_journal_lines
  deferrable initially deferred for each row execute function public.fin_entry_balance_check();
create constraint trigger fin_entries_balanced after insert on public.fin_journal_entries
  deferrable initially deferred for each row execute function public.fin_entry_balance_check();

-- حارس السند: نسخة القفل +1؛ الحقول المالية مجمَّدة بعد المسودة؛ الحالة تتغير فقط داخل post/reverse/cancel
create function public.fin_vouchers_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_gate text := coalesce(current_setting('jahez.fin_post', true), '');
begin
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  new.updated_at := now();
  new.lock_version := old.lock_version + 1;
  new.id := old.id; new.company_id := old.company_id; new.created_at := old.created_at; new.created_by := old.created_by;
  new.voucher_type := old.voucher_type; new.request_id := old.request_id;
  if new.status is distinct from old.status and v_gate <> 'on' then
    raise exception 'Voucher status changes only through post/reverse/cancel RPCs';
  end if;
  if old.status in ('reversed','cancelled') then raise exception 'A % voucher is immutable', old.status; end if;
  if old.status = 'posted' then
    if v_gate <> 'on' then raise exception 'Posted vouchers are immutable; reverse instead'; end if;
    if new.status <> 'reversed' then raise exception 'A posted voucher can only be reversed'; end if;
    -- كل ما عدا حقول العكس مجمَّد
    new.voucher_no := old.voucher_no; new.voucher_date := old.voucher_date; new.amount := old.amount;
    new.cash_account_id := old.cash_account_id; new.counter_account_id := old.counter_account_id;
    new.client_id := old.client_id; new.financial_file_id := old.financial_file_id; new.target_file_id := old.target_file_id;
    new.purpose := old.purpose; new.direction := old.direction; new.reference := old.reference; new.memo := old.memo; new.reason := old.reason;
    new.details := old.details; new.last_input_at := old.last_input_at; new.last_input_by := old.last_input_by;
    new.journal_entry_id := old.journal_entry_id; new.posted_at := old.posted_at; new.posted_by := old.posted_by; new.posted_seq := old.posted_seq;
  end if;
  return new;
end $$;
create trigger fin_vouchers_guard before update on public.fin_vouchers for each row execute function public.fin_vouchers_guard();

-- حارس الحساب: الحسابات النظامية ثابتة الكود/النوع/الدور ولا تُعطَّل؛ نسخة القفل +1
create function public.fin_accounts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := coalesce(auth.uid(), old.updated_by); new.updated_at := now(); new.lock_version := old.lock_version + 1;
  new.id := old.id; new.company_id := old.company_id; new.created_at := old.created_at; new.created_by := old.created_by;
  new.code := old.code; new.kind := old.kind; new.role := old.role; new.postable := old.postable; new.is_system := old.is_system; new.parent_id := old.parent_id;
  if old.is_system and (new.active = false or new.name_ar is distinct from old.name_ar) then
    raise exception 'System accounts cannot be renamed or deactivated';
  end if;
  return new;
end $$;
create trigger fin_accounts_guard before update on public.fin_accounts for each row execute function public.fin_accounts_guard();

create function public.fin_file_ledger_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := coalesce(auth.uid(), old.updated_by); new.updated_at := now(); new.lock_version := old.lock_version + 1;
  new.financial_file_id := old.financial_file_id; new.company_id := old.company_id; new.ledger_mode := old.ledger_mode;
  new.opened_at := old.opened_at; new.opened_by := old.opened_by;
  if old.delivery_confirmed_at is not null and (new.delivery_confirmed_at is distinct from old.delivery_confirmed_at or new.delivery_confirmed_by is distinct from old.delivery_confirmed_by) then
    raise exception 'Delivery confirmation cannot be changed once recorded';
  end if;
  if (new.approved_bank_cost_sdg is distinct from old.approved_bank_cost_sdg or new.approved_permit_cost_sdg is distinct from old.approved_permit_cost_sdg)
     and public.fin_file_has_posted(old.financial_file_id, 'settlement') then
    raise exception 'Approved costs are frozen after settlement; use a cost adjustment voucher';
  end if;
  return new;
end $$;
create trigger fin_file_ledger_guard before update on public.fin_file_ledger_state for each row execute function public.fin_file_ledger_guard();

-- ===== 4) دليل الحسابات (RPC) =====
create function public.init_fin_chart()
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid := public.fin_company(); n integer;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  n := public.fin_seed_system_accounts(c);
  if n > 0 then perform public.fin_log('account', c, 'chart_initialised', null, null, null, null, jsonb_build_object('created', n)); end if;
  return jsonb_build_object('created', n, 'accounts', (select coalesce(jsonb_agg(public.fin_account_json(a) order by a.code), '[]'::jsonb) from public.fin_accounts a where a.company_id = c));
end $$;

-- حساب صندوق/بنك فعلي: يُدخل يدوياً لاحقاً (بلا رصيد افتتاحي)
create function public.create_fin_account(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid := public.fin_company(); a public.fin_accounts%rowtype; v_role text; v_parent uuid;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Payload must be a JSON object'; end if;
  v_role := p->>'role';
  if v_role not in ('cash','bank') then raise exception 'Only cash or bank accounts can be created here'; end if;
  perform public.fin_system_account('client_control');   -- الدليل مبذور
  select id into v_parent from public.fin_accounts where company_id = c and is_system and code = case v_role when 'cash' then '1100' else '1200' end;
  insert into public.fin_accounts (company_id, code, name_ar, kind, role, parent_id, postable, is_system, active, created_by, updated_by)
  values (c, btrim(coalesce(p->>'code','')), btrim(coalesce(p->>'name_ar','')), 'asset', v_role, v_parent, true, false, true, auth.uid(), auth.uid())
  returning * into a;
  perform public.fin_log('account', a.id, 'account_created', null, null, a.lock_version, null, jsonb_build_object('code', a.code, 'name_ar', a.name_ar, 'role', a.role));
  return jsonb_build_object('account', public.fin_account_json(a));
exception when unique_violation then
  raise exception 'Account code % already exists', btrim(coalesce(p->>'code',''));
end $$;

create function public.update_fin_account(p_id uuid, p_expected_lock_version bigint, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.fin_accounts%rowtype; o public.fin_accounts%rowtype; v_name text; v_active boolean;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Patch must be a JSON object'; end if;
  select * into o from public.fin_accounts where id = p_id and company_id = public.fin_company() for update;
  if not found then raise exception 'Account not found'; end if;
  if p_expected_lock_version is null or o.lock_version <> p_expected_lock_version then
    raise exception 'Account version changed (expected %, current %); reload and retry', p_expected_lock_version, o.lock_version; end if;
  if o.is_system then raise exception 'System accounts cannot be edited'; end if;
  if p_patch - 'name_ar' - 'active' <> '{}'::jsonb then raise exception 'Only name_ar and active can be updated'; end if;
  v_name := coalesce(nullif(btrim(p_patch->>'name_ar'), ''), o.name_ar);
  v_active := coalesce((p_patch->>'active')::boolean, o.active);
  if v_name = o.name_ar and v_active = o.active then
    return jsonb_build_object('account', public.fin_account_json(o), 'changed', false); end if;
  update public.fin_accounts set name_ar = v_name, active = v_active where id = p_id returning * into a;
  perform public.fin_log('account', a.id, 'account_updated', null, null, a.lock_version, null,
    jsonb_build_object('name_ar', jsonb_build_array(o.name_ar, a.name_ar), 'active', jsonb_build_array(o.active, a.active)));
  return jsonb_build_object('account', public.fin_account_json(a), 'changed', true);
end $$;

create function public.list_fin_accounts()
returns table (id uuid, code text, name_ar text, kind text, role text, parent_id uuid, postable boolean, is_system boolean, active boolean,
               lock_version bigint, debit_total text, credit_total text, balance text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.bsgt_financial_center_can('view') then raise exception 'Financial center view permission required'; end if;
  return query
  select a.id, a.code, a.name_ar, a.kind, a.role, a.parent_id, a.postable, a.is_system, a.active, a.lock_version,
         coalesce(t.d, 0)::text, coalesce(t.c, 0)::text,
         (case when a.kind in ('asset','expense') then coalesce(t.d, 0) - coalesce(t.c, 0) else coalesce(t.c, 0) - coalesce(t.d, 0) end)::text
    from public.fin_accounts a
    left join lateral (select sum(l.debit) d, sum(l.credit) c from public.fin_journal_lines l where l.account_id = a.id) t on true
   where a.company_id = public.fin_company()
   order by a.code;
end $$;

-- ===== 5) دفتر الملف =====
create function public.open_fin_file_ledger(p_file uuid, p_mode text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; s public.fin_file_ledger_state%rowtype;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  if not public.fin_file_vouchers_enabled() then raise exception 'File-linked ledger is not enabled for this company yet'; end if;
  f := public.fin_lock_file(p_file);
  select * into s from public.fin_file_ledger_state where financial_file_id = p_file;
  if found then return jsonb_build_object('state', public.fin_state_json(s), 'created', false); end if;
  if p_mode not in ('ledger','pre_ledger') then raise exception 'Ledger mode must be ledger or pre_ledger'; end if;
  if f.status = 'draft' then raise exception 'Approve the financial file before opening its ledger'; end if;
  -- ملف حُرِّكت أمواله قبل الدفتر: يُفتح بنمط pre_ledger فقط، بلا قيود تاريخية تلقائية
  if p_mode = 'ledger' and (f.client_transferred_at is not null or f.bank_paid_at is not null or f.refund_started_at is not null) then
    raise exception 'This file already has confirmed money movements from phase 1; open it as pre_ledger and record the actual vouchers explicitly';
  end if;
  if p_mode = 'pre_ledger' and coalesce(btrim(p_note), '') = '' then raise exception 'A note is required when opening a pre_ledger file'; end if;
  insert into public.fin_file_ledger_state (financial_file_id, company_id, ledger_mode, opened_by, note, updated_by)
  values (p_file, f.company_id, p_mode, auth.uid(), nullif(btrim(p_note), ''), auth.uid()) returning * into s;
  perform public.fin_log('file_ledger', p_file, 'ledger_opened', null, p_mode, s.lock_version, s.note, null);
  return jsonb_build_object('state', public.fin_state_json(s), 'created', true);
end $$;

-- تأكيد تسليم الاعتماد/المستندات للعميل: شرط الاعتراف بالعمولة (منفصل عن completed في المرحلة 1 التي تثبت الإرسال للبنك المحصّل فقط)
create function public.confirm_fin_file_delivery(p_file uuid, p_expected_lock_version bigint, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; s public.fin_file_ledger_state%rowtype;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  f := public.fin_lock_file(p_file);
  select * into s from public.fin_file_ledger_state where financial_file_id = p_file for update;
  if not found then raise exception 'Ledger is not opened for this financial file'; end if;
  if p_expected_lock_version is null or s.lock_version <> p_expected_lock_version then
    raise exception 'File ledger version changed (expected %, current %); reload and retry', p_expected_lock_version, s.lock_version; end if;
  if s.delivery_confirmed_at is not null then raise exception 'Delivery is already confirmed'; end if;
  if f.status not in ('bank_paid','completed') then raise exception 'Delivery can be confirmed only after the bank payment (status %)', f.status; end if;
  update public.fin_file_ledger_state set delivery_confirmed_at = now(), delivery_confirmed_by = auth.uid(), delivery_note = nullif(btrim(p_note), '')
   where financial_file_id = p_file returning * into s;
  perform public.fin_log('file_ledger', p_file, 'delivery_confirmed', null, null, s.lock_version, s.delivery_note, null);
  return jsonb_build_object('state', public.fin_state_json(s));
end $$;

-- اعتماد التكلفة الفعلية للبنك والإذن (مستقلة عن المدفوع): التسوية تشترط تساوي المدفوع المرحّل معها؛ تُجمَّد بعد التسوية (التغيير لاحقاً بسند adjustment)
create function public.approve_fin_file_costs(p_file uuid, p_expected_lock_version bigint, p_bank_cost text, p_permit_cost text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; s public.fin_file_ledger_state%rowtype; o public.fin_file_ledger_state%rowtype; v_bank numeric; v_permit numeric;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  f := public.fin_lock_file(p_file);
  select * into o from public.fin_file_ledger_state where financial_file_id = p_file for update;
  if not found then raise exception 'Ledger is not opened for this financial file'; end if;
  if p_expected_lock_version is null or o.lock_version <> p_expected_lock_version then
    raise exception 'File ledger version changed (expected %, current %); reload and retry', p_expected_lock_version, o.lock_version; end if;
  if public.fin_file_has_posted(p_file, 'settlement') then raise exception 'Approved costs are frozen after settlement; use a cost adjustment voucher'; end if;
  if p_bank_cost is null or btrim(p_bank_cost) = '' then raise exception 'Approved bank cost is required'; end if;
  v_bank := public.bsgt_financial_scale6(btrim(p_bank_cost)::numeric, 'Approved bank cost');
  if f.import_permit_source = 'bsgt' then
    if p_permit_cost is null or btrim(p_permit_cost) = '' then raise exception 'Approved permit cost is required for a BSGT-paid permit'; end if;
    v_permit := public.bsgt_financial_scale6(btrim(p_permit_cost)::numeric, 'Approved permit cost');
  elsif p_permit_cost is not null and btrim(p_permit_cost) <> '' and btrim(p_permit_cost)::numeric <> 0 then
    raise exception 'Permit cost must be empty or zero when the permit is client-provided';
  else v_permit := null; end if;
  update public.fin_file_ledger_state set approved_bank_cost_sdg = v_bank, approved_permit_cost_sdg = v_permit, costs_approved_at = now(), costs_approved_by = auth.uid(), costs_note = nullif(btrim(p_note), '')
   where financial_file_id = p_file returning * into s;
  perform public.fin_log('file_ledger', p_file, 'costs_approved', null, null, s.lock_version, s.costs_note, jsonb_build_object(
    'approved_bank_cost_sdg', jsonb_build_array(o.approved_bank_cost_sdg::text, s.approved_bank_cost_sdg::text),
    'approved_permit_cost_sdg', jsonb_build_array(o.approved_permit_cost_sdg::text, s.approved_permit_cost_sdg::text),
    'computed_bank_cost_sdg', f.bank_cost_sdg::text, 'entered_permit_cost_sdg', f.import_permit_cost_sdg::text,
    'paid_bank_sdg', public.fin_file_role_net(p_file, 'paid_bank')::text, 'paid_permit_sdg', public.fin_file_role_net(p_file, 'paid_permit')::text));
  return jsonb_build_object('state', public.fin_state_json(s));
end $$;

-- ===== 6) السندات: التحقق والبناء =====
create function public.fin_account_for(p_id uuid, p_roles text[], p_name text)
returns public.fin_accounts language plpgsql stable security definer set search_path = public as $$
declare a public.fin_accounts%rowtype;
begin
  if p_id is null then raise exception '% is required', p_name; end if;
  select * into a from public.fin_accounts where id = p_id and company_id = public.fin_company();
  if not found then raise exception '% not found', p_name; end if;
  if not a.active or not a.postable then raise exception '% must be an active postable account', p_name; end if;
  if not (a.role = any(p_roles)) then raise exception '% must be one of: %', p_name, array_to_string(p_roles, ', '); end if;
  return a;
end $$;

-- تحقق كامل من السند (يُستدعى عند الإنشاء/التعديل وعند الترحيل تحت الأقفال)
create function public.fin_validate_voucher(v public.fin_vouchers)
returns public.fin_vouchers language plpgsql stable security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; t public.bsgt_financial_files%rowtype; a public.fin_accounts%rowtype; s public.fin_file_ledger_state%rowtype; bal numeric;
begin
  if v.voucher_date is null then raise exception 'Voucher date is required'; end if;
  if v.voucher_date > current_date then raise exception 'Voucher date cannot be in the future'; end if;
  if v.financial_file_id is not null or v.target_file_id is not null then
    if not public.fin_file_vouchers_enabled() then raise exception 'File-linked vouchers are not enabled for this company yet'; end if;
  end if;
  if v.financial_file_id is not null then
    select * into f from public.bsgt_financial_files where id = v.financial_file_id and company_id = public.fin_company();
    if not found then raise exception 'Financial file not found'; end if;
    s := public.fin_require_file_ledger(f.id);
    if f.status = 'draft' then raise exception 'Financial file must be approved before ledger vouchers'; end if;
  end if;
  if v.target_file_id is not null then
    select * into t from public.bsgt_financial_files where id = v.target_file_id and company_id = public.fin_company();
    if not found then raise exception 'Target financial file not found'; end if;
    perform public.fin_require_file_ledger(t.id);
  end if;
  case v.voucher_type
    when 'receipt' then
      perform public.fin_account_for(v.cash_account_id, '{cash,bank}', 'Cash/bank account');
      if v.client_id is null then raise exception 'Client is required'; end if;
      perform public.fin_amount(v.amount, 'Amount');
      if v.financial_file_id is not null then
        if f.client_id is null then raise exception 'Confirm the billing client of the financial file first'; end if;
        if f.client_id <> v.client_id then raise exception 'Client does not match the financial file client'; end if;
      end if;
      v.purpose := coalesce(v.purpose, case when v.financial_file_id is null then 'other' else 'file_transfer' end);
      if v.purpose in ('file_transfer','commission_advance') and v.financial_file_id is null then raise exception 'Purpose % requires a financial file', v.purpose; end if;
      if v.counter_account_id is not null or v.target_file_id is not null or v.direction is not null then raise exception 'Receipt takes no counter account, target file or direction'; end if;
    when 'payment_bank', 'payment_permit' then
      perform public.fin_account_for(v.cash_account_id, '{cash,bank}', 'Cash/bank account');
      if v.financial_file_id is null then raise exception 'Financial file is required'; end if;
      perform public.fin_amount(v.amount, 'Amount');
      if f.client_id is null then raise exception 'Confirm the billing client of the financial file first'; end if;
      v.client_id := f.client_id;
      if f.status not in ('pending_client_transfer','client_transferred','bank_paid','completed') then raise exception 'Payments on behalf are not allowed in status %', f.status; end if;
      if public.fin_file_has_posted(f.id, 'failure_reclass') then raise exception 'File failure is already reclassified; no further payments on behalf'; end if;
      -- بعد التسوية: الدفع مسموح (زيادة تكلفة) ويُحمَّل على العميل بسند adjustment/charge؛ يبقى في 1410/1420 «غير محمَّل» حتى ذلك
      if v.voucher_type = 'payment_permit' and coalesce(f.import_permit_source, '') <> 'bsgt' then raise exception 'Import permit is not paid by BSGT for this file'; end if;
      if v.counter_account_id is not null or v.target_file_id is not null or v.direction is not null then raise exception 'Payment takes no counter account, target file or direction'; end if;
    when 'refund' then
      perform public.fin_account_for(v.cash_account_id, '{cash,bank}', 'Cash/bank account');
      if v.client_id is null then raise exception 'Client is required'; end if;
      perform public.fin_amount(v.amount, 'Amount');
      if v.financial_file_id is not null and f.client_id is distinct from v.client_id then raise exception 'Client does not match the financial file client'; end if;
      bal := public.fin_client_balance(v.client_id, v.financial_file_id);
      if v.amount > bal then raise exception 'Refund % exceeds the client available balance %', v.amount, bal; end if;
      if v.counter_account_id is not null or v.target_file_id is not null or v.direction is not null then raise exception 'Refund takes no counter account, target file or direction'; end if;
    when 'recovery' then
      perform public.fin_account_for(v.cash_account_id, '{cash,bank}', 'Cash/bank account');
      if v.financial_file_id is null then raise exception 'Financial file is required'; end if;
      perform public.fin_amount(v.amount, 'Amount');
      v.client_id := f.client_id;
      if v.target_file_id is not null or v.direction is not null then raise exception 'Recovery takes no target file or direction'; end if;
      if public.fin_file_has_posted(f.id, 'failure_reclass') then
        -- بعد الإخفاق: يصفّي 1500 فقط
        if v.counter_account_id is not null and (select role from public.fin_accounts where id = v.counter_account_id) <> 'recoverable' then
          raise exception 'After a failure reclassification, recoveries settle account 1500 only'; end if;
        v.counter_account_id := (public.fin_system_account('recoverable')).id;
        bal := public.fin_file_role_net(f.id, 'recoverable');
        if v.amount > bal then raise exception 'Recovery % exceeds the outstanding recoverable amount %', v.amount, bal; end if;
      elsif public.fin_file_has_posted(f.id, 'settlement') then
        -- بعد التسوية: مبلغ أعاده البنك/الجهة (نقص تكلفة) يُقيَّد على 1410 أو 1420 ويُسوّى للعميل بسند adjustment/credit
        a := public.fin_account_for(coalesce(v.counter_account_id, (public.fin_system_account('paid_bank')).id), '{paid_bank,paid_permit}', 'Recovered-from account');
        v.counter_account_id := a.id;
      else
        raise exception 'Recovery requires a failed (reclassified) or settled file';
      end if;
    when 'transfer' then
      perform public.fin_account_for(v.cash_account_id, '{cash,bank}', 'Source account');
      perform public.fin_account_for(v.counter_account_id, '{cash,bank}', 'Destination account');
      if v.cash_account_id = v.counter_account_id then raise exception 'Source and destination accounts must differ'; end if;
      perform public.fin_amount(v.amount, 'Amount');
      if v.client_id is not null or v.financial_file_id is not null or v.target_file_id is not null or v.direction is not null then raise exception 'Transfer takes no client, file or direction'; end if;
    when 'settlement' then
      if v.financial_file_id is null then raise exception 'Financial file is required'; end if;
      if v.amount is not null then raise exception 'Settlement amount is computed at posting; do not enter it'; end if;
      if f.client_id is null then raise exception 'Confirm the billing client of the financial file first'; end if;
      v.client_id := f.client_id;
      if v.cash_account_id is not null or v.counter_account_id is not null or v.target_file_id is not null or v.direction is not null then raise exception 'Settlement takes no accounts, target file or direction'; end if;
      if f.status not in ('bank_paid','completed') then raise exception 'Settlement requires the bank payment first (status %)', f.status; end if;
      if s.delivery_confirmed_at is null then raise exception 'Settlement requires the delivery confirmation (confirm_fin_file_delivery) first'; end if;
      if public.fin_file_has_posted(f.id, 'settlement') then raise exception 'File is already settled'; end if;
      if s.costs_approved_at is null then raise exception 'Approve the actual bank/permit costs first (approve_fin_file_costs)'; end if;
      if public.fin_file_role_net(f.id, 'paid_bank') <> s.approved_bank_cost_sdg then
        raise exception 'Posted bank payments (%) do not equal the approved bank cost (%)', public.fin_file_role_net(f.id, 'paid_bank'), s.approved_bank_cost_sdg; end if;
      if f.import_permit_source = 'bsgt' then
        if s.approved_permit_cost_sdg is null then raise exception 'Approved import permit cost is required for a BSGT-paid permit'; end if;
        if public.fin_file_role_net(f.id, 'paid_permit') <> s.approved_permit_cost_sdg then
          raise exception 'Posted permit payments (%) do not equal the approved permit cost (%)', public.fin_file_role_net(f.id, 'paid_permit'), s.approved_permit_cost_sdg; end if;
      elsif public.fin_file_role_net(f.id, 'paid_permit') <> 0 then
        raise exception 'Permit payments exist although the permit is client-provided';
      end if;
      if f.bsgt_commission_sdg is null then raise exception 'BSGT commission is not calculated on the file'; end if;
    when 'failure_reclass' then
      if v.financial_file_id is null then raise exception 'Financial file is required'; end if;
      if v.amount is not null then raise exception 'Failure reclassification amount is computed at posting; do not enter it'; end if;
      v.client_id := f.client_id;
      if v.cash_account_id is not null or v.counter_account_id is not null or v.target_file_id is not null or v.direction is not null then raise exception 'Failure reclassification takes no accounts, target file or direction'; end if;
      if f.status not in ('failed','refund_in_progress','refunded') then raise exception 'Failure reclassification requires a failed file (status %)', f.status; end if;
      if public.fin_file_has_posted(f.id, 'settlement') then raise exception 'File is settled; reverse the settlement first'; end if;
      if public.fin_file_role_net(f.id, 'paid_bank') + public.fin_file_role_net(f.id, 'paid_permit') <= 0 then raise exception 'Nothing paid on behalf remains to reclassify'; end if;
      if coalesce(btrim(v.reason), '') = '' then raise exception 'Reason is required'; end if;
    when 'balance_transfer' then
      if v.client_id is null then raise exception 'Client is required'; end if;
      if v.target_file_id is null then raise exception 'Target financial file is required'; end if;
      perform public.fin_amount(v.amount, 'Amount');
      if v.financial_file_id is not null and f.client_id is distinct from v.client_id then raise exception 'Client does not match the source file client'; end if;
      if t.client_id is distinct from v.client_id then raise exception 'Client does not match the target file client'; end if;
      if v.target_file_id = v.financial_file_id then raise exception 'Source and target files must differ'; end if;
      if t.status in ('draft','failed','refund_in_progress','refunded') then raise exception 'Target file is not open for allocation (status %)', t.status; end if;
      bal := public.fin_client_balance(v.client_id, v.financial_file_id);
      if v.amount > bal then raise exception 'Allocation % exceeds the client available balance %', v.amount, bal; end if;
      if coalesce(btrim(v.reason), '') = '' then raise exception 'Reason is required'; end if;
      if v.cash_account_id is not null or v.counter_account_id is not null or v.direction is not null then raise exception 'Balance allocation takes no cash account or direction'; end if;
    when 'adjustment' then
      if v.financial_file_id is null then raise exception 'Financial file is required'; end if;
      a := public.fin_account_for(v.counter_account_id, '{paid_bank,paid_permit,commission_revenue}', 'Adjusted account');
      if v.direction is null then raise exception 'Direction (charge/credit) is required'; end if;
      perform public.fin_amount(v.amount, 'Amount');
      if coalesce(btrim(v.reason), '') = '' then raise exception 'Reason is required'; end if;
      if not public.fin_file_has_posted(f.id, 'settlement') then raise exception 'Adjustments apply to settled files only; before settlement use payments/reversals'; end if;
      v.client_id := f.client_id;
      if v.cash_account_id is not null or v.target_file_id is not null then raise exception 'Adjustment takes no cash account or target file'; end if;
    else raise exception 'Unknown voucher type %', v.voucher_type;
  end case;
  return v;
end $$;

-- سطر قيد كـ JSON (المبالغ نصوص)
create function public.fin_ln(p_acc uuid, p_d numeric, p_c numeric, p_client uuid, p_file uuid, p_memo text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('account_id', p_acc, 'debit', p_d::text, 'credit', p_c::text, 'client_id', p_client, 'financial_file_id', p_file, 'memo', p_memo);
$$;

-- سطور القيد لكل نوع (تُبنى عند الترحيل فقط؛ المبالغ المحسوبة تُنسخ حرفياً بلا تقريب)
create function public.fin_build_lines(v public.fin_vouchers, out o_total numeric, out o_details jsonb, out o_lines jsonb)
language plpgsql stable security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; cc public.fin_accounts%rowtype; pb public.fin_accounts%rowtype; pp public.fin_accounts%rowtype;
        rc public.fin_accounts%rowtype; rv public.fin_accounts%rowtype; st public.fin_file_ledger_state%rowtype; n_bank numeric; n_permit numeric; n_comm numeric; bal_before numeric;
begin
  o_details := '{}'::jsonb; o_lines := '[]'::jsonb;
  cc := public.fin_system_account('client_control');
  if v.financial_file_id is not null then select * into f from public.bsgt_financial_files where id = v.financial_file_id; end if;
  case v.voucher_type
    when 'receipt' then
      o_total := v.amount;
      o_lines := jsonb_build_array(public.fin_ln(v.cash_account_id, v.amount, 0, v.client_id, v.financial_file_id, v.memo), public.fin_ln(cc.id, 0, v.amount, v.client_id, v.financial_file_id, v.purpose));
    when 'payment_bank' then
      pb := public.fin_system_account('paid_bank'); o_total := v.amount;
      o_lines := jsonb_build_array(public.fin_ln(pb.id, v.amount, 0, v.client_id, v.financial_file_id, v.memo), public.fin_ln(v.cash_account_id, 0, v.amount, v.client_id, v.financial_file_id, v.memo));
      o_details := jsonb_build_object('computed_bank_cost_sdg', f.bank_cost_sdg::text, 'paid_before', public.fin_file_role_net(f.id, 'paid_bank')::text,
                                      'post_settlement', public.fin_file_has_posted(f.id, 'settlement'));
    when 'payment_permit' then
      pp := public.fin_system_account('paid_permit'); o_total := v.amount;
      o_lines := jsonb_build_array(public.fin_ln(pp.id, v.amount, 0, v.client_id, v.financial_file_id, v.memo), public.fin_ln(v.cash_account_id, 0, v.amount, v.client_id, v.financial_file_id, v.memo));
      o_details := jsonb_build_object('entered_permit_cost_sdg', f.import_permit_cost_sdg::text, 'paid_before', public.fin_file_role_net(f.id, 'paid_permit')::text,
                                      'post_settlement', public.fin_file_has_posted(f.id, 'settlement'));
    when 'refund' then
      o_total := v.amount;
      o_lines := jsonb_build_array(public.fin_ln(cc.id, v.amount, 0, v.client_id, v.financial_file_id, v.memo), public.fin_ln(v.cash_account_id, 0, v.amount, v.client_id, v.financial_file_id, v.memo));
      o_details := jsonb_build_object('client_balance_before', public.fin_client_balance(v.client_id, v.financial_file_id)::text);
    when 'recovery' then
      select * into rc from public.fin_accounts where id = v.counter_account_id; o_total := v.amount;
      o_lines := jsonb_build_array(public.fin_ln(v.cash_account_id, v.amount, 0, v.client_id, v.financial_file_id, v.memo), public.fin_ln(rc.id, 0, v.amount, v.client_id, v.financial_file_id, v.memo));
      o_details := jsonb_build_object('recovered_from', rc.code, 'account_net_before', public.fin_file_role_net(f.id, rc.role)::text, 'account_net_after', (public.fin_file_role_net(f.id, rc.role) - v.amount)::text);
    when 'transfer' then
      o_total := v.amount;
      o_lines := jsonb_build_array(public.fin_ln(v.counter_account_id, v.amount, 0, null, null, v.memo), public.fin_ln(v.cash_account_id, 0, v.amount, null, null, v.memo));
    when 'settlement' then
      pb := public.fin_system_account('paid_bank'); pp := public.fin_system_account('paid_permit'); rv := public.fin_system_account('commission_revenue');
      select * into st from public.fin_file_ledger_state where financial_file_id = f.id;
      n_bank := st.approved_bank_cost_sdg;                              -- التكلفة الفعلية المعتمدة (= المدفوع المرحّل، مُتحقَّق منه)
      n_permit := case when f.import_permit_source = 'bsgt' then st.approved_permit_cost_sdg else 0 end;
      n_comm := f.bsgt_commission_sdg;                                  -- من الملف المعتمد، بلا تقريب
      o_total := n_bank + n_permit + n_comm;
      bal_before := public.fin_client_balance(v.client_id, f.id);
      o_lines := jsonb_build_array(public.fin_ln(cc.id, o_total, 0, v.client_id, f.id, 'settlement: approved dues'))
              || jsonb_build_array(public.fin_ln(pb.id, 0, n_bank, v.client_id, f.id, 'bank cost actually paid'));
      if n_permit > 0 then o_lines := o_lines || jsonb_build_array(public.fin_ln(pp.id, 0, n_permit, v.client_id, f.id, 'import permit actually paid')); end if;
      if n_comm > 0 then o_lines := o_lines || jsonb_build_array(public.fin_ln(rv.id, 0, n_comm, v.client_id, f.id, 'BSGT commission recognised')); end if;
      o_details := jsonb_build_object(
        'bank_actual_sdg', n_bank::text, 'bank_computed_sdg', f.bank_cost_sdg::text, 'bank_variance_sdg', (n_bank - f.bank_cost_sdg)::text,
        'permit_actual_sdg', n_permit::text, 'permit_entered_sdg', f.import_permit_cost_sdg::text, 'permit_variance_sdg', (n_permit - coalesce(f.import_permit_cost_sdg, 0))::text,
        'commission_sdg', n_comm::text, 'client_total_computed_sdg', f.client_total_sdg::text, 'settled_total_sdg', o_total::text,
        'client_balance_before', bal_before::text, 'client_balance_after', (bal_before - o_total)::text);
    when 'failure_reclass' then
      pb := public.fin_system_account('paid_bank'); pp := public.fin_system_account('paid_permit'); rc := public.fin_system_account('recoverable');
      n_bank := public.fin_file_role_net(f.id, 'paid_bank'); n_permit := public.fin_file_role_net(f.id, 'paid_permit');
      o_total := n_bank + n_permit;
      o_lines := jsonb_build_array(public.fin_ln(rc.id, o_total, 0, v.client_id, f.id, 'failure: paid on behalf now recoverable from bank/parties'));
      if n_bank > 0 then o_lines := o_lines || jsonb_build_array(public.fin_ln(pb.id, 0, n_bank, v.client_id, f.id, 'bank payment reclassified')); end if;
      if n_permit > 0 then o_lines := o_lines || jsonb_build_array(public.fin_ln(pp.id, 0, n_permit, v.client_id, f.id, 'permit payment reclassified')); end if;
      o_details := jsonb_build_object('bank_sdg', n_bank::text, 'permit_sdg', n_permit::text, 'client_balance', public.fin_client_balance(v.client_id, f.id)::text);
    when 'balance_transfer' then
      o_total := v.amount;
      o_lines := jsonb_build_array(public.fin_ln(cc.id, v.amount, 0, v.client_id, v.financial_file_id, 'allocation out: ' || coalesce(v.reason, '')), public.fin_ln(cc.id, 0, v.amount, v.client_id, v.target_file_id, 'allocation in: ' || coalesce(v.reason, '')));
      o_details := jsonb_build_object('source_balance_before', public.fin_client_balance(v.client_id, v.financial_file_id)::text, 'target_balance_before', public.fin_client_balance(v.client_id, v.target_file_id)::text);
    when 'adjustment' then
      o_total := v.amount;
      select * into pb from public.fin_accounts where id = v.counter_account_id;
      -- المحمَّل على العميل من هذا الحساب قبل التعديل = ما حمّلته التسوية والتعديلات السابقة (وعكوسها)
      n_bank := coalesce((select sum(l.credit - l.debit) from public.fin_journal_lines l join public.fin_journal_entries e on e.id = l.entry_id join public.fin_vouchers w on w.id = e.voucher_id
                           where l.account_id = pb.id and l.financial_file_id = f.id and w.voucher_type in ('settlement','adjustment')), 0);
      if v.direction = 'charge' then
        o_lines := jsonb_build_array(public.fin_ln(cc.id, v.amount, 0, v.client_id, f.id, v.reason), public.fin_ln(pb.id, 0, v.amount, v.client_id, f.id, v.reason));
      else
        o_lines := jsonb_build_array(public.fin_ln(pb.id, v.amount, 0, v.client_id, f.id, v.reason), public.fin_ln(cc.id, 0, v.amount, v.client_id, f.id, v.reason));
      end if;
      o_details := jsonb_build_object('adjusted_account', pb.code, 'direction', v.direction,
        'charged_before', n_bank::text, 'charged_after', (n_bank + case when v.direction = 'charge' then v.amount else -v.amount end)::text,
        'client_balance_before', public.fin_client_balance(v.client_id, f.id)::text,
        'client_balance_after', (public.fin_client_balance(v.client_id, f.id) + case when v.direction = 'charge' then -v.amount else v.amount end)::text);
  end case;
  if o_total is null or o_total <= 0 then raise exception 'Voucher total must be greater than zero (got %)', o_total; end if;
end $$;

-- المكوّنات التي تُربط بها مراجعة المعتمد (نصوص) — تُقارن عند الترحيل
create function public.fin_components(p_type text, p_details jsonb)
returns jsonb language sql immutable as $$
  select case p_type
    when 'settlement' then jsonb_build_object('bank_actual_sdg', p_details->>'bank_actual_sdg', 'permit_actual_sdg', p_details->>'permit_actual_sdg',
                                              'commission_sdg', p_details->>'commission_sdg', 'settled_total_sdg', p_details->>'settled_total_sdg')
    when 'failure_reclass' then jsonb_build_object('bank_sdg', p_details->>'bank_sdg', 'permit_sdg', p_details->>'permit_sdg')
    else '{}'::jsonb end;
$$;

create function public.fin_preview_details(v public.fin_vouchers)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b record;
begin
  select * into b from public.fin_build_lines(v);
  return b.o_details || jsonb_build_object('preview', true, 'lines', b.o_lines, 'total', b.o_total::text);
end $$;

-- معاينة التسوية لملف (بلا سند): المكوّنات والفروق كما ستُرحَّل الآن
create function public.preview_fin_settlement(p_file uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.fin_vouchers%rowtype;
begin
  if not public.bsgt_financial_center_can('view') then raise exception 'Financial center view permission required'; end if;
  v.id := gen_random_uuid(); v.company_id := public.fin_company(); v.voucher_type := 'settlement'; v.status := 'draft'; v.voucher_date := current_date;
  v.financial_file_id := p_file; v.details := '{}'::jsonb;
  v := public.fin_validate_voucher(v);
  return public.fin_preview_details(v);
end $$;

-- ===== 7) السندات: الإنشاء والتعديل والإلغاء =====
create function public.fin_apply_patch(v public.fin_vouchers, p jsonb, p_allowed text[])
returns public.fin_vouchers language plpgsql immutable as $$
declare k text;
begin
  for k in select jsonb_object_keys(p) loop
    if not (k = any(p_allowed)) then raise exception 'Field % cannot be set here', k; end if;
  end loop;
  if p ? 'voucher_date'       then v.voucher_date := nullif(p->>'voucher_date', '')::date; end if;
  if p ? 'amount'             then v.amount := nullif(btrim(coalesce(p->>'amount', '')), '')::numeric; end if;
  if p ? 'cash_account_id'    then v.cash_account_id := nullif(p->>'cash_account_id', '')::uuid; end if;
  if p ? 'counter_account_id' then v.counter_account_id := nullif(p->>'counter_account_id', '')::uuid; end if;
  if p ? 'client_id'          then v.client_id := nullif(p->>'client_id', '')::uuid; end if;
  if p ? 'financial_file_id'  then v.financial_file_id := nullif(p->>'financial_file_id', '')::uuid; end if;
  if p ? 'target_file_id'     then v.target_file_id := nullif(p->>'target_file_id', '')::uuid; end if;
  if p ? 'purpose'            then v.purpose := nullif(btrim(coalesce(p->>'purpose', '')), ''); end if;
  if p ? 'direction'          then v.direction := nullif(btrim(coalesce(p->>'direction', '')), ''); end if;
  if p ? 'reference'          then v.reference := nullif(btrim(coalesce(p->>'reference', '')), ''); end if;
  if p ? 'memo'               then v.memo := nullif(btrim(coalesce(p->>'memo', '')), ''); end if;
  if p ? 'reason'             then v.reason := nullif(btrim(coalesce(p->>'reason', '')), ''); end if;
  if p ? 'amount' and jsonb_typeof(p->'amount') = 'number' then
    raise exception 'Amount must be sent as a string to preserve precision';
  end if;
  return v;
end $$;

create function public.create_fin_voucher(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid := public.fin_company(); v public.fin_vouchers%rowtype; e public.fin_vouchers%rowtype; v_req uuid; v_uid uuid := auth.uid();
begin
  if not public.bsgt_financial_center_can('edit') then raise exception 'Financial center edit permission required'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Payload must be a JSON object'; end if;
  v_req := nullif(p->>'request_id', '')::uuid;
  if v_req is not null then
    select * into e from public.fin_vouchers where company_id = c and request_id = v_req;
    if found then return jsonb_build_object('voucher', public.fin_voucher_json(e), 'voucher_id', e.id, 'lock_version', e.lock_version, 'created', false); end if;
  end if;
  v.id := gen_random_uuid(); v.company_id := c; v.request_id := v_req; v.status := 'draft'; v.details := '{}'::jsonb; v.lock_version := 1;
  v.voucher_type := p->>'voucher_type';
  if v.voucher_type is null then raise exception 'voucher_type is required'; end if;
  v := public.fin_apply_patch(v, p - 'request_id' - 'voucher_type',
         '{voucher_date,amount,cash_account_id,counter_account_id,client_id,financial_file_id,target_file_id,purpose,direction,reference,memo,reason}');
  v.voucher_date := coalesce(v.voucher_date, current_date);
  v := public.fin_validate_voucher(v);
  if v.voucher_type in ('settlement','failure_reclass') then v.details := public.fin_preview_details(v); end if;   -- معاينة المكوّنات للمراجعة
  v.last_input_at := now(); v.last_input_by := v_uid; v.created_by := v_uid; v.updated_by := v_uid; v.created_at := now(); v.updated_at := now();
  insert into public.fin_vouchers select v.*;
  perform public.fin_log('voucher', v.id, 'created', null, 'draft', 1, null, jsonb_build_object('voucher_type', v.voucher_type, 'amount', v.amount::text, 'financial_file_id', v.financial_file_id, 'client_id', v.client_id));
  return jsonb_build_object('voucher', public.fin_voucher_json(v), 'voucher_id', v.id, 'lock_version', 1, 'created', true);
exception when unique_violation then
  -- سباق على نفس request_id: أعد السند القائم
  if v_req is not null then
    select * into e from public.fin_vouchers where company_id = c and request_id = v_req;
    if found then return jsonb_build_object('voucher', public.fin_voucher_json(e), 'voucher_id', e.id, 'lock_version', e.lock_version, 'created', false); end if;
  end if;
  raise;
end $$;

create function public.update_fin_voucher_draft(p_id uuid, p_expected_lock_version bigint, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.fin_vouchers%rowtype; v public.fin_vouchers%rowtype; v_changes jsonb := '{}'::jsonb; k text;
begin
  if not public.bsgt_financial_center_can('edit') then raise exception 'Financial center edit permission required'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Patch must be a JSON object'; end if;
  o := public.fin_lock_voucher(p_id, p_expected_lock_version, '{draft}');
  v := public.fin_apply_patch(o, p_patch, '{voucher_date,amount,cash_account_id,counter_account_id,client_id,financial_file_id,target_file_id,purpose,direction,reference,memo,reason}');
  v := public.fin_validate_voucher(v);
  if v.voucher_type in ('settlement','failure_reclass') then
    v.details := public.fin_preview_details(v);                          -- تحديث المعاينة (حتى بلا patch)
    if public.fin_components(v.voucher_type, v.details) <> public.fin_components(v.voucher_type, o.details) then
      v_changes := v_changes || jsonb_build_object('components', jsonb_build_array(public.fin_components(v.voucher_type, o.details), public.fin_components(v.voucher_type, v.details)));
    end if;
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if to_jsonb(o)->k is distinct from to_jsonb(v)->k then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(
        case when k = 'amount' then to_jsonb(o.amount::text) else to_jsonb(o)->k end,
        case when k = 'amount' then to_jsonb(v.amount::text) else to_jsonb(v)->k end));
    end if;
  end loop;
  if v_changes = '{}'::jsonb then return jsonb_build_object('voucher', public.fin_voucher_json(o), 'lock_version', o.lock_version, 'changed', false); end if;
  update public.fin_vouchers set voucher_date = v.voucher_date, amount = v.amount, cash_account_id = v.cash_account_id, counter_account_id = v.counter_account_id,
         client_id = v.client_id, financial_file_id = v.financial_file_id, target_file_id = v.target_file_id, purpose = v.purpose, direction = v.direction,
         reference = v.reference, memo = v.memo, reason = v.reason, details = v.details, last_input_at = now(), last_input_by = auth.uid()
   where id = p_id returning * into v;
  perform public.fin_log('voucher', v.id, 'draft_updated', 'draft', 'draft', v.lock_version, null, v_changes);
  return jsonb_build_object('voucher', public.fin_voucher_json(v), 'lock_version', v.lock_version, 'changed', true);
end $$;

create function public.cancel_fin_voucher(p_id uuid, p_expected_lock_version bigint, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.fin_vouchers%rowtype;
begin
  if not public.bsgt_financial_center_can('edit') then raise exception 'Financial center edit permission required'; end if;
  v := public.fin_lock_voucher(p_id, p_expected_lock_version, '{draft}');
  perform set_config('jahez.fin_post', 'on', true);
  update public.fin_vouchers set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), reason = coalesce(nullif(btrim(p_reason), ''), reason) where id = p_id returning * into v;
  perform set_config('jahez.fin_post', 'off', true);
  perform public.fin_log('voucher', v.id, 'cancelled', 'draft', 'cancelled', v.lock_version, nullif(btrim(p_reason), ''), null);
  return jsonb_build_object('voucher', public.fin_voucher_json(v), 'lock_version', v.lock_version);
end $$;

-- ===== 8) الترحيل والعكس =====
-- ترتيب الأقفال الموحّد: العميل (استشاري) ← الملفات بترتيب id ← السند ← العدادات
create function public.fin_lock_scope(v public.fin_vouchers)
returns void language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  perform public.fin_lock_client(v.client_id);
  for fid in select x from unnest(array_remove(array[v.financial_file_id, v.target_file_id], null)) as u(x) order by x loop
    perform public.fin_lock_file(fid);
  end loop;
end $$;

create function public.fin_insert_entry(v public.fin_vouchers, p_kind text, p_reverses uuid, p_lines jsonb, p_total numeric, p_memo text)
returns public.fin_journal_entries language plpgsql security definer set search_path = public as $$
declare e public.fin_journal_entries%rowtype; l jsonb; i integer := 0; d numeric; cr numeric;
begin
  insert into public.fin_journal_entries (company_id, entry_no, entry_date, voucher_id, kind, reverses_entry_id, memo, total_debit, total_credit, posted_by)
  values (v.company_id, public.fin_next_no(v.company_id, 'JE', current_date), case when p_kind = 'post' then v.voucher_date else current_date end,
          v.id, p_kind, p_reverses, p_memo, p_total, p_total, auth.uid()) returning * into e;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    d := (l->>'debit')::numeric; cr := (l->>'credit')::numeric;
    if p_kind = 'reversal' then d := (l->>'credit')::numeric; cr := (l->>'debit')::numeric; end if;   -- قيد مرآة
    insert into public.fin_journal_lines (entry_id, company_id, line_no, account_id, debit, credit, client_id, financial_file_id, memo)
    values (e.id, v.company_id, i, (l->>'account_id')::uuid, d, cr, nullif(l->>'client_id', '')::uuid, nullif(l->>'financial_file_id', '')::uuid, l->>'memo');
  end loop;
  set constraints all immediate;   -- افحص التوازن الآن لا عند الالتزام
  set constraints all deferred;
  return e;
end $$;

create function public.post_fin_voucher(p_id uuid, p_expected_lock_version bigint, p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.fin_vouchers%rowtype; e public.fin_journal_entries%rowtype; b record; v_uid uuid := auth.uid(); v_note text;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  select * into v from public.fin_vouchers where id = p_id;
  if not found then raise exception 'Voucher not found'; end if;
  perform public.fin_lock_scope(v);
  v := public.fin_lock_voucher(p_id, p_expected_lock_version, null);
  if v.status = 'posted' then raise exception 'Voucher is already posted (%)', v.voucher_no; end if;
  if v.status <> 'draft' then raise exception 'Only draft vouchers can be posted (status %)', v.status; end if;
  if v.last_input_by = v_uid then                                        -- الفصل بين المُدخل والمُعتمد على آخر من عدّل السند
    if not public.is_admin() or coalesce(btrim(p_override_reason), '') = '' then
      raise exception 'Maker-checker: the last person who entered this voucher cannot post it';
    end if;
    v_note := 'ADMIN OVERRIDE (maker-checker): ' || btrim(p_override_reason);
  end if;
  v := public.fin_validate_voucher(v);                                   -- إعادة التحقق تحت الأقفال
  select * into b from public.fin_build_lines(v);
  -- المكوّنات المحسوبة (تسوية/إعادة تصنيف) يجب أن تطابق ما راجعه المعتمد في المسودة؛ وإلا تُطلب مراجعة جديدة ولا يُرحّل مبلغ مختلف بصمت
  if v.voucher_type in ('settlement','failure_reclass') and public.fin_components(v.voucher_type, b.o_details) <> public.fin_components(v.voucher_type, v.details) then
    raise exception 'Computed components changed since the draft was reviewed (reviewed %, now %); refresh the draft (update_fin_voucher_draft) and review again',
      public.fin_components(v.voucher_type, v.details), public.fin_components(v.voucher_type, b.o_details);
  end if;
  v.voucher_no := public.fin_next_no(v.company_id, public.fin_prefix(v.voucher_type), v.voucher_date);
  e := public.fin_insert_entry(v, 'post', null, b.o_lines, b.o_total, coalesce(v.memo, v.voucher_type || ' ' || v.voucher_no));
  perform set_config('jahez.fin_post', 'on', true);
  update public.fin_vouchers
     set status = 'posted', voucher_no = v.voucher_no, amount = b.o_total, client_id = v.client_id, purpose = v.purpose,
         details = b.o_details, journal_entry_id = e.id, posted_seq = e.posting_seq, posted_at = now(), posted_by = v_uid
   where id = p_id returning * into v;
  perform set_config('jahez.fin_post', 'off', true);
  perform public.fin_log('voucher', v.id, 'posted', 'draft', 'posted', v.lock_version, v_note, jsonb_build_object('voucher_no', v.voucher_no, 'entry_no', e.entry_no, 'total', b.o_total::text) || b.o_details);
  return jsonb_build_object('voucher', public.fin_voucher_json(v), 'entry', public.fin_entry_json(e), 'lock_version', v.lock_version);
end $$;

-- العكس: قيد مرآة مرتبط بالأصل (الأصل لا يُمس)؛ ممنوع إن وُجد سند مرحّل لاحق في نفس النطاق أو استُهلك الرصيد
create function public.reverse_fin_voucher(p_id uuid, p_expected_lock_version bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.fin_vouchers%rowtype; o public.fin_journal_entries%rowtype; e public.fin_journal_entries%rowtype; later record; v_lines jsonb; dep numeric;
begin
  if not public.bsgt_financial_center_can('approve') then raise exception 'Financial center approve permission required'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Reversal reason is required'; end if;
  select * into v from public.fin_vouchers where id = p_id;
  if not found then raise exception 'Voucher not found'; end if;
  perform public.fin_lock_scope(v);
  v := public.fin_lock_voucher(p_id, p_expected_lock_version, null);
  if v.status = 'reversed' then raise exception 'Voucher is already reversed'; end if;
  if v.status <> 'posted' then raise exception 'Only posted vouchers can be reversed (status %)', v.status; end if;
  -- (أ) سند مرحّل لاحق (بترتيب الترحيل posted_seq، لا بالوقت) يعتمد على هذا السند ⇒ اعكس اللاحق أولاً
  select w.voucher_no, w.voucher_type into later from public.fin_vouchers w
   where w.company_id = v.company_id and w.status = 'posted' and w.id <> v.id and w.posted_seq > v.posted_seq
     and case v.voucher_type
       -- قبض/تخصيص وارد: يعتمد عليه كل ما يستهلك أمانة العميل في نفس النطاق (رد، تخصيص صادر)
       when 'receipt' then w.voucher_type in ('refund','balance_transfer') and w.client_id = v.client_id and w.financial_file_id is not distinct from v.financial_file_id
       when 'balance_transfer' then (w.voucher_type in ('refund','balance_transfer') and w.client_id = v.client_id and w.financial_file_id is not distinct from v.target_file_id)
       -- دفع نيابة: تعتمد عليه التسوية/إعادة التصنيف/التعديل على نفس الملف
       when 'payment_bank' then w.voucher_type in ('settlement','failure_reclass','adjustment','recovery') and w.financial_file_id = v.financial_file_id
       when 'payment_permit' then w.voucher_type in ('settlement','failure_reclass','adjustment','recovery') and w.financial_file_id = v.financial_file_id
       -- التسوية: يعتمد عليها كل ما يقتضي ملفاً مُسوًّى
       when 'settlement' then w.voucher_type in ('adjustment','recovery','payment_bank','payment_permit') and w.financial_file_id = v.financial_file_id
       -- إعادة التصنيف: تعتمد عليها الاستردادات من 1500
       when 'failure_reclass' then w.voucher_type = 'recovery' and w.financial_file_id = v.financial_file_id
       -- التعديل: يعتمد عليه ما يدفع/يستردّ/يردّ الفرق بعده على نفس الملف، وأي تعديل لاحق
       when 'adjustment' then w.voucher_type in ('adjustment','payment_bank','payment_permit','recovery','refund') and w.financial_file_id = v.financial_file_id
       when 'recovery' then w.voucher_type = 'recovery' and w.financial_file_id = v.financial_file_id
       else false end
   order by w.posted_seq desc limit 1;
  if found then raise exception 'Reverse the later voucher % (%) first', later.voucher_no, later.voucher_type; end if;
  -- (ب) أمانة العميل (قبض + تخصيص وارد − رد − تخصيص صادر) يجب ألا تصبح سالبة: سداد مديونية يُعكس بحرية، أما أمانة استُهلكت برد/تخصيص فلا
  if v.voucher_type = 'receipt' then
    dep := public.fin_client_deposit(v.client_id, v.financial_file_id);
    if dep - v.amount < 0 then raise exception 'Receipt was already consumed by a later refund/allocation (deposit %, receipt %)', dep, v.amount; end if;
  elsif v.voucher_type = 'balance_transfer' then
    dep := public.fin_client_deposit(v.client_id, v.target_file_id);
    if dep - v.amount < 0 then raise exception 'Allocated balance was already consumed on the target file (deposit %)', dep; end if;
  end if;
  -- الدفع نيابة وإعادة التصنيف: الاعتمادية تُحسم بالترتيب (أ) فقط — لا بصافي حساب التكلفة، لأن الصافي يكون صفراً
  -- بعد التسوية عندما يُدفع فرق سبق تحميله (adjustment) ثم يُعكس الدفع بحق
  select * into o from public.fin_journal_entries where id = v.journal_entry_id;
  select coalesce(jsonb_agg(public.fin_ln(l.account_id, l.debit, l.credit, l.client_id, l.financial_file_id, l.memo) order by l.line_no), '[]'::jsonb)
    into v_lines from public.fin_journal_lines l where l.entry_id = o.id;
  e := public.fin_insert_entry(v, 'reversal', o.id, v_lines, o.total_debit, 'reversal of ' || o.entry_no || ': ' || btrim(p_reason));
  perform set_config('jahez.fin_post', 'on', true);
  update public.fin_vouchers set status = 'reversed', reversal_entry_id = e.id, reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason)
   where id = p_id returning * into v;
  perform set_config('jahez.fin_post', 'off', true);
  perform public.fin_log('voucher', v.id, 'reversed', 'posted', 'reversed', v.lock_version, btrim(p_reason), jsonb_build_object('original_entry_no', o.entry_no, 'reversal_entry_no', e.entry_no));
  return jsonb_build_object('voucher', public.fin_voucher_json(v), 'reversal_entry', public.fin_entry_json(e), 'lock_version', v.lock_version);
end $$;

-- ===== 9) القراءة والتقارير (definer، عرض فقط، نطاق الشركة) =====
create function public.get_fin_voucher(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.fin_vouchers%rowtype;
begin
  if not public.bsgt_financial_center_can('view') then raise exception 'Financial center view permission required'; end if;
  select * into v from public.fin_vouchers where id = p_id and company_id = public.fin_company();
  if not found then raise exception 'Voucher not found'; end if;
  return jsonb_build_object('voucher', public.fin_voucher_json(v),
    'entry', (select public.fin_entry_json(e) from public.fin_journal_entries e where e.id = v.journal_entry_id),
    'reversal_entry', (select public.fin_entry_json(e) from public.fin_journal_entries e where e.id = v.reversal_entry_id),
    'events', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at, x.id), '[]'::jsonb) from public.fin_ledger_events x where x.entity_type = 'voucher' and x.entity_id = v.id));
end $$;

create function public.list_fin_vouchers(p_status text default null, p_type text default null, p_file uuid default null, p_client uuid default null,
  p_search text default null, p_limit integer default 10, p_after_created_at timestamptz default null, p_after_id uuid default null)
returns table (id uuid, voucher_no text, voucher_type text, status text, voucher_date date, amount text, client_id uuid, client_name text,
  financial_file_id uuid, operation_no text, cash_account_code text, purpose text, reference text, memo text, lock_version bigint, created_at timestamptz, posted_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_search text := nullif(left(btrim(coalesce(p_search, '')), 64), ''); v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if not public.bsgt_financial_center_can('view') then raise exception 'Financial center view permission required'; end if;
  if (p_after_created_at is null) <> (p_after_id is null) then raise exception 'Cursor requires both created_at and id'; end if;
  return query
  select v.id, v.voucher_no, v.voucher_type, v.status, v.voucher_date, v.amount::text, v.client_id, c.name, v.financial_file_id, t.operation_no,
         a.code, v.purpose, v.reference, v.memo, v.lock_version, v.created_at, v.posted_at
    from public.fin_vouchers v
    left join public.clients c on c.id = v.client_id
    left join public.bsgt_financial_files f on f.id = v.financial_file_id
    left join public.trade_collection_files t on t.id = f.trade_file_id
    left join public.fin_accounts a on a.id = v.cash_account_id
   where v.company_id = public.fin_company()
     and (p_status is null or v.status = p_status) and (p_type is null or v.voucher_type = p_type)
     and (p_file is null or v.financial_file_id = p_file or v.target_file_id = p_file) and (p_client is null or v.client_id = p_client)
     and (v_search is null or v.voucher_no ilike v_search || '%' or v.reference ilike '%' || v_search || '%' or c.name ilike '%' || v_search || '%' or t.operation_no ilike v_search || '%')
     and (p_after_created_at is null or (v.created_at, v.id) < (p_after_created_at, p_after_id))
   order by v.created_at desc, v.id desc
   limit v_limit;
end $$;

-- مجاميع دفتر الملف: كل الأرقام نصوص؛ الأصل وعكسه يُحتسبان معاً لأن كليهما سطور قيد
create function public.fin_file_ledger_totals(p_file uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f public.bsgt_financial_files%rowtype; s public.fin_file_ledger_state%rowtype; r record; dep numeric; chg numeric;
begin
  if not public.bsgt_financial_center_can('view') then raise exception 'Financial center view permission required'; end if;
  select * into f from public.bsgt_financial_files where id = p_file and company_id = public.fin_company();
  if not found then raise exception 'Financial file not found'; end if;
  select * into s from public.fin_file_ledger_state where financial_file_id = p_file;
  select
    coalesce(sum(case when v.voucher_type = 'receipt' and v.purpose <> 'commission_advance' then sg * v.amount end), 0) receipts,
    coalesce(sum(case when v.voucher_type = 'receipt' and v.purpose = 'commission_advance' then sg * v.amount end), 0) commission_advance,
    coalesce(sum(case when v.voucher_type = 'refund' then sg * v.amount end), 0) refunds,
    coalesce(sum(case when v.voucher_type = 'balance_transfer' and v.financial_file_id = p_file then sg * v.amount end), 0) allocated_out,
    coalesce(sum(case when v.voucher_type = 'balance_transfer' and v.target_file_id = p_file then sg * v.amount end), 0) allocated_in,
    coalesce(sum(case when v.voucher_type = 'payment_bank' then sg * v.amount end), 0) bank_paid,
    coalesce(sum(case when v.voucher_type = 'payment_permit' then sg * v.amount end), 0) permit_paid,
    coalesce(sum(case when v.voucher_type = 'recovery' then sg * v.amount end), 0) recovered,
    bool_or(v.voucher_type = 'settlement' and v.status = 'posted') settled,
    bool_or(v.voucher_type = 'failure_reclass' and v.status = 'posted') failure_reclassified
    into r
    from (select v.*, case when v.status = 'posted' then 1 else 0 end sg from public.fin_vouchers v
           where (v.financial_file_id = p_file or v.target_file_id = p_file) and v.status in ('posted','reversed')) v;
  dep := public.fin_client_deposit(f.client_id, p_file);      -- أمانة العميل: قبض + تخصيص وارد − رد − تخصيص صادر
  chg := public.fin_client_charged(f.client_id, p_file);      -- المحمَّل عليه: التسوية + التعديلات
  return jsonb_build_object(
    'financial_file_id', p_file, 'ledger_mode', s.ledger_mode, 'delivery_confirmed_at', s.delivery_confirmed_at,
    'approved_bank_cost_sdg', s.approved_bank_cost_sdg::text, 'approved_permit_cost_sdg', s.approved_permit_cost_sdg::text, 'costs_approved_at', s.costs_approved_at,
    'receipts_sdg', r.receipts::text, 'commission_advance_sdg', r.commission_advance::text, 'refunds_sdg', r.refunds::text,
    'allocated_in_sdg', r.allocated_in::text, 'allocated_out_sdg', r.allocated_out::text,
    'client_deposit_sdg', dep::text,                            -- صافي ما بيد BSGT من العميل لهذا الملف (بعد الردود والتخصيص)
    'client_charged_sdg', chg::text,                            -- ما حُمِّل على العميل (تسوية + تعديلات)
    'client_balance_sdg', (dep - chg)::text, 'balance_for_client_sdg', greatest(dep - chg, 0)::text, 'due_from_client_sdg', greatest(chg - dep, 0)::text,
    'bank_paid_sdg', r.bank_paid::text, 'permit_paid_sdg', r.permit_paid::text,
    'bank_unbilled_sdg', public.fin_file_role_net(p_file, 'paid_bank')::text,      -- صافي 1410 للملف: موجب = مدفوع غير محمَّل، سالب = محمَّل/مستردّ غير مدفوع
    'permit_unbilled_sdg', public.fin_file_role_net(p_file, 'paid_permit')::text,
    'recoverable_outstanding_sdg', public.fin_file_role_net(p_file, 'recoverable')::text, 'recovered_sdg', r.recovered::text,
    'client_total_computed_sdg', f.client_total_sdg::text, 'bank_cost_computed_sdg', f.bank_cost_sdg::text, 'commission_sdg', f.bsgt_commission_sdg::text,
    'settled', coalesce(r.settled, false), 'failure_reclassified', coalesce(r.failure_reclassified, false));
end $$;

-- كشف حساب العميل (2100) مع رصيد جارٍ: موجب = رصيد للعميل، سالب = مطلوب منه
create function public.fin_client_statement(p_client uuid, p_file uuid default null, p_from date default null, p_to date default null)
returns table (row_kind text, entry_date date, entry_no text, entry_kind text, voucher_no text, voucher_type text, financial_file_id uuid, operation_no text,
               memo text, debit text, credit text, balance text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.bsgt_financial_center_can('view') then raise exception 'Financial center view permission required'; end if;
  if p_client is null then raise exception 'Client is required'; end if;
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'Period end must not be before its start'; end if;
  return query
  with x as (
    -- كل حركات 2100 للعميل (والملف إن حُدد) بترتيب ترحيل ثابت؛ الرصيد الجاري يُحسب على الكل ثم تُصفّى الصفوف المعروضة
    select e.entry_date, e.entry_no, e.kind, v.voucher_no, v.voucher_type, l.financial_file_id, t.operation_no, l.memo, l.debit, l.credit, e.posting_seq, l.line_no,
           sum(l.credit - l.debit) over (order by e.entry_date, e.posting_seq, l.line_no rows unbounded preceding) as running
      from public.fin_journal_lines l
      join public.fin_accounts a on a.id = l.account_id and a.role = 'client_control'
      join public.fin_journal_entries e on e.id = l.entry_id
      join public.fin_vouchers v on v.id = e.voucher_id
      left join public.bsgt_financial_files f on f.id = l.financial_file_id
      left join public.trade_collection_files t on t.id = f.trade_file_id
     where l.company_id = public.fin_company() and l.client_id = p_client and (p_file is null or l.financial_file_id = p_file)),
  opening as (select coalesce((select sum(x.credit - x.debit) from x where p_from is not null and x.entry_date < p_from), 0) as bal),
  shown as (select * from x where (p_from is null or x.entry_date >= p_from) and (p_to is null or x.entry_date <= p_to)),
  closing as (select coalesce((select sum(x.credit - x.debit) from x where p_to is null or x.entry_date <= p_to), 0) as bal)
  select u.row_kind, u.entry_date, u.entry_no, u.entry_kind, u.voucher_no, u.voucher_type, u.financial_file_id, u.operation_no, u.memo, u.debit, u.credit, u.balance
    from (
      select 'opening'::text as row_kind, p_from as entry_date, null::text as entry_no, null::text as entry_kind, null::text as voucher_no, null::text as voucher_type,
             null::uuid as financial_file_id, null::text as operation_no, 'opening balance'::text as memo, null::text as debit, null::text as credit, (select bal from opening)::text as balance, 0 as ord, 0::bigint as seq, 0 as ln
      union all
      select 'line', sh.entry_date, sh.entry_no, sh.kind, sh.voucher_no, sh.voucher_type, sh.financial_file_id, sh.operation_no, sh.memo, sh.debit::text, sh.credit::text, sh.running::text, 1, sh.posting_seq, sh.line_no
        from shown sh
      union all
      select 'closing', p_to, null, null, null, null, null, null, 'closing balance', coalesce((select sum(sh.debit) from shown sh), 0)::text, coalesce((select sum(sh.credit) from shown sh), 0)::text, (select bal from closing)::text, 2, 0, 0
    ) u
   order by u.ord, u.entry_date, u.seq, u.ln;
end $$;

create function public.fin_trial_balance(p_as_of date default null)
returns table (code text, name_ar text, kind text, role text, is_system boolean, debit_total text, credit_total text, balance_debit text, balance_credit text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.bsgt_financial_center_can('view') then raise exception 'Financial center view permission required'; end if;
  return query
  select a.code, a.name_ar, a.kind, a.role, a.is_system, coalesce(t.d, 0)::text, coalesce(t.c, 0)::text,
         greatest(coalesce(t.d, 0) - coalesce(t.c, 0), 0)::text, greatest(coalesce(t.c, 0) - coalesce(t.d, 0), 0)::text
    from public.fin_accounts a
    left join lateral (select sum(l.debit) d, sum(l.credit) c from public.fin_journal_lines l join public.fin_journal_entries e on e.id = l.entry_id
                        where l.account_id = a.id and (p_as_of is null or e.entry_date <= p_as_of)) t on true
   where a.company_id = public.fin_company() and a.postable
   order by a.code;
end $$;

-- ===== 10) RLS: select فقط، نطاق الشركة =====
alter table public.fin_ledger_settings   enable row level security;
alter table public.fin_accounts          enable row level security;
alter table public.fin_vouchers          enable row level security;
alter table public.fin_journal_entries   enable row level security;
alter table public.fin_journal_lines     enable row level security;
alter table public.fin_file_ledger_state enable row level security;
alter table public.fin_counters          enable row level security;
alter table public.fin_ledger_events     enable row level security;
create policy fin_settings_select on public.fin_ledger_settings   for select to authenticated using (public.bsgt_financial_center_can('view') and company_id = public.bsgt_company_id());
create policy fin_accounts_select on public.fin_accounts          for select to authenticated using (public.bsgt_financial_center_can('view') and company_id = public.bsgt_company_id());
create policy fin_vouchers_select on public.fin_vouchers          for select to authenticated using (public.bsgt_financial_center_can('view') and company_id = public.bsgt_company_id());
create policy fin_entries_select  on public.fin_journal_entries   for select to authenticated using (public.bsgt_financial_center_can('view') and company_id = public.bsgt_company_id());
create policy fin_lines_select    on public.fin_journal_lines     for select to authenticated using (public.bsgt_financial_center_can('view') and company_id = public.bsgt_company_id());
create policy fin_state_select    on public.fin_file_ledger_state for select to authenticated using (public.bsgt_financial_center_can('view') and company_id = public.bsgt_company_id());
create policy fin_events_select   on public.fin_ledger_events     for select to authenticated using (public.bsgt_financial_center_can('view') and company_id = public.bsgt_company_id());

-- ===== 11) Grants / Revokes =====
revoke all on public.fin_ledger_settings, public.fin_accounts, public.fin_vouchers, public.fin_journal_entries, public.fin_journal_lines,
              public.fin_file_ledger_state, public.fin_counters, public.fin_ledger_events from public, anon, authenticated;
grant select on public.fin_ledger_settings, public.fin_accounts, public.fin_vouchers, public.fin_journal_entries, public.fin_journal_lines,
                public.fin_file_ledger_state, public.fin_ledger_events to authenticated;
-- المساعدات الداخلية: لا تنفيذ لأي دور تطبيق
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fin\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
-- الدوال العامة: authenticated فقط
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('init_fin_chart','create_fin_account','update_fin_account','list_fin_accounts','open_fin_file_ledger','confirm_fin_file_delivery','approve_fin_file_costs',
                              'create_fin_voucher','update_fin_voucher_draft','cancel_fin_voucher','post_fin_voucher','reverse_fin_voucher','get_fin_voucher','preview_fin_settlement',
                              'list_fin_vouchers','fin_file_ledger_totals','fin_client_statement','fin_trial_balance') loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ===== 12) البذر: الحسابات النظامية فقط إن كانت شركة BSGT معرَّفة (لا حسابات نقدية، لا أرصدة، لا تفعيل) =====
do $$
begin
  if public.bsgt_company_id() is not null then perform public.fin_seed_system_accounts(public.bsgt_company_id()); end if;
end $$;

notify pgrst, 'reload schema';
commit;

-- ===== 13) Rollback كامل (لا يمس أي كائن قائم من 53 أو قبلها) =====
-- begin;
-- drop trigger if exists fin_events_immutable on public.fin_ledger_events;
-- drop trigger if exists fin_entries_immutable on public.fin_journal_entries;
-- drop trigger if exists fin_lines_immutable on public.fin_journal_lines;
-- do $$ declare r record; begin
--   for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
--            and (p.proname like 'fin\_%' or p.proname in ('init_fin_chart','create_fin_account','update_fin_account','list_fin_accounts','open_fin_file_ledger','confirm_fin_file_delivery','approve_fin_file_costs',
--                 'create_fin_voucher','update_fin_voucher_draft','cancel_fin_voucher','post_fin_voucher','reverse_fin_voucher','get_fin_voucher','preview_fin_settlement','list_fin_vouchers')) loop
--     execute format('drop function if exists %s cascade', r.sig);   -- cascade = triggers of these functions only
--   end loop;
-- end $$;
-- drop table if exists public.fin_ledger_events;
-- alter table if exists public.fin_vouchers drop constraint if exists fin_vouchers_entry_fk;
-- alter table if exists public.fin_vouchers drop constraint if exists fin_vouchers_reversal_fk;
-- drop table if exists public.fin_journal_lines;
-- drop table if exists public.fin_journal_entries;
-- drop table if exists public.fin_vouchers;
-- drop table if exists public.fin_file_ledger_state;
-- drop table if exists public.fin_counters;
-- drop table if exists public.fin_accounts;
-- drop table if exists public.fin_ledger_settings;
-- drop sequence if exists public.fin_posting_seq;
-- notify pgrst, 'reload schema';
-- commit;
