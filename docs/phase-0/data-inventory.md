# Inventario anonimizado de producción

Snapshot UTC: `2026-09-13T21:07:19Z`.

Este inventario contiene solamente conteos; no incluye nombres, identificadores,
contraseñas, teléfonos, documentos ni direcciones.

| Entidad | Conteo |
|---|---:|
| Usuarios totales | 112 |
| Administradores | 1 |
| Programadores de rutas | 1 |
| Gerentes de Operaciones | 1 |
| Clientes | 1 |
| Conductores | 108 |
| Usuarios explícitamente activos | 111 |
| Unidades de flota | 108 |
| Rutas actuales | 193 |
| Pasajeros en rutas actuales | 2,645 |
| Rutas sin asignar | 85 |
| Pasajeros sin asignar | 1,963 |
| Resúmenes de ruta | 193 |
| Registros de historial | 0 |
| Notificaciones persistidas | 86 |
| Objetos en Storage `evidencias` | 0 |

## Observaciones de línea base

- Un usuario no tiene un valor explícito de `estado`; el backend lo interpreta
  como activo mediante sus valores por defecto.
- El 74.2% de los pasajeros del tablero actual está en rutas `SIN ASIGNAR`. Este
  dato se registra como comportamiento operativo actual y deberá analizarse en
  la fase del motor de ruteo; no se corrige durante la fase 0.
- La cantidad de rutas y el resumen gerencial coinciden (193).
