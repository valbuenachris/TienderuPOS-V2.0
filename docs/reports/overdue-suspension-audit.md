# Informe: morosidad y suspensión de servicio (auditoría)

Fecha: 2026-10 · Versión auditada: v0.3.46 · Alcance: API NestJS + web React (POS multi-tenant)

## Resumen ejecutivo

Hoy **no existe un ciclo automático de morosidad**: pasar la fecha de cobro no cambia el estado de la
suscripción (salvo un caso muy concreto), no bloquea el POS y no avisa al tenant. La única forma de
cortar el servicio es la **suspensión manual** del super admin, y su efecto es indirecto: desactiva el
**tenant** (`tec_tenants.status='inactive'`), lo que impide nuevos logins, pero no corta sesiones vivas
ni operaciones ya autenticadas. Reactivar = pagar (webhook/verificación) o el botón del super admin.

## A. ¿Qué pasa cuando pasa `next_billing_date` sin pago?

- **NO** hay cambio automático a `expired`/`suspended` por `next_billing_date`. Ese campo solo se usa
  para mostrar "Renueva …/vencido hace N" y para el contador de vencidos del dashboard
  (`dashboard.service.ts`: `COALESCE(next_billing_date, subscription_end_date) < today`).
- El único job periódico es `TenantManagementService.refreshLifecycleStatuses()`
  (`tenant-management.service.ts:277`), que corre **al arrancar y cada 6 h** y solo:
  1. `trial` → `expired` si `trial_end_date < hoy` y nunca inició suscripción.
  2. `active` → `expired` si **`auto_renew = false`** y `subscription_end_date < hoy`.
- Como los planes nuevos/backfill nacen con **`auto_renew = true`** (`applyCompletedPayment`,
  bootstrap y `recordPayment`), una suscripción impaga con auto-renovación **nunca expira sola**.
- No se actualiza "al acceder": no hay comprobación perezosa en guards/servicios de negocio.

## B. Restricciones aplicadas a un tenant moroso/suspendido

| Estado | ¿Login? | POS / crear ventas | Reportes/inventario | Renovar |
|---|---|---|---|---|
| `trial` vencido (`expired`) | Sí (tenant activo) | **Sí, sin límite** | Sí | Sí (pagar) |
| `active` con cobro vencido | Sí | **Sí, sin límite** | Sí | Sí |
| `suspended` (solo manual) | **Bloqueado** (tenant `inactive`, `auth.service.ts:94`) | Sesiones vivas siguen hasta expirar el token (8 h); tras eso no entra | Igual que POS | Sí |
| `expired` por auto_renew=false | Sí | **Sí, sin límite** | Sí | Sí |
| Tenant `deleted` | Bloqueado | No | No | N/A |

- Ningún guard/service de POS, ventas, productos, reportes o settings consulta
  `tec_tenant_subscriptions` (solo `tenant-management`, `billing` y `dashboard` lo hacen).
- **No hay periodo de gracia ni recargo por mora.**
- La suspensión manual (`POST /api/tenant-management/tenants/:id/suspend`) sí desactiva el tenant y
  marca la suscripción `suspended` en transacción; reactivar restaura ambos. Un usuario ya logueado
  **conserva su token** hasta su expiración porque `TenantContextGuard` no valida el estado del tenant.

## C. Feedback al tenant

- **Solo en `/config` → pestaña Facturación**: alerta roja si `overdue`, aviso de trial y próxima
  renovación; nada más.
- **No hay banner global** (AppLayout) ni modal al iniciar sesión por mora/suspensión (el login
  bloqueado devuelve "El tenant está inactivo o suspendido", pero sin detalle de facturación).
- **No hay servicio de email/SMS** en la API (SMTP existe solo como campos legacy de `tec_settings`).

## D. Reactivación tras pago tardío

- `applyCompletedPayment()` fija `subscription_start_date = COALESCE(actual, fecha_pago)`,
  `subscription_end_date = next_billing_date = fecha_pago + 1 mes/año`. Es decir, **el ciclo nuevo
  corre desde la fecha de pago**, no desde la fecha original de vencimiento; los días de mora no se
  cobran ni se descuentan (sin prorrateo, sin backdating, sin recargo).
- Se activa `status='active'` automáticamente por webhook Bold (`source: bold_webhook`), por la
  verificación al volver (`bold_verify`) o por confirmación manual (`manual`).

## Gaps (checklist)

