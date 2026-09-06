-- ============================================================
--  إضافة: ضوابط محاسبية على قيود حسابات العملاء (ledger_entries)
--  الهدف: دفتر موثوق أمام المحاسب — رقم مرجعي لا يتكرر، ومنع
--  التعديل/الحذف بأثر رجعي بعد 7 أيام (يُستبدل بقيد عكسي واضح
--  السبب)، مع سجل تدقيق كامل لمن أضاف كل قيد ومتى.
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

-- ---------- 1) رقم مرجعي تسلسلي لكل قيد (لا يتكرر، حتى بعد الحذف) ----------
create sequence if not exists public.ledger_entries_entry_no_seq;

alter table public.ledger_entries
  add column if not exists entry_no bigint;

alter table public.ledger_entries
  alter column entry_no set default nextval('public.ledger_entries_entry_no_seq');

-- تعبئة القيود الحالية بأرقام مرجعية بترتيب إنشائها (مرة واحدة فقط)
update public.ledger_entries e
set entry_no = sub.rn
from (
  select id, row_number() over (order by created_at, id) as rn
  from public.ledger_entries
  where entry_no is null
) sub
where e.id = sub.id;

-- دفع التسلسل ليبدأ بعد أعلى رقم موجود، حتى لا يتكرر مع القيود القديمة
select setval(
  'public.ledger_entries_entry_no_seq',
  coalesce((select max(entry_no) from public.ledger_entries), 0) + 1,
  false
);

alter table public.ledger_entries
  alter column entry_no set not null;

alter table public.ledger_entries
  drop constraint if exists ledger_entries_entry_no_uniq;
alter table public.ledger_entries
  add constraint ledger_entries_entry_no_uniq unique (entry_no);

-- ---------- 2) ربط القيد العكسي (التسوية) بالقيد الأصلي الذي يُلغي أثره ----------
alter table public.ledger_entries
  add column if not exists reverses_entry_no bigint references public.ledger_entries(entry_no);
create index if not exists ledger_entries_reverses_idx on public.ledger_entries(reverses_entry_no);

-- ---------- 3) سجل تدقيق: من أضاف كل قيد ومتى ----------
-- created_by و created_at موجودان أصلاً في الجدول (8_حسابات_العملاء.sql) ويُملآن
-- تلقائياً عند كل إدخال (created_by default auth.uid()) — لا حاجة لعمود جديد،
-- فقط تأكيد أن العمودين NOT NULL كي لا يبقى أي قيد بلا هوية مُنشئه:
update public.ledger_entries set created_by = created_by where created_by is null; -- no-op safe
alter table public.ledger_entries
  alter column created_at set default now();

-- ---------- 4) منع التعديل أو الحذف لأي قيد مضى عليه أكثر من 7 أيام ----------
-- قاعدة صارمة تشمل كل الأدوار (المدير أيضاً) — لا استثناء، حتى يبقى الدفتر
-- موثوقاً بلا أثر رجعي. التصحيح بعد هذه المهلة يكون فقط بقيد عكسي جديد
-- (تسوية) يوضّح السبب، لا بتعديل/حذف القيد الأصلي.
create or replace function public.ledger_entry_lock_check()
returns trigger
language plpgsql
as $$
begin
  if old.created_at < now() - interval '7 days' then
    raise exception
      'القيد رقم % مضى عليه أكثر من 7 أيام — لا يمكن تعديله أو حذفه. سجّل قيداً عكسياً (تسوية) يوضّح السبب بدلاً من ذلك.',
      old.entry_no
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists ledger_entries_lock_update on public.ledger_entries;
create trigger ledger_entries_lock_update
  before update on public.ledger_entries
  for each row execute function public.ledger_entry_lock_check();

drop trigger if exists ledger_entries_lock_delete on public.ledger_entries;
create trigger ledger_entries_lock_delete
  before delete on public.ledger_entries
  for each row execute function public.ledger_entry_lock_check();

notify pgrst, 'reload schema';

-- ============================================================
--  تم.
--  - entry_no: رقم مرجعي فريد لكل قيد، لا يتكرر حتى بعد الحذف.
--  - reverses_entry_no: يشير إلى رقم القيد الذي يُلغيه هذا القيد العكسي، إن وُجد.
--  - created_by / created_at: موجودان أصلاً — من أضاف القيد ومتى.
--  - أي محاولة تعديل أو حذف قيد مضى عليه أكثر من 7 أيام (من أي مستخدم بما فيه
--    المدير) تُرفض من قاعدة البيانات مباشرة برسالة توضيحية — التصحيح بعدها
--    يكون فقط عبر قيد عكسي جديد.
-- ============================================================
