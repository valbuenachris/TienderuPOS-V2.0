# POS v2

Nuevo POS con NestJS/TypeScript y React/TypeScript, separado del PHP legacy. No genera migraciones automáticas ni DDL en runtime: los scripts DDL aprobados viven en `docs/migrations/` y los ejecuta el operador una sola vez.

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
- `tec_products.quantity` (INTEGER, default 0) es la **única fuente de verdad del stock** desde v0.3.58 y es global por tenant. `tec_product_store_qty` es legado: **no se dropea** (el POS PHP puede usarla) pero la API la ignora por completo y **no hay triggers de sincronización**. V1 usa unidades enteras y dinero con aritmética decimal.

La zona horaria de negocio es **por tenant**: `TenantTimezoneService` lee `tec_tenant_settings.timezone` (caché 60 s) y cae a `POS_TIMEZONE` (por defecto `America/Bogota`). Define el "hoy" y los límites de día de cierre de caja, resumen diario de ventas, historial de ventas y **todos** los reportes/calendario/productos más vendidos: el backend agrupa con `AT TIME ZONE $tz` (nunca UTC) y, si no se envía `from/to`, calcula el rango por defecto en la zona del tenant; compras/gastos usan su columna `DATE` pura. El frontend fija la zona desde `settings.timezone` y calcula fechas con `todayInBusinessTimezone()`/`daysAgoInBusinessTimezone()` (nunca `toISOString` ni `getFullYear/getMonth` locales).

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

La primera pantalla permite login, catálogo, clientes, selección de tienda y registro de venta con líneas/pago. Antes de registrar la venta se abre un modal de confirmación con el detalle (cliente, artículos, subtotal, impuestos, total) y, para efectivo, el monto recibido, botones rápidos y el cambio a devolver; el estado se calcula en el servidor (`paid`, `partial` o `due`) según el monto aplicado. El modal permite **descuento manual** (monto fijo o porcentaje): el porcentaje se aplica sobre `subtotal + impuestos` (como el legacy), el monto fijo no puede superar el total y ambos deben ser ≥ 0 (porcentaje ≤ 100). Se guarda en `tec_sales.order_discount` (monto), `order_discount_id` (`"10%"` o el monto) y `total_discount`, con `product_discount = 0`; además se poblan `product_tax`, `order_tax`, `order_tax_id`, `total_tax` y `rounding` para compatibilidad con reportes legacy. Al editar una venta, el porcentaje se recalcula sobre el nuevo total y el monto fijo se conserva (sin UI de edición de descuento en esta fase). Los métodos de pago usan valores compatibles con el POS legado (`cash`, `CC`, `Transferencia`, `Sistecredito`, `ADI`) más `credito` para el crédito propio de la tienda; todos se registran como pago completo (`paid_by` + `paid = grand_total`). `Cuenta pendiente` no registra pago y deja la venta con `status = due`. En el POS, la opción de crédito se muestra como "Crédito [tienda]" según la tienda seleccionada, pero se guarda con el valor estable `credito`. El esquema no tiene columnas de monto recibido/cambio: `tec_sales.paid` y `tec_payments.amount` guardan el monto aplicado (nunca por encima del total) y el cambio se calcula y se devuelve en la respuesta y el ticket, sin persistirse. El impuesto de `tec_products.tax` se interpreta como porcentaje exclusivo: `total` es subtotal antes de impuesto y `grand_total` lo incluye (el descuento manual se resta del total con impuestos). El POS no vende combos directamente (la tienda virtual sí los soporta y llegan como productos sueltos auditables); las devoluciones siguen fuera de alcance.

El grupo `admin` puede seleccionar tiendas del tenant; los demás usuarios necesitan `tec_users.store_id` asignado. La primera versión no interpreta `tec_user_store_access`. Desde v0.3.58 el stock es **global por producto** (`tec_products.quantity`, entero) y el `store_id` de la venta/compra ya no separa existencias (el `tec_product_store_qty` legacy queda fuera de la API); productos fraccionarios siguen sin poder cerrarse. La app revalida precios, tenant y stock en el servidor dentro de una transacción. `total` guarda el subtotal antes del impuesto y `grand_total` incluye el porcentaje exclusivo de `tec_products.tax`.

Las políticas y grants de Supabase no se modifican; RLS no reemplaza los filtros tenant del backend.

## Interfaz y navegación

El frontend usa React Router con un shell de 13 secciones. Los cajeros (`staff`) ven Punto de venta, Dashboard, Ventas, **Clientes** y Cierre de caja; el grupo `admin` ve además Productos, Inventario, Proveedores, Compras, Reportes, Gastos, Usuarios y Configuración.

Módulos operativos: POS con impresión de ticket de 58 mm (y pie con copyright + firma "Neurobit"), Dashboard, historial de ventas (ver, editar y eliminar ventas), productos (crear/editar/ajustar stock; selector de **Categoría**), categorías (`/categorias`: CRUD por tenant con conteo de productos; no se puede eliminar una categoría con productos asignados), inventario (lectura; stock global por producto desde v0.3.58: en tenants de **una sola tienda** se oculta el selector y se muestra el nombre como pill; el modal de Productos expone una sola **Cantidad** que escribe `tec_products.quantity`), clientes (crear/editar), proveedores (crear/editar), compras (modal crear/editar con actualización de stock y costo; cantidades enteras), cierre de caja (apertura, resumen por forma de pago y cierre con arqueo), gastos (crear/editar), reportes (resumen con gráficas y ganancia neta, ventas diarias por calendario, ventas mensuales por calendario, productos más vendidos), usuarios (gestión completa) y configuración (lectura).

El selector de cliente del POS es un combobox con búsqueda en servidor (`GET /api/catalog/customers?q=`), que coincide por nombre, correo o teléfono dentro del tenant/tienda. La búsqueda espera 300 ms desde la última tecla, muestra hasta 10 resultados y permite navegar con flechas/Enter/Escape; por defecto la venta se registra como "Cliente ocasional" (sin `customer_id`).

El ticket se renderiza con `web/src/components/SaleTicket.tsx`: cabecera con logo textual (`site_name`), tienda, número de ticket, fecha, cajero y cliente; ítems con código/cantidad/precio; totales jerarquizados; forma de pago, recibido y cambio; y pie con QR, política de cambios y texto legal. El QR se genera en el navegador con la librería `qrcode` (contenido JSON con ticket, ítems y totales; formato compacto si hay más de 8 ítems) y no requiere endpoint: el navegador nunca envía datos de la venta a un servicio externo. La impresión usa `@page size: 58mm auto` y el contenedor `.print-receipt`; en pantalla hay vista previa en modal. En esa vista previa hay tres acciones: **Enviar por WhatsApp** (texto formateado con `buildTicketText`; usa `customer_phone` —que `create`/`detail` devuelven— con prefijo +57 para números de 10 dígitos, y si no hay teléfono abre WhatsApp Web sin contacto), **Generar PDF** (descarga `ticket-<id>.pdf` con `html2pdf.js`, ancho 58mm, logo y QR) e **Imprimir**.

