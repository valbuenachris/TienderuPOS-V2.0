-- POS v2 · v0.11.4 · Reseñas del marketplace y cupones (DDL aprobado)
-- Reseñas escritas por compradores de tienderu.com (verificadas por compra) y
-- cupones de descuento a nivel plataforma.
-- Ejecutar UNA VEZ antes de desplegar v0.11.4. No borra datos.

BEGIN;

-- 1) Reseñas de compradores del marketplace (independientes de product_reviews).
CREATE TABLE IF NOT EXISTS public.tec_marketplace_reviews (
  id bigserial PRIMARY KEY,
  product_id integer NOT NULL REFERENCES public.tec_products(id) ON DELETE CASCADE,
  customer_id bigint NOT NULL REFERENCES public.tec_marketplace_customers(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT uq_tec_marketplace_reviews_product_customer UNIQUE (product_id, customer_id)
);

CREATE INDEX IF NOT EXISTS ix_tec_marketplace_reviews_product
  ON public.tec_marketplace_reviews (product_id, id DESC);

-- 2) Cupones de plataforma (el descuento lo absorbe la comisión de Tienderu;
--    el vendedor recibe siempre el valor completo de su venta).
CREATE TABLE IF NOT EXISTS public.tec_marketplace_coupons (
  id bigserial PRIMARY KEY,
  code varchar(40) NOT NULL,
  discount_type varchar(10) NOT NULL DEFAULT 'percent',
  discount_value numeric(12,2) NOT NULL,
  min_total numeric(12,2) NOT NULL DEFAULT 0,
  max_uses integer,
  uses integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT ck_tec_marketplace_coupons_type CHECK (discount_type IN ('percent', 'fixed')),
  CONSTRAINT ck_tec_marketplace_coupons_value CHECK (discount_value > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tec_marketplace_coupons_code
  ON public.tec_marketplace_coupons (UPPER(code));

-- 3) Descuento/cupón persistido en el pedido.
ALTER TABLE public.tec_marketplace_orders
  ADD COLUMN IF NOT EXISTS discount_total numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.tec_marketplace_orders
  ADD COLUMN IF NOT EXISTS coupon_code varchar(40);

-- 4) Vista unificada de reseñas (app de clientes + marketplace) para el catálogo público.
CREATE OR REPLACE VIEW public.v_marketplace_reviews AS
  SELECT pr.id, 'app'::text AS source, pr.product_id, pr.rating, pr.comment, pr.created_at, c.name AS customer_name_raw
  FROM public.product_reviews pr
  LEFT JOIN public.tec_customers c ON c.id = pr.customer_id
  UNION ALL
  SELECT mr.id, 'marketplace'::text AS source, mr.product_id, mr.rating, mr.comment, mr.created_at, mc.name AS customer_name_raw
  FROM public.tec_marketplace_reviews mr
  JOIN public.tec_marketplace_customers mc ON mc.id = mr.customer_id;

COMMIT;

-- Verificación
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('tec_marketplace_reviews', 'tec_marketplace_coupons')
ORDER BY table_name;

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tec_marketplace_orders'
  AND column_name IN ('discount_total', 'coupon_code');

SELECT table_name FROM information_schema.views
WHERE table_schema = 'public' AND table_name = 'v_marketplace_reviews';

-- Reversión (opcional):
-- BEGIN;
--   DROP VIEW IF EXISTS public.v_marketplace_reviews;
--   ALTER TABLE public.tec_marketplace_orders DROP COLUMN IF EXISTS coupon_code;
--   ALTER TABLE public.tec_marketplace_orders DROP COLUMN IF EXISTS discount_total;
--   DROP TABLE IF EXISTS public.tec_marketplace_coupons;
--   DROP TABLE IF EXISTS public.tec_marketplace_reviews;
-- COMMIT;