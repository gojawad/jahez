-- ============================================================
--  إضافة: مرفقات PDF إضافية تُضم لحزمة الشحنة عند التجميع
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

create table if not exists public.shipment_package_attachments (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  name        text not null,        -- الاسم الذي يكتبه المستخدم لهذا المرفق
  path        text not null,        -- المسار داخل bucket الموجود shipment-files
  mime        text,
  size_bytes  bigint,
  sort_order  int not null default 0,
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists shippkgatt_shipment_idx on public.shipment_package_attachments(shipment_id, sort_order);

alter table public.shipment_package_attachments enable row level security;

-- نفس سياسات shipment_files بالضبط: صاحب الشحنة أو المدير
drop policy if exists shippkgatt_select on public.shipment_package_attachments;
create policy shippkgatt_select on public.shipment_package_attachments
  for select to authenticated
  using (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (s.owner_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists shippkgatt_write on public.shipment_package_attachments;
create policy shippkgatt_write on public.shipment_package_attachments
  for insert to authenticated
  with check (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (s.owner_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists shippkgatt_delete on public.shipment_package_attachments;
create policy shippkgatt_delete on public.shipment_package_attachments
  for delete to authenticated
  using (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (s.owner_id = auth.uid() or public.is_admin())
    )
  );

notify pgrst, 'reload schema';

-- ============================================================
--  تم. الملفات الفعلية تُخزَّن داخل bucket "shipment-files" الموجود بالفعل
--  (من 11_أرشيف_المستندات_الموقعة.sql) تحت مسار مميَّز pkg-attach/<shipment_id>/...
--  لتفادي أي تضارب مع مسارات أرشيف المستندات الموقّعة. لا حاجة لأي
--  سياسة تخزين جديدة — سياسات الـ bucket الحالية عامة وتغطي كل شيء.
-- ============================================================
