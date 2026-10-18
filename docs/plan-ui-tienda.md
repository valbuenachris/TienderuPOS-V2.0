# Plan: Rediseño UI de la tienda tienderu.com (v0.9.0 → v0.9.4)

Estado: **ejecutado** (v0.9.0–v0.9.4; verificado con build + screenshots desktop/móvil contra API mock). Fecha: 2026-10-18.
Alcance: **solo la tienda `store/`** (tienderu.com). El POS web (`web/`) queda intacto en este plan.

## Decisiones confirmadas por el usuario
- **Alcance**: solo la tienda pública; el POS no se toca.
- **Estilos**: migrar el store a **Tailwind CSS v4** (plugin oficial `@tailwindcss/vite`; tokens en `@theme`, sin `tailwind.config.js`).
- **Sin dependencias nuevas** de iconos/fuentes: iconos propios **SVG inline** (sin librería) y **tipografía del sistema** (stack actual). La única dependencia nueva es Tailwind (autorizada con la decisión anterior).
- **Rediseño total del layout** del store, **sin perder funcionalidad**: rutas, contrato API (`/api/marketplace/*`), carrito en localStorage, auth, checkout Bold y flujo post-pago quedan iguales.

## Objetivo
Tienda tienderu.com con nivel profesional tipo Amazon: jerarquía visual clara, componentes consistentes, denso en desktop y cómodo en móvil, accesible (WCAG AA) y rápida.

## Fases

### Fase 1 — Fundación Tailwind (v0.9.0)
- `npm install tailwindcss @tailwindcss/vite` en `store/`; plugin en `vite.config.ts`; `@import "tailwindcss";` en el CSS.
- `@theme` con los tokens del store (los actuales pasan a variables): paleta (navy `#131921`/`#232f3e`, naranja `#febd69`/`#f3a847`, link `#007185`, precio `#b12704`, fondo `#eaeded`, verde `#067d62`, texto/muted), escala tipográfica, radios, sombras, contenedores.
- Capa base mínima: `body`, `:focus-visible`, `prefers-reduced-motion`, scrollbars.
- `styles.css` se reduce a la capa base + tokens; el resto se migra por página en las fases siguientes.
- Verificación: `npm --workspace store run build` limpio.

### Fase 2 — Sistema de componentes propio (v0.9.1)
- En `store/src/components/ui/`: `Icon` (set SVG inline: search, cart, user, star, heart, truck, shield, chevron, menu, trash, plus/minus…), `Button`, `Input`, `Badge`, `Card`, `Skeleton`, `EmptyState`, `Pagination`, `Dialog`/`Sheet` (móvil), `Toast` mínimo.
- Reglas de accesibilidad: `aria-label` en icon-only, labels asociados, foco visible, targets ≥ 44 px en móvil.
- `RatingStars` y `ProductCard` reescritos con las utilidades nuevas.
- Verificación: build + navegación visual de Home/Producto.

### Fase 3 — Shell y navegación (v0.9.2)
- Header sticky: logo, buscador protagonista con sugerencias, cuenta, carrito con contador; franja de categorías; **drawer móvil** + **bottom nav** móvil (Inicio, Buscar, Carrito, Pedidos).
- Footer rediseñado (columnas útiles, contacto, sellos de confianza: pago Bold, envío, vendedores locales).
- Layout responsive consistente (`max-w-7xl`, gutters).

### Fase 4 — Páginas rediseñadas (v0.9.2/v0.9.3)
- **Home**: hero con carrusel de banners, tiles de categorías, rieles "Mejor calificados" y "Recién llegados", sección de vendedores.
- **Buscar**: filtros en sidebar (desktop) / drawer (móvil), chips de filtros activos, orden, paginación; skeletons.
- **Producto**: galería con miniaturas, buy box sticky (cantidad, agregar/comprar), stock, vendedor, reseñas con promedio, relacionados.
- **Carrito**: agrupado por vendedor, edición de cantidades, resumen sticky.
- **Checkout**: flujo por pasos (dirección → pago), resumen sticky, estados de error claros.
- **Auth / Cuenta / Pedidos / Detalle de pedido / Vendedor**: misma gramática visual; seguimiento por sub-orden legible.

### Fase 5 — Calidad y despliegue (v0.9.4)
- Responsive 360 / 768 / 1280; contraste AA; navegación por teclado.
- Performance: `React.lazy` por ruta en `App.tsx` (code splitting), `loading="lazy"` en imágenes, memo en listas; CSS final menor que el actual.
- QA manual de flujos completos contra el API real: registro → búsqueda → carrito → checkout Bold → pedidos; revisar también tienda vacía y errores de red.
- Despliegue estándar del contenedor `pos-gres-v2-store` (`IMAGE_TAG`), NPM sin cambios.

## Guardrails (no romper)
- No tocar `store/src/api.ts`, `cart.tsx`, `auth.tsx` ni las rutas/contratos del API.
- No tocar el POS (`web/`) ni el contenedor/URLs existentes.
- Textos en español, montos con `formatMoney`, imágenes con URL resuelta por el API.
- El checkout sigue siendo Bold exclusivamente (fase 2 del marketplace), callback `https://tienderu.com/pedidos`.

## Calidad (quality gates de la skill react-nextjs-development, adaptados a Vite)
- [x] TypeScript compila sin errores (`tsc --noEmit`).
- [x] Build limpio de `store/` (main 234 kB con rutas en chunks de 2–8 kB).
- [x] WCAG 2.1 AA básico (contraste de tokens, labels/aria, foco visible, teclado, `prefers-reduced-motion`).
- [x] Responsive verificado con capturas reales (1366×900 y 390×844: drawer móvil y bottom nav).
- [ ] Flujo de compra completo probado en producción de prueba (pendiente del usuario tras el deploy).

## Resultado
- Reescritura completa del store: shell (header con sugerencias, drawer, bottom nav, footer), componentes propios (Icon SVG, Button, Input, Badge, Dialog, Toast, Rating SVG, Skeleton, EmptyState, Pagination), páginas (Home, Buscar, Producto, Carrito, Checkout, Auth, Cuenta, Pedidos, Detalle, Vendedor) y `React.lazy` por ruta.
- Estrellas migradas de glifo de fuente a **SVG** (independiente de la fuente del sistema).

## Riesgos
- "Rediseño total" implica reescribir ~1.400 líneas de CSS y ~15 componentes → mitigación por fases con build y revisión visual en cada una.
- Tailwind v4 exige navegadores modernos (el público objetivo de tienderu.com ya lo cumple).
- Los iconos SVG propios requieren disciplina para mantener el set pequeño y consistente.
