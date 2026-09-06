-- ============================================================
--  دليل السلع (Commodity Catalog) — قاعدة مركزية موحّدة للسلع
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة، ولا يمس أي بيانات موجودة في lookups
-- ============================================================

-- ---------- الجدول الرئيسي ----------
create table if not exists public.commodities (
  id               uuid primary key default gen_random_uuid(),
  arabic_name      text not null,
  english_name     text,
  hs_code          text,
  category         text,
  subcategory      text,
  arabic_keywords  text,
  english_keywords text,
  aliases          text,
  usage_count      int  not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists commodities_hs_code_idx     on public.commodities(hs_code);
create index if not exists commodities_arabic_name_idx  on public.commodities(arabic_name);
create index if not exists commodities_english_name_idx on public.commodities(lower(english_name));
create index if not exists commodities_usage_idx        on public.commodities(usage_count desc);

alter table public.commodities enable row level security;

drop policy if exists commodities_read on public.commodities;
create policy commodities_read on public.commodities
  for select to authenticated using (public.is_active());
drop policy if exists commodities_admin on public.commodities;
create policy commodities_admin on public.commodities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- ربط اختياري بين عناصر "القوائم الجاهزة" الحالية وسلعة في الدليل ----------
-- عمود جديد فقط — لا يمس أي صف أو نص موجود في lookups. أي عنصر بدون ربط
-- يستمر يعمل بالضبط كما كان قبل هذا التحديث.
alter table public.lookups add column if not exists commodity_id uuid references public.commodities(id) on delete set null;
create index if not exists lookups_commodity_idx on public.lookups(commodity_id);

-- ---------- زيادة عدّاد الاستخدام لأي مستخدم نشط (وليس المدير فقط) ----------
-- سياسة الكتابة العامة على commodities مقصورة على المدير، لكن عدّاد الاستخدام
-- يجب أن يزيد من أي مستخدم يختار سلعة أثناء إدخال شحنة. دالة ضيقة وآمنة بدل
-- توسيع صلاحية الكتابة العامة على كل حقول الجدول.
create or replace function public.bump_commodity_usage(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active() then
    raise exception 'inactive user';
  end if;
  update public.commodities set usage_count = usage_count + 1 where id = cid;
end;
$$;
grant execute on function public.bump_commodity_usage(uuid) to authenticated;

notify pgrst, 'reload schema';
