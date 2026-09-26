/**
 * Derivación del modelo de servicios a partir del contrato vigente de rutas.
 *
 * El backend entrega hoy rutas con cuatro campos —`conductor`, `micro_zona`,
 * `horario` y `agentes`— y ninguna identidad propia. Este módulo traduce esa
 * forma al modelo que consume la mesa del Programador, sin inventar datos que
 * el backend todavía no produce.
 *
 * Dos reglas que no deben relajarse:
 *
 * 1. **El índice del array nunca es identidad.** Reordenar o filtrar la lista
 *    cambiaría a qué servicio apunta una acción del usuario. La identidad se
 *    deriva de los campos de negocio y se desambigua con un ordinal cuando dos
 *    rutas comparten los tres.
 * 2. **La capacidad no se supone.** El frontend tenía `15` escrito a mano
 *    mientras la flota real declara unidades de 10, 12 y 15. Cuando la
 *    capacidad de una unidad no se conoce, esto devuelve `null` y la interfaz
 *    muestra la ocupación sin denominador, en lugar de afirmar un total falso.
 */

export const UNASSIGNED = 'SIN ASIGNAR';

/** Normaliza un texto para comparar y para construir claves estables. */
const norm = (value) => String(value ?? '').trim();

/**
 * Clave de una unidad, comparable entre las dos fuentes.
 *
 * La flota guarda «K-027» y el histórico de la intranet registra «K027». El
 * nombre que se enseña es el que venga; lo que se normaliza es solo la clave
 * de búsqueda, o la capacidad declarada no se encontraría nunca y la mesa
 * mostraría toda la flota sin denominador.
 */
export const fleetKey = (value) => norm(value).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Clave de negocio de un servicio, previa a desambiguar duplicados. */
const businessKey = (route) =>
  [norm(route?.conductor) || UNASSIGNED, norm(route?.micro_zona), norm(route?.horario)].join('|');

/**
 * Índice de flota por unidad. Acepta la respuesta de `GET /api/flota`
 * (`{ flota: [...] }`) o directamente el array.
 */
export const indexFleet = (payload) => {
  const list = Array.isArray(payload) ? payload : payload?.flota;
  if (!Array.isArray(list)) return {};
  return list.reduce((acc, unit) => {
    const id = norm(unit?.unidad_id) || norm(unit?.placa);
    if (!id) return acc;
    const capacidad = Number(unit?.capacidad);
    acc[fleetKey(id)] = {
      unidad_id: id,
      capacidad: Number.isFinite(capacidad) && capacidad > 0 ? capacidad : null,
      chofer: norm(unit?.chofer) || null,
    };
    return acc;
  }, {});
};

/**
 * Resuelve la capacidad de un servicio.
 *
 * `total` es `null` cuando la unidad no está en la flota o no declara
 * capacidad. `known` permite a la vista decidir entre mostrar `11/15` y
 * mostrar `11 agentes`, sin que ninguna capa tenga que inventar un número.
 */
export const resolveCapacity = (conductor, used, fleetIndex = {}) => {
  const unit = fleetIndex[fleetKey(conductor)];
  const total = unit?.capacidad ?? null;
  if (total === null) {
    return { used, total: null, free: null, known: false, full: false, over: false };
  }
  return {
    used,
    total,
    free: Math.max(total - used, 0),
    known: true,
    full: used >= total,
    over: used > total,
  };
};

/**
 * Marca los registros que repiten documento dentro de una misma lista.
 *
 * No deduplica: eso es una decisión de negocio que nadie ha tomado, y borrar
 * pasajeros por iniciativa propia sería peor que mostrarlos. Solo señala, para
 * que una unidad que figura llena de duplicados se pueda reconocer.
 */
export const markDuplicates = (agentes) => {
  const seen = new Map();
  return (agentes || []).map((agente) => {
    const doc = norm(agente?.id);
    const count = (seen.get(doc) ?? 0) + 1;
    seen.set(doc, count);
    return { ...agente, duplicado: Boolean(doc) && count > 1 };
  });
};

/** Documentos distintos de una lista, para contrastar con la ocupación. */
export const distinctDocuments = (agentes) =>
  new Set((agentes || []).map((a) => norm(a?.id)).filter(Boolean)).size;

/**
 * Estado del servicio derivable HOY.
 *
 * No existe motor de optimización ni flujo de aprobación, así que este modelo
 * no produce `modificado`, `pendiente`, `aprobado` ni `rechazado`: esos estados
 * llegarán cuando exista el contrato que los respalde. Afirmarlos ahora sería
 * simular una funcionalidad inexistente.
 */
export const serviceState = ({ conductor, capacity, agentCount }) => {
  if (norm(conductor) === UNASSIGNED || !norm(conductor)) return 'sin_asignar';
  if (agentCount === 0) return 'vacio';
  if (capacity.over) return 'excedido';
  if (capacity.known && capacity.full) return 'completo';
  return 'programado';
};

