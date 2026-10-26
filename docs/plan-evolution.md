# Plan · Migración de Evolution API al VPS propio

Estado: **Completada** — fix desplegado en producción (`v0.12.4`), instancia del tenant de prueba
reconectada (`open`) y bot respondiendo. Marketplace sin configurar (opcional; no había fila previa).

## Contexto

El POS (`pos-gres-v2`) hablaba con una instancia de Evolution API alojada en un VPS externo
(`https://evoapi.grupoempresarialroma.com` → 15.204.88.252, hoy **muerto**: 443 rechaza conexiones).
Evolution ahora vive en este mismo VPS y ya está publicado con SSL en
**`https://evolution.tienderu.com`** (Evolution API **v2.3.7**, proxy de Nginx Proxy Manager →
`evolution_api:8080`; verificado: welcome JSON 200, `/instance/fetchInstances` 401 sin key, `/manager/` OK).

Puntos de cableado (solo configuración; la key vive únicamente en el `.env` del API):

- `api/src/whatsapp/evolution.client.ts` lee `EVOLUTION_API_URL` y `EVOLUTION_API_KEY` (nunca se loggea ni llega al navegador).
- Los webhooks se registran contra `PUBLIC_API_URL` (`whatsapp.service.ts`, `marketplace-whatsapp.service.ts`).
- Instancias: por tenant `pos-<slug>-<id8>` en `tec_tenant_whatsapp_settings`; única de plataforma
  `tienderu-marketplace` en `tec_marketplace_whatsapp`. CRM y notificaciones del marketplace reutilizan el mismo cliente.

Problema de re-aprovisionamiento: al perder el servidor viejo, las instancias ya no existen pero las
filas en la DB sí. Con el código anterior la UI ocultaba "Crear instancia" (`status !== 'none'`) y
"Conectar" fallaba con 404 ("La instancia no existe en Evolution; créala primero"); `createInstance`
con fila existente retornaba sin crear nada. Los tenants quedaban atascados.

## Fase 1 — Cambios en el repo (completada)

- [x] `evolution.client.ts`: nuevo `ensureInstance(instanceName)` → consulta `connectionState`; si la
      instancia no existe (`null`/404) llama a `createInstance` (idempotente ante 409). Devuelve si la recreó.
- [x] `whatsapp.service.ts` `connect()`: `ensureInstance` antes de `connect` (rompe el bloqueo fila-existe /
      instancia-ausente y auto-sana futuros cambios de servidor).
- [x] `marketplace-whatsapp.service.ts` `connect()`: mismo cambio.
- [x] `settingsView()` de ambos servicios: si `connectionState` devuelve `null` para una fila existente,
      persistir `status='close'` (evita el badge "Conectado" obsoleto tras la migración). El estado
      `none` solo aplica cuando no hay fila.
- [x] `.env.example`: `EVOLUTION_API_URL=https://evolution.tienderu.com` (antes apuntaba al VPS muerto).
- [x] `.gitignore`: se agrega `.env.test`.
- [x] Nueva spec `api/src/whatsapp/evolution.client.spec.ts` (recrea en 404, no recrea si existe, tolera 409)
      registrada en el script `test` de `api/package.json`.
- [x] Verificación: `npm --workspace api run build` + `npm --workspace api test` → **55/55 tests OK**.

Smoke test EN VIVO contra `https://evolution.tienderu.com` (v2.3.7) con la key real:

- Inventario: solo existe `mi_empresa` (status `open`); **ningún** `pos-*` ni `tienderu-marketplace`
  → todos los tenants con fila necesitarán el flujo de recreación (que ahora resuelve el fix).
- `connectionState('pos-smoketest-…')` → `null` (404) ✔
- `ensureInstance` 1ª vez → `true` (creada); 2ª vez → `false` (no recrea) ✔
- `connect` → QR real (`data:image/png;base64,…`) y estado `connecting` ✔
- Limpieza: `DELETE /instance/delete/<prueba>` → 200 ✔

Credenciales: el `.env` de producción ya traía la **misma** `EVOLUTION_API_KEY` (coincide con el
Evolution nuevo) y su propio `EVOLUTION_WEBHOOK_TOKEN`; el `.env` local (untracked, gitignored) se
alineó a los mismos valores. Ver Fase 3.

## Fase 2 — Contenedor de pruebas en este VPS (opcional, omitida)

> Decisión: se publica a GitHub y se valida directamente en el VPS de despliegue con el pull (los pasos
> de abajo quedan documentados por si más adelante se quiere probar en este host, donde no hay acceso
> a Docker ni a la DB desde el workspace de opencode).

1. **Llevar el código al host.** Opción patch:
   `git apply /ruta/evolution-migration.patch` sobre una copia del repo en el host
   (o `rsync`/`scp` de los archivos modificados). El patch incluye este doc, el fix y la spec.
