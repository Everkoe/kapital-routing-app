/**
 * Analítica derivada del tablero.
 *
 * Todo se calcula sobre los datos que el backend ya entrega. No hay histórico:
 * `__historial_rutas__` está vacío en la base, así que un informe de evolución
 * temporal no tendría de dónde salir. Lo que sí hay —y hace falta— es el estado
 * del día y su calidad.
 *
 * El hallazgo que justifica este módulo: la base trae 2.645 registros de
 * pasajero para 580 personas distintas. La flota parece saturada porque cuenta
 * duplicados como ocupantes.
 */

const norm = (value) => String(value ?? '').trim();

const documentsOf = (service) =>
  (service?.agentes || []).map((a) => norm(a?.id)).filter(Boolean);

/**
 * Calidad de los datos cargados.
 *
 * Distingue registros de personas en todas partes: son magnitudes distintas y
 * confundirlas es justo lo que hace que el tablero mienta.
 */
export const dataQuality = (services) => {
  const list = Array.isArray(services) ? services : [];

  const asignadas = new Set();
  const pendientes = new Set();
  let registros = 0;
  let registrosDuplicados = 0;
  let serviciosConRepetidos = 0;
  let sinCoordenadas = 0;
  let sinDireccion = 0;

  for (const service of list) {
    const docs = documentsOf(service);
    const distintos = new Set(docs);
    registros += service.agentCount;
    registrosDuplicados += docs.length - distintos.size;
    if (docs.length !== distintos.size) serviciosConRepetidos += 1;

    for (const doc of distintos) {
      (service.asignado ? asignadas : pendientes).add(doc);
    }
    for (const agente of service.agentes || []) {
      if (!norm(agente?.lat) || !norm(agente?.lng)) sinCoordenadas += 1;
      if (!norm(agente?.direccion)) sinDireccion += 1;
    }
  }

  // Una persona que aparece a la vez montada y pendiente es una contradicción
  // del origen, no un estado válido: el Programador la trataría dos veces.
  const enAmbos = [...asignadas].filter((doc) => pendientes.has(doc));

  return {
    registros,
    personas: new Set([...asignadas, ...pendientes]).size,
    personasAsignadas: asignadas.size,
    personasPendientes: pendientes.size,
    personasEnAmbosEstados: enAmbos.length,
    registrosDuplicados,
    serviciosConRepetidos,
    serviciosTotales: list.length,
    sinCoordenadas,
    sinDireccion,
  };
};

/**
 * Capacidad real frente a la que muestra el tablero.
 *
 * `librasSiSeDeduplica` no propone deduplicar —esa decisión es de negocio— sino
 * cuantificar qué está en juego: es la diferencia entre creer que no cabe nadie
 * y saber cuántos asientos hay.
 */
export const capacityAnalysis = (services) => {
  const list = (Array.isArray(services) ? services : []).filter((s) => s.asignado);

  return list.reduce(
    (acc, service) => {
      const { capacity } = service;
      if (!capacity.known) {
        acc.sinCapacidadDeclarada += 1;
        return acc;
      }
      acc.unidades += 1;
      acc.capacidadTotal += capacity.total;
      acc.ocupadosPorRegistro += capacity.used;

      const distintos = new Set(documentsOf(service)).size;
      acc.ocupadosPorPersona += distintos;
      acc.libresActuales += Math.max(capacity.total - capacity.used, 0);
      acc.libresSiSeDeduplica += Math.max(capacity.total - distintos, 0);

      if (capacity.over) acc.sobreCapacidad += 1;
      else if (capacity.full) acc.llenas += 1;
      return acc;
    },
    {
      unidades: 0,
      capacidadTotal: 0,
      ocupadosPorRegistro: 0,
      ocupadosPorPersona: 0,
      libresActuales: 0,
      libresSiSeDeduplica: 0,
      llenas: 0,
      sobreCapacidad: 0,
      sinCapacidadDeclarada: 0,
    },
  );
};

/**
 * Distribución por zona, ordenada por volumen.
 *
 * `personas` y `registros` se devuelven por separado porque la diferencia entre
 * ambos es la medida del problema en esa zona.
 */
export const zoneBreakdown = (services, limit = 12) => {
  const zonas = new Map();

  for (const service of Array.isArray(services) ? services : []) {
    const zona = service.microZona || 'Sin zona';
    const entry = zonas.get(zona) || {
      zona,
      servicios: 0,
      registros: 0,
      documentos: new Set(),
      pendientes: 0,
    };
    entry.servicios += 1;
    entry.registros += service.agentCount;
    for (const doc of documentsOf(service)) entry.documentos.add(doc);
    if (!service.asignado) entry.pendientes += service.agentCount;
    zonas.set(zona, entry);
  }

  return [...zonas.values()]
    .map(({ documentos, ...rest }) => ({ ...rest, personas: documentos.size }))
    .sort((a, b) => b.registros - a.registros)
    .slice(0, limit);
};

/** Reparto de la flota por capacidad declarada. */
export const capacityDistribution = (fleetIndex) => {
  const counts = new Map();

  for (const unit of Object.values(fleetIndex || {})) {
    const key = unit.capacidad ?? null;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([capacidad, unidades]) => ({ capacidad, unidades }))
    .sort((a, b) => {
      if (a.capacidad === null) return 1;
      if (b.capacidad === null) return -1;
      return a.capacidad - b.capacidad;
    });
};

/** Une flota y tablero para la vista de unidades. */
export const fleetWithLoad = (fleetIndex, services) => {
  const porUnidad = new Map();
  for (const service of Array.isArray(services) ? services : []) {
    if (!service.asignado) continue;
    const entry = porUnidad.get(service.conductor) || { servicios: 0, registros: 0, documentos: new Set() };
    entry.servicios += 1;
    entry.registros += service.agentCount;
    for (const doc of documentsOf(service)) entry.documentos.add(doc);
    porUnidad.set(service.conductor, entry);
  }

  return Object.values(fleetIndex || {})
    .map((unit) => {
      const carga = porUnidad.get(unit.unidad_id);
      const registros = carga?.registros ?? 0;
      const personas = carga?.documentos.size ?? 0;
      return {
        ...unit,
        servicios: carga?.servicios ?? 0,
        registros,
        personas,
        libres: unit.capacidad === null ? null : Math.max(unit.capacidad - registros, 0),
        sinUsar: !carga,
      };
    })
    .sort((a, b) => a.unidad_id.localeCompare(b.unidad_id, 'es', { numeric: true }));
};
