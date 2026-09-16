import { Clock, HelpCircle, Info, Lock, Settings } from 'lucide-react';
import './programador.css';

/**
 * Parámetros de la operación.
 *
 * La vista anterior era una tarjeta vacía titulada «Configuración del
 * Algoritmo» —`App.jsx` la declaraba en una línea sin contenido— y el menú
 * llevaba a ella desde hace tiempo.
 *
 * No la relleno con controles inventados. Lo que hay hoy son valores fijos en
 * el código, y decirlo con su valor real y dónde vive es más útil que un
 * formulario que no guardaría nada. Debajo quedan las decisiones abiertas, que
 * son lo que de verdad bloquea hacer esto configurable.
 */

const PARAMETROS = [
  {
    label: 'Operación',
    valor: 'TP',
    detalle: 'Único alcance de esta fase. Remisse y Conecta compartirán interfaz, con datos y reglas propias.',
  },
  {
    label: 'Ventana operativa',
    valor: '11:00 — 07:00',
    detalle: 'Fija en el código. Queda por decidir si debe configurarse por operación.',
  },
  {
    label: 'Capacidad de cada unidad',
    valor: 'Desde la flota',
    detalle: 'Se lee de la unidad, no de una constante. Cuando no está declarada, la interfaz lo dice en vez de suponerla.',
  },
  {
    label: 'Caché de lectura',
    valor: '45 segundos',
    detalle: 'Acompaña al del backend. Evita descargar el tablero en cada cambio de sección.',
  },
  {
    label: 'Duración de la sesión',
    valor: '12 horas',
    detalle: 'Cookie de sesión del servidor. Al caducar, la aplicación devuelve al inicio de sesión.',
  },
];

const DECISIONES = [
  'Al reordenar paradas a mano, ¿los tiempos los recalcula el servidor o el cliente?',
  '¿Puede un recálculo del motor mover una parada que ya se colocó a mano?',
  '¿Aprobar un servicio incluye aprobar el orden de recogida, o solo la lista de agentes?',
  '¿Qué hacer con un pasajero que aparece repetido: descartarlo, fusionarlo o revisarlo a mano?',
  '¿Dónde se guarda la sesión de planificación con sus borradores e historial?',
  '¿La ventana operativa debe ser configurable por operación?',
];

const ConfiguracionView = () => (
  <div className="pw-root">
    <header className="pw-header">
      <div className="pw-header-titles">
        <h1 className="pw-title">Configuración</h1>
        <span className="pw-meta"><Settings size={15} aria-hidden="true" />Parámetros de la operación</span>
      </div>
    </header>

    <p className="pw-notice">
      <Info size={16} aria-hidden="true" />
      <span>
        Estos valores están fijados en el código y todavía no son editables. Se muestran con su
        valor real y dónde viven, que es más útil que un formulario que no guardaría nada.
      </span>
    </p>

    <section className="pw-panel" aria-labelledby="pw-params-title">
      <div className="pw-panel-head">
        <h2 className="pw-panel-title" id="pw-params-title">Parámetros vigentes</h2>
        <span className="pw-panel-count"><Lock size={13} aria-hidden="true" /> Solo lectura</span>
      </div>
      <div className="pw-panel-inner">
        <div className="pw-table-scroll">
          <table className="pw-table">
            <thead>
              <tr>
                <th scope="col">Parámetro</th>
                <th scope="col">Valor</th>
                <th scope="col">Nota</th>
              </tr>
            </thead>
            <tbody>
              {PARAMETROS.map(({ label, valor, detalle }) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td><span className="pw-tag">{valor}</span></td>
                  <td>{detalle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section className="pw-panel" aria-labelledby="pw-open-title">
      <div className="pw-panel-head">
        <h2 className="pw-panel-title" id="pw-open-title">Decisiones abiertas</h2>
        <span className="pw-panel-count">{DECISIONES.length} pendientes</span>
      </div>
      <div className="pw-panel-inner">
        <p className="pw-footnote">
          <HelpCircle size={14} aria-hidden="true" />
          <span>
            Estas preguntas son lo que bloquea hacer configurable lo de arriba. No son detalles de
            implementación: cada una cambia qué se construye.
          </span>
        </p>
        <ul className="pw-decision-list">
          {DECISIONES.map((pregunta) => (
            <li key={pregunta}>
              <Clock size={14} aria-hidden="true" />
              <span>{pregunta}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  </div>
);

export default ConfiguracionView;
