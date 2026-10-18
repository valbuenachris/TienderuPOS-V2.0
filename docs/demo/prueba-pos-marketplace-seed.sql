-- POS v2 · Datos DEMO del marketplace para el tenant "Prueba Pos" (SOLO DML, no es migración)
-- Tenant verificado: id 33a557f2-3df7-4857-bbe4-dd94317a22b7 (activo). Se resuelve por UUID,
-- así el script no depende del nombre exacto (antes requería "pruebapos" y un parche manual).
-- Genera 8 categorías, 48 productos (códigos DEMO-001..DEMO-048), reseñas demo y activa el
-- opt-in del marketplace. Re-ejecutable: primero borra SOLO los productos DEMO-% del tenant.
-- Ejecutar (desde el host del deploy):
--   URL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)
--   docker run --rm -i --network "${SUPABASE_NETWORK_NAME:-supabase_default}" postgres:16-alpine \
--     psql "$URL" < docs/demo/prueba-pos-marketplace-seed.sql
-- Reversión: ver bloque comentado al final del archivo.

BEGIN;

DROP TABLE IF EXISTS _demo_tenant;
CREATE TEMP TABLE _demo_tenant AS
  SELECT id FROM public.tec_tenants
  WHERE id = '33a557f2-3df7-4857-bbe4-dd94317a22b7'::uuid;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM _demo_tenant) = 0 THEN
    RAISE EXCEPTION 'Tenant "Prueba Pos" (33a557f2-3df7-4857-bbe4-dd94317a22b7) no encontrado en tec_tenants';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tec_tenants t JOIN _demo_tenant d ON d.id = t.id WHERE t.status = 'active'
  ) THEN
    RAISE EXCEPTION 'El tenant "Prueba Pos" no está activo (status <> active)';
  END IF;
END $$;

-- 1) Limpieza de datos demo previos (las reseñas caen por ON DELETE CASCADE de product_reviews)
DELETE FROM public.tec_products
WHERE tenant_id = (SELECT id FROM _demo_tenant) AND code LIKE 'DEMO-%';

-- 2) Categorías
INSERT INTO public.tec_categories (tenant_id, name, description)
SELECT (SELECT id FROM _demo_tenant), v.name, v.description
FROM (VALUES
  ('Tecnología', 'Computo, audio y gadgets'),
  ('Hogar y Cocina', 'Todo para tu casa'),
  ('Mercado', 'Despensa y víveres'),
  ('Belleza e Higiene', 'Cuidado personal'),
  ('Deportes', 'Fitness y aire libre'),
  ('Juguetería', 'Diversión y aprendizaje'),
  ('Papelería', 'Escolar y oficina'),
  ('Moda', 'Ropa y accesorios')
) AS v(name, description)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 3) Productos demo (48) — precio base + IVA del tenant; el marketplace aplica el markup encima
INSERT INTO public.tec_products
  (tenant_id, code, name, price, cost, tax, type, reward_points, details, category_id, quantity, points_cost, image, image_2, image_3)
SELECT (SELECT id FROM _demo_tenant), v.code, v.name, v.price, v.cost, v.tax, 'standard', v.reward_points, v.details,
       (SELECT c.id FROM public.tec_categories c WHERE c.tenant_id = (SELECT id FROM _demo_tenant) AND c.name = v.category),
       v.quantity, v.points_cost, v.image, v.image2, v.image3
