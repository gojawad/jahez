-- مركز الأرشيف (بوابة المستندات المؤرشفة) — مجموعة اختبارات SQL محلية ببيانات اصطناعية.
-- يشغّلها test/bsgt-archive-center-sql.cjs على قاعدة مؤقتة مستنسخة من العنقود المحلي
-- الذي يحمل الهجرات 1..52، بعد تطبيق supabase/58_bsgt_archive_center.sql.
-- كل فحص يسجّل صفاً في act.results، والمشغّل يفشل إذا لم يكن كل صف ok.
\set ON_ERROR_STOP on
\set QUIET on

create schema act;
create table act.results (n serial primary key, name text not null, ok boolean not null, detail text);
grant usage on schema act to authenticated;
grant select, insert on act.results to authenticated;
grant usage, select on sequence act.results_n_seq to authenticated;

create function act.check(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
begin insert into act.results(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail); end $$;
grant execute on function act.check(text, boolean, text) to authenticated;

create function act.expect_error(p_name text, p_sql text, p_pattern text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  execute p_sql;
  perform act.check(p_name, false, 'no error raised');
exception when others then
  if sqlerrm ~* p_pattern then perform act.check(p_name, true, sqlerrm);
  else perform act.check(p_name, false, 'unexpected error: ' || sqlerrm); end if;
end $$;
grant execute on function act.expect_error(text, text, text) to authenticated;

create function act.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, false);
$$;
grant execute on function act.as_user(text) to authenticated;

-- ---------------------------------------------------------------- fixtures (superuser)
insert into public.companies (id, name_ar, name_en, active, is_default, sort_order)
values ('00000000-0000-4000-8000-00000000d001', 'بحر سواكن للتجارة العامة (اختبار الأرشيف)', 'Bahar Swaken Archive TEST', true, false, 9);
-- شركة أخرى تماماً: صفوفها المؤرشفة يجب ألا تظهر في البوابة
insert into public.companies (id, name_ar, name_en, active, is_default, sort_order)
values ('00000000-0000-4000-8000-00000000d002', 'شركة أخرى للاختبار', 'Other Company TEST', true, false, 10);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000b1'), ('00000000-0000-4000-8000-0000000000b2'),
  ('00000000-0000-4000-8000-0000000000b3'), ('00000000-0000-4000-8000-0000000000b4'),
  ('00000000-0000-4000-8000-0000000000b5');

insert into public.profiles (id, email, display_name, role, active) values
  ('00000000-0000-4000-8000-0000000000b1', 'arch-admin@test',   'ARCH ADMIN',    'admin',  true),
  ('00000000-0000-4000-8000-0000000000b2', 'archiver@test',     'ARCHIVER',      'staff',  true),
  ('00000000-0000-4000-8000-0000000000b3', 'archmanager@test',  'ARCH MANAGER',  'staff',  true),
  ('00000000-0000-4000-8000-0000000000b4', 'plain@test',        'PLAIN VIEWER',  'viewer', true),
  ('00000000-0000-4000-8000-0000000000b5', 'inactive@test',     'INACTIVE USER', 'staff',  false)
on conflict (id) do update set email = excluded.email, display_name = excluded.display_name,
  role = excluded.role, active = excluded.active;

insert into public.user_feature_permissions (user_id, permission_key, allowed) values
  ('00000000-0000-4000-8000-0000000000b2', 'shipments.delete', true),
  ('00000000-0000-4000-8000-0000000000b3', 'shipments.delete', true),
  ('00000000-0000-4000-8000-0000000000b3', 'bsgt.management.view', true),
  ('00000000-0000-4000-8000-0000000000b4', 'shipments.view', true),
  ('00000000-0000-4000-8000-0000000000b5', 'shipments.delete', true);

-- شحنات: sh1 و sh2 مؤرشفتان، sh3 نشطة، sh9 مؤرشفة لكن لشركة أخرى
insert into public.shipments (id, owner_id, status, company_id, bsgt_stage, archived_at, archived_by, data) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000b1', 'sent',
   '00000000-0000-4000-8000-00000000d001', 'final_accepted', '2026-09-01 10:00:00+00', '00000000-0000-4000-8000-0000000000b2',
   '{"operationNo":"ARCH-0001","consignee":"ALPHA TRADING","itemDesc":"SUGAR","invoiceNo":"AINV-1"}'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000b1', 'sent',
   '00000000-0000-4000-8000-00000000d001', 'operations_draft', '2026-09-05 10:00:00+00', '00000000-0000-4000-8000-0000000000b2',
   '{"operationNo":"ARCH-0002","consignee":"BETA IMPORT","itemDesc":"RICE","invoiceNo":"AINV-2"}'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000b1', 'sent',
   '00000000-0000-4000-8000-00000000d001', 'ready_for_finance', null, null,
   '{"operationNo":"ARCH-0003","consignee":"GAMMA CO","itemDesc":"TEA","invoiceNo":"AINV-3"}'),
  ('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000000b1', 'sent',
   '00000000-0000-4000-8000-00000000d002', 'operations_draft', '2026-09-06 10:00:00+00', '00000000-0000-4000-8000-0000000000b2',
   '{"operationNo":"OTHER-0009","consignee":"OTHER CO","itemDesc":"SALT","invoiceNo":"OINV-9"}');

