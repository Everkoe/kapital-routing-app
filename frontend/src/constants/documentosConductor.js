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

/**
 * Sufijo del campo hermano que guarda la segunda cara.
 *
 * La clave conserva «Reverso» aunque la interfaz diga «detrás»: renombrarla
 * dejaría huérfano todo lo ya subido. El nombre visible y el nombre del campo
 * son cosas distintas y solo el primero necesita ser coloquial.
 */
export const SUFIJO_REVERSO = 'Reverso';

/**
 * Sufijo del campo que guarda ambas caras en un solo archivo.
 *
 * Es habitual escanear delante y detrás en la misma hoja. Ese archivo no es
 * «la cara de delante», así que guardarlo en el campo principal haría creer que
 * falta el reverso. Con campo propio, la interfaz sabe qué tiene delante y no
 * pide de más.
 */
export const SUFIJO_COMPLETO = 'Completo';

/** Nombres visibles de cada cara. */
export const CARA_DELANTE = 'Delante';
export const CARA_DETRAS = 'Detrás';
export const CARA_COMPLETO = 'Completo';

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
  // El cuestionario de manejo defensivo no está: no es un papel que se suba
  // sino el test del alta (`QuizManejoDefensivo`), y como documento salía en
  // la ficha con «Sin archivo» y un botón de subir. Nadie subió nunca uno.

  // --- Del vehículo ---
  { key: 'tarjetaPropiedad', label: 'Tarjeta de Propiedad', tipo: TIPO_TARJETA, dueno: DUENO_VEHICULO },
  { key: 'soat', label: 'SOAT', tipo: TIPO_PAPEL, dueno: DUENO_VEHICULO },
  { key: 'revisionTecnica', label: 'Revisión Técnica', tipo: TIPO_PAPEL, dueno: DUENO_VEHICULO },
];

/** Campo hermano donde vive la segunda cara de un documento de tarjeta. */
export const claveReverso = (key) => `${key}${SUFIJO_REVERSO}`;

/** Campo hermano donde vive el archivo con ambas caras juntas. */
export const claveCompleto = (key) => `${key}${SUFIJO_COMPLETO}`;

/** Un documento de dos caras admite reverso; uno de papel, no. */
export const admiteReverso = (documento) => documento?.tipo === TIPO_TARJETA;

/**
 * Vencimiento de la unidad que corresponde a cada documento.
 *
 * El archivo y su fecha son cosas distintas —uno vive en Storage, la otra en la
 * ficha de la unidad— pero para quien revisa son lo mismo: mira el SOAT y
 * quiere saber hasta cuándo vale. Este mapa deja abrir la fecha junto a la
 * imagen en vez de obligar a cerrar el visor e ir a buscarla.
 */
export const VIGENCIA_POR_DOCUMENTO = {
  soat: { campo: 'soat', etiqueta: 'Vencimiento del SOAT' },
  revisionTecnica: { campo: 'revision', etiqueta: 'Vencimiento de la revisión técnica' },
  licenciaConducir: { campo: 'licencia', etiqueta: 'Vencimiento de la licencia MTC' },
};

export const vigenciaDeDocumento = (key) => VIGENCIA_POR_DOCUMENTO[key] || null;

/** El documento al que pertenece una cara (`licenciaConducirReverso` → `licenciaConducir`). */
export const documentoDeCampo = (campo) => String(campo || '').replace(/(Reverso|Completo)$/, '');

/**
 * Dónde escribe el conductor hasta cuándo vale un documento que vence, o
 * `null` si no vence. Es la fecha que llega al panel de Gestión de Flota
 * (`_VENCE_EN_PERFIL` en el backend).
 */
export const campoDeVencimiento = (key) => (VIGENCIA_POR_DOCUMENTO[documentoDeCampo(key)]
  ? `${documentoDeCampo(key)}Vence`
  : null);

/** Una fecha AAAA-MM-DD que existe. */
export const fechaValida = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(String(valor ?? ''))
  && !Number.isNaN(Date.parse(`${valor}T00:00:00Z`));

export const documentoPorClave = (key) =>
  DOCUMENTOS_CONDUCTOR.find((documento) => documento.key === key) || null;

export const documentosPorDueno = (dueno) =>
  DOCUMENTOS_CONDUCTOR.filter((documento) => documento.dueno === dueno);

