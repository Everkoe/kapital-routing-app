/**
 * Lo que este navegador recuerda de una sesión: que la hay, y nada de quién.
 *
 * La sesión es una cookie `HttpOnly` que JavaScript no ve, y quién es la
 * persona lo dice `/api/auth/me` al abrir la aplicación. Antes de que conteste
 * solo hace falta saber si merece la pena esperarle —«Validando sesión...»— o
 * enseñar el login directamente, y para eso basta una marca.
 *
 * Hasta el 2026-09-30 se guardaba aquí el usuario entero (`kapital_user`), y el
 * de un conductor llevaba su `perfil_conductor`: documento, dirección,
 * teléfonos, nacimiento y solicitudes de cambio, en claro en el disco y al
 * alcance de cualquier script de la página. Nada lo pintaba: la aplicación
 * espera a `/api/auth/me` y al perfil antes de enseñar nada.
 */

/** Dónde se guarda la marca. */
export const CLAVE_MARCA = 'kapital_sesion';

/**
 * Dónde guardaban el usuario entero las versiones anteriores. Cuenta como
 * marca —si no, todo el que tenía sesión vería el login al desplegar— y se
 * borra en cuanto la sesión se valida o se cierra.
 */
export const CLAVE_USUARIO_ANTIGUA = 'kapital_user';

/** Lo único que se escribe. Igual para todos, a propósito. */
const MARCA = '1';

const almacenDelNavegador = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Con los datos del sitio bloqueados, solo tocar `localStorage` ya lanza.
    return null;
  }
};

const tieneTexto = (valor) => typeof valor === 'string' && valor.trim() !== '';

/**
 * Qué se guarda de `usuario`: la marca si trae una identidad con la que el
 * servidor pueda responder, y si no, nada. Nunca un dato suyo.
 */
export const marcaDeSesion = (usuario) => {
  if (!usuario || typeof usuario !== 'object' || Array.isArray(usuario)) return null;
  return tieneTexto(usuario.identifier) || tieneTexto(usuario.email) ? MARCA : null;
};

/** ¿Inició sesión alguien en este navegador? Solo lee. */
export const haySesionRecordada = (almacen = almacenDelNavegador()) => {
  try {
    return Boolean(almacen.getItem(CLAVE_MARCA) || almacen.getItem(CLAVE_USUARIO_ANTIGUA));
  } catch {
    return false;
  }
};

/**
 * Borra la marca y el usuario antiguo. Cada uno por su lado: que falle uno no
 * puede dejar el otro escrito.
 */
export const olvidarSesion = (almacen = almacenDelNavegador()) => {
  for (const clave of [CLAVE_MARCA, CLAVE_USUARIO_ANTIGUA]) {
    try {
      almacen.removeItem(clave);
    } catch {
      // Sin almacenamiento no queda nada que borrar.
    }
  }
};

/**
 * Deja la marca de `usuario` y retira lo que guardaran versiones anteriores.
 * Devuelve si quedó así; si `usuario` no trae identidad, olvida la sesión.
 */
export const recordarSesion = (usuario, almacen = almacenDelNavegador()) => {
  const marca = marcaDeSesion(usuario);
  if (marca === null) {
    olvidarSesion(almacen);
    return false;
  }
  try {
    almacen.setItem(CLAVE_MARCA, marca);
    almacen.removeItem(CLAVE_USUARIO_ANTIGUA);
    return true;
  } catch {
    return false;
  }
};
