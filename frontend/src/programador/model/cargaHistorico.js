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

// Hasta cuántos días ya cargados se enseñan uno por uno; con más, se resumen.
// Subir el reporte de agosto listaba 31 líneas que no cabían en la ventana.
export const MAX_DIAS_EN_LISTA = 3;

const LIMA_MS = 5 * 60 * 60 * 1000;
const diaEnLima = (iso) => new Date(Date.parse(iso) - LIMA_MS).toISOString().slice(0, 10);

/**
 * Por debajo de esta fracción de lo ya cargado, el archivo de un día parece un
 * reporte a medias. Volver a cargar **sustituye** el día, así que un archivo
 * cortado lo dejaría cortado; lo normal es que una corrección cambie unas
 * pocas filas, no una de cada cinco.
 */
export const UMBRAL_ARCHIVO_CORTO = 0.8;

/**
 * Lo que se enseña al preguntar si se vuelve a cargar: los días ya cargados
 * resumidos (cuántos, de cuándo a cuándo, cuántos servicios), la lista solo si
 * son pocos, los días del archivo que son nuevos, y cuándo se subieron si fue
 * todo el mismo día —si no, no se inventa una fecha común—.
 *
 * `enArchivo` (día → servicios que trae el archivo) dice con qué se va a
 * sustituir cada día, y `cortos` los días en que trae bastantes menos.
 */
export const resumenDeRecarga = (yaCargados, diasDelArchivo = [], enArchivo = {}) => {
  const cuantos = (dia) => {
    const valor = enArchivo?.[String(dia.fecha)];
    return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
  };
  const cargados = [...(yaCargados || [])]
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
    .map((dia) => ({ ...dia, enArchivo: cuantos(dia) }));
  const conCuenta = cargados.filter((dia) => dia.enArchivo !== null);
  const fechasCargadas = new Set(cargados.map((dia) => String(dia.fecha)));
  const nuevos = [...(diasDelArchivo || [])].map(String)
    .filter((dia) => !fechasCargadas.has(dia)).sort();
  const subidas = cargados.map((dia) => dia.cargado_en).filter(Boolean);
  const unSoloDia = subidas.length === cargados.length && subidas.length > 0
    && new Set(subidas.map(diaEnLima)).size === 1;
  return {
    dias: cargados.length,
    desde: cargados[0]?.fecha ?? null,
    hasta: cargados.at(-1)?.fecha ?? null,
    servicios: cargados.reduce((total, dia) => total + Number(dia.servicios || 0), 0),
    lista: cargados.length <= MAX_DIAS_EN_LISTA ? cargados : [],
    nuevos,
    subidoEl: unSoloDia ? subidas.sort()[0] : null,
    enArchivo: conCuenta.length === cargados.length && cargados.length > 0
      ? conCuenta.reduce((total, dia) => total + dia.enArchivo, 0)
      : null,
    cortos: conCuenta
      .filter((dia) => dia.enArchivo < Number(dia.servicios || 0) * UMBRAL_ARCHIVO_CORTO)
      .map((dia) => dia.fecha),
  };
};
