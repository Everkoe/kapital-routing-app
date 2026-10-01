/**
 * Lo que la página «Mi perfil» calcula, sin React, para poder probarlo.
 */

/** Lo que exige el servidor a una contraseña nueva (`/api/user/profile`). */
export const MINIMO_CONTRASENA = 4;

const texto = (valor) => String(valor ?? '').trim();

/** «Ana López Díaz» → «AL»; «Programador» → «PR»; nada → «?». */
export const iniciales = (nombre) => {
  const partes = texto(nombre).split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
};

/**
 * Con qué entra la persona y cómo llamarlo. Las cuentas creadas desde la página
 * entran con el DNI y las demás con el correo; casi ninguna de conductor lleva
 * `identifier`, y entonces vale el correo o el DNI.
 */
export const cuentaDe = (usuario) => {
  const valor = texto(usuario?.identifier || usuario?.email || usuario?.dni);
  if (valor.includes('@')) return { etiqueta: 'Correo', valor };
  if (/^\d{8}$/.test(valor)) return { etiqueta: 'DNI', valor };
  return { etiqueta: 'Cuenta', valor: valor || '—' };
};

const ESTADOS = {
  activo: { texto: 'Cuenta activa', tono: 'ok' },
  'pendiente revisión': { texto: 'Pendiente de revisión', tono: 'aviso' },
  pendiente: { texto: 'Pendiente de aprobación', tono: 'aviso' },
  'documentos observados': { texto: 'Documentos observados', tono: 'aviso' },
  inactivo: { texto: 'Cuenta desactivada', tono: 'mal' },
  rechazado: { texto: 'Cuenta rechazada', tono: 'mal' },
};

/** El estado de la cuenta en palabras y con su tono; uno desconocido se dice tal cual. */
export const estadoDe = (usuario) => {
  const estado = texto(usuario?.estado) || 'Activo';
  return ESTADOS[estado.toLowerCase()] || { texto: estado, tono: 'neutro' };
};

const LETRA = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;

/**
 * Qué tal es una contraseña nueva, dicho sin tecnicismos.
 *
 * El servidor solo exige 4 caracteres —muchas cuentas de conductor llevan una
 * provisional corta y se cambia desde el teléfono—, así que esto no bloquea:
 * orienta. Lo obligatorio es lo único que impide guardar.
 */
export const fortalezaDe = (contrasena) => {
  const valor = String(contrasena ?? '');
  const largo = valor.length;
  const letrasYNumeros = LETRA.test(valor) && /\d/.test(valor);
  const variada = /[^A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]/.test(valor) || (/[a-z]/.test(valor) && /[A-Z]/.test(valor));
  const requisitos = [
    { id: 'minimo', texto: `Al menos ${MINIMO_CONTRASENA} caracteres`, cumple: largo >= MINIMO_CONTRASENA, obligatorio: true },
    { id: 'largo', texto: '8 caracteres o más', cumple: largo >= 8, obligatorio: false },
    { id: 'mezcla', texto: 'Letras y números', cumple: letrasYNumeros, obligatorio: false },
  ];
  if (largo === 0) return { nivel: null, etiqueta: '', puntos: 0, requisitos };
  if (largo < MINIMO_CONTRASENA) return { nivel: 'corta', etiqueta: 'Muy corta', puntos: 0, requisitos };
  const puntos = [largo >= 8, largo >= 12, letrasYNumeros, variada].filter(Boolean).length;
  const niveles = {
    1: ['debil', 'Débil'], 2: ['aceptable', 'Aceptable'], 3: ['buena', 'Buena'], 4: ['fuerte', 'Fuerte'],
  };
  const [nivel, etiqueta] = niveles[Math.max(1, puntos)];
  return { nivel, etiqueta, puntos: Math.max(1, puntos), requisitos };
};

/** Por qué no se puede guardar el cambio de contraseña todavía, o `null`. */
export const problemaDelCambio = ({ actual, nueva, confirmacion }) => {
  if (!actual) return 'Escribe tu contraseña actual.';
  if (String(nueva ?? '').length < MINIMO_CONTRASENA) {
    return `La nueva necesita al menos ${MINIMO_CONTRASENA} caracteres.`;
  }
  if (nueva === actual) return 'La nueva tiene que ser distinta de la actual.';
  if (nueva !== confirmacion) return 'Las dos contraseñas nuevas no coinciden.';
  return null;
};

/** «1990-05-12» → «12/05/1990»; lo que no sea una fecha ISO se deja como está. */
export const fechaLegible = (valor) => {
  const t = texto(valor);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : t;
};

/**
 * Un dato del perfil de conductor para enseñar, o `null` si no lo hay.
 *
 * Nunca uno inventado: la pantalla anterior enseñaba «15 pax» de capacidad a
 * quien no la tenía, y en la flota hay unidades de 4.
 */
export const valorDelPerfil = (perfil, campo) => {
  const valor = perfil?.[campo.clave];
  if (valor === null || valor === undefined || texto(valor) === '') return null;
  const legible = campo.fecha ? fechaLegible(valor) : texto(valor);
  return campo.sufijo ? `${legible} ${campo.sufijo}` : legible;
};

/** La solicitud de cambio que espera a Administración para ese dato, o `null`. */
export const solicitudPendiente = (perfil, clave) => {
  const solicitud = perfil?.solicitudes_cambio?.[clave];
  return solicitud && solicitud.status === 'pendiente' ? solicitud : null;
};

export const vehiculo2Habilitado = (perfil) => (
  perfil?.vehiculo2_habilitado === true || perfil?.vehiculo2_habilitado === 'true'
);

export const CAMPOS_PERSONALES = [
  { clave: 'fechaNacimiento', etiqueta: 'Fecha de nacimiento', fecha: true },
  { clave: 'direccion', etiqueta: 'Dirección' },
  { clave: 'telefonoDirecto', etiqueta: 'Teléfono' },
  { clave: 'telefonoEmergencia', etiqueta: 'Teléfono de emergencia' },
];

const camposDeVehiculo = (n = '') => [
  { clave: `vehiculoMarca${n}`, etiqueta: 'Marca' },
  { clave: `vehiculoModelo${n}`, etiqueta: 'Modelo' },
  { clave: `vehiculoAnio${n}`, etiqueta: 'Año' },
  { clave: `vehiculoColor${n}`, etiqueta: 'Color' },
  { clave: `placa${n}`, etiqueta: 'Placa' },
  { clave: `capacidadVehiculo${n}`, etiqueta: 'Capacidad', sufijo: 'pasajeros' },
];

export const CAMPOS_VEHICULO = camposDeVehiculo();
export const CAMPOS_VEHICULO_2 = camposDeVehiculo('2');

/** El mensaje de un error del API, sin volcar estructuras de validación en pantalla. */
export const mensajeDeError = (error, porDefecto) => {
  const detalle = error?.payload?.detail;
  if (Array.isArray(detalle)) return detalle.map((d) => d?.msg).filter(Boolean).join(', ') || porDefecto;
  return error?.message || porDefecto;
};