-- ملفات تجارية: t1 مؤرشف (مربوط بـ sh1)، t2 نشط (مربوط بـ sh3)
insert into public.trade_collection_files
  (id, operation_no, company_id, status, created_by, revision_no, remitting_bank, collecting_bank, archived_at, archived_by) values
  ('00000000-0000-4000-8000-00000000aa01', 'TC-2026-000901', '00000000-0000-4000-8000-00000000d001', 'final_accepted',
   '00000000-0000-4000-8000-0000000000b1', 2, 'OMDURMAN NATIONAL BANK', 'BANK OF KHARTOUM',
   '2026-09-02 12:00:00+00', '00000000-0000-4000-8000-0000000000b2'),
  ('00000000-0000-4000-8000-00000000aa02', 'TC-2026-000902', '00000000-0000-4000-8000-00000000d001', 'under_management_review',
   '00000000-0000-4000-8000-0000000000b1', 1, 'FAISAL ISLAMIC BANK', null, null, null);

insert into public.trade_collection_file_shipments (trade_file_id, shipment_id) values
  ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-0000000000f1'),
  ('00000000-0000-4000-8000-00000000aa02', '00000000-0000-4000-8000-0000000000f3');

-- مستندات: d1 نشط لكن ملفه مؤرشف ⇒ يظهر؛ d2 مؤرشف بذاته على ملف نشط ⇒ يظهر؛ d3 نشط على ملف نشط ⇒ لا يظهر
insert into public.trade_collection_file_documents
  (id, trade_file_id, revision_no, document_type, storage_path, file_name, mime_type, file_size, is_active, uploaded_by, created_at, archived_at) values
  ('00000000-0000-4000-8000-00000000bb01', '00000000-0000-4000-8000-00000000aa01', 2, 'letter',
   '00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', 'خطاب التحصيل الموقّع.pdf', 'application/pdf', 34567, true,
   '00000000-0000-4000-8000-0000000000b3', '2026-08-20 09:00:00+00', null),
  ('00000000-0000-4000-8000-00000000bb02', '00000000-0000-4000-8000-00000000aa02', 1, 'undertaking',
   '00000000-0000-4000-8000-00000000aa02/undertaking-r1.pdf', 'التعهد الموقّع.pdf', 'application/pdf', 12345, false,
   '00000000-0000-4000-8000-0000000000b3', '2026-08-21 09:00:00+00', '2026-09-03 08:00:00+00'),
  ('00000000-0000-4000-8000-00000000bb03', '00000000-0000-4000-8000-00000000aa02', 1, 'exchange',
   '00000000-0000-4000-8000-00000000aa02/exchange-r1.pdf', 'الكمبيالة الموقّعة.pdf', 'application/pdf', 6789, true,
   '00000000-0000-4000-8000-0000000000b3', '2026-08-22 09:00:00+00', null);

-- =============================================================================
-- 1) الصلاحيات
-- =============================================================================
set role authenticated;

select act.as_user('00000000-0000-4000-8000-0000000000b4');   -- بلا صلاحية أرشفة
select act.check('perm: can_view false for plain viewer', public.can_view_bsgt_archive_center() = false);
select act.expect_error('perm: summary refused for plain viewer',
  'select * from public.bsgt_archive_center_summary()', 'Archive permission is required');
select act.expect_error('perm: shipments list refused for plain viewer',
  'select * from public.list_bsgt_archived_shipments()', 'Archive permission is required');
