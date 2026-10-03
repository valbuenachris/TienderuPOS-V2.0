# POS v2

Nuevo POS con NestJS/TypeScript y React/TypeScript, separado del PHP legacy. No contiene migraciones ni DDL.

## Reglas de datos

- Empleados: `public.tec_users`; clientes: `public.tec_customers`.
- En `tec_sales`, `created_by` identifica al empleado, `customer_id` al cliente y `user_id` queda nulo/no se usa.
- El grupo se obtiene de `tec_groups` con el mismo `tenant_id`; los administradores pueden elegir tienda y los cajeros operan solo en su `store_id` asignado.
- `tec_settings` es global porque no tiene `tenant_id`; se lee sin exponer credenciales SMTP.
- `tec_settings.default_customer` solo se aplica cuando ese cliente global configurado existe y es seleccionable dentro del tenant/tienda actual.
- Todas las consultas de negocio filtran `tenant_id`; los padres de relaciones también se validan dentro del tenant porque las FKs referencian IDs globales.
- `api/src/database/database.types.ts` contiene las proyecciones TypeScript de las columnas confirmadas para V1; se deben verificar contra el esquema vivo exacto antes del despliegue.
- IDs: usar defaults identity/secuencias y `RETURNING id`; nunca asignar `MAX(id)+1` por tenant.
- `PASSWORD_REHASH_ENABLED=false` por defecto: el POS anterior valida sha1 y comparte `tec_users`; rehashear a bcrypt le rompería el login. Activar solo después del cutover.
- V1 reconoce el grupo `tec_groups.name = 'admin'` para selección de tiendas. Los demás usuarios quedan limitados a `tec_users.store_id`; todavía no se aplica `tec_user_store_access`.
- La app se conecta a PostgreSQL solo desde el backend. No exponer `DATABASE_URL` ni usar Supabase JS en el navegador.
- `tec_product_store_qty.quantity` es INTEGER y `price` es REAL; V1 limita el stock por tienda a unidades enteras y calcula dinero con aritmética decimal.

## Build y publicación en Docker Hub

El proyecto genera **dos imágenes**: `pos-gres-v2-api` y `pos-gres-v2-web`. `docker-compose.build.yml` solo construye/publica imágenes; no inicia contenedores ni requiere credenciales de base de datos. El build de API ejecuta `npm run build` y `npm test`; el de web ejecuta TypeScript y Vite.

Crear antes los repositorios `pos-gres-v2-api` y `pos-gres-v2-web` en el namespace de Docker Hub seleccionado. Desde este directorio, en el host que hará el build:

```sh
docker login
docker compose -f docker-compose.build.yml build --pull
docker compose -f docker-compose.build.yml push
```

Por defecto se usan `cvalbuena/pos-gres-v2-api:v0.1.0` y `cvalbuena/pos-gres-v2-web:v0.1.0`, en línea con el namespace donde se publicaron. Para cambiar namespace o versión, exportar `DOCKERHUB_NAMESPACE` e `IMAGE_TAG` antes de esos comandos. Si el namespace es privado, hacer `docker login` también en el host de despliegue.

## Despliegue desde imágenes

En el host de base de datos/proxy, copiar `docker-compose.yml` y `.env.example` como `.env`, completar los valores reales y ejecutar:

```sh
docker compose pull
docker compose up -d
docker compose ps
```

El Compose de despliegue no compila imágenes: solo descarga las etiquetas seleccionadas en `.env` y las ejecuta. Si build y despliegue se hacen en el mismo host, se pueden levantar las imágenes locales después del build con `docker compose up -d`, sin publicarlas en Docker Hub.

Antes de desplegar, confirmar que existan las redes externas `npm_net` y `supabase_default` (o ajustar `NPM_NETWORK_NAME` y `SUPABASE_NETWORK_NAME`). Si `npm_net` no existe en el host, crearla: `docker network create npm_net`. La API se conecta a ambas: `npm_net` para la web y `supabase_default` para resolver `supabase-db`. La web solo se conecta a `npm_net`.

Si Nginx Proxy Manager corre en el mismo host, apuntar a `pos-gres-v2-web:80` en `npm_net`. Si corre en otro host (las redes Docker no cruzan hosts), publicar la web con `WEB_BIND_IP=0.0.0.0` —restringido por firewall a la IP del proxy— y apuntar NPM a `http://<IP_DEL_HOST_DE_DESPLIEGUE>:${WEB_PORT}`. Con `WEB_BIND_IP=127.0.0.1` el puerto queda solo para pruebas locales.

