# Kapital Routing App — Contexto Maestro del Proyecto

Este archivo es leído automáticamente por Claude Code (terminal, desktop app, plugin de IntelliJ/JetBrains)
al iniciar cualquier sesión en este repo. Mantenerlo actualizado evita repetir contexto en cada conversación.

## 1. Propósito

Plataforma B2B de gestión de flotas, conductores y ruteo logístico. Conecta:
- **Administración** (planifica rutas, gestiona clientes, aprueba conductores)
- **Conductores** (suben documentación, reciben asignaciones)

## 2. Estado real de la infraestructura (verificado, no asumido)

- **Supabase**: la app corre en modo `KAPITAL_STORAGE_BACKEND=V2_COMPAT` contra el proyecto **nuevo**
  `kapital-routing-v2`. El proyecto original `kapital-routing` (id `pkyezkdssyrbwxhldsay`) quedó como origen
  histórico; no asumir que es el activo. El backend accede vía REST directo con `httpx` (sin SDK `supabase-py`).
  Todo el estado vive en **una sola fila**: `public.app_state` con `id = 1`, donde `usuarios` contiene los
  usuarios reales más las pseudo-claves `__flota__`, `__notifications__`, `__routes_summary__`,
  `__historial_rutas__`, `__lock__`, `__sessions__`, `__actividad__` y `__login__`. El egress es una
  restricción de diseño de primer orden, ver `docs/handoff/` antes de añadir lecturas. La fila llegó a pesar
  3,95 MB; hoy son **228 KB** tras sacar los documentos y las fotos a Storage. Un login ya no la descarga
  entera: `__login__` mapea identificador → clave de la cuenta y lleva directo al usuario suelto
  (credencial incorrecta ≈ 18 KB; entrada correcta ≈ 238 KB, y lo que queda es la escritura de la sesión,
  que obliga a bajar la columna antes de reescribirla porque PostgREST no sabe hacer escrituras parciales).
- **Vercel**: despliega el frontend estático + `frontend/api/index.py` como función serverless
  (rewrites en [frontend/vercel.json](frontend/vercel.json)).
- **Backend híbrido — ¡importante!**: además de Supabase, `api/index.py` mantiene estado en memoria
  (`rutas_estado_actual`, `usuarios_db`, `conductores_db`, `historial_rutas`, `board_lock`, `routes_summary`,
  `notifications_db`). En un entorno serverless (Vercel) esa memoria **no persiste entre cold starts** —
  tenerlo en cuenta al debuggear "datos que desaparecen".
- **Gemini AI — descartado como producto, vivo como endpoint**: se construyó "Kapital Copilot", un asistente
  conversacional para el Programador de rutas, vía REST puro (sin SDK, "para ahorrar espacio en Vercel").
  **Ya no forma parte de la aplicación**: `frontend/src/CopilotChat.jsx` existe (268 líneas) pero **ningún
  componente lo importa ni lo renderiza** — es código muerto pendiente de retirar. El backend sí conserva
  `POST /api/chat` y su `SYSTEM_PROMPT` en `api/index.py`, gateado con sesión porque consume cuota de pago.
  No asumir que el Copilot es una función disponible al rediseñar el portal del Programador.
- **Migración de configuración en curso**: `SUPABASE_URL`/`SUPABASE_KEY` ya priorizan variables de entorno,
  pero conservan valores fallback temporalmente para no interrumpir Vercel. El fallback se retirará después de
  verificar las variables del despliegue. `JSON_PE_TOKEN` y `GEMINI_API_KEY` también están documentados en `.env.example`.
- **Migración de contraseñas hecha**: el backend lee hashes PBKDF2 y texto plano, y **cifra al escribir por
  defecto** (`KAPITAL_PASSWORD_HASH_WRITE`, hoy `true`). Nació apagado para que un rollback anterior a la lectura
  compatible no dejara fuera a nadie; esa lectura está desplegada desde el PR #3, así que la precondición ya no
  existe. Las 115 contraseñas que quedaban en claro se cifraron de una vez con
  `scripts/cifrar_contrasenas.py` — esperar al login de cada persona habría dejado casi toda la base en claro,
  porque 103 de esas cuentas no habían entrado nunca. **Ya no se puede leer una contraseña de la base**, así que
  un olvido se resuelve con `POST /api/admin/users/reset-password` y su botón en Accesos: entrega una
  provisional una sola vez —no se guarda en ningún otro sitio, tampoco en el historial—, marca
  `needs_password_change` y cierra las sesiones abiertas de esa cuenta. Un gerente puede reiniciar la de un
  conductor o un cliente, pero no la de otra cuenta de administración ni la suya propia: sería tomarla.
