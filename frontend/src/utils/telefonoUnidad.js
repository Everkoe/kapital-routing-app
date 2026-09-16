/**
 * Teléfono de contacto de una unidad y su enlace de WhatsApp.
 *
 * Existe porque el número vive en dos sitios y cada pantalla miraba uno
 * distinto: `telefono` lo tiene 1 de 109 unidades, mientras `celular` —traído
 * del perfil del conductor— lo tienen 108. El icono de WhatsApp comprobaba solo
 * el primero, así que no aparecía casi nunca aunque el número estuviera a la
 * vista en la ficha del conductor.
 */

/** Código de país que se asume cuando el número no lo trae. */
const PREFIJO_PERU = '51';

/** Longitud de un móvil peruano sin código de país. */
const LARGO_MOVIL_LOCAL = 9;

export const telefonoDeUnidad = (unidad) => {
  const propio = String(unidad?.telefono ?? '').trim();
  if (propio) return propio;
  return String(unidad?.celular ?? '').trim();
};

/**
 * Número en el formato que espera `wa.me`: solo dígitos y con código de país.
 *
 * Un móvil peruano se guarda casi siempre como nueve dígitos que empiezan por
 * 9. Enlazar eso tal cual abre WhatsApp con un número inexistente, así que se
 * le antepone el 51. Cualquier otra forma se deja intacta: adivinar el país de
 * un número que no reconocemos sería peor que no enlazar.
 *
 * Devuelve `null` cuando no hay nada enlazable, para que quien llame oculte el
 * botón en vez de ofrecer un enlace roto.
 */
export const whatsappDeUnidad = (unidad) => {
  const digitos = telefonoDeUnidad(unidad).replace(/\D/g, '');
  if (!digitos) return null;

  if (digitos.length === LARGO_MOVIL_LOCAL && digitos.startsWith('9')) {
    return `${PREFIJO_PERU}${digitos}`;
  }
  // Demasiado corto para ser un número real: mejor no enlazar.
  if (digitos.length < LARGO_MOVIL_LOCAL) return null;
  return digitos;
};
