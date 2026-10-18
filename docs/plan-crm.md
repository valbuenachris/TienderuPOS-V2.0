# Plan: CRM de ventas para tenants — v0.7.0 / v0.7.1 / v0.7.2

Estado: **v0.7.0 (API) y v0.7.1 (UI) ejecutados**; v0.7.2 (IA del CRM) pendiente. Fecha: 2026-10-18.

## Decisiones confirmadas por el usuario
- **CRM solo admin del tenant** en MVP (staff = fase futura con scope de tienda).
- **DDL aprobada**: `tec_crm_leads`, `tec_crm_activities`, `tec_crm_templates`, `tec_crm_automations`.
- **Automatizaciones MVP = 4**: bienvenida (new_lead), reactivación (inactive_customer), recordatorio de pago (due_order), post-venta (post_sale).
- **Guardrails default**: ventana 8:00–19:00 (tz del tenant), 50 automatizados/día/tienda, 1 por cliente/día, **opt-out** por palabra clave.
- **Responder desde el CRM pausa el bot** en ese chat (estado `human`, auto-retorno 15 min ya existente v0.6.6).
- Plan guardado en `docs/plan-crm.md`.

## Arquitectura (reutiliza lo existente)
- Clientes reales: `tec_customers` + ventas/puntos/deuda por lead vinculado.
- WhatsApp: instancia por tenant (`EvolutionClient.sendText`), hilo desde `tec_whatsapp_messages/conversations`; mensaje manual inserta `out` + pausa bot.
- Runner de automatizaciones con `setInterval` (patrón tenant-management), plantillas `{{variable}}`, actividad `[auto:<trigger>]` en el timeline como registro/dedup.

## API (`api/src/crm/`, v0.7.0) — admin-only
- Leads: lista (filtros etapa/búsqueda/dueño/seguimiento vencido, paginado), crear, detalle (lead + timeline + cliente vinculado con puntos/última compra/deuda + ventas recientes + hilo WhatsApp), actualizar (etapa/score/owner/opt-out).
- Actividades/tareas: crear (nota/llamada/tarea con `due_at`), completar.
- Mensaje manual (`POST /crm/leads/:id/message`): envía por la instancia del tenant, registra `out`, pausa el bot (`human`); error claro si no hay instancia conectada.
- Plantillas y automatizaciones: CRUD. Resumen para KPIs (`GET /crm/summary`).
- Hooks best-effort (SQL directo, sin acoplamientos): al atender por WhatsApp se crea/actualiza el lead (`whatsapp`, stage `new`); al detectar opt-out en el texto entrante se marca `opt_out`.
- Runner (cada 15 min): guardrails de horario/límite diario/conexión; sincroniza ventas pagadas → actividad + etapa `won` + score.

## Score por reglas
+15 respondió por WhatsApp · +20 primera compra pagada · +10 compra últimos 30 días · +10 pedido Debida · +5 tiene puntos · −20 sin actividad 60 días · ajuste manual.

## UI (v0.7.1, `/crm`, AdminOnly, nav 🎯)
Pipeline Kanban (drag & drop nativo), lista con filtros, detalle con hilo WhatsApp embebido + responder, timeline, tareas, etapa/score/opt-out, plantillas, automatizaciones y KPIs. Recetas de `frontend-ui`.

## v0.7.2 (pendiente)
Asistente IA en el CRM: "Resumir conversación + siguiente acción" y "Redactar con IA" (tono/nombre del agente).
