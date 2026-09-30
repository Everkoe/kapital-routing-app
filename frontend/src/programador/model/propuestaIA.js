/**
 * Cómo se lee en pantalla una propuesta de la IA de rutas (VROOM), sin React.
 *
 * La calcula el backend (`POST /api/programador/plan/proponer`, lógica en
 * `api/ruteo_vroom.py` y `api/propuesta_ia.py`). Lo actual y lo propuesto se
 * miden con el mismo modelo de tiempos, así que la comparación es justa; y
 * lo que no se pudo calcular —servicios con alguien sin domicilio ubicado— se
 * dice aparte, porque no entra en ninguna de las dos columnas.
 */

export const OBJETIVOS = [
  {
    id: 'unidades',
    etiqueta: 'Menos unidades',
    ayuda: 'Usa las menos unidades posibles. En las pruebas también dio menos horas.',
  },
  {
    id: 'tiempo',
    etiqueta: 'Menos horas',
    ayuda: 'Mantiene más unidades y busca el menor tiempo total de trabajo.',
  },
];

const numero = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/** «−28%», «+5%» o «igual»; `null` si no se puede comparar. */
export const variacion = (antes, despues) => {
  const a = numero(antes);
  const d = numero(despues);
  if (a === null || d === null || a === 0) return null;
  const porcentaje = Math.round(((d - a) / a) * 100);
  if (porcentaje === 0) return 'igual';
  return `${porcentaje > 0 ? '+' : '−'}${Math.abs(porcentaje)}%`;
};

// Menos es mejor en todas las filas: unidades, horas y minutos a bordo.
const tono = (antes, despues) => {
  const a = numero(antes);
  const d = numero(despues);
  if (a === null || d === null || a === d) return 'neutral';
  return d < a ? 'mejor' : 'peor';
};

const fila = (etiqueta, antes, despues, unidad = '') => ({
  etiqueta,
  actual: numero(antes) === null ? '—' : `${antes}${unidad}`,
  propuesta: numero(despues) === null ? '—' : `${despues}${unidad}`,
  variacion: variacion(antes, despues),
  tono: tono(antes, despues),
});

/** Las filas de la tabla «Plan actual / Propuesta». */
export const filasDeComparacion = (propuesta) => {
  if (!propuesta?.actual || !propuesta?.propuesta) return [];
  const { actual, propuesta: nueva } = propuesta;
  const sede = propuesta.unidades_de_la_sede || {};
  return [
    fila('Unidades en la sede', sede.actual, sede.propuesta),
    fila('Unidades en lo que se reorganiza', actual.unidades, nueva.unidades),
    fila('Horas de trabajo', actual.horas, nueva.horas, ' h'),
    fila('A bordo, mediana', actual.a_bordo_mediana, nueva.a_bordo_mediana, ' min'),
    fila('A bordo, máximo', actual.a_bordo_max, nueva.a_bordo_max, ' min'),
    fila(`Personas por encima de ${propuesta.reglas?.max_a_bordo ?? 90} min`,
      actual.por_encima_de_la_regla, nueva.por_encima_de_la_regla),
  ];
};

const personas = (n) => `${n} ${n === 1 ? 'persona' : 'personas'}`;

/** Los avisos que acompañan a la propuesta, en el orden en que importan. */
export const avisosDeLaPropuesta = (propuesta) => {
  if (!propuesta) return [];
  const avisos = [];
  const sinAsignar = propuesta.sin_asignar?.length || 0;
  if (sinAsignar > 0) {
    avisos.push({
      tono: 'warn',
      texto: `${personas(sinAsignar)} sin sitio en la propuesta: se quedan en su servicio actual. `
        + 'Revisa esos servicios después de aplicarla.',
    });
  }
  const excepciones = propuesta.excepciones?.length || 0;
  if (excepciones > 0) {
    avisos.push({
      tono: 'warn',
      texto: `${personas(excepciones)} viven tan lejos que ni en viaje directo bajan del máximo a bordo: `
        + 'se les lleva con el viaje más corto posible.',
    });
  }
  const intactos = propuesta.intactos || {};
  if (intactos.servicios > 0) {
    avisos.push({
      tono: 'info',
      texto: `${intactos.servicios} ${intactos.servicios === 1 ? 'servicio se queda' : 'servicios se quedan'} `
        + `como está${intactos.servicios === 1 ? '' : 'n'} porque llevan a alguien sin domicilio ubicado `
        + `(${personas(intactos.sin_ubicar)}). Ubicarlos permitiría reorganizarlos también.`,
    });
  }
  return avisos;
};

/** El texto de la confirmación antes de aplicar. */
export const textoDeConfirmacion = (propuesta) => {
  const movidas = numero(propuesta?.movidas) ?? 0;
  if (movidas === 0) return 'La propuesta solo cambia el orden de recogida de algunos servicios.';
  return `${personas(movidas)} cambian de unidad y se reordenan los servicios. `
    + 'Podrás deshacerlo justo después.';
};
