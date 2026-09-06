-- ============================================================
--  إضافة: دعم نوع "مبني بالكود" ضمن نماذج بوالص الشحن (bol_templates)
--  يتيح إضافة "العشري 2" كقالب مختار من نفس قائمة النماذج، بلا صورة مرفوعة.
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

alter table public.bol_templates add column if not exists kind text not null default 'image' check (kind in ('image','coded'));
alter table public.bol_templates add column if not exists logo_img text;   -- شعار الشركة الناقلة (base64) — لصفوف kind='coded' فقط
alter table public.bol_templates add column if not exists badge_img text;  -- ختم/استيكر (base64) — لصفوف kind='coded' فقط

notify pgrst, 'reload schema';

-- ============================================================
--  تم. عمود positions (jsonb) الموجود بالفعل يُعاد استخدامه لصفوف
--  kind='coded' ليحمل: مواضع الشعار/الختم كنسب مئوية، واسم الشركة
--  الناقلة عربي/إنجليزي، وخطوط السير — بلا حاجة لأي عمود إضافي.
--  الصفوف الحالية (kind='image' افتراضياً) لا تتأثر إطلاقاً.
-- ============================================================
