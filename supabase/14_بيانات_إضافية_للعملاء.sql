-- ============================================================
--  إضافة: بيانات إضافية للعميل — العنوان، البريد الإلكتروني، الصورة
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

alter table public.clients add column if not exists address text;
alter table public.clients add column if not exists email text;
alter table public.clients add column if not exists photo text;

notify pgrst, 'reload schema';

-- ============================================================
--  تم. الهاتف (phone) كان موجوداً بالفعل ولم يتغيّر.
--  لا حاجة لتعديل سياسات RLS — تعمل على مستوى الصف لا العمود.
-- ============================================================
