/**
 * Las cuentas del zoom del visor de documentos.
 *
 * Una foto de un documento se encaja al alto del visor, y ahí la letra pequeña
 * —un número de DNI, la fecha de un SOAT— a menudo no se lee. El visor deja
 * acercarse con la rueda, con los botones o con doble clic, y moverse
 * arrastrando.
 *
 * La vista es `{ escala, x, y }`: la imagen se pinta con
 * `translate(x, y) scale(escala)` desde su centro, y `x`, `y` son lo que su
 * centro se aparta del centro del marco. Las medidas son las del marco y las de
 * la imagen a escala 1 (`{ marco: { ancho, alto }, imagen: { ancho, alto } }`).
 *
 * Vive aparte del componente porque es lógica pura y así se prueba.
 */

export const ESCALA_MINIMA = 1;
export const ESCALA_MAXIMA = 6;
/** Cada pulsación de los botones, o cada muesca de la rueda, multiplica por esto. */
export const PASO_DE_ZOOM = 1.25;
/** El doble clic acerca hasta aquí de una vez: lo justo para leer la letra pequeña. */
export const ESCALA_DOBLE_CLIC = 2.5;
export const VISTA_INICIAL = Object.freeze({ escala: 1, x: 0, y: 0 });

// Una muesca de la rueda del ratón son unos 100 píxeles de `deltaY`.
const PIXELES_POR_MUESCA = 100;
// Firefox puede contarla en líneas (`deltaMode` 1) en vez de en píxeles.
const PIXELES_POR_LINEA = 33;
const DELTA_EN_LINEAS = 1;

const acotar = (valor, minimo, maximo) => Math.min(Math.max(valor, minimo), maximo);

export const acotarEscala = (escala) =>
  acotar(Number.isFinite(escala) ? escala : ESCALA_MINIMA, ESCALA_MINIMA, ESCALA_MAXIMA);

/** Cuánto puede apartarse el centro en un eje sin que la imagen deje hueco en un lado. */
const holgura = (tamanoImagen, tamanoMarco, escala) =>
  Math.max(0, (tamanoImagen * escala - tamanoMarco) / 2);

/** Acota el desplazamiento para que la imagen no se salga del marco. */
const acotarEje = (valor, margen) => (margen === 0 ? 0 : acotar(valor, -margen, margen));

export const acotarVista = (vista, medidas) => {
  const escala = acotarEscala(vista.escala);
  return {
    escala,
    x: acotarEje(vista.x, holgura(medidas.imagen.ancho, medidas.marco.ancho, escala)),
    y: acotarEje(vista.y, holgura(medidas.imagen.alto, medidas.marco.alto, escala)),
  };
};

/**
 * Cambia la escala dejando quieto lo que hay bajo `punto` (relativo al centro
 * del marco), que es lo que se espera al acercarse con la rueda a una zona.
 */
export const zoomHacia = (vista, escalaNueva, punto, medidas) => {
  const escala = acotarEscala(escalaNueva);
  const factor = escala / vista.escala;
  return acotarVista({
    escala,
    x: punto.x - (punto.x - vista.x) * factor,
    y: punto.y - (punto.y - vista.y) * factor,
  }, medidas);
};

export const desplazar = (vista, dx, dy, medidas) =>
  acotarVista({ ...vista, x: vista.x + dx, y: vista.y + dy }, medidas);

/**
 * La escala tras girar la rueda. Es proporcional al giro, así que una muesca
 * del ratón da un paso entero y el pellizco del panel táctil —que llega como
 * rueda con deltas pequeños— acerca poco a poco.
 */
export const escalaTrasRueda = (escala, deltaY, deltaMode = 0) => {
  const pixeles = deltaMode === DELTA_EN_LINEAS ? deltaY * PIXELES_POR_LINEA : deltaY;
  return escala * PASO_DE_ZOOM ** (-pixeles / PIXELES_POR_MUESCA);
};
