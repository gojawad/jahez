-- ============================================================
--  إضافة: حسابات العملاء ورسوم الخدمات (بالجنيه السوداني)
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

-- ---------- 1) العملاء ----------
create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists clients_name_uniq on public.clients(lower(btrim(name)));
create index if not exists clients_active_idx on public.clients(active, name);

alter table public.clients enable row level security;

drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients
  for select to authenticated using (public.is_active());

-- الإضافة والتعديل: المدير والمحرر (مسائل مالية)
drop policy if exists clients_write on public.clients;
create policy clients_write on public.clients
  for all to authenticated
  using (public.is_active() and public.my_role() in ('admin','editor'))
  with check (public.is_active() and public.my_role() in ('admin','editor'));

-- ---------- 2) حركات الحساب ----------
--  fee     = رسوم على العميل      (مدين  — يزيد ما عليه)
--  payment = دفعة من العميل        (دائن  — ينقص ما عليه)
--  credit  = خصم أو تسوية لصالحه   (دائن)
--  adjust  = تسوية عليه            (مدين)
create table if not exists public.ledger_entries (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  shipment_id uuid references public.shipments(id) on delete set null,
  entry_date  date not null default current_date,
  kind        text not null default 'fee' check (kind in ('fee','payment','credit','adjust')),
  service     text,                    -- نوع الخدمة (تخليص، نقل، تخزين ...)
  description text,
  amount      numeric(14,2) not null check (amount > 0),
  method      text,                    -- طريقة الدفع للدفعات
  reference   text,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists ledger_client_idx on public.ledger_entries(client_id, entry_date);
create index if not exists ledger_shipment_idx on public.ledger_entries(shipment_id);
create index if not exists ledger_date_idx on public.ledger_entries(entry_date desc);

alter table public.ledger_entries enable row level security;

drop policy if exists ledger_read on public.ledger_entries;
create policy ledger_read on public.ledger_entries
  for select to authenticated using (public.is_active());

drop policy if exists ledger_write on public.ledger_entries;
create policy ledger_write on public.ledger_entries
  for insert to authenticated
  with check (public.is_active() and public.my_role() in ('admin','editor'));

drop policy if exists ledger_update on public.ledger_entries;
create policy ledger_update on public.ledger_entries
  for update to authenticated
  using (public.is_active() and (public.is_admin() or created_by = auth.uid()))
  with check (public.is_admin() or created_by = auth.uid());

drop policy if exists ledger_delete on public.ledger_entries;
create policy ledger_delete on public.ledger_entries
  for delete to authenticated
  using (public.is_active() and (public.is_admin() or created_by = auth.uid()));

-- ---------- 3) قائمة الخدمات المتكررة ----------
create table if not exists public.services (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  default_price numeric(14,2),         -- سعر استرشادي (يمكن تغييره كل مرة)
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create unique index if not exists services_name_uniq on public.services(lower(btrim(name)));

alter table public.services enable row level security;

drop policy if exists services_read on public.services;
create policy services_read on public.services
  for select to authenticated using (public.is_active());

drop policy if exists services_admin on public.services;
create policy services_admin on public.services
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- خدمات مبدئية شائعة
insert into public.services (name, sort_order) values
  ('تخليص جمركي', 0),
  ('نقل داخلي', 1),
  ('تخزين', 2),
  ('تجهيز مستندات', 3),
  ('شهادة منشأ', 4),
  ('رسوم ميناء', 5),
  ('أخرى', 9)
on conflict do nothing;

-- ---------- 4) أرصدة العملاء ----------
create or replace view public.v_client_balances as
select
  c.id,
  c.name,
  c.active,
  coalesce(sum(case when e.kind in ('fee','adjust')    then e.amount else 0 end), 0) as total_debit,
  coalesce(sum(case when e.kind in ('payment','credit') then e.amount else 0 end), 0) as total_credit,
  coalesce(sum(case when e.kind in ('fee','adjust')    then e.amount else 0 end), 0)
  - coalesce(sum(case when e.kind in ('payment','credit') then e.amount else 0 end), 0) as balance,
  max(e.entry_date) as last_movement
from public.clients c
left join public.ledger_entries e on e.client_id = c.id
group by c.id, c.name, c.active;

-- ---------- 5) تعبئة العملاء من الشحنات الموجودة ----------
insert into public.clients (name)
select distinct btrim(s.data->>'consignee')
from public.shipments s
where coalesce(btrim(s.data->>'consignee'),'') <> ''
on conflict do nothing;

-- ============================================================
--  تم. الرصيد الموجب = على العميل، والسالب = له رصيد لديك.
-- ============================================================