Configurar en `.env` `DATABASE_URL`, `DATABASE_SSL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `DEFAULT_TENANT_ID`, redes e imagen/tag. El hostname de `DATABASE_URL` debe resolverse desde `SUPABASE_NETWORK_NAME`; `SUPABASE_URL` debe ser alcanzable desde el contenedor API. Las credenciales de base de datos y service role son solo para el proceso API; nunca pasan al bundle React. No usar los placeholders de `.env.example` en un despliegue real.

El build no modifica el esquema. La aplicación sí ejecuta DML al autenticar y crear ventas. Validar primero login, tenant, tienda, cliente e inventario en staging o con datos de prueba; la venta de prueba registra datos y descuenta stock. Verificar el esquema vivo exacto antes de producción: `api/src/database/database.types.ts` contiene proyecciones de las columnas confirmadas para V1, no un dump completo generado.

La primera pantalla permite login, catálogo, clientes, selección de tienda y registro de venta con líneas/pago. Antes de registrar la venta se abre un modal de confirmación con el detalle (cliente, artículos, subtotal, impuestos, total) y, para efectivo, el monto recibido, botones rápidos y el cambio a devolver; el estado se calcula en el servidor (`paid`, `partial` o `due`) según el monto aplicado. Los métodos de pago usan valores compatibles con el POS legado (`cash`, `CC`, `Transferencia`, `Sistecredito`, `ADI`) más `credito` para el crédito propio de la tienda; todos se registran como pago completo (`paid_by` + `paid = grand_total`). `Cuenta pendiente` no registra pago y deja la venta con `status = due`. En el POS, la opción de crédito se muestra como "Crédito [tienda]" según la tienda seleccionada, pero se guarda con el valor estable `credito`. El esquema no tiene columnas de monto recibido/cambio: `tec_sales.paid` y `tec_payments.amount` guardan el monto aplicado (nunca por encima del total) y el cambio se calcula y se devuelve en la respuesta y el ticket, sin persistirse. El impuesto de `tec_products.tax` se interpreta como porcentaje exclusivo: `total` es subtotal antes de impuesto y `grand_total` lo incluye. El DDL de ventas no tiene columnas de descuento/desglose tributario. Los productos combo se rechazan en V1; las devoluciones, compras, cierre de caja e impresión quedan para fases posteriores.

El grupo `admin` puede seleccionar tiendas del tenant; los demás usuarios necesitan `tec_users.store_id` asignado. La primera versión no interpreta `tec_user_store_access`. El inventario por tienda admite unidades enteras porque `tec_product_store_qty.quantity` es `INTEGER`; productos fraccionarios no se pueden cerrar en tienda hasta definir una regla compatible con ese campo. La app revalida precios, tenant y stock en el servidor dentro de una transacción. `total` guarda el subtotal antes del impuesto y `grand_total` incluye el porcentaje exclusivo de `tec_products.tax`.

Las políticas y grants de Supabase no se modifican; RLS no reemplaza los filtros tenant del backend.

## Interfaz y navegación

El frontend usa React Router con un shell de 13 secciones. Los cajeros (`staff`) ven Punto de venta, Dashboard, Ventas y Cierre de caja; el grupo `admin` ve además Productos, Inventario, Clientes, Proveedores, Compras, Reportes, Gastos, Usuarios y Configuración.

Módulos operativos: POS con impresión de ticket de 58 mm, Dashboard, historial de ventas (ver, editar y eliminar ventas), productos (crear/editar/ajustar stock), inventario (lectura), clientes (crear/editar), proveedores (crear/editar), compras (modal crear/editar con actualización de stock y costo; cantidades enteras), cierre de caja (apertura, resumen por forma de pago y cierre con arqueo), gastos (crear/editar), reportes (resumen con gráficas y ganancia neta, ventas diarias por calendario, ventas mensuales por calendario, productos más vendidos), usuarios (gestión completa) y configuración (lectura).

El selector de cliente del POS es un combobox con búsqueda en servidor (`GET /api/catalog/customers?q=`), que coincide por nombre, correo o teléfono dentro del tenant/tienda. La búsqueda espera 300 ms desde la última tecla, muestra hasta 10 resultados y permite navegar con flechas/Enter/Escape; por defecto la venta se registra como "Cliente ocasional" (sin `customer_id`).

El ticket se renderiza con `web/src/components/SaleTicket.tsx`: cabecera con logo textual (`site_name`), tienda, número de ticket, fecha, cajero y cliente; ítems con código/cantidad/precio; totales jerarquizados; forma de pago, recibido y cambio; y pie con QR, política de cambios y texto legal. El QR se genera en el navegador con la librería `qrcode` (contenido JSON con ticket, ítems y totales; formato compacto si hay más de 8 ítems) y no requiere endpoint: el navegador nunca envía datos de la venta a un servicio externo. La impresión usa `@page size: 58mm auto` y el contenedor `.print-receipt`; en pantalla hay vista previa en modal.

Esquema verificado de compras: `tec_purchases` guarda la referencia en `reference_no` (no existe `reference`) y no tiene `store_id` ni `received`; `tec_purchase_items` no tiene `sale_price` ni `profit_margin`. La compra siempre suma stock al crearse en `tec_product_store_qty.store_id` (el `store_id` solo vive en esa tabla y en el cuerpo de la petición, no en la cabecera), y el "Precio venta" opcional actualiza `tec_products.price`. No se aplica DDL.

La página de compras usa una tabla a ancho completo y un modal para crear/editar (`POST /api/purchases`, `PUT /api/purchases/:id`). La edición replica el alta dentro de una transacción: revierte el stock de las líneas anteriores, aplica las nuevas, actualiza `reference_no/date/note/total/supplier_id` y conserva `created_by`. Como la cabecera no guarda tienda, el stock se ajusta en el `store_id` enviado desde el modal: al editar debe elegirse la misma tienda con la que se registró la compra.

Endpoints de gestión (solo admin): `GET/POST /api/products`, `PUT /api/products/:id`, `PUT /api/products/:id/stock`, `POST /api/products/:id/images/:slot`, `DELETE /api/products/:id/images/:slot`, `GET/POST/PUT /api/customers`, `GET/POST/PUT /api/expenses`, `GET/POST/PUT /api/suppliers`, `GET /api/purchases?from&to`, `GET /api/purchases/:id`, `POST /api/purchases`, `GET /api/reports/summary`, `GET /api/reports/calendar?from&to&group=day|month`, `GET /api/reports/top-products`, `GET/POST /api/users`, `PUT /api/users/:id`, `PATCH /api/users/:id/active`, `DELETE /api/users/:id` (baja lógica). Caja (admin y staff): `GET /api/registers`, `GET /api/registers/current`, `GET /api/registers/summary`, `POST /api/registers/open`, `POST /api/registers/:id/close`.

La gestión de usuarios crea/edita cuentas en `tec_users`, asigna el grupo `tec_groups` según el rol (admin/staff), exige tienda a los cajeros y desactiva (no borra) usuarios. El hash de contraseñas nuevas depende de `USER_PASSWORD_METHOD`: por defecto `sha1` para que el POS anterior siga pudiendo iniciar sesión; cambiar a `bcrypt` solo después del cutover. Nunca se exponen hashes al cliente. No se puede desactivar la propia cuenta ni el último administrador activo del tenant.

Los listados de gestión (`/api/products`, `/api/customers`, `/api/suppliers`, `/api/users`, `/api/sales`, `/api/purchases`, `/api/expenses`) aceptan `?page&limit` (máx. 100) y devuelven `{ data, meta: { total, page, limit, totalPages } }` usando `COUNT(*) OVER()` + `LIMIT/OFFSET` sobre el esquema existente. Un `OFFSET` alto puede degradar el rendimiento; la evolución prevista es keyset pagination sin cambios de esquema. **Cambio incompatible:** API y web deben desplegarse juntos.

El historial de ventas tiene acciones por fila: ver (`GET /api/sales/:id`, devuelve cabecera, artículos y pagos; el `staff` solo puede ver sus propias ventas), editar (`PUT /api/sales/:id`) y eliminar (`DELETE /api/sales/:id`). Editar y eliminar son **solo admin** y replican el POS legado dentro de una transacción: se devuelve el stock anterior a `tec_product_store_qty`, se recalculan totales/estado con el `paid` existente y se reemplazan las líneas (editar) o se borran `tec_sale_items`, `tec_payments` y `tec_sales` (eliminar). Editar solo ajusta cantidades (conserva el precio unitario histórico y exige enteros); si el pago registrado supera el nuevo total se rechaza. Las ventas con combos o artículos personalizados (`product_id` nulo) no se pueden editar ni eliminar desde V2.

El reporte de calendario (`GET /api/reports/calendar`, solo admin) agrupa por `group=day|month` y devuelve `{ from, to, group, points[], totals }` con ventas, compras, gastos, pendiente por cobrar y ganancia neta por bucket; los días/meses sin movimientos llegan en cero. La web lo usa en `/reportes/ventas-diarias` (calendario mensual con detalle de ventas por día) y `/reportes/ventas-mensuales` (grilla anual con desglose diario del mes). El resumen diario de ventas (`GET /api/reports/summary`) también expone `purchases_total`, `expenses_total` y `net_profit`, por lo que API y web deben desplegarse juntas.

Las imágenes de producto (`tec_products.image`, `image_2`, `image_3`) pueden guardar una URL completa (Supabase Storage) o un nombre de archivo legacy. La API respeta la URL completa tal cual; para nombres legacy arma `/uploads/thumbs/<archivo>` con fallback a `/uploads/<archivo>` y un placeholder si no existen. El Compose de despliegue monta `LEGACY_UPLOADS_PATH` (por defecto `/srv/pos-media/uploads`; ajustar en `.env` si los archivos legacy viven en otra ruta) como solo lectura en el contenedor web; ese montaje solo aplica si usas nombres legacy.

En la edición de producto hay una galería de 3 ranuras: subir, cambiar o eliminar imágenes (JPG/PNG/WEBP, máximo 2 MB). La API sube al bucket `SUPABASE_PRODUCT_BUCKET` (default `productos`) con la service role y guarda la URL pública construida con `SUPABASE_PUBLIC_URL`; si esa variable falta o apunta a un host interno (por ejemplo `supabase-kong`), la subida se rechaza con un error claro para no guardar URLs inalcanzables. Al leer catálogo y productos, cualquier URL guardada con el host interno de `SUPABASE_URL` se reescribe a `SUPABASE_PUBLIC_URL`. El navegador nunca habla directo con Supabase.

## Configuración editable (solo admin)

La página `/config` es editable y usa `PUT /api/settings` (solo admin). La API **no asume columnas**: consulta `information_schema.columns` de `public.tec_settings` (caché de 30 s) y solo lee/escribe la intersección con su lista blanca (`site_name`, `currency_prefix`, `default_customer`, `address`, `phone`, `email`, `nit`, `timezone`, `language`, `default_tax`, `decimal_digits`, `thank_you_message`, `return_policy`, `show_qr_on_ticket`, `printer_width`, `logo_url`). Los campos sin columna aparecen deshabilitados y la respuesta incluye `supported`. Los campos SMTP nunca se exponen ni se editan. El logo se elige con vista previa inmediata y se sube junto con "Guardar cambios" (`POST /api/settings/logo`, máx. 2 MB, PNG/JPG/WEBP/SVG) al bucket de productos bajo el prefijo `logos/`; "Eliminar" lo borra del storage y pone `logo_url = NULL`. Nginx permite hasta 5 MB en `/api/`.

`tec_settings` es **global** (no tiene `tenant_id`): hoy la edición afecta a todos los tenants y usa la primera fila (`setting_id = 1`). Para habilitar los campos que falten, ejecutar una sola vez (DDL manual aprobada):

```sql
ALTER TABLE public.tec_settings
  ADD COLUMN IF NOT EXISTS address varchar(255),
  ADD COLUMN IF NOT EXISTS phone varchar(30),
  ADD COLUMN IF NOT EXISTS email varchar(100),
  ADD COLUMN IF NOT EXISTS nit varchar(30),
  ADD COLUMN IF NOT EXISTS timezone varchar(64),
  ADD COLUMN IF NOT EXISTS language varchar(8),
  ADD COLUMN IF NOT EXISTS default_tax numeric(6,2),
  ADD COLUMN IF NOT EXISTS decimal_digits smallint DEFAULT 2,
  ADD COLUMN IF NOT EXISTS thank_you_message varchar(255),
  ADD COLUMN IF NOT EXISTS return_policy text,
  ADD COLUMN IF NOT EXISTS show_qr_on_ticket boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS printer_width varchar(8) DEFAULT '58mm',
  ADD COLUMN IF NOT EXISTS logo_url varchar(500);
```

Para que la configuración sea **por tenant** (opcional; el código detecta `tenant_id` automáticamente y usa la fila del tenant si existe):

```sql
ALTER TABLE public.tec_settings ADD COLUMN IF NOT EXISTS tenant_id uuid;
UPDATE public.tec_settings SET tenant_id = '<UUID_DEL_TENANT_ORIGINAL>' WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tec_settings_tenant_uq
  ON public.tec_settings (tenant_id) WHERE tenant_id IS NOT NULL;
-- Duplicar la fila base para cada tenant adicional:
-- INSERT INTO public.tec_settings (site_name, currency_prefix, default_customer, tenant_id)
-- SELECT site_name, currency_prefix, default_customer, '<UUID_TENANT_NUEVO>'
-- FROM public.tec_settings WHERE tenant_id = '<UUID_DEL_TENANT_ORIGINAL>';
```

Notas del ticket: `show_qr_on_ticket`, `thank_you_message`, `return_policy` y `printer_width` se aplican en `SaleTicket`; con `80mm` se inyecta `@page { size: 80mm auto }`. `address`, `phone` y `nit` se imprimen en la cabecera si existen.
