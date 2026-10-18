# Plan: skill frontend-ui + mejoras del frontend (cajero actual, animaciones, breadcrumbs, dark mode)

Estado: **completo**. Fases 1-4 ejecutadas (v0.3.87 → v0.3.90). Fecha: 2026-10-18.

Decisiones confirmadas por el usuario:
- **Fase 1 CON badge de caja** (abierta/cerrada).
- **Dark mode: SÍ se ejecuta** (Fase 4).
- Este plan vive en `docs/plan-frontend-ui.md`.

## Parte A — Skill `frontend-ui` (creada)

Archivo: `.opencode/skills/frontend-ui/SKILL.md` (workspace root, junto a `nestjs-react-supabase-readonly`). Contiene: design tokens reales de `web/src/styles.css`, primitivas de `components/ui.tsx`, reglas UX/accesibilidad (español, TanStack Query, roles, no romper selectores del E2E) y las recetas:

- **R1 · Cajero actual en el POS** (implementada en v0.3.87).
- **R2 · Micro-animaciones y skeletons** (respetando `prefers-reduced-motion`).
- **R3 · Breadcrumbs** por ruta.
- **R4 · Dark mode por variables CSS** (checklist de conversión).
- **R5 · Dashboard polish** (KPIs consistentes).
- **R6 · Toasts/Notices y estados vacíos**.

Nota: tras crear/editar una skill hay que **reiniciar opencode** para que la cargue.

## Parte B — Fases de aplicación

### Fase 1 (v0.3.87) — Cajero actual en el POS · EJECUTADA
- `web/src/pages/PosPage.tsx`: chip **"Cajero: {nombre}"** en el encabezado del POS (junto a "Nueva venta") con **punto verde/rojo = Caja abierta/cerrada**, alimentado por `useCurrentRegisterQuery(token, tenantId, storeId)` (staff-scoped, misma fuente que `/caja`).
- `web/src/components/SaleConfirmationModal.tsx`: línea "Atendido por: {cajero}" en el meta del modal (prop opcional `cashierName`).
- `web/src/styles.css`: estilos `.cashier-chip` / `.cashier-dot`.
- El ticket ya mostraba el cajero (`cashierName` en `SaleTicket`) desde v0.3.35.

### Fase 2 (v0.3.88) — Micro-interacciones y a11y visual · EJECUTADA
- Animaciones: `modal-in` (fade+scale), `notice-in`, hover en `.product-card`/`.row-actions`, transición del sidebar.
- `@media (prefers-reduced-motion: reduce)` desactiva animaciones/transiciones.
- Anillos `:focus-visible` accesibles en botones/inputs; skeletons en catálogo y tablas.

### Fase 3 (v0.3.89) — Breadcrumbs · EJECUTADA
- Componente `<Breadcrumbs>` + mapa estático ruta→etiqueta (`ventas→Ventas`, `tenant-management→Gestión de tenants`, …), renderizado en `main.page` (AppLayout) o prop nueva de `PageHeader`.
- En vista global: "Gestión de tenants / …".

### Fase 4 (v0.3.90) — Dark mode · EJECUTADA
- Refactor de `web/src/styles.css` (~1196 líneas, ~279 literales de color) a **variables CSS** en `:root` + `[data-theme='dark']`.
- Toggle en el sidebar (persistido en `localStorage`; inicial desde `prefers-color-scheme`).
- Conversión por lotes: frame/sidebar → cards/tablas → modales/inputs → scanner.
- **El ticket/PDF se mantiene claro** (impresión) y los logos/imágenes no cambian.

### Fase 5 (futuro, solo recetas en la skill)
- Dashboard polish, toasts globales, breadcrumbs móviles.

## Archivos por fase
- Skill: `.opencode/skills/frontend-ui/SKILL.md`
- F1: `web/src/pages/PosPage.tsx`, `web/src/components/SaleConfirmationModal.tsx`, `web/src/styles.css` ✅
- F2/F4: `web/src/styles.css` (+ `ui.tsx`/`AppLayout.tsx` para el toggle)
- F3: `web/src/components/ui.tsx` (o `Breadcrumbs.tsx`) + `web/src/app/AppLayout.tsx`
- Docs: `AGENTS.md` / `README.md` por versión

## Verificación por fase
- `npm --workspace web run build` (tsc + vite) antes de entregar.
- Revisión visual en las 3 sesiones: cajero, admin, superadmin (vista global).
- El E2E Playwright (`web/e2e/pos-sale.spec.ts`) debe seguir pasando: no tocar labels/roles existentes.
