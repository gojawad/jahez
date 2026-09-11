-- Jahez shipment workflow, phase 2: signed documents only.
-- Additive only. Existing shipment statuses, files, and RLS policies remain unchanged.

alter table public.shipment_files
  add column if not exists document_type text,
  add column if not exists signature_status text not null default 'uploaded',
  add column if not exists signed_at timestamptz,
  add column if not exists is_required boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.shipment_files
  drop constraint if exists shipment_files_signature_status_check;

alter table public.shipment_files
  add constraint shipment_files_signature_status_check
  check (signature_status in ('uploaded', 'signed'));

create index if not exists shipmentfiles_shipment_idx
  on public.shipment_files(shipment_id);

create index if not exists shipmentfiles_document_type_idx
  on public.shipment_files(document_type);

create index if not exists shipmentfiles_signature_status_idx
  on public.shipment_files(signature_status);

create index if not exists shipmentfiles_shipment_document_signature_idx
  on public.shipment_files(shipment_id, document_type, signature_status);

notify pgrst, 'reload schema';
