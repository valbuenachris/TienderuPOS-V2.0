---
name: nestjs-react-supabase-readonly
description: Fullstack NestJS and React development with strict Read-Only Supabase PostgreSQL constraints. Focus on TypeScript best practices, NestJS architecture, TanStack Query, and strict no-DDL database policies.
license: MIT
compatibility: opencode
metadata:
  stack: typescript-nestjs-react-supabase
  mode: fullstack-readonly-db
---

# 🧠 Skill: Fullstack NestJS + React + Supabase (Read-Only DB)

## 🚨 REGLA DE ORO: BASE DE DATOS READ-ONLY (ESTRICTO) 🚨
La base de datos PostgreSQL en Supabase es un sistema existente. 
ESTÁ TOTALMENTE PROHIBIDO realizar cualquier modificación estructural (DDL) o de seguridad:
1. NO generes, sugieras ni ejecutes comandos ALTER, CREATE, DROP, ni scripts de migraciones.
2. NO modifiques las políticas de RLS (Row Level Security) ni los índices.
3. NO sugieras herramientas de migración automática (ej. synchronize: true en TypeORM o prisma db push).
4. SOLO puedes escribir queries DML (SELECT, INSERT, UPDATE, DELETE) sobre tablas y columnas que YA EXISTEN.
5. Si para implementar una feature hace falta una columna o tabla que no existe, DETÉN la generación y pregunta: "¿Cómo deseas mapear esta entidad dado que el esquema es de solo lectura?".
6. Toda interacción con la BD debe usar los tipos de TypeScript generados (ej. database.types.ts).

## 🏗️ Mejores Prácticas de Backend (NestJS + Node.js + TS)
- Arquitectura Modular: Controllers solo para HTTP. Toda la lógica de negocio va en Services (@Injectable).
- Tipado Estricto: Prohibido el uso de any. Usa unknown con type-guards si la data es impredecible.
- DTOs: Obligatorios para endpoints POST y PUT. Usa class-validator y class-transformer.
- Inyección de Dependencias: Usa inyección por constructor.
- Manejo de Errores: Usa excepciones nativas de NestJS (BadRequestException, NotFoundException).

## 🎨 Mejores Prácticas de Frontend (React + TS)
- Componentes: Usa Componentes Funcionales con Hooks. Evita las clases.
- Estado de Servidor: Obligatorio usar TanStack Query (React Query) para fetching y caching. Prohibido usar useEffect con fetch/axios directamente para cargar datos.
- Separación: Separa la lógica de red (custom hooks) de los componentes de UI.
- Tipado de Props: Usa interfaces explícitas para todos los componentes.

## 🗄️ Integración con Supabase
- Utiliza el cliente oficial de @supabase/supabase-js.
- Aprovecha los filtros encadenables (.eq(), .in(), .order()) pero NUNCA uses métodos de gestión de tablas.
- Asegúrate de que la configuración de la conexión no intente sincronizar el esquema al arrancar.
