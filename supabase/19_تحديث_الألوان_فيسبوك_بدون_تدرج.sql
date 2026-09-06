-- ============================================================
--  تحديث ألوان الهوية إلى أزرق فيسبوك وإيقاف التدرجات
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

-- نفس سبب ملف 18: صف الهوية (key='branding') محفوظ فعلياً في القاعدة
-- ويحمل الألوان القديمة، فتعديل الكود وحده لا يكفي.

update public.settings
set value = value || jsonb_build_object(
  'color',       '#1877F2',
  'color2',      '#69A7F7',
  'useGradient', false
)
where key = 'branding';

notify pgrst, 'reload schema';
