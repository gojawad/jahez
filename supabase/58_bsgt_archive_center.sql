-- بوابة المستندات المؤرشفة — «مركز الأرشيف» داخل مساحة BSGT.
--
-- قراءة فقط: هذه الهجرة لا تنشئ جداول ولا أعمدة ولا صلاحيات جديدة، ولا تعدّل أي دالة قائمة.
-- تضيف أربع دوال عرض (security definer / stable) تقرأ الصفوف المؤرشفة الموجودة أصلاً:
--   * الشحنات المؤرشفة        (shipments.archived_at is not null)
--   * الملفات التجارية المؤرشفة (trade_collection_files.archived_at is not null)
--   * المستندات الموقّعة المؤرشفة (trade_collection_file_documents المؤرشف بذاته أو التابع لملف مؤرشف)
--   * ملخّص أعداد الثلاثة
--
-- الصلاحية: نفس صلاحية الأرشفة القائمة — مدير النظام أو حامل المفتاح 'shipments.delete'.
-- لا مفاتيح صلاحيات جديدة ولا تعديل على set_bsgt_archive (الاستعادة تبقى عبرها كما هي).
-- تعتمد على: supabase/33_bsgt_management_phase4.sql و supabase/50_bsgt_archive.sql.
--
-- ملاحظة أمنية مقصودة: معاينة ملف المستند من التخزين تبقى محكومة بـ
-- can_access_bsgt_trade_document_path (صلاحية الإدارة) ولم تُمسّ. البوابة تعرض بيانات
-- المستند للجميع المخوّلين بالأرشيف، وتترك فتح الملف نفسه لمن يملك صلاحية الإدارة.

begin;

-- 0) تحقق مسبق: لا تُطبَّق قبل هجرتي 33 و50
do $$
begin
  if to_regclass('public.trade_collection_file_documents') is null then
    raise exception 'supabase/33_bsgt_management_phase4.sql must run first';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shipments' and column_name = 'archived_at'
  ) then
    raise exception 'supabase/50_bsgt_archive.sql must run first';
  end if;
end;
$$;

-- 1) حارس الصلاحية — نفس شرط set_bsgt_archive حرفياً
create or replace function public.can_view_bsgt_archive_center()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.is_active() and (public.is_admin() or public.has_feature_permission('shipments.delete')),
    false
  );
$$;

