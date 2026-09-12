-- Keep uploaded BSGT operations documents writable only while the shipment is
-- formally in the operations stage. Other shipment-file flows remain unchanged.

begin;

drop policy if exists shipmentfiles_write on public.shipment_files;
create policy shipmentfiles_write on public.shipment_files
  for insert to authenticated
  with check (
    public.is_active() and exists (
      select 1
      from public.shipments shipment
      where shipment.id = shipment_id
        and case
          when shipment.company_id = public.bsgt_company_id()
               and public.is_bsgt_operations_uploaded_document(document_type, label)
            then shipment.bsgt_stage = 'operations_draft'
                 and public.has_feature_permission('bsgt.operations.edit')
          else shipment.owner_id = auth.uid()
               or public.is_admin()
               or (shipment.company_id = public.bsgt_company_id()
                   and public.has_feature_permission('bsgt.operations.edit'))
        end
    )
  );

notify pgrst, 'reload schema';

commit;