/** Todas las claves que puede ocupar un documento, reversos incluidos. */
export const todasLasClaves = () =>
  DOCUMENTOS_CONDUCTOR.flatMap((documento) =>
    admiteReverso(documento)
      ? [documento.key, claveReverso(documento.key), claveCompleto(documento.key)]
      : [documento.key],
  );

/**
 * Etiqueta de una cara concreta. El anverso solo se nombra como tal cuando el
 * documento tiene dos: para un documento de papel, decir «anverso» sobraría.
 */
const NOMBRE_DE_CARA = {
  reverso: CARA_DETRAS,
  completo: CARA_COMPLETO,
};

export const etiquetaCara = (documento, cara) => {
  if (!admiteReverso(documento)) return documento.label;
  return `${documento.label} · ${NOMBRE_DE_CARA[cara] || CARA_DELANTE}`;
};

/**
 * Caras posibles de un documento, en el orden en que se ofrecen.
 *
 * «Completo» va primero porque es lo que se sube casi siempre: una sola imagen
 * con las dos caras. Iba al final, como la alternativa, y la gente subía la
 * imagen completa en «Delante». Las caras por separado quedan para quien las
 * tiene en dos fotos.
 */
export const carasDeDocumento = (documento) =>
  admiteReverso(documento)
    ? [
        { campo: claveCompleto(documento.key), nombre: CARA_COMPLETO, opcional: true },
        { campo: documento.key, nombre: CARA_DELANTE },
        { campo: claveReverso(documento.key), nombre: CARA_DETRAS, opcional: true },
      ]
    : [{ campo: documento.key, nombre: documento.label }];

const esCompleto = (cara) => String(cara?.campo || '').endsWith(SUFIJO_COMPLETO);

/**
 * Si una cara no se puede subir: delante y detrás, mientras haya una imagen
 * completa. Con ella el documento está entregado, y otra foto suelta al lado
 * solo haría dudar de cuál vale. «Completo» se puede reemplazar siempre.
 */
export const caraBloqueada = (cara, caras) =>
  !esCompleto(cara) && (Array.isArray(caras) ? caras : []).some((otra) => esCompleto(otra) && otra.tieneArchivo);

/**
 * Cara a la que va un archivo soltado o pegado sobre la tarjeta del documento.
 *
 * Con la imagen completa subida, se reemplaza esa: las otras están
 * bloqueadas. Si ya se empezó por caras sueltas, el primer hueco de esas
 * (delante antes que detrás), y con las dos llenas se reemplaza delante. Sin
 * nada subido, a «Completo», que es lo habitual.
 */
export const caraDestinoParaArrastre = (caras) => {
  const lista = Array.isArray(caras) ? caras.filter(Boolean) : [];
  if (lista.length === 0) return null;
  const completo = lista.find(esCompleto);
  const sueltas = lista.filter((cara) => !esCompleto(cara));
  if (completo?.tieneArchivo) return completo.campo;
  if (sueltas.some((cara) => cara.tieneArchivo)) {
    return (sueltas.find((cara) => !cara.tieneArchivo) || sueltas[0]).campo;
  }
  return (completo || lista[0]).campo;
};

/**
 * El perfil tras subir un documento nuevo: con él y con su revisión otra vez
 * pendiente, que es lo que hace el servidor (`resubmit-docs`). Sin esto, un
 * documento aprobado que se reemplazaba seguía diciendo «Aprobado» en la ficha
 * abierta, aunque nadie hubiera visto el archivo nuevo.
 */
export const conDocumentoNuevo = (perfil, campo, documento) => {
  const revisiones = perfil?.revision_docs || {};
  return {
    ...perfil,
    [campo]: documento,
    ...(revisiones[campo]
      ? { revision_docs: { ...revisiones, [campo]: { ...revisiones[campo], estado: 'pendiente' } } }
      : {}),
  };
};

/**
 * Cara por la que se abre la tarjeta.
 *
 * No es lo mismo que el destino de un arrastre: allí se decide dónde cae un
 * archivo, y aquí qué se le enseña a quien llega. Si ya hay una imagen con
 * ambas caras el documento está resuelto, así que se abre por ella. Abrir por
 * el anverso vacío pedía subir algo que el conductor ya había entregado.
 */
export const caraInicial = (caras) => caraDestinoParaArrastre(caras);
