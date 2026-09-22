-- مركز الأرشيف — اختبارات معاينة المستند المؤرشف (supabase/60_bsgt_archive_center_preview.sql).
-- تعمل على نفس القاعدة بعد bsgt-archive-center.test.sql: التركيبات والمستخدمون منها.
--   b1 مدير · b2 أرشفة فقط · b3 أرشفة + إدارة · b4 بلا صلاحيات · b5 معطّل
--   bb01 letter على ملف مؤرشف · bb02 undertaking مؤرشف بذاته · bb03 exchange نشط على ملف نشط
\set ON_ERROR_STOP on
\set QUIET on

create schema acp;
create table acp.results (n serial primary key, name text not null, ok boolean not null, detail text);
grant usage on schema acp to authenticated;
grant select, insert on acp.results to authenticated;
grant usage, select on sequence acp.results_n_seq to authenticated;

create function acp.check(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
begin insert into acp.results(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail); end $$;
grant execute on function acp.check(text, boolean, text) to authenticated;

create function acp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_uid, false);
$$;
grant execute on function acp.as_user(text) to authenticated;

set role authenticated;

-- =============================================================================
-- 1) حامل صلاحية الأرشفة وحده — قراءة المستند المؤرشف
-- =============================================================================
select acp.as_user('00000000-0000-4000-8000-0000000000b2');
select acp.check('archiver: reads a document whose file is archived',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', false) = true);
select acp.check('archiver: reads a document archived by itself',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa02/undertaking-r1.pdf', false) = true);
select acp.check('archiver: cannot read an active document on an active file',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa02/exchange-r1.pdf', false) = false);
select acp.check('archiver: unknown path is refused',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/nope.pdf', false) = false);
select acp.check('archiver: a bare file-id prefix is not enough',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/', false) = false);

-- الكتابة والحذف لم تُمسّ
select acp.check('archiver: still has no write access to an archived document',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', true) = false);
select acp.check('archiver: still has no write access to an active document',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa02/exchange-r1.pdf', true) = false);

-- =============================================================================
-- 2) مسار الإدارة الأصلي كما هو
-- =============================================================================
select acp.as_user('00000000-0000-4000-8000-0000000000b3');   -- أرشفة + إدارة (عرض فقط)
select acp.check('manager: reads an active document as before',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa02/exchange-r1.pdf', false) = true);
select acp.check('manager: reads an archived document',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', false) = true);
select acp.check('manager with view only: no write access',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa02/exchange-r1.pdf', true) = false);

-- =============================================================================
-- 3) من لا صلاحية له
-- =============================================================================
select acp.as_user('00000000-0000-4000-8000-0000000000b4');   -- بلا صلاحيات
select acp.check('plain viewer: no read on an archived document',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', false) = false);
select acp.check('plain viewer: no read on an active document',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa02/exchange-r1.pdf', false) = false);

select acp.as_user('00000000-0000-4000-8000-0000000000b5');   -- حامل المفتاح لكنه معطّل
select acp.check('inactive user: no read on an archived document',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', false) = false);

select acp.as_user('00000000-0000-4000-8000-0000000000b1');   -- مدير
select acp.check('admin: reads an archived document',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', false) = true);

-- =============================================================================
-- 4) can_preview صار true في قائمة المستندات
-- =============================================================================
select acp.as_user('00000000-0000-4000-8000-0000000000b2');
select acp.check('list: can_preview is true for the archive holder',
  (select bool_and(can_preview) from public.list_bsgt_archived_documents()));
select acp.check('list: still only the archived documents are listed',
  (select count(*) from public.list_bsgt_archived_documents()) = 2,
  (select string_agg(document_type, ',') from public.list_bsgt_archived_documents()));
select acp.check('list: an active document on an active file stays out',
  not exists (select 1 from public.list_bsgt_archived_documents() where document_type = 'exchange'));

-- =============================================================================
-- 5) استعادة الملف من الأرشيف تُغلق المعاينة من جديد
-- =============================================================================
select public.set_bsgt_archive('trade_file', '00000000-0000-4000-8000-00000000aa01', false);
select acp.check('restored file: its document is no longer readable by the archive holder',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', false) = false);
select public.set_bsgt_archive('trade_file', '00000000-0000-4000-8000-00000000aa01', true);
select acp.check('re-archived file: readable again',
  public.can_access_bsgt_trade_document_path('00000000-0000-4000-8000-00000000aa01/letter-r2.pdf', false) = true);

reset role;