-- 2) ملخّص الأعداد
create or replace function public.bsgt_archive_center_summary()
returns table (
  archived_shipments bigint,
  archived_trade_files bigint,
  archived_documents bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := public.bsgt_company_id();
begin
  if not public.can_view_bsgt_archive_center() then
    raise exception 'Archive permission is required';
  end if;
  return query
  select
    (select count(*) from public.shipments s
      where s.archived_at is not null
        and (v_company is null or s.company_id = v_company)),
    (select count(*) from public.trade_collection_files f
      where f.archived_at is not null
        and (v_company is null or f.company_id = v_company)),
    (select count(*) from public.trade_collection_file_documents d
      join public.trade_collection_files f on f.id = d.trade_file_id
      where (v_company is null or f.company_id = v_company)
        and (d.archived_at is not null or d.is_active = false or f.archived_at is not null));
end;
$$;

-- 3) الشحنات المؤرشفة
create or replace function public.list_bsgt_archived_shipments(
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns table (
  id uuid,
  operation_no text,
  consignee text,
  item_desc text,
  invoice_no text,
  bsgt_stage text,
  archived_at timestamptz,
  archived_by_name text,
  trade_file_id uuid,
  trade_file_operation_no text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := public.bsgt_company_id();
  v_needle text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.can_view_bsgt_archive_center() then
    raise exception 'Archive permission is required';
  end if;
  p_page := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 20), 1), 100);
  return query
  with scoped as (
    select
      s.id,
      s.data ->> 'operationNo' as operation_no,
      s.data ->> 'consignee'   as consignee,
      s.data ->> 'itemDesc'    as item_desc,
      s.data ->> 'invoiceNo'   as invoice_no,
      s.bsgt_stage,
      s.archived_at,
      actor.display_name as archived_by_name,
      file.id as trade_file_id,
      file.operation_no as trade_file_operation_no
    from public.shipments s
    left join public.profiles actor on actor.id = s.archived_by
    left join lateral (
      select f.id, f.operation_no
      from public.trade_collection_file_shipments link
      join public.trade_collection_files f on f.id = link.trade_file_id
      where link.shipment_id = s.id
      order by f.created_at desc
      limit 1
    ) file on true
    where s.archived_at is not null
      and (v_company is null or s.company_id = v_company)
  )
  select scoped.id, scoped.operation_no, scoped.consignee, scoped.item_desc, scoped.invoice_no,
         scoped.bsgt_stage, scoped.archived_at, scoped.archived_by_name,
         scoped.trade_file_id, scoped.trade_file_operation_no,
         count(*) over()
  from scoped
  where v_needle is null
     or coalesce(scoped.operation_no, '') ilike '%' || v_needle || '%'
     or coalesce(scoped.consignee, '')    ilike '%' || v_needle || '%'
     or coalesce(scoped.item_desc, '')    ilike '%' || v_needle || '%'
     or coalesce(scoped.invoice_no, '')   ilike '%' || v_needle || '%'
     or coalesce(scoped.trade_file_operation_no, '') ilike '%' || v_needle || '%'
  order by scoped.archived_at desc, scoped.id
  offset (p_page - 1) * p_page_size limit p_page_size;
end;
$$;

-- 4) الملفات التجارية المؤرشفة
create or replace function public.list_bsgt_archived_trade_files(
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns table (
  id uuid,
  operation_no text,
  status text,
  revision_no integer,
  remitting_bank text,
  collecting_bank text,
  archived_at timestamptz,
  archived_by_name text,
  shipment_count bigint,
  document_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := public.bsgt_company_id();
  v_needle text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.can_view_bsgt_archive_center() then
    raise exception 'Archive permission is required';
  end if;
  p_page := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 20), 1), 100);
  return query
  with scoped as (
    select
      f.id, f.operation_no, f.status, f.revision_no, f.remitting_bank, f.collecting_bank,
      f.archived_at,
      actor.display_name as archived_by_name,
      (select count(*) from public.trade_collection_file_shipments link where link.trade_file_id = f.id) as shipment_count,
      (select count(*) from public.trade_collection_file_documents d where d.trade_file_id = f.id) as document_count
    from public.trade_collection_files f
    left join public.profiles actor on actor.id = f.archived_by
    where f.archived_at is not null
      and (v_company is null or f.company_id = v_company)
  )
  select scoped.id, scoped.operation_no, scoped.status, scoped.revision_no,
         scoped.remitting_bank, scoped.collecting_bank, scoped.archived_at, scoped.archived_by_name,
         scoped.shipment_count, scoped.document_count,
         count(*) over()
  from scoped
  where v_needle is null
     or coalesce(scoped.operation_no, '')    ilike '%' || v_needle || '%'
     or coalesce(scoped.remitting_bank, '')  ilike '%' || v_needle || '%'
     or coalesce(scoped.collecting_bank, '') ilike '%' || v_needle || '%'
  order by scoped.archived_at desc, scoped.id
  offset (p_page - 1) * p_page_size limit p_page_size;
end;
$$;