select act.expect_error('perm: trade files list refused for plain viewer',
  'select * from public.list_bsgt_archived_trade_files()', 'Archive permission is required');
select act.expect_error('perm: documents list refused for plain viewer',
  'select * from public.list_bsgt_archived_documents()', 'Archive permission is required');

select act.as_user('00000000-0000-4000-8000-0000000000b5');   -- حامل المفتاح لكنه معطّل
select act.check('perm: can_view false for inactive user', public.can_view_bsgt_archive_center() = false);
select act.expect_error('perm: summary refused for inactive user',
  'select * from public.bsgt_archive_center_summary()', 'Archive permission is required');

select act.as_user('00000000-0000-4000-8000-0000000000b2');   -- أرشيفي
select act.check('perm: can_view true for shipments.delete holder', public.can_view_bsgt_archive_center() = true);
select act.as_user('00000000-0000-4000-8000-0000000000b1');   -- مدير
select act.check('perm: can_view true for admin', public.can_view_bsgt_archive_center() = true);

-- =============================================================================
-- 2) الملخّص
-- =============================================================================
select act.as_user('00000000-0000-4000-8000-0000000000b2');
select act.check('summary: archived shipments = 2', (select archived_shipments from public.bsgt_archive_center_summary()) = 2,
  (select archived_shipments::text from public.bsgt_archive_center_summary()));
select act.check('summary: archived trade files = 1', (select archived_trade_files from public.bsgt_archive_center_summary()) = 1,
  (select archived_trade_files::text from public.bsgt_archive_center_summary()));
select act.check('summary: archived documents = 2', (select archived_documents from public.bsgt_archive_center_summary()) = 2,
  (select archived_documents::text from public.bsgt_archive_center_summary()));

-- =============================================================================
-- 3) الشحنات المؤرشفة
-- =============================================================================
select act.check('shipments: two rows returned', (select count(*) from public.list_bsgt_archived_shipments()) = 2);
select act.check('shipments: total_count = 2', (select distinct total_count from public.list_bsgt_archived_shipments()) = 2);
select act.check('shipments: newest archived first',
  (select operation_no from public.list_bsgt_archived_shipments() limit 1) = 'ARCH-0002',
  (select string_agg(operation_no, ',' order by archived_at desc) from public.list_bsgt_archived_shipments()));
select act.check('shipments: active shipment excluded',
  not exists (select 1 from public.list_bsgt_archived_shipments() where operation_no = 'ARCH-0003'));
select act.check('shipments: other company excluded',
  not exists (select 1 from public.list_bsgt_archived_shipments() where operation_no = 'OTHER-0009'));
select act.check('shipments: trade file name resolved',
  (select trade_file_operation_no from public.list_bsgt_archived_shipments() where operation_no = 'ARCH-0001') = 'TC-2026-000901');
select act.check('shipments: unlinked shipment has null trade file',
  (select trade_file_id from public.list_bsgt_archived_shipments() where operation_no = 'ARCH-0002') is null);
select act.check('shipments: archived_by name resolved',
  (select archived_by_name from public.list_bsgt_archived_shipments() where operation_no = 'ARCH-0001') = 'ARCHIVER');
select act.check('shipments: consignee and item passed through',
  (select consignee || '/' || item_desc || '/' || invoice_no from public.list_bsgt_archived_shipments() where operation_no = 'ARCH-0001')
   = 'ALPHA TRADING/SUGAR/AINV-1');

-- بحث
select act.check('shipments: search by operation no',
  (select count(*) from public.list_bsgt_archived_shipments('ARCH-0001')) = 1);
select act.check('shipments: search by consignee is case-insensitive',
  (select count(*) from public.list_bsgt_archived_shipments('beta')) = 1);
select act.check('shipments: search by trade file name',
  (select operation_no from public.list_bsgt_archived_shipments('TC-2026-000901')) = 'ARCH-0001');
select act.check('shipments: search with no match returns nothing',
  (select count(*) from public.list_bsgt_archived_shipments('ZZZZ')) = 0);
select act.check('shipments: blank search behaves like no search',
  (select count(*) from public.list_bsgt_archived_shipments('   ')) = 2);

-- ترقيم الصفحات
select act.check('shipments: page size 1 returns one row',
  (select count(*) from public.list_bsgt_archived_shipments(null, 1, 1)) = 1);
select act.check('shipments: total_count stays 2 while paging',
  (select distinct total_count from public.list_bsgt_archived_shipments(null, 1, 1)) = 2);
