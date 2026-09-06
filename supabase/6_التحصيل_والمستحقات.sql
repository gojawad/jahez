-- ============================================================
--  إضافة: نظام التحصيل والمستحقات
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

-- ---------- 1) حقول التحصيل على الشحنة ----------
-- مدة الاستحقاق بالأيام (مثال: 180 لشرط DA 180)
alter table public.shipments add column if not exists credit_days int;
-- تاريخ بداية احتساب المدة (عادة تاريخ البوليصة)
alter table public.shipments add column if not exists due_from date;
-- تاريخ الاستحقاق النهائي (يُحسب تلقائياً أو يُكتب يدوياً)
alter table public.shipments add column if not exists due_date date;

create index if not exists shipments_due_idx on public.shipments(due_date);

-- ---------- 2) جدول الدفعات ----------
create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  amount      numeric(14,2) not null check (amount > 0),
  currency    text default 'USD',
  paid_on     date not null default current_date,
  method      text,                    -- تحويل بنكي / شيك / نقداً ...
  reference   text,                    -- رقم الإشعار أو الشيك
  note        text,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists payments_shipment_idx on public.payments(shipment_id);
create index if not exists payments_date_idx on public.payments(paid_on desc);

alter table public.payments enable row level security;

-- يرى الدفعات من يرى الشحنة
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (s.owner_id = auth.uid() or public.is_admin())
    )
  );

-- التحصيل عملية مالية: المدير والمحرر فقط (لا الموظف ولا المشاهد)
drop policy if exists payments_write on public.payments;
create policy payments_write on public.payments
  for insert to authenticated
  with check (
    public.is_active()
    and public.my_role() in ('admin','editor')
    and exists (
      select 1 from public.shipments s
      where s.id = shipment_id and (s.owner_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments
  for update to authenticated
  using (public.is_active() and (public.is_admin() or created_by = auth.uid()))
  with check (public.is_admin() or created_by = auth.uid());

drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments
  for delete to authenticated
  using (public.is_active() and (public.is_admin() or created_by = auth.uid()));

-- ---------- 3) حساب تاريخ الاستحقاق تلقائياً ----------
create or replace function public.set_shipment_due()
returns trigger
language plpgsql
as $$
declare
  base date;
  days int;
begin
  -- المدة: من العمود، أو مستخرجة من نص شروط الدفع (مثل "DA (180) DAYS")
  days := new.credit_days;
  if days is null then
    days := nullif(substring(coalesce(new.data->>'paymentTerm','') from '([0-9]{2,4})'), '')::int;
  end if;

  -- البداية: من العمود، أو تاريخ البوليصة، أو تاريخ الفاتورة
  base := new.due_from;
  if base is null then
    base := nullif(new.data->>'billDate','')::date;
  end if;
  if base is null then
    base := nullif(new.data->>'invoiceDate','')::date;
  end if;

  -- شروط الدفع الفورية: مستحقة من تاريخها
  if days is null and coalesce(new.data->>'paymentTerm','') ~* '(CAD|CASH|ADVANCE|AT SIGHT)' then
    days := 0;
  end if;

  if new.due_date is null and base is not null and days is not null then
    new.due_date := base + days;
  end if;
  return new;
end;
$$;

drop trigger if exists shipments_set_due on public.shipments;
create trigger shipments_set_due
  before insert or update on public.shipments
  for each row execute function public.set_shipment_due();

-- ---------- 4) تعبئة الشحنات الموجودة ----------
update public.shipments s
set due_date = (
  coalesce(
    nullif(s.data->>'billDate','')::date,
    nullif(s.data->>'invoiceDate','')::date
  )
  + coalesce(
      s.credit_days,
      nullif(substring(coalesce(s.data->>'paymentTerm','') from '([0-9]{2,4})'), '')::int
    )
)
where s.due_date is null
  and coalesce(nullif(s.data->>'billDate',''), nullif(s.data->>'invoiceDate','')) is not null
  and coalesce(
        s.credit_days,
        nullif(substring(coalesce(s.data->>'paymentTerm','') from '([0-9]{2,4})'), '')::int
      ) is not null;

-- شروط الدفع الفورية (بدون عدد أيام) تُعتبر مستحقة من تاريخها
update public.shipments s
set due_date = coalesce(
      nullif(s.data->>'billDate','')::date,
      nullif(s.data->>'invoiceDate','')::date)
where s.due_date is null
  and s.data->>'paymentTerm' ~* '(CAD|CASH|ADVANCE|AT SIGHT)'
  and coalesce(nullif(s.data->>'billDate',''), nullif(s.data->>'invoiceDate','')) is not null;

-- ---------- 5) عرض مختصر للمستحقات ----------
create or replace view public.v_receivables as
select
  s.id,
  s.owner_id,
  s.status,
  s.due_date,
  s.data->>'consignee'   as consignee,
  s.data->>'invoiceNo'   as invoice_no,
  s.data->>'totalAmount' as total_text,
  coalesce((select sum(p.amount) from public.payments p where p.shipment_id = s.id), 0) as paid
from public.shipments s
where s.status = 'sent';

-- ============================================================
--  تم.
-- ============================================================