/**
 * Construye la lista de servicios de la mesa.
 *
 * Devuelve siempre un array; una entrada malformada se descarta en vez de
 * romper el tablero, porque el origen es un Excel subido por una persona.
 */
export const buildServices = (routes, fleetIndex = {}) => {
  if (!Array.isArray(routes)) return [];
  const seen = new Map();

  return routes.reduce((acc, route) => {
    if (!route || typeof route !== 'object') return acc;

    const key = businessKey(route);
    const ordinal = (seen.get(key) ?? 0) + 1;
    seen.set(key, ordinal);

    const agentes = Array.isArray(route.agentes) ? route.agentes : [];
    const conductor = norm(route.conductor) || UNASSIGNED;
    const capacity = resolveCapacity(conductor, agentes.length, fleetIndex);

    acc.push({
      // Identidad estable derivada de negocio. El ordinal solo aparece cuando
      // dos rutas comparten conductor, zona y horario.
      id: ordinal === 1 ? key : `${key}#${ordinal}`,
      conductor,
      asignado: conductor !== UNASSIGNED,
      microZona: norm(route.micro_zona),
      horario: norm(route.horario),
      // Lo que el motor de inserción necesita comparar. Solo lo trae el plan:
      // en el histórico quedan en `null` y el motor no se usa.
      turno: norm(route.turno) || null,
      modalidad: norm(route.modalidad).toUpperCase() || null,
      sede: norm(route.sede) || null,
      // Lo más que ha llevado esta unidad en un servicio. No es capacidad
      // declarada y no entra en los KPI; el motor lo usa solo cuando la flota
      // no declara nada.
      maxLlevado: Number.isFinite(Number(route.max_llevado)) && Number(route.max_llevado) > 0
        ? Number(route.max_llevado) : null,
      empresa: norm(agentes[0]?.empresa),
      agentes,
      agentCount: agentes.length,
      capacity,
      // Minutos medidos sobre el histórico, o `null` si esa ruta no acumula
      // casos suficientes. No se estima: una cifra inventada aquí se
      // convertiría en una promesa de hora de llegada.
      duracion: route.duracion ?? null,
      // Qué cambió respecto al día cargado anterior. Sale de comparar los
      // documentos del servicio, no de ninguna etiqueta.
      cambio: route.cambio ?? null,
      modificado: Boolean(route.cambio?.modificado),
      // Quien estaba asignado y se retiró. Viaja aparte de `agentes` para que
      // no cuente como ocupación: un retirado no ocupa asiento, pero tampoco
      // se borra, porque el día siguiente necesita saber que se cayó.
      retirados: Array.isArray(route.retirados) ? route.retirados : [],
      estado: serviceState({ conductor, capacity, agentCount: agentes.length }),
    });
    return acc;
  }, []);
};

/**
 * Una coordenada ausente no es una coordenada cero.
 *
 * `Number(null)` y `Number('')` valen `0`, que es finito: comprobar solo con
 * `Number.isFinite` daba por ubicado a un agente sin ubicación. El origen de
 * estos datos es un Excel, donde la celda vacía es el caso frecuente.
 */
export const hasCoordinate = (value) =>
  value !== null && value !== undefined && norm(value) !== '' && Number.isFinite(Number(value));

/**
 * Agentes sin servicio asignado, que alimentan el panel de novedades.
 *
 * No son una invención del diseño: el backend agrupa en rutas con conductor
 * `SIN ASIGNAR` a todo pasajero que no cupo en ninguna unidad.
 */
export const buildPendingAgents = (services) => {
  // El documento del agente no es único ni siquiera dentro de un mismo
  // servicio: los datos reales traen DNIs repetidos, y dos entradas con la
  // misma clave hacen que React omita filas en silencio. Se desambigua con un
  // ordinal, igual que en `buildServices`, en vez de usar la posición del
  // array como identidad.
  const seen = new Map();

  return (services || [])
    .filter((service) => !service.asignado)
    .flatMap((service) =>
      service.agentes.map((agente) => {
        const key = `${service.id}|${norm(agente?.id)}`;
        const ordinal = (seen.get(key) ?? 0) + 1;
        seen.set(key, ordinal);

        return {
        id: ordinal === 1 ? key : `${key}#${ordinal}`,
        duplicado: ordinal > 1,
        agenteId: norm(agente?.id),
        nombre: norm(agente?.nombre),
        direccion: norm(agente?.direccion),
        microZona: service.microZona,
        horario: service.horario,
        empresa: norm(agente?.empresa),
        // Categoría derivable del propio dato, sin motor de validación.
        // `ubicacion_estimada` la pone el backend cuando la fila no traía una
        // coordenada legible y recibió la de respaldo. Sin esa marca, un agente
        // sin ubicación real era indistinguible de uno bien ubicado.
        motivo: agente?.ubicacion_estimada
          || !hasCoordinate(agente?.lat)
          || !hasCoordinate(agente?.lng)
          ? 'sin_ubicacion'
          : !norm(agente?.direccion)
            ? 'direccion_incompleta'
            : 'sin_unidad',
        };
      }),
    );
};
