import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../utils/apiClient';
import { buildServices, indexFleet } from '../model/serviceModel.js';

/**
 * Carga compartida del tablero para todas las secciones del Programador.
 *
 * **De dónde salen los datos.** Ya no de `/api/routes`: ese endpoint devuelve
 * una lista vacía desde que la programación dejó de escribirse en `app_state`,
 * y el tablero llevaba tiempo enseñando ceros sin decir por qué. La fuente es
 * ahora el histórico que el Programador carga cada día, servido por
 * `/api/programador/programacion` con la misma forma que el contrato anterior
 * —`conductor`, `micro_zona`, `horario`, `agentes`— para que las tarjetas, los
 * filtros y la exportación sigan funcionando sin tocarlos.
 *
 * Un día completo son ~96 KB. Con varias secciones leyendo lo mismo, recargar
 * en cada cambio de pestaña multiplicaría el egress sin aportar nada: el día
 * cargado no cambia entre dos clics. Por eso la respuesta vive en un caché de
 * módulo con TTL, **indexado por fecha**, y `refresh()` fuerza la relectura
 * cuando el usuario la pide.
 */

const TTL_MS = 45_000;

const cache = new Map(); // fecha|'' -> { routes, fleet, fecha, dias, loadedAt }
const inFlight = new Map();

const isFresh = (dia) => {
  const hit = cache.get(dia);
  return hit && Date.now() - hit.loadedAt < TTL_MS;
};

const fetchBoard = async (dia) => {
  // Sin `AbortSignal` a propósito. La petición es compartida: si la cancelara
  // el componente que la inició, desmontarlo —cambiar de sección mientras
  // carga— dejaría colgados a los demás consumidores esperando una promesa
  // muerta. Quien se va simplemente ignora el resultado.
  const [programacion, fleet] = await Promise.all([
    apiFetch(`/api/programador/programacion${dia ? `?fecha=${dia}` : ''}`),
    apiFetch('/api/flota').catch(() => null),
  ]);
  return {
    routes: Array.isArray(programacion?.rutas) ? programacion.rutas : [],
    fecha: programacion?.fecha ?? null,
    comparadoCon: programacion?.comparado_con ?? null,
    dias: Array.isArray(programacion?.dias_disponibles)
      ? programacion.dias_disponibles : [],
    fleet: indexFleet(fleet),
    loadedAt: Date.now(),
  };
};

/**
 * Una sola petición en vuelo aunque dos secciones monten a la vez: sin esto,
 * abrir la mesa y el análisis en rápida sucesión dispararía dos descargas.
 */
const load = async ({ force = false, dia = '' } = {}) => {
  if (!force && isFresh(dia)) return cache.get(dia);
  if (!force && inFlight.has(dia)) return inFlight.get(dia);

  const peticion = fetchBoard(dia)
    .then((data) => {
      cache.set(dia, data);
      return data;
    })
    .finally(() => {
      inFlight.delete(dia);
    });

  inFlight.set(dia, peticion);
  return peticion;
};

/** Solo para pruebas y para el cierre de sesión: deja el caché sin contenido. */
export const resetBoardCache = () => {
  cache.clear();
  inFlight.clear();
};

const vacio = {
  routes: [], fleet: {}, fecha: null, comparadoCon: null, dias: [], loadedAt: null,
};

export const useBoardData = (dia = '') => {
  const [state, setState] = useState(() =>
    isFresh(dia)
      ? { ...cache.get(dia), isLoading: false, error: null }
      : { ...vacio, isLoading: true, error: null },
  );

  /** `alive` evita escribir estado sobre un componente ya desmontado. */
  const run = useCallback(async ({ force, alive } = {}) => {
    try {
      const data = await load({ force, dia });
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
  }, [dia]);

  useEffect(() => {
    if (isFresh(dia)) {
      setState({ ...cache.get(dia), isLoading: false, error: null });
      return undefined;
    }
    const alive = { current: true };
    // `run` escribe estado solo después del `await`, así que el efecto no muta
    // nada de forma síncrona y la regla de hooks no aplica.
    run({ alive });
    return () => {
      alive.current = false;
    };
  }, [run, dia]);

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
