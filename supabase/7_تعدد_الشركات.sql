-- ============================================================
--  إضافة: تعدد الشركات (حتى 25 شركة أو أكثر)
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

-- ---------- 1) جدول الشركات ----------
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name_ar     text not null,
  name_en     text,
  tagline     text,
  code        text,                    -- كود مختصر يظهر في الأرقام (مثال: OLY)
  active      boolean not null default true,
  is_default  boolean not null default false,
  sort_order  int not null default 0,
  settings    jsonb not null default '{}'::jsonb,  -- الشعار والختم والعناوين والألوان
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists companies_active_idx on public.companies(active, sort_order);
create unique index if not exists companies_code_uniq
  on public.companies(lower(code)) where code is not null and code <> '';

drop trigger if exists companies_touch on public.companies;
create trigger companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();

alter table public.companies enable row level security;

-- الجميع يقرأ (الموظفون يشتغلون على كل الشركات)
drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies
  for select to authenticated using (public.is_active());

-- المدير وحده يضيف ويعدّل ويحذف
drop policy if exists companies_admin on public.companies;
create policy companies_admin on public.companies
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- 2) ربط الشحنة بالشركة ----------
alter table public.shipments
  add column if not exists company_id uuid references public.companies(id) on delete set null;
create index if not exists shipments_company_idx on public.shipments(company_id);

-- ---------- 3) عدّادات الترقيم لكل شركة ----------
create table if not exists public.company_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  kind       text not null check (kind in ('invoice','bill','cert')),
  next_no    bigint not null default 1001,
  primary key (company_id, kind)
);

alter table public.company_counters enable row level security;

drop policy if exists counters_read on public.company_counters;
create policy counters_read on public.company_counters
  for select to authenticated using (public.is_active());

-- أي مستخدم فعّال يقدر يسحب رقماً (لأن إنشاء الشحنة يحتاجه)
drop policy if exists counters_write on public.company_counters;
create policy counters_write on public.company_counters
  for all to authenticated
  using (public.is_active()) with check (public.is_active());

-- يسحب الرقم التالي ويزيد العدّاد — آمن عند الاستخدام المتزامن
create or replace function public.next_number(p_company uuid, p_kind text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v bigint;
begin
  insert into public.company_counters (company_id, kind)
  values (p_company, p_kind)
  on conflict (company_id, kind) do nothing;

  update public.company_counters
     set next_no = next_no + 1
   where company_id = p_company and kind = p_kind
  returning next_no - 1 into v;

  return v;
end;
$$;

-- ---------- 4) ترحيل الشركة الحالية ----------
-- ننقل إعدادات الشركة الموجودة إلى أول سجل في الجدول الجديد
do $$
declare
  v_settings jsonb;
  v_name text;
  v_id uuid;
begin
  if exists (select 1 from public.companies) then
    return;   -- تم الترحيل من قبل
  end if;

  select value into v_settings from public.settings where key = 'company';
  v_name := coalesce(v_settings->>'nameAr', 'الشركة الرئيسية');

  insert into public.companies (name_ar, name_en, tagline, is_default, sort_order, settings)
  values (
    v_name,
    v_settings->>'nameEn',
    v_settings->>'tagline',
    true, 0,
    coalesce(v_settings, '{}'::jsonb)
  )
  returning id into v_id;

  -- كل الشحنات الحالية تتبع هذه الشركة
  update public.shipments set company_id = v_id where company_id is null;

  -- عدّادات تبدأ بعد أعلى رقم مستخدم حالياً
  insert into public.company_counters (company_id, kind, next_no)
  values
    (v_id, 'invoice', greatest(1001, coalesce((
        select max((regexp_replace(data->>'invoiceNo','[^0-9]','','g'))::bigint)
        from public.shipments
        where data->>'invoiceNo' ~ '^[0-9]+$'), 1000) + 1)),
    (v_id, 'bill', greatest(100001, coalesce((
        select max((regexp_replace(data->>'billNo','[^0-9]','','g'))::bigint)
        from public.shipments
        where data->>'billNo' ~ '^[0-9]+$'), 100000) + 1)),
    (v_id, 'cert', greatest(1, coalesce((
        select max(right(regexp_replace(data->>'certNo','[^0-9]','','g'), 3)::bigint)
        from public.shipments
        where data->>'certNo' ~ '^[0-9]{9}$'), 0) + 1))
  on conflict (company_id, kind) do nothing;
end $$;

-- ---------- 5) شركة واحدة فقط تكون الافتراضية ----------
create or replace function public.one_default_company()
returns trigger language plpgsql as $$
begin
  if new.is_default then
    update public.companies set is_default = false
     where id <> new.id and is_default;
  end if;
  return new;
end; $$;

drop trigger if exists companies_one_default on public.companies;
create trigger companies_one_default
  after insert or update of is_default on public.companies
  for each row when (new.is_default) execute function public.one_default_company();

-- ============================================================
--  تم. أضف شركاتك من: لوحة التحكم ← الشركات
-- ============================================================
