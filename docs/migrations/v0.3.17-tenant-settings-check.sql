-- POS v2 · v0.3.17 · Diagnóstico de settings por tenant (SOLO LECTURA + fix opcional)
-- Ejecuta esto si "Prueba Pos" (u otro tenant) sigue mostrando "PRINCESS SKIN".
-- La API v0.3.17 detecta `tec_tenant_settings` sola (reintenta cada 30 s), así que
-- ya no hace falta reiniciar el contenedor tras correr la migración v0.3.16.

-- 1) ¿Existe la tabla de settings por tenant?
SELECT to_regclass('public.tec_tenant_settings') IS NOT NULL AS tabla_existe;

-- 2) Filas creadas y site_name por tenant (Prueba Pos debe decir "Prueba Pos")
SELECT t.name AS tenant, t.status AS tenant_estado, s.id, s.site_name, s.updated_at
FROM public.tec_tenants t
LEFT JOIN public.tec_tenant_settings s ON s.tenant_id = t.id
WHERE t.status IS NULL OR t.status <> 'deleted'
ORDER BY t.name;

-- 3) Tenants sin fila propia (la API la crea sola al primer GET/PUT, o usa la v0.3.16)
SELECT t.id, t.name
FROM public.tec_tenants t
WHERE (t.status IS NULL OR t.status <> 'deleted')
  AND NOT EXISTS (SELECT 1 FROM public.tec_tenant_settings s WHERE s.tenant_id = t.id);

-- 4) OPCIONAL: si un tenant no-original quedó con el site_name legado, corregirlo.
--    Revisa el resultado del punto 2 antes; "Skin" (tenant original) conserva su nombre.
-- UPDATE public.tec_tenant_settings s
-- SET site_name = t.name, updated_at = now()
-- FROM public.tec_tenants t
-- WHERE s.tenant_id = t.id
--   AND t.name <> 'Skin'
--   AND s.site_name = 'PRINCESS SKIN';
