-- ============================================================
--  إضافة: دعم عملتين في حسابات العملاء (جنيه سوداني SDG + درهم إماراتي AED)
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

-- ---------- 1) عمود العملة على حركات الحساب ----------
-- NOT NULL + DEFAULT معاً في نفس الأمر يملآن كل الصفوف الحالية بـ 'SDG'
-- تلقائياً — البيانات القديمة تبقى بالجنيه ولا يتغيّر أي رصيد قائم.
alter table public.ledger_entries
  add column if not exists currency text not null default 'SDG'
  check (currency in ('SDG','AED'));

-- ---------- 2) أرصدة العملاء لكل عملة على حدة (لا تُجمع العملتان) ----------
-- drop قبل create لأن عمود جديد (currency) دخل بين أعمدة الـ view القديمة —
-- create or replace وحده لا يسمح بتغيير أسماء/ترتيب أعمدة view موجود.
drop view if exists public.v_client_balances;
create view public.v_client_balances as
select
  c.id,
  c.name,
  c.active,
  e.currency,
  coalesce(sum(case when e.kind in ('fee','adjust')    then e.amount else 0 end), 0) as total_debit,
  coalesce(sum(case when e.kind in ('payment','credit') then e.amount else 0 end), 0) as total_credit,
  coalesce(sum(case when e.kind in ('fee','adjust')    then e.amount else 0 end), 0)
  - coalesce(sum(case when e.kind in ('payment','credit') then e.amount else 0 end), 0) as balance,
  max(e.entry_date) as last_movement
from public.clients c
left join public.ledger_entries e on e.client_id = c.id
group by c.id, c.name, c.active, e.currency;

-- ---------- 3) خدمة "تكلفة شحن" ضمن الخدمات الافتراضية ----------
insert into public.services (name, sort_order) values
  ('تكلفة شحن', 6)
on conflict do nothing;

notify pgrst, 'reload schema';

-- ============================================================
--  تم. العملة الافتراضية لكل الحركات القديمة والجديدة (ما لم تُحدَّد) = SDG.
--  الرصيدان (جنيه/درهم) لا يُجمعان أبداً ولا يُحوَّل بينهما تلقائياً.
-- ============================================================
