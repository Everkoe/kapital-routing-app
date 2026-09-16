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
