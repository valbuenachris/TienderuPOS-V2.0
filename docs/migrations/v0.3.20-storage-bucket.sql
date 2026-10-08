-- POS v2 · v0.3.20 · Bucket público para logos e imágenes (Supabase Storage)
-- Alternativa al Dashboard: Storage → New bucket → nombre "productos" → Public.
-- La API sube con service role (no requiere policies de escritura); el bucket
-- debe ser público para que el navegador muestre los logos por URL pública.
-- Si usas otro nombre, ajusta SUPABASE_PRODUCT_BUCKET en el .env de la API.

INSERT INTO storage.buckets (id, name, public)
VALUES ('productos', 'productos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Verificación (debe devolver una fila con public = true)
SELECT id, name, public, created_at FROM storage.buckets WHERE id = 'productos';

-- Diagnóstico: objetos de logos ya subidos (opcional)
-- SELECT name, created_at FROM storage.objects
-- WHERE bucket_id = 'productos' AND name LIKE 'logos/%' ORDER BY created_at DESC LIMIT 20;