Esquema verificado de compras: `tec_purchases` guarda la referencia en `reference_no` (no existe `reference`) y no tiene `store_id` ni `received`; `tec_purchase_items` no tiene `sale_price` ni `profit_margin`. La compra suma stock en `tec_products.quantity` (el `store_id` del request solo se valida; ya no separa existencias) y el "Precio venta" opcional actualiza `tec_products.price`. La API ignora por completo `tec_product_store_qty`.

La página de compras usa una tabla a ancho completo y un modal para crear/editar (`POST /api/purchases`, `PUT /api/purchases/:id`). La edición replica el alta dentro de una transacción: revierte el stock de las líneas anteriores, aplica las nuevas, actualiza `reference_no/date/note/total/supplier_id` y conserva `created_by`. Como la cabecera no guarda tienda, el stock se ajusta en el `store_id` enviado desde el modal: al editar debe elegirse la misma tienda con la que se registró la compra.

Endpoints de gestión (solo admin): `GET/POST /api/products`, `PUT /api/products/:id`, `PUT /api/products/:id/stock`, `POST /api/products/:id/images/:slot`, `DELETE /api/products/:id/images/:slot`, `GET/POST/PUT /api/expenses`, `GET/POST/PUT /api/suppliers`, `GET /api/purchases?from&to`, `GET /api/purchases/:id`, `POST /api/purchases`, `GET /api/reports/summary`, `GET /api/reports/calendar?from&to&group=day|month`, `GET /api/reports/top-products`, `GET/POST /api/users`, `PUT /api/users/:id`, `PATCH /api/users/:id/active`, `DELETE /api/users/:id` (baja lógica). Clientes (admin y staff): `GET/POST/PUT /api/customers`; el `staff` lista clientes globales + de su tienda, crea solo para su tienda y edita solo clientes de su tienda (no puede moverlos ni editar globales); no hay endpoint de borrado. Caja (admin y staff): `GET /api/registers`, `GET /api/registers/current`, `GET /api/registers/summary`, `POST /api/registers/open`, `POST /api/registers/:id/close`. Para el `staff` la caja es **por cajero**: listado, caja actual y resumen filtran por `user_id`/`created_by` (no requiere tienda), abre su propia caja y solo cierra la suya; `admin`/`super_admin` ven todo el tenant y pueden filtrar por `store_id`.

La gestión de usuarios crea/edita cuentas en `tec_users`, asigna el grupo `tec_groups` según el rol (admin/staff), exige tienda a los cajeros y desactiva (no borra) usuarios. El hash de contraseñas nuevas depende de `USER_PASSWORD_METHOD`: por defecto `sha1` para que el POS anterior siga pudiendo iniciar sesión; cambiar a `bcrypt` solo después del cutover. Nunca se exponen hashes al cliente. No se puede desactivar la propia cuenta ni el último administrador activo del tenant.

Los listados de gestión (`/api/products`, `/api/customers`, `/api/suppliers`, `/api/users`, `/api/sales`, `/api/purchases`, `/api/expenses`) aceptan `?page&limit` (máx. 100) y devuelven `{ data, meta: { total, page, limit, totalPages } }` usando `COUNT(*) OVER()` + `LIMIT/OFFSET` sobre el esquema existente. Un `OFFSET` alto puede degradar el rendimiento; la evolución prevista es keyset pagination sin cambios de esquema. **Cambio incompatible:** API y web deben desplegarse juntos.

El historial de ventas tiene acciones por fila: ver (`GET /api/sales/:id`, devuelve cabecera, artículos y pagos; el `staff` solo ve ventas de su tienda), ver ticket (reutiliza `GET /api/sales/:id` y el componente `SaleTicket`, imprimible), agregar pago (`POST /api/sales/:id/payments`), editar (`PUT /api/sales/:id`) y eliminar (`DELETE /api/sales/:id`). El listado (`GET /api/sales?from&to&customer&page&limit`) filtra por rango de fechas y por cliente con `customer` (coincidencia parcial e insensible a mayúsculas sobre `customer_name`, escapando `%`/`_`, máx. 100 caracteres); **si `customer` está presente, el rango de fechas se ignora y se busca en todo el historial**, y el total paginado respeta el filtro. Agregar pago está disponible para admin y `staff` (staff solo en ventas de su tienda) cuando queda saldo: valida `monto > 0` y `monto <= pendiente`, inserta el pago en `tec_payments` (columnas existentes: `tenant_id, sale_id, amount, paid_by, created_at`; no hay `notes`/`payment_date` ni DDL) y actualiza `tec_sales.paid` + `status` en la misma transacción (`paid` si cubre el total, `partial` si no); la acción queda en los logs del API con el usuario. Editar y eliminar son **solo admin** y replican el POS legado dentro de una transacción: se devuelve el stock anterior a `tec_products.quantity`, se recalculan totales/estado con el `paid` existente y se reemplazan las líneas (editar) o se borran `tec_sale_items`, `tec_payments` y `tec_sales` (eliminar). Editar solo ajusta cantidades (conserva el precio unitario histórico y exige enteros); si el pago registrado supera el nuevo total se rechaza. Las ventas con combos o artículos personalizados (`product_id` nulo) no se pueden editar ni eliminar desde V2. Los montos se muestran con `formatMoney` (es-CO, 2 decimales).

El reporte de calendario (`GET /api/reports/calendar`, solo admin) agrupa por `group=day|month` y devuelve `{ from, to, group, points[], totals }` con ventas, compras, gastos, pendiente por cobrar y ganancia neta por bucket; los días/meses sin movimientos llegan en cero. La web lo usa en `/reportes/ventas-diarias` (calendario mensual con detalle de ventas por día) y `/reportes/ventas-mensuales` (grilla anual con desglose diario del mes). El resumen diario de ventas (`GET /api/reports/summary`) también expone `purchases_total`, `expenses_total` y `net_profit`, por lo que API y web deben desplegarse juntas.

Las imágenes de producto (`tec_products.image`, `image_2`, `image_3`) pueden guardar una URL completa (Supabase Storage) o un nombre de archivo legacy. La API respeta la URL completa tal cual; para nombres legacy arma `/uploads/thumbs/<archivo>` con fallback a `/uploads/<archivo>` y un placeholder si no existen. El Compose de despliegue monta `LEGACY_UPLOADS_PATH` (por defecto `/srv/pos-media/uploads`; ajustar en `.env` si los archivos legacy viven en otra ruta) como solo lectura en el contenedor web; ese montaje solo aplica si usas nombres legacy.

En la edición de producto hay una galería de 3 ranuras: subir, cambiar o eliminar imágenes (JPG/PNG/WEBP, máximo 2 MB). La API sube al bucket `SUPABASE_PRODUCT_BUCKET` (default `productos`) con la service role y guarda la URL pública construida con `SUPABASE_PUBLIC_URL`; si esa variable falta o apunta a un host interno (por ejemplo `supabase-kong`), la subida se rechaza con un error claro para no guardar URLs inalcanzables. Al leer catálogo y productos, cualquier URL guardada con el host interno de `SUPABASE_URL` se reescribe a `SUPABASE_PUBLIC_URL`. El navegador nunca habla directo con Supabase.

## Tienda Virtual — app móvil (P14)

