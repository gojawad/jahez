-- ---------- أرشيف المستندات الموقّعة لكل شحنة ----------
create table if not exists public.shipment_files (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  name        text not null,
  path        text not null,          -- المسار داخل مساحة التخزين
  mime        text,
  size_bytes  bigint,
  label       text,                   -- وصف اختياري (مثال: بوليصة موقعة، فاتورة مختومة)
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists shipmentfiles_shipment_idx on public.shipment_files(shipment_id);

alter table public.shipment_files enable row level security;

-- يرى المرفقات: صاحب الشحنة أو المدير
drop policy if exists shipmentfiles_select on public.shipment_files;
create policy shipmentfiles_select on public.shipment_files
  for select to authenticated
  using (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (s.owner_id = auth.uid() or public.is_admin())
    )
  );

-- يرفع أو يحذف المرفقات: صاحب الشحنة أو المدير
drop policy if exists shipmentfiles_write on public.shipment_files;
create policy shipmentfiles_write on public.shipment_files
  for insert to authenticated
  with check (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (s.owner_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists shipmentfiles_delete on public.shipment_files;
create policy shipmentfiles_delete on public.shipment_files
  for delete to authenticated
  using (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (s.owner_id = auth.uid() or public.is_admin())
    )
  );

-- ---------- مساحة تخزين مرفقات الشحنات ----------
insert into storage.buckets (id, name, public)
values ('shipment-files', 'shipment-files', false)
on conflict (id) do nothing;

-- القراءة: أي مستخدم فعّال (الحماية الفعلية على جدول shipment_files)
drop policy if exists shipmentfiles_read on storage.objects;
create policy shipmentfiles_read on storage.objects
  for select to authenticated
  using (bucket_id = 'shipment-files' and public.is_active());

-- الرفع: أي مستخدم فعّال (الحماية الفعلية على جدول shipment_files عبر التطبيق)
drop policy if exists shipmentfiles_upload on storage.objects;
create policy shipmentfiles_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'shipment-files' and public.is_active());

-- الحذف: أي مستخدم فعّال (الحماية الفعلية على جدول shipment_files)
drop policy if exists shipmentfiles_remove on storage.objects;
create policy shipmentfiles_remove on storage.objects
  for delete to authenticated
  using (bucket_id = 'shipment-files' and public.is_active());
