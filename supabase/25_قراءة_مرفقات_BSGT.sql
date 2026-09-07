-- ============================================================
-- Allow the dedicated BSGT portal user to read files belonging
-- to Bahar Swaken shipments. Upload, replacement and deletion
-- remain restricted to the shipment owner or an administrator.
-- Safe to run more than once.
-- ============================================================

drop policy if exists shipmentfiles_select on public.shipment_files;
create policy shipmentfiles_select on public.shipment_files
  for select to authenticated
  using (
    public.is_active() and exists (
      select 1
      from public.shipments s
      where s.id = shipment_id
        and (
          s.owner_id = auth.uid()
          or public.is_admin()
          or (public.is_bsgt_user() and s.company_id = public.bsgt_company_id())
        )
    )
  );

drop policy if exists shippkgatt_select on public.shipment_package_attachments;
create policy shippkgatt_select on public.shipment_package_attachments
  for select to authenticated
  using (
    public.is_active() and exists (
      select 1
      from public.shipments s
      where s.id = shipment_id
        and (
          s.owner_id = auth.uid()
          or public.is_admin()
          or (public.is_bsgt_user() and s.company_id = public.bsgt_company_id())
        )
    )
  );

notify pgrst, 'reload schema';