FROM (VALUES
  ('DEMO-001', 'Audífonos Bluetooth Pro con Cancelación de Ruido', 189900, 132900, 19, 19, 'Audífonos inalámbricos con cancelación activa de ruido, hasta 30 horas de batería y estuche de carga. Incluye cable USB-C y guía rápida.', 'Tecnología', 25, 0, 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-002', 'Smartwatch Deportivo Serie 8 con GPS', 329900, 230900, 19, 33, 'Reloj inteligente con GPS integrado, medición de ritmo cardíaco, oxígeno en sangre y más de 100 modos deportivos. Resistente al agua.', 'Tecnología', 15, 1500, 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-003', 'Parlante Bluetooth Portátil Resistente al Agua', 129900, 90900, 19, 13, 'Parlante portátil con sonido estéreo de 20 W, batería de 12 horas y certificación IPX7. Ideal para exteriores y viajes.', 'Tecnología', 30, 0, 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-004', 'Teclado Mecánico RGB con Switches Táctiles', 249900, 174900, 19, 25, 'Teclado mecánico retroiluminado RGB con switches táctiles, reposamuñecas magnético y cable USB-C desmontable.', 'Tecnología', 12, 0, 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-005', 'Mouse Inalámbrico Ergonómico Recargable', 89900, 62900, 19, 9, 'Mouse ergonómico con sensor de 2400 DPI, conexión inalámbrica 2.4 GHz y Bluetooth, batería recargable de larga duración.', 'Tecnología', 40, 0, 'https://images.unsplash.com/photo-1468495244123-6c6c332eeece?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1468495244123-6c6c332eeece?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1468495244123-6c6c332eeece?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-006', 'Cámara Instantánea Retro con Estuche', 279900, 195900, 19, 28, 'Cámara instantánea con flash automático, espejo selfie y lente para primeros planos. Incluye estuche y correa.', 'Tecnología', 10, 0, 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-007', 'Juego de Sábanas Premium Queen 4 Piezas', 159900, 111900, 19, 16, 'Juego de sábanas de algodón egipcio 400 hilos: sábana plana, ajustable y dos fundas. Suaves, frescas y duraderas.', 'Hogar y Cocina', 18, 0, 'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-008', 'Set de Ollas Antiadherentes 10 Piezas', 289900, 202900, 19, 29, 'Juego de ollas y sartenes con recubrimiento antiadherente libre de PFOA, tapas de vidrio templado y mangos de baquelita.', 'Hogar y Cocina', 10, 1200, 'https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-009', 'Licuadora 600W con Vaso de Vidrio', 189900, 132900, 19, 19, 'Licuadora de 600 W con vaso de vidrio resistente de 1.5 L, cuchillas de acero inoxidable y 2 velocidades con función pulso.', 'Hogar y Cocina', 14, 0, 'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-010', 'Vajilla de Cerámica 12 Piezas para 4', 219900, 153900, 19, 22, 'Vajilla de cerámica esmaltada: 4 platos grandes, 4 medianos y 4 bowls. Apta para microondas y lavavajillas.', 'Hogar y Cocina', 12, 0, 'https://images.unsplash.com/photo-1556911220-bff31c812dba?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1556911220-bff31c812dba?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1556911220-bff31c812dba?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-011', 'Cafetera de Goteo 12 Tazas Programable', 149900, 104900, 19, 15, 'Cafetera programable de 12 tazas con temporizador de 24 horas, jarra térmica y sistema antigoteo.', 'Hogar y Cocina', 16, 0, 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-012', 'Set de Toallas de Algodón 6 Piezas', 99900, 69900, 19, 10, 'Set de toallas de algodón peinado 100%: 2 de baño, 2 de manos y 2 faciales. Alta absorción y suavidad.', 'Hogar y Cocina', 20, 0, 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-013', 'Arroz Blanco Premium 5 kg', 21900, 15300, 0, 2, 'Arroz blanco de grano largo, seleccionado y fortificado. Rendidor y de excelente cocción.', 'Mercado', 40, 0, 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-014', 'Aceite de Girasol 1 L', 15900, 11100, 0, 2, 'Aceite 100% de girasol, rico en vitamina E. Ideal para cocinar, freír y aderezar.', 'Mercado', 35, 0, 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-015', 'Café Molido Tostión Media 500 g', 18900, 13200, 0, 2, 'Café de origen colombiano tostado y molido, con notas dulces y aroma intenso. Bolsa con válvula de frescura.', 'Mercado', 30, 400, 'https://images.unsplash.com/photo-1506976785307-8732e854ad03?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1506976785307-8732e854ad03?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1506976785307-8732e854ad03?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-016', 'Pasta Espagueti 500 g', 5900, 4100, 0, 1, 'Pasta de sémola de trigo durum, rica en proteínas. Cocción al dente en 8 minutos.', 'Mercado', 40, 0, 'https://images.unsplash.com/photo-1519996529931-28324d5a630e?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1519996529931-28324d5a630e?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1519996529931-28324d5a630e?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-017', 'Canasta de Frutas y Verduras Surtidas', 49900, 34900, 0, 5, 'Selección fresca de temporada con frutas y verduras variadas. Ideal para la semana familiar.', 'Mercado', 15, 0, 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-018', 'Pan Artesanal Integral Tajado', 12900, 9000, 0, 1, 'Pan integral artesanal con semillas de linaza y girasol. Horneado del día, alto en fibra.', 'Mercado', 20, 0, 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-019', 'Crema Facial Hidratante 50 ml', 45900, 32100, 19, 5, 'Crema facial con ácido hialurónico y vitamina E. Hidratación profunda por 24 horas, no comedogénica.', 'Belleza e Higiene', 25, 0, 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-020', 'Sérum Vitamina C 30 ml', 59900, 41900, 19, 6, 'Sérum antioxidante con vitamina C estabilizada al 12%. Ilumina, unifica el tono y atenúa manchas.', 'Belleza e Higiene', 20, 800, 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-021', 'Set de Brochas de Maquillaje 10 Piezas', 89900, 62900, 19, 9, 'Juego de 10 brochas profesionales con fibras ultra suaves y mangos ergonómicos. Incluye estuche de viaje.', 'Belleza e Higiene', 18, 0, 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-022', 'Paleta de Sombras Nude 12 Tonos', 74900, 52400, 19, 7, 'Paleta con 12 tonos nude entre mates y satinados, alta pigmentación y larga duración.', 'Belleza e Higiene', 22, 0, 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-023', 'Shampoo Reparador con Keratina 400 ml', 32900, 23000, 19, 3, 'Shampoo con keratina y aceite de argán para cabello maltratado. Repara, fortalece y da brillo.', 'Belleza e Higiene', 30, 0, 'https://images.unsplash.com/photo-1585232004423-244e0e6904e3?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1585232004423-244e0e6904e3?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1585232004423-244e0e6904e3?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-024', 'Protector Solar Facial SPF 50+ 60 ml', 54900, 38400, 19, 5, 'Protector solar de amplio espectro SPF 50+, no graso, con color. Apto para todo tipo de piel.', 'Belleza e Higiene', 28, 0, 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-025', 'Mancuernas Ajustables 10 kg (Par)', 149900, 104900, 19, 15, 'Par de mancuernas ajustables con discos intercambiables, recubiertas en vinilo antideslizante.', 'Deportes', 12, 0, 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-026', 'Mat de Yoga Antideslizante 6 mm', 79900, 55900, 19, 8, 'Mat de yoga de 6 mm en TPE ecológico, doble cara antideslizante y correa de transporte.', 'Deportes', 20, 0, 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-027', 'Balón de Fútbol Profesional No. 5', 89900, 62900, 19, 9, 'Balón cosido a máquina con cubierta de PU resistente, ideal para cancha y entrenamiento.', 'Deportes', 25, 0, 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-028', 'Bandas Elásticas de Resistencia (Set 5)', 45900, 32100, 19, 5, 'Set de 5 bandas elásticas de látex natural con 5 niveles de resistencia. Incluye bolsa y guía de ejercicios.', 'Deportes', 30, 300, 'https://images.unsplash.com/photo-1599058917212-d750089bc07e?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1599058917212-d750089bc07e?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1599058917212-d750089bc07e?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-029', 'Kit de Entrenamiento con Pesas Rusas', 119900, 83900, 19, 12, 'Kit de pesas rusas con recubrimiento de neopreno y asa amplia. Disponible en pesos de 4 a 12 kg.', 'Deportes', 10, 0, 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-030', 'Lazo para Saltar con Contador Digital', 25900, 18100, 19, 3, 'Lazo de salto profesional con contador de repeticiones, calibración de estatura y rodamientos de bolas.', 'Deportes', 35, 0, 'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-031', 'Bloques de Construcción 500 Piezas', 189900, 132900, 19, 19, 'Set de 500 bloques de construcción compatibles, con instrucciones y caja organizadora.', 'Juguetería', 15, 0, 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-032', 'Peluche Oso de Felpa Gigante 60 cm', 129900, 90900, 19, 13, 'Oso de peluche súper suave de 60 cm, relleno hipoalergénico y costuras reforzadas.', 'Juguetería', 12, 0, 'https://images.unsplash.com/photo-1584824486509-112e4181ff6b?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1584824486509-112e4181ff6b?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1584824486509-112e4181ff6b?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-033', 'Carro a Control Remoto 4x4 Recargable', 159900, 111900, 19, 16, 'Vehículo 4x4 a control remoto 2.4 GHz con batería recargable, suspensión y llantas de goma.', 'Juguetería', 14, 0, 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-034', 'Rompecabezas Mapa del Mundo 500 Piezas', 35900, 25100, 19, 4, 'Rompecabezas de 500 piezas con ilustración educativa del mapa político del mundo.', 'Juguetería', 25, 0, 'https://images.unsplash.com/photo-1545558014-8692077e9b5c?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1545558014-8692077e9b5c?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1545558014-8692077e9b5c?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-035', 'Set de Construcción Espacial 300 Piezas', 74900, 52400, 19, 7, 'Kit temático espacial con 300 piezas, figuras de astronauta y vehículos lunares.', 'Juguetería', 18, 500, 'https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-036', 'Pelota Didáctica con Sonido', 49900, 34900, 19, 5, 'Pelota sensorial con sonidos, texturas y colores vivos para estimulación temprana.', 'Juguetería', 20, 0, 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-037', 'Cuaderno Universitario 100 Hojas x3', 8900, 6200, 19, 1, 'Paquete de 3 cuadernos universitarios de 100 hojas, papel de 70 g y argollas resistentes.', 'Papelería', 40, 0, 'https://images.unsplash.com/photo-1568205612837-017257d2310a?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1568205612837-017257d2310a?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1568205612837-017257d2310a?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-038', 'Bolígrafos de Gel (Caja x12)', 29900, 20900, 19, 3, 'Caja con 12 bolígrafos de gel de tinta suave, secado rápido y trazo 0.7 mm.', 'Papelería', 35, 0, 'https://images.unsplash.com/photo-1587145820266-a5951ee6f620?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1587145820266-a5951ee6f620?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1587145820266-a5951ee6f620?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-039', 'Agenda 2026 Semanal con Elástico', 34900, 24400, 19, 3, 'Agenda semanal 2026 con cinta separadora, bolsillo interior, elástico y vista mensual.', 'Papelería', 30, 0, 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-040', 'Set de Marcadores Doble Punta 24 Colores', 39900, 27900, 19, 4, 'Set de 24 marcadores de doble punta (fina y pincel), base de agua y colores vibrantes.', 'Papelería', 28, 0, 'https://images.unsplash.com/photo-1517842645767-c639042777db?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1517842645767-c639042777db?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1517842645767-c639042777db?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-041', 'Calculadora Científica 417 Funciones', 89900, 62900, 19, 9, 'Calculadora científica con 417 funciones, pantalla de 2 líneas y alimentación solar.', 'Papelería', 15, 0, 'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-042', 'Kit de Papelería Crema Completo', 19900, 13900, 19, 2, 'Kit escolar con lápices, colores, tajalápiz, borrador, regla y cuaderno pequeño.', 'Papelería', 32, 0, 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-043', 'Camiseta de Algodón Premium Unisex', 59900, 41900, 19, 6, 'Camiseta de algodón peinado 180 g, corte clásico unisex y cuello reforzado. Colores disponibles.', 'Moda', 35, 0, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-044', 'Jean Clásico Azul de Tiro Alto', 129900, 90900, 19, 13, 'Jean de mezclilla con corte recto, tiro alto y bolsillos funcionales. Tallas 28 a 38.', 'Moda', 20, 900, 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-045', 'Chaqueta Impermeable con Capota', 189900, 132900, 19, 19, 'Chaqueta rompevientos impermeable y cortavientos, con capota ajustable y bolsillos con cierre.', 'Moda', 14, 0, 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-046', 'Tenis Urbanos Blancos Minimalistas', 159900, 111900, 19, 16, 'Tenis urbanos de cuero sintético con suela de goma antideslizante y plantilla acolchada.', 'Moda', 18, 0, 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-047', 'Hoodie Oversize con Felpa Interior', 139900, 97900, 19, 14, 'Buzo con capota de felpa perchada, corte oversize y bolsillo canguro. Unisex.', 'Moda', 22, 0, 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&q=80&auto=format&fit=crop&crop=top'),
  ('DEMO-048', 'Conjunto Deportivo Liviano unisex', 119900, 83900, 19, 12, 'Conjunto de camiseta y pantaloneta en tela deportiva transpirable con protección UV.', 'Moda', 20, 0, 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=800&q=80&auto=format&fit=crop', 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=800&q=80&auto=format&fit=crop&crop=entropy', 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=800&q=80&auto=format&fit=crop&crop=top')
) AS v(code, name, price, cost, tax, reward_points, details, category, quantity, points_cost, image, image2, image3);

-- 4) Reseñas demo (3 por producto + 1 extra en cada tercer producto). customer_id NULL:
--    el constraint UNIQUE (product_id, customer_id) permite múltiples NULL en Postgres.
INSERT INTO public.product_reviews (product_id, customer_id, rating, comment, created_at, updated_at)
SELECT p.id, NULL, r.rating, r.comment,
       now() - (r.age_days || ' days')::interval, now() - (r.age_days || ' days')::interval
FROM (VALUES
  ('DEMO-001', 1, 5, 'Excelente calidad, llegó muy rápido. Recomendado.'),
  ('DEMO-001', 12, 5, 'Muy buena relación precio-calidad. Volveré a comprar.'),
  ('DEMO-001', 23, 4, 'El producto cumple lo prometido.'),
  ('DEMO-001', 34, 4, 'Buena compra, aunque el empaque llegó algo golpeado.'),
  ('DEMO-002', 8, 4, 'Buena compra, aunque el empaque llegó algo golpeado.'),
  ('DEMO-002', 19, 5, 'Tal cual la descripción. Muy contento con la compra.'),
  ('DEMO-002', 30, 4, 'Buen producto, la entrega tardó un día más de lo esperado.'),
  ('DEMO-003', 15, 5, 'Me encantó, superó mis expectativas.'),
  ('DEMO-003', 26, 3, 'Cumple, pero esperaba un mejor acabado.'),
  ('DEMO-003', 37, 5, 'Perfecto para regalar, quedé muy bien.'),
  ('DEMO-004', 22, 4, 'Funciona bien y el precio es justo.'),
  ('DEMO-004', 33, 5, 'Muy recomendado, repetiré el pedido.'),
  ('DEMO-004', 44, 3, 'Regular, la foto no refleja del todo el producto.'),
  ('DEMO-004', 55, 4, 'Llegó completo y bien empacado.'),
  ('DEMO-005', 29, 4, 'Llegó completo y bien empacado.'),
  ('DEMO-005', 40, 5, 'La calidad es notable, se siente premium.'),
  ('DEMO-005', 51, 4, 'Buena opción por el precio.'),
  ('DEMO-006', 36, 5, 'Justo lo que necesitaba, gracias.'),
  ('DEMO-006', 47, 5, 'Excelente calidad, llegó muy rápido. Recomendado.'),
  ('DEMO-006', 58, 5, 'Muy buena relación precio-calidad. Volveré a comprar.'),
  ('DEMO-007', 43, 4, 'El producto cumple lo prometido.'),
  ('DEMO-007', 54, 4, 'Buena compra, aunque el empaque llegó algo golpeado.'),
  ('DEMO-007', 65, 5, 'Tal cual la descripción. Muy contento con la compra.'),
  ('DEMO-007', 76, 4, 'Buen producto, la entrega tardó un día más de lo esperado.'),
  ('DEMO-008', 50, 4, 'Buen producto, la entrega tardó un día más de lo esperado.'),
  ('DEMO-008', 61, 5, 'Me encantó, superó mis expectativas.'),
  ('DEMO-008', 72, 3, 'Cumple, pero esperaba un mejor acabado.'),
  ('DEMO-009', 57, 5, 'Perfecto para regalar, quedé muy bien.'),
  ('DEMO-009', 68, 4, 'Funciona bien y el precio es justo.'),
  ('DEMO-009', 79, 5, 'Muy recomendado, repetiré el pedido.'),
  ('DEMO-010', 64, 3, 'Regular, la foto no refleja del todo el producto.'),
  ('DEMO-010', 75, 4, 'Llegó completo y bien empacado.'),
  ('DEMO-010', 86, 5, 'La calidad es notable, se siente premium.'),
  ('DEMO-010', 97, 4, 'Buena opción por el precio.'),
  ('DEMO-011', 71, 4, 'Buena opción por el precio.'),
  ('DEMO-011', 82, 5, 'Justo lo que necesitaba, gracias.'),
  ('DEMO-011', 93, 5, 'Excelente calidad, llegó muy rápido. Recomendado.'),
  ('DEMO-012', 78, 5, 'Muy buena relación precio-calidad. Volveré a comprar.'),
  ('DEMO-012', 89, 4, 'El producto cumple lo prometido.'),
  ('DEMO-012', 100, 4, 'Buena compra, aunque el empaque llegó algo golpeado.'),
  ('DEMO-013', 85, 5, 'Tal cual la descripción. Muy contento con la compra.'),
  ('DEMO-013', 96, 4, 'Buen producto, la entrega tardó un día más de lo esperado.'),
  ('DEMO-013', 107, 5, 'Me encantó, superó mis expectativas.'),
  ('DEMO-013', 118, 3, 'Cumple, pero esperaba un mejor acabado.'),
  ('DEMO-014', 92, 3, 'Cumple, pero esperaba un mejor acabado.'),
  ('DEMO-014', 103, 5, 'Perfecto para regalar, quedé muy bien.'),
  ('DEMO-014', 114, 4, 'Funciona bien y el precio es justo.'),
  ('DEMO-015', 99, 5, 'Muy recomendado, repetiré el pedido.'),
  ('DEMO-015', 110, 3, 'Regular, la foto no refleja del todo el producto.'),
  ('DEMO-015', 121, 4, 'Llegó completo y bien empacado.'),
  ('DEMO-016', 106, 5, 'La calidad es notable, se siente premium.'),
  ('DEMO-016', 117, 4, 'Buena opción por el precio.'),
  ('DEMO-016', 128, 5, 'Justo lo que necesitaba, gracias.'),
  ('DEMO-016', 139, 5, 'Excelente calidad, llegó muy rápido. Recomendado.'),
  ('DEMO-017', 113, 5, 'Excelente calidad, llegó muy rápido. Recomendado.'),
  ('DEMO-017', 124, 5, 'Muy buena relación precio-calidad. Volveré a comprar.'),
  ('DEMO-017', 135, 4, 'El producto cumple lo prometido.'),
  ('DEMO-018', 120, 4, 'Buena compra, aunque el empaque llegó algo golpeado.'),
  ('DEMO-018', 131, 5, 'Tal cual la descripción. Muy contento con la compra.'),
  ('DEMO-018', 142, 4, 'Buen producto, la entrega tardó un día más de lo esperado.'),
  ('DEMO-019', 127, 5, 'Me encantó, superó mis expectativas.'),
  ('DEMO-019', 138, 3, 'Cumple, pero esperaba un mejor acabado.'),
  ('DEMO-019', 149, 5, 'Perfecto para regalar, quedé muy bien.'),
  ('DEMO-019', 160, 4, 'Funciona bien y el precio es justo.'),
  ('DEMO-020', 134, 4, 'Funciona bien y el precio es justo.'),
  ('DEMO-020', 145, 5, 'Muy recomendado, repetiré el pedido.'),
  ('DEMO-020', 156, 3, 'Regular, la foto no refleja del todo el producto.'),
  ('DEMO-021', 141, 4, 'Llegó completo y bien empacado.'),
  ('DEMO-021', 152, 5, 'La calidad es notable, se siente premium.'),
  ('DEMO-021', 163, 4, 'Buena opción por el precio.'),
  ('DEMO-022', 148, 5, 'Justo lo que necesitaba, gracias.'),
  ('DEMO-022', 159, 5, 'Excelente calidad, llegó muy rápido. Recomendado.'),
  ('DEMO-022', 170, 5, 'Muy buena relación precio-calidad. Volveré a comprar.'),
  ('DEMO-022', 1, 4, 'El producto cumple lo prometido.'),
  ('DEMO-023', 155, 4, 'El producto cumple lo prometido.'),
  ('DEMO-023', 166, 4, 'Buena compra, aunque el empaque llegó algo golpeado.'),
  ('DEMO-023', 177, 5, 'Tal cual la descripción. Muy contento con la compra.'),
  ('DEMO-024', 162, 4, 'Buen producto, la entrega tardó un día más de lo esperado.'),
  ('DEMO-024', 173, 5, 'Me encantó, superó mis expectativas.'),
  ('DEMO-024', 4, 3, 'Cumple, pero esperaba un mejor acabado.'),
  ('DEMO-025', 169, 5, 'Perfecto para regalar, quedé muy bien.'),
  ('DEMO-025', 180, 4, 'Funciona bien y el precio es justo.'),
  ('DEMO-025', 11, 5, 'Muy recomendado, repetiré el pedido.'),
  ('DEMO-025', 22, 3, 'Regular, la foto no refleja del todo el producto.'),
  ('DEMO-026', 176, 3, 'Regular, la foto no refleja del todo el producto.'),
  ('DEMO-026', 7, 4, 'Llegó completo y bien empacado.'),
  ('DEMO-026', 18, 5, 'La calidad es notable, se siente premium.'),
  ('DEMO-027', 3, 4, 'Buena opción por el precio.'),
  ('DEMO-027', 14, 5, 'Justo lo que necesitaba, gracias.'),
  ('DEMO-027', 25, 5, 'Excelente calidad, llegó muy rápido. Recomendado.'),
  ('DEMO-028', 10, 5, 'Muy buena relación precio-calidad. Volveré a comprar.'),
  ('DEMO-028', 21, 4, 'El producto cumple lo prometido.'),
  ('DEMO-028', 32, 4, 'Buena compra, aunque el empaque llegó algo golpeado.'),
  ('DEMO-028', 43, 5, 'Tal cual la descripción. Muy contento con la compra.'),
  ('DEMO-029', 17, 5, 'Tal cual la descripción. Muy contento con la compra.'),
  ('DEMO-029', 28, 4, 'Buen producto, la entrega tardó un día más de lo esperado.'),
  ('DEMO-029', 39, 5, 'Me encantó, superó mis expectativas.'),
  ('DEMO-030', 24, 3, 'Cumple, pero esperaba un mejor acabado.'),
  ('DEMO-030', 35, 5, 'Perfecto para regalar, quedé muy bien.'),
  ('DEMO-030', 46, 4, 'Funciona bien y el precio es justo.'),
  ('DEMO-031', 31, 5, 'Muy recomendado, repetiré el pedido.'),
  ('DEMO-031', 42, 3, 'Regular, la foto no refleja del todo el producto.'),
  ('DEMO-031', 53, 4, 'Llegó completo y bien empacado.'),
  ('DEMO-031', 64, 5, 'La calidad es notable, se siente premium.'),
  ('DEMO-032', 38, 5, 'La calidad es notable, se siente premium.'),
  ('DEMO-032', 49, 4, 'Buena opción por el precio.'),
  ('DEMO-032', 60, 5, 'Justo lo que necesitaba, gracias.'),
  ('DEMO-033', 45, 5, 'Excelente calidad, llegó muy rápido. Recomendado.'),
  ('DEMO-033', 56, 5, 'Muy buena relación precio-calidad. Volveré a comprar.'),
  ('DEMO-033', 67, 4, 'El producto cumple lo prometido.'),
  ('DEMO-034', 52, 4, 'Buena compra, aunque el empaque llegó algo golpeado.'),
  ('DEMO-034', 63, 5, 'Tal cual la descripción. Muy contento con la compra.'),
  ('DEMO-034', 74, 4, 'Buen producto, la entrega tardó un día más de lo esperado.'),
  ('DEMO-034', 85, 5, 'Me encantó, superó mis expectativas.'),
  ('DEMO-035', 59, 5, 'Me encantó, superó mis expectativas.'),
  ('DEMO-035', 70, 3, 'Cumple, pero esperaba un mejor acabado.'),
  ('DEMO-035', 81, 5, 'Perfecto para regalar, quedé muy bien.'),
  ('DEMO-036', 66, 4, 'Funciona bien y el precio es justo.'),
  ('DEMO-036', 77, 5, 'Muy recomendado, repetiré el pedido.'),
  ('DEMO-036', 88, 3, 'Regular, la foto no refleja del todo el producto.'),
  ('DEMO-037', 73, 4, 'Llegó completo y bien empacado.'),
  ('DEMO-037', 84, 5, 'La calidad es notable, se siente premium.'),
  ('DEMO-037', 95, 4, 'Buena opción por el precio.'),
  ('DEMO-037', 106, 5, 'Justo lo que necesitaba, gracias.'),
  ('DEMO-038', 80, 5, 'Justo lo que necesitaba, gracias.'),
  ('DEMO-038', 91, 5, 'Excelente calidad, llegó muy rápido. Recomendado.'),
  ('DEMO-038', 102, 5, 'Muy buena relación precio-calidad. Volveré a comprar.'),
  ('DEMO-039', 87, 4, 'El producto cumple lo prometido.'),
  ('DEMO-039', 98, 4, 'Buena compra, aunque el empaque llegó algo golpeado.'),
  ('DEMO-039', 109, 5, 'Tal cual la descripción. Muy contento con la compra.'),
  ('DEMO-040', 94, 4, 'Buen producto, la entrega tardó un día más de lo esperado.'),
  ('DEMO-040', 105, 5, 'Me encantó, superó mis expectativas.'),
  ('DEMO-040', 116, 3, 'Cumple, pero esperaba un mejor acabado.'),
  ('DEMO-040', 127, 5, 'Perfecto para regalar, quedé muy bien.'),
  ('DEMO-041', 101, 5, 'Perfecto para regalar, quedé muy bien.'),
  ('DEMO-041', 112, 4, 'Funciona bien y el precio es justo.'),
  ('DEMO-041', 123, 5, 'Muy recomendado, repetiré el pedido.'),
  ('DEMO-042', 108, 3, 'Regular, la foto no refleja del todo el producto.'),
  ('DEMO-042', 119, 4, 'Llegó completo y bien empacado.'),
  ('DEMO-042', 130, 5, 'La calidad es notable, se siente premium.'),
  ('DEMO-043', 115, 4, 'Buena opción por el precio.'),
  ('DEMO-043', 126, 5, 'Justo lo que necesitaba, gracias.'),
  ('DEMO-043', 137, 5, 'Excelente calidad, llegó muy rápido. Recomendado.'),
  ('DEMO-043', 148, 5, 'Muy buena relación precio-calidad. Volveré a comprar.'),
  ('DEMO-044', 122, 5, 'Muy buena relación precio-calidad. Volveré a comprar.'),
  ('DEMO-044', 133, 4, 'El producto cumple lo prometido.'),
  ('DEMO-044', 144, 4, 'Buena compra, aunque el empaque llegó algo golpeado.'),
  ('DEMO-045', 129, 5, 'Tal cual la descripción. Muy contento con la compra.'),
  ('DEMO-045', 140, 4, 'Buen producto, la entrega tardó un día más de lo esperado.'),
  ('DEMO-045', 151, 5, 'Me encantó, superó mis expectativas.'),
  ('DEMO-046', 136, 3, 'Cumple, pero esperaba un mejor acabado.'),
  ('DEMO-046', 147, 5, 'Perfecto para regalar, quedé muy bien.'),
  ('DEMO-046', 158, 4, 'Funciona bien y el precio es justo.'),
  ('DEMO-046', 169, 5, 'Muy recomendado, repetiré el pedido.'),
  ('DEMO-047', 143, 5, 'Muy recomendado, repetiré el pedido.'),
  ('DEMO-047', 154, 3, 'Regular, la foto no refleja del todo el producto.'),
  ('DEMO-047', 165, 4, 'Llegó completo y bien empacado.'),
  ('DEMO-048', 150, 5, 'La calidad es notable, se siente premium.'),
  ('DEMO-048', 161, 4, 'Buena opción por el precio.'),
  ('DEMO-048', 172, 5, 'Justo lo que necesitaba, gracias.')
) AS r(code, age_days, rating, comment)
JOIN public.tec_products p ON p.tenant_id = (SELECT id FROM _demo_tenant) AND p.code = r.code;

-- 5) Opt-in del marketplace para el tenant (markup 10%)
INSERT INTO public.tec_marketplace_settings (tenant_id, enabled, markup_percent, store_display_name)
VALUES ((SELECT id FROM _demo_tenant), true, 10.00, 'Prueba POS')
ON CONFLICT (tenant_id) DO UPDATE
  SET enabled = true, markup_percent = 10.00, store_display_name = 'Prueba POS', updated_at = NOW();

