-- مركز الأرشيف — فتح معاينة ملف المستند المؤرشف لحامل صلاحية الأرشفة.
--
-- الوضع قبل هذه الهجرة: قراءة ملفات دلو trade-collection-documents محكومة بـ
-- can_access_bsgt_trade_document_path التي تشترط صلاحية مساحة «الإدارة»، فبوابة الأرشيف
-- كانت تعرض بيانات المستند وتخفي زر المعاينة عمّن لا يملك تلك الصلاحية.
--
-- ما تغيّره هذه الهجرة، وبأضيق حدّ ممكن:
--   * مسار القراءة فقط (p_require_edit = false) يقبل أيضاً حامل صلاحية الأرشفة
--     (can_view_bsgt_archive_center: مدير أو 'shipments.delete').
--   * ولا يقبله إلا على مستند **مؤرشف فعلاً** (مؤرشف بذاته أو تابع لملف مؤرشف)
--     ضمن شركة BSGT، ومطابق لمسار التخزين المطلوب تحديداً.
--   * مسارات الرفع والتعديل والحذف (p_require_edit = true) لم تُمسّ إطلاقاً:
--     تبقى حكراً على صلاحية الإدارة كما كانت.
--   * list_bsgt_archived_documents تُرجع can_preview = true لأن كل من يصل إلى
--     البوابة صار يستطيع فتح المستند المؤرشف. الواجهة لا تحتاج أي تعديل.
--
-- لا جداول ولا أعمدة ولا مفاتيح صلاحيات جديدة، ولا تغيير على أي سياسة storage:
-- السياسات تستدعي الدالة كما هي، والدالة وحدها هي التي وُسِّع فرع القراءة فيها.
-- تعتمد على: supabase/33_bsgt_management_phase4.sql و supabase/58_bsgt_archive_center.sql.

begin;

-- 0) تحقق مسبق
do $$
begin
  if to_regprocedure('public.can_access_bsgt_trade_document_path(text, boolean)') is null then
    raise exception 'supabase/33_bsgt_management_phase4.sql must run first';
  end if;
  if to_regprocedure('public.can_view_bsgt_archive_center()') is null then
    raise exception 'supabase/58_bsgt_archive_center.sql must run first';
  end if;
end;
$$;

-- 1) حارس مستقل: هل هذا المسار يخصّ مستنداً مؤرشفاً في شركة BSGT؟
create or replace function public.is_archived_bsgt_trade_document_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trade_collection_file_documents d
    join public.trade_collection_files f on f.id = d.trade_file_id
    where d.storage_path = p_name
      and f.company_id = public.bsgt_company_id()
      and (d.archived_at is not null or d.is_active = false or f.archived_at is not null)
  );
$$;

-- 2) توسيع فرع القراءة وحده في دالة الوصول
create or replace function public.can_access_bsgt_trade_document_path(
  p_name text,
  p_require_edit boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    -- المسار الأصلي: صلاحية الإدارة على ملف من شركة BSGT (بلا أي تغيير)
    (
      public.has_bsgt_workspace_permission('management', p_require_edit)
      and exists (
        select 1
        from public.trade_collection_files trade_file
        where trade_file.id::text = split_part(p_name, '/', 1)
          and trade_file.company_id = public.bsgt_company_id()
      )
    )
    -- الإضافة: قراءة فقط، لحامل صلاحية الأرشفة، وعلى مستند مؤرشف فعلاً
    or (
      p_require_edit is not true
      and public.can_view_bsgt_archive_center()
      and public.is_archived_bsgt_trade_document_path(p_name)
    ),
    false
  );
$$;

-- 3) can_preview صار صحيحاً لكل من يصل إلى البوابة
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
         scoped.uploaded_by_name, scoped.created_at, true,
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

-- 4) الصلاحيات
revoke all on function public.is_archived_bsgt_trade_document_path(text) from public, anon;
grant execute on function public.is_archived_bsgt_trade_document_path(text) to authenticated;
revoke all on function public.can_access_bsgt_trade_document_path(text, boolean) from public, anon;
grant execute on function public.can_access_bsgt_trade_document_path(text, boolean) to authenticated;
revoke all on function public.list_bsgt_archived_documents(text, integer, integer) from public, anon;
grant execute on function public.list_bsgt_archived_documents(text, integer, integer) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- 5) Rollback — يعيد نص 33 لدالة الوصول ونص 58 لدالة القائمة حرفياً
-- ---------------------------------------------------------------------------
-- begin;
-- create or replace function public.can_access_bsgt_trade_document_path(
--   p_name text,
--   p_require_edit boolean default false
-- )
-- returns boolean
-- language sql
-- stable
-- security definer
-- set search_path = public
-- as $rb$
--   select coalesce(
--     public.has_bsgt_workspace_permission('management', p_require_edit)
--     and exists (
--       select 1
--       from public.trade_collection_files trade_file
--       where trade_file.id::text = split_part(p_name, '/', 1)
--         and trade_file.company_id = public.bsgt_company_id()
--     ),
--     false
--   );
-- $rb$;
-- drop function if exists public.is_archived_bsgt_trade_document_path(text);
-- notify pgrst, 'reload schema';
-- commit;
-- ثم أعد تشغيل القسم 5 من supabase/58_bsgt_archive_center.sql لاستعادة can_preview الأصلية.