La sección **📱 Tienda Virtual** (`/tienda-virtual`, solo admin) administra los datos que genera la app móvil sobre el mismo backend:

- **Pedidos App**: ventas con `created_by IS NULL` (cliente, total, método de pago, estado y fecha) con selector para actualizar `status_delivery` (pendiente/enviado/entregado/cancelado; vacío lo limpia). `GET/PATCH /api/admin/app-orders`.
- **Clientes App**: clientes con `password IS NOT NULL`, con `points_balance` y búsqueda por nombre/correo/teléfono; **Ajustar Puntos** (modal con cantidad ± y motivo; nunca deja saldo negativo; queda en logs del API y `tec_tenant_activity_logs` best-effort) y **Restablecer Contraseña** (modal de confirmación; `password = NULL` y limpia `tec_login_attempts` por correo/teléfono para que el cliente use "¿Primera vez?" en la app). `GET /api/admin/app-customers`, `PATCH /api/admin/customers/:id/points`, `POST /api/admin/customers/:id/reset-password`.
- **Reseñas**: `product_reviews` (nombre de producto y cliente, estrellas, comentario, fecha) con borrado definitivo. `GET/DELETE /api/admin/reviews`.
- **Banners**: carrusel de la app desde la tabla global `banners` (solo `image_url`); listar, agregar por URL y eliminar. `GET/POST/DELETE /api/admin/banners`.

Todo es admin-only (`AdminGuard` acepta admin y super_admin) y los pedidos/clientes/actividad van scoped al tenant; los banners son globales por diseño de la tabla.

### Logo por tenant (v0.3.74)

El logo vive en `tec_tenant_settings.logo_url` (sin DDL nuevo) y se gestiona en **Configuración → Marca / Logo** (`POST/DELETE /api/settings/logo`, solo admin; JPG/PNG/WEBP/SVG, máx 2 MB, recomendado ≥ 100×100 px; se guarda con "Guardar cambios" y borra el archivo anterior). El **sidebar del POS** lo muestra (alto máx 40 px, fallback "P") y el ticket ya lo usaba. La **app móvil** lo recibe en `GET /customer/profile` como `tenant.logo_url` tras el login, lo cachea en SharedPreferences (disponible sin conexión) y lo muestra en la pantalla de login y en el AppBar del home, con el icono por defecto si no hay logo.

### Canje de Puntos (P13, v0.3.72)

`tec_products.points_cost` (entero ≥ 0, migración `docs/migrations/v0.3.72-add-points-cost-to-products.sql`) marca los productos canjeables; el endpoint de premios de la app filtra por `points_cost > 0`. `POST /api/customer/redeem` (cliente autenticado) hace el canje en **una transacción**: bloquea producto y cliente (`FOR UPDATE`), valida `points_cost > 0`, existencias y saldo, descuenta puntos, resta 1 de stock, crea una **venta de $0** (`payment_method='points'`, `status='due'`, `created_by=NULL`) con su línea en `tec_sale_items` y registra `customer_points_redeemed`. Hay un guard anti-duplicado de 60 s por cliente+producto. En el POS la venta aparece en **Tienda Virtual → Pedidos App** como "Canje de Puntos" (estado de entrega lo actualiza el admin). En el POS web, el modal de producto incluye **"Costo en Puntos (Canje)"**; en la app móvil, el botón "Canjear por X puntos" aparece en Premios y en el detalle del producto (deshabilitado con "Te faltan X puntos" si el saldo no alcanza).

### Pagos por tenant en la tienda virtual (v0.3.78)

Cada tenant cobra sus pedidos de la app en **su propia cuenta** de Bold/Addi/Sistecrédito; el billing del SaaS (`api/src/billing/`, facturas de la plataforma) sigue usando las variables `BOLD_*` del `.env` global y no se toca. Antes de desplegar, ejecutar una sola vez:

```sh
psql "$DATABASE_URL" -f docs/migrations/v0.3.78-tenant-payment-settings.sql
```

El script crea `tec_tenant_payment_settings` (una fila por tenant: `bold_enabled`/`bold_api_key`/`bold_webhook_secret`, `addi_*`, `sistecredito_*` y `return_url` opcional) e incluye un **seed comentado para Princess Skin**: descoméntalo y reemplaza `LLAVE_IDENTIDAD_BOLD_DE_PRINCESS_SKIN` por la llave real (Bold: Panel de Comercios → Integraciones; `bold_webhook_secret` puede quedar `NULL` porque la firma se valida con la llave de identidad, igual que en el SaaS). Las llaves se guardan en texto plano en el esquema privado: **ningún endpoint las devuelve y nunca se loggeandan**. `TenantPaymentSettingsService` detecta la tabla al arrancar y la cachea 60 s por tenant; `TenantBoldService` crea el link (`POST /online/link/v1`, `x-api-key` del tenant, reference `ORDER-<pedido>-<ts36>`) y valida el webhook con el secreto del tenant.

Flujo de cobro (`POST /api/customer/checkout-with-payment`): si el tenant no tiene el método habilitado o le falta la llave, el checkout falla cerrado con **400 "Este método de pago no está configurado para esta tienda. Por favor, elija Efectivo."** (Efectivo siempre funciona). El webhook `POST /api/webhooks/bold` es de **dos fases**: primero intenta el billing del SaaS (firma con el secreto global) y, si no aplica, resuelve el pedido por la referencia `ORDER-<id>` contra `tec_sales.tenant_id` y valida con la llave/el secreto del tenant; el webhook `POST /api/webhooks/addi` valida **Basic Auth** contra las credenciales del tenant (fail-closed, ver v0.3.79 abajo) y `POST /api/webhooks/sistecredito` valida `x-webhook-secret` contra el secreto del tenant del pedido (una sola URL de webhook para todos). Al liquidar se registra el pago en `tec_payments` (`CC`/`ADI`/`Sistecredito`) y el pedido pasa de `due` a `paid` creditando puntos como siempre. Sistecrédito sigue como **stub** de checkout (URL de sandbox) hasta confirmar el contrato, pero ya usa las credenciales del tenant.

### Addi real (v0.3.79)

La integración de Addi dejó de ser stub y ahora es un cliente server-to-server real (`api/src/payments/addi.service.ts`) con las credenciales del tenant (`addi_api_key` = client_id, `addi_webhook_secret` = client_secret):

