/**
 * Qué enseña la ficha de cada columna de la base (masivo, Remisse, Sharf).
 *
 * La importación dejó algunos datos en dos sitios —la unidad y el perfil de su
 * conductor— y cada pantalla leía uno distinto: la ficha enseñaba el teléfono
 * de la unidad y el Excel el del perfil. Ahora manda la unidad en todas partes
 * y el perfil solo rellena lo que a ella le falte. Es la misma regla que
 * `_valor_de_unidad` en el backend, que es de donde sale la exportación: si se
 * cambia una, hay que cambiar la otra.
 */

/** Campo de la unidad → su copia en el perfil del conductor. */
export const ESPEJO_EN_PERFIL = {
  telefono: 'telefonoDirecto',
  placa: 'placa',
  marca: 'vehiculoMarca',
  modelo: 'vehiculoModelo',
  ano: 'vehiculoAnio',
  color: 'vehiculoColor',
};

const texto = (valor) => String(valor ?? '').trim();

/**
 * El valor de un campo con copia: el de la unidad y, si no lo tiene, el del perfil.
 *
 * Una placa igual al padrón no cuenta: el alta antigua mandaba el padrón en el
 * campo de la placa, y la de verdad está en el perfil del conductor.
 */
export const valorDeLaUnidad = (flota, perfil, campo, padron = '') => {
  let propio = texto(flota?.[campo]);
  if (campo === 'placa' && propio.toUpperCase() === texto(padron || flota?.unidad_id).toUpperCase()) propio = '';
  return propio || texto(perfil?.[ESPEJO_EN_PERFIL[campo]]);
};

/** Las bases, escritas como se guardan (`_BASES` en el backend). */
export const BASES = ['MASIVO', 'REMISSE', 'Sharf Motorizado'];

/** Los grupos que se eligen en masivo; en las demás bases el grupo es la propia base. */
export const GRUPOS_DE_MASIVO = ['TP', 'KONECTA', 'TP/KONECTA'];

/** Si la unidad es de masivo, la única base donde el grupo se elige. */
export const esDeMasivo = (base) => texto(base).toUpperCase() === 'MASIVO';

/** Una fecha AAAA-MM-DD como día/mes/año, que es como la escribe la base; lo demás, tal cual. */
export const fechaLegible = (iso) => {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto(iso));
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : texto(iso);
};
