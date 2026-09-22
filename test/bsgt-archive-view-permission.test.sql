-- مركز الأرشيف — اختبارات مفتاح الصلاحية المستقل (supabase/62_bsgt_archive_view_permission.sql).
-- تعمل على نفس القاعدة بعد المجموعات السابقة: التركيبات والمستخدمون منها.
--   b1 مدير · b2 كان يملك 'shipments.delete' وحده · b4 بلا صلاحيات
\set ON_ERROR_STOP on
\set QUIET on

create schema acv;
create table acv.results (n serial primary key, name text not null, ok boolean not null, detail text);
grant usage on schema acv to authenticated;
grant select, insert on acv.results to authenticated;
grant usage, select on sequence acv.results_n_seq to authenticated;

create function acv.check(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
begin insert into acv.results(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail); end $$;
grant execute on function acv.check(text, boolean, text) to authenticated;

create function acv.expect_error(p_name text, p_sql text, p_pattern text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  execute p_sql;
  perform acv.check(p_name, false, 'no error raised');
exception when others then
  if sqlerrm ~* p_pattern then perform acv.check(p_name, true, sqlerrm);
  else perform acv.check(p_name, false, 'unexpected error: ' || sqlerrm); end if;
end $$;
grant execute on function acv.expect_error(text, text, text) to authenticated;

create function acv.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, false);
$$;
grant execute on function acv.as_user(text) to authenticated;

-- =============================================================================
-- 1) المفتاح مسجّل في دليل الصلاحيات
-- =============================================================================
select acv.check('catalog: the key is registered under the bsgt group',
  (select group_key || '/' || label_ar from public.feature_permission_catalog
     where permission_key = 'bsgt.archive.view') = 'bsgt/عرض بوابة الأرشيف');
select acv.check('catalog: it depends on nothing',
  (select depends_on = '{}'::text[] from public.feature_permission_catalog
     where permission_key = 'bsgt.archive.view'));

set role authenticated;

-- =============================================================================
-- 2) صلاحية الأرشفة وحدها لم تعد تفتح البوابة
-- =============================================================================
select acv.as_user('00000000-0000-4000-8000-0000000000b2');   -- shipments.delete فقط
select acv.check('archive permission alone no longer opens the portal',
  public.can_view_bsgt_archive_center() = false);
select acv.expect_error('portal refused without the new key',
  'select * from public.bsgt_archive_center_summary()', 'Archive permission is required');
select acv.expect_error('shipment card refused without the new key',
  'select * from public.get_bsgt_archived_shipment(''00000000-0000-4000-8000-0000000000f1'')',
  'Archived shipment is not available');
select acv.check('archived document is no longer readable without the new key',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', false) = false);

-- =============================================================================
-- 3) منح المفتاح يفتح البوابة
-- =============================================================================
reset role;
insert into public.user_feature_permissions (user_id, permission_key, allowed)
values ('00000000-0000-4000-8000-0000000000b2', 'bsgt.archive.view', true)
on conflict (user_id, permission_key) do update set allowed = excluded.allowed;
set role authenticated;

select acv.as_user('00000000-0000-4000-8000-0000000000b2');
select acv.check('granting the key opens the portal', public.can_view_bsgt_archive_center() = true);
select acv.check('summary works again',
  (select archived_shipments from public.bsgt_archive_center_summary()) >= 1);
select acv.check('shipment card works again',
  (select count(*) from public.get_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f1')) = 1);
select acv.check('archived document is readable again',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', false) = true);

-- =============================================================================
-- 4) الاستعادة لم تتغيّر: تبقى على صلاحية الأرشفة
-- =============================================================================
select acv.check('restore still works for the archive permission holder',
  (public.set_bsgt_archive('shipment', '00000000-0000-4000-8000-0000000000f2', false)) ->> 'archived' = 'false');
select public.set_bsgt_archive('shipment', '00000000-0000-4000-8000-0000000000f2', true);

-- مُشاهد بالمفتاح الجديد وحده: يرى ولا يستعيد
reset role;
insert into public.user_feature_permissions (user_id, permission_key, allowed)
values ('00000000-0000-4000-8000-0000000000b4', 'bsgt.archive.view', true)
on conflict (user_id, permission_key) do update set allowed = excluded.allowed;
set role authenticated;

select acv.as_user('00000000-0000-4000-8000-0000000000b4');
select acv.check('view-only user sees the portal', public.can_view_bsgt_archive_center() = true);
select acv.check('view-only user reads the lists',
  (select count(*) from public.list_bsgt_archived_trade_files()) >= 1);
select acv.check('view-only user opens an archived document',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', false) = true);
select acv.expect_error('view-only user cannot restore',
  'select public.set_bsgt_archive(''shipment'', ''00000000-0000-4000-8000-0000000000f2'', false)',
  'Archive permission is required');
select acv.check('view-only user still cannot write a document',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', true) = false);

-- =============================================================================
-- 5) المدير والممنوع
-- =============================================================================
select acv.as_user('00000000-0000-4000-8000-0000000000b1');
select acv.check('admin still sees the portal without any key',
  public.can_view_bsgt_archive_center() = true);

select acv.as_user('00000000-0000-4000-8000-0000000000b5');   -- معطّل ولو مُنح
select acv.check('inactive user is refused', public.can_view_bsgt_archive_center() = false);

reset role;