COMMIT;

-- ============================ VERIFICACIÓN ============================
SELECT c.name AS categoria, COUNT(p.id) AS productos_demo
FROM public.tec_categories c
LEFT JOIN public.tec_products p ON p.category_id = c.id AND p.tenant_id = c.tenant_id AND p.code LIKE 'DEMO-%'
WHERE c.tenant_id = '33a557f2-3df7-4857-bbe4-dd94317a22b7'::uuid
GROUP BY c.name
ORDER BY c.name;

SELECT COUNT(*) AS productos_demo FROM public.tec_products
WHERE tenant_id = '33a557f2-3df7-4857-bbe4-dd94317a22b7'::uuid AND code LIKE 'DEMO-%';

SELECT COUNT(*) AS resenas_demo FROM public.product_reviews r
JOIN public.tec_products p ON p.id = r.product_id
WHERE p.code LIKE 'DEMO-%' AND p.tenant_id = '33a557f2-3df7-4857-bbe4-dd94317a22b7'::uuid;

SELECT enabled, markup_percent, store_display_name FROM public.tec_marketplace_settings
WHERE tenant_id = '33a557f2-3df7-4857-bbe4-dd94317a22b7'::uuid;

-- ============================ REVERSIÓN (opcional) ============================
-- BEGIN;
--   DELETE FROM public.tec_products
--   WHERE tenant_id = '33a557f2-3df7-4857-bbe4-dd94317a22b7'::uuid
--     AND code LIKE 'DEMO-%';
--   UPDATE public.tec_marketplace_settings SET enabled = false
--   WHERE tenant_id = '33a557f2-3df7-4857-bbe4-dd94317a22b7'::uuid;
-- COMMIT;
