-- مركز الأرشيف — بطاقة تفاصيل الشحنة المؤرشفة ومرفقاتها.
--
-- قراءة فقط: دالتان (security definer / stable) تعرضان بيانات شحنة مؤرشفة واحدة
-- ومرفقاتها المرفوعة، لحامل صلاحية الأرشفة نفسها (مدير أو 'shipments.delete').
--   * get_bsgt_archived_shipment(id)        → بيانات الشحنة وأختام الأرشفة وملفها التجاري
--   * list_bsgt_archived_shipment_files(id) → مرفقات الشحنة من public.shipment_files
--
-- كلتاهما ترفضان أي شحنة غير مؤرشفة، وأي شحنة خارج شركة BSGT.
-- لا جداول ولا أعمدة ولا مفاتيح صلاحيات جديدة، ولا تعديل على أي دالة أو سياسة قائمة.
-- قراءة ملف المرفق من التخزين تعمل كما هي: سياسة دلو shipment-files تسمح لأي مستخدم
-- فعّال بالقراءة أصلاً، والحماية الحقيقية على جدول shipment_files الذي لا نمسّه —
-- وهذه الدالة هي الطريق الوحيد الذي يُخرج مسارات مرفقات الشحنات المؤرشفة.
-- تعتمد على: supabase/11 و supabase/50 و supabase/58.

begin;

-- 0) تحقق مسبق
do $$
begin
  if to_regclass('public.shipment_files') is null then
    raise exception 'supabase/11_أرشيف_المستندات_الموقعة.sql must run first';
  end if;
  if to_regprocedure('public.can_view_bsgt_archive_center()') is null then
    raise exception 'supabase/58_bsgt_archive_center.sql must run first';
  end if;
end;
$$;

-- 1) هل هذه شحنة مؤرشفة ضمن شركة BSGT ويحق لي الاطلاع عليها؟
create or replace function public.can_view_bsgt_archived_shipment(p_shipment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.can_view_bsgt_archive_center()
    and exists (
      select 1
      from public.shipments s
      where s.id = p_shipment_id
        and s.archived_at is not null
        and (public.bsgt_company_id() is null or s.company_id = public.bsgt_company_id())
    ),
    false
  );
$$;

-- 2) بطاقة الشحنة
create or replace function public.get_bsgt_archived_shipment(p_shipment_id uuid)
returns table (
  id uuid,
  operation_no text,
  consignee text,
  item_desc text,
  invoice_no text,
  bsgt_stage text,
  status text,
  workflow_stage text,
  data jsonb,
  archived_at timestamptz,
  archived_by_name text,
  created_at timestamptz,
  updated_at timestamptz,
  trade_file_id uuid,
  trade_file_operation_no text,
  trade_file_status text,
  trade_file_archived_at timestamptz,
  file_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_bsgt_archived_shipment(p_shipment_id) then
    raise exception 'Archived shipment is not available';
  end if;
  return query
  select
    s.id,
    s.data ->> 'operationNo',
    s.data ->> 'consignee',
    s.data ->> 'itemDesc',
    s.data ->> 'invoiceNo',
    s.bsgt_stage,
    s.status,
    s.workflow_stage,
    s.data,
    s.archived_at,
    actor.display_name,
    s.created_at,
    s.updated_at,
    file.id,
    file.operation_no,
    file.status,
    file.archived_at,
    (select count(*) from public.shipment_files sf where sf.shipment_id = s.id)
  from public.shipments s
  left join public.profiles actor on actor.id = s.archived_by
  left join lateral (
    select f.id, f.operation_no, f.status, f.archived_at
    from public.trade_collection_file_shipments link
    join public.trade_collection_files f on f.id = link.trade_file_id
    where link.shipment_id = s.id
    order by f.created_at desc
    limit 1
  ) file on true
  where s.id = p_shipment_id;
end;
$$;

-- 3) مرفقات الشحنة
create or replace function public.list_bsgt_archived_shipment_files(p_shipment_id uuid)
returns table (
  id uuid,
  name text,
  path text,
  mime text,
  size_bytes bigint,
  label text,
  uploaded_by_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_bsgt_archived_shipment(p_shipment_id) then
    raise exception 'Archived shipment is not available';
  end if;
  return query
  select sf.id, sf.name, sf.path, sf.mime, sf.size_bytes, sf.label,
         uploader.display_name, sf.created_at
  from public.shipment_files sf
  left join public.profiles uploader on uploader.id = sf.uploaded_by
  where sf.shipment_id = p_shipment_id
  order by sf.created_at desc, sf.id;
end;
$$;

-- 4) الصلاحيات
revoke all on function public.can_view_bsgt_archived_shipment(uuid) from public, anon;
revoke all on function public.get_bsgt_archived_shipment(uuid) from public, anon;
revoke all on function public.list_bsgt_archived_shipment_files(uuid) from public, anon;

grant execute on function public.can_view_bsgt_archived_shipment(uuid) to authenticated;
grant execute on function public.get_bsgt_archived_shipment(uuid) to authenticated;
grant execute on function public.list_bsgt_archived_shipment_files(uuid) to authenticated;

comment on function public.get_bsgt_archived_shipment(uuid) is
  'BSGT archive center: full detail card of one archived shipment.';

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- 5) Rollback (آمن دائماً: قراءة فقط، لم تُنشأ ولم تُعدَّل أي بيانات)
-- ---------------------------------------------------------------------------
-- begin;
-- drop function if exists public.list_bsgt_archived_shipment_files(uuid);
-- drop function if exists public.get_bsgt_archived_shipment(uuid);
-- drop function if exists public.can_view_bsgt_archived_shipment(uuid);
-- notify pgrst, 'reload schema';
-- commit;
