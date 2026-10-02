import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarCog, RefreshCw, Search, Truck } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { invalidateBoardCache, useBoardData } from './data/useBoardData.js';
import { capacityDistribution } from './model/analytics.js';
import { fleetKey } from './model/serviceModel.js';
import {
  diasDesde, estadoDe, etiquetaDeFecha, indexarDisponibilidad, reglaEfectiva, textoDeRegla,
} from './model/disponibilidad.js';
import DisponibilidadUnidad from './components/DisponibilidadUnidad.jsx';
import './programador.css';

// Cuántos días se pueden elegir para ver quién trabaja: los de la ventana programable.
const DIAS_PARA_VER = 14;
const TONO_DE_ESTADO = { descansa: 'danger', solo: 'warn' };

/**
 * Flota vista por el Programador: capacidad, lo que mueve cada unidad y su
 * disponibilidad.
 *
 * La disponibilidad —qué días descansa cada conductor y en qué turnos trabaja—
 * es lo único que aquí se cambia, y solo el Programador (decisión del usuario,
 * 2026-10-02): a quien no está disponible no le programan el motor, la IA ni
 * nadie a mano. Ver `model/disponibilidad.js` y `DisponibilidadUnidad`.
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
 * la «KV-026» de la base es la «V026» de la intranet. Lo hacen `fleetKey` aquí
 * y `_clave_de_vehiculo` en el backend, y tienen que coincidir: con una copia
 * propia de la regla, esta pantalla dejaba las KV sin viajes. Las unidades de
 * la intranet que siguen sin estar dadas de alta se dicen en pantalla en vez
 * de dejar la tabla llena de ceros.
 */

const pasajeros = (n) => `${n} ${Number(n) === 1 ? 'pasajero' : 'pasajeros'}`;