select act.check('shipments: second page is the older row',
  (select operation_no from public.list_bsgt_archived_shipments(null, 2, 1)) = 'ARCH-0001');
select act.check('shipments: page beyond the end is empty',
  (select count(*) from public.list_bsgt_archived_shipments(null, 9, 1)) = 0);
select act.check('shipments: page 0 is clamped to page 1',
  (select operation_no from public.list_bsgt_archived_shipments(null, 0, 1)) = 'ARCH-0002');
select act.check('shipments: page size over 100 is clamped',
  (select count(*) from public.list_bsgt_archived_shipments(null, 1, 5000)) = 2);

-- =============================================================================
-- 4) الملفات التجارية المؤرشفة
-- =============================================================================
select act.check('files: one row returned', (select count(*) from public.list_bsgt_archived_trade_files()) = 1);
select act.check('files: it is the archived one',
  (select operation_no from public.list_bsgt_archived_trade_files()) = 'TC-2026-000901');
select act.check('files: active file excluded',
  not exists (select 1 from public.list_bsgt_archived_trade_files() where operation_no = 'TC-2026-000902'));
select act.check('files: shipment count = 1',
  (select shipment_count from public.list_bsgt_archived_trade_files()) = 1);
select act.check('files: document count = 1',
  (select document_count from public.list_bsgt_archived_trade_files()) = 1);
select act.check('files: status and revision passed through',
  (select status || '/' || revision_no::text from public.list_bsgt_archived_trade_files()) = 'final_accepted/2');
select act.check('files: banks passed through',
  (select remitting_bank || '/' || collecting_bank from public.list_bsgt_archived_trade_files())
   = 'OMDURMAN NATIONAL BANK/BANK OF KHARTOUM');
select act.check('files: archived_by name resolved',
  (select archived_by_name from public.list_bsgt_archived_trade_files()) = 'ARCHIVER');
select act.check('files: search by bank',
  (select count(*) from public.list_bsgt_archived_trade_files('khartoum')) = 1);
select act.check('files: search with no match',
  (select count(*) from public.list_bsgt_archived_trade_files('NOPE')) = 0);

-- =============================================================================
-- 5) المستندات المؤرشفة
-- =============================================================================
select act.check('documents: two rows returned', (select count(*) from public.list_bsgt_archived_documents()) = 2);
select act.check('documents: active document on active file excluded',
  not exists (select 1 from public.list_bsgt_archived_documents() where document_type = 'exchange'));
select act.check('documents: document archived by itself is listed',
  exists (select 1 from public.list_bsgt_archived_documents() where document_type = 'undertaking'));
select act.check('documents: active document on an archived file is listed',
  exists (select 1 from public.list_bsgt_archived_documents() where document_type = 'letter'));
select act.check('documents: file archived stamp exposed for the inherited one',
  (select file_archived_at is not null and document_archived_at is null
     from public.list_bsgt_archived_documents() where document_type = 'letter'));
select act.check('documents: own archived stamp exposed for the direct one',
  (select document_archived_at is not null from public.list_bsgt_archived_documents() where document_type = 'undertaking'));
select act.check('documents: trade file name resolved',
  (select trade_file_operation_no from public.list_bsgt_archived_documents() where document_type = 'letter') = 'TC-2026-000901');
select act.check('documents: storage path and size passed through',
  (select storage_path = '00000000-0000-4000-8000-00000000aa01/letter-r2.pdf' and file_size = 34567
     from public.list_bsgt_archived_documents() where document_type = 'letter'));
select act.check('documents: uploader name resolved',
  (select uploaded_by_name from public.list_bsgt_archived_documents() where document_type = 'letter') = 'ARCH MANAGER');
select act.check('documents: newest archived first',
  (select document_type from public.list_bsgt_archived_documents() limit 1) = 'undertaking');
select act.check('documents: search by file name',
  (select count(*) from public.list_bsgt_archived_documents('التعهد')) = 1);
select act.check('documents: search by document type',
  (select count(*) from public.list_bsgt_archived_documents('letter')) = 1);
select act.check('documents: total_count = 2',
  (select distinct total_count from public.list_bsgt_archived_documents()) = 2);

-- can_preview مرتبط بصلاحية الإدارة لا بصلاحية الأرشيف
select act.check('documents: archiver without management cannot preview',
  (select bool_and(can_preview = false) from public.list_bsgt_archived_documents()));
