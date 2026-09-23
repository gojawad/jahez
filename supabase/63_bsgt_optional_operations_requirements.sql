-- Operations can merge and send a package without all seven requirements.
-- Only the documents that are actually available are merged: generated kinds
-- whose data is filled in and the uploaded originals that exist. A package
-- still needs at least one document. Existing shipments and revisions are untouched.
begin;

create or replace function public.bsgt_operations_readiness(p_shipment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, storage
as $$
  with shipment as (
    select s.*
    from public.shipments s
    where s.id = p_shipment_id
      and s.company_id = public.bsgt_company_id()
  ), files as (
    select f.id, f.document_type, f.label,
      case
        when f.document_type in ('import_permit','certificate_of_origin','bill_of_lading') then f.document_type
        when f.label = 'إذن الاستيراد' then 'import_permit'
        when f.label in ('شهادة المنشأ', 'شهادة المنشأ (بحر سواكن)') then 'certificate_of_origin'
        when f.label in ('بوليصة الشحن', 'بوليصة الشحن (بحر سواكن)') then 'bill_of_lading'
        else null
      end as required_type
    from public.shipment_files f
    join shipment s on s.id = f.shipment_id
  ), checks as (
    select
      coalesce(nullif(trim(s.data->>'operationNo'), ''), null) is not null
        and coalesce(nullif(trim(s.data->>'consignee'), ''), null) is not null
        and coalesce(nullif(trim(s.data->>'itemDesc'), ''), null) is not null as contract_ready,
      coalesce(nullif(trim(s.data->>'proformaNo'), ''), null) is not null as proforma_ready,
      coalesce(nullif(trim(s.data->>'invoiceNo'), ''), null) is not null as invoice_ready,
      coalesce(nullif(trim(s.data->>'invoiceNo'), ''), null) is not null as packing_ready,
      exists(select 1 from files where document_type = 'import_permit' or label = 'إذن الاستيراد') as import_permit_ready,
      exists(select 1 from files where document_type = 'certificate_of_origin' or label in ('شهادة المنشأ', 'شهادة المنشأ (بحر سواكن)')) as origin_ready,
      exists(select 1 from files where document_type = 'bill_of_lading' or label in ('بوليصة الشحن', 'بوليصة الشحن (بحر سواكن)')) as bol_ready,
      coalesce((select jsonb_agg(id order by id) from files where required_type is not null), '[]'::jsonb) as uploaded_ids,
      coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',required_type) order by id) from files where required_type is not null), '[]'::jsonb) as uploaded_documents
    from shipment s
  )
  select jsonb_build_object(
    -- "completed" gates merging and sending to finance: any available document is enough.
    'completed', contract_ready or proforma_ready or invoice_ready or packing_ready
      or import_permit_ready or origin_ready or bol_ready,
    'allRequirementsCompleted', contract_ready and proforma_ready and invoice_ready and packing_ready
      and import_permit_ready and origin_ready and bol_ready,
    -- Only ready kinds are listed, so the package renders no empty templates.
    'generated', jsonb_strip_nulls(jsonb_build_object(
      'contract', case when contract_ready then true end,
      'proforma', case when proforma_ready then true end,
      'invoice', case when invoice_ready then true end,
      'packing', case when packing_ready then true end)),
    'uploaded', jsonb_build_object('importPermit',import_permit_ready,'certificateOfOrigin',origin_ready,'billOfLading',bol_ready),
    'uploadedDocumentIds', uploaded_ids,
    'uploadedDocuments', uploaded_documents
  )
  from checks;
$$;

revoke all on function public.bsgt_operations_readiness(uuid) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
