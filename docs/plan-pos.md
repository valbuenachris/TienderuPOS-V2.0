# Plan: logo de plataforma en la vista global del superadmin (v0.3.86)

Estado: **aprobado y ejecutado** (Opción A). Fecha: 2026-10-18.

## Problema

- El superadmin, al entrar (vista global), veía en el sidebar el **logo del tenant de su usuario hogar** — p. ej. Princess Skin — en lugar del logo de la plataforma (Tienderu).
- Causa: `web/src/app/AppLayout.tsx` renderizaba siempre `settings.logo_url`. En vista global el token sigue siendo del **tenant hogar** del superadmin (o del **último tenant seleccionado**, porque `clearTenantSelection()` no revierte el token al hogar), así que `useSettingsQuery` devuelve los settings de ese tenant. El nombre ya era genérico ("Tienderu POS · Manager") pero el logo no.
- Auditoría: no hay más fugas de branding de tenant en la vista global (`LoginPage` y estados vacíos de `PosPage` usan el monograma "P"; ticket y `/config` son pantallas de tenant; `index.html` no tiene favicon).

## Solución aprobada (Opción A — asset estático empaquetado, sin API, sin DDL)

1. Asset `web/src/assets/tienderu-logo.svg` (**placeholder**; reemplazar por el logo real de Tienderu). Va en `src/assets` porque `web/Dockerfile` no copia `public/`; Vite lo empaqueta en `dist/assets` y `vite/client` ya tipa `*.svg` (sin cambios de tsconfig).
2. `web/src/app/AppLayout.tsx`:
   - `sidebarLogoUrl = showGlobalMenu ? platformLogoUrl : (settings?.logo_url ?? null)`.
   - `<img>` con `onError` → fallback al monograma "P" (estado `logoBroken`, se resetea al cambiar `sidebarLogoUrl`).
   - `alt`: "Tienderu POS" en vista global; `settings.site_name` dentro de un tenant.
3. Decisiones tomadas: al **entrar a un tenant** como superadmin se mantiene el branding del tenant (vista "como el tenant"). LoginPage y favicon quedan como mejora opcional futura. Opción B (endpoint `GET /api/platform/settings/pos` + `PLATFORM_LOGO_URL` para cambiarlo sin rebuild) queda como alternativa futura.
4. Docs (`AGENTS.md`/`README.md`) actualizados y deploy v0.3.86 (build + push + deploy; cero migraciones).

## Archivos

- `web/src/app/AppLayout.tsx` — fix principal.
- `web/src/assets/tienderu-logo.svg` — nuevo asset (placeholder a reemplazar).
- `AGENTS.md`, `README.md` — notas de la regla (vista global nunca usa branding de tenant).

## Verificación

- `npm --workspace web run build` (tsc + vite).
- Manual: (1) superadmin → vista global: logo de plataforma + nombre genérico; (2) seleccionar tenant: logo del tenant; (3) volver a "Seleccionar tenant…": logo de plataforma (cubre el token "pegado" del último tenant); (4) admin/cajero: sin cambios.
- Opcional futuro: extender el E2E de Playwright con este caso.

## Pendientes del usuario

- Reemplazar `web/src/assets/tienderu-logo.svg` por el **logo real de Tienderu** (SVG o PNG; se muestra a alto ≤ 40 px, ancho ≤ 120 px).
- Si se quiere cambiar el logo sin rebuild: solicitar la Opción B (endpoint de plataforma + env).

## Relacionado (fuera de alcance)

- `clearTenantSelection()` no revierte el token al tenant hogar (queda el último seleccionado). Con este fix ya no afecta al logo, pero conviene revisarlo en otra iteración (afecta, p. ej., la zona horaria que usa la UI en vista global).