select act.as_user('00000000-0000-4000-8000-0000000000b3');   -- أرشيفي + إدارة
select act.check('documents: archiver with management can preview',
  (select bool_and(can_preview = true) from public.list_bsgt_archived_documents()));

-- =============================================================================
-- 6) المدير يرى كل شيء
-- =============================================================================
select act.as_user('00000000-0000-4000-8000-0000000000b1');
select act.check('admin: shipments visible', (select count(*) from public.list_bsgt_archived_shipments()) = 2);
select act.check('admin: trade files visible', (select count(*) from public.list_bsgt_archived_trade_files()) = 1);
select act.check('admin: documents visible', (select count(*) from public.list_bsgt_archived_documents()) = 2);
select act.check('admin: summary visible', (select archived_shipments from public.bsgt_archive_center_summary()) = 2);

-- =============================================================================
-- 7) قراءة فقط: لا أثر جانبي لأي استدعاء
-- =============================================================================
reset role;
create table act.snapshot as
  select (select count(*) from public.shipments) as shipments,
         (select count(*) from public.shipments where archived_at is not null) as archived_shipments,
         (select count(*) from public.trade_collection_files) as files,
         (select count(*) from public.trade_collection_files where archived_at is not null) as archived_files,
         (select count(*) from public.trade_collection_file_documents) as documents,
         (select count(*) from public.trade_collection_file_documents where is_active) as active_documents,
         (select count(*) from public.trade_collection_file_events) as events,
         (select count(*) from public.activity_log) as activity;
set role authenticated;
select act.as_user('00000000-0000-4000-8000-0000000000b1');
select count(*) from public.list_bsgt_archived_shipments();
select count(*) from public.list_bsgt_archived_trade_files();
select count(*) from public.list_bsgt_archived_documents();
select count(*) from public.bsgt_archive_center_summary();
reset role;
select act.check('read-only: nothing changed after every list call',
  (select row(shipments, archived_shipments, files, archived_files, documents, active_documents, events, activity) from act.snapshot)
  = row(
    (select count(*) from public.shipments),
    (select count(*) from public.shipments where archived_at is not null),
    (select count(*) from public.trade_collection_files),
    (select count(*) from public.trade_collection_files where archived_at is not null),
    (select count(*) from public.trade_collection_file_documents),
    (select count(*) from public.trade_collection_file_documents where is_active),
    (select count(*) from public.trade_collection_file_events),
    (select count(*) from public.activity_log)
  ));

-- =============================================================================
-- 8) الاستعادة تبقى عبر set_bsgt_archive القائمة (لم تُمسّ)
-- =============================================================================
set role authenticated;
select act.as_user('00000000-0000-4000-8000-0000000000b2');
select public.set_bsgt_archive('shipment', '00000000-0000-4000-8000-0000000000f2', false);
select act.check('restore: shipment leaves the archive list',
  not exists (select 1 from public.list_bsgt_archived_shipments() where operation_no = 'ARCH-0002'));
select act.check('restore: summary drops to one shipment',
  (select archived_shipments from public.bsgt_archive_center_summary()) = 1);
select public.set_bsgt_archive('shipment', '00000000-0000-4000-8000-0000000000f2', true);
select act.check('re-archive: shipment comes back to the list',
  exists (select 1 from public.list_bsgt_archived_shipments() where operation_no = 'ARCH-0002'));

select public.set_bsgt_archive('trade_file', '00000000-0000-4000-8000-00000000aa01', false);
select act.check('restore: trade file leaves the archive list',
  (select count(*) from public.list_bsgt_archived_trade_files()) = 0);
select act.check('restore: its shipment leaves too',
  not exists (select 1 from public.list_bsgt_archived_shipments() where operation_no = 'ARCH-0001'));
select act.check('restore: its document drops out of the archived documents',
  not exists (select 1 from public.list_bsgt_archived_documents() where document_type = 'letter'));
select public.set_bsgt_archive('trade_file', '00000000-0000-4000-8000-00000000aa01', true);
select act.check('re-archive: trade file is listed again',
  (select count(*) from public.list_bsgt_archived_trade_files()) = 1);

select act.as_user('00000000-0000-4000-8000-0000000000b4');
select act.expect_error('restore: plain viewer cannot restore',
  'select public.set_bsgt_archive(''shipment'', ''00000000-0000-4000-8000-0000000000f2'', false)',
  'Archive permission is required');
reset role;
