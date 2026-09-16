/**
 * Catálogo único de documentos del conductor.
 *
 * Existe porque cada pantalla tenía su propia lista y no coincidían: el wizard
 * de alta manejaba doce campos y la revisión del administrador mostraba nueve,
 * así que un conductor podía subir certificados de trabajo, referencias
 * laborales y el cuestionario de manejo defensivo y nadie los veía nunca.
 *
 * Anverso y reverso
 * -----------------
 * Los documentos de tipo `tarjeta` son físicos y de dos caras: una sola foto
 * muestra la mitad. Para esos, el reverso se guarda en un **campo hermano**
 * (`dniScaneado` → `dniScaneadoReverso`) en vez de cambiar la forma del dato a
 * `{ anverso, reverso }`. La razón es práctica: lo ya subido sigue siendo
 * válido sin migrar nada, el backend trata el campo como texto libre y no
 * necesita cambios, y la revisión por campo permite rechazar solo la cara
 * borrosa en lugar del documento entero.
 *
 * El reverso nunca es obligatorio. Un PDF puede traer ambas caras en sus
 * páginas, y hay trámites que se resuelven con una sola.
 */

export const TIPO_TARJETA = 'tarjeta';
export const TIPO_PAPEL = 'papel';

export const DUENO_CONDUCTOR = 'conductor';
export const DUENO_VEHICULO = 'vehiculo';

/** Sufijo del campo hermano que guarda la segunda cara. */
export const SUFIJO_REVERSO = 'Reverso';

export const DOCUMENTOS_CONDUCTOR = [
  // --- Personales ---
  { key: 'dniScaneado', label: 'DNI Escaneado', tipo: TIPO_TARJETA, dueno: DUENO_CONDUCTOR },
  { key: 'licenciaConducir', label: 'Licencia de Conducir', tipo: TIPO_TARJETA, dueno: DUENO_CONDUCTOR },
  {
    key: 'lunasPolarizadas',
    label: 'Autorización de Lunas Polarizadas',
    tipo: TIPO_TARJETA,
    dueno: DUENO_CONDUCTOR,
    opcional: true,
  },
  { key: 'comprobanteDomicilio', label: 'Comprobante de Domicilio', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR },
  { key: 'recordConductor', label: 'Récord de Conductor', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR },
  { key: 'antecedentesPoliciales', label: 'Antecedentes Policiales', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR },
  { key: 'cv', label: 'Currículum Vitae', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR },
  { key: 'certificadosTrabajo', label: 'Certificados de Trabajo', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR, opcional: true },
  { key: 'referenciasLaborales', label: 'Referencias Laborales', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR, opcional: true },
  { key: 'cuestionarioManejoDefensivo', label: 'Cuestionario de Manejo Defensivo', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR },

  // --- Del vehículo ---
  { key: 'tarjetaPropiedad', label: 'Tarjeta de Propiedad', tipo: TIPO_TARJETA, dueno: DUENO_VEHICULO },
  { key: 'soat', label: 'SOAT', tipo: TIPO_PAPEL, dueno: DUENO_VEHICULO },
  { key: 'revisionTecnica', label: 'Revisión Técnica', tipo: TIPO_PAPEL, dueno: DUENO_VEHICULO },
];

/** Campo hermano donde vive la segunda cara de un documento de tarjeta. */
export const claveReverso = (key) => `${key}${SUFIJO_REVERSO}`;

/** Un documento de dos caras admite reverso; uno de papel, no. */
export const admiteReverso = (documento) => documento?.tipo === TIPO_TARJETA;

export const documentosPorDueno = (dueno) =>
  DOCUMENTOS_CONDUCTOR.filter((documento) => documento.dueno === dueno);

/** Todas las claves que puede ocupar un documento, reversos incluidos. */
export const todasLasClaves = () =>
  DOCUMENTOS_CONDUCTOR.flatMap((documento) =>
    admiteReverso(documento) ? [documento.key, claveReverso(documento.key)] : [documento.key],
  );

/**
 * Etiqueta de una cara concreta. El anverso solo se nombra como tal cuando el
 * documento tiene dos: para un documento de papel, decir «anverso» sobraría.
 */
export const etiquetaCara = (documento, cara) => {
  if (!admiteReverso(documento)) return documento.label;
  return `${documento.label} · ${cara === 'reverso' ? 'Reverso' : 'Anverso'}`;
};

/**
 * Cara a la que va un archivo soltado sobre la tarjeta del documento.
 *
 * El primer hueco libre, anverso antes que reverso. Si ya están todas llenas,
 * reemplaza la primera: es lo que se reemplaza casi siempre, y cualquier otra
 * regla obligaría al usuario a adivinar dónde cae lo que suelta.
 */
export const caraDestinoParaArrastre = (caras) => {
  const lista = Array.isArray(caras) ? caras.filter(Boolean) : [];
  if (lista.length === 0) return null;
  return (lista.find((cara) => !cara.tieneArchivo) || lista[0]).campo;
};
