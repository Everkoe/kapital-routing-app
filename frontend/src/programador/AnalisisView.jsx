import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, BarChart3, CircleSlash, Clock, MapPin, RefreshCw, Timer, Truck, Users,
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { fecha } from './fechas';
import './programador.css';

/**
 * Análisis del histórico de la operación.
 *
 * Antes derivaba del tablero de `/api/routes`, que devuelve una lista vacía
 * desde que la programación dejó de escribirse en `app_state`: la pantalla
 * calculaba métricas sobre cero filas y no enseñaba nada. Ahora lee el
 * histórico que el Programador carga cada día, que es un dato real.
 *
 * El cálculo se hace en Postgres (`resumen_analisis()`) y no aquí: son 21.789
 * filas, y bajarlas para contarlas costaría medio mega de egress por visita.
 * Lo que llega son ~4 KB.
 *
 * El número que manda es la efectividad. «A BORDO» es la única incidencia que
 * significa que el servicio ocurrió; todo lo demás es un asiento reservado que
 * viajó vacío. Hoy son casi tres de cada diez, y eso cambia por completo cuánta
 * flota hace falta de verdad.
 */

const porcentaje = (parte, total) => (total > 0 ? Math.round((parte / total) * 100) : 0);

const numero = (valor) => (valor ?? 0).toLocaleString('es-PE');

const Metrica = ({ Icono, valor, etiqueta, nota, tono }) => (
  <div className="pw-metric" data-tone={tono}>
    {Icono && <span className="an-metric-icon"><Icono size={16} aria-hidden="true" /></span>}
    <strong>{valor}</strong>
    <span>{etiqueta}</span>
    {nota && <small>{nota}</small>}
  </div>
);

/** Una barra proporcional al mayor de la lista, para comparar de un vistazo. */
const Barra = ({ parte, total, maximo, titulo }) => (
  <span className="an-barra" title={titulo}>
    <span className="an-barra-fondo" style={{ width: `${porcentaje(total, maximo)}%` }}>
      <span className="an-barra-llena" style={{ width: `${porcentaje(parte, total)}%` }} />
    </span>
  </span>
);

