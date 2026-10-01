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
  `__historial_rutas__`, `__lock__`, `__actividad__` y `__login__` (`__sessions__` quedó como resto: las
  sesiones viven en su propia tabla desde el 2026-09-27, ver «Sesiones»). El egress es una
  restricción de diseño de primer orden, ver `docs/handoff/` antes de añadir lecturas. La fila llegó a pesar
  3,95 MB; hoy son **~255 KB** tras sacar los documentos y las fotos a Storage. Un login ya no la descarga
  entera: `__login__` mapea identificador → clave de la cuenta y lleva directo al usuario suelto
  (credencial incorrecta ≈ 18 KB; entrada correcta ≈ 21 KB —el índice y la cuenta—, y no escribe nada salvo que cifre una
  contraseña vieja). **Escribir tampoco reescribe la fila** (desde el 2026-09-27, ver «Escritura por
  diferencias» más abajo).
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
  **La pantalla de carga dice si falta algo** (desde el 2026-09-28): el reporte que toca es el del día que
  ya terminó —ayer en Lima, `esperado` en `GET /api/programador/estado-historico`—, con una tira de los
  últimos siete días que sale resumida de la base (`dias_cargados()`,
  [supabase/014_dias_cargados.sql](supabase/014_dias_cargados.sql)). Si ya está, la caja para subir se
  pliega; si se sube un día que ya estaba, el servidor **para antes de escribir** con un 409 que lista lo
  ya cargado y solo recarga si se confirma (`reemplazar`). Esa tira destapó el hueco: el 28/9 el histórico
  tenía agosto entero y **de septiembre solo el 22**.
  **Volver a cargar un día lo sustituye** (desde el 2026-09-30, `reemplazar_dia_historico()` en
  [supabase/016_recarga_y_arrastre.sql](supabase/016_recarga_y_arrastre.sql)): antes era un upsert por la
  clave natural, que actualizaba lo que seguía en el archivo pero **no quitaba lo que ya no venía**; si la
  intranet corregía a alguien de unidad, quedaba en las dos, y el diálogo decía «no se duplica nada». Ahora
  cada día del archivo se borra y se reescribe en su propia transacción. Es seguro porque **cada día sale de
  un solo reporte** (medido el 2026-09-30: los 32 días cargados tienen una sola carga, y el reporte de un día
  no trae filas de otra fecha ejecutada; `fecha_programada` es casi siempre la víspera). El 409 lleva
  `en_archivo` (servicios por día) y el diálogo avisa si el archivo trae menos del 80% de lo cargado: un
  reporte a medias dejaría el día a medias. **Lo ejecutado no se edita a mano**: se corrige en la intranet y
  se vuelve a cargar (decisión del 2026-09-30; editarlo mezclaría lo que pasó con lo que alguien cambió, y
  la IA aprende de ahí). `scripts/cargar_historico.py`, el de meses enteros, sigue con el upsert.
  **La 016 va antes que el código**: sin la función, la carga del histórico daría 503.
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
- **Las bases se editan en la página y se exportan desde ella** (desde el 2026-09-29, decisión del
  usuario: el Excel ya no es la fuente, la página sí). La importación dejó cada fila repartida: la unidad
  en `__flota__` y la persona en su cuenta, con **seis datos en los dos sitios** —teléfono, placa, marca,
  modelo, año y color (`_ESPEJO_EN_PERFIL`)—. Cada pantalla leía uno distinto: la ficha enseñaba el
  teléfono de la unidad y el Excel el del perfil, así que a la K-027 se le cambió el teléfono en la
  página y la exportación seguía sacando el viejo. Ahora **manda la unidad en todas partes** (el perfil
  solo rellena lo que le falte: `_valor_de_unidad` en el backend y `filaDeLaBase.js` en el frontend,
  que tienen que coincidir) y **guardar escribe los dos**: la ficha (`PUT /api/flota/{padrón}`) copia al
  perfil del conductor, y aprobar lo que pidió el conductor (`resolve-update`) copia a la unidad, salvo
  la capacidad, que en la unidad es la del ruteo. **Todo lo del conductor y del vehículo se edita desde
  la ficha** (decisión del usuario, 2026-09-29: Administración tiene que poder dar de alta entero a quien
  no se maneja con la aplicación), y al registrar una unidad se abre su ficha para completarlo. El nombre
  tiene tres copias —unidad, cuenta y perfil— y cambia en las tres. El **documento** también se edita,
  aunque es con lo que el conductor entra, y **solo Administración** (`_ADMINISTRATION_ROLES`, como
  renombrar un padrón): se valida (DNI de 8 cifras; CE o pasaporte), se rechaza con 409 si ya es de otra
  cuenta —también con otros ceros delante: «00123456» y «0123456» son el mismo—, y queda en el historial
  como aviso propio. Las cuentas creadas desde la página tienen el DNI por **clave**, y la clave es con lo
  que se entra, de quién son las sesiones y lo que Accesos usa para desactivar: cambiar el DNI **muda la
  cuenta** a la clave nueva (`_clave_tras_el_documento`) y cierra sus sesiones. Sin mudarla, el DNI viejo
  seguía entrando y desactivarla en Accesos decía «hecho» sin hacer nada (lo encontró una revisión). Por
  solicitud del conductor el documento no se cambia (400). La exportación
  (`GET /api/flota/export`, también `SHARF`) sale de `_fila_de_la_base` con lo mismo que enseña la
  ficha, por base y padrón, con la fecha como fecha, el celular, la capacidad y el año como números y el
  DNI con sus ocho cifras (la importación les quitó el cero a 25), igual que la base original. El
  GRUPO sale de lo guardado, no de la plantilla, que no conocía las 16 de Sharf. Lleva filtros, la
  cabecera fija y anchos a la medida, y **nada que empiece por «=» se escribe como fórmula**: muchos de
  esos datos los teclea el conductor en su alta, y openpyxl los convertiría en fórmulas vivas.
  **La base se elige** en el alta y en la ficha (`_BASES`): las unidades dadas de alta en la página
  nacían sin ella y no salían en el Excel de ninguna. El grupo sigue a la base (`_grupo_para`): en
  Remisse y en Sharf es la propia base; en masivo, TP, KONECTA o TP/KONECTA. En una cuenta sin
  `perfil_conductor` —el conductor no pasó el alta en la aplicación—, **llenar un dato personal desde la
  ficha se lo crea**, y como su existencia es lo que decide que el alta está hecha (`profileComplete`), la
  aplicación ya no le pide el formulario: es Administración haciéndolo por él, y la ficha lo avisa. Lo
  del vehículo, sin perfil, se queda solo en la unidad. Al aprobar a
  un conductor en una unidad, su teléfono pasa a la unidad aunque ya tuviera uno (era el del anterior).
  Y `GET /api/flota`, que lee cualquier rol con sesión, **ya no manda** DNI, dirección ni nacimiento.
  **Desplegado en producción el 2026-09-29** (merge `77fc0d6`, PR #18, sin migraciones), con la tarjeta
  del cuestionario de manejo defensivo en la revisión de documentos; comprobado que sin sesión la flota,
  su exportación y la ficha responden 401.
- **Cada subida de un documento va a una ruta nueva** (`_ruta_unica`, desde el 2026-09-29): la ruta era fija
  por unidad y campo, así que reemplazar sobrescribía el mismo archivo y la ficha seguía enseñando el
  anterior —la página guarda cinco minutos la URL firmada de cada ruta—. El archivo reemplazado se queda
  en el bucket sin nada que lo señale; si el espacio llega a importar, habrá que limpiarlos. En los
  documentos de dos caras **«Completo» va primero** (la gente subía el DNI entero en «Delante») y, con
  él subido, delante y detrás quedan bloqueadas (`caraBloqueada`); pegar o arrastrar va a «Completo»
  salvo que ya se empezara por caras sueltas.
  **Administración puede quitar un archivo mal subido** (`POST /api/admin/driver/documento/eliminar`, desde
  el visor de la revisión, por cara): rechazar solo le pide al conductor que lo arregle y el archivo erróneo
  se quedaba. Deja el campo en `None` —así todo lo lee como «sin subir» y el guardado por diferencias
  escribe un valor, no un borrado—, quita su revisión y avisa al conductor. El archivo se borra del bucket
  **solo si está en la carpeta de su unidad y nada más lo señala** (`_archivo_solo_suyo`): la ruta sale del
  perfil, que escribe el propio conductor, y sin esa comprobación podría apuntar su documento al de otra
  unidad para que Administración lo borrara.
  **Las fotos del conductor —la de perfil y la del vehículo— también las cambia Administración** desde la
  ficha (`POST /api/admin/driver/foto`, por padrón): la de perfil va a la carpeta de fotos de perfil **del
  conductor**, no a la de quien la sube (`/api/documentos/subir` usa siempre la del que sube); la del
  vehículo, a la de su unidad.
  **Desplegado en producción el 2026-09-29** (merge `198fc50`, PR #19, sin migraciones), con la ficha del
  conductor reorganizada; comprobado que sin sesión eliminar, subir y cambiar fotos responden 401.
- **El conductor escribe hasta cuándo vale su SOAT, su licencia y su revisión técnica** (desde el
  2026-09-29, pedido del usuario): en el alta y en su portal, junto a la foto, **obligatoria** —la de la
  revisión, solo si la sube, porque un vehículo nuevo no la tiene; la tarjeta de propiedad no vence—. Van
  al perfil como `soatVence`, `licenciaConducirVence` y `revisionTecnicaVence` y a la unidad como
  `soat`, `licencia` y `revision`, que es de donde lee el semáforo y los contadores del panel de Gestión de
  Flota (`_VENCE_EN_PERFIL`, con copia en los dos sentidos como el resto de `_ESPEJO_EN_PERFIL`). El
  servidor también la exige cuando sube el conductor (`_fechas_del_perfil`), no cuando sube Administración,
  que pone la suya en la ficha; y al aprobar a un conductor en una unidad, sus fechas pasan a ella.
  **Subir un documento ya no manda a la cola de Accesos a un conductor activo**: solo vuelve a «Pendiente
  Revisión» quien estaba en «Documentos Observados» (le pasó a la K-163 y la K-170 al subirles documentos
  desde la ficha). La lista de Accesos lleva el `unidad_id` de cada cuenta —sin él, aprobar pedía un padrón en
  blanco y subir un documento desde ahí no sabía su carpeta—, y un conductor sin unidad recibe lo que sube
  Administración en su carpeta personal (`_carpeta_para_la_subida`). **Desplegado en producción el
  2026-09-29** (merge `7b32b44`, PR #20, sin migraciones).
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
  **Una programación se puede borrar** (desde el 2026-09-28, `POST /api/programador/plan/borrar`,
  [supabase/013_borrar_y_rehacer_programacion.sql](supabase/013_borrar_y_rehacer_programacion.sql)): solo
  un día de hoy en adelante y sin viajes marcados por los conductores —la base lo rechaza con 409 si no—, y
  empezar de cero es borrar y volver a crear. Hizo falta porque **la aplicación local trabaja contra la base
  real**: un plan de prueba de mañana les llega como real a los conductores de esas unidades. Hubo un
  «Rehacer» aparte y se quitó: era borrar y crear en un paso, y confundía. Queda abierto (decisión de
  producto) si hay que bloquear el borrado de un día cuyo primer servicio ya empezó aunque nadie haya
  marcado todavía: marcar es nuevo y «sin marcas» dice poco.
  **Desplegado en producción el 2026-09-28** (merge `6988f58`, PR #17), junto con el mapa de Google, la
  ventana 10:00 y el aviso de lo ya cargado en la carga del histórico; la 013 y la 014 ya estaban aplicadas.
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
- **La IA de duración: CatBoost** (desde el 2026-09-29, pedido del usuario: el ruteo tiene que integrar
  una IA, según su arquitectura del 21/9 —CatBoost predice, VROOM organiza, el humano resuelve lo
  demás—). Es la primera pieza: **estima cuánto va a durar de verdad cada servicio del plan**, y la
  tarjeta del servicio lo enseña como «Estimación de la IA» junto a la duración medida de la tabla,
  **no en su lugar** (la tabla es un hecho; esto, una predicción). En un RECOJO dice a qué hora salir
  para estar en la sede antes del turno; en una SALIDA, hacia qué hora termina de repartir. No decide
  nada todavía: ni el motor de inserción ni nadie lo usa para asignar.
  - **Los datos personales no salen de la base.** Se entrena con `muestras_de_duracion()`
    ([supabase/015_muestras_de_duracion.sql](supabase/015_muestras_de_duracion.sql), solo
    `service_role`): una fila por servicio con recuentos, kilómetros y tiempos, sin DNI ni
    coordenadas. Bajar el histórico entero a un equipo para entrenar lo frenó el control de permisos,
    y es mejor así: se puede reentrenar desde cualquier equipo.
  - **Entrenar**: `python scripts/entrenar_duracion.py --revisar` (mide) o `--escribir` (además
    exporta), con CatBoost instalado (`scripts/requirements-modelo.txt`, **no** va a Vercel: pesa
    97 MB). El modelo se exporta a **Python puro** en `frontend/api/modelo_duracion/` (tres modelos
    —mediana y cuantiles 10 y 90—, ~1,2 MB cada uno, generados: no editar) y lo lee
    [frontend/api/estimador_duracion.py](frontend/api/estimador_duracion.py), que construye las
    características **igual** al entrenar y al estimar. Reentrenar es repetir `--escribir` y desplegar.
    Si el paquete no viajara con la función, `estimar` daría `None` sin avisar: **`GET /api` (público)
    dice `estimacion_duracion: true|false`**, comprobado sin cargar el modelo, y es lo que se mira tras
    desplegar.
  - **Lo medido** (última semana cargada, que el modelo no vio): en RECOJO, error medio **17,2 min
    frente a 20,5** de la tabla de medianas; en SALIDA casi empata (18,2 frente a 19,2). La SALIDA se
    mide desde que sale de la sede: medida desde el arranque metía la espera y todo predecía peor. La
    banda la calibra una semana aparte (conformal por cuantiles): sin calibrar prometía el 80% y
    acertaba el 67%; calibrada acierta el 80%. Salir a la hora que dice deja en la sede antes del turno
    el 87% de las veces. La pantalla enseña **esas cifras medidas**, no las prometidas, y con menos de
    cinco servicios de la misma ruta y hora lo avisa con el error que se midió en ese caso (22 min).
    **Más historial no lo mejora**: de 7 a 14 días el error baja; de 14 a 24, no. Lo que queda son
    esperas y tráfico del día, que el reporte de la intranet no registra; las marcas de «A bordo» de
    los conductores (`ejecucion_viajes`) sí traerían la hora real de cada recojo.
  - **El exportado tiene que dar lo mismo que CatBoost, y no lo daba por dos cosas**: el hash de una
    «Ñ» (BREÑA) y los cortes de los árboles, que el exportado escribe con nueve cifras y compara en
    doble precisión (un servicio de justo 12,49 km caía del otro lado). Se resuelven quitando tildes y
    todo lo que no sea ASCII (`normalizar`) y pasando números y cortes a float32 (`ajustar_cortes`).
    El script lo **comprueba servicio a servicio** tras exportar y se para si difieren.
  - El distrito no entra: sin él predice igual, y el plan no lo trae. La unidad es lo que más pesa,
    después el turno y la cobertura.
  - **Desplegado en producción el 2026-09-30** (merge `a8b3577`, PR #21, con la 015 ya aplicada):
    `GET /api` dio `estimacion_duracion: true` —el paquete viajó con la función— y el plan sin
    sesión responde 401.
  - **Siguiente pieza**: VROOM, hecha: ver «La IA que organiza el día».
- **La IA que organiza el día: VROOM, «Proponer con IA»** (desde el 2026-09-30, pedido del usuario). En
  la programación, el botón **Proponer con IA** reorganiza unidades y orden de recogida del día y lo
  compara con el plan actual; **no cambia nada hasta «Aplicar»**, que pide confirmación, y después se
  deshace con un botón. La lógica está en [frontend/api/ruteo_vroom.py](frontend/api/ruteo_vroom.py)
  (VROOM con `pyvroom`, que va en `requirements.txt`: 4,7 MB y sin servidor aparte) y
  [frontend/api/propuesta_ia.py](frontend/api/propuesta_ia.py) (qué del plan se toca y qué no); los
  endpoints son `POST /api/programador/plan/proponer` (solo lee) y `.../plan/aplicar-propuesta` (solo
  admite `mover` y `ordenar`, queda en el historial). `scripts/probar_vroom.py` usa la misma lógica
  sobre días ya ejecutados.
  - **Reglas, confirmadas por el usuario el 2026-09-30** a partir de lo que ya se hace: a bordo como
    mucho **90 min** (hoy el 99% de los RECOJO va ≤ 80 y el 94% de las SALIDA ≤ 90); en RECOJO, en la
    sede **al menos 10 min antes** del turno y recogido **como mucho 1 h 45 antes**; **sin margen fijo**
    entre servicios (hoy la mediana es 6 min y el 82% de las unidades hace dos o más al día). Más una
    práctica medida: **en la sede como mucho 45 min antes** (el 99% llega ≤ 42). Se planifica con **10
    min de colchón** en cada una. En Postgres, la fecha de un servicio es **la de su turno**: con la de la
    jornada, las unidades se solapaban consigo mismas 151 veces; con la del turno, 3.
  - **Turno por turno, un viaje por unidad y turno.** Resolviendo el día de una vez, VROOM subía a
    alguien de las 06:00 mientras dejaba a los de las 05:00 (116 personas en un día), y a veces hacía dos
    viajes del mismo turno con la misma unidad, que el plan no puede guardar. Ahora cada turno se
    resuelve aparte, en orden; una unidad queda libre donde acabó; si VROOM propone un segundo viaje, se
    conserva el que lleva más gente y el resto se vuelve a resolver con las unidades que aún no salieron.
    Quien vive tan lejos que ni solo baja de 80 min va igual, con el viaje más corto, como **excepción**.
  - **Tiempos del propio histórico, sin API de mapas**: entre dos recojos seguidos la distancia sí
    explica el tiempo (R² 0,46 sobre 7.917 tramos, frente al 0,11 del servicio entero): **1,7 min/km
    más ~5 min por parada**, igual de noche que de madrugada; entrar en la sede, 3 min, y bajarse, 3.
    Con eso la duración de un servicio sale **sin sesgo** contra lo real (−1 a −3 min, error típico de
    7 min). **Por la tarde no vale** (85 tramos, R² 0,07). La sede de Bellavista no tiene dirección
    pública y se ajustó con los datos en (-12,055; -77,1075), R² 0,69 del último tramo; la de Magdalena
    (Av. Faustino Sánchez Carrión 465) no se ajusta bien. **Por eso solo se reorganiza Bellavista**, el
    77% de los servicios (`SEDES_UBICADAS`); lo demás le ocupa el rato a su unidad.
  - **Lo que no se toca**: un servicio con alguien sin domicilio ubicado se queda como está (no se sabe
    dónde recogerle, y moverlo sería inventar); en el plan del 26/9 eran 52 de Bellavista, con 83
    personas sin ubicar. Los **pendientes** los sigue proponiendo el motor de inserción. Las unidades son
    las del plan, en su horario de ese día.
  - **Resultado sobre seis días ejecutados (5, 11, 15, 19, 24 y 28 de agosto)**, lo real y lo propuesto
    medidos con el mismo modelo y los mismos pasajeros: **28-39% menos unidades y 21-27% menos horas**
    (46 → 33 unidades el 19/8), nadie sin asignar, 1-5 s de cálculo. «Menos unidades» sale también con
    menos horas que «menos horas», y es la opción por defecto. **El precio es el tiempo a bordo**: la
    mediana sube de ~28 a ~40 min, aunque desaparecen los extremos (en la realidad, 91-136 min; con
    VROOM, nadie pasa de 80). Con máximo 70 min el ahorro baja al 20-28% y hay quien no cabe.
  - **Comprobado contra la base, en una transacción que se deshizo**: aplicar la propuesta del 26/9
    movió a 179 personas sin perder ni duplicar filas, y deshacerla dejó el plan **idéntico**, orden
    incluido.
  - **Los datos personales no salen de la base en el análisis**: `probar_vroom.py` recibe paradas con
    un número opaco y la matriz de kilómetros calculada en Postgres. Bajar el histórico con DNI y
    domicilios lo frenó el control de permisos.
  - Qué objetivo usar y si se acepta rehacer rutas en vez de «seguir el orden anterior» es **decisión
    de los dueños**; la herramienta deja elegir y no aplica nada sola.
  - **Desplegado en producción el 2026-09-30** (merge `e0eef72`, PR #22, sin migraciones): `GET /api`
    sigue con `estimacion_duracion: true` y, sin sesión, proponer y aplicar responden 401. Que `pyvroom`
    cargue dentro de la función solo se ve al calcular una propuesta con sesión: `GET /api` no lo dice.
    **Comprobado en producción el 2026-09-30** con la sesión del usuario, sin aplicar: el plan del 26/9
    dio 42 → 21 unidades en lo que se reorganiza (51 → 46 en la sede), 67,8 → 51,2 h, a bordo mediana
    33 → 38 min y máximo 142 → 80, 6 sin sitio y 52 servicios intactos por 83 personas sin ubicar,
    calculado en **2,3 s** dentro de Vercel.
- **El orden de recogida se arrastra** (desde 2026-09-26): sobre un plan, cada fila de la tabla del servicio
  lleva el asa de seis puntos y dos flechas —arrastrar con trackpad es impreciso y con teclado imposible—, y
  se guarda al soltar con `ordenar`. El orden nuevo se enseña al instante y vuelve atrás si el guardado
  falla; `editar` devuelve si se guardó precisamente para eso. Verificado disparando los eventos de arrastre
  del navegador; **un arrastre físico con ratón no se pudo probar** porque la automatización no inicia el
  arrastre nativo. En el histórico no hay asa: lo que pasó no se reordena.
- **La gente también se arrastra entre servicios y pendientes** (desde el 2026-09-30, pedido del usuario:
  «poder seguir arrastrando en novedades y pendientes» una vez programado). Una fila se suelta en otro
  servicio (`mover` + `ordenar`, en la posición que menos alarga el recorrido, la del motor), un pendiente
  en cualquier servicio (`agregar` + `ordenar`, también donde el motor no lo propone) y una fila en
  «Novedades y pendientes» la deja **pendiente sin baja** (`a_pendientes`, en la 016: la fila se marca
  retirada, como una novedad de cambio, y el pendiente sale con motivo `devuelto` —«Por recolocar»— y «Iba
  en K027»). Qué se deja soltar está en
  [model/arrastrePlan.js](frontend/src/programador/model/arrastrePlan.js): **no** a otro sentido, otra sede
  ni donde ya va; **con aviso que se confirma**, a otro turno o pasándose de capacidad, porque aquí decide
  una persona y el arrastre es para las excepciones. Mientras se arrastra, cada tarjeta dice si acepta y
  por qué no. **«Mover»** en cada fila hace lo mismo sin arrastrar (teclado, o destino lejos en la lista),
  con las opciones del motor. La 016 también arregla dos cosas de la base: `mover` reutiliza la fila si la
  persona ya estuvo retirada en el destino (antes lo ignoraba) y `reponer` no devuelve a nadie que ya va en
  otro coche del mismo turno. Y **`editar` avisa cuando la base aplicó cero cambios** en vez de anunciarlo
  como guardado. Verificado en el navegador sobre el plan del 26/9 con el guardado interceptado (sin tocar
  la base), y las acciones de la 016 contra la base en una transacción deshecha
  (`scripts/probar_funciones_plan.py --con-migracion`).
- **«Crear programación» deja elegir de qué día copiar** («Copiar de», desde el 2026-09-30): el servidor
  ya aceptaba `desde` y la pantalla siempre copiaba el último ejecutado. Se marcan los días que caen en el
  mismo día de la semana, porque un domingo lleva ~390 servicios y un laborable ~800.
  **Desplegado en producción el 2026-09-30** (merge `28e83d9`, PR #23), con la 016 aplicada antes por el
  usuario y `probar_funciones_plan.py` en verde contra la base (30/30); comprobado que sin sesión editar,
  proponer, aplicar y cargar el histórico responden 401.
- **Lo que encontró la revisión independiente de la 016, arreglado en la 017**
  ([supabase/017_arrastre_sin_perder_pendientes.sql](supabase/017_arrastre_sin_perder_pendientes.sql)):
  - **Un pendiente solo se quita de la vuelta que se resuelve.** `agregar`, `mover` y `reponer` borraban
    todos los pendientes de la persona ese día. Así, dejar pendiente la SALIDA de alguien y mover después su
    RECOJO la hacía desaparecer: sin coche y fuera de pendientes. Ya pasaba con dos novedades de la misma
    persona. Ahora `agregar` manda el pendiente que resuelve (`pendiente`: turno y sentido guardados) y
    los demás quitan los de su sentido y turno. El turno cuenta con un minuto de tolerancia
    (`_mismo_turno`), porque 14 de 15.626 vueltas del histórico son una segunda del mismo sentido el
    mismo día.
  - **Cada cambio dice si se aplicó** (`resultados`) y el `ordenar` de un arrastre exige que el
    movimiento entrara (`requiere_anterior`). Con el `mover` ignorado, el `ordenar` tocaba filas igual
    y la pantalla anunciaba «va en K027» sin haberlo movido. La pantalla lo lee con
    [model/resultadoEdicion.js](frontend/src/programador/model/resultadoEdicion.js).
  - `agregar` tampoco pone a nadie en dos coches del mismo turno y sentido. Una fila que vuelve pierde la
    nota vieja. Al reemplazar un día, entre filas repetidas se queda la más completa. Y no se arrastra
    mientras se guarda, porque la relectura podía desmontar la fila arrastrada.
  - Probado contra la base en una transacción deshecha: `probar_funciones_plan.py --con-migracion`, 35/35.
    La 017 es compatible en los dos sentidos: el código anterior ignora `resultados` y el nuevo, sin la
    017, se juzga por el total como antes.
  - **Desplegado en producción el 2026-09-30** (merge `964c258`, PR #24), con la 017 aplicada antes por el
    usuario y `probar_funciones_plan.py` en verde contra ella (35/35); sin sesión, editar, proponer y
    aplicar siguen en 401.
- **Un domicilio sin resolver no es el (0, 0).** El mapa del servicio filtraba con
  `Number.isFinite(Number(x))`, y `Number(null)` vale 0: cada agente sin ubicación se pintaba en el golfo de
  Guinea y el mapa se alejaba a medio mundo. Con 352 personas aún sin ubicar pasaba en casi cualquier
  servicio. Para eso existe `hasCoordinate` en el modelo: **usarlo siempre** que se lea una coordenada.
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
  - **El plan ya llega al conductor y al cliente** (desde el 2026-09-27; hasta entonces sus portales
    leían ese tablero vacío y lo que decidía el Programador se quedaba en su pantalla). Ver «El plan llega
    al conductor y al cliente» más abajo.
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
    declarada de un servicio del histórico—. **Y la «KV-026» de la base MASIVO es la «V026» de la
    intranet** (desde el 2026-09-27, [supabase/012_unidades_kv.sql](supabase/012_unidades_kv.sql)): la
    intranet no escribe nunca «KV», 29 de sus 33 V### tienen su KV-### con el mismo número y lo más que
    llevó cada una cabe en la capacidad que declara la base (las VAN de 10 llevaron 10; las SUV de 6,
    6). La regla vive en tres sitios que **tienen que coincidir**: `_clave_de_vehiculo`, `fleetKey` y
    `_clave_normalizada`. Antes solo cruzaban 41 de 79 y las V### parecían unidades sin dar de alta.
    **Desplegado en producción el 2026-09-28** (merge `b78d1bf`, PR #16, con la 012 aplicada y
    `probar_servicios.py` en verde contra la base), junto con el DNI con y sin cero y los arreglos de
    las dos revisiones (el alta del conductor sin sesión, la propiedad sobre la cuenta resuelta).
    Siguen sin cruzar algunas M### y unas pocas unidades nuevas: la pantalla lo dice en vez de enseñar
    ceros.
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
- **Configuración**: las credenciales de Supabase salen **solo** de variables de entorno (comprobado el
  2026-09-27: `_first_env` no tiene valor por defecto y no queda ninguna URL ni clave escrita en el código).
  El único literal que queda es el de `JSON_PE_TOKEN`: hay que regenerarlo en JSON.pe, ponerlo en Vercel y
  entonces retirarlo. `JSON_PE_TOKEN` y `GEMINI_API_KEY` están documentados en `.env.example`.
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
  `/api/auth/logout`, el manejo de 401 en el frontend y el índice de sesiones. **Desde el 2026-09-27 todos
  los endpoints piden sesión** salvo `GET /api`, el login, el registro y el cambio de contraseña (que
  exige la actual); los tres llevan tope de intentos (ver «Tope de intentos»). El alta del conductor
  (`POST /api/driver/onboarding`) se quedó fuera hasta el 2026-09-27 —cualquiera podía reescribir el
  perfil y el correo de otro y dejarlo «Pendiente Revisión»—; ahora solo sobre la propia cuenta y sin
  poder declararse el documento de otra (409). Los que faltaban **no eran «todos de lectura»**, como se creía: `resubmit-docs`
  dejaba a cualquiera cambiar los documentos de cualquier conductor —y, mandando `revision_docs` como si
  fuera un documento, aprobárselos solo—, `request-update` y `mark-read` escribían, `actualizar-pasajero`
  subía fotos a un bucket público, y `GET /api/conductor/info/{unidad}` y `/api/flota/export` entregaban
  documento, dirección y teléfonos de los conductores a cualquiera (los padrones se adivinan). La ficha
  del conductor la ven Administración, el Cliente (su panel de auditoría la enseña, con DNI, dirección y
  teléfonos: **decisión de producto pendiente de confirmar**) y el propio conductor, solo la suya.
  `resubmit-docs` solo acepta campos de documento (`_CAMPOS_DOCUMENTO`, con una prueba que la compara con
  `src/constants/documentosConductor.js`). El WebSocket exige la cookie y que uno se conecte como sí
  mismo. Para comprobar que no queda ninguno abierto, la prueba
  `test_endpoints_that_never_asked_for_a_session_now_do` los llama sin cookie.
  **La propiedad se comprueba sobre la cuenta que se va a cambiar, no sobre lo tecleado**
  (`_exigir_su_cuenta`): `resubmit-docs`, `request-update` y el correo del conductor comprobaban que el
  texto fuera «de» quien pregunta y cambiaban la cuenta que devolvía la búsqueda, que con dos cuentas del
  mismo documento era la otra. Al añadir un endpoint que busque una cuenta por identificador, lo mismo.
  **El DNI se busca con y sin sus ceros** (la importación se los quitó a 25 conductores), pero lo tecleado
  tal cual gana y una variante que señala a dos cuentas no resuelve ninguna (`_formas_de_identificador`,
  igual en `get_user_by_identifier` y en el índice de acceso). Borrar o rechazar una cuenta cierra sus
  sesiones.
  **Desde el 2026-09-27 las sesiones viven en `public.sesiones`**, una fila por sesión
  ([supabase/007_sesiones.sql](supabase/007_sesiones.sql), almacén en
  [frontend/api/sesiones.py](frontend/api/sesiones.py)). Antes vivían dos veces dentro de la fila única
  —`_auth_sessions` en cada usuario y el índice `__sessions__`— y **abrir una reescribía la columna
  `usuarios` entera**: como cada instancia de Vercel escribe su copia en memoria, dos inicios cercanos se
  pisaban y ganaba el último, sin error. Ahora iniciar sesión es un `insert`, validar es leer una fila por
  clave primaria (o nada, con la caché de la instancia de `DB_CACHE_TTL_SECONDS`) y cerrarla es marcar la
  fila. **Comprobado con la huella `md5` de la fila compartida: idéntica antes y después de entrar y salir.**
  `/api/auth/me` —se llama al abrir la aplicación— dejó de descargar el estado completo. La «última
  conexión» de Accesos y los «Usuario inició sesión» del historial salen de la tabla (las filas se
  conservan 90 días como registro de accesos); antes se escribían en la fila y además los accesos de los
  conductores expulsaban del historial, limitado a 500, las acciones de administración. **Solo** de la
  tabla: el `last_login` que quedó escrito en 24 conductores es de las comprobaciones de las importaciones
  (16 «entraron» el mismo minuto y siguen con la provisional), y con él «Activos» enseñaba como activos a
  conductores que nunca habían entrado. En esa misma pantalla la columna de correo enseña `correo`
  (`_correo_propio`), no la clave de la cuenta: en los importados la clave es un
  `apellido.apellido@kapital.com` inventado, y las acciones siguen operando sobre ella.
  **La sesión pertenece a la clave de la cuenta, no al campo `identifier`**: 124 de las 128 cuentas —casi
  todos los conductores— no lo llevan escrito. Usar siempre `_clave_de_cuenta(user)`. El código viejo usaba
  `identifier`, dejaba esas sesiones sin dueño y en cada petición de un conductor acababa descargando a
  todos los usuarios para encontrarlo. Hay prueba con una cuenta sin `identifier`, que es lo que las pruebas
  de siempre no cubrían porque sus usuarios de ejemplo sí lo llevan.
  Al añadir un gate nuevo, usar `require_session_owner`, y si se muta `rol`, `estado`, correo o unidad de un
  usuario **`await refrescar_sesiones_de(user)`**, o la instantánea quedará obsoleta y una desactivación no
  desactivará nada. Una revocación es inmediata en la instancia que la hace y tarda como mucho
  `DB_CACHE_TTL_SECONDS` (45 s) en las demás, igual que antes. Si la tabla no responde, se devuelve **503 y
  nunca 401**: una caída no puede echar a todo el mundo ni dejar entrar a nadie.
  Para comprobar el almacén contra la base real: `scripts/probar_sesiones.py`. **Desplegado en producción
  el 2026-09-27** (merge `bee7f21`, junto con la escritura por diferencias, los endpoints cerrados y el
  tope de intentos); `migrar_sesiones.py --aplicar` no encontró sesiones abiertas en el índice viejo.
  Comprobado en producción: sin sesión, todo lo cerrado responde 401, y un login fallido queda anotado
  en `intentos_acceso` con su origen. Volver a una versión anterior obligaría a todo el mundo a entrar
  de nuevo una vez, y nada más.
- **Tope de intentos** (desde el 2026-09-27): el login y el cambio de contraseña no tenían límite, y muchas
  cuentas de conductor conservan la provisional de la importación. En 15 minutos, más de **10 intentos a
  una cuenta desde un mismo origen**, **30 a una cuenta desde donde sea** o **50 desde un origen a
  cualquier cuenta** dan **429**, y agotado el tope **ni la contraseña correcta entra** (si no, seguir
  probando diría cuándo se acierta). El más bajo es por cuenta *y* origen a propósito: así quien adivina
  no puede dejar fuera a la persona, que sigue entrando desde su red. Se cuenta por **la clave de la
  cuenta**, no por lo tecleado (DNI, correo y clave son el mismo tope). Cada intento se **anota y se
  cuenta en un solo paso** (`registrar_intento()`, con un candado por cuenta y otro por origen) antes de
  comprobar la contraseña, y acertar borra los de esa cuenta **desde ese origen** (no los de quien la
  ataca desde otro): la primera versión contaba y anotaba por separado y una ráfaga simultánea pasaba
  entera; contra la base, 20 a la vez reciben 20 números distintos. **El registro, que es público, tiene
  su propio tope** —3 altas por origen y 5 en total cada 15 minutos—, mirado antes de leer nada, y ya no
  descarga el estado entero: comprueba si la cuenta existe por el índice de acceso y por todos sus
  alias (un conductor importado podía volver a darse de alta con su DNI). Sin tope, cualquiera podía
  llenar la fila única de cuentas y gastar la transferencia del plan. La promoción de «la primera
  cuenta» a Administración solo se decide con el índice lleno o una lectura completa: una instancia fría
  con la memoria vacía habría regalado el rol. Un
  contador en memoria no serviría en Vercel, así que van a `public.intentos_acceso`
  ([supabase/009_intentos_acceso.sql](supabase/009_intentos_acceso.sql), almacén en
  [frontend/api/intentos_acceso.py](frontend/api/intentos_acceso.py)), que solo guarda el SHA-256 de la
  clave y el de la IP, y borra lo de más de un día. La IP sale de `x-forwarded-for`, que en Vercel
  sobrescribe su proxy (fuera de Vercel se puede falsear). **Si la tabla no responde, se deja pasar** y
  queda en el log: el tope frena a quien adivina, no puede ser la razón de que nadie entre. Por eso sus
  llamadas van por `_pedir_sin_reintentos` —2 s, sin reintentos y sin contar para el cortacircuitos de la
  base—: con `_db_http_request`, un tope caído alargaba el login ~20 s y podía dejar la instancia en 503.
  Contra la base real: `scripts/probar_intentos.py`. La misma 009 quitó a `anon` y `authenticated` el
  permiso de leer `app_state`, que conservaban aunque la RLS sin políticas no les dejara ver ninguna fila.
  **Cambiar la contraseña desde «Mi perfil»** (`PUT /api/user/profile`) cuenta en el mismo tope desde el
  2026-10-01: con una sesión ajena abierta se podía probar la actual sin límite. Y una actual equivocada
  da **400, no 401**: el 401 es «la sesión ya no sirve», y el cliente cerraba la sesión de quien se
  equivocaba al teclear. Cualquier endpoint con sesión que compruebe una contraseña, igual.
  Y **el perfil pide la sesión antes de buscar la cuenta** (`GET` y `PUT /api/user/profile`): al revés,
  sin sesión daba 404 si la cuenta no existía y 401 si existía, y se podía averiguar desde fuera qué
  DNI o correos tienen cuenta. Al añadir un endpoint que busque una cuenta por lo que manda el cliente,
  comprobar la sesión primero. Lo mismo tenía `GET /api/admin/users`, y peor: sin sesión **cargaba todas
  las cuentas** (~255 KB de transferencia por llamada) antes de responder 403 o 401, que además decía si
  el correo era de Administración. Ahora pide sesión y rol antes de leer nada.
- **«Mi perfil» rehecho** (2026-10-01, pedido del usuario: «muy básico, no se ve profesional»):
  [src/perfil/](frontend/src/perfil/) con la lógica aparte y probada (`modeloPerfil.js`). Cabecera con
  foto, nombre, rol, cuenta y estado; los datos que no se editan van como texto y no como cajas grises; la
  foto y el nombre se guardan al momento; la contraseña se pide dos veces y lleva indicador de fortaleza
  que orienta sin exigir más que el servidor (4 caracteres). El conductor tiene además «Datos y vehículo»
  (cada dato con «Solicitar cambio» o «En revisión») y «Documentos». La capacidad ya no sale como
  «15 pax» a quien no la tiene, y el límite de las fotos dice 5 MB, que es el real (decía 2).
- **El plan llega al conductor y al cliente** (desde el 2026-09-27,
  [supabase/010_servicios_conductor_cliente.sql](supabase/010_servicios_conductor_cliente.sql)). Cada uno
  recibe solo lo suyo, filtrado en Postgres: `servicios_de_unidad()` para el conductor
  (`GET /api/conductor/servicios`: **hoy y mañana** en pestañas, porque los recojos con entrada de 00:00 a
  02:00 empiezan la noche anterior, y **ayer sin pestaña**, porque una salida de las 23:00 sigue dejando
  gente pasada la medianoche y sin ayer desaparecía a mitad de servicio) y `servicios_de_empresa()` para el
  cliente (`GET /api/cliente/servicios?fecha=`, de 31
  días atrás a lo programable). La unidad y la empresa **salen de la sesión**, no de la URL: un conductor no
  puede pedir otra unidad y un cliente no puede pedir otra empresa; Administración sí, pasándolas por
  parámetro. Medido con la compresión que ya usa PostgREST: **~2 KB** la lectura de un conductor y **~16 KB**
  la de un día entero del cliente (95 KB sin comprimir); el conductor relee cada 3 min y el cliente cada 2,
  solo con la pantalla visible. La empresa se reconoce por las **primeras palabras enteras de la sede**
  («TELEPERFORMANCE» en «TELEPERFORMANCE BELLAVISTA», pero no «TELE»: `_es_de_la_empresa()`,
  [supabase/011_ventana_y_empresa.sql](supabase/011_ventana_y_empresa.sql)). La primera versión comparaba
  un prefijo sin frontera de palabra y «TELE» abría a todo TELEPERFORMANCE.
  **El conductor marca quién subió** (`POST /api/conductor/servicios/marcar`, «A bordo» o «No se presentó»,
  y deshacer) y eso va a **`ejecucion_viajes`, no a `programacion`**: lo que se decidió y lo que pasó no se
  mezclan (por lo mismo que el plan va aparte del histórico). La marca se enlaza al plan por la clave
  natural (día, unidad, turno, sentido, persona), así que sobrevive a que el Programador vuelva a sembrar el
  día; `marcar_viaje()` comprueba que la fila siga en el plan y sea de esa unidad (si no, **404**, «ya no está
  en tu servicio») y que **ahora** esté entre 3 h antes y 6 h después del turno **de ese servicio**, en hora
  de Lima (si no, **409**). Esa ventana la decide la base desde la 011: antes solo la aplicaba la pantalla y
  por el API se podía marcar a las 08:00 como «no se presentó» a todo el turno de la noche siguiente. La
  marca la firma `_clave_de_cuenta(actor)`, no `identifier` (casi ninguna cuenta lo lleva), y las rutas
  nuevas **no responden sin sesión** aunque la exigencia esté apagada: no tienen clientes viejos. El pasajero se identifica por el `id` de su fila del plan:
  **al conductor no le llega el DNI de nadie**. **Al cliente no le llegan direcciones ni coordenadas** (sabe
  dónde vive su gente) **ni el documento, domicilio o teléfonos del conductor**: de la flota solo recibe
  nombre, placa, vehículo y capacidad. Por lo mismo `GET /api/conductor/info/{unidad}` —la ficha entera—
  **dejó de estar abierta al Cliente** (antes su panel la enseñaba, con documentos marcados «Subido» fueran
  reales o no y una foto de vehículo de stock). Es reversible si los dueños lo deciden, y era la decisión de
  producto pendiente. **Un conductor ya no puede cambiarse de unidad desde su perfil** (`PUT /api/user/profile`
  con otra unidad da 403, antes de tocar nada más): con eso veía y marcaba a los pasajeros de otro coche.
  **Y el registro público ya no acepta unidad ni empresa**: bastaba declararse de la K-027 al registrarse y
  que alguien pulsara «Aprobar» para ver los domicilios de sus pasajeros. La unidad la asigna
  Administración al aprobar con padrón (y la sesión se refresca **después** de asignarla, no antes), y la
  empresa de un cliente se pone a mano.
  **Documentos: el conductor con unidad ve sus servicios aunque le falten** (decisión del usuario,
  2026-09-27). Los importados de las bases no tienen ningún documento subido —123 de 124— y la puerta de
  documentos del portal los habría dejado a todos sin ver nada; son conductores que ya trabajan en la
  empresa. Ven un aviso fijo con lo que les falta y un botón para subirlo; lo pueden subir ellos o
  Administración en su nombre. Quien no tiene unidad sigue entrando por la pantalla de documentos.
  **El cliente no ve las altas sin histórico** en «sin unidad asignada»: `programacion_pendientes` no guarda
  la sede y sin histórico no se sabe de qué empresa son; enseñarlas daría nombres a otra empresa.
  **Qué significa el turno está medido, no supuesto**: en un RECOJO es la hora de entrada a la sede (el coche
  arranca ~85 min antes y llega ~22 min antes); en una SALIDA, la hora a la que sale de la sede. La pantalla
  **no enseña una hora estimada de recogida**, porque el plan no la tiene y sería una promesa. Solo se puede
  marcar de 3 h antes a 6 h después del turno. **Lo que falta para los conductores reales es de datos, no
  de código**: de las 52 unidades que operaron la última semana cargada (del 16 al 22 de septiembre),
  **6 no tienen cuenta de conductor** —V098, V232, V233, K230, M864 y M018— y llevan el 6,8% de los viajes
  a bordo. Se llegó a decir que eran 29 y el 77%: era un error de cruce, no de datos, porque 23 de ellas
  son las KV-### de la base MASIVO (ver «Los códigos de vehículo» en §2). De las seis, KV-098 y K-230
  figuran en la base general del usuario como «Baja» aunque siguieron operando. El Programador les asignará
  servicios que nadie recibe hasta que se importen sus conductores (con
  `scripts/importar_base_motorizados.py`; obligatorias nombre, DNI, padrón y placa, con el padrón escrito
  como en la base —KV-098 vale por V098—). Y 78 de las 124 cuentas son de unidades que no operaron esa
  semana (sobre todo Sharf y Remisse): entran, pero no les llega nada mientras su unidad no esté en el plan. Una unidad con dos
  conductores por turnos daría todos sus servicios a los dos: hoy no se distingue quién hace cada turno.
  **Desplegado en producción el 2026-09-27** (merge `4341250`, PR #15): sin sesión las rutas nuevas dan
  401 y las retiradas (`mis-rutas`, `cliente/rutas`, `actualizar-pasajero`) 404.
  Las pantallas son nuevas: la del conductor ([frontend/src/conductor/](frontend/src/conductor/)) está pensada
  para el teléfono —próximo servicio arriba, paradas en orden con «Cómo llegar» (Google Maps y Waze, al punto
  si está resuelto y si no a la dirección escrita), un modo guía de una parada cada vez, el botón «atrás» del
  teléfono funcionando y el SOS con confirmación—; la del cliente
  ([ClientPortal.jsx](frontend/src/ClientPortal.jsx), [frontend/src/cliente/](frontend/src/cliente/)) sirve en
  el escritorio y en el teléfono. **El SOS decía «Central notificada» aunque la petición fallara** (un `fetch`
  no lanza con un 4xx/5xx); ahora solo lo dice si el aviso llegó, y si no pide llamar a la central. **El
  cliente no tenía cómo cerrar sesión**: su portal se pinta sin la barra de navegación. Contra la base real:
  `scripts/probar_servicios.py` (31 comprobaciones dentro de una transacción que se deshace; mueve un
  pasajero a «ahora» para probar la ventana). Todo lo anterior salió de una revisión independiente antes de
  publicar, con una prueba que falla con el código previo por cada hallazgo.
- **Escritura por diferencias** (desde el 2026-09-27): en `V2_COMPAT` ningún guardado reescribe
  `app_state.usuarios`. Antes cada `persist*` mandaba un PATCH con la columna entera desde la copia en
  memoria de la instancia —hasta 45 s vieja, sin candado entre instancias— y deshacía en silencio lo que
  otra instancia hubiera escrito entretanto. Ahora `_guardar_cambios` compara la memoria con la **base**
  (`_base_remota`: la huella JSON de cada clave tal como esta instancia la leyó), calcula solo lo que cambió
  ([frontend/api/escritura_estado.py](frontend/api/escritura_estado.py)) y lo manda a
  `guardar_estado()` ([supabase/008_guardar_estado.sql](supabase/008_guardar_estado.sql)), que lo aplica
  sobre la fila actual con `for update`. Cuentas y flota van **por campo** (tres niveles: cuenta → campo →
  subcampo; flota → unidad → campo), avisos y actividad se **fusionan por `id`**, y `__login__` se mantiene
  alias a alias sin robarle uno a otra cuenta. Medido contra la fila real: cambiar un campo son **410 bytes
  en vez de 255 KB**, y un cambio simultáneo desde otra instancia sobrevive. Dos cosas a respetar:
  **toda carga nueva que meta algo de la fila en memoria debe llamar a `_recordar_base`** (o
  `_recordar_base_de_cuentas` si reemplaza las cuentas), porque una clave reservada que no está en la base
  no se escribe nunca —en memoria sería el valor vacío del arranque— y una cuenta que está en la base pero
  no en memoria se toma por borrada. **Y ningún endpoint puede modificar algo sin haberlo cargado**: lo que
  no se leyó no se escribe (queda un `[Kapital] … sin escribir` en el log), y una cuenta que no estaba en
  la base se trata como nueva y va con `si_ausente`, de modo que si ya existe el guardado entero se
  rechaza con **409** en vez de sustituirla (con el mismo valor pasa: es un reintento de esa misma
  escritura), y la instancia recarga la memoria en el acto para que la cuenta fantasma y lo que la
  petición fallida añadió no se cuelen en el guardado siguiente. Pasaba de verdad: revisar un documento en
  una instancia fría no cargaba nada, inventaba una cuenta vacía con la clave del conductor y la guardaba
  encima de la real, contraseña incluida (lo encontró una revisión independiente antes de desplegar; hay
  prueba). Una lectura que se cuele entre el cálculo y la escritura sube la generación de las claves que
  reemplaza (`_generacion_de`; una lectura de todas las cuentas, `_epoca_cuentas`; una completa,
  `_epoca_base`), y la escritura no apunta en la base esas claves, pero sí las demás. La flota se verifica
  solo en los campos cambiados. **Si un guardado falla con `EscrituraSinDeshacer`** —el 409
  (`EscrituraRechazada`) o una relectura que no confirma (`EscrituraSinConfirmar`)—, la memoria ya está al
  día con la base y quien llama **no debe deshacer nada**: todo `except Exception` que restaure valores
  tras un guardado tiene que dejarla pasar antes. Pasó: cuando dos administradores daban de alta al mismo
  conductor, la vuelta atrás del segundo quitaba de memoria la cuenta real del primero y el siguiente
  guardado la borraba. Y
  hay un tope: un guardado que borraría más de 50 cuentas o unidades se rechaza con 503, por ser casi
  seguro una copia a medias. El modo `OLD` sigue con el PATCH de siempre.
  Los scripts de `scripts/` que escriben la fila entera (importar bases, cifrar contraseñas) siguen
  pudiendo pisar lo que pase a la vez: correrlos con la aplicación tranquila. Para comprobar contra la base
  real: `scripts/probar_guardar_estado.py` (la función, dentro de una transacción que se deshace) y
  `scripts/probar_escritura.py` (el camino entero del backend, con una cuenta de prueba que se borra).

## 2 bis. Escalabilidad: lo medido y lo que queda (2026-09-27)

Lo que se revisó cuando el usuario preguntó si la aplicación aguantará a muchos usuarios a la vez:

- **Planes: Vercel está en Hobby y Supabase en el gratuito** (comprobado en sus paneles). Vercel Hobby es para
  uso personal y no comercial según sus condiciones. El gratuito de Supabase tiene tope de tamaño y de
  transferencia, no trae copias de seguridad diarias y pausa los proyectos inactivos: el proyecto viejo
  `kapital-routing` está pausado. **El usuario lo presentará a los dueños** junto con qué planes pagar.
- **Datos**: la base ocupa 28 MB y el histórico crece ~356 KB por día (~130 MB al año). No es lo primero
  que se queda corto.
- **Hecho — sesiones fuera de la fila única** (ver «Sesiones» en §2).
- **Hecho — los guardados ya no se pisan** (ver «Escritura por diferencias» en §2). Usuarios, flota, avisos
  y actividad **siguen viviendo en la fila única**, pero cada guardado escribe solo lo suyo. Lo que queda es
  de tamaño, no de corrección: leer la fila entera cuesta ~255 KB y crece con cada cuenta. Con cientos de
  cuentas más conviene pasarlas a tablas; el código tiene a medio hacer un modo «normalizado»
  (`app_users`, `fleet_units`, `notifications`), pero esas tablas no existen en la base y nunca se activó.
- **El tiempo real no funciona en producción, y los avisos llegan por sondeo**: los portales abren un
  WebSocket en `/ws/…`, pero en Vercel esa ruta devuelve la página (comprobado) y una función serverless
  no mantiene conexiones abiertas. Lo que de verdad entrega los avisos es el sondeo de respaldo, cada 90 s
  con la pestaña visible. Desde el 2026-09-27 los portales dejan de reintentar el WebSocket tras tres
  intentos sin abrir (`WS_MAX_INTENTOS_SIN_ABRIR`), en vez de insistir cada 30 s para siempre, y el
  apretón de manos exige sesión. **Pendiente de decidir**: si hace falta aviso inmediato (un SOS no
  debería esperar 90 s), la vía es Supabase Realtime con canales que solo lleven «hay novedades» y el
  dato por el API con sesión; exige publicar la clave pública del proyecto en el frontend, cosa que hoy
  se evita a propósito.

## 3. Stack Tecnológico

**Frontend** (`frontend/`, Vite + React 19)
- `lucide-react` — iconografía (obligatorio, ver reglas de diseño)
- `recharts` — dashboards/KPIs
- `react-hot-toast` — notificaciones
- `react-dropzone` — carga de archivos
- `xlsx` — asignación masiva de rutas vía Excel
- **Mapa de cada servicio del Programador: Google Maps incrustado, sin clave** (desde el 2026-09-28,
  [mapaDeGoogle.js](frontend/src/programador/model/mapaDeGoogle.js)). El usuario no quiere pagar Google Cloud
  para ver un mapa, y el mapa de Google con JavaScript exige tarjeta y cuenta de pago activa aunque no se
  pase de lo gratuito. El visor incrustado (`maps.google.com/maps?...&output=embed`) no pide nada: con dos o
  más domicilios Google traza el camino real por ellos en el orden del servicio (medido hasta 20 paradas).
  **No está documentado como API**: si Google lo retira, la salida oficial es la Maps Embed API (gratuita e
  ilimitada, con clave). Solo van coordenadas —ni nombres ni documentos—, y solo de quien tiene punto:
  **se probó a mandar la dirección escrita de quien no lo tiene y Google no encontró ninguna de cuatro
  reales** (manzana y lote; una calle de SJL la llevó al Estadio Nacional), y una parada que no encuentra
  rompe la ruta entera. Buscar direcciones con Google no mejora eso gratis; lo que las resuelve es el GPS.
- `leaflet` / `react-leaflet` — solo queda el mapa en vivo (`LiveMap.jsx`) del tablero heredado
  (`DashboardView`, que usan los roles administrativos que no son Administración ni el Programador).
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
   por el usuario y descrito en §2 («El motor de inserción»). No es un optimizador. **Desde el 2026-09-29
   hay CatBoost** para la duración de cada servicio y **VROOM** para proponer el día («Proponer con
   IA»), los dos pedidos por el usuario (§2). OSRM sigue sin instalar: los tiempos salen del histórico.
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
   Los endpoints y el handshake del WebSocket están cerrados desde el 2026-09-27 (ver «Sesiones» en §2),
   y el login y el cambio de contraseña tienen tope de intentos (ver «Tope de intentos» en §2). El usuario
   sembrado con contraseña por defecto que inyectaba `_decode_full_state` ya está retirado, y hay una prueba
   que falla si vuelve a aparecer una contraseña escrita en el módulo.
4. Retirar el literal de `JSON_PE_TOKEN` tras regenerarlo y ponerlo en Vercel (los de Supabase ya no existen).
5. **Separar backend y frontend en dos repositorios: evaluado el 2026-09-15 y descartado por ahora.**
   El mismo origen es carga estructural: sostiene la cookie `SameSite=Lax` (que hoy neutraliza el CORS
   wildcard), garantiza despliegues atómicos durante la migración de auth y mantiene un único baseline en CI.
   Precondiciones para reconsiderarlo en el relevo §8.

## 10. Notas para el agente (cualquier cliente: terminal, desktop, plugin JetBrains)

- Este documento refleja el estado verificado del código, no solo lo que el usuario recuerda — si algo acá
  queda desactualizado, corregirlo en el mismo PR/commit donde se detecte la discrepancia.
- El usuario coordina el desarrollo desde IntelliJ IDEA; los cambios se ven reflejados ahí en cuanto se
  editan los archivos en disco.
