# Plan: datos demo del marketplace (tenant Prueba Pos)

Estado: **ejecutado**. Fecha: 2026-10-18.

## Objetivo
Llenar `tienderu.com` con productos de ejemplo de un tenant real para validar el marketplace completo (catálogo público, ficha con galería y reseñas, opt-in del vendedor).

## Identidad verificada
- Tenant: **Prueba Pos** — `id 33a557f2-3df7-4857-bbe4-dd94317a22b7`, `status = active`.
- (La base también tiene "Prueba Bold", que no se toca: las consultas son por igualdad/UUID, no por LIKE.)

## Decisiones confirmadas
- Imágenes **Unsplash** realistas (cada URL verificada con HTTP 200 antes de generar el script; 73/74 candidatas válidas).
- **48 productos** (8 categorías × 6) con códigos `DEMO-001..DEMO-048`, precios COP, IVA 19% (Mercado 0%), stock 8–40, 3 fotos por producto y `points_cost` en 8 de ellos.
- **160 reseñas demo** (`customer_id NULL`, ratings 3–5) para mostrar estrellas.
- **Sin banners** (la tabla `banners` es global y afectaría la app móvil de todos los tenants).
- Opt-in del marketplace activado por el seed: `enabled = true`, `markup 10%`, vendedor "Prueba POS".

## Artefactos
- `docs/demo/prueba-pos-marketplace-seed.sql` (renombrado desde `pruebapos-...`): solo DML sobre tablas existentes, una transacción, re-ejecutable (borra solo `DEMO-%` del tenant antes de insertar) y con bloque de reversión comentado.
- El script resuelve el tenant **por UUID** con guardas (existe / activo); ya no depende del nombre exacto ni de parches `sed`.

## Ejecución (historial)
- Primer corrido en el VPS `vps-64dab15e` mediante `docker run --rm -i --network supabase_default postgres:16-alpine psql "$URL" < seed.sql`, con parche temporal `pruebapos → prueba pos` (el archivo de GitHub aún tenía el nombre viejo).
- Verificación en la misma salida: 8 categorías con 6 productos cada una (`NOEL` es una categoría preexistente, intacta), `productos_demo = 48`, `resenas_demo = 160`, `enabled = true`.
- La carpeta `~/pos-gres-v2/docs` del VPS quedó con dueño root (la creó Docker al montar un volumen inexistente); se usó `/tmp` para el seed. Opcional: `sudo chown -R ubuntu:ubuntu ~/pos-gres-v2/docs`.

## Pendiente operativo
- Push del commit con el script corregido y este plan; en el VPS (si se quiere re-ejecutar en el futuro):
  `curl -fsSL https://raw.githubusercontent.com/valbuenachris/TienderuPOS-V2.0/main/docs/demo/prueba-pos-marketplace-seed.sql -o /tmp/seed.sql`
  y correrlo con el mismo patrón `docker run ... psql "$URL"`.
