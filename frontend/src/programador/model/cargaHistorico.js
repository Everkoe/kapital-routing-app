/**
 * Qué enseña la pantalla de carga del histórico, sin React.
 *
 * El reporte que toca subir es el del día que ya terminó —ayer, en Lima—, y
 * lo decide el servidor (`GET /api/programador/estado-historico` devuelve
 * `esperado`): el reloj del navegador podría ir en otra zona. De aquí salen el
 * «al día» o «falta», la tira de los últimos días y el aviso cuando el archivo
 * subido no es del día que tocaba.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

/** La fecha ISO `n` días después (o antes, si `n` es negativo). */
export const sumarDias = (iso, n) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);

// Los días de la tira; el servidor devuelve al menos estos.
export const DIAS_EN_LA_TIRA = 7;

/** Los últimos días hasta el que toca subir, de más viejo a más nuevo, con si están cargados. */
export const tiraDeDias = (estado, n = DIAS_EN_LA_TIRA) => {
  const esperado = estado?.esperado;
  if (!esperado) return [];
  const porFecha = new Map((estado.dias || []).map((dia) => [String(dia.fecha), dia]));
  return Array.from({ length: n }, (_, i) => sumarDias(esperado, i - (n - 1))).map((fecha) => {
    const dia = porFecha.get(fecha);
    return {
      fecha,
      cargado: Boolean(dia),
      servicios: dia?.servicios ?? 0,
      cargadoEn: dia?.cargado_en ?? null,
    };
  });
};

/** El día que toca subir, con si ya está; `null` si el servidor no lo dijo. */
export const diaEsperado = (estado) => tiraDeDias(estado).at(-1) ?? null;

/** Los días de la tira sin cargar, sin contar el que toca (ese va aparte). */
export const huecosAnteriores = (estado) =>
  tiraDeDias(estado).slice(0, -1).filter((dia) => !dia.cargado).map((dia) => dia.fecha);

/**
 * Si el archivo subido no incluye el día que tocaba: lo normal es haberse
 * equivocado de fecha al descargarlo en la intranet. Un archivo de varios días
 * que lo incluye no avisa.
 */
export const fueraDeLoEsperado = (resumen, esperado) =>
  Boolean(resumen?.hasta && esperado)
  && !((resumen.desde || resumen.hasta) <= esperado && esperado <= resumen.hasta);

/** Qué días del archivo ya estaban, desde el 409 de la carga; `null` si el error es otro. */
export const yaCargadosDelError = (detalle) =>
  (detalle && typeof detalle === 'object' && Array.isArray(detalle.ya_cargados)
    && detalle.ya_cargados.length > 0)
    ? detalle.ya_cargados
    : null;
