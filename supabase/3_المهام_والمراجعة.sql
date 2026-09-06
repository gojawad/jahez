-- ============================================================
--  إضافة: المهام ودورة المراجعة والاعتماد
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

-- ---------- 1) دور جديد: موظف ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','editor','viewer','staff'));

-- ---------- 2) حالات جديدة للشحنة ----------
--  draft   = مسودة (عند الموظف، لم تُرسل)
--  review  = مُرسلة للمراجعة (بانتظار المدير)
--  rework  = مُعادة للتعديل (بها ملاحظة من المدير)
--  sent    = معتمدة / صادرة
alter table public.shipments drop constraint if exists shipments_status_check;
alter table public.shipments add constraint shipments_status_check
  check (status in ('draft','review','rework','sent'));

alter table public.shipments add column if not exists review_note   text;
alter table public.shipments add column if not exists submitted_at  timestamptz;
alter table public.shipments add column if not exists reviewed_at   timestamptz;
alter table public.shipments add column if not exists reviewed_by   uuid references public.profiles(id) on delete set null;

create index if not exists shipments_review_idx on public.shipments(status) where status = 'review';

-- ---------- 3) جدول المهام ----------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text,
  assigned_to uuid references public.profiles(id) on delete cascade,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  status      text not null default 'open' check (status in ('open','done')),
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists tasks_assigned_idx on public.tasks(assigned_to, status);
create index if not exists tasks_created_idx  on public.tasks(created_at desc);

alter table public.tasks enable row level security;

-- الموظف يرى مهامه فقط، والمدير يرى كل المهام
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.is_active() and (assigned_to = auth.uid() or public.is_admin()));

-- المدير وحده ينشئ ويعدّل ويحذف المهام
drop policy if exists tasks_admin on public.tasks;
create policy tasks_admin on public.tasks
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- الموظف يقدر يعلّم مهمته كمنجزة فقط (لا يغيّر نصها ولا صاحبها)
drop policy if exists tasks_staff_done on public.tasks;
create policy tasks_staff_done on public.tasks
  for update to authenticated
  using (public.is_active() and assigned_to = auth.uid())
  with check (
    assigned_to = auth.uid()
    and title  = (select t.title  from public.tasks t where t.id = tasks.id)
    and body   is not distinct from (select t.body from public.tasks t where t.id = tasks.id)
  );

-- ---------- 4) تحديث صلاحيات الشحنات لتشمل الموظف ----------

-- الإضافة: المدير والمحرر والموظف
drop policy if exists shipments_insert on public.shipments;
create policy shipments_insert on public.shipments
  for insert to authenticated
  with check (
    public.is_active()
    and public.my_role() in ('admin','editor','staff')
    and owner_id = auth.uid()
  );

-- التعديل:
--   المدير: أي شحنة
--   المحرر: شحناته في أي حالة
--   الموظف: شحناته فقط ما دامت مسودة أو معادة للتعديل (لا يعدّل بعد الإرسال)
drop policy if exists shipments_update on public.shipments;
create policy shipments_update on public.shipments
  for update to authenticated
  using (
    public.is_active()
    and (
      public.is_admin()
      or (owner_id = auth.uid() and public.my_role() = 'editor')
      or (owner_id = auth.uid() and public.my_role() = 'staff' and status in ('draft','rework','review'))
    )
  )
  with check (
    public.is_admin()
    or (owner_id = auth.uid() and public.my_role() = 'editor')
    or (owner_id = auth.uid() and public.my_role() = 'staff' and status in ('draft','review'))
  );

-- الحذف: المدير، أو صاحبها إن كان محرراً، أو الموظف لمسوداته فقط
drop policy if exists shipments_delete on public.shipments;
create policy shipments_delete on public.shipments
  for delete to authenticated
  using (
    public.is_active()
    and (
      public.is_admin()
      or (owner_id = auth.uid() and public.my_role() = 'editor')
      or (owner_id = auth.uid() and public.my_role() = 'staff' and status = 'draft')
    )
  );

-- ---------- 5) القوائم والإعدادات: الموظف يقرأ فقط (موجود مسبقاً) ----------
-- لا تغيير مطلوب — سياسات القراءة تعتمد على is_active()

-- ============================================================
--  تم. لتعيين موظف: لوحة التحكم في البرنامج ← المستخدمون ← تغيير الصلاحية
-- ============================================================
