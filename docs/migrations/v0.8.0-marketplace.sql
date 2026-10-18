-- POS v2 · v0.8.0 · Marketplace Tienderu.com (DDL aprobado)
-- Catálogo multi-tenant, clientes globales de la tienda, pedidos de plataforma,
-- sub-órdenes por vendedor y comisión del 10%.
-- Ejecutar UNA VEZ antes de desplegar v0.8.0. No borra datos.

BEGIN;

-- 1) Opt-in por tenant del marketplace (markup default 10%).
CREATE TABLE IF NOT EXISTS public.tec_marketplace_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tec_tenants(id),
  enabled boolean NOT NULL DEFAULT false,
  markup_percent numeric(5,2) NOT NULL DEFAULT 10.00,
  store_display_name varchar(120),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2) Clientes globales de tienderu.com (independientes de tec_customers por tenant).
CREATE TABLE IF NOT EXISTS public.tec_marketplace_customers (
  id bigserial PRIMARY KEY,
  name varchar(120) NOT NULL,
  email varchar(150) NOT NULL,
  phone varchar(30),
  password varchar(255) NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tec_marketplace_customers_email
  ON public.tec_marketplace_customers (LOWER(email));

-- 3) Direcciones de envío del cliente de la tienda.
CREATE TABLE IF NOT EXISTS public.tec_marketplace_addresses (
  id bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES public.tec_marketplace_customers(id) ON DELETE CASCADE,
  recipient_name varchar(120) NOT NULL,
  label varchar(20) NOT NULL DEFAULT 'Casa',
  street_address varchar(200) NOT NULL,
  neighborhood varchar(120),
  city varchar(80) NOT NULL DEFAULT 'Bogotá',
  phone varchar(30) NOT NULL,
  additional_notes varchar(300),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tec_marketplace_addresses_customer
  ON public.tec_marketplace_addresses (customer_id, is_default DESC, created_at ASC);

-- 4) Pedido de plataforma (un checkout = un pedido; se paga UNA vez).
CREATE TABLE IF NOT EXISTS public.tec_marketplace_orders (
  id bigserial PRIMARY KEY,
  order_number varchar(30) NOT NULL UNIQUE,
  customer_id bigint NOT NULL REFERENCES public.tec_marketplace_customers(id),
  customer_name varchar(120) NOT NULL,
  customer_email varchar(150),
  customer_phone varchar(30),
  shipping_recipient varchar(120) NOT NULL,
  shipping_phone varchar(30) NOT NULL,
  shipping_address varchar(200) NOT NULL,
  shipping_neighborhood varchar(120),
  shipping_city varchar(80) NOT NULL,
  shipping_notes varchar(300),
  products_total numeric(12,2) NOT NULL DEFAULT 0,
  shipping_total numeric(12,2) NOT NULL DEFAULT 0,
  grand_total numeric(12,2) NOT NULL DEFAULT 0,
  commission_total numeric(12,2) NOT NULL DEFAULT 0,
  tenant_total numeric(12,2) NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'pending_payment',
  payment_method varchar(20) NOT NULL DEFAULT 'bold',
  payment_status varchar(20) NOT NULL DEFAULT 'pending',
  bold_payment_id varchar(100),
  checkout_url text,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tec_marketplace_orders_customer
  ON public.tec_marketplace_orders (customer_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_tec_marketplace_orders_status
  ON public.tec_marketplace_orders (status, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tec_marketplace_orders_bold_payment
  ON public.tec_marketplace_orders (bold_payment_id)
  WHERE bold_payment_id IS NOT NULL;

-- 5) Sub-orden por vendedor (tenant): cada vendedor despacha su parte.
CREATE TABLE IF NOT EXISTS public.tec_marketplace_suborders (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES public.tec_marketplace_orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tec_tenants(id),
  sale_id integer,
  suborder_number varchar(30) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  products_total numeric(12,2) NOT NULL DEFAULT 0,
  shipping_total numeric(12,2) NOT NULL DEFAULT 0,
  tenant_total numeric(12,2) NOT NULL DEFAULT 0,
  commission numeric(12,2) NOT NULL DEFAULT 0,
  tracking_note varchar(300),
  shipped_at timestamptz,
  delivered_at timestamptz,
  payout_status varchar(20) NOT NULL DEFAULT 'pending',
  paid_out_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tec_marketplace_suborders_order
  ON public.tec_marketplace_suborders (order_id);
CREATE INDEX IF NOT EXISTS ix_tec_marketplace_suborders_tenant
  ON public.tec_marketplace_suborders (tenant_id, status, id DESC);
CREATE INDEX IF NOT EXISTS ix_tec_marketplace_suborders_payout
  ON public.tec_marketplace_suborders (tenant_id, payout_status);

-- 6) Líneas del pedido con snapshot y desglose de comisión.
CREATE TABLE IF NOT EXISTS public.tec_marketplace_order_items (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES public.tec_marketplace_orders(id) ON DELETE CASCADE,
  suborder_id bigint NOT NULL REFERENCES public.tec_marketplace_suborders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  product_id integer NOT NULL,
  product_code varchar(60),
  product_name varchar(255) NOT NULL,
  product_image text,
  quantity integer NOT NULL,
  base_unit_price numeric(12,2) NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  commission_unit numeric(12,2) NOT NULL,
  line_base numeric(12,2) NOT NULL,
  line_tax numeric(12,2) NOT NULL,
  line_subtotal numeric(12,2) NOT NULL,
  line_total numeric(12,2) NOT NULL,
  commission_total numeric(12,2) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_tec_marketplace_order_items_suborder
  ON public.tec_marketplace_order_items (suborder_id);
CREATE INDEX IF NOT EXISTS ix_tec_marketplace_order_items_product
  ON public.tec_marketplace_order_items (product_id);

COMMIT;

-- Verificación
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'tec_marketplace_%'
ORDER BY table_name;
