-- ============================================================
--  سجل الشحنات والمستندات — قاعدة البيانات
--  الصق هذا الملف كاملاً في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة (لن يكرر أو يحذف بياناتك)
-- ============================================================

-- ---------- 1) جدول المستخدمين (الملفات الشخصية) ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'viewer' check (role in ('admin','editor','viewer')),
  photo_url    text,
  active       boolean not null default true,
  last_login   timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------- 2) دالة معرفة الصلاحية (تتفادى التكرار في سياسات RLS) ----------
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'viewer');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'admin' and active
                   from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false);
$$;

-- ---------- 3) إنشاء ملف شخصي تلقائياً عند تسجيل مستخدم جديد ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
    -- أول مستخدم في النظام يصبح مديراً تلقائياً
    case when (select count(*) from public.profiles) = 0 then 'admin' else 'viewer' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 4) الشحنات ----------
create table if not exists public.shipments (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  status     text not null default 'sent' check (status in ('draft','sent')),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipments_owner_idx  on public.shipments(owner_id);
create index if not exists shipments_status_idx on public.shipments(status);
create index if not exists shipments_updated_idx on public.shipments(updated_at desc);
-- فهارس للبحث السريع داخل بيانات الشحنة
create index if not exists shipments_invoice_idx   on public.shipments((data->>'invoiceNo'));
create index if not exists shipments_consignee_idx on public.shipments((data->>'consignee'));

-- ---------- 5) القوائم الجاهزة ----------
create table if not exists public.lookups (
  id         uuid primary key default gen_random_uuid(),
  list_key   text not null,
  value      text not null,
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  unique (list_key, value)
);
create index if not exists lookups_key_idx on public.lookups(list_key);

-- ---------- 6) عناوين البنوك ----------
create table if not exists public.bank_book (
  id         uuid primary key default gen_random_uuid(),
  nick       text not null,
  body       text not null,
  created_at timestamptz not null default now()
);

-- ---------- 7) الإعدادات المشتركة (الشركة/الهوية/أماكن الحقول) ----------
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- 8) سجل العمليات ----------
create table if not exists public.activity_log (
  id         bigserial primary key,
  user_id    uuid default auth.uid() references public.profiles(id) on delete set null,
  type       text not null default 'edit',
  text       text not null,
  created_at timestamptz not null default now()
);
create index if not exists activity_created_idx on public.activity_log(created_at desc);

-- ---------- 9) تحديث updated_at تلقائياً ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists shipments_touch on public.shipments;
create trigger shipments_touch before update on public.shipments
  for each row execute function public.touch_updated_at();

-- ============================================================
--  حماية الصفوف (Row Level Security)
--  هذه هي الصلاحيات الحقيقية — يفرضها الخادم لا المتصفح
-- ============================================================
alter table public.profiles     enable row level security;
alter table public.shipments    enable row level security;
alter table public.lookups      enable row level security;
alter table public.bank_book    enable row level security;
alter table public.settings     enable row level security;
alter table public.activity_log enable row level security;

-- ---- الملفات الشخصية ----
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

-- كل مستخدم يعدّل اسمه وصورته فقط (لا يستطيع ترقية نفسه)
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role   = (select p.role   from public.profiles p where p.id = auth.uid())
    and active = (select p.active from public.profiles p where p.id = auth.uid())
  );

-- المدير يعدّل أي ملف شخصي (بما فيه الأدوار والإيقاف)
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---- الشحنات: كل موظف يرى شحناته، والمدير يرى الكل ----
drop policy if exists shipments_select on public.shipments;
create policy shipments_select on public.shipments
  for select to authenticated
  using (public.is_active() and (owner_id = auth.uid() or public.is_admin()));

-- الإضافة: المدير والمحرر فقط، وباسم صاحبها
drop policy if exists shipments_insert on public.shipments;
create policy shipments_insert on public.shipments
  for insert to authenticated
  with check (
    public.is_active()
    and public.my_role() in ('admin','editor')
    and owner_id = auth.uid()
  );

-- التعديل: صاحبها إن كان محرراً، أو المدير لأي شحنة
drop policy if exists shipments_update on public.shipments;
create policy shipments_update on public.shipments
  for update to authenticated
  using (
    public.is_active()
    and (public.is_admin() or (owner_id = auth.uid() and public.my_role() = 'editor'))
  )
  with check (
    public.is_admin() or (owner_id = auth.uid() and public.my_role() = 'editor')
  );

-- الحذف: نفس قاعدة التعديل
drop policy if exists shipments_delete on public.shipments;
create policy shipments_delete on public.shipments
  for delete to authenticated
  using (
    public.is_active()
    and (public.is_admin() or (owner_id = auth.uid() and public.my_role() = 'editor'))
  );

-- ---- القوائم وعناوين البنوك والإعدادات: الجميع يقرأ، المدير وحده يكتب ----
drop policy if exists lookups_read on public.lookups;
create policy lookups_read on public.lookups
  for select to authenticated using (public.is_active());
drop policy if exists lookups_admin on public.lookups;
create policy lookups_admin on public.lookups
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists bank_read on public.bank_book;
create policy bank_read on public.bank_book
  for select to authenticated using (public.is_active());
drop policy if exists bank_admin on public.bank_book;
create policy bank_admin on public.bank_book
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings
  for select to authenticated using (public.is_active());
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- سجل العمليات: كل مستخدم يسجّل باسمه ويرى سجله، والمدير يرى الكل ----
drop policy if exists activity_insert on public.activity_log;
create policy activity_insert on public.activity_log
  for insert to authenticated with check (public.is_active() and user_id = auth.uid());
drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log
  for select to authenticated
  using (public.is_active() and (user_id = auth.uid() or public.is_admin()));

-- ============================================================
--  مساحة تخزين الصور (الشعار / الختم / النماذج)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('assets', 'assets', true)
on conflict (id) do nothing;

drop policy if exists assets_read on storage.objects;
create policy assets_read on storage.objects
  for select to public using (bucket_id = 'assets');

drop policy if exists assets_admin_write on storage.objects;
create policy assets_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'assets' and public.is_admin())
  with check (bucket_id = 'assets' and public.is_admin());

-- ============================================================
--  تم. بعد تسجيل أول حساب، شغّل السطر التالي لجعله مديراً
--  (غيّر الإيميل لإيميلك):
--
--  update public.profiles set role = 'admin'
--  where email = 'you@example.com';
-- ============================================================
