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
  const cola = error === null ? '' : `: con tan pocos, el error medio en la prueba fue de ${Math.round(error)} min`;
  if (!casos) {
    return `Ningún servicio de esta ruta a esta hora en el histórico; se apoya en rutas parecidas${cola}.`;
  }
  return `Solo ${casos} ${casos === 1 ? 'servicio' : 'servicios'} de esta ruta a esta hora${cola}.`;
};

const accionDelServicio = (estimacion, turno) => {
  if (estimacion.salir_antes) {
    const aTiempo = numero(estimacion.a_tiempo);
    const destino = turno ? ` para estar en la sede antes de las ${turno}` : ' para llegar a su hora';
    return `Salir antes de las ${estimacion.salir_antes}${destino}`
      + (aTiempo === null ? '' : ` (se logró el ${aTiempo}% en la prueba)`);
  }
  if (estimacion.ultima_entrega) return `Última entrega hacia las ${estimacion.ultima_entrega}`;
  return null;
};

/**
 * Los textos de la estimación de un servicio, o `null` si no hay.
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
    principal: duracionLegible(minutos),
    banda: `entre ${duracionLegible(desde)} y ${duracionLegible(hasta)}`
      + (acierto === null ? '' : ` (acertó el ${acierto}% en la prueba)`),
    accion: accionDelServicio(estimacion, turno),
    aviso: estimacion.confianza === 'baja'
      ? avisoDePocosCasos(numero(estimacion.casos) ?? 0, estimacion.error_medio) : null,
    entrenadoEl: estimacion.entrenado_el || null,
  };
};
