/**
 * Cómo se lee en pantalla la duración que estima el modelo, sin React.
 *
 * La estimación la calcula el backend con el modelo entrenado sobre el
 * histórico (`api/estimador_duracion.py`) y llega en `ruta.estimacion`. Todo lo
 * que aquí se dice de su fiabilidad —cuánto acierta la banda, con qué
 * frecuencia se llega a tiempo, el error con pocos casos— es lo **medido** en
 * días que el modelo no vio, no una promesa: por eso cada cifra lleva «en la
 * prueba». Si el backend no la trae, no se enseña nada.
 */

// Un valor ausente no es el cero: `Number(null)` vale 0.
const numero = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/** 48 → «48 min»; 65 → «1 h 05». */
export const duracionLegible = (minutos) => {
  const total = Math.max(0, Math.round(minutos));
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')}`;
};

/** La segunda columna: a qué hora salir (RECOJO) o hacia cuándo termina (SALIDA). */
const horaDelServicio = (estimacion, turno) => {
  if (estimacion.salir_antes) {
    return {
      etiqueta: 'Salir antes de',
      valor: estimacion.salir_antes,
      detalle: turno ? `Para estar en la sede a las ${turno}` : 'Para llegar a su hora',
    };
  }
  if (estimacion.ultima_entrega) {
    return {
      etiqueta: 'Última entrega hacia',
      valor: estimacion.ultima_entrega,
      detalle: 'Cuando deja a la última persona',
    };
  }
  return null;
};

const NIVELES = { alta: 'Alta', media: 'Media', baja: 'Baja' };

/**
 * La tercera columna: cuánto fiarse. Con pocos casos de esa ruta y hora dice
 * cuánto puede desviarse; si no, lo que se midió en días que el modelo no vio.
 */
const fiabilidadDe = (estimacion) => {
  const nivel = NIVELES[estimacion.confianza] ? estimacion.confianza : 'media';
  const casos = numero(estimacion.casos) ?? 0;
  if (nivel === 'baja') {
    const error = numero(estimacion.error_medio);
    const desvio = error === null ? '' : `: puede desviarse unos ${Math.round(error)} min`;
    const base = casos
      ? `Solo ${casos} ${casos === 1 ? 'servicio' : 'servicios'} de esta ruta a esta hora`
      : 'Sin servicios de esta ruta a esta hora; se apoya en rutas parecidas';
    return { nivel, valor: 'Baja, pocos datos', detalle: `${base}${desvio}` };
  }
  const acierto = numero(estimacion.acierto_banda);
  const aTiempo = estimacion.salir_antes ? numero(estimacion.a_tiempo) : null;
  const partes = [
    `${casos} ${casos === 1 ? 'servicio' : 'servicios'} de esta ruta a esta hora`,
    acierto === null ? null : `el rango acierta el ${acierto}%`,
    aTiempo === null ? null : `a tiempo el ${aTiempo}%`,
  ].filter(Boolean);
  return { nivel, valor: NIVELES[nivel], detalle: partes.join(' · ') };
};

/**
 * Lo que se enseña de la estimación de un servicio, o `null` si no hay.
 *
 * Tres columnas con la misma forma —etiqueta, valor y una línea debajo—:
 * cuánto dura, a qué hora salir y cuánto fiarse. Con forma fija se leen de un
 * vistazo; como frases seguidas se leían amontonadas, y con el aviso suelto
 * debajo, desordenadas.
 *
 * `turno` es la hora del servicio («06:00»): en un RECOJO es la hora de
 * entrada a la sede, que es a lo que hay que llegar.
 */
export const describirEstimacion = (estimacion, turno = null) => {
  if (!estimacion || typeof estimacion !== 'object') return null;
  const minutos = numero(estimacion.minutos);
  const desde = numero(estimacion.desde);
  const hasta = numero(estimacion.hasta);
  if (minutos === null || desde === null || hasta === null) return null;
  return {
    duracion: {
      etiqueta: 'Duración estimada',
      valor: duracionLegible(minutos),
      detalle: `Entre ${duracionLegible(desde)} y ${duracionLegible(hasta)}`,
    },
    hora: horaDelServicio(estimacion, turno),
    fiabilidad: fiabilidadDe(estimacion),
    entrenadoEl: estimacion.entrenado_el || null,
  };
};
