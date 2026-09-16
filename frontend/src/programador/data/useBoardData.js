import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../utils/apiClient';
import { buildServices, indexFleet } from '../model/serviceModel.js';

/**
 * Carga compartida del tablero para todas las secciones del Programador.
 *
 * `GET /api/routes` devuelve ~493 KB. Con cuatro secciones que necesitan los
 * mismos datos, refrescar en cada cambio de pestaña multiplicaría el egress sin
 * aportar nada: el tablero no cambia entre dos clics.
 *
 * Por eso la respuesta vive en un caché de módulo con TTL. La primera sección
 * que se abre paga la descarga; las demás la reutilizan. `refresh()` fuerza una
 * relectura cuando el usuario la pide explícitamente.
 *
 * El TTL acompaña al del backend (45 s) para no sostener en pantalla algo que
 * el servidor ya considera viejo.
 */

const TTL_MS = 45_000;

let cache = null; // { routes, fleet, loadedAt }
let inFlight = null;

const isFresh = () => cache && Date.now() - cache.loadedAt < TTL_MS;

const fetchBoard = async () => {
  // Sin `AbortSignal` a propósito. La petición es compartida: si la cancelara
  // el componente que la inició, desmontarlo —cambiar de sección mientras
  // carga— dejaría colgados a los demás consumidores esperando una promesa
  // muerta. Quien se va simplemente ignora el resultado.
  const [routes, fleet] = await Promise.all([
    apiFetch('/api/routes'),
    apiFetch('/api/flota').catch(() => null),
  ]);
  return {
    routes: Array.isArray(routes) ? routes : [],
    fleet: indexFleet(fleet),
    loadedAt: Date.now(),
  };
};

/**
 * Una sola petición en vuelo aunque dos secciones monten a la vez: sin esto,
 * abrir la mesa y el análisis en rápida sucesión dispararía dos descargas.
 */
const load = async ({ force = false } = {}) => {
  if (!force && isFresh()) return cache;
  if (!force && inFlight) return inFlight;

  inFlight = fetchBoard()
    .then((data) => {
      cache = data;
      return data;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};

/** Solo para pruebas y para el cierre de sesión: deja el caché sin contenido. */
export const resetBoardCache = () => {
  cache = null;
  inFlight = null;
};

export const useBoardData = () => {
  const [state, setState] = useState(() =>
    isFresh()
      ? { routes: cache.routes, fleet: cache.fleet, loadedAt: cache.loadedAt, isLoading: false, error: null }
      : { routes: [], fleet: {}, loadedAt: null, isLoading: true, error: null },
  );

  /** `alive` evita escribir estado sobre un componente ya desmontado. */
  const run = useCallback(async ({ force, alive } = {}) => {
    try {
      const data = await load({ force });
      if (alive && !alive.current) return;
      setState({ ...data, isLoading: false, error: null });
    } catch (err) {
      if (alive && !alive.current) return;
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err?.message || 'No se pudo cargar la programación.',
      }));
    }
  }, []);

  useEffect(() => {
    if (isFresh()) return undefined;
    const alive = { current: true };
    // `run` escribe estado solo después del `await`, así que el efecto no muta
    // nada de forma síncrona y la regla de hooks no aplica.
    run({ alive });
    return () => {
      alive.current = false;
    };
  }, [run]);

  const refresh = useCallback(() => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    return run({ force: true });
  }, [run]);

  const services = useMemo(
    () => buildServices(state.routes, state.fleet),
    [state.routes, state.fleet],
  );

  return { ...state, services, refresh };
};