-- 5) المستندات الموقّعة المؤرشفة (بذاتها أو لأنها تتبع ملفاً مؤرشفاً)
create or replace function public.list_bsgt_archived_documents(
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns table (
  id uuid,
  trade_file_id uuid,
  trade_file_operation_no text,
  trade_file_status text,
  document_type text,
  file_name text,
  storage_path text,
  mime_type text,
  file_size bigint,
  revision_no integer,
  is_active boolean,
  document_archived_at timestamptz,
  file_archived_at timestamptz,
  uploaded_by_name text,
  created_at timestamptz,
  can_preview boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := public.bsgt_company_id();
  v_needle text := nullif(btrim(coalesce(p_search, '')), '');
  v_preview boolean := coalesce(public.has_bsgt_workspace_permission('management', false), false);
begin
  if not public.can_view_bsgt_archive_center() then
    raise exception 'Archive permission is required';
  end if;
  p_page := greatest(coalesce(p_page, 1), 1);
  p_page_size := least(greatest(coalesce(p_page_size, 20), 1), 100);
  return query
  with scoped as (
    select
      d.id, d.trade_file_id,
      f.operation_no as trade_file_operation_no,
      f.status as trade_file_status,
      d.document_type, d.file_name, d.storage_path, d.mime_type, d.file_size, d.revision_no,
      d.is_active,
      d.archived_at as document_archived_at,
      f.archived_at as file_archived_at,
      uploader.display_name as uploaded_by_name,
      d.created_at
    from public.trade_collection_file_documents d
    join public.trade_collection_files f on f.id = d.trade_file_id
    left join public.profiles uploader on uploader.id = d.uploaded_by
    where (v_company is null or f.company_id = v_company)
      and (d.archived_at is not null or d.is_active = false or f.archived_at is not null)
  )
  select scoped.id, scoped.trade_file_id, scoped.trade_file_operation_no, scoped.trade_file_status,
         scoped.document_type, scoped.file_name, scoped.storage_path, scoped.mime_type, scoped.file_size,
         scoped.revision_no, scoped.is_active, scoped.document_archived_at, scoped.file_archived_at,
         scoped.uploaded_by_name, scoped.created_at, v_preview,
         count(*) over()
  from scoped
  where v_needle is null
     or coalesce(scoped.file_name, '')               ilike '%' || v_needle || '%'
     or coalesce(scoped.trade_file_operation_no, '') ilike '%' || v_needle || '%'
     or coalesce(scoped.document_type, '')           ilike '%' || v_needle || '%'
  order by coalesce(scoped.document_archived_at, scoped.file_archived_at, scoped.created_at) desc, scoped.id
  offset (p_page - 1) * p_page_size limit p_page_size;
end;
$$;

-- 6) الصلاحيات: للمستخدمين المسجّلين فقط، والحارس داخل كل دالة
revoke all on function public.can_view_bsgt_archive_center() from public, anon;
revoke all on function public.bsgt_archive_center_summary() from public, anon;
revoke all on function public.list_bsgt_archived_shipments(text, integer, integer) from public, anon;
revoke all on function public.list_bsgt_archived_trade_files(text, integer, integer) from public, anon;
revoke all on function public.list_bsgt_archived_documents(text, integer, integer) from public, anon;

grant execute on function public.can_view_bsgt_archive_center() to authenticated;
grant execute on function public.bsgt_archive_center_summary() to authenticated;
grant execute on function public.list_bsgt_archived_shipments(text, integer, integer) to authenticated;
grant execute on function public.list_bsgt_archived_trade_files(text, integer, integer) to authenticated;
grant execute on function public.list_bsgt_archived_documents(text, integer, integer) to authenticated;

comment on function public.bsgt_archive_center_summary() is
  'BSGT archive center: counts of archived shipments, trade files and signed documents.';

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- 7) Rollback (آمن دائماً: هذه الهجرة قراءة فقط ولم تنشئ ولم تعدّل أي بيانات)
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.list_bsgt_archived_documents(text, integer, integer);
-- drop function if exists public.list_bsgt_archived_trade_files(text, integer, integer);
-- drop function if exists public.list_bsgt_archived_shipments(text, integer, integer);
-- drop function if exists public.bsgt_archive_center_summary();
-- drop function if exists public.can_view_bsgt_archive_center();
-- notify pgrst, 'reload schema';
-- commit;
