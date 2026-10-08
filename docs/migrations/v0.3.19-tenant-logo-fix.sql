-- POS v2 · v0.3.19 · Limpieza de logos heredados entre tenants (SOLO DATOS)
-- Corrige tenants que quedaron con el logo de otro (p. ej. PRINCESS SKIN) por el
-- backfill de v0.3.16 cuando el CTE `original` no eligió al tenant correcto.
-- No borra filas, no toca seed ni storage; solo pone logo_url = NULL donde toca.

-- ── 1) DIAGNÓSTICO: quién tiene logo y a qué tenant pertenece el archivo ──
-- La subida guarda `logos/<tenant_uuid>_<timestamp>.<ext>`, así que un logo es
-- ajeno cuando el UUID del path no coincide con el tenant de la fila.
SELECT t.name,
       s.site_name,
       s.logo_url,
       substring(s.logo_url from '/logos/([0-9a-fA-F-]{36})_') AS uploader_tenant
FROM public.tec_tenant_settings s
JOIN public.tec_tenants t ON t.id = s.tenant_id
ORDER BY t.name;

-- ── 2) LIMPIEZA: quitar logos cuyo archivo pertenece a otro tenant ──
BEGIN;
UPDATE public.tec_tenant_settings s
SET logo_url = NULL, updated_at = now()
WHERE s.logo_url IS NOT NULL
  AND s.logo_url ~ '/logos/'
  AND substring(s.logo_url from '/logos/([0-9a-fA-F-]{36})_') IS NOT NULL
  AND lower(substring(s.logo_url from '/logos/([0-9a-fA-F-]{36})_')) <> lower(s.tenant_id::text);
COMMIT;

-- ── 3) OPCIONAL: logos heredados que NO usan el patrón /logos/<uuid>_ (nombre
--    legacy o URL copiada). Deja el logo solo al tenant más antiguo que lo tenga.
-- BEGIN;
-- UPDATE public.tec_tenant_settings s
-- SET logo_url = NULL, updated_at = now()
-- WHERE s.logo_url IS NOT NULL
--   AND EXISTS (
--     SELECT 1 FROM public.tec_tenant_settings o
--     WHERE o.logo_url = s.logo_url
--       AND o.id <> s.id
--       AND (o.created_at, o.id) < (s.created_at, s.id)
--   );
-- COMMIT;

-- ── 4) VERIFICACIÓN: "Skin" conserva su logo; los demás con logo deben ser propios ──
SELECT t.name, s.site_name, s.logo_url IS NOT NULL AS tiene_logo
FROM public.tec_tenant_settings s
JOIN public.tec_tenants t ON t.id = s.tenant_id
ORDER BY t.name;

-- Nota: los archivos borrados del storage (bucket de productos, prefijo logos/)
-- no se eliminan con este SQL; si quieres, bórralos a mano desde Supabase Storage.