2. **Directorio de prueba dedicado** (para no pisar el `.env` del repo):
   `mkdir -p /opt/pos-evolution-test && cd /opt/pos-evolution-test` + copia del repo + `git apply`.
3. **`.env` del test** (compose usa `env_file: .env`, por eso se llama así, no `.env.test`) —
   mismas DB/JWT/Supabase que producción o un staging, y:
   ```
   EVOLUTION_API_URL=https://evolution.tienderu.com
   EVOLUTION_API_KEY=<la del .env local>
   EVOLUTION_WEBHOOK_TOKEN=<el generado en el .env local>
   PUBLIC_API_URL=https://pos.tienderu.com
   IMAGE_TAG=v0.12.2-test
   WEB_PORT=8090          # evita chocar con el 8080 si algo ya lo usa
   ```
   Verificar que las redes externas existan en este host:
   `docker network ls | grep -E 'npm_net|supabase_default'`
   y que no haya contenedores `pos-gres-v2-*` corriendo aquí (`docker ps -a`).
4. **Build y arranque**:
   ```
   IMAGE_TAG=v0.12.2-test docker compose -f docker-compose.build.yml build api web
   IMAGE_TAG=v0.12.2-test docker compose up -d api web
   ```
5. **Pruebas** (la web publica el API en `/api`, puerto `WEB_PORT`):
   - `curl -s http://127.0.0.1:8090/api/health` → `{"status":"ok"}`
   - Login admin de un tenant → token.
   - `GET /api/whatsapp/settings` → `configured: true`, `status: close` (ya no `open` obsoleto).
   - `POST /api/whatsapp/connect` → **debe crear la instancia y devolver QR** (antes: 404).
   - Escanear QR → `GET /api/whatsapp/status` → `open`.
   - Marketplace (super admin): `POST /api/marketplace/admin/whatsapp/connect` + QR.
   - Opcional bot: activar agente → verifica webhook registrado y respuesta automática
     (requiere que Evolution alcance `PUBLIC_API_URL`; si se quiere aislar, crear antes un proxy NPM
     de prueba, p. ej. `test-pos.tienderu.com`, y usarlo como `PUBLIC_API_URL`).

## Fase 3 — Publicar y desplegar

- [x] Commit + push a GitHub (`b68cd68`); el VPS de despliegue lo bajó con `git pull`.
- [x] Reconocimiento del VPS de despliegue (`vps-64dab15e`, Supabase local en `supabase-db`):
      producción corría `v0.12.3` (imagen del 19-oct, **sin** el fix — las etiquetas `v0.12.2`/`v0.12.3`
      de Docker Hub son viejas); migraciones ya aplicadas (`tec_tenant_whatsapp_settings`,
      `tec_whatsapp_conversations`, `tec_marketplace_whatsapp`); el `.env` ya tenía la misma
      `EVOLUTION_API_KEY` y un `EVOLUTION_WEBHOOK_TOKEN` propio → solo cambia `EVOLUTION_API_URL`.
      Estado DB: **1** tenant con instancia (`pos-prueba-pos-33a557f2`, `agent_enabled=t`, status
      `open` obsoleto) y **0** filas de marketplace.
- [x] Build `v0.12.4` en el VPS (`IMAGE_TAG=v0.12.4 docker compose -f docker-compose.build.yml build --pull`)
      y `IMAGE_TAG=v0.12.4 docker compose up -d`.
- [x] Tenant de prueba: `/whatsapp` → "Conectar" recreó la instancia y mostró el QR (antes: 404) →
      escaneado (número `573114357068`) → estado `open` → bot guardado: webhook registrado y
      **el bot está respondiendo**. Verificación final desde el workspace contra la API de Evolution:
      `connectionState` = `open`; `webhook/find` = habilitado con `MESSAGES_UPSERT` +
      `CONNECTION_UPDATE` y la URL `https://pos.tienderu.com/api/webhooks/evolution/<instancia>?token=…`.
- [ ] Marketplace (opcional): no hay fila previa; al activar su WhatsApp la pestaña del super admin
      crea la instancia `tienderu-marketplace` normalmente.

## Riesgos / notas

- **No rotar `AUTHENTICATION_API_KEY`**: el servidor Evolution lo comparte educol.
- Las sesiones de WhatsApp del VPS muerto no se migran: cada tenant escanea QR una vez.
- Sin DDL: solo configuración, creación/reconexión de instancias y `status` de filas existentes.
- El `EVOLUTION_WEBHOOK_TOKEN` de producción ya existía y se conserva (el `.env` local se alineó al
  mismo valor); los webhooks se re-registran al reconectar/guardar el bot.
