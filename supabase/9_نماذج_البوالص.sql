-- ============================================================
--  إضافة: نماذج بوالص متعددة (بري وبحري)
--  الصق هذا الملف في: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة
-- ============================================================

-- ---------- 1) جدول نماذج البوالص ----------
create table if not exists public.bol_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                    -- الاسم الذي يختاره المستخدم
  ship_type   text not null default 'land' check (ship_type in ('land','sea','both')),
  image       text,                             -- صورة النموذج (base64)
  positions   jsonb not null default '{}'::jsonb,  -- أماكن الحقول على هذا النموذج
  is_default  boolean not null default false,
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists bol_tpl_type_idx on public.bol_templates(ship_type, active, sort_order);
create unique index if not exists bol_tpl_name_uniq on public.bol_templates(lower(btrim(name)));

drop trigger if exists bol_tpl_touch on public.bol_templates;
create trigger bol_tpl_touch before update on public.bol_templates
  for each row execute function public.touch_updated_at();

alter table public.bol_templates enable row level security;

-- الجميع يقرأ (لازم لاختيار النموذج عند إنشاء الشحنة)
drop policy if exists bol_tpl_read on public.bol_templates;
create policy bol_tpl_read on public.bol_templates
  for select to authenticated using (public.is_active());

-- المدير وحده يضيف ويعدّل ويحذف
drop policy if exists bol_tpl_admin on public.bol_templates;
create policy bol_tpl_admin on public.bol_templates
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- 2) ربط الشحنة بنموذج البوليصة ----------
alter table public.shipments
  add column if not exists bol_template_id uuid references public.bol_templates(id) on delete set null;
create index if not exists shipments_boltpl_idx on public.shipments(bol_template_id);

-- ---------- 3) نموذج افتراضي واحد لكل نوع شحن ----------
create or replace function public.one_default_bol()
returns trigger language plpgsql as $$
begin
  if new.is_default then
    update public.bol_templates
       set is_default = false
     where id <> new.id
       and is_default
       and ship_type = new.ship_type;
  end if;
  return new;
end; $$;

drop trigger if exists bol_tpl_one_default on public.bol_templates;
create trigger bol_tpl_one_default
  after insert or update of is_default on public.bol_templates
  for each row when (new.is_default) execute function public.one_default_bol();

-- ---------- 4) ترحيل النماذج الحالية ----------
-- ننقل نموذجي البوليصة الحاليين (البري والبحري) إلى الجدول الجديد
do $$
declare
  v_company jsonb;
  v_pos     jsonb;
begin
  if exists (select 1 from public.bol_templates) then
    return;   -- تم الترحيل من قبل
  end if;

  select value into v_company from public.settings where key = 'company';
  select value into v_pos     from public.settings where key = 'template_positions';

  insert into public.bol_templates (name, ship_type, image, positions, is_default, sort_order)
  values
    ('بوليصة الشحن البري', 'land',
     nullif(v_company->>'bolImg',''),
     coalesce(v_pos->'bol', '{}'::jsonb), true, 0),
    ('بوليصة الشحن البحري', 'sea',
     nullif(v_company->>'bolImgSea',''),
     coalesce(v_pos->'bolSea', '{}'::jsonb), true, 1);
end $$;

-- ============================================================
--  تم. أضف نماذجك من: لوحة التحكم ← النماذج والمستندات
-- ============================================================