- **Sesiones**: el login emite una cookie opaca `HttpOnly` (`SameSite=Lax`, TTL 12 h) y persiste solo su
  hash. `KAPITAL_AUTH_ENFORCED=true` **está activo en producción desde el PR #3**, que llevó `/api/auth/me`,
  `/api/auth/logout`, el manejo de 401 en el frontend y el índice de sesiones. Cobertura actual:
  **36 de 47 endpoints**; los 11 restantes —todos de lectura— están inventariados en
  `docs/handoff/2026-09-15-relevo.md` §7. Las escrituras destructivas y las integraciones de pago
  (Gemini, API de verificación) ya están cerradas.
  **Validar una sesión NO debe costar el blob de usuarios**: existe `usuarios.__sessions__`, una pseudo-clave
  con una instantánea de autorización por token. Al añadir un gate nuevo, usar `require_session_owner`, y si
  se muta `rol` o `estado` de un usuario **llamar a `refresh_session_index_for()`** o la instantánea quedará
  obsoleta y una desactivación no desactivará nada.

## 3. Stack Tecnológico

**Frontend** (`frontend/`, Vite + React 19)
- `lucide-react` — iconografía (obligatorio, ver reglas de diseño)
- `recharts` — dashboards/KPIs
- `react-hot-toast` — notificaciones
- `react-dropzone` — carga de archivos
- `xlsx` — asignación masiva de rutas vía Excel
- `leaflet` / `react-leaflet` — mapa en vivo (`LiveMap.jsx`)
- `framer-motion` — animaciones

