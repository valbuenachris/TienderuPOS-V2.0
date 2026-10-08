-- POS v2 · v0.3.11c · Backfill de configuración por tenant (SOLO DATOS, opcional)
-- Requiere la columna opcional `tec_settings.tenant_id` (setup de settings por tenant).
-- Con v0.3.15 la API auto-provisiona la fila al primer GET/PUT y el bootstrap de
-- tenant la crea al dar de alta el tenant, así que este script es opcional:
-- úsalo si prefieres crearlas todas de una vez.
--
-- Diagnóstico previo (tenants sin fila de settings):
--   SELECT t.name, s.setting_id
--   FROM public.tec_tenants t
--   LEFT JOIN public.tec_settings s ON s.tenant_id = t.id
--   WHERE (t.status IS NULL OR t.status <> 'deleted')
--   ORDER BY t.name;

BEGIN;

INSERT INTO public.tec_settings (site_name, currency_prefix, default_customer, tenant_id)
SELECT COALESCE(b.site_name, t.name), b.currency_prefix, b.default_customer, t.id
FROM public.tec_tenants t
CROSS JOIN LATERAL (
  SELECT site_name, currency_prefix, default_customer
  FROM public.tec_settings
  ORDER BY (tenant_id IS NULL) DESC, setting_id ASC
  LIMIT 1
) b
WHERE (t.status IS NULL OR t.status <> 'deleted')
  AND NOT EXISTS (SELECT 1 FROM public.tec_settings x WHERE x.tenant_id = t.id);

COMMIT;

-- Verificación: debe haber una fila por tenant (site_name nunca NULL)
SELECT t.name, s.setting_id, s.site_name
FROM public.tec_tenants t
LEFT JOIN public.tec_settings s ON s.tenant_id = t.id
WHERE (t.status IS NULL OR t.status <> 'deleted')
ORDER BY t.name;
