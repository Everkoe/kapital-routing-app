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
// Un certificado de dos hojas (el CAMO): la hoja 1 en el campo y la hoja 2 en
// su `Reverso`, como las caras de una tarjeta, pero sin archivo con las dos
// juntas: cada hoja se sube en la suya (pedido del usuario).
export const TIPO_DOS_HOJAS = 'dosHojas';

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

/**
 * Cómo se llaman las caras y qué se dice de ellas, según el documento: un
 * carnet tiene delante y detrás; un certificado, hojas.
 */
const TEXTOS_DE_CARAS = {
  [TIPO_TARJETA]: {
    completo: CARA_COMPLETO,
    delante: CARA_DELANTE,
    detras: CARA_DETRAS,
    enUno: 'Documento completo en un solo archivo',
    separadas: 'Delante y detrás subidos',
    pistaCompleto: 'ambas caras en una',
    bloqueada: 'Ya está la imagen completa: no hace falta por caras.',
  },
  [TIPO_DOS_HOJAS]: {
    delante: 'Hoja 1',
    detras: 'Hoja 2',
    separadas: 'Hoja 1 y hoja 2 subidas',
  },
};

/** Los textos de las caras de un documento, o `null` si es de una sola. */
export const textosDeCaras = (documento) => TEXTOS_DE_CARAS[documento?.tipo] || null;

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
  // La clave sigue siendo `comprobanteDomicilio` aunque el documento ya no se
  // llame así: con ella están guardados los archivos que ya se subieron.
  { key: 'comprobanteDomicilio', label: 'Declaración Jurada de Domicilio', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR },
  // Como el domicilio: el nombre cambió (pedido del usuario, 2026-10-01) y la
  // clave no, porque con ella están guardados los archivos ya subidos.
  { key: 'recordConductor', label: 'Ficha de Conductor', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR },
  { key: 'antecedentesPoliciales', label: 'Antecedentes Policiales', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR },
  { key: 'cv', label: 'Currículum Vitae', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR },
  { key: 'certificadosTrabajo', label: 'Certificados de Trabajo', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR, opcional: true },
  { key: 'referenciasLaborales', label: 'Referencias Laborales', tipo: TIPO_PAPEL, dueno: DUENO_CONDUCTOR, opcional: true },
  // El certificado médico que emite la clínica (pedido del usuario, 2026-09-30).
  // Lo sube Administración: no se pide en el alta ni sale en las pantallas
  // del conductor, y el servidor no se lo acepta a él
  // (`_DOCUMENTOS_DE_ADMINISTRACION`). Tampoco se aprueba ni se rechaza: lo
  // pone quien lo revisaría. La clínica entrega dos hojas, y cada una se sube
  // en la suya, en foto o en PDF.
  {
    key: 'camo',
    label: 'CAMO',
    detalle: 'Certificado de Aptitud Médico Ocupacional',
    tipo: TIPO_DOS_HOJAS,
    dueno: DUENO_CONDUCTOR,
    soloAdministracion: true,
  },
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

/** Un documento de dos caras (o de dos hojas) admite reverso; uno de papel, no. */
export const admiteReverso = (documento) => Boolean(textosDeCaras(documento));

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

/** Si lo sube Administración y no el conductor (el CAMO). */
export const esDeAdministracion = (documento) => Boolean(documento?.soloAdministracion);

/** Lo que el conductor ve y entrega desde su cuenta: todo menos lo de Administración. */
export const documentosQueEntregaElConductor = () =>
  DOCUMENTOS_CONDUCTOR.filter((documento) => !esDeAdministracion(documento));

/**
 * El orden de la revisión, el que pidió el usuario (2026-10-01): de tres en
 * tres, como se ven en la ficha. Lo que no está aquí va detrás, en el orden del
 * catálogo.
 */
export const ORDEN_DE_REVISION = [
  'recordConductor', 'comprobanteDomicilio', 'dniScaneado',
  'licenciaConducir', 'antecedentesPoliciales', 'tarjetaPropiedad',
  'revisionTecnica', 'soat',
];

/**
 * Los documentos de la revisión, en el orden en que se pintan: los de
 * `ORDEN_DE_REVISION`, el resto y, al final, lo que sube Administración.
 *
 * El CAMO va el último porque es lo último que se añade y porque su tarjeta,
 * con dos hojas, es más alta que las demás: en medio estiraba su fila y
 * descolocaba las de al lado.
 */
export const documentosDeLaRevision = () => {
  const posicion = (documento) => {
    const indice = ORDEN_DE_REVISION.indexOf(documento.key);
    return indice === -1 ? ORDEN_DE_REVISION.length : indice;
  };
  // `filter` da una copia, y a igualdad de posición `sort` (estable) deja el
  // orden del catálogo.
  const enOrden = DOCUMENTOS_CONDUCTOR
    .filter((documento) => !esDeAdministracion(documento))
    .sort((a, b) => posicion(a) - posicion(b));
  return { enOrden, deAdministracion: DOCUMENTOS_CONDUCTOR.filter(esDeAdministracion) };
};

/** Todas las claves que puede ocupar un documento, reversos incluidos. */
export const todasLasClaves = () =>
  DOCUMENTOS_CONDUCTOR.flatMap((documento) => carasDeDocumento(documento).map((cara) => cara.campo));

/**
 * Etiqueta de una cara concreta. El anverso solo se nombra como tal cuando el
 * documento tiene dos: para un documento de papel, decir «anverso» sobraría.
 */
export const etiquetaCara = (documento, cara) => {
  const textos = textosDeCaras(documento);
  if (!textos) return documento.label;
  const nombre = { reverso: textos.detras, completo: textos.completo }[cara] || textos.delante;
  return `${documento.label} · ${nombre}`;
};

/**
 * Caras posibles de un documento, en el orden en que se ofrecen.
 *
 * «Completo» va primero porque es lo que se sube casi siempre: una sola imagen
 * con las dos caras. Iba al final, como la alternativa, y la gente subía la
 * imagen completa en «Delante». Las caras por separado quedan para quien las
 * tiene en dos fotos.
 */
export const carasDeDocumento = (documento) => {
  const textos = textosDeCaras(documento);
  if (!textos) return [{ campo: documento.key, nombre: documento.label }];
  const sueltas = [
    { campo: documento.key, nombre: textos.delante },
    { campo: claveReverso(documento.key), nombre: textos.detras, opcional: true },
  ];
  // Un documento de dos hojas no tiene «las dos juntas»: cada una en la suya.
  return textos.completo
    ? [{ campo: claveCompleto(documento.key), nombre: textos.completo, opcional: true }, ...sueltas]
    : sueltas;
};

/** Si la cara es la del archivo con todo junto. Por el campo: el nombre cambia con el documento. */
export const esCaraCompleta = (cara) => String(cara?.campo || '').endsWith(SUFIJO_COMPLETO);
const esCompleto = esCaraCompleta;

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
