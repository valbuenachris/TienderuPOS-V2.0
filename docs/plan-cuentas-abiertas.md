# Plan: sección "Cuentas abiertas" en el POS

Estado: **ejecutado completo** (v0.3.93 backend, v0.3.94 página + abrir cuenta, v0.3.95 modo append). Fecha: 2026-10-18.

## Concepto

Cuenta abierta = venta existente con `status='due'`/`'partial'` + **etiqueta libre** en `customer_name` (ej. "Mesa 5"). Se abre con productos, se pueden **agregar productos** después (staff y admin), y al final se **cobra** (total o parcial) con el flujo de pagos existente. La facturación normal del POS no cambia.

Decisiones confirmadas por el usuario:
- Cuentas abiertas disponibles para **staff y admin**.
- El **cajero puede agregar productos** a la cuenta.
- **Etiqueta libre en `customer_name`** (sin DDL).

## Cambios por capa

### API (v0.3.93) — `api/src/sales/`
1. `sale.dto.ts`: `CreateSaleDto.customer_name?: string` (≤80 chars, trim; se ignora si viene `customer_id`); nuevo `AppendSaleItemsDto` (`items: [{ product_id, quantity }]`, 1..100, enteros ≥1).
2. `sales.service.ts`:
   - `create()`: `customer_name = input.customer_name ?? customer?.name ?? 'Cliente ocasional'`.
   - `list()`: parámetro `status` (CSV whitelist `paid|partial|due`) aplicado en ambas ramas (con/sin fechas), respetando el scope de tienda.
   - `appendItems(tenantId, user, saleId, dto)`: transacción con `FOR UPDATE`; solo ventas `due|partial` de la tienda del cajero; stock con `UPDATE ... WHERE quantity >= n`; líneas con **precio actual**; **reaplica el descuento guardado** (`order_discount_id`, percent recalculado / fijo topado); recalcula `total/grand_total/tax/product_tax/order_tax/rounding`; recomputa `status` desde `paid`; **delta de puntos** si la venta ya estaba `partial` (misma lógica `creditedNew−creditedOld` de `update()`); actualiza `total_reward_points`.
3. `sales.controller.ts`: `@Post(':id/items')` + `@Query('status')` en el listado.

### Web — POS (v0.3.94/95)
4. `PosPage.tsx`: botón **"Abrir cuenta"** (staff y admin) → modal de etiqueta (Mesa/Nombre) → `POST /sales` sin pago (status `due`) → aviso con enlace a la sección. Modo **append** vía `?cuenta=<id>`: carga ítems al ticket con banner "Cuenta abierta: {etiqueta}"; al guardar envía **solo el diff** a `POST /sales/:id/items`; no se permite bajar cantidades de líneas guardadas.
5. Nueva página **`/cuentas-abiertas`** (`OpenAccountsPage.tsx`, sidebar 🧾, staff+admin): `GET /sales?status=due,partial` + búsqueda por etiqueta (filtro `customer` existente); tabla con Cuenta/Abierta/Artículos/Total/Pagado/**Pendiente**/badge y acciones **Cobrar** (`AddPaymentModal`), **Ver**, **Agregar productos** (→ POS append), **Ticket** cuando queda pagada.
6. `api.ts`/`pos-queries.ts`: `fetchSales` con `status`, `appendSaleItems`, `useOpenAccountsQuery`.

## Casos borde
- Facturación normal intacta; descuentos conservados al agregar; stock y puntos en transacción; venta pagada rechaza append (400); cuenta eliminable por admin desde Historial (restaura stock); suspensión por mora intacta (guard 402); scope por tienda para staff.

## Fases / versiones
- **v0.3.93**: backend (etiqueta, filtro status, append) + build/tests.
- **v0.3.94**: página Cuentas abiertas + "Abrir cuenta" en POS.
- **v0.3.95**: modo append ("Agregar productos").
- **Futuro**: pre-cuenta imprimible, reparto de cuenta, mover mesas, app Flutter.

## Verificación
- API: build + tests. E2E manual: abrir "Mesa 5" → vender normal en paralelo → agregar producto → pago parcial → cobrar resto → verificar stock, puntos y ticket "Pagada".
- Web: typecheck + build; probar en tema claro/oscuro con staff y admin.
