-- ============================================================
-- Permit the dedicated BSGT user to manage attachments only for
-- Bahar Swaken shipments. Existing shipment and document data is
-- not changed by these policies.
-- ============================================================

drop policy if exists shipmentfiles_write on public.shipment_files;
create policy shipmentfiles_write on public.shipment_files
  for insert to authenticated
  with check (
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

drop policy if exists shipmentfiles_delete on public.shipment_files;
create policy shipmentfiles_delete on public.shipment_files
  for delete to authenticated
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
