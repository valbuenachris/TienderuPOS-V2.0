# Despliegue — App segura Princess Skin (v0.13.0 OTP + aislamiento)

Runbook paso a paso. Ejecutar en el host que compila (o el servidor) y, al final, validar de
punta a punta el flujo por WhatsApp.

## 0. Prerrequisitos

- Docker y Docker Hub con login en el host de build.
- El servidor de despliegue con `docker-compose.yml` y `.env` reales (README.md).
- Acceso a la base de datos para ejecutar la migración aprobada (psql o SQL editor de Supabase).

## 1. Migración (ANTES de desplegar el build)

La migración es re-ejecutable (`ADD COLUMN IF NOT EXISTS`):

```sh
# Desde cualquier host con acceso a la DB, usando el DATABASE_URL del .env del servidor
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/migrations/v0.13.0-customer-token-version.sql
```

Alternativa: copiar el contenido de `docs/migrations/v0.13.0-customer-token-version.sql` al
SQL editor de Supabase y ejecutarlo.

Verificar:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'tec_customers' AND column_name = 'token_version';
```

## 2. Configurar la variable de aislamiento en el servidor

En el `.env` del servidor de despliegue añadir:

```sh
CUSTOMER_APP_TENANT_ID=ac344fcc-d3bf-4c0d-b8ab-135c985ce8df
```

Sin esta variable el OTP y el aislamiento quedan deshabilitados (comportamiento anterior).

## 3. Build y publicación de la imagen de la API

Usar una etiqueta nueva para no pisar la versión en producción:

```sh
cd /ruta/pos-gres-v2
export IMAGE_TAG=v0.13.0          # opcional: export DOCKERHUB_NAMESPACE si no es cvalbuena
docker login
docker compose -f docker-compose.build.yml build --pull
docker compose -f docker-compose.build.yml push
```

El build de la API ejecuta `npm run build` y `npm test` (guarda tus 79 pruebas).

## 4. Desplegar en el servidor

```sh
cd /ruta/al-copiar/compose   # donde está docker-compose.yml y .env
export IMAGE_TAG=v0.13.0      # mismo tag que publicaste (o ajustarlo en .env)
docker compose pull
docker compose up -d
docker compose ps
```

## 5. Verificación post-despliegue

Health:

```sh
docker compose exec api node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>console.log(r.status)).catch(e=>{console.error(e);process.exit(1)})"
```

Aislamiento del login (debe rechazar una cuenta de otro tenant):

```sh
curl -s -X POST https://pos.tienderu.com/api/auth/customer-login \
  -H 'Content-Type: application/json' \
  -d '{"identity":"usuario-de-otro-tenant@correo.com","password":"x"}' -w '\nHTTP %{http_code}\n'
```

El endpoint inseguro ahora debe responder 400 (aislamiento activo):

```sh
curl -s -X POST https://pos.tienderu.com/api/auth/customer-set-password \
  -H 'Content-Type: application/json' \
  -d '{"identity":"cliente@princessskin.com","new_password":"clave12345"}' -w '\nHTTP %{http_code}\n'
```

OTP — pedir el código (recibe el WhatsApp de un cliente real de prueba):

```sh
curl -s -X POST https://pos.tienderu.com/api/auth/customer-request-otp \
  -H 'Content-Type: application/json' \
  -d '{"identity":"<correo-o-teléfono-registrado>"}' -w '\nHTTP %{http_code}\n'
```

OTP — verificar e instalar contraseña (si se envía un código inválido debe dar 400 "Código incorrecto"):

```sh
curl -s -X POST https://pos.tienderu.com/api/auth/customer-verify-otp \
  -H 'Content-Type: application/json' \
  -d '{"identity":"<correo-o-teléfono>","code":"000000","new_password":"clave12345"}' -w '\nHTTP %{http_code}\n'
```

Login con la nueva contraseña → 200 y token. Repetir el login y confirmar token antiguo inválido
si se vuelve a restablecer la contraseña (invalidación por `token_version`).

## 6. Rollback

Si algo falla, volver a la etiqueta anterior en el `.env` del servidor (`IMAGE_TAG=...`) y
`docker compose pull && docker compose up -d`. Sin la variable `CUSTOMER_APP_TENANT_ID`, el
comportamiento cliente vuelve al anterior.