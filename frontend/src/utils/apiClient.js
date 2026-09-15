/**
 * Cliente HTTP único de la aplicación.
 *
 * Existe por dos motivos:
 * 1. Centralizar el tratamiento de las respuestas 401, que hasta ahora ninguna
 *    de las 42 llamadas manejaba: una sesión caducada se veía como un error
 *    genérico o como nada.
 * 2. Dejar un solo punto donde se define el origen de la API, requisito previo
 *    para cualquier separación futura de frontend y backend.
 *
 * Las peticiones son del mismo origen, así que la cookie `HttpOnly` de sesión
 * viaja sola con el `credentials: 'same-origin'` por defecto de fetch.
 */

let sessionExpiredHandler = null;

/** Registra qué hacer cuando el servidor declara la sesión inválida. */
export const setSessionExpiredHandler = (handler) => {
  sessionExpiredHandler = typeof handler === 'function' ? handler : null;
};

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }

  /** La sesión ya no sirve: hay que volver al login. */
  get isSessionExpired() {
    return this.status === 401;
  }

  /**
   * Autenticado pero sin permiso. NO implica cerrar sesión: puede ser
   * simplemente un rol sin acceso a ese recurso, y expulsar al usuario por eso
   * sería peor que mostrarle el motivo.
   */
  get isForbidden() {
    return this.status === 403;
  }
}

const readBody = async (response) => {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const errorMessageFrom = (body, status) => {
  if (body && typeof body === 'object' && typeof body.detail === 'string') return body.detail;
  if (body && typeof body === 'object' && typeof body.message === 'string') return body.message;
  if (typeof body === 'string' && body.trim()) return body.trim();
  return `Error de servidor (${status}).`;
};

/**
 * Petición cruda. Devuelve la `Response` sin consumir cuando todo va bien, para
 * los casos que necesitan un blob (por ejemplo la exportación de flota).
 * Lanza `ApiError` cuando no va bien.
 */
export const apiRequest = async (path, options = {}) => {
  const { json, headers, ...rest } = options;
  const init = { cache: 'no-store', ...rest, headers: { ...(headers || {}) } };

  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, init);
  if (response.ok) return response;

  const body = await readBody(response);
  const error = new ApiError(errorMessageFrom(body, response.status), response.status, body);
  if (error.isSessionExpired && sessionExpiredHandler) {
    sessionExpiredHandler(error);
  }
  throw error;
};

/** Petición que devuelve JSON ya parseado (o `null` si no hubo cuerpo). */
export const apiFetch = async (path, options = {}) => {
  const response = await apiRequest(path, options);
  return readBody(response);
};

/** Identidad resuelta en servidor. Preferirla siempre al estado local. */
export const fetchCurrentUser = () => apiFetch('/api/auth/me');

/**
 * Cierra sesión en servidor. Nunca lanza: el frontend debe poder limpiar su
 * estado local aunque el backend no conteste, o el usuario queda atrapado.
 */
export const logoutSession = async () => {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    return true;
  } catch {
    return false;
  }
};
