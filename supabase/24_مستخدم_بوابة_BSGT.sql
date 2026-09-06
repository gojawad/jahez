-- ============================================================
-- مستخدم بوابة BSGT: يشاهد شحنات بحر سواكن فقط ويسجل تحصيلها
-- شغّل هذا الملف مرة واحدة في Supabase -> SQL Editor -> Run
-- ============================================================

-- إضافة الدور الجديد دون تغيير الأدوار الحالية.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','editor','viewer','staff','bsgt_user'));

-- يعثر على الشركة من اسمها، لذلك لا نحتاج إلى حفظ معرفها داخل الكود.
create or replace function public.bsgt_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.companies
  where name_ar ~* 'بحر\s*سواكن' or name_en ~* 'bahar\s*swaken'
  order by is_default desc, sort_order, created_at
  limit 1;
$$;

create or replace function public.is_bsgt_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'bsgt_user' and active
                   from public.profiles where id = auth.uid()), false);
$$;

-- شحنات بحر سواكن فقط: قراءة وتعديل حالة الإرسال للتحصيل.
drop policy if exists shipments_select on public.shipments;
create policy shipments_select on public.shipments
  for select to authenticated
  using (
    public.is_active()
    and (
      owner_id = auth.uid()
      or public.is_admin()
      or (public.is_bsgt_user() and company_id = public.bsgt_company_id())
    )
  );

drop policy if exists shipments_update on public.shipments;
create policy shipments_update on public.shipments
  for update to authenticated
  using (
    public.is_active()
    and (
      public.is_admin()
      or (owner_id = auth.uid() and public.my_role() = 'editor')
      or (owner_id = auth.uid() and public.my_role() = 'staff' and status in ('draft','rework','review'))
      or (public.is_bsgt_user() and company_id = public.bsgt_company_id())
    )
  )
  with check (
    public.is_admin()
    or (owner_id = auth.uid() and public.my_role() = 'editor')
    or (owner_id = auth.uid() and public.my_role() = 'staff' and status in ('draft','review'))
    or (public.is_bsgt_user() and company_id = public.bsgt_company_id())
  );

-- يقرأ ويسجل دفعات التحصيل لشحنات BSGT فقط.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id
        and (
          s.owner_id = auth.uid()
          or public.is_admin()
          or (public.is_bsgt_user() and s.company_id = public.bsgt_company_id())
        )
    )
  );

drop policy if exists payments_write on public.payments;
create policy payments_write on public.payments
  for insert to authenticated
  with check (
    public.is_active() and exists (
      select 1 from public.shipments s
      where s.id = shipment_id
        and (
          (public.my_role() in ('admin','editor') and (s.owner_id = auth.uid() or public.is_admin()))
          or (public.is_bsgt_user() and s.company_id = public.bsgt_company_id())
        )
    )
  );
