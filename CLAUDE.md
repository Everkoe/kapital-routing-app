# Kapital Routing App — Contexto Maestro del Proyecto

Este archivo es leído automáticamente por Claude Code (terminal, desktop app, plugin de IntelliJ/JetBrains)
al iniciar cualquier sesión en este repo. Mantenerlo actualizado evita repetir contexto en cada conversación.

## 1. Propósito

Plataforma B2B de gestión de flotas, conductores y ruteo logístico. Conecta:
- **Administración** (planifica rutas, gestiona clientes, aprueba conductores)
- **Conductores** (suben documentación, reciben asignaciones)

## 2. Estado real de la infraestructura (verificado, no asumido)

- **Supabase**: proyecto activo `kapital-routing` (id `pkyezkdssyrbwxhldsay`), Postgres 17, región us-east-2.
  El backend accede vía REST directo con `httpx` (no usa el SDK `supabase-py`).
- **Vercel**: despliega el frontend estático + `frontend/api/index.py` como función serverless
  (rewrites en [frontend/vercel.json](frontend/vercel.json)).
- **Backend híbrido — ¡importante!**: además de Supabase, `api/index.py` mantiene estado en memoria
  (`rutas_estado_actual`, `usuarios_db`, `conductores_db`, `historial_rutas`, `board_lock`, `routes_summary`,
  `notifications_db`). En un entorno serverless (Vercel) esa memoria **no persiste entre cold starts** —
  tenerlo en cuenta al debuggear "datos que desaparecen".
- **Gemini AI**: integrado vía REST puro (sin SDK, "para ahorrar espacio en Vercel") como "Kapital Copilot",
  un asistente conversacional para el Programador de rutas (`CopilotChat.jsx` + `SYSTEM_PROMPT` en `api/index.py`).
- **Conocido pendiente de limpieza**: `SUPABASE_URL`/`SUPABASE_KEY` están hardcodeadas en
  [frontend/api/index.py:33-34](frontend/api/index.py:33) en vez de leerse de `.env` como indica
  `.env.example`. Es una publishable key (no secreta), pero conviene migrarlo a `os.environ` en algún momento.

## 3. Stack Tecnológico

**Frontend** (`frontend/`, Vite + React 19)
- `lucide-react` — iconografía (obligatorio, ver reglas de diseño)
- `recharts` — dashboards/KPIs
- `react-hot-toast` — notificaciones
- `react-dropzone` — carga de archivos
- `xlsx` — asignación masiva de rutas vía Excel
- `leaflet` / `react-leaflet` — mapa en vivo (`LiveMap.jsx`)
- `framer-motion` — animaciones

**Backend** (`frontend/api/index.py`, FastAPI/Python, ~1740 líneas en un solo archivo)
- `fastapi`, `uvicorn`, `pandas`, `openpyxl`, `httpx`, `python-dotenv`
- WebSockets nativos para eventos en tiempo real (`WebSocketManager`, broadcast por rol)
- Sin SDK de Supabase ni de Gemini — todo por REST directo (decisión deliberada por límites de tamaño en Vercel)

## 4. Arquitectura por Roles

`App.jsx` (136KB, componente raíz) enruta según rol a un portal distinto:

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

```
SUPABASE_URL=
SUPABASE_KEY=
GEMINI_API_KEY=
```

## 8. Comandos habituales

```bash
cd frontend
npm run dev       # servidor de desarrollo Vite
npm run build     # build de producción
npm run lint      # eslint
```

Backend local: `uvicorn api.index:app --reload` desde `frontend/` (requiere `requirements.txt` instalado en `venv`).

## 9. Roadmap / próximos pasos

1. ~~Migrar a DB en la nube~~ — **hecho** (Supabase), pero pendiente decidir si eliminar el estado en memoria
   restante o formalizarlo como cache intencional.
2. Algoritmos de optimización real de rutas (geográfico/matemático) — aún no implementado.
3. Autenticación robusta con JWT — aún no implementado (verificar mecanismo actual de sesión antes de asumir que no hay nada).
4. Mover credenciales hardcodeadas de Supabase a variables de entorno reales.

## 10. Notas para el agente (cualquier cliente: terminal, desktop, plugin JetBrains)

- Este documento refleja el estado verificado del código, no solo lo que el usuario recuerda — si algo acá
  queda desactualizado, corregirlo en el mismo PR/commit donde se detecte la discrepancia.
- El usuario coordina el desarrollo desde IntelliJ IDEA; los cambios se ven reflejados ahí en cuanto se
  editan los archivos en disco.