- **Token**: OAuth2 client-credentials contra `ADDI_AUTH_URL` (Auth0) con `audience` = `ADDI_AUDIENCE`; acepta base o URL completa (se normaliza a `/oauth/token` y el body va como `application/x-www-form-urlencoded`, el estándar de Auth0 — v0.3.80); el JWT se cachea por tenant (`expires_in` − 5 min) y se invalida si la creación devuelve 401.
- **Checkout**: `POST {ADDI_API_BASE_URL}{ADDI_APPLICATIONS_PATH}` con `redirect: 'manual'`; la URL de checkout se toma del header `Location` del 301 (fallback defensivo: JSON 2xx con `checkout_url`/`url`). Payload snake_case (v0.3.82): `order_id` único por intento (`ORDER-<venta>-<ts36>`), `amount` COP entero, `currency: 'COP'`, `customer` anidado (`first_name`/`last_name`, `email`, `phone` en formato `57XXXXXXXXXX` (indicativo, sin `+`) vía `normalizePhoneForAddi`, `document_type: 'CC'`, `document_number` desde `ADDI_TEST_DOCUMENT_NUMBER`, default `1001234567`), bloque `shipping` (mismos datos + `address: Calle Falsa 123`, `city: Bogotá`, `country: 'CO'`; desactivable con `ADDI_SEND_SHIPPING=false`), `callback_url` (nuestro webhook), **`redirection_url` siempre presente** (return del tenant → `CUSTOMER_PAYMENT_RETURN_URL` → default `https://pos.tienderu.com/config?payment=return`) e `items` reales de la venta (`sku` = código del producto, `name`, `quantity` y `price` enteros). El payload exacto se loggea en debug antes del fetch (email/teléfono enmascarados **solo en esa copia del log** — el request real va sin máscara) y cualquier error registra el cuerpo **completo** de Addi más su arreglo `errors[]` y el header `x-trace-id` (si viene) para soporte.
- **Webhook** (`POST /api/webhooks/addi`): **fail-closed** — resuelve el pedido por la referencia `ORDER-<id>` ecoada, exige Basic Auth válida del tenant (se aceptan ambas orientaciones del par, comparación en tiempo constante) y **rechaza con 401** si falta cualquiera de las dos. Solo `approved` liquida la venta; `rejected`/`declined`/`abandoned` se registran y se ignoran. Regla de Oro de Addi: la respuesta es **HTTP 200 con exactamente el mismo JSON recibido** (eco del raw body).
- **Config global** (`.env`, no confidencial): `ADDI_AUTH_URL`, `ADDI_AUDIENCE`, `ADDI_API_BASE_URL`, `ADDI_APPLICATIONS_PATH`, `ADDI_CALLBACK_URL`. Los defaults apuntan al **sandbox** y el API avisa al arrancar; en producción define los valores reales del portal.
- **Pendientes marcados en código (`TODO: CAMPO_REAL_DE_ADDI`)**: path exacto de creación de solicitud y nombres exactos de los campos del request/callback de Custom Integrations. Como el webhook es fail-closed, si algún nombre no coincide no se liquida nada (401 visible en logs) — se ajusta en una línea sin riesgo de cobros mal aplicados.

## Configuración editable (solo admin)

La página `/config` es editable y usa `PUT /api/settings` (solo admin). `GET /api/settings` (campos editables + `supported`) y `PUT /api/settings`/logo quedaron **solo admin/super_admin**; `GET /api/settings/pos` (autenticado) devuelve solo el subconjunto de visualización que usan la sesión y el ticket (nombre, moneda, logo, textos, QR/ancho). La API **no asume columnas**: consulta `information_schema.columns` de `public.tec_settings` (caché de 30 s) y solo lee/escribe la intersección con su lista blanca (`site_name`, `currency_prefix`, `default_customer`, `address`, `phone`, `email`, `nit`, `timezone`, `language`, `default_tax`, `decimal_digits`, `thank_you_message`, `return_policy`, `show_qr_on_ticket`, `printer_width`, `logo_url`). Los campos sin columna aparecen deshabilitados y la respuesta incluye `supported`. Los campos SMTP nunca se exponen ni se editan. El logo se elige con vista previa inmediata y se sube junto con "Guardar cambios" (`POST /api/settings/logo`, máx. 2 MB, PNG/JPG/WEBP/SVG) al bucket de productos bajo el prefijo `logos/`; "Eliminar" lo borra del storage y pone `logo_url = NULL`. Nginx permite hasta 5 MB en `/api/`. El **proxy frontal (Nginx Proxy Manager)** también debe permitirlo: en Advanced del Proxy Host añadir `client_max_body_size 5m;` (sin esto, archivos >1 MB fallan con 413). El bucket `SUPABASE_PRODUCT_BUCKET` (default `productos`) debe existir y ser público (`docs/migrations/v0.3.20-storage-bucket.sql` o Dashboard → Storage → New bucket). Los logs de la API registran tenant/tamaño/path/error de cada subida de logo.

`tec_settings` es la tabla **legada** (global, primera fila): desde v0.3.16 solo se usa como fuente del backfill y como fallback mientras `tec_tenant_settings` no exista; no debe editarse para configurar tenants individuales. Para habilitar en ella los campos que falten (solo necesario en modo legacy/fallback), ejecutar una sola vez (DDL manual aprobada):

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

Configuración **por tenant** (v0.3.16, DDL aprobado): la API lee/escribe `public.tec_tenant_settings` (una fila por tenant, `tenant_id` único) con branding, datos fiscales/contacto, moneda/zona/idioma, impuestos y campos del ticket. Antes de desplegar v0.3.16, ejecutar una vez:

```sh
psql "$DATABASE_URL" -f docs/migrations/v0.3.16-tenant-settings.sql
```

El script es idempotente y backfillea a los tenants existentes: el **tenant más antiguo** hereda la fila legada completa de `tec_settings` (así "Skin" queda igual) y los demás arrancan con `site_name = nombre del tenant` y los defaults globales (moneda/zona/idioma, impuestos, ticket). Reglas:

- Si la tabla existe, `GET /api/settings`, `GET /api/settings/pos`, `PUT /api/settings` y los logos (`POST/DELETE /api/settings/logo`) operan **solo sobre la fila del tenant activo**; si falta, se provisiona con `site_name = nombre del tenant`.
- Al crear un tenant (`POST /api/tenants`) se crea su fila de settings automáticamente.
- Si la tabla aún no existe, la API mantiene el modo global anterior sobre `tec_settings` (avisa en logs) y **la detecta sola en ≤30 s** cuando la crees; ya no hace falta reiniciar, basta refrescar la página.
- `tec_settings` queda como legado (fuente del backfill y del modo fallback) y no debe usarse para configurar tenants individuales.

Notas del ticket: `show_qr_on_ticket`, `thank_you_message`, `return_policy` y `printer_width` se aplican en `SaleTicket`; con `80mm` se inyecta `@page { size: 80mm auto }`. `address`, `phone` y `nit` se imprimen en la cabecera si existen.

## Facturación del tenant (v0.3.23)

`/config` tiene ahora dos pestañas: **General** (la configuración existente) y **Facturación**, visible para el admin del tenant. Las facturas se **derivan** de las tablas existentes (sin DDL): los pagos `completed` de `tec_tenant_payments` salen como **Pagado**, los `failed/refunded` como **Cancelado**, y el período vigente según `next_billing_date`/`subscription_end_date` como **Pendiente** o **Vencido** (monto = precio del plan según `billing_cycle`; los tenants en prueba no generan facturas). Numeración `FAC-YYYYMMDD-XXXX` (pagos) y `FAC-YYYYMMDD-PEND|VENC` (período vigente).

