/**
 * Reglas del registro de una unidad nueva.
 *
 * Están aquí y no dentro del formulario para poder probarlas sin montar el
 * modal, que es donde antes vivían mezcladas con el `onChange` de cada campo.
 */

export const TIPOS_DE_UNIDAD = ['AUTO', 'SUV', 'VAN', 'MINIVAN', 'CAMIONETA'];

/**
 * Capacidad que se propone al elegir el tipo.
 *
 * Solo se propone donde la flota real no deja lugar a dudas: las 42 unidades
 * AUTO llevan 4 plazas y las 8 minivan llevan 7, sin una sola excepción. SUV
 * va de 4 a 7 y VAN de 7 a 15, así que proponer un número sería inventarlo:
 * esos tipos dejan el campo vacío para que lo escriba quien da de alta.
 */
export const CAPACIDAD_SUGERIDA = {
  AUTO: 4,
  MINIVAN: 7,
};

/** Tope operativo: por encima deja de ser una unidad de esta flota. */
export const CAPACIDAD_MAXIMA = 20;

/** Documentos de la unidad que el alta puede recoger, con su vencimiento. */
export const DOCUMENTOS_DE_UNIDAD = [
  { campo: 'soat', etiqueta: 'SOAT', archivo: 'soat_doc' },
  { campo: 'revision', etiqueta: 'Revisión técnica', archivo: 'revision_doc' },
  { campo: 'licencia', etiqueta: 'Licencia MTC', archivo: 'licencia_doc' },
];

const limpio = (valor) => String(valor ?? '').trim();

/** Padrón y placa se guardan en mayúsculas y sin espacios sobrantes. */
export const normalizarCodigo = (valor) => limpio(valor).toUpperCase();

export const capacidadValida = (valor) => {
  const numero = Number.parseInt(valor, 10);
  return Number.isInteger(numero) && numero > 0 && numero <= CAPACIDAD_MAXIMA;
};

/**
 * Qué falta para poder registrar, por campo.
 *
 * Los documentos no entran: hoy se puede dar de alta una unidad sin ellos y
 * exigirlos aquí dejaría fuera a las que todavía no los han entregado. Lo que
 * sí se comprueba es que una fecha de vencimiento no se quede sin su archivo
 * ni al revés, porque una sin la otra no dice nada.
 */
export const erroresDeUnidad = (datos) => {
  const errores = {};

  if (!limpio(datos.padron)) errores.padron = 'El padrón es obligatorio.';
  if (!limpio(datos.placa)) errores.placa = 'La placa del vehículo es obligatoria.';
  if (!limpio(datos.chofer)) errores.chofer = 'El nombre del conductor es obligatorio.';

  if (!limpio(datos.capacidad)) {
    errores.capacidad = 'Indica cuántos pasajeros caben.';
  } else if (!capacidadValida(datos.capacidad)) {
    errores.capacidad = `Debe ser un número entero entre 1 y ${CAPACIDAD_MAXIMA}.`;
  }

  // El teléfono es opcional, pero escrito a medias no sirve para nada.
  const telefono = limpio(datos.telefono).replace(/\D/g, '');
  if (limpio(datos.telefono) && telefono.length < 9) {
    errores.telefono = 'Escribe el número completo o déjalo vacío.';
  }

  return errores;
};

/** Si el formulario tiene algo escrito que se perdería al cerrarlo. */
export const tieneCambios = (datos, archivos) => (
  Object.entries(datos).some(([clave, valor]) => (
    clave === 'tipo' ? false : limpio(valor) !== ''
  )) || Object.values(archivos || {}).some(Boolean)
);