**Backend** (`frontend/api/index.py`, FastAPI/Python, ~6170 líneas y 54 endpoints en un solo archivo —
muy por encima del techo de 800; su modularización es el P2 del PR #1)
- `fastapi`, `uvicorn`, `pandas`, `openpyxl`, `httpx`, `python-dotenv`
- WebSockets nativos para eventos en tiempo real (`WebSocketManager`, broadcast por rol)
- Sin SDK de Supabase ni de Gemini — todo por REST directo (decisión deliberada por límites de tamaño en Vercel)

## 4. Arquitectura por Roles

`App.jsx` (~1365 líneas, componente raíz) enruta según rol a un portal distinto:

| Rol | Componente | Archivo |
|---|---|---|
| Administrador | Gestión de flota/documentos | [FlotaView.jsx](frontend/src/FlotaView.jsx), [AdminDashboard.jsx](frontend/src/AdminDashboard.jsx) |
| Gerente de Operaciones | — | [GerentePortal.jsx](frontend/src/GerentePortal.jsx) |
| Cliente | — | [ClientPortal.jsx](frontend/src/ClientPortal.jsx) |
| Conductor | Onboarding, documentos, rutas | [DriverPortal.jsx](frontend/src/DriverPortal.jsx) |

Componentes de soporte en `frontend/src/components/`:
- `DriverOnboardingWizard.jsx` — wizard de alta (DNI, licencia, récord, antecedentes, CV, tarjeta de propiedad, SOAT)
- `DocumentResubmission.jsx` — resubida cuando admin rechaza un documento
- `DocumentVerification.jsx` — revisión de documentos por admin
- `FileUploadZone.jsx` — dropzone reutilizable
- `QuizManejoDefensivo.jsx`, `SwipeablePassenger.jsx`, `ZenModeView.jsx` — features específicas

## 5. Reglas de Diseño y UI/UX (no negociables)

- **Nunca colores hardcodeados** (`#fff`, `#000`). Siempre variables CSS (`var(--kapital-bg)`, `var(--text-primary)`,
  `var(--kapital-card-bg)`, `var(--primary)`, etc.) para soporte nativo de modo Claro/Oscuro.
- **Nunca emojis nativos** (❌ 📄). Siempre íconos de `lucide-react` (✅ `<FileText />`).
- Microinteracciones: `cursor: pointer` en interactivos, hover sutil (`opacity`/`rgba`), `border-radius: 8px` o `12px`.
- Visualizador de documentos: imágenes se adaptan al alto de pantalla; PDFs muestran ícono `<FileText />` +
  botón dedicado (no iframe — Brave/Chrome los bloquean, ver commits recientes).

## 6. Convenciones de trabajo específicas de este repo

- Hay **muchos scripts sueltos de uso único** en la raíz de `frontend/` (`check_*.py`, `clear_*.py`, `test_*.py`,
  `sync_flota*.py`, `migrate_roles.py`, etc.) — son herramientas puntuales de debugging/migración manual contra
  Supabase, no forman parte de la app ni de un test suite. No asumir que son código productivo ni intentar
  "limpiarlos" sin confirmar con el usuario.
- `kapital.db` en `frontend/` está vacío (0 bytes) — vestigio de un intento anterior con SQLite local, ya no se usa.
- Notificación admin→conductor: si el admin sube un documento en nombre del conductor
  (`uploaded_by: 'admin'`), se omite la notificación de "documento resubido" para evitar ruido redundante.

## 7. Variables de entorno (`frontend/.env` — nunca commitear valores reales)

La lista completa y comentada está en [frontend/.env.example](frontend/.env.example). Resumen:

```
KAPITAL_STORAGE_BACKEND       # V2_COMPAT en la configuración actual
KAPITAL_V2_SUPABASE_URL       # proyecto nuevo — solo backend
KAPITAL_V2_SUPABASE_KEY       # solo backend, solo en el header `apikey`
KAPITAL_V2_ENABLED / _REMOTE_ENABLED / _READ_ONLY
KAPITAL_AUTH_ENFORCED         # default true desde el PR #2 (ver §2)
KAPITAL_SESSION_TTL_HOURS     # 12 por defecto
KAPITAL_PASSWORD_HASH_WRITE   # true por defecto; solo se pone en false para volver atrás
SUPABASE_URL / SUPABASE_KEY   # proyecto original, ruta heredada
GEMINI_API_KEY
JSON_PE_TOKEN                 # tiene un literal como fallback en el código: rotar y retirar
```

La clave secreta de Supabase se usa **solo en backend** y **solo** en el header `apikey`. Nunca
`Authorization: Bearer`, nunca con prefijo `VITE_`/`NEXT_PUBLIC_`, nunca expuesta al navegador.

## 8. Comandos habituales

```bash
cd frontend
npm run dev       # servidor de desarrollo Vite
npm run build     # build de producción
npm run lint      # eslint
```

Backend local: `uvicorn api.index:app --reload` desde `frontend/` (requiere `requirements.txt` instalado en `venv`).

## 9. Roadmap / próximos pasos

**El plan de trabajo vivo está en [docs/handoff/2026-09-15-relevo.md](docs/handoff/2026-09-15-relevo.md) §8.**
El backlog real es el cuerpo del PR #1, que es una especificación de 29 requisitos con un *Definition of Done*
de 28 condiciones, no un registro de trabajo hecho. El §6 del relevo contrasta esa especificación contra el
código, verificado endpoint por endpoint.

Contexto que no cambia con cada lote:

1. ~~Migrar a DB en la nube~~ — **hecho** (Supabase V2 en modo compat). Pendiente decidir si el estado en
   memoria restante se elimina o se formaliza como caché intencional.
2. Algoritmos de optimización real de rutas — no implementado, y **congelado a propósito** junto con el rol
   Programador de rutas (casos `RTE` de `docs/phase-0/regression-matrix.md`). No optimizar por iniciativa propia.
3. Autenticación: **no se va a JWT**. El mecanismo es sesión opaca en cookie `HttpOnly` con hash persistido.
   El manejo de 401 ya está en el frontend (`src/utils/apiClient.js` — **usarlo, no `fetch` directo**).
   Lo que falta es cerrar los 11 endpoints de lectura restantes y el handshake del WebSocket. El usuario
   sembrado con contraseña por defecto que inyectaba `_decode_full_state` ya está retirado, y hay una prueba
   que falla si vuelve a aparecer una contraseña escrita en el módulo.
4. Retirar los fallbacks de credenciales hardcodeadas tras verificar las variables en Vercel.
5. **Separar backend y frontend en dos repositorios: evaluado el 2026-09-15 y descartado por ahora.**
   El mismo origen es carga estructural: sostiene la cookie `SameSite=Lax` (que hoy neutraliza el CORS
   wildcard), garantiza despliegues atómicos durante la migración de auth y mantiene un único baseline en CI.
   Precondiciones para reconsiderarlo en el relevo §8.

## 10. Notas para el agente (cualquier cliente: terminal, desktop, plugin JetBrains)

- Este documento refleja el estado verificado del código, no solo lo que el usuario recuerda — si algo acá
  queda desactualizado, corregirlo en el mismo PR/commit donde se detecte la discrepancia.
- El usuario coordina el desarrollo desde IntelliJ IDEA; los cambios se ven reflejados ahí en cuanto se
  editan los archivos en disco.