Flujo de pago: **Bold** (v0.3.43) o manual. Con Bold configurado (`BOLD_ENABLED=true` + `BOLD_API_KEY`), el botón **"Pagar con Bold"** llama `POST /api/billing/pay-bold`: el backend crea un link con el **API Link de pagos** de Bold (`POST /online/link/v1`, auth `x-api-key`, `reference` = número de factura), guarda el pago `pending` con `bold_payment_id = LNK_*` y `invoice_url` = URL de checkout, y la UI redirige a Bold. Al volver (`?payment=return|success|cancelled`) el frontend llama `POST /api/billing/verify-bold`, que consulta `GET /online/link/v1/{LNK}` y confirma/renueva o marca fallido (Bold puede tardar hasta 10 min en notificar links). El webhook público `POST /api/webhooks/bold` valida `x-bold-signature` = HMAC-SHA256(`BOLD_WEBHOOK_SECRET`, body en base64) y es idempotente por `bold_payment_id` (siempre responde 200 salvo firma inválida). Nunca se manejan datos de tarjeta. Requiere `docs/migrations/v0.3.43-bold.sql` (columna `bold_payment_id` + índice único) y registrar `https://pos.tienderu.com/api/webhooks/bold` en el Panel de Comercios → Integraciones → Webhooks. El flujo **manual** ("Registro manual" + confirmación del super admin) sigue disponible como respaldo. Variables: `BOLD_ENABLED`, `BOLD_API_KEY` (llave de identidad real; una vacía o placeholder deshabilita Bold con 503), `BOLD_WEBHOOK_SECRET` (opcional; si falta se firma con `BOLD_API_KEY`, como en Bold), `BOLD_LINKS_BASE_URL` (o `BOLD_API_BASE`), `BOLD_SANDBOX`, `BOLD_CALLBACK_URL`, `BOLD_LINK_EXPIRATION_MINUTES`, `BOLD_PAYMENT_METHODS` (vacío = CREDIT_CARD, PSE, BOTON_BANCOLOMBIA, NEQUI).

**Morosidad (v0.3.47, sin DDL):** un job horario (junto al de ciclo de vida) revisa las suscripciones `active` cuyo `COALESCE(next_billing_date, subscription_end_date)` venció hace más de `BILLING_GRACE_DAYS` (default 3). Con `BILLING_AUTO_SUSPEND=true` las pasa a `suspended`, marca el tenant `inactive`, **borra sus sesiones** (logout inmediato) y registra `subscription_suspended`; con `false` solo avisa en logs (seguro para desplegar). El `TenantOperationalGuard` bloquea con **402 "Payment Overdue"** las mutaciones de ventas (`POST /api/sales`, pagos, `PUT/DELETE`), mientras que todos los `GET` (reportes, inventario, facturación) siguen disponibles en modo lectura; el estado se cachea 60 s. Al pagar (Bold o manual) el tenant se reactiva automáticamente (`applyCompletedPayment`).

## Escáner de códigos en el POS (v0.3.24)

En **Nueva venta**, junto al buscador hay dos botones: 📷 (código de barras: EAN-13/8, UPC-A/E, Code-128/39, ITF, Codabar) y 🔳 (QR). Abren un modal con la cámara en vivo, guía de escaneo, animación láser, feedback verde/rojo y beep; incluyen **escaneo continuo** (contador de escaneados) y **entrada manual** como fallback. La cámara solo se enciende al abrir el modal y se libera al cerrarlo (stop + clear). El valor escaneado se parsea (texto, JSON `code|barcode|sku|id` o URL con `code`/`barcode`) y se resuelve contra `GET /api/catalog/products?store_id&q=` por `code` exacto y luego por nombre exacto; se ignora el mismo código repetido en 2 s y el producto entra al ticket con las mismas reglas del POS (combo, precio y stock). Requiere HTTPS (contexto seguro) y permiso de cámara; si se deniega o no hay cámara, queda la entrada manual. Sin cambios de backend.

**Fix v0.3.85:** cerrar el escáner en un equipo sin cámara ya no rompe la app. `html5-qrcode.stop()` lanzaba una excepción síncrona ("Cannot stop, scanner is not running or paused.") cuando la cámara nunca inició y, al no haber error boundary, React desmontaba toda la interfaz (pantalla en blanco al cerrar el modal). Ahora el stop/clear pasa por `safeStopScanner()` con try/catch.

Desde v0.3.27 el mismo escáner está en **Productos** (`/productos`): 📷/🔳 junto al buscador. Al escanear busca por `code` exacto en `GET /api/products?store_id&q=`, filtra la tabla con ese código y avisa **"Producto encontrado"**; si no existe, muestra **"Producto no encontrado. Puede crearlo con el código: X"** y deja el código precargado para **+ Crear producto** (el formulario se abre con el campo Código listo). Además, dentro del modal de crear/editar producto el campo **Código** tiene sus propios 📷/🔳: al escanear se rellena el código, se cierra el escáner y el foco pasa a **Nombre**. Todo lo demás (permisos, limpieza de cámara, continuo, manual) es idéntico al POS.

## Pruebas E2E (Playwright)

El flujo crítico de venta del POS está cubierto por un E2E real de UI (`web/e2e/pos-sale.spec.ts`): login de **cajero** → escaneo de un producto (entrada manual del `ProductScanner`, sin cámara) → **descuento manual del 10%** → **efectivo con monto recibido mayor al total** (verifica el cambio mostrado contra `recibido − total` y el estado "Pagada") → la venta aparece en **/ventas** con badge `Pagada` (`paid`) y el total pagado.

⚠️ El test **crea una venta real** en el ambiente apuntado: ejecútalo solo contra un ambiente de pruebas, nunca producción.

Requisitos:
- Un **cajero activo con tienda asignada** y credenciales conocidas.
- Un **producto con precio y stock** cuyo código (barcode/SKU) conozcas.
- API y web corriendo (dev: `npm run dev:api` + `npm run dev:web` en la raíz) o el stack Docker de pruebas.

```sh
cd web
npm install
npx playwright install chromium        # una sola vez
E2E_CASHIER_USERNAME='cajero.demo' \
E2E_CASHIER_PASSWORD='••••••' \
E2E_PRODUCT_CODE='7701234567890' \
npm run test:e2e                       # E2E_BASE_URL para apuntar a otro ambiente
```

Alternativa 100% Docker (sin Node en el host), desde la raíz del repo — el script lee la versión de Playwright del `package.json` y usa la imagen oficial del navegador (`npm ci` corre en el contenedor):

```sh
E2E_BASE_URL='http://127.0.0.1:8096' \
E2E_CASHIER_USERNAME='cajero.demo' E2E_CASHIER_PASSWORD='••••••' E2E_PRODUCT_CODE='7701234567890' \
./web/e2e/run-docker.sh
```

`E2E_BASE_URL` (default `http://localhost:5173`, el dev de Vite que proxya `/api`) permite apuntar al POS desplegado en pruebas (p. ej. `http://127.0.0.1:8096`). Con `npm run test:e2e:headed` se ve el navegador; los fallos guardan screenshot y trace en `test-results/`/`playwright-report/`.

## Punto de venta: cajero en turno (v0.3.87)

El encabezado del POS muestra un chip con el **cajero actual** (nombre del usuario de la sesión) y un punto verde/rojo que indica **Caja abierta / Caja cerrada** (fuente: `GET /api/registers/current`, la misma caja de "Cierre de caja"). El modal "Confirmar venta" incluye "Atendido por: {cajero}" y el ticket ya lo imprimía. Sin cambios de backend.

