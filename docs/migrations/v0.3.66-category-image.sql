-- POS v2 · v0.3.66 · Imagen de categoría (DDL aprobado, OPCIONAL)
-- Agrega image_url a tec_categories para los círculos de categorías de la app
-- de clientes (tienda_virtual). Sin esta migración la API sigue funcionando:
-- CategoriesService detecta la columna y devuelve image_url = NULL, y la app
-- muestra el círculo con la letra inicial como fallback.
-- Ejecutar UNA VEZ cuando se quieran habilitar imágenes en las categorías. No borra datos.

BEGIN;

ALTER TABLE public.tec_categories
  ADD COLUMN IF NOT EXISTS image_url varchar(500);

COMMIT;

-- Verificación
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tec_categories'
  AND column_name = 'image_url';

-- Reversión (solo si se requiere deshacer, en una ventana de mantenimiento):
-- BEGIN;
--   ALTER TABLE public.tec_categories DROP COLUMN IF EXISTS image_url;
-- COMMIT;
