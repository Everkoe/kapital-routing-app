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

const avisoDePocosCasos = (casos, errorMedio) => {
  const error = numero(errorMedio);
  const cola = error === null ? '' : `, así que puede desviarse unos ${Math.round(error)} min`;
  if (!casos) {
    return `Sin servicios de esta ruta a esta hora en el histórico: se apoya en rutas parecidas${cola}.`;
  }
  return `Pocos datos: solo ${casos} ${casos === 1 ? 'servicio' : 'servicios'} de esta ruta a esta hora${cola}.`;
};

/** La segunda cifra: a qué hora salir (RECOJO) o hacia cuándo termina (SALIDA). */
const horaDelServicio = (estimacion, turno) => {
  if (estimacion.salir_antes) {
    const aTiempo = numero(estimacion.a_tiempo);
    return {
      etiqueta: 'Salir antes de',
      hora: estimacion.salir_antes,
      detalle: [
        turno ? `Para estar en la sede antes de las ${turno}` : 'Para llegar a su hora',
        aTiempo === null ? null : `así se llegó a tiempo el ${aTiempo}% de las veces`,
      ].filter(Boolean).join('; ') + '.',
    };
  }
  if (estimacion.ultima_entrega) {
    return {
      etiqueta: 'Última entrega hacia',
      hora: estimacion.ultima_entrega,
      detalle: 'Cuando deja a la última persona.',
    };
  }
  return null;
};

/**
 * Lo que se enseña de la estimación de un servicio, o `null` si no hay.
 *
 * Va en piezas y no en frases porque la pantalla las pone en sitios distintos:
 * dos cifras grandes —la duración y la hora— con su explicación debajo, y el
 * aviso aparte. Todo en una línea se leía amontonado.
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
  const acierto = numero(estimacion.acierto_banda);
  return {
    duracion: duracionLegible(minutos),
    rango: `Entre ${duracionLegible(desde)} y ${duracionLegible(hasta)}`
      + (acierto === null ? '.' : `; acierta el ${acierto}% de las veces.`),
    hora: horaDelServicio(estimacion, turno),
    aviso: estimacion.confianza === 'baja'
      ? avisoDePocosCasos(numero(estimacion.casos) ?? 0, estimacion.error_medio) : null,
    entrenadoEl: estimacion.entrenado_el || null,
  };
};
