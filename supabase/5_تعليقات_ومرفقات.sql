-- ============================================================
--  إضافة: تعليقات الشحنات + مرفقات المهام
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

-- ---------- 1) تعليقات الشحنات ----------
create table if not exists public.shipment_comments (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  author_id   uuid default auth.uid() references public.profiles(id) on delete set null,
  body        text not null,
  kind        text not null default 'note' check (kind in ('note','return','approve','submit')),
  created_at  timestamptz not null default now()
);
create index if not exists comments_shipment_idx on public.shipment_comments(shipment_id, created_at);

alter table public.shipment_comments enable row level security;

-- يرى التعليقات من يرى الشحنة نفسها
drop policy if exists comments_select on public.shipment_comments;
create policy comments_select on public.shipment_comments
  for select to authenticated
  using (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (s.owner_id = auth.uid() or public.is_admin())
    )
  );

-- يكتب التعليق من يرى الشحنة، وباسمه فقط
drop policy if exists comments_insert on public.shipment_comments;
create policy comments_insert on public.shipment_comments
  for insert to authenticated
  with check (
    public.is_active() and author_id = auth.uid() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (s.owner_id = auth.uid() or public.is_admin())
    )
  );

-- يحذف تعليقه فقط، والمدير يحذف أي تعليق
drop policy if exists comments_delete on public.shipment_comments;
create policy comments_delete on public.shipment_comments
  for delete to authenticated
  using (public.is_active() and (author_id = auth.uid() or public.is_admin()));

-- ---------- 2) مرفقات المهام ----------
create table if not exists public.task_files (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  name       text not null,
  path       text not null,          -- المسار داخل مساحة التخزين
  mime       text,
  size_bytes bigint,
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists taskfiles_task_idx on public.task_files(task_id);

alter table public.task_files enable row level security;

-- يرى المرفقات من يرى المهمة
drop policy if exists taskfiles_select on public.task_files;
create policy taskfiles_select on public.task_files
  for select to authenticated
  using (
    public.is_active() and exists (
      select 1 from public.tasks t
      where t.id = task_id and (t.assigned_to = auth.uid() or public.is_admin())
    )
  );

-- المدير وحده يرفع أو يحذف المرفقات
drop policy if exists taskfiles_admin on public.task_files;
create policy taskfiles_admin on public.task_files
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- 3) مساحة تخزين المرفقات ----------
insert into storage.buckets (id, name, public)
values ('task-files', 'task-files', false)
on conflict (id) do nothing;

-- القراءة: أي مستخدم فعّال (الحماية الفعلية على جدول task_files)
drop policy if exists taskfiles_read on storage.objects;
create policy taskfiles_read on storage.objects
  for select to authenticated
  using (bucket_id = 'task-files' and public.is_active());

-- الرفع والحذف: المدير فقط
drop policy if exists taskfiles_write on storage.objects;
create policy taskfiles_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-files' and public.is_admin());

drop policy if exists taskfiles_remove on storage.objects;
create policy taskfiles_remove on storage.objects
  for delete to authenticated
  using (bucket_id = 'task-files' and public.is_admin());

-- ============================================================
--  تم.
-- ============================================================
