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
  **PostgREST no devuelve más de mil filas por petición**, pida uno el límite que pida: hay que recorrerlas
  con `offset` y parar en la tanda corta. Pedir 5.000 y dar la lectura por terminada al recibir 1.000 dejaba
  fuera veinte mil servicios en silencio, y un historial recortado convierte un cambio real en «sin novedad».
  Y en una escritura en lote **todas las filas deben traer las mismas claves** (`All object keys must
  match`), así que se mandan todas las columnas aunque solo cambie una.
- **Programador de rutas — tablas propias, fuera de `app_state`**: desde 2026-09-22 existen
  `public.pasajeros`, `public.servicios_historicos` y `public.duraciones_base`, con RLS activada, sin
  políticas y con permisos solo para `service_role`. El histórico son 21.271 filas al mes y no cabe en la
  fila única. Esquema en [supabase/001_programador_rutas.sql](supabase/001_programador_rutas.sql), carga con
  `scripts/cargar_historico.py` (repetible, upsert sobre clave natural). **No hay tabla de vehículos**: la
  flota sigue en `app_state.__flota__` y duplicarla crearía dos verdades que sincronizar.
  El domicilio de cada pasajero lo resuelve `scripts/geocodificar_pasajeros.py`, y **no con un
  geocodificador** —falla en el 88% de estas direcciones, que usan notación de manzana y lote— sino con la
  mediana del GPS de sus recojos: 29 m de error mediano contra domicilios conocidos. Los umbrales de
  confianza están calibrados contra esos domicilios, no elegidos a ojo; `--calibrar` reproduce la medición.
  Cobertura actual: 776 fiables, 35 dudosos, 352 a revisión humana de 1.163.
- **El `.xls` de la intranet no es un Excel**: es una tabla HTML en UTF-8 **sin declarar el charset**, con
  extensión `.xls`. Eso importa porque Excel, al abrirlo, asume cp1252 y convierte «Ñ» (bytes `C3 91`) en
  «Ã» + U+2018; ese texto roto se cargó en el padrón y hubo que repararlo con
  `scripts/reparar_acentos.py` (78 filas). Desde 2026-09-22 el lector acepta el archivo **tal como lo
  descarga la intranet** —lo parsea con `html.parser` de la librería estándar, sin lxml ni
  BeautifulSoup, que no caben en Vercel— y además repara lo que le llegue roto (`reparar_acentos`). Las
  cabeceras vienen partidas en dos líneas y llegan con espacio o sin él según haya pasado por Excel:
  `ALIAS_COLUMNAS` las unifica. Las fechas son `dd/mm/aa` y se parsean con el día por delante de forma
  explícita; dejárselo adivinar a pandas es jugarse el mes sin que nada lo señale.
- **Carga diaria del histórico**: el Programador sube el reporte de la intranet desde su sección
  **Cargar datos → Histórico** (`POST /api/programador/historico`, medido 3,9 s para un día de 518
  servicios). La lectura vive en
  [frontend/api/historico_intranet.py](frontend/api/historico_intranet.py) y la comparten el endpoint y
  `scripts/cargar_historico.py`, que es para importar meses enteros (~22 s, por encima de lo que aguanta una
  función serverless). **La ubicación NO sale del archivo subido**: la recalcula la función de Postgres
  `recalcular_ubicaciones()` sobre el histórico acumulado. Hacerlo desde el archivo degradaba domicilios ya
  resueltos —medido: una carga de un solo día bajó de 768 buenos a 481, porque un día no llega a los tres
  puntos GPS que exige el umbral—. Por eso el padrón se escribe en dos grupos y quien no declara coordenada
  va **sin** las columnas de ubicación, para que lo ya aprendido sobreviva. Que «sin ubicar» suba tras una
  carga no es una regresión: son personas nuevas. La comprobación correcta es que las **resueltas** no bajen.
- **Novedades del cliente — el cambio se deduce, no se lee**: es el otro archivo que maneja el Programador
  (altas, bajas y cambios para los próximos días; suele llegar el viernes con el fin de semana dentro) y se
  sube en **Cargar datos → Novedades** (`POST /api/programador/novedades`, en
  [frontend/api/novedades_intranet.py](frontend/api/novedades_intranet.py)). **No escribe nada**: analiza y
  enseña el resultado. Su columna `NOVEDAD` es inservible y está medido: de 23 filas de muestra, 6 dicen
  «Asignar Ruta» de gente que ya viajaba —una con 108 servicios previos— y la etiqueta nombra mal el cambio
  (decía «Asignar» cuando lo que cambiaba era el turno). Por eso cada fila se contrasta con el histórico
  **anterior a su fecha**, que es de donde salen zona, turno, sentido y dirección. De la etiqueta se lee un
  solo bit —si viaja o no— y **no por confianza, sino porque no está en ninguna otra parte**: una baja es por
  construcción idéntica al histórico, así que no hay nada que detectar. No volver a plantear deducir la baja.
  Las direcciones se comparan por términos con peso, sin acentos y sin relleno («AVENIDA», «MZ»), cortando en
  «REF»: comparar los textos tal cual daba 4 traslados falsos de 8.
