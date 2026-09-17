/**
 * Qué se le pide al conductor en su alta, en un solo sitio.
 *
 * Antes esta lista vivía dentro de `calculateProgress()` como una tira de
 * dieciséis `if`, y no la podía usar nadie más: el formulario sabía cuánto
 * faltaba pero no qué faltaba, así que el botón «Enviar para Revisión» se
 * quedaba deshabilitado sin decir por qué. Al declararla aquí, el mismo
 * conjunto de reglas alimenta el porcentaje, el aviso de cada campo y la lista
 * de lo que queda pendiente.
 *
 * Un campo puede estar de tres maneras: bien, sin rellenar u ocupado con algo
 * que no sirve —un DNI de siete dígitos, un correo sin arroba—. Los dos
 * últimos se señalan igual en ámbar, porque para el conductor son el mismo
 * problema: eso todavía no está listo.
 */

export const ESTADO_OK = 'ok';
export const ESTADO_FALTA = 'falta';
export const ESTADO_INVALIDO = 'invalido';

const LARGO_DNI = 8;
const LARGO_MINIMO_OTRO_DOC = 8;
const LARGO_MINIMO_TELEFONO = 6;

const FORMATO_CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const conTexto = (valor) => String(valor ?? '').trim().length > 0;
const digitos = (valor) => String(valor ?? '').replace(/\D/g, '');

/**
 * Un archivo puede ser un `File` recién elegido o lo que devuelve Storage
 * (`{ name, path }`). Cualquiera de los dos cuenta como entregado.
 */
const hayArchivo = (valor) => {
  if (!valor) return false;
  if (typeof valor === 'string') return valor.trim().length > 0;
  return Boolean(valor.name || valor.path || valor.base64 || valor.size);
};

export const CAMPOS_ONBOARDING = [
  { campo: 'nombres', seccion: 'personales', etiqueta: 'Nombres y apellidos' },
  {
    campo: 'numDoc',
    seccion: 'personales',
    etiqueta: 'Número de documento',
    valido: (valor, datos) => (datos?.tipoDoc === 'DNI'
      ? digitos(valor).length === LARGO_DNI
      : digitos(valor).length >= LARGO_MINIMO_OTRO_DOC),
    ayuda: (datos) => (datos?.tipoDoc === 'DNI'
      ? `El DNI tiene ${LARGO_DNI} dígitos.`
      : `Debe tener al menos ${LARGO_MINIMO_OTRO_DOC} dígitos.`),
  },
  { campo: 'fechaNacimiento', seccion: 'personales', etiqueta: 'Fecha de nacimiento' },
  { campo: 'direccion', seccion: 'personales', etiqueta: 'Dirección de residencia' },
  {
    campo: 'telefonoDirecto',
    seccion: 'personales',
    etiqueta: 'Teléfono directo',
    valido: (valor) => digitos(valor).length >= LARGO_MINIMO_TELEFONO,
    ayuda: 'Escribe el número completo.',
  },
  // El correo no se exige —hay conductores que no usan uno—, pero si lo
  // escriben tiene que servir: es por donde se recupera la contraseña.
  {
    campo: 'correo',
    seccion: 'personales',
    etiqueta: 'Correo electrónico',
    requerido: false,
    valido: (valor) => FORMATO_CORREO.test(String(valor).trim().toLowerCase()),
    ayuda: 'Revisa que tenga @ y el dominio, como nombre@gmail.com.',
  },
  { campo: 'comprobanteDomicilio', seccion: 'personales', etiqueta: 'Comprobante de domicilio', archivo: true },
  { campo: 'dniScaneado', seccion: 'personales', etiqueta: 'DNI escaneado', archivo: true },
  { campo: 'licenciaConducir', seccion: 'personales', etiqueta: 'Licencia de conducir', archivo: true },
  { campo: 'recordConductor', seccion: 'personales', etiqueta: 'Récord del conductor', archivo: true },
  { campo: 'antecedentesPoliciales', seccion: 'personales', etiqueta: 'Antecedentes policiales', archivo: true },

  { campo: 'vehiculoMarca', seccion: 'vehiculares', etiqueta: 'Marca del vehículo' },
  { campo: 'vehiculoPlaca', seccion: 'vehiculares', etiqueta: 'Placa' },
  {
    campo: 'vehiculoCapacidad',
    seccion: 'vehiculares',
    etiqueta: 'Capacidad (pasajeros)',
    valido: (valor) => Number.parseInt(valor, 10) > 0,
    ayuda: 'Indica cuántos pasajeros caben.',
  },
  { campo: 'tarjetaPropiedad', seccion: 'vehiculares', etiqueta: 'Tarjeta de propiedad', archivo: true },
  { campo: 'soat', seccion: 'vehiculares', etiqueta: 'SOAT', archivo: true },

  // El cuestionario no es un archivo ni un texto: es el resultado que deja
  // `QuizManejoDefensivo` al terminarlo.
  {
    campo: 'quizManejoDefensivo',
    seccion: 'manejo',
    etiqueta: 'Cuestionario de manejo defensivo',
    presente: (valor) => Boolean(valor && typeof valor === 'object'),
  },
];

/** Reglas que cuentan para el porcentaje: solo las obligatorias. */
const obligatorias = () => CAMPOS_ONBOARDING.filter((regla) => regla.requerido !== false);

export const reglaDe = (campo) => CAMPOS_ONBOARDING.find((regla) => regla.campo === campo) || null;

export const estadoDeCampo = (campo, datos) => {
  const regla = typeof campo === 'string' ? reglaDe(campo) : campo;
  if (!regla) return ESTADO_OK;

  const valor = datos?.[regla.campo];
  const presente = regla.presente || (regla.archivo ? hayArchivo : conTexto);
  const lleno = presente(valor);
  if (!lleno) return regla.requerido === false ? ESTADO_OK : ESTADO_FALTA;
  if (regla.valido && !regla.valido(valor, datos)) return ESTADO_INVALIDO;
  return ESTADO_OK;
};

/** Texto que explica por qué un campo está en ámbar. */
export const ayudaDeCampo = (campo, datos) => {
  const regla = typeof campo === 'string' ? reglaDe(campo) : campo;
  if (!regla) return '';
  const estado = estadoDeCampo(regla, datos);
  if (estado === ESTADO_OK) return '';
  if (estado === ESTADO_FALTA) return 'Falta completar este dato.';
  return typeof regla.ayuda === 'function' ? regla.ayuda(datos) : (regla.ayuda || 'Revisa este dato.');
};

/** Reglas que todavía no están resueltas, en el orden del formulario. */
export const camposPendientes = (datos) =>
  CAMPOS_ONBOARDING.filter((regla) => estadoDeCampo(regla, datos) !== ESTADO_OK);

export const progresoDe = (datos) => {
  const reglas = obligatorias();
  const listas = reglas.filter((regla) => estadoDeCampo(regla, datos) === ESTADO_OK).length;
  return Math.round((listas / reglas.length) * 100);
};

/** Estado de una sección del acordeón, para su icono de cabecera. */
export const seccionCompleta = (seccion, datos) =>
  CAMPOS_ONBOARDING
    .filter((regla) => regla.seccion === seccion && regla.requerido !== false)
    .every((regla) => estadoDeCampo(regla, datos) === ESTADO_OK);
