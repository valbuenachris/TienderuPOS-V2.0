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

La primera pantalla permite login, catálogo, clientes, selección de tienda y registro de venta con líneas/pago. Los pagos iniciales usan los valores heredados `cash`, `CC` y `Transferencia`. El impuesto de `tec_products.tax` se interpreta como porcentaje exclusivo: `total` es subtotal antes de impuesto y `grand_total` lo incluye. El DDL de ventas no tiene columnas de descuento/desglose tributario. Los productos combo se rechazan en V1; las devoluciones, compras, cierre de caja e impresión quedan para fases posteriores.

El grupo `admin` puede seleccionar tiendas del tenant; los demás usuarios necesitan `tec_users.store_id` asignado. La primera versión no interpreta `tec_user_store_access`. El inventario por tienda admite unidades enteras porque `tec_product_store_qty.quantity` es `INTEGER`; productos fraccionarios no se pueden cerrar en tienda hasta definir una regla compatible con ese campo. La app revalida precios, tenant y stock en el servidor dentro de una transacción. `total` guarda el subtotal antes del impuesto y `grand_total` incluye el porcentaje exclusivo de `tec_products.tax`.

Las políticas y grants de Supabase no se modifican; RLS no reemplaza los filtros tenant del backend.

## Interfaz y navegación

El frontend usa React Router con un shell de 13 secciones. Los cajeros (`staff`) ven Punto de venta, Dashboard, Ventas y Cierre de caja; el grupo `admin` ve además Productos, Inventario, Clientes, Proveedores, Compras, Reportes, Gastos, Usuarios y Configuración.

Módulos operativos: POS con impresión de ticket de 58 mm, Dashboard, historial de ventas, productos (crear/editar/ajustar stock), inventario (lectura), clientes (crear/editar), proveedores (crear/editar), compras (registro con actualización de stock y costo; cantidades enteras), cierre de caja (apertura, resumen por forma de pago y cierre con arqueo), gastos (crear/editar), reportes (resumen diario y productos más vendidos), usuarios (lectura) y configuración (lectura).

Antes del primer uso de proveedores, compras o caja, verificar en la base viva las columnas de `tec_suppliers`, `tec_purchases`, `tec_purchase_items` y `tec_registers` (incluido `tenant_id`). No se aplica DDL.

Endpoints de gestión (solo admin): `GET/POST /api/products`, `PUT /api/products/:id`, `PUT /api/products/:id/stock`, `POST /api/products/:id/images/:slot`, `DELETE /api/products/:id/images/:slot`, `GET/POST/PUT /api/customers`, `GET/POST/PUT /api/expenses`, `GET/POST/PUT /api/suppliers`, `GET /api/purchases?from&to`, `GET /api/purchases/:id`, `POST /api/purchases`, `GET /api/reports/summary`, `GET /api/reports/top-products`, `GET/POST /api/users`, `PUT /api/users/:id`, `PATCH /api/users/:id/active`, `DELETE /api/users/:id` (baja lógica). Caja (admin y staff): `GET /api/registers`, `GET /api/registers/current`, `GET /api/registers/summary`, `POST /api/registers/open`, `POST /api/registers/:id/close`.

La gestión de usuarios crea/edita cuentas en `tec_users`, asigna el grupo `tec_groups` según el rol (admin/staff), exige tienda a los cajeros y desactiva (no borra) usuarios. El hash de contraseñas nuevas depende de `USER_PASSWORD_METHOD`: por defecto `sha1` para que el POS anterior siga pudiendo iniciar sesión; cambiar a `bcrypt` solo después del cutover. Nunca se exponen hashes al cliente. No se puede desactivar la propia cuenta ni el último administrador activo del tenant.

Las imágenes de producto (`tec_products.image`, `image_2`, `image_3`) pueden guardar una URL completa (Supabase Storage) o un nombre de archivo legacy. La API respeta la URL completa tal cual; para nombres legacy arma `/uploads/thumbs/<archivo>` con fallback a `/uploads/<archivo>` y un placeholder si no existen. El Compose de despliegue monta `LEGACY_UPLOADS_PATH` (por defecto `/home/ubuntu/pos-gres/uploads`) como solo lectura en el contenedor web; ese montaje solo aplica si usas nombres legacy.

En la edición de producto hay una galería de 3 ranuras: subir, cambiar o eliminar imágenes (JPG/PNG/WEBP, máximo 2 MB). La API sube al bucket `SUPABASE_PRODUCT_BUCKET` (default `productos`) con la service role, guarda la URL pública construida con `SUPABASE_PUBLIC_URL` y borra el archivo anterior cuando pertenece al bucket. El navegador nunca habla directo con Supabase.