- **Bases de terceros (motorizados)**: el 2026-09-24 entró la primera, «Sharf Motorizado», con
  `scripts/importar_base_motorizados.py`. Por cada persona escribe **dos cosas**: una unidad en
  `__flota__` con el padrón por clave (SM001…) y un usuario con rol Conductor, su `perfil_conductor` y
  una contraseña provisional cifrada con `needs_password_change`. Las provisionales en claro salen a un
  CSV bajo `scratch/` —ignorado por git— y es la única copia. El script **no se fía de la cabecera**: el
  mismo archivo llegó tres veces con las etiquetas descuadradas sobre columnas distintas, así que mapea
  por nombre normalizado y se para si falta una obligatoria. Es repetible: cruza por DNI y por padrón,
  actualiza a quien ya existe y **nunca le cambia la contraseña** a alguien que ya entró. Hoy: 128
  usuarios y 126 unidades. Ojo, la flota pasa a tener dos naturalezas —autos de 4 a 15 plazas y motos de
  2—, y eso afecta a cualquier cálculo de capacidad que suponga coche.
  La columna `GRUPO` del Excel se guarda en `grupo` y Gestión de Flota la enseña en etiquetas de color,
  una por grupo. **Las tres bases la declaran**: en masivo es el cliente —`TP`, `KONECTA` o
  `TP/KONECTA`, porque una unidad puede servir a los dos (25, 11 y 31 de 67)—; en Remisse y en Sharf es
  el nombre de la propia base (40 y 16). Llegué a descartarla cuando repetía la base, dándola por
  redundante, y dejó 56 unidades como «No consta» teniendo el dato escrito: **no descartar ese valor**.
  Solo quedan sin grupo 3 unidades, una de ellas `K-TEST`, que es de prueba y no está en ningún Excel.
- **Tras escribir `app_state` desde un script, el backend en marcha sigue sirviendo lo viejo.** Mantiene
  la flota y los usuarios en memoria (`conductores_db`, `usuarios_db`) y no relee mientras su caché siga
  fresca, así que la pantalla enseña el estado anterior y parece que la escritura no funcionó. Pasó con
  la columna de cliente: la base tenía el grupo y la tabla decía «No consta» en todas las filas.
  Reiniciar el backend —o esperar a que caduque la caché— lo resuelve; en Vercel se arregla solo en el
  siguiente cold start.
