-- مركز الأرشيف — اختبارات بطاقة الشحنة المؤرشفة ومرفقاتها
-- (supabase/61_bsgt_archived_shipment_details.sql).
-- تعمل على نفس القاعدة بعد bsgt-archive-center.test.sql: التركيبات والمستخدمون منها.
--   b1 مدير · b2 أرشفة فقط · b4 بلا صلاحيات
--   f1 شحنة مؤرشفة مرتبطة بملف مؤرشف · f2 شحنة مؤرشفة بلا ملف · f3 شحنة نشطة
\set ON_ERROR_STOP on
\set QUIET on

create schema acs;
create table acs.results (n serial primary key, name text not null, ok boolean not null, detail text);
grant usage on schema acs to authenticated;
grant select, insert on acs.results to authenticated;
grant usage, select on sequence acs.results_n_seq to authenticated;

create function acs.check(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
begin insert into acs.results(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail); end $$;
grant execute on function acs.check(text, boolean, text) to authenticated;

create function acs.expect_error(p_name text, p_sql text, p_pattern text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  execute p_sql;
  perform acs.check(p_name, false, 'no error raised');
exception when others then
  if sqlerrm ~* p_pattern then perform acs.check(p_name, true, sqlerrm);
  else perform acs.check(p_name, false, 'unexpected error: ' || sqlerrm); end if;
end $$;
grant execute on function acs.expect_error(text, text, text) to authenticated;

create function acs.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, false);
$$;
grant execute on function acs.as_user(text) to authenticated;

-- مرفقات: اثنان على الشحنة المؤرشفة f1، وواحد على الشحنة النشطة f3
insert into public.shipment_files (id, shipment_id, name, path, mime, size_bytes, label, uploaded_by, created_at) values
  ('00000000-0000-4000-8000-00000000cc01', '00000000-0000-4000-8000-0000000000f1',
   'بوليصة موقّعة.pdf', '00000000-0000-4000-8000-0000000000f1/bl-signed.pdf', 'application/pdf', 91011,
   'بوليصة الشحن الموقّعة', '00000000-0000-4000-8000-0000000000b3', '2026-08-25 09:00:00+00'),
  ('00000000-0000-4000-8000-00000000cc02', '00000000-0000-4000-8000-0000000000f1',
   'فاتورة مختومة.pdf', '00000000-0000-4000-8000-0000000000f1/invoice-stamped.pdf', 'application/pdf', 45678,
   null, '00000000-0000-4000-8000-0000000000b3', '2026-08-26 09:00:00+00'),
  ('00000000-0000-4000-8000-00000000cc03', '00000000-0000-4000-8000-0000000000f3',
   'مرفق شحنة نشطة.pdf', '00000000-0000-4000-8000-0000000000f3/active.pdf', 'application/pdf', 1234,
   null, '00000000-0000-4000-8000-0000000000b3', '2026-08-27 09:00:00+00');

set role authenticated;

-- =============================================================================
-- 1) الصلاحيات
-- =============================================================================
select acs.as_user('00000000-0000-4000-8000-0000000000b4');   -- بلا صلاحيات
select acs.check('perm: can_view false for plain viewer',
  public.can_view_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f1') = false);
select acs.expect_error('perm: card refused for plain viewer',
  'select * from public.get_bsgt_archived_shipment(''00000000-0000-4000-8000-0000000000f1'')',
  'Archived shipment is not available');
select acs.expect_error('perm: files refused for plain viewer',
  'select * from public.list_bsgt_archived_shipment_files(''00000000-0000-4000-8000-0000000000f1'')',
  'Archived shipment is not available');

select acs.as_user('00000000-0000-4000-8000-0000000000b2');   -- أرشيفي
select acs.check('perm: can_view true for the archive holder',
  public.can_view_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f1') = true);
select acs.check('perm: an active shipment is not available',
  public.can_view_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f3') = false);
select acs.expect_error('perm: card refused for an active shipment',
  'select * from public.get_bsgt_archived_shipment(''00000000-0000-4000-8000-0000000000f3'')',
  'Archived shipment is not available');
select acs.expect_error('perm: files refused for an active shipment',
  'select * from public.list_bsgt_archived_shipment_files(''00000000-0000-4000-8000-0000000000f3'')',
  'Archived shipment is not available');
select acs.expect_error('perm: unknown shipment is refused',
  'select * from public.get_bsgt_archived_shipment(''00000000-0000-4000-8000-00000000dead'')',
  'Archived shipment is not available');

-- =============================================================================
-- 2) بطاقة الشحنة
-- =============================================================================
select acs.check('card: one row returned',
  (select count(*) from public.get_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f1')) = 1);
select acs.check('card: identifying fields',
  (select operation_no || '/' || consignee || '/' || item_desc || '/' || invoice_no
     from public.get_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f1'))
   = 'ARCH-0001/ALPHA TRADING/SUGAR/AINV-1');
select acs.check('card: stage and archive stamps',
  (select bsgt_stage = 'final_accepted' and archived_at is not null and archived_by_name = 'ARCHIVER'
     from public.get_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f1')));
select acs.check('card: raw data payload is returned',
  (select data ->> 'consignee' from public.get_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f1'))
   = 'ALPHA TRADING');
select acs.check('card: trade file resolved',
  (select trade_file_operation_no = 'TC-2026-000901' and trade_file_status = 'final_accepted'
          and trade_file_archived_at is not null
     from public.get_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f1')));
select acs.check('card: attachment count',
  (select file_count from public.get_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f1')) = 2);
select acs.check('card: unlinked shipment has no trade file',
  (select trade_file_id is null and file_count = 0
     from public.get_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f2')));

-- =============================================================================
-- 3) المرفقات
-- =============================================================================
select acs.check('files: two attachments returned',
  (select count(*) from public.list_bsgt_archived_shipment_files('00000000-0000-4000-8000-0000000000f1')) = 2);
select acs.check('files: newest first',
  (select name from public.list_bsgt_archived_shipment_files('00000000-0000-4000-8000-0000000000f1') limit 1)
   = 'فاتورة مختومة.pdf');
select acs.check('files: storage path, size and label passed through',
  (select path = '00000000-0000-4000-8000-0000000000f1/bl-signed.pdf' and size_bytes = 91011
          and label = 'بوليصة الشحن الموقّعة'
     from public.list_bsgt_archived_shipment_files('00000000-0000-4000-8000-0000000000f1')
     where name = 'بوليصة موقّعة.pdf'));
select acs.check('files: uploader name resolved',
  (select bool_and(uploaded_by_name = 'ARCH MANAGER')
     from public.list_bsgt_archived_shipment_files('00000000-0000-4000-8000-0000000000f1')));
select acs.check('files: an active shipment attachment never leaks',
  not exists (select 1 from public.list_bsgt_archived_shipment_files('00000000-0000-4000-8000-0000000000f1')
              where name = 'مرفق شحنة نشطة.pdf'));
select acs.check('files: a shipment with no attachment returns nothing',
  (select count(*) from public.list_bsgt_archived_shipment_files('00000000-0000-4000-8000-0000000000f2')) = 0);

-- =============================================================================
-- 4) المدير
-- =============================================================================
select acs.as_user('00000000-0000-4000-8000-0000000000b1');
select acs.check('admin: card available',
  (select count(*) from public.get_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f1')) = 1);
select acs.check('admin: files available',
  (select count(*) from public.list_bsgt_archived_shipment_files('00000000-0000-4000-8000-0000000000f1')) = 2);

-- =============================================================================
-- 5) الاستعادة تُغلق البطاقة، وإعادة الأرشفة تفتحها
-- =============================================================================
select acs.as_user('00000000-0000-4000-8000-0000000000b2');
select public.set_bsgt_archive('shipment', '00000000-0000-4000-8000-0000000000f2', false);
select acs.expect_error('restored shipment: card is no longer available',
  'select * from public.get_bsgt_archived_shipment(''00000000-0000-4000-8000-0000000000f2'')',
  'Archived shipment is not available');
select public.set_bsgt_archive('shipment', '00000000-0000-4000-8000-0000000000f2', true);
select acs.check('re-archived shipment: card is available again',
  (select count(*) from public.get_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f2')) = 1);

-- =============================================================================
-- 6) قراءة فقط
-- =============================================================================
reset role;
create table acs.snapshot as
  select (select count(*) from public.shipment_files) as files,
         (select count(*) from public.shipments where archived_at is not null) as archived;
set role authenticated;
select acs.as_user('00000000-0000-4000-8000-0000000000b1');
select count(*) from public.get_bsgt_archived_shipment('00000000-0000-4000-8000-0000000000f1');
select count(*) from public.list_bsgt_archived_shipment_files('00000000-0000-4000-8000-0000000000f1');
reset role;
select acs.check('read-only: nothing changed',
  (select row(files, archived) from acs.snapshot)
  = row((select count(*) from public.shipment_files),
        (select count(*) from public.shipments where archived_at is not null)));
