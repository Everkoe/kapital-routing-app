/**
 * El resultado del cuestionario de manejo defensivo, para enseñarlo.
 *
 * No es un documento que se suba: es el test que el conductor rinde en su alta
 * (`QuizManejoDefensivo`), que deja en su perfil `quizManejoDefensivo` con la
 * nota, el total, el estado y la fecha. Los umbrales viven aquí y el propio
 * test los usa, para que lo que dice la ficha y lo que vio el conductor no
 * puedan separarse.
 */

export const NOTA_APROBADO = 18;
export const NOTA_OBSERVADO = 15;
export const TOTAL_PREGUNTAS = 20;

const ESTADOS = ['APROBADO', 'OBSERVADO', 'DESAPROBADO'];

export const estadoPorNota = (puntaje) => {
  if (puntaje >= NOTA_APROBADO) return 'APROBADO';
  if (puntaje >= NOTA_OBSERVADO) return 'OBSERVADO';
  return 'DESAPROBADO';
};

/** El día en que lo rindió, en Lima y como día/mes/año; vacío si no consta. */
const diaDe = (iso) => {
  const fecha = new Date(iso ?? '');
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleDateString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima',
  });
};

/** `{ puntaje, total, estado, fecha }`, o `null` si no lo ha rendido. */
export const resultadoDelCuestionario = (resultado) => {
  if (!resultado || typeof resultado !== 'object') return null;
  const puntaje = Number(resultado.puntaje);
  if (resultado.puntaje === null || resultado.puntaje === '' || !Number.isFinite(puntaje)) return null;
  const guardado = String(resultado.estado || '').toUpperCase();
  return {
    puntaje,
    total: Number(resultado.total) || TOTAL_PREGUNTAS,
    estado: ESTADOS.includes(guardado) ? guardado : estadoPorNota(puntaje),
    fecha: diaDe(resultado.fechaEvaluacion),
  };
};
