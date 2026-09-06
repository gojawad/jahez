-- ============================================================
--  إضافة: نوع الشحن الثابت لكل شركة
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

-- كل شركة تعمل في نوع شحن واحد ثابت
alter table public.companies
  add column if not exists ship_type text not null default 'land';

alter table public.companies drop constraint if exists companies_ship_type_check;
alter table public.companies add constraint companies_ship_type_check
  check (ship_type in ('land','sea'));

create index if not exists companies_shiptype_idx on public.companies(ship_type, active);

-- ============================================================
--  تم. حدّد نوع كل شركة من: لوحة التحكم ← الشركات
-- ============================================================
