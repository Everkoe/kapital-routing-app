# Contratos API actuales

Fuente de verdad automática: `openapi-baseline.json`. Este documento resume el
uso actual; no implica que la autorización existente sea segura.

| Dominio | Métodos y rutas principales | Consumidor actual |
|---|---|---|
| Sesión | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/change-password` | Todos los roles |
| Perfil | `GET/PUT /api/user/profile` | Navbar, conductor y perfil |
| Usuarios | `GET /api/admin/users`, acciones bulk, approve, reject, deactivate, reactivate y permanent | Administración |
| Documentos | onboarding, review, notify, resubmit y solicitudes de cambio | Conductor y Administración |
| Flota | `GET/POST /api/flota`, `PUT/DELETE /api/flota/{placa}`, `GET /api/flota/export` | Administración y Cliente |
| Rutas | assign, get/update, publish, clear, emergency-reassign y save-history | Programador |
| Operación | mis-rutas, actualizar-pasajero, rutas de cliente e información de conductor | Conductor y Cliente |
| Reportes | `GET /api/reportes`, `GET /api/routes/summary` | Administración y Gerente |
| Verificación | SOAT, CITV y licencia | Administración |
| Copilot | `POST /api/chat` | Programador |
| Tiempo real | `WS /ws/{user_id}`, `GET/POST /api/notifications` | Conductor y Administración |

## Formas de datos protegidas por pruebas

- Login devuelve identidad, rol, unidad, empresa, estado y `profileComplete`.
- Cada ruta contiene `conductor`, `micro_zona`, `horario` y `agentes`.
- El resumen gerencial contiene solamente conductor, zona, horario y conteo.
- El motor actual conserva pasajeros únicos y limita rutas asignadas según la
  capacidad configurada de la unidad.

## Deuda conocida que no debe perpetuarse

- No existe todavía un token de sesión verificable.
- Varios endpoints confían en identificadores enviados por el navegador.
- Las contraseñas existentes están almacenadas en texto plano.
- La mayoría del estado comparte una sola fila JSON de Supabase.
- CITV utiliza una respuesta simulada.
