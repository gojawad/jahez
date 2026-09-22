-- مركز الأرشيف — مفتاح صلاحية مستقل لمن يرى البوابة.
--
-- قبل هذه الهجرة كانت رؤية البوابة مربوطة بصلاحية الأرشفة نفسها ('shipments.delete')،
-- فلا يمكن اختيار من يرى الأرشيف دون أن يملك الأرشفة. الآن:
--   * مفتاح جديد 'bsgt.archive.view' في دليل الصلاحيات، يُمنح من شاشة الصلاحيات كأي مفتاح.
--   * can_view_bsgt_archive_center() تعتمد عليه: مدير النظام، أو حامل هذا المفتاح.
--   * الاستعادة من الأرشيف لم تتغيّر إطلاقاً: set_bsgt_archive ما زالت تشترط
--     'shipments.delete' أو مدير، ولم تُمسّ. فمن يملك العرض وحده يتصفّح ويعاين ولا يستعيد.
--
-- ⚠ ملاحظة نشر مهمة: بعد تنفيذ هذه الهجرة لن يرى البوابة إلا المدير ومن مُنح المفتاح
-- الجديد. امنح 'bsgt.archive.view' من شاشة الصلاحيات لمن تريد فور التنفيذ.
--
-- لا جداول ولا أعمدة جديدة، ولا تعديل على أي دالة أخرى أو سياسة.
-- تعتمد على: supabase/38 و supabase/58.

begin;

-- 0) تحقق مسبق
do $$
begin
  if to_regclass('public.feature_permission_catalog') is null then
    raise exception 'supabase/38_granular_employee_permissions.sql must run first';
  end if;
  if to_regprocedure('public.can_view_bsgt_archive_center()') is null then
    raise exception 'supabase/58_bsgt_archive_center.sql must run first';
  end if;
end;
$$;

-- 1) المفتاح في دليل الصلاحيات
insert into public.feature_permission_catalog (permission_key, group_key, label_ar, depends_on)
values ('bsgt.archive.view', 'bsgt', 'عرض بوابة الأرشيف', '{}')
on conflict (permission_key) do nothing;

-- 2) حارس البوابة يعتمد المفتاح الجديد
create or replace function public.can_view_bsgt_archive_center()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_active() and (public.is_admin() or public.has_feature_permission('bsgt.archive.view')),
    false
  );
$$;

revoke all on function public.can_view_bsgt_archive_center() from public, anon;
grant execute on function public.can_view_bsgt_archive_center() to authenticated;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- 3) Rollback — يعيد الحارس إلى نص 58 حرفياً ويحذف المفتاح من الدليل
--    (يُحذف المفتاح من دليل الصلاحيات فقط؛ منْحه لمستخدم يختفي معه بالتبعية)
-- ---------------------------------------------------------------------------
-- begin;
-- create or replace function public.can_view_bsgt_archive_center()
-- returns boolean
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $rb$
--   select coalesce(
--     public.is_active() and (public.is_admin() or public.has_feature_permission('shipments.delete')),
--     false
--   );
-- $rb$;
-- delete from public.user_feature_permissions where permission_key = 'bsgt.archive.view';
-- delete from public.feature_permission_catalog where permission_key = 'bsgt.archive.view';
-- notify pgrst, 'reload schema';
-- commit;
