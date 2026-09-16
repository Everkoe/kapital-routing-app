import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Info, RefreshCw, Users } from 'lucide-react';
import { useBoardData } from './data/useBoardData.js';
import { capacityAnalysis, dataQuality, zoneBreakdown } from './model/analytics.js';
import './programador.css';

/**
 * Análisis de la programación vigente.
 *
 * Sustituye a la vista de Reportes, que leía `/api/reportes` y siempre devolvía
 * `{"historial": []}`: la clave `__historial_rutas__` está vacía en la base, así
 * que un informe de evolución temporal no tenía de dónde salir. Cuando el
 * histórico exista, esta sección lo suma; hasta entonces muestra lo que sí hay.
 *
 * Su contenido principal no es decorativo. La base trae 2.645 registros de
 * pasajero para 580 personas, y eso hace que la flota parezca saturada sin
 * estarlo. Esta pantalla existe para que ese hecho sea visible y cuantificado.
 */

const pct = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);

const Metric = ({ value, label, note, tone }) => (
  <div className="pw-metric" data-tone={tone}>
    <strong>{value}</strong>
    <span>{label}</span>
    {note && <small>{note}</small>}
  </div>
);

const AnalisisView = () => {
  const { services, isLoading, error, refresh, loadedAt } = useBoardData();

  const quality = useMemo(() => dataQuality(services), [services]);
  const capacity = useMemo(() => capacityAnalysis(services), [services]);
  const zonas = useMemo(() => zoneBreakdown(services), [services]);

  const asientosOcultos = capacity.libresSiSeDeduplica - capacity.libresActuales;
  const maxRegistros = zonas[0]?.registros || 1;

  return (
    <div className="pw-root">
      <header className="pw-header">
        <div className="pw-header-titles">
          <h1 className="pw-title">Análisis de la programación</h1>
          {loadedAt && (
            <span className="pw-meta">
              Datos de las {new Date(loadedAt).toLocaleTimeString('es-PE')}
            </span>
          )}
        </div>
        <div className="pw-actions">
          <button type="button" className="pw-btn" onClick={refresh} disabled={isLoading}>
            <RefreshCw size={16} aria-hidden="true" />
            {isLoading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      {error && (
        <p className="pw-notice" data-tone="danger" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          {error}
        </p>
      )}

      {isLoading && services.length === 0 ? (
        <div className="pw-placeholder">
          <Users size={34} aria-hidden="true" />
          <h3>Calculando…</h3>
          <p>Leyendo la programación vigente.</p>
        </div>
      ) : (
        <>
          <section className="pw-panel" aria-labelledby="pw-quality-title">
            <div className="pw-panel-head">
              <h2 className="pw-panel-title" id="pw-quality-title">Registros contra personas</h2>
            </div>
            <div className="pw-panel-inner">
              {quality.registrosDuplicados > 0 && (
                <p className="pw-notice" data-tone="warn">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>
                    El tablero cuenta <strong>{quality.registros.toLocaleString('es-PE')}</strong> registros
                    de pasajero, pero corresponden a <strong>{quality.personas.toLocaleString('es-PE')}</strong>{' '}
                    personas distintas. La ocupación que ves está inflada, y con ella la sensación de
                    que no queda sitio. <strong>El padrón real es el de personas.</strong>
                  </span>
                </p>
              )}

              <div className="pw-metrics">
                <Metric value={quality.registros.toLocaleString('es-PE')} label="Registros de pasajero" />
                <Metric value={quality.personas.toLocaleString('es-PE')} label="Personas distintas" />
                <Metric
                  value={quality.registrosDuplicados.toLocaleString('es-PE')}
                  label="Registros repetidos"
                  note={`${pct(quality.registrosDuplicados, quality.registros)}% del total`}
                  tone={quality.registrosDuplicados > 0 ? 'warn' : 'ok'}
                />
                <Metric
                  value={`${quality.serviciosConRepetidos} / ${quality.serviciosTotales}`}
                  label="Servicios con repetidos"
                  tone={quality.serviciosConRepetidos > 0 ? 'warn' : 'ok'}
                />
                <Metric
                  value={quality.personasEnAmbosEstados}
                  label="Personas asignadas y pendientes a la vez"
                  note={quality.personasEnAmbosEstados > 0 ? 'Contradicción del origen' : null}
                  tone={quality.personasEnAmbosEstados > 0 ? 'danger' : 'ok'}
                />
                <Metric
                  value={quality.coordenadasDistintas}
                  label="Ubicaciones distintas"
                  note={`Para ${quality.registros.toLocaleString('es-PE')} registros`}
                  tone={quality.coordenadasDistintas < quality.personas ? 'warn' : 'ok'}
                />
                <Metric
                  value={quality.coordenadaDominante?.registros ?? 0}
                  label="Registros en una misma ubicación"
                  note={
                    quality.coordenadaDominante
                      ? `${pct(quality.coordenadaDominante.registros, quality.registros)}% en un solo punto`
                      : null
                  }
                  tone={
                    quality.coordenadaDominante &&
                    pct(quality.coordenadaDominante.registros, quality.registros) > 20
                      ? 'danger'
                      : 'ok'
                  }
                />
              </div>

              {quality.personasEnAmbosEstados > 0 && (
                <p className="pw-footnote">
                  <Info size={14} aria-hidden="true" />
                  <span>
                    Hay {quality.personasEnAmbosEstados} personas que figuran montadas en una unidad
                    y a la vez en la lista de pendientes. No es un estado válido: el Programador
                    las trataría dos veces.
                  </span>
                </p>
              )}

              <p className="pw-footnote">
                <Info size={14} aria-hidden="true" />
                <span>
                  <strong>Qué son estas repeticiones.</strong> No parecen errores del Excel de
                  origen: los registros repetidos son idénticos campo a campo, la misma persona
                  aparece en varias unidades a la vez y las rutas comparten un único horario. El
                  patrón es el de un tablero sobre el que se acumularon varias generaciones sin
                  limpiar, perdiendo por el camino la fecha y el turno. La concentración de
                  ubicaciones apunta en la misma dirección: direcciones que nunca llegaron a
                  geocodificarse.
                </span>
              </p>
            </div>
          </section>

          <section className="pw-panel" aria-labelledby="pw-capacity-title">
            <div className="pw-panel-head">
              <h2 className="pw-panel-title" id="pw-capacity-title">Capacidad real de la flota</h2>
            </div>
            <div className="pw-panel-inner">
              <div className="pw-metrics">
                <Metric value={capacity.unidades} label="Unidades con ruta" />
                <Metric value={capacity.capacidadTotal} label="Asientos declarados" />
                <Metric
                  value={capacity.llenas}
                  label="Unidades llenas"
                  note={`${pct(capacity.llenas, capacity.unidades)}% de la flota en uso`}
                  tone={capacity.llenas > 0 ? 'warn' : 'ok'}
                />
                <Metric value={capacity.libresActuales} label="Espacios libres según el tablero" />
                <Metric
                  value={capacity.libresSiSeDeduplica}
                  label="Espacios libres sin registros repetidos"
                  tone="ok"
                />
                <Metric
                  value={asientosOcultos}
                  label="Asientos que esconden los duplicados"
                  tone={asientosOcultos > 0 ? 'danger' : 'ok'}
                />
              </div>

              {asientosOcultos > 0 && (
                <p className="pw-notice" data-tone="warn">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>
                    La flota parece saturada sin estarlo: el tablero ofrece{' '}
                    <strong>{capacity.libresActuales}</strong> asientos libres cuando, contando
                    personas en vez de registros, hay <strong>{capacity.libresSiSeDeduplica}</strong>.
                    Esta pantalla no deduplica nada — qué hacer con un pasajero repetido es una
                    decisión de negocio, y aquí solo se mide cuánto está en juego.
                  </span>
                </p>
              )}

              {capacity.sinCapacidadDeclarada > 0 && (
                <p className="pw-footnote">
                  <Info size={14} aria-hidden="true" />
                  <span>
                    {capacity.sinCapacidadDeclarada} unidad(es) con ruta no declaran capacidad en la
                    flota y quedan fuera de estos totales.
                  </span>
                </p>
              )}
            </div>
          </section>

          <section className="pw-panel" aria-labelledby="pw-zones-title">
            <div className="pw-panel-head">
              <h2 className="pw-panel-title" id="pw-zones-title">Distribución por zona</h2>
              <span className="pw-panel-count">Las {zonas.length} de mayor volumen</span>
            </div>
            <div className="pw-panel-inner">
              <div className="pw-table-scroll">
                <table className="pw-table">
                  <thead>
                    <tr>
                      <th scope="col">Zona</th>
                      <th scope="col">Servicios</th>
                      <th scope="col">Registros</th>
                      <th scope="col">Personas</th>
                      <th scope="col">Sin unidad</th>
                      <th scope="col">Volumen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zonas.map((zona) => (
                      <tr key={zona.zona}>
                        <td>{zona.zona}</td>
                        <td className="pw-mono">{zona.servicios}</td>
                        <td className="pw-mono">{zona.registros}</td>
                        <td className="pw-mono">{zona.personas}</td>
                        <td className="pw-mono">{zona.pendientes}</td>
                        <td>
                          <div className="pw-bar">
                            <div
                              className="pw-bar-fill"
                              style={{ width: `${(zona.registros / maxRegistros) * 100}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <p className="pw-notice">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>
              El histórico de programaciones aparecerá aquí cuando exista: hoy la clave de
              historial está vacía en la base, así que un informe de evolución no tendría de dónde
              salir. Lo que ves es el estado de la programación vigente.
            </span>
          </p>
        </>
      )}
    </div>
  );
};

export default AnalisisView;