- **La programación del Programador — lo que decide, no lo que ocurrió**: desde 2026-09-25 existen
  `public.programacion`, `programacion_dias` y `programacion_pendientes`, con sus funciones en
  [supabase/003_plan_programador.sql](supabase/003_plan_programador.sql). **Tabla aparte del histórico a
  propósito**: mezclarlas haría imposible distinguir un hecho de una intención, que es justo lo que hace
  falta cuando algo sale mal. El flujo es el del trabajo real: `sembrar_programacion()` copia el último
  día ejecutado —el «seguir el orden anterior»; 396 asignaciones en 0,9 s— y **no pisa lo ya hecho**
  salvo que se pida rehacerlo. Encima se aplican las novedades con `aplicar_novedades()`, que hace solo
  lo mecánico: **la baja se retira; el alta y el cambio de zona o turno salen de su servicio y quedan
  pendientes**. No recoloca a nadie, porque elegir vehículo es el problema que necesita las reglas de la
  operación y resolverlo a ojo sería inventarse una decisión. Un retirado **no se borra**: el día
  siguiente necesita saber que alguien iba a viajar y se cayó. Los endpoints son
  `GET /api/programador/plan` y los `POST .../plan/sembrar`, `.../plan/editar` y `.../plan/novedades`.
  **Cada cambio se guarda al momento**, no al pulsar un botón: acumularlos obliga a resolver qué pasa si
  alguien cierra la pestaña a medias, y ese «¿guardé?» es lo que no debe tener quien programa de
  madrugada. Por lo mismo se retiró el botón «Guardar» del encabezado: anunciaba como
  pendiente algo que ya ocurre solo.
  **El eje de días no sale del histórico, y ese fue el fallo que dejó la función inalcanzable**: el
  selector solo ofrecía días ya ejecutados, y el día que un programador necesita —mañana— no está en
  `servicios_historicos` por definición. El plan del 26 existía en la base y no había manera de abrirlo
  desde la pantalla. Ahora `GET /plan` añade `dias_programables` (hoy y trece días más, unidos a los que
  ya tienen plan para que uno viejo siga alcanzándose) y el selector los presenta en dos grupos, «Por
  programar» y «Ya ejecutado · no se edita». La ventana se calcula en el backend y no en Postgres a
  propósito: cuánto se deja planificar por delante es una decisión de producto y cambiarla no debería
  ser un DDL. **Y «hoy» es el de Lima, no el del servidor** (`_hoy_en_lima`): en Vercel el reloj es UTC
  y Perú va cinco horas por detrás, así que desde las 19:00 `datetime.now()` ya decía mañana, justo en
  las horas en que se programa.
  El KPI «Agentes sin asignar» suma los pendientes del plan: sobre un plan no hay servicios huérfanos
  —quien se cae sale de todo servicio—, así que sin ellos daba cero justo después de aplicar las
  novedades, que es el único momento en que ese número dice algo.
  **Un `cambio` tampoco borra su fila: la marca**, igual que una baja. Llegó a borrarla, y con ella el
  rastro de en qué vehículo iba esa persona, que es justo el dato que hace falta para recolocarla porque
  lo normal es que vuelva con el mismo conductor. Ahora `aplicar_novedades` devuelve `retiradas` (bajas)
  y `movidas` (sacados de su servicio) por separado: no son lo mismo, porque quien se mueve sí viaja.
  **Y sembrar exige `dni is not null`.** El histórico trae 161 servicios sin pasajero —139 de ellos
  «A BORDO»— repartidos por **27 de los 32 días cargados**, y como `programacion.dni` es `not null` la
  siembra no fallaba en esas filas sino **entera**, con un 503 genérico. Solo se libraba sembrar desde el
  22 de septiembre, que da la casualidad de que está limpio, que es justo el día desde el que se probó
  todo. Medido tras el arreglo: sembrar el 5 de septiembre desde el 31 de agosto crea 520 asignaciones.