## Mejoras de interfaz (v0.3.88–v0.3.90)

- **Micro-interacciones (v0.3.88)**: modales y avisos con animación suave, realce de tarjetas al pasar el mouse, anillo `:focus-visible` accesible y skeletons en el catálogo del POS mientras carga. Todo respeta `prefers-reduced-motion`.
- **Migas de pan (v0.3.89)**: franja global "Inicio › Sección › Subsección" en todas las páginas (mapa estático de etiquetas; en la vista global del superadmin el inicio es "Dashboard global"). Los reportes diario/mensual ya no duplican su breadcrumb manual.
- **Tema oscuro (v0.3.90)**: toggle 🌙/☀️ en el pie del sidebar, persistido por navegador y con valor inicial según el tema del sistema. El bloque `[data-theme='dark']` es aditivo (el tema claro queda intacto) y el **ticket/PDF siempre se imprimen en claro**.

## Reportes con gráficos (v0.3.91)

La página **Reportes** ahora acompaña sus tablas con dos visualizaciones nuevas en Recharts (tipos distintos a los existentes línea/barras agrupadas): **"Cobrado vs pendiente por día"** — área apilada con degradado dentro de la sección *Ventas por día* — y **"Top 10 por unidades vendidas"** — barras horizontales rankeadas (en orden #1 arriba) con tooltip de unidades e ingresos dentro de *Productos más vendidos*. Ejes y grillas usan colores neutros legibles en tema claro y oscuro, los tooltips respetan el tema (`--d-surface`) y se mantienen los estados de carga/vacío. Sin cambios de backend.

## Calendario con métricas por celda (v0.3.92)

En **Ventas diarias** cada celda del calendario muestra ahora las cuatro métricas del día — **Ventas** (azul), **Compras** (naranja), **Gastos** (rojo) y **Ganancia** (verde si es positiva, roja si negativa) — con montos abreviados (`$ 30 mil`, `$ 1,2 M`; `—` cuando el valor es cero) para que quepan en la cuadrícula. En **Ventas mensuales** cada cuadro de mes muestra las mismas cuatro métricas del mes. El detalle exacto (montos completos y conteos) sigue disponible en el modal al hacer clic y en las tarjetas superiores. Sin cambios de backend: `/reports/calendar` ya devolvía estos totales por bucket; se agregó `formatMoneyCompact` a `format.ts` y las clases `.cell-metric*` (con overrides de tema oscuro).

## Cuentas abiertas (v0.3.93–v0.3.95)

Para tiendas con mesas o cuentas por cobrar: el POS permite **abrir una cuenta** (venta pendiente con etiqueta libre, ej. "Mesa 5") sin dejar de facturar normalmente. En la nueva sección **Cuentas abiertas** (menú 📒, staff y admin) se listan las ventas pendientes (`due`/`partial`) con búsqueda por etiqueta y acciones: **Cobrar** (total o parcial con el modal de pagos existente, verifica saldo), **Ver** (detalle con ítems, saldos y cajero) y **Agregar productos** (abre el POS en modo cuenta: agregas solo los productos nuevos y se suman a la cuenta). El backend agrega `POST /api/sales/:id/items` (solo cuentas `due|partial`, staff de su tienda o admin), el filtro `status` en `GET /api/sales` y la etiqueta libre en `customer_name` — **sin DDL**; stock, descuentos guardados y puntos se mantienen consistentes al agregar. La facturación normal del POS no cambia.

## Asistente IA (v0.4.0–v0.4.1)

Chat **solo para administradores** conectado a **OpenRouter** que responde con **datos reales de la tienda**: no inventa cifras — usa *tool calling* (13 herramientas) para consultar datos reales: resumen financiero por rango (ventas/compras/gastos/ganancia), ventas por día/mes/**hora del día/categoría**, productos (más vendidos, **margen**, stock bajo y **sin movimiento**), **clientes (ranking por compras, búsqueda, puntos y deuda pendiente)** y **cuentas abiertas por cobrar**. La **API key es global de la plataforma** (`OPENROUTER_API_KEY` en el `.env` del API; Tienderu cobra el servicio) y el **modelo también se define en el servidor**: `OPENROUTER_MODEL` (por defecto `openai/gpt-oss-20b`) con **fallback automático** (`OPENROUTER_MODEL_FALLBACK`, por defecto `deepseek/deepseek-v4.1-flash-1017`, enviado como el arreglo `models` de OpenRouter). Desde v0.4.2 el admin no ve botón de configuración; la tabla `tec_tenant_ai_settings` (migración `docs/migrations/v0.4.0-tenant-ai-settings.sql`) queda reservada para una fase futura. Preguntas de ejemplo: "¿Cuánto vendí los últimos 3 días?", "¿Cuál es mi producto más vendido este mes?", "¿Qué me sugieres pedir esta semana?", "¿Cómo va mi ganancia del mes?". MVP sin streaming; el admin ve datos de sus propios clientes (solo admin). Límite diario `AI_DAILY_MESSAGES_LIMIT` (default 100/tienda) para controlar el gasto, herramientas en paralelo y caché de 30 s (v0.4.3).

## WhatsApp (Evolution API) (v0.5.0–v0.5.1)

Cada tienda puede vincular su propio WhatsApp desde el POS (sección **WhatsApp**, solo admin). Botones: **Crear instancia** (una por tenant, nombre derivado `pos-<slug>-<id8>`), **Conectar** (modal con **QR** que se refresca solo; la página detecta automáticamente cuando queda conectado) y **Desconectar** (cierra la sesión de WhatsApp pero **conserva la instancia** para reconectar con un QR nuevo). Usa el **mismo servidor Evolution API** que educol con credenciales globales de la plataforma (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY` en el `.env` del API; la key nunca se expone al navegador ni se guarda por tienda). Requiere la migración `docs/migrations/v0.5.0-tenant-whatsapp.sql`.

### Bot de ventas (v0.6.0–v0.6.6)

Activa el **agente de ventas** en la misma sección: responde precios, disponibilidad y **características** con datos reales (IA con herramientas), recomienda productos, **toma el pedido** y lo deja **pendiente de pago** (venta *Debida* en Cuentas abiertas / Pedidos App, con stock descontado) hasta que la tienda verifique el pago. Desde v0.6.5 el **pedido en curso vive en el servidor**: el bot agrega/quita productos y siempre responde con los totales exactos; si el cliente agrega algo **después** de cerrar, se suma al **mismo pedido** (no crea otro). Configura **nombre** y **tono** (amable / profesional / vendedor / cercano); los datos de la tienda salen de Configuración. Si el bot pasa la conversación a un asesor (o el personal responde desde el teléfono), el bot se pausa; **retoma solo** si el asesor deja de responder 15 minutos o el cliente escribe *bot*. Requiere `EVOLUTION_WEBHOOK_TOKEN` en el `.env` y la migración `docs/migrations/v0.6.0-whatsapp-bot.sql`; al activarlo se registra el webhook en Evolution automáticamente. Los clientes se crean solos (nombre del perfil de WhatsApp). Próxima fase: avisos al admin, bandeja de conversaciones con traspaso a humano y link de pago Bold.

## CRM de ventas (v0.7.0–v0.7.1)

Cada tienda tiene un CRM en **/crm**: pipeline **Kanban** (Nuevo → Contactado → Cualificado → Propuesta → Ganado/Perdido) con arrastrar y soltar, lista con filtros y **seguimientos vencidos**, ficha del lead con **hilo de WhatsApp embebido** (responder desde el CRM pausa el bot 15 min en ese chat), timeline de actividades y tareas, **plantillas** con variables (`{{nombre}}`, `{{tienda}}`, `{{pedido}}`, `{{total_pedido}}`, `{{pendiente}}`) y **automatizaciones** (bienvenida, reactivación, recordatorio de pago de pedidos Debida, post-venta) con guardrails: solo 8:00–19:00 (hora de la tienda), máximo 50 enviados/día/tienda, 1 por cliente cada 24 h y respeto al **opt-out** (el cliente escribe "no más"/"stop"). Los leads se crean solos cuando alguien escribe por WhatsApp y las ventas pagadas mueven el lead a **Ganado**. Requiere la migración `docs/migrations/v0.7.0-crm.sql`. Config opcional: `CRM_AUTOMATION_START_HOUR`, `CRM_AUTOMATION_END_HOUR`, `CRM_AUTOMATION_DAILY_LIMIT`. Próxima fase: **IA del CRM** (resumir la conversación con siguiente acción sugerida y redactar mensajes con IA en el tono del agente).

## Marketplace Tienderu.com (v0.8.0–v0.8.2)

Tienderu.com es la **tienda pública multi-tenant**: los clientes compran en línea los productos de las tiendas del POS con una **cuenta global** (email + contraseña) y **pago único con Bold** (tarjetas/PSE). Cada vendedor activa "Vender en tienderu.com" desde **/marketplace** (opt-in); sus productos con existencias se publican a **precio base + impuesto × markup** (10% por defecto): el cliente ve el precio con el 10% incluido, el vendedor recibe **exactamente lo mismo que en su local** y la diferencia (comisión) queda para la plataforma. El checkout divide el carrito **por vendedor** (estilo Amazon): cada tienda recibe su sub-pedido con dirección de envío y despacha su parte (`preparando → enviado → entregado`, sincronizado con `status_delivery` de la venta), mientras el pedido principal se paga **una sola vez** con la cuenta Bold de la plataforma (`MARKETPLACE_BOLD_*`). Cada venta del marketplace crea la **venta real en el POS del vendedor** (stock descontado, visible en Ventas y Pedidos App). El super admin ve GMV, comisión y el reporte de **liquidaciones** en `/marketplace-global` (marcar transferencias a cada tienda). La tienda web (`store/`) se sirve en tienderu.com con home de banners/categorías, buscador con filtros, ficha con galería/reseñas, carrito, checkout y pedidos con seguimiento. Además: reseñas públicas (solo lectura), tarifa de envío plana configurable (`MARKETPLACE_SHIPPING_FLAT`). Desde **v0.10** la tienda es personalizable sin tocar código: en **Marketplace global → pestaña "Marca y banners"** (super admin) puedes subir el **logo** y el **favicon** de tienderu.com, editar la **descripción y contactos del footer** (email, teléfono, WhatsApp, dirección, Instagram, Facebook) y administrar los **banners pequeños** del home (imagen + enlace, activar/ordenar) además de los **banners grandes del carrusel** (por URL; también salen en la app móvil de todos los tenants); requiere `docs/migrations/v0.10.0-marketplace-branding.sql`. El flujo de pago reintenta el link de Bold desde "Mis pedidos" si la pasarela no respondió al crear el pedido. Los pedidos sin pago se **cancelan automáticamente** al cumplir el TTL (`MARKETPLACE_PAYMENT_TTL_MINUTES`, default 60 min) reponiendo el stock, y tanto el cliente (pedidos impagos) como el vendedor (antes de despachar) pueden cancelar. **Antes de desplegar**: ejecutar `docs/migrations/v0.8.0-marketplace.sql` y `docs/migrations/v0.10.0-marketplace-branding.sql` y configurar `MARKETPLACE_BOLD_API_KEY`, `MARKETPLACE_BOLD_WEBHOOK_SECRET`, `MARKETPLACE_SHIPPING_FLAT` y `MARKETPLACE_CALLBACK_URL`; apuntar `tienderu.com` al contenedor `pos-gres-v2-store` (NPM, puerto `STORE_PORT`). Próxima fase (roadmap de la auditoría v0.11.x): notificaciones por WhatsApp al vendedor y al cliente + recuperación de contraseña; SEO/Open Graph/sitemap/analítica self-hosted; compartir producto, wishlist y filtros avanzados; reseñas del marketplace, cupones y contraentrega; headers de seguridad y tests E2E del store.

## Plataforma de gestión de tenants (v0.3.11)

El área **Gestión de tenants** es visible solo para el super admin y tiene dos modos según el selector **Tenant activo** del sidebar:

- **Vista global** (estado inicial del super admin, sin tenant): el selector muestra "Seleccionar tenant…" y el sidebar lista Dashboard global (🌍, en `/dashboard/global`) y Gestión de tenants con sub-ítems (Tenants, Planes, Pagos de tenants, Datos de tenants). **Configuración no aparece** (es por tenant): las rutas de POS y `/config` redirigen a `/dashboard/global`. El sidebar muestra el **logo de la plataforma** (`web/src/assets/tienderu-logo.svg`, fallback al monograma "P") — nunca el de un tenant (v0.3.86).
- **Vista tenant** (al elegir un tenant en el selector o con "Entrar" desde gestión): sidebar POS completo de ese tenant (POS, Dashboard, Ventas, …, Configuración) y el token pasa a ese contexto. Para volver a la vista global, elegir "Seleccionar tenant…" en el selector.

Páginas de gestión:

- `/tenant-management/tenants`: tarjetas de resumen (activos, en prueba, por vencer en 7 días, suspendidos), filtros por estado/plan/por vencer y búsqueda por nombre, host o email del admin; acciones rápidas para cambiar plan, extender prueba y suspender/reactivar.
- `/tenant-management/tenants/:id`: ficha con pestañas **Resumen** (suscripción, fechas y uso vs límites del plan), **Pagos** (historial + registrar pago manual), **Actividad** (auditoría de eventos) y **Acciones** (entrar al tenant, editar datos, cambiar plan, extender prueba, suspender/reactivar, eliminar).
- `/tenant-management/plans`: CRUD de planes (precio mensual/anual, límites de usuarios/tiendas —`-1` = ilimitado—, características, activar/desactivar y tenants por plan).
- `/tenant-management/payments`: pagos globales con filtros por fechas, tenant, estado, método y rango de monto; resumen del mes (ingresos, completados, pendientes, fallidos) y exportación CSV de la página actual.
- `/tenants` sigue disponible como **Datos de tenants** (alta, edición, activar/desactivar, entrar y eliminar).

Antes del despliegue, ejecutar una sola vez el script aprobado:

```sh
psql "$DATABASE_URL" -f docs/migrations/v0.3.11-tenant-management.sql
```

Crea `tec_subscription_plans`, `tec_tenant_subscriptions`, `tec_tenant_payments` y `tec_tenant_activity_logs` con sus índices, siembra los planes **Gratuito, Básico, Profesional y Empresarial** y asigna Plan Gratuito activo a los tenants existentes que no tengan suscripción. `performed_by` es INTEGER porque los IDs de `tec_users` son enteros. Si la API arranca sin las tablas, los endpoints de gestión devuelven **503** con un mensaje claro y el resto del POS sigue operando; reiniciar la API tras ejecutar el script.

Endpoints (todos `SuperAdminGuard`): `GET/POST /api/tenant-management/plans`, `PATCH /api/tenant-management/plans/:id`, `GET /api/tenant-management/tenants`, `GET/PATCH /api/tenant-management/tenants/:id/subscription`, `POST /api/tenant-management/tenants/:id/trial/extend`, `POST .../suspend`, `POST .../reactivate`, `GET /api/tenant-management/payments`, `GET /api/tenant-management/payments/summary`, `GET /api/tenant-management/tenants/:id/payments`, `POST /api/tenant-management/tenants/:id/payments/record`, `GET /api/tenant-management/tenants/:id/activity`.

Reglas de negocio: los tenants nuevos se crean en **prueba de 14 días** con el plan gratuito (o el elegido si es gratis); si al crear se elige un plan **de pago** (precio > 0), la suscripción nace **activa mensual** con `subscription_end_date`/`next_billing_date` a +1 mes (se registra como `plan_changed`/pago después con "Registrar pago"); un trabajo interno revisa vencimientos al arrancar y cada 6 h (pruebas sin suscripción vencidas y suscripciones con `auto_renew = false` vencidas pasan a `expired`); suspender desactiva también el tenant (bloquea login) y reactivar restaura ambos; registrar un pago activa la suscripción y fija `subscription_end_date`/`next_billing_date` (+1 mes o año según el ciclo); al crear usuarios se aplica el límite `max_users` del plan (los tenants sin plan no se bloquean; `assertCanAddStore` ya existe pero aún no hay endpoint de creación de tiendas). Los recordatorios por email quedan para una fase futura (no hay servicio de correo).

## Dominio único (v0.3.18)

Todos los tenants entran por `https://pos.tienderu.com`; el tenant se resuelve por las credenciales del usuario (`tec_users.tenant_id`, el Host ya no identifica al tenant) y el super admin arranca en vista global y cambia de contexto con el selector **Tenant activo** (`/api/auth/switch-tenant`). Antes del despliegue, ejecutar una vez (no borra nada: solo actualiza `tec_tenants.host` y elimina el índice/constraint único de `host`, DDL aprobado; si prefieres no tocar constraints usa `SET host = NULL` y omite esos pasos):

```sh
psql "$DATABASE_URL" -f docs/migrations/v0.3.18-single-domain.sql
```

Checklist DNS + Nginx Proxy Manager:

1. **DNS**: registro A `pos.tienderu.com` → IP del VPS del proxy.
2. **NPM**: Proxy Host `pos.tienderu.com` → Forward Hostname `pos-gres-v2-web`, Port `80`, red `npm_net`, Websockets activo, `client_max_body_size 5m`.
3. **Redirect opcional**: Proxy Host `skin.tienderu.com` con Custom Nginx `return 301 https://pos.tienderu.com$request_uri;` (o mantener el proxy actual: los hosts viejos siguen funcionando porque el login ya no depende del host).
4. **SSL**: emitir/renovar el certificado del nuevo dominio en NPM.
5. Probar el login de un usuario de cada tenant y el switch del super admin antes de retirar hosts antiguos.

## Super administrador (Fase 1 — backend)

Registro de tenants aprobado como única excepción de DDL: `tec_tenants (id uuid PK, name, host, status, created_at)`. El super admin es un grupo **compartido** `tec_groups(name='super_admin', tenant_id IS NULL)` y un `tec_users` en el tenant default. Endpoints: `GET/POST /api/tenants`, `GET /api/dashboard/global` y `POST /api/auth/switch-tenant` (todos con `SuperAdminGuard`). `AdminGuard` acepta `admin` y `super_admin`. **Todos los tokens llevan `home_tenant_id`** (igual a `tenant_id` en el login; tras `switch-tenant` queda el hogar y `tenant_id` es el destino) y **`super: true`** cuando el grupo resuelto es `super_admin`. La sesión refleja `homeTenantId` y `super`, y `TenantContextGuard` rechaza cualquier inconsistencia; el scope cross-tenant exige `claims.super === true` **y** grupo `super_admin`. `GET /api/auth/me` devuelve `super: boolean`. La auditoría queda en logs del API (MVP). En el frontend, el super admin ve un selector de **tenant activo** en el sidebar (llama `switch-tenant`, reemplaza el token y limpia la caché de React Query), la página `/tenants` (ruta `SuperAdminOnly`) con métricas (usuarios/tiendas/ventas), alta de tenants y botón "Entrar", Y la página `/dashboard/global` (ítem "Dashboard global", `SuperAdminOnly`) con **métricas de negocio** (no ventas de tenants): planes vendidos hoy, suscripciones activas con **gráfica de distribución por plan** (Recharts: Gratuito gris · Básico azul · Profesional verde · Empresarial morado, con % y conteo en tooltip), ingresos del mes y MRR (anual/12), cobros vencidos/pendientes, **movimientos recientes de plan** con indicador ↑ upgrade / ↓ downgrade, actividad del mes (nuevas suscripciones, cambios de plan con ↑/↓, cancelaciones, pruebas y conversiones) y los últimos planes vendidos por tenant. Zona horaria de negocio (POS_TIMEZONE por defecto; los reportes usan la del tenant). Al crear un tenant, el backend aprovisiona en una transacción el registro, la tienda `Tienda Principal` y un **usuario admin** (`<slug>_admin`, con sufijo numérico si colisiona) con contraseña generada; la respuesta incluye `admin_username`/`admin_password` (solo una vez) y la UI muestra un modal de credenciales con botones de copiado y el aviso de que no se volverán a mostrar. El login es **por credenciales** (dominio único): la API busca el usuario por `username`/`email` en `tec_users` y usa su `tenant_id`; el header Host ya no identifica al tenant. `TENANT_HOST_MAP`/`DEFAULT_TENANT_ID` quedan solo como bucket de intentos fallidos para identidades desconocidas. Los tenants se pueden **editar** (nombre, host —opcional/limpiable— y estado) con `PATCH /api/tenants/:id` y **activar/desactivar** desde la tabla; los inactivos se atenúan, bloquean "Entrar" y no resuelven login. También se pueden **eliminar** (`DELETE /api/tenants/:id`, 204) cuando no tienen ventas, usuarios activos (distintos del admin) ni inventario: es un **soft delete** (`status='deleted'` y `host=NULL`) que no borra datos ni requiere DDL; el tenant activo no puede eliminarse a sí mismo.
# TienderuPOS-V2.0
