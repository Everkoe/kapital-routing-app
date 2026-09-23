import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Search, Truck } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useBoardData } from './data/useBoardData.js';
import { capacityDistribution } from './model/analytics.js';
import './programador.css';

/**
 * Flota vista por el Programador: solo lectura, centrada en capacidad.
 *
 * `FlotaView` ya existe para Administración, pero resuelve otro problema —
 * documentos, vencimientos, altas y bajas— y son 1.671 líneas de gestión que
 * el Programador no necesita ni debería poder ejecutar.
 *
 * Lo que este rol necesita saber es cuánto cabe en cada unidad y cuánto lleva.
 * Lo segundo salía antes del tablero de `/api/routes`, que devuelve una lista
 * vacía: cuatro columnas a cero para las 110 unidades. Ahora sale del
 * histórico, donde está medido: cuántos viajes hizo cada vehículo y cuánta
 * gente subió de verdad.
 *
 * Los códigos no coinciden entre las dos fuentes —la flota guarda «K-027» y la
 * intranet registra «K027»—, así que el cruce va por el código sin guiones, y
 * lo hace el backend. Aun así solo cruzan 41 de 79: la intranet mueve unidades
 * «V###» y «M###» que no están dadas de alta aquí, y eso se dice en pantalla
 * en vez de dejar la tabla llena de ceros.
 */

