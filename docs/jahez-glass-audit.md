# Jahez Glass UI Audit

## Safety boundary

- UI-only work on `ui/jahez-glass-design-system`.
- No database, Supabase, API, environment, route, document-generation, or workflow changes.
- No production deployment from this branch without explicit approval.
- Existing DOM order, IDs, form names, handlers, and dashboard layout remain unchanged.

## Current interface map

- App shell: `.o-topstrip`, `.o-navbar`, `.app-sidebar`, `.o-control-panel`, `.wrap`.
- Views: dashboard, activity log, operation center, shipments, create shipment, shipment form, tasks, review, collection, wallet, and admin.
- Shared UI: `.btn`, `.field`, `.panel`, `.overlay`, `.detail-card`, `.section-title`, `.ledger`, `.pill`, tabs, alerts, and empty states.
- Dashboard: existing hero, stat grids, panels, charts, operations table, and distribution section.
- BSGT: shipment cards, full-screen operation workspace, document cards, and shipment-entry overlay.
- Supporting surfaces: shipment wizard, company wizard, profile panel, template editors, and collection lab.

## Implementation decision

`jahez-glass.css` is loaded after all existing UI styles and acts as a reversible visual skin. It centralizes tokens and overrides presentation only. Print/PDF document classes are intentionally excluded so saved document formatting remains untouched.

## Regression boundary

- Static route and API smoke tests.
- Inline JavaScript parse test.
- DOM contract checks for IDs, views, forms, and handlers.
- Local visual QA with synthetic in-memory records only.
- No create, update, upload, or delete tests against production records.