- [ ] Job diario de morosidad dedicado (hoy solo el refresh cada 6 h y con `auto_renew` como condición).
- [ ] Guard/middleware que bloquee POS/ventas para suscripción vencida/suspendida (hoy no existe).
- [ ] Modo solo-lectura para paneles admin durante suspensión (hoy no existe).
- [ ] Periodo de gracia configurable (p. ej. 3 días).
- [ ] Email/SMS de recordatorio y de mora (no hay servicio).
- [ ] Banner global + aviso claro en login/config (hoy solo alerta en Facturación).
- [ ] Cierre de sesiones vivas al suspender (hoy el token sobrevive hasta 8 h).

## Plan de implementación propuesto

### 1. Job diario de morosidad (M)
- **Enfoque**: en `TenantManagementService`, un `refreshOverdueStatuses()` idempotente (SQL) que marque
  `expired` cuando `next_billing_date < hoy - gracia` **independientemente de `auto_renew`**, y
  `suspended` + tenant `inactive` cuando `next_billing_date < hoy - gracia - corte` (o directamente
  `expired` y que el bloqueo sea por estado). Mantener la misma cadencia (arranque + cada 6 h) o pasar
  a `@nestjs/schedule` diario.
- **DDL**: ninguno si la gracia es variable de entorno (`BILLING_GRACE_DAYS`, default 3).
- **Riesgo**: expirará tenants reales al desplegar; requiere `BILLING_AUTO_SUSPEND=false` por defecto
  y activar por decisión de negocio.

### 2. Bloqueo de POS/ventas por suscripción (S-M)
- **Enfoque**: helper `assertTenantOperational(tenantId)` en un guard/interceptor tenant-scoped que
  consulte el estado de la última suscripción (cache 60 s) y devuelva **402 Payment Required** si
  `suspended`/`expired`; aplicar a `POST /api/sales`, `POST /api/sales/:id/payments`,
  `PUT/DELETE /api/sales/:id`. Alternativa más simple: bloquear a nivel de `TenantContextGuard`.
- **DDL**: ninguno.
- **Frontend**: POS muestra aviso y deshabilita "Registrar venta" si `billing` reporta bloqueo.

### 3. Solo lectura en suspensión (S)
- **Enfoque**: el mismo guard con alcance `admin-readonly`: permitir GET de reportes/inventario/ventas
  y bloquear POST/PUT/DELETE (excepto `/billing/*` y `/auth/*`). Se decide por método HTTP.
- **DDL**: ninguno.

### 4. Periodo de gracia (S)
- **Enfoque**: `BILLING_GRACE_DAYS` + cálculo en SQL (`next_billing_date + gracia < hoy`). Mostrar
  "en gracia hasta X" en la UI de facturación.
- **DDL opcional** (si se quiere fecha persistida): `grace_period_end_date date` en
  `tec_tenant_subscriptions` (excepción DDL a aprobar).

### 5. Notificaciones por email (M-L)
- **Enfoque**: reutilizar los campos SMTP legacy de `tec_settings` (hoy ocultos) con un
  `MailService` (nodemailer) y plantillas "por vencer (7 días)", "vencida", "suspendida",
  "pago confirmado"; cola simple en el job diario con tabla de log o `tec_tenant_activity_logs`.
- **DDL**: ninguna si se registra en activity logs; `nodemailer` es dependencia nueva.

### 6. Banner global y aviso de login (S)
- **Enfoque**: incluir `billing_status` en `/api/auth/me` (o `/settings/pos`) y renderizar
  `SuspensionBanner` en `AppLayout` + aviso en `LoginPage` cuando el login falle por tenant inactivo
  (hoy el mensaje ya dice "inactivo o suspendido"; se puede enriquecer con el motivo).
- **DDL**: ninguno.

### 7. Cerrar sesiones vivas al suspender (S)
- **Enfoque**: en `suspendTenant`, además del estado, `DELETE FROM tec_sessions WHERE tenant_id=$1`
  (tabla ya usada por auth). Invalida tokens inmediatamente.
- **DDL**: ninguno.

## Prioridad sugerida

1. **Job de morosidad parametrizable + corte** (define el negocio).
2. **Bloqueo de POS/ventas** (evita operar sin pagar).
3. **Cierre de sesiones al suspender** (efecto inmediato real).
4. **Banner/aviso** (UX de cobranza).
5. **Email** (cuando exista proveedor; es el de mayor esfuerzo).

## Testing propuesto (cuando se implemente)

- [ ] Con `BILLING_GRACE_DAYS=3` y una suscripción vencida hace 4 días: el job la marca y el POS
      devuelve 402 al crear venta; GET de reportes sigue disponible.
- [ ] Suspendido: login bloqueado, banner visible, sesiones previas invalidadas.
- [ ] Pago (Bold webhook / verificación / manual) reactiva al instante y el POS vuelve a operar.
- [ ] Job idempotente: dos ejecuciones no duplican cambios ni logs.
- [ ] `auto_renew=true` ya no exime de la morosidad cuando el corte está habilitado.
