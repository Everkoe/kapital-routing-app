/**
 * Reglas de presentación de un archivo de documento.
 *
 * Viven fuera del componente porque son lógica pura y así se pueden probar:
 * Node no importa `.jsx`, y estas decisiones —si algo es PDF, si hay contenido
 * que mostrar, qué caras tiene un documento— son justo las que conviene fijar.
 */

/** El PDF puede venir como data URL o como enlace con extensión. */
export const esPdf = (src = '') =>
  String(src).toLowerCase().includes('.pdf') || String(src).startsWith('data:application/pdf');

/**
 * Solo `data:` y `http` son mostrables. Una ruta relativa o un nombre suelto
 * pintarían una imagen rota, y es preferible decir que no está disponible.
 */
export const tieneContenido = (src = '') =>
  String(src).startsWith('data:') || String(src).startsWith('http');

/**
 * Caras a mostrar. Un documento de una sola cara llega sin `caras` y se
 * normaliza a una lista de uno, para que el visor no tenga dos caminos.
 */
export const carasDe = (documento) =>
  documento?.caras?.length
    ? documento.caras
    : [{ nombre: null, src: documento?.src, raw: documento?.raw }];

/**
 * Archivo de imagen contenido en un pegado, si lo hay.
 *
 * Una captura de pantalla llega como fichero dentro de `clipboardData`, pero
 * el mismo evento puede traer además texto —la ruta, un HTML con la imagen—,
 * así que hay que buscar el fichero en vez de confiar en el primer elemento.
 * Devuelve `null` cuando lo pegado no contiene ninguno, para que el pegado
 * normal de texto siga su curso.
 */
export const archivoDePortapapeles = (clipboardData) => {
  if (!clipboardData) return null;

  const directos = Array.from(clipboardData.files || []);
  if (directos.length > 0) return directos[0];

  for (const item of Array.from(clipboardData.items || [])) {
    if (item.kind === 'file') {
      const archivo = item.getAsFile?.();
      if (archivo) return archivo;
    }
  }
  return null;
};

/**
 * Un pegado dirigido a un campo de texto no es para nosotros.
 *
 * Sin esta comprobación, pegar en el cuadro de aviso al conductor o en el
 * padrón mientras el cursor pasa sobre una tarjeta intentaría subir un
 * documento y se tragaría el texto.
 */
export const pegadoEnCampoDeTexto = (target) =>
  Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
