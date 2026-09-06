-- ============================================================
--  تفعيل البحث من الخادم (Server-side Search) لدليل السلع
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة، لا يمس أي بيانات موجودة
-- ============================================================

-- السبب: تحميل كل السلع للمتصفح دفعة واحدة (كان يحصل عند فتح التطبيق)
-- محدود تلقائياً بحد 1000 صف من Supabase — بعد استيراد أكثر من 12,000 سلعة
-- بقى أغلبها غير مرئي للبحث. هذا الملف يجهّز القاعدة للبحث المباشر من
-- الخادم مع كل كتابة، بدل تحميل كل شيء مقدماً.

create extension if not exists pg_trgm;

-- عمود عربي مُطبَّع (بدون همزات/تشكيل مختلفة) يُحسب تلقائياً من arabic_name
-- ويتحدّث تلقائياً مع أي تعديل عليه — بدون أي كود إضافي في التطبيق.
alter table public.commodities add column if not exists arabic_name_norm text
  generated always as (
    regexp_replace(
      translate(lower(arabic_name), 'أإآىة', 'ااايه'),
      '[ًٌٍَُِّْٰـ]', '', 'g'
    )
  ) stored;

create index if not exists commodities_arabic_norm_trgm_idx
  on public.commodities using gin (arabic_name_norm gin_trgm_ops);
create index if not exists commodities_english_trgm_idx
  on public.commodities using gin (lower(english_name) gin_trgm_ops);
create index if not exists commodities_hs_code_trgm_idx
  on public.commodities using gin (hs_code gin_trgm_ops);
create index if not exists commodities_category_trgm_idx
  on public.commodities using gin (lower(category) gin_trgm_ops);

notify pgrst, 'reload schema';
