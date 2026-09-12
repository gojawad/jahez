-- BSGT Operations uploaded-document deletion guard.
-- No data is migrated. Existing shipment files and workflow history are preserved.

create or replace function public.is_bsgt_operations_uploaded_document(
  p_document_type text,
  p_label text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(lower(trim(p_document_type)), '') in (
    'import_permit',
    'certificate_of_origin',
    'bill_of_lading',
    'optional_attachment'
  ) or coalesce(trim(p_label), '') in (
    'إذن الاستيراد',
    'شهادة المنشأ',
    'شهادة المنشأ (بحر سواكن)',
    'بوليصة الشحن',
    'بوليصة الشحن (بحر سواكن)',
    'ملف إضافي اختياري'
  );
$$;

drop policy if exists shipmentfiles_delete on public.shipment_files;
create policy shipmentfiles_delete on public.shipment_files
  for delete to authenticated
  using (
    public.is_active() and exists (
      select 1
      from public.shipments shipment
      where shipment.id = shipment_id
        and case
          when shipment.company_id = public.bsgt_company_id()
               and public.is_bsgt_operations_uploaded_document(document_type, label)
            then shipment.bsgt_stage = 'operations_draft'
                 and public.has_bsgt_workspace_permission('operations', true)
          else shipment.owner_id = auth.uid()
               or public.is_admin()
               or (public.is_bsgt_user() and shipment.company_id = public.bsgt_company_id())
               or (shipment.company_id = public.bsgt_company_id()
                   and public.has_bsgt_workspace_permission('operations', true))
        end
    )
  );

drop policy if exists shipmentfiles_remove on storage.objects;
create policy shipmentfiles_remove on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'shipment-files'
    and public.is_active()
    and (
      -- Preserve the existing cleanup path for temporary uploads that have no DB row.
      not exists (
        select 1 from public.shipment_files file
        where file.path = storage.objects.name
      )
      or exists (
        select 1
        from public.shipment_files file
        join public.shipments shipment on shipment.id = file.shipment_id
        where file.path = storage.objects.name
          and case
            when shipment.company_id = public.bsgt_company_id()
                 and public.is_bsgt_operations_uploaded_document(file.document_type, file.label)
              then shipment.bsgt_stage = 'operations_draft'
                   and public.has_bsgt_workspace_permission('operations', true)
            else shipment.owner_id = auth.uid()
                 or public.is_admin()
                 or (public.is_bsgt_user() and shipment.company_id = public.bsgt_company_id())
                 or (shipment.company_id = public.bsgt_company_id()
                     and public.has_bsgt_workspace_permission('operations', true))
          end
      )
    )
  );

create or replace function public.delete_bsgt_operations_document(
  p_shipment_id uuid,
  p_file_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.shipments%rowtype;
  v_file public.shipment_files%rowtype;
begin
  if not public.has_bsgt_workspace_permission('operations', true) then
    raise exception 'BSGT operations edit permission is required';
  end if;

  select * into v_shipment
  from public.shipments shipment
  where shipment.id = p_shipment_id
    and shipment.company_id = public.bsgt_company_id()
  for update;

  if not found then raise exception 'BSGT shipment was not found'; end if;
  if v_shipment.bsgt_stage <> 'operations_draft' then
    raise exception 'Shipment documents are read-only outside operations draft';
  end if;

  select * into v_file
  from public.shipment_files file
  where file.id = p_file_id
    and file.shipment_id = p_shipment_id
  for update;

  if not found then raise exception 'Shipment document was not found'; end if;
  if not public.is_bsgt_operations_uploaded_document(v_file.document_type, v_file.label) then
    raise exception 'Only uploaded operations documents can be deleted';
  end if;

  delete from public.shipment_files file
  where file.id = p_file_id
    and file.shipment_id = p_shipment_id;

  return to_jsonb(v_file);
end;
$$;

revoke all on function public.is_bsgt_operations_uploaded_document(text, text) from public, anon;
revoke all on function public.delete_bsgt_operations_document(uuid, uuid) from public, anon;
grant execute on function public.is_bsgt_operations_uploaded_document(text, text) to authenticated;
grant execute on function public.delete_bsgt_operations_document(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
