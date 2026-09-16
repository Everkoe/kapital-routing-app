import { useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Search, Truck } from 'lucide-react';
import { useBoardData } from './data/useBoardData.js';
import { capacityDistribution, fleetWithLoad } from './model/analytics.js';
import './programador.css';

/**
 * Flota vista por el Programador: solo lectura, centrada en capacidad.
 *
 * `FlotaView` ya existe para Administración, pero resuelve otro problema —
 * documentos, vencimientos, altas y bajas— y son 1.671 líneas de gestión que
 * el Programador no necesita ni debería poder ejecutar.
 *
 * Lo que este rol necesita saber es cuánto cabe en cada unidad y cuánto lleva,
 * porque es el dato del que dependen sus decisiones de carga. Y era justo el
 * que el tablero anterior falseaba: escribía 15 para todas cuando la capacidad
 * dominante real es 4.
 */

const FlotaProgramador = () => {
  const { services, fleet, isLoading, error, refresh } = useBoardData();
  const [query, setQuery] = useState('');

  const unidades = useMemo(() => fleetWithLoad(fleet, services), [fleet, services]);
  const distribucion = useMemo(() => capacityDistribution(fleet), [fleet]);

  const visibles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return unidades;
    return unidades.filter((u) =>
      [u.unidad_id, u.chofer].some((field) => String(field ?? '').toLowerCase().includes(needle)),
    );
  }, [unidades, query]);

  const totales = useMemo(
    () =>
      unidades.reduce(
        (acc, u) => {
          acc.asientos += u.capacidad ?? 0;
          acc.registros += u.registros;
          acc.personas += u.personas;
          if (u.sinUsar) acc.sinUsar += 1;
          if (u.capacidad === null) acc.sinCapacidad += 1;
          return acc;
        },
        { asientos: 0, registros: 0, personas: 0, sinUsar: 0, sinCapacidad: 0 },
      ),
    [unidades],
  );

  return (
    <div className="pw-root">
      <header className="pw-header">
        <div className="pw-header-titles">
          <h1 className="pw-title">Flota</h1>
          <span className="pw-meta"><Truck size={15} aria-hidden="true" />{unidades.length} unidades</span>
        </div>
        <div className="pw-actions">
          <button type="button" className="pw-btn" onClick={refresh} disabled={isLoading}>
            <RefreshCw size={16} aria-hidden="true" />
            {isLoading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      <p className="pw-notice">
        <Truck size={16} aria-hidden="true" />
        <span>
          Vista de solo lectura. Dar de alta, editar o retirar unidades corresponde a
          Administración; aquí el Programador consulta la capacidad de la que dispone.
        </span>
      </p>

      {error && (
        <p className="pw-notice" data-tone="danger" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          {error}
        </p>
      )}

      <section className="pw-panel" aria-labelledby="pw-capdist-title">
        <div className="pw-panel-head">
          <h2 className="pw-panel-title" id="pw-capdist-title">Reparto por capacidad</h2>
          <span className="pw-panel-count">{totales.asientos} asientos declarados</span>
        </div>
        <div className="pw-panel-inner">
          <div className="pw-metrics">
            {distribucion.map(({ capacidad, unidades: count }) => (
              <div className="pw-metric" key={String(capacidad)}>
                <strong>{count}</strong>
                <span>{capacidad === null ? 'Sin capacidad declarada' : `Unidades de ${capacidad}`}</span>
                {capacidad !== null && <small>{capacidad * count} asientos</small>}
              </div>
            ))}
          </div>
          {totales.sinUsar > 0 && (
            <p className="pw-footnote">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{totales.sinUsar} unidad(es) sin ninguna ruta en la programación vigente.</span>
            </p>
          )}
        </div>
      </section>

      <section className="pw-panel" aria-labelledby="pw-fleet-title">
        <div className="pw-panel-head">
          <h2 className="pw-panel-title" id="pw-fleet-title">Unidades</h2>
          <span className="pw-panel-tools">
            <label className="pw-inline-field" htmlFor="pw-fleet-q"><Search size={13} aria-hidden="true" /> Buscar</label>
            <input
              id="pw-fleet-q"
              type="search"
              className="pw-input pw-input-sm"
              placeholder="Unidad o conductor…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
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
                    <th scope="col">Registros</th>
                    <th scope="col">Personas</th>
                    <th scope="col">Libres</th>
                    <th scope="col">Servicios</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((u) => (
                    <tr key={u.unidad_id} data-duplicado={u.registros > u.personas}>
                      <td className="pw-mono">{u.unidad_id}</td>
                      <td>{u.chofer || '—'}</td>
                      <td className="pw-mono">
                        {u.capacidad ?? <span className="pw-muted">No declarada</span>}
                      </td>
                      <td className="pw-mono">{u.registros}</td>
                      <td className="pw-mono">
                        {u.personas}
                        {u.registros > u.personas && (
                          <span className="pw-state" data-tone="warn" title="Esta unidad transporta registros repetidos.">
                            <AlertTriangle size={12} aria-hidden="true" />
                            {u.registros - u.personas} de más
                          </span>
                        )}
                      </td>
                      <td className="pw-mono">{u.libres === null ? '—' : u.libres}</td>
                      <td className="pw-mono">
                        {u.sinUsar ? <span className="pw-muted">Sin ruta</span> : u.servicios}
                      </td>
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