const FlotaProgramador = () => {
  const { fleet, isLoading, error, refresh } = useBoardData();
  const [medidos, setMedidos] = useState({});
  const [query, setQuery] = useState('');
  // Cuándo descansa cada unidad y en qué turnos trabaja (la configura el Programador).
  const [disponibilidad, setDisponibilidad] = useState(null);
  const [errorDisponibilidad, setErrorDisponibilidad] = useState(null);
  const [diaVista, setDiaVista] = useState('');
  const [editando, setEditando] = useState(null);
  // Subirla vuelve a leer la disponibilidad (tras guardar, o con «Actualizar»).
  const [lectura, setLectura] = useState(0);

  useEffect(() => {
    let vivo = true;
    apiFetch('/api/programador/disponibilidad')
      .then((respuesta) => {
        if (!vivo) return;
        setDisponibilidad(respuesta);
        setErrorDisponibilidad(null);
      })
      .catch((fallo) => {
        if (vivo) setErrorDisponibilidad(fallo?.message || 'No se pudo leer la disponibilidad.');
      });
    return () => { vivo = false; };
  }, [lectura]);

  const leerDisponibilidad = useCallback(() => setLectura((n) => n + 1), []);

  const diasParaVer = useMemo(
    () => (disponibilidad?.hoy ? diasDesde(disponibilidad.hoy, DIAS_PARA_VER) : []),
    [disponibilidad]);
  // Mañana, si no se elige otro: es el día que se programa.
  const dia = diaVista || diasParaVer[1] || diasParaVer[0] || '';
  const indice = useMemo(() => indexarDisponibilidad(disponibilidad), [disponibilidad]);
  const turnosDe = useCallback(
    (unidad) => (dia ? reglaEfectiva(indice[fleetKey(unidad)], dia).turnos : null),
    [dia, indice]);

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
      .map((u) => ({ ...u, uso: medidos[fleetKey(u.unidad_id)] || null }))
      .sort((a, b) => (b.uso?.viajes ?? -1) - (a.uso?.viajes ?? -1)),
    [fleet, medidos],
  );

  const distribucion = useMemo(() => capacityDistribution(fleet), [fleet]);

  // El padrón manda: escribir «K» son las unidades que empiezan por K, no
  // todos los conductores con una k en el nombre. Si lo escrito no es el
  // principio de ningún padrón, se busca por conductor como siempre.
  const visibles = useMemo(() => {
    const buscado = query.trim().toLowerCase();
    if (!buscado) return unidades;
    const padron = fleetKey(query);
    const porPadron = unidades.filter((u) => fleetKey(u.unidad_id).startsWith(padron));
    if (porPadron.length > 0) return porPadron;
    return unidades.filter((u) => [u.unidad_id, u.chofer]
      .some((campo) => String(campo ?? '').toLowerCase().includes(buscado)));
  }, [unidades, query]);

  const totales = useMemo(() => {
    const enFlota = new Set(Object.values(fleet).map((u) => fleetKey(u.unidad_id)));
    return {
      asientos: Object.values(fleet).reduce((n, u) => n + (u.capacidad ?? 0), 0),
      conHistorico: unidades.filter((u) => u.uso).length,
      sinHistorico: unidades.filter((u) => !u.uso).length,
      fueraDeFlota: Object.keys(medidos).filter((c) => !enFlota.has(c)).length,
      descansan: unidades.filter((u) => estadoDe(turnosDe(u.unidad_id)) === 'descansa').length,
      limitadas: unidades.filter((u) => estadoDe(turnosDe(u.unidad_id)) === 'solo').length,
    };
  }, [fleet, unidades, medidos, turnosDe]);

  const guardada = useCallback(() => {
    leerDisponibilidad();
    // Si tocó un día programado, el plan cambió: que la mesa lo relea.
    invalidateBoardCache();
  }, [leerDisponibilidad]);

  return (
    <div className="pw-root">
      <header className="pw-header">
        <div className="pw-header-titles">
          <h1 className="pw-title">Flota</h1>
          <span className="pw-meta"><Truck size={15} aria-hidden="true" />{unidades.length} unidades</span>
        </div>
        <div className="pw-actions">
          <button type="button" className="pw-btn"
            onClick={() => { refresh(); leerMedidos(); leerDisponibilidad(); }} disabled={isLoading}>
            <RefreshCw size={16} aria-hidden="true" />
            {isLoading ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      <p className="pw-notice">
        <Truck size={16} aria-hidden="true" />
        <span>
          Aquí se ve la capacidad de cada unidad y lo que mueve de verdad según el
          histórico, y se apunta <strong>cuándo descansa cada conductor y en qué turnos
          trabaja</strong>: a quien no está disponible no se le programa. Dar de alta,
          editar o retirar unidades corresponde a Administración.
        </span>
      </p>

      {errorDisponibilidad && (
        <p className="pw-notice" data-tone="warn" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{errorDisponibilidad}</span>
        </p>
      )}

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
            {diasParaVer.length > 0 && (
              <>
                <label className="pw-inline-field" htmlFor="pw-fleet-dia">
                  <CalendarCog size={13} aria-hidden="true" /> Disponibilidad del
                </label>
                <select id="pw-fleet-dia" className="pw-select pw-select-dia" value={dia}
                  onChange={(e) => setDiaVista(e.target.value)}>
                  {diasParaVer.map((d, k) => (
                    <option key={d} value={d}>
                      {k === 0 ? 'Hoy' : k === 1 ? 'Mañana' : etiquetaDeFecha(d)}
                      {k < 2 ? ` · ${etiquetaDeFecha(d)}` : ''}
                    </option>
                  ))}
                </select>
              </>
            )}
            <span className="pw-panel-count">{visibles.length} de {unidades.length}</span>
          </span>
        </div>
        {dia && (totales.descansan > 0 || totales.limitadas > 0) && (
          <p className="pw-footnote pw-disp-resumen">
            <CalendarCog size={14} aria-hidden="true" />
            <span>
              El {etiquetaDeFecha(dia)}: {totales.descansan} {totales.descansan === 1 ? 'descansa' : 'descansan'}
              {' '}y {totales.limitadas} solo {totales.limitadas === 1 ? 'trabaja' : 'trabajan'} algunos turnos.
            </span>
          </p>
        )}

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
                    <th scope="col">Disponibilidad</th>
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
                      <td>
                        <span className="pw-disp-celda">
                          {disponibilidad && (
                            <span className="pw-state" data-tone={TONO_DE_ESTADO[estadoDe(turnosDe(u.unidad_id))]}>
                              {textoDeRegla(turnosDe(u.unidad_id))}
                            </span>
                          )}
                          {disponibilidad && (
                            <button type="button" className="pw-btn pw-btn-sm"
                              onClick={() => setEditando(u)}
                              aria-label={`${disponibilidad.puede_editar ? 'Configurar' : 'Ver'} la disponibilidad de ${u.unidad_id}`}>
                              <CalendarCog size={14} aria-hidden="true" />
                              {disponibilidad.puede_editar ? 'Configurar' : 'Ver'}
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {editando && (
        <DisponibilidadUnidad
          unidad={editando.unidad_id}
          chofer={editando.chofer || ''}
          fechaFoco={dia}
          onCerrar={() => setEditando(null)}
          onGuardado={guardada}
        />
      )}
    </div>
  );
};

export default FlotaProgramador;