const clave = (valor) => String(valor ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const pasajeros = (n) => `${n} ${Number(n) === 1 ? 'pasajero' : 'pasajeros'}`;

const FlotaProgramador = () => {
  const { fleet, isLoading, error, refresh } = useBoardData();
  const [medidos, setMedidos] = useState({});
  const [query, setQuery] = useState('');

  const leerMedidos = useCallback(async (vivo = { current: true }) => {
    try {
      const respuesta = await apiFetch('/api/programador/vehiculos');
      if (vivo.current) setMedidos(respuesta);
    } catch {
      // La capacidad declarada sigue sirviendo sin esto: no se bloquea la vista.
      if (vivo.current) setMedidos({});
    }
  }, []);

  useEffect(() => {
    const vivo = { current: true };
    leerMedidos(vivo);
    return () => { vivo.current = false; };
  }, [leerMedidos]);

  const unidades = useMemo(
    () => Object.values(fleet)
      .map((u) => ({ ...u, uso: medidos[clave(u.unidad_id)] || null }))
      .sort((a, b) => (b.uso?.viajes ?? -1) - (a.uso?.viajes ?? -1)),
    [fleet, medidos],
  );

  const distribucion = useMemo(() => capacityDistribution(fleet), [fleet]);

  const visibles = useMemo(() => {
    const buscado = query.trim().toLowerCase();
    if (!buscado) return unidades;
    return unidades.filter((u) => [u.unidad_id, u.chofer]
      .some((campo) => String(campo ?? '').toLowerCase().includes(buscado)));
  }, [unidades, query]);

  const totales = useMemo(() => {
    const enFlota = new Set(Object.values(fleet).map((u) => clave(u.unidad_id)));
    return {
      asientos: Object.values(fleet).reduce((n, u) => n + (u.capacidad ?? 0), 0),
      conHistorico: unidades.filter((u) => u.uso).length,
      sinHistorico: unidades.filter((u) => !u.uso).length,
      fueraDeFlota: Object.keys(medidos).filter((c) => !enFlota.has(c)).length,
    };
  }, [fleet, unidades, medidos]);

  return (
    <div className="pw-root">
      <header className="pw-header">
        <div className="pw-header-titles">
          <h1 className="pw-title">Flota</h1>
          <span className="pw-meta"><Truck size={15} aria-hidden="true" />{unidades.length} unidades</span>
        </div>
        <div className="pw-actions">
          <button type="button" className="pw-btn"
            onClick={() => { refresh(); leerMedidos(); }} disabled={isLoading}>
            <RefreshCw size={16} aria-hidden="true" />
            {isLoading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      <p className="pw-notice">
        <Truck size={16} aria-hidden="true" />
        <span>
          Vista de solo lectura. Dar de alta, editar o retirar unidades corresponde a
          Administración; aquí el Programador consulta la capacidad de la que dispone
          y lo que cada unidad mueve de verdad según el histórico.
        </span>
      </p>

      {error && (
        <p className="pw-notice" data-tone="danger" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          {error}
        </p>
      )}

      {totales.fueraDeFlota > 0 && (
        <p className="pw-notice" data-tone="warn">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            El histórico registra <strong>{totales.fueraDeFlota}</strong> vehículos que
            no están dados de alta en la flota —los códigos «V» y «M»—. Hacen servicios
            reales, así que su capacidad no está contada en los asientos de abajo.
          </span>
        </p>
      )}

      <section className="pw-panel" aria-labelledby="pw-capdist-title">
        <div className="pw-panel-head">
          <h2 className="pw-panel-title" id="pw-capdist-title">Reparto por capacidad</h2>
          <span className="pw-panel-count">{totales.asientos} asientos declarados</span>
        </div>
        <div className="pw-panel-inner">
          <div className="pw-metrics">
            {distribucion.map(({ capacidad, unidades: cuantas }) => (
              <div className="pw-metric" key={String(capacidad)}>
                <strong>{cuantas}</strong>
                <span>{capacidad === null ? 'Sin capacidad declarada' : `Unidades de ${capacidad}`}</span>
                {capacidad !== null && <small>{capacidad * cuantas} asientos</small>}
              </div>
            ))}
          </div>
          {totales.sinHistorico > 0 && (
            <p className="pw-footnote">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>
                {totales.sinHistorico} unidad(es) no aparecen en el histórico cargado:
                o no han hecho servicios, o la intranet las registra con otro código.
              </span>
            </p>
          )}
        </div>
      </section>

      <section className="pw-panel" aria-labelledby="pw-fleet-title">
        <div className="pw-panel-head">
          <h2 className="pw-panel-title" id="pw-fleet-title">Unidades</h2>
          <span className="pw-panel-tools">
            <label className="pw-inline-field" htmlFor="pw-fleet-q">
              <Search size={13} aria-hidden="true" /> Buscar
            </label>
            <input id="pw-fleet-q" type="search" className="pw-input pw-input-sm"
              placeholder="Unidad o conductor…" value={query}
              onChange={(e) => setQuery(e.target.value)} />
            <span className="pw-panel-count">{visibles.length} de {unidades.length}</span>
          </span>
        </div>

        <div className="pw-panel-inner">
          {visibles.length === 0 ? (
            <div className="pw-placeholder">
              <Truck size={30} aria-hidden="true" />
              <h3>Ninguna unidad coincide</h3>
              <p>Prueba con otro padrón o nombre de conductor.</p>
            </div>
          ) : (
            <div className="pw-table-scroll">
              <table className="pw-table">
                <thead>
                  <tr>
                    <th scope="col">Unidad</th>
                    <th scope="col">Conductor</th>
                    <th scope="col">Capacidad</th>
                    <th scope="col">Viajes</th>
                    <th scope="col">Lleva</th>
                    <th scope="col">Máximo</th>
                    <th scope="col">Días</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((u) => (
                    <tr key={u.unidad_id}>
                      <td className="pw-mono">{u.unidad_id}</td>
                      <td>{u.chofer || '—'}</td>
                      <td className="pw-mono">
                        {u.capacidad ?? <span className="pw-muted">No declarada</span>}
                      </td>
                      <td className="pw-mono">
                        {u.uso ? u.uso.viajes : <span className="pw-muted">Sin histórico</span>}
                      </td>
                      <td className="pw-mono">
                        {u.uso ? pasajeros(u.uso.ocupacion_p50) : '—'}
                      </td>
                      <td className="pw-mono">
                        {u.uso ? u.uso.ocupacion_max : '—'}
                        {' '}
                        {u.uso && u.capacidad && u.uso.ocupacion_max > u.capacidad && (
                          <span className="pw-state" data-tone="warn"
                            title="Ha llevado más gente que la capacidad declarada.">
                            <AlertTriangle size={12} aria-hidden="true" />
                            sobre capacidad
                          </span>
                        )}
                      </td>
                      <td className="pw-mono">{u.uso ? u.uso.dias : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default FlotaProgramador;
