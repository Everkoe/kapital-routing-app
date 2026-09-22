-- Esquema del Programador de rutas.
--
-- Por qué tablas nuevas y no `app_state`
-- --------------------------------------
-- Toda la aplicación vive hoy en una sola fila JSONB de `app_state`, y cada
-- lectura se la trae entera. El histórico de servicios son 21.277 filas al mes
-- —unas 255.000 al año— y no cabe en ese modelo: metido ahí, el coste de leer
-- cualquier cosa crecería sin techo. Estas tablas son el principio de sacar de
-- esa fila lo que nunca debió estar dentro.
--
-- No se toca nada de lo existente. `app_state` sigue igual.
--
-- Por qué no hay tabla de vehículos
-- ---------------------------------
-- La flota ya vive en `app_state.usuarios.__flota__`, con su padrón, su chofer
-- y su capacidad. Duplicarla aquí crearía dos verdades que habría que
-- sincronizar, y esa sincronización se rompería el día que nadie mire. Se
-- referencia por código y punto.
--
-- Seguridad
-- ---------
-- Las tres tablas llevan RLS activada y ninguna política. Eso las deja
-- accesibles solo a la clave secreta del backend, que es la única que las
-- necesita; cualquier otra credencial no ve nada. Es el valor por defecto
-- correcto para datos que solo toca el servidor.
--
-- Cómo se aplica
-- --------------
-- En el editor SQL de Supabase, sobre el proyecto activo. Es idempotente: se
-- puede ejecutar más de una vez sin romper nada.

-- ---------------------------------------------------------------------------
-- Padrón de pasajeros, con su domicilio resuelto y cuánto nos fiamos de él.
-- ---------------------------------------------------------------------------
create table if not exists public.pasajeros (
    dni                text primary key,
    nombre             text not null,
    direccion          text,
    distrito           text,
    cobertura          text,

    lat                double precision,
    lng                double precision,

    -- El estado de la ubicación es parte del dato, no un detalle. Un pasajero
    -- «no_resuelta» no recibe una coordenada aproximada: va a revisión humana.
    -- Una ubicación inventada que no se anuncia invalida cualquier ruteo, y
    -- nadie puede corregir lo que no ve.
    estado_ubicacion   text not null default 'no_resuelta'
                       check (estado_ubicacion in ('resuelta', 'dudosa', 'no_resuelta')),

    -- De dónde salió el punto. `rastro_gps` es la mediana de los GPS de sus
    -- recojos, que contra domicilios conocidos da 29 m de error mediano.
    origen_ubicacion   text check (origen_ubicacion in
                       ('declarada', 'rastro_gps', 'geocodificada', 'manual')),

    -- Cuánto se dispersa su rastro y sobre cuántos puntos. Son las dos medidas
    -- que deciden el estado, y se guardan para poder revisar la decisión.
    dispersion_m       integer,
    puntos_rastro      integer,

    -- Por qué no se pudo resolver, en lenguaje llano, para la bandeja de
    -- revisión del programador.
    motivo             text,

    actualizado_en     timestamptz not null default now()
);

comment on table public.pasajeros is
    'Padrón con el domicilio de cada pasajero y la confianza que merece.';
comment on column public.pasajeros.dispersion_m is
    'Dispersión del rastro GPS. Predice el error: <150 m -> 21 m de error mediano.';

create index if not exists pasajeros_estado_idx
    on public.pasajeros (estado_ubicacion);
create index if not exists pasajeros_cobertura_idx
    on public.pasajeros (cobertura);

-- ---------------------------------------------------------------------------
-- Histórico de servicios: una fila por pasajero transportado.
-- ---------------------------------------------------------------------------
create table if not exists public.servicios_historicos (
    id                 bigint generated always as identity primary key,

    fecha_ejecutada    date not null,
    fecha_programada   date,
    sede               text,
    modalidad          text not null check (modalidad in ('RECOJO', 'SALIDA')),

    -- Hora programada del turno, como 'HH:MM'. Junto con cobertura y modalidad
    -- forma la ruta, que es lo único 100% estable por pasajero: nadie cambia
    -- de cobertura ni de turno de un día para otro.
    turno              text not null,

    cobertura          text,
    distrito           text,

    -- Código de la unidad tal como lo registra la intranet. No es una clave
    -- foránea a propósito: la flota vive en `app_state` y esto es el histórico
    -- de lo ocurrido, que debe conservarse aunque la unidad se dé de baja.
    codigo_vehiculo    text,

    dni                text,

    hora_inicio        time,
    hora_en_punto      time,
    hora_llegada       time,

    incidencia         text,

    -- GPS del vehículo al iniciar el servicio. De la mediana de estos puntos
    -- sale el domicilio de quien no lo declara.
    lat_inicio         double precision,
    lng_inicio         double precision,

    cargado_en         timestamptz not null default now()
);

comment on table public.servicios_historicos is
    'Lo que realmente ocurrió, importado del reporte de la intranet.';

-- Clave natural del servicio. Deja la importación repetible: volver a cargar
-- el mismo mes no duplica nada.
-- `nulls not distinct` porque el vehiculo o el DNI pueden faltar en una fila
-- del reporte, y sin esto dos nulos se considerarian distintos entre si: la
-- misma fila incompleta se duplicaria en cada recarga.
create unique index if not exists servicios_historicos_natural_idx
    on public.servicios_historicos
       (fecha_ejecutada, codigo_vehiculo, turno, dni, modalidad)
    nulls not distinct;

create index if not exists servicios_historicos_fecha_idx
    on public.servicios_historicos (fecha_ejecutada);
create index if not exists servicios_historicos_ruta_idx
    on public.servicios_historicos (cobertura, turno, modalidad);
create index if not exists servicios_historicos_dni_idx
    on public.servicios_historicos (dni);

-- ---------------------------------------------------------------------------
-- Duración real por tipo de ruta. Es la línea base contra la que se juzga si
-- una ruta propuesta es operacionalmente posible.
-- ---------------------------------------------------------------------------
create table if not exists public.duraciones_base (
    cobertura          text not null,
    modalidad          text not null check (modalidad in ('RECOJO', 'SALIDA')),

    -- Cadena vacía cuando la fila agrega todos los turnos. Se guardan los dos
    -- niveles porque casi la mitad de las combinaciones con turno tienen menos
    -- de cinco casos: ahí el nivel grueso es el único con datos suficientes.
    -- Vacía y no nula porque forma parte de la clave, y en una clave primaria
    -- un nulo no se compara consigo mismo.
    turno              text not null default '',

    n_casos            integer not null,

    -- Mediana y percentil 90 de la duración observada, en minutos. El p90 es
    -- el margen: la diferencia entre ambos dice cuánto puede alargarse la ruta
    -- un mal día, y de ahí sale el riesgo que se le muestra al programador.
    p50_minutos        numeric(6,1) not null,
    p90_minutos        numeric(6,1) not null,

    actualizado_en     timestamptz not null default now(),

    primary key (cobertura, modalidad, turno)
);

comment on table public.duraciones_base is
    'Duración real observada por ruta. Reemplaza al tiempo teórico del mapa.';

-- ---------------------------------------------------------------------------
-- Solo la clave secreta del backend llega a estas tablas.
-- ---------------------------------------------------------------------------
alter table public.pasajeros             enable row level security;
alter table public.servicios_historicos  enable row level security;
alter table public.duraciones_base       enable row level security;