- **El motor de inserción** (desde 2026-09-26, en
  [frontend/src/programador/model/motorInsercion.js](frontend/src/programador/model/motorInsercion.js)): para
  cada pendiente del plan **propone** en qué servicio entra y en qué posición del orden; asigna la persona que
  programa, de una en una o todas juntas. Es una inserción y no un optimizador porque el problema diario tiene
  una mediana de un pasajero y un vehículo por celda (ver §9.2). Solo busca sitio en **servicios que ya
  existen** del mismo turno, sentido y sede: no abre servicios ni encadena turnos, que es justo lo que
  necesitaría las cuatro reglas de la operación que siguen sin escribirse (tiempo máximo a bordo, antelación
  del recojo, margen entre turnos, qué hacer con las V###/M###). Ordena por su zona primero, después el menor
  desvío en línea recta, y a igualdad las que dejan más plazas. Todo lo que usa está medido, no supuesto:
  - **La sede es restricción dura**: ninguno de los 5.959 servicios del histórico mezcla sedes y solo una
    persona ha ido alguna vez a dos. El plan no la guarda; `leer_programacion` la deduce del histórico
    ([supabase/006_datos_del_motor.sql](supabase/006_datos_del_motor.sql)).
  - **Capacidad de las unidades sin capacidad declarada** = lo más que han llevado en un servicio
    (`max_llevado`). En las 39 unidades que sí la declaran, ese máximo coincide con ella en 23 y la holgura
    mediana es 0. Eso resuelve las 36 V###/M### sin preguntar. **Tres unidades han llevado más de lo que
    declaran** (K170 declara 4 y llevó 6; K244 y K246 declaran 4 y llevaron 5): ahí manda la declarada, y la
    diferencia es un dato que el usuario debe revisar.
  - **`22:00` y `22:01` son el mismo turno.** La intranet escribe las salidas habituales con `:01` (la de las
    22:01 son 457 servicios en 32 días; la de las 22:00, 26) y las novedades piden `22:00`. Exigir el turno
    exacto dejaba al motor sin ver la salida habitual; la tolerancia es de un minuto
    (`TOLERANCIA_TURNO_MIN`) y nada más: si alguien puede esperar al coche de las 22:15 es una regla.
  - **La unidad habitual no reordena, solo se enseña.** Se comprobó con las novedades reales: en los cuatro
    casos la unidad habitual hacía ese turno pero cubría otra zona y quedaba más lejos (la de HOLGUIN, a
    +11,7 km frente a +1,6 en su zona). Preferirla habría empeorado todas las propuestas.
  - El desvío **no se convierte en minutos**: la geometría explica poco de la duración (§9.2) y sería una
    promesa de hora.
  La tanda («Asignar las N propuestas») atiende primero a **quien menos opciones tiene**, y sus cambios se
  aplican **en el orden en que el motor eligió**, no en el de la lista: si dos personas van al mismo coche,
  aplicarlos al revés deja a dos con la misma posición. Hay prueba de las dos cosas.
- **`agregar`, `mover` y `ordenar` no funcionaron nunca hasta el 2026-09-26.** `editar_programacion` (de la
  004) declaraba una variable `dni` igual que la columna, y Postgres rechazaba toda llamada con «column
  reference "dni" is ambiguous»; retirar y reponer sí iban porque no la usan. Las pruebas del backend
  simulan PostgREST y no podían verlo. **`scripts/probar_funciones_plan.py` ejecuta cada acción de verdad
  contra la base**, sobre un día sembrado dentro de una transacción que se deshace al final: correrlo tras
  tocar cualquier función del plan. En PL/pgSQL, **ninguna variable puede llamarse como una columna** de las
  tablas que toca la función.

- **Cómo se aplica lo de `supabase/`**: con `scripts/aplicar_sql.py`, que manda el archivo a la API de
  gestión de Supabase; por PostgREST no pasa el DDL y no hay ningún cliente de Postgres instalado en el
  entorno. Hasta ahora cada sesión lo hacía con un script de usar y tirar que se perdía al terminar, y
  eso deja el esquema del repositorio y el de la base sin forma comprobable de coincidir. La verificación
  del **2026-09-25** confirmó que el `SUPABASE_ACCESS_TOKEN` local funcionó tanto para consultar como para
  aplicar cambios en el proyecto V2; no registrar ni revelar su valor. El MCP de Supabase tampoco sirve de
  alternativa: solo ve el proyecto viejo e inactivo, no el v2 que usa la aplicación. **Ese mismo día se
  aplicó y verificó `supabase/004_plan_programador_hardening.sql` en V2**: los errores de dominio de las
  RPC se traducen a HTTP 4xx en vez de un 500 genérico, las fechas se validan antes de mutar, las
  operaciones fuera del día/ventana programable quedan bloqueadas, las mutaciones usan bloqueo
  transaccional por día y los pendientes se limpian al reponer, mover o asignar. La verificación quedó
  verde con **204/204 pruebas de backend y 131/131 de frontend**. Cualquier nueva aplicación de DDL debe
  seguir pasando por el script y mantenerse sin secretos en git.
  **Toda función nueva en `public` necesita `revoke all ... from public`.** Postgres concede `EXECUTE` a
  `public` por defecto, y como estas funciones son `security definer`, eso las deja invocables por
  `/rest/v1/rpc/` con la clave anónima del proyecto, saltándose el backend y su sesión. Le pasó a las
  cuatro del plan en la 003 (lo cerró la 004) y a `recalcular_ubicaciones()` de la 002 (lo cerró la
  005). Comprobarlo es una consulta: `has_function_privilege('anon', oid, 'execute')` sobre `pg_proc`;
  hoy solo da `true` en `rls_auto_enable`, que es de *event trigger* y no se puede llamar.

- **Las pantallas del Programador, y de dónde sale cada una** (auditado el 2026-09-23):
  - **`/api/routes` devuelve `[]`** y nada vuelve a escribir `rutas_estado_actual`. De ahí derivaban
    las tres pantallas, así que dos calculaban sobre cero filas sin decirlo. **Las cuatro secciones
    leen ahora el histórico**, que es la única entrada real de información.
  - **Cargar datos** es esa entrada: las dos pestañas descritas arriba.
  - **Operación** (la mesa) muestra la programación **realmente ejecutada** del día elegido, vía
    `GET /api/programador/programacion?fecha=`. Eso no es proponer rutas —el motor sigue congelado,
    ver §9.2— sino enseñar el punto de partida del trabajo: seguir el orden anterior y aplicar las
    novedades. La respuesta conserva la forma del contrato viejo (`conductor`, `micro_zona`,
    `horario`, `agentes`) **a propósito**, para que tarjetas, filtros, búsqueda y exportación sigan
    funcionando sin tocarlos. Un día son ~106 KB contra los 493 KB del endpoint anterior. Cada
    servicio trae además su **duración medida** de `duraciones_base`, con respaldo al nivel sin turno:
    130 de 135 rutas la reciben. Lo que sigue sin existir es el orden de recogida *propuesto*; los
    agentes se ordenan por la hora real del histórico.
  - **Análisis** y **Flota** se reconstruyeron sobre el mismo histórico. Antes, Análisis calculaba
    métricas de un tablero inexistente y Flota enseñaba cuatro columnas a cero para las 110 unidades.
  - Los resúmenes se calculan en Postgres (`resumen_analisis()`, `resumen_vehiculos()` y
    `programacion_del_dia()`, en
    [supabase/002_analisis_programador.sql](supabase/002_analisis_programador.sql)) y no en la
    aplicación: bajar 21.789 filas para contarlas costaría ~493 KB de egress por visita; los resúmenes
    son 4 KB y 9 KB. Los sirven `GET /api/programador/analisis` y `GET /api/programador/vehiculos`.
  - **`A BORDO` es la única incidencia que significa que el servicio ocurrió.** Medido: 15.779 de 21.789,
    o sea que **el 28% de los asientos programados viajan vacíos**. Es el número que más cambia el
    dimensionado de flota y por eso preside la pantalla de Análisis.
  - **Los códigos de vehículo no coinciden entre las dos fuentes**: la flota guarda «K-027» y la
    intranet registra «K027». El cruce va por el código sin guiones —`_clave_de_vehiculo` en el
    backend, `fleetKey` en el modelo del frontend, que es lo que permite resolver la capacidad
    declarada de un servicio del histórico—, y aun así
    **solo cruzan 41 de 79**: la intranet mueve unidades «V###» y «M###» que no están dadas de alta en
    `__flota__`. La pantalla lo dice en vez de enseñar ceros; decidir qué hacer con esas unidades es del
    usuario, no del código.
- **Vercel**: despliega el frontend estático + `frontend/api/index.py` como función serverless
  (rewrites en [frontend/vercel.json](frontend/vercel.json)).
- **Backend híbrido — ¡importante!**: además de Supabase, `api/index.py` mantiene estado en memoria
  (`rutas_estado_actual`, `usuarios_db`, `conductores_db`, `historial_rutas`, `board_lock`, `routes_summary`,
  `notifications_db`). En un entorno serverless (Vercel) esa memoria **no persiste entre cold starts** —
  tenerlo en cuenta al debuggear "datos que desaparecen".
- **Gemini AI — descartado como producto, vivo como endpoint**: se construyó "Kapital Copilot", un asistente
  conversacional para el Programador de rutas, vía REST puro (sin SDK, "para ahorrar espacio en Vercel").
  **Ya no forma parte de la aplicación**: `CopilotChat.jsx` se retiró el 2026-09-22 (eran 268 líneas que
  ningún componente importaba). El backend sí conserva
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

**Backend** (`frontend/api/index.py`, FastAPI/Python, ~6420 líneas y 57 endpoints en un solo archivo —
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
2. Algoritmos de optimización real de rutas — **descongelado el 2026-09-22** por decisión del usuario, que
   pasó contexto propio (VROOM + CatBoost + OSRM). **Desde el 2026-09-26 hay un motor de inserción**, pedido
   por el usuario y descrito en §2 («El motor de inserción»). No es un optimizador: no hay VROOM, OSRM ni
   CatBoost instalados, y **no deben añadirse por iniciativa propia**.
   Dos conclusiones medidas que conviene no volver a discutir desde cero:
   - **La ruta de un pasajero es 100% estable** (cobertura + turno + modalidad); lo que rota es el vehículo,
     solo 64% estable. La variación diaria real es del 22%, no del 10%: 88 altas y 76 bajas sobre 738.
   - Descompuesto por día × turno × modalidad × cobertura, el problema diario tiene **una mediana de un
     pasajero y un vehículo por celda**. Eso es una inserción con comprobación de factibilidad, no un VRP:
     un solver ahí sería desproporcionado y además pelea con el requisito de continuidad del usuario
     («seguir el orden anterior, aplicar solo las novedades»). VROOM tiene sentido para reconstruir
     plantillas desde cero, que es un problema distinto y no urgente.
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
