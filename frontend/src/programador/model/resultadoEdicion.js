/**
 * Qué se guardó de verdad de una tanda de cambios al plan.
 *
 * La base ignora un cambio que ya no encaja —la vista estaba vieja, otra
 * pestaña movió a esa persona, o ya va en otro coche de ese turno— y desde la
 * 017 dice, cambio a cambio, cuántas filas tocó (`resultados`). Mirar solo el
 * total engañaba: un arrastre es `mover` + `ordenar`, y con el `mover`
 * ignorado el `ordenar` podía tocar filas igual, así que la pantalla decía
 * «va en K027» con la persona en su coche de antes.
 *
 * Cuentan los cambios que mueven a alguien; `ordenar` acompaña. Si la base no
 * trae `resultados` (anterior a la 017) o solo se reordenó, se mira el total.
 */

const MUEVEN_A_ALGUIEN = new Set(['mover', 'agregar', 'a_pendientes', 'retirar', 'reponer']);

export const resultadoDeLaEdicion = (cambios, respuesta) => {
  const lista = Array.isArray(cambios) ? cambios : [];
  const resultados = Array.isArray(respuesta?.resultados) ? respuesta.resultados : null;

  if (resultados && resultados.length === lista.length) {
    const principales = lista
      .map((cambio, indice) => ({ cambio, tocadas: Number(resultados[indice]) || 0 }))
      .filter(({ cambio }) => MUEVEN_A_ALGUIEN.has(cambio?.accion));
    if (principales.length > 0) {
      const hechos = principales.filter(({ tocadas }) => tocadas > 0).length;
      let estado = 'parcial';
      if (hechos === principales.length) estado = 'hecho';
      else if (hechos === 0) estado = 'nada';
      return { estado, hechos, total: principales.length };
    }
  }

  const aplicados = Number(respuesta?.aplicados) || 0;
  const ignorados = Number(respuesta?.ignorados) || 0;
  if (aplicados === 0 && ignorados > 0) return { estado: 'nada', hechos: 0, total: lista.length };
  return { estado: 'hecho', hechos: lista.length, total: lista.length };
};
