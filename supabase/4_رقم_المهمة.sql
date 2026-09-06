-- ============================================================
--  إضافة: رقم مرجعي للمهام
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

-- عمود الرقم المرجعي
alter table public.tasks add column if not exists ref_no text;

-- منع التكرار (مع السماح بالفراغ)
create unique index if not exists tasks_ref_no_uniq
  on public.tasks(ref_no) where ref_no is not null and ref_no <> '';

create index if not exists tasks_ref_search_idx on public.tasks(ref_no);

-- ---------- توليد الرقم تلقائياً: T-YYYY-NNNN ----------
create or replace function public.next_task_ref()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  yr   text := to_char(now(), 'YYYY');
  pfx  text := 'T-' || yr || '-';
  mx   int;
begin
  select coalesce(max( (regexp_replace(ref_no, '^' || pfx, ''))::int ), 0)
    into mx
  from public.tasks
  where ref_no ~ ('^' || pfx || '[0-9]+$');

  return pfx || lpad((mx + 1)::text, 4, '0');
end;
$$;

-- يملأ الرقم تلقائياً عند الإضافة لو لم يُرسل
create or replace function public.set_task_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ref_no is null or btrim(new.ref_no) = '' then
    new.ref_no := public.next_task_ref();
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_set_ref on public.tasks;
create trigger tasks_set_ref
  before insert on public.tasks
  for each row execute function public.set_task_ref();

-- ---------- ترقيم المهام الموجودة مسبقاً ----------
do $$
declare
  r record;
  i int := 0;
  yr text := to_char(now(), 'YYYY');
begin
  for r in select id from public.tasks
           where ref_no is null or btrim(ref_no) = ''
           order by created_at
  loop
    i := i + 1;
    update public.tasks
       set ref_no = 'T-' || yr || '-' || lpad(i::text, 4, '0')
     where id = r.id;
  end loop;
end $$;

-- ---------- ربط الشحنة بالمهمة (اختياري) ----------
alter table public.shipments add column if not exists task_ref text;
create index if not exists shipments_task_ref_idx on public.shipments(task_ref);

-- ============================================================
--  تم. الأرقام تُولّد تلقائياً بصيغة T-2026-0001
-- ============================================================