const AnalisisView = ({ onIrACargar }) => {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  // `vivo` evita escribir estado sobre un componente ya desmontado, y el
  // primer `await` va antes que cualquier `setState`: llamarlo de forma
  // síncrona dentro de un efecto encadena renders de más.
  const leer = useCallback(async (vivo = { current: true }) => {
    try {
      const respuesta = await apiFetch('/api/programador/analisis');
      if (!vivo.current) return;
      setDatos(respuesta);
      setError(null);
    } catch (fallo) {
      if (vivo.current) setError(fallo?.message || 'No se pudo leer el análisis.');
    } finally {
      if (vivo.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    const vivo = { current: true };
    leer(vivo);
    return () => { vivo.current = false; };
  }, [leer]);

  const actualizar = () => { setCargando(true); leer(); };

  if (cargando && !datos) {
    return (
      <div className="pw-root">
        <div className="pw-placeholder">
          <BarChart3 size={34} aria-hidden="true" />
          <h3>Calculando…</h3>
          <p>Resumiendo el histórico cargado.</p>
        </div>
      </div>
    );
  }

  const vacio = !datos || datos.servicios === 0;
  const noViajaron = datos ? datos.servicios - datos.a_bordo : 0;
  const efectividad = datos ? porcentaje(datos.a_bordo, datos.servicios) : 0;
  const ubicados = datos?.ubicacion?.resuelta ?? 0;
  const maxDia = Math.max(1, ...(datos?.por_dia || []).map((d) => d.n));
  const maxCobertura = Math.max(1, ...(datos?.coberturas || []).map((c) => c.n));
  const maxMotivo = Math.max(1, ...(datos?.motivos || []).map((m) => m.n));

  return (
    <div className="pw-root">
      <header className="pw-header">
        <div className="pw-header-titles historico-titulos">
          <h1 className="pw-title">Análisis del histórico</h1>
          <p className="pw-meta">
            {vacio
              ? 'Todavía no hay histórico cargado.'
              : `${numero(datos.servicios)} servicios en ${datos.dias} días, `
                + `del ${fecha(datos.desde)} al ${fecha(datos.hasta)}.`}
          </p>
        </div>
        <div className="pw-actions">
          <button type="button" className="pw-btn" onClick={actualizar} disabled={cargando}>
            <RefreshCw size={16} aria-hidden="true" />
            {cargando ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      {error && (
        <p className="pw-notice" data-tone="danger" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          {error}
        </p>
      )}

      {vacio && !error && (
        <div className="pw-placeholder">
          <BarChart3 size={34} aria-hidden="true" />
          <h3>Sin histórico que analizar</h3>
          <p>
            Esta pantalla resume lo que ocurrió de verdad: cuántos servicios se
            ejecutaron, cuánto duran las rutas y por qué falla un asiento.
            Necesita el reporte de la intranet.
          </p>
          {onIrACargar && (
            <button type="button" className="pw-btn pw-btn-primary" onClick={onIrACargar}>
              Ir a «Cargar datos»
            </button>
          )}
        </div>
      )}

      {!vacio && (
        <>
          <section className="pw-metrics">
            <Metrica Icono={Users} valor={`${efectividad}%`} etiqueta="Servicios ejecutados"
              nota={`${numero(datos.a_bordo)} de ${numero(datos.servicios)} subieron al vehículo`}
              tono={efectividad < 80 ? 'warn' : 'ok'} />
            <Metrica Icono={CircleSlash} valor={numero(noViajaron)} etiqueta="Asientos que viajaron vacíos"
              nota={`${100 - efectividad}% de lo programado`}
              tono={noViajaron > 0 ? 'danger' : 'ok'} />
            <Metrica Icono={Truck} valor={datos.vehiculos} etiqueta="Vehículos distintos"
              nota={`${Math.round(datos.servicios / Math.max(1, datos.dias))} servicios al día`} />
            <Metrica Icono={MapPin} valor={`${porcentaje(ubicados, datos.pasajeros)}%`}
              etiqueta="Pasajeros ubicables"
              nota={`${numero(ubicados)} de ${numero(datos.pasajeros)} con domicilio fiable`}
              tono={porcentaje(ubicados, datos.pasajeros) < 80 ? 'warn' : 'ok'} />
          </section>

          <p className="pw-notice" data-tone="warn">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
              Casi <strong>{100 - efectividad} de cada 100</strong> asientos programados
              se reservan y no se usan. No es un error de los datos: es la operación
              real, y significa que la flota necesaria es menor que la que sugiere el
              número de pasajeros inscritos.
            </span>
          </p>

          <div className="pw-columns">
            <section className="pw-panel">
              <div className="pw-panel-head">
                <h2 className="pw-panel-title"><Timer size={16} /> Cuánto dura cada ruta</h2>
                <span className="pw-panel-count">{datos.celdas_duracion} medidas</span>
              </div>
              <div className="pw-panel-inner">
                <p className="historico-nota">
                  Minutos medidos, no estimados por un mapa: la mediana es lo esperable
                  y el p90 el margen que hay que reservar.
                </p>
                <ul className="an-lista">
                  {datos.duraciones.map((d) => (
                    <li key={`${d.cobertura}-${d.modalidad}-${d.turno}`}>
                      <span className="an-etiqueta">
                        {d.cobertura}
                        <small>{d.modalidad === 'RECOJO' ? 'recojo' : 'salida'} · {d.turno}</small>
                      </span>
                      <span className="an-duracion">
                        <strong>{Math.round(d.p50)}′</strong>
                        <small>p90 {Math.round(d.p90)}′ · {d.casos} casos</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="pw-panel">
              <div className="pw-panel-head">
                <h2 className="pw-panel-title"><CircleSlash size={16} /> Por qué no viajaron</h2>
                <span className="pw-panel-count">{numero(noViajaron)}</span>
              </div>
              <div className="pw-panel-inner">
                <ul className="an-lista">
                  {datos.motivos.map((m) => (
                    <li key={m.motivo}>
                      <span className="an-etiqueta">{m.motivo}</span>
                      <Barra parte={m.n} total={m.n} maximo={maxMotivo}
                        titulo={`${numero(m.n)} servicios`} />
                      <span className="an-cifra">{numero(m.n)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>

          <section className="pw-panel">
            <div className="pw-panel-head">
              <h2 className="pw-panel-title"><MapPin size={16} /> Zonas con más carga</h2>
              <span className="pw-panel-count">{datos.coberturas.length}</span>
            </div>
            <div className="pw-panel-inner">
              <p className="historico-nota">
                La parte llena de la barra es lo que se ejecutó; el resto se programó
                y no viajó.
              </p>
              <ul className="an-lista">
                {datos.coberturas.map((c) => (
                  <li key={c.cobertura}>
                    <span className="an-etiqueta">{c.cobertura}</span>
                    <Barra parte={c.a_bordo} total={c.n} maximo={maxCobertura}
                      titulo={`${numero(c.a_bordo)} de ${numero(c.n)} ejecutados`} />
                    <span className="an-cifra">
                      {porcentaje(c.a_bordo, c.n)}%
                      <small>{numero(c.n)}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="pw-panel">
            <div className="pw-panel-head">
              <h2 className="pw-panel-title"><Clock size={16} /> Volumen por día</h2>
              <span className="pw-panel-count">{datos.por_dia.length} días</span>
            </div>
            <div className="pw-panel-inner">
              <ul className="an-dias">
                {datos.por_dia.map((d) => (
                  <li key={d.fecha} title={`${fecha(d.fecha)}: ${numero(d.a_bordo)} de ${numero(d.n)}`}>
                    <span className="an-dia-barra" style={{ height: `${porcentaje(d.n, maxDia)}%` }}>
                      <span className="an-dia-llena" style={{ height: `${porcentaje(d.a_bordo, d.n)}%` }} />
                    </span>
                    <small>{d.fecha.slice(8)}</small>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default AnalisisView;
