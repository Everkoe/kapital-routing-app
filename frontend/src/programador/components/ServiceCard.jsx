import { ArrowRightLeft, Building, ChevronDown, ChevronRight, MapPin, Truck } from 'lucide-react';
import { ServiceStateBadge } from './estados.jsx';

/**
 * Tarjeta de servicio y su detalle expandible.
 *
 * La ocupación se muestra con el total real de la unidad. Cuando la flota no
 * declara capacidad para esa unidad se escribe «11 agentes» en vez de inventar
 * un denominador: el tablero anterior escribía `/15` para todas, mientras la
 * flota real tiene unidades de 10, 12 y 15.
 */

/** El sentido viaja dentro del texto del horario; no existe campo propio. */
const sentido = (horario = '') => {
  const value = horario.toLowerCase();
  if (value.includes('ingreso')) return 'Ingreso';
  if (value.includes('salida')) return 'Salida';
  return null;
};

const occupancyTone = (capacity) => {
  if (capacity.over) return 'over';
  if (capacity.known && capacity.full) return 'full';
  return 'ok';
};

const Occupancy = ({ capacity }) => {
  const pct = capacity.known && capacity.total > 0
    ? Math.min((capacity.used / capacity.total) * 100, 100)
    : 0;

  return (
    <div className="pw-occupancy">
      <span className="pw-occupancy-label">
        {capacity.known
          ? `${capacity.used}/${capacity.total} ocupados`
          : `${capacity.used} agentes · capacidad no declarada`}
      </span>
      {capacity.known && (
        <div
          className="pw-bar"
          role="progressbar"
          aria-valuenow={capacity.used}
          aria-valuemin={0}
          aria-valuemax={capacity.total}
          aria-label={`Ocupación: ${capacity.used} de ${capacity.total}`}
        >
          <div className="pw-bar-fill" data-tone={occupancyTone(capacity)} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
};

const AgentTable = ({ agentes }) => (
  <div className="pw-table-scroll">
    <table className="pw-table">
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Agente</th>
          <th scope="col">Documento</th>
          <th scope="col">Dirección</th>
          <th scope="col">Empresa</th>
        </tr>
      </thead>
      <tbody>
        {agentes.map((agente, index) => (
          <tr key={`${agente?.id || 'sin-id'}-${index}`}>
            {/* Número de fila, no secuencia de recogida: el backend todavía no
                ordena las paradas. Ver docs/planning §1. */}
            <td className="pw-mono">{String(index + 1).padStart(2, '0')}</td>
            <td>{agente?.nombre || 'Sin nombre'}</td>
            <td className="pw-mono">{agente?.id || '—'}</td>
            <td>{agente?.direccion || 'Sin dirección'}</td>
            <td>{agente?.empresa || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ServiceCard = ({ service, ordinal, isOpen, onToggle }) => {
  const via = sentido(service.horario);
  const detailId = `pw-detail-${service.id}`;

  return (
    <article className="pw-service" data-open={isOpen}>
      <button
        type="button"
        className="pw-service-summary"
        onClick={() => onToggle(service.id)}
        aria-expanded={isOpen}
        aria-controls={detailId}
      >
        <span className="pw-ordinal">{String(ordinal).padStart(2, '0')}</span>

        <span className="pw-time">
          <strong>{service.horario || 'Sin horario'}</strong>
          {via && <span className="pw-tag"><ArrowRightLeft size={11} aria-hidden="true" />{via}</span>}
        </span>

        <span className="pw-cell">
          <MapPin size={15} aria-hidden="true" />
          <span className="pw-truncate">{service.microZona || 'Sin zona'}</span>
        </span>

        <span className="pw-cell">
          <Truck size={15} aria-hidden="true" />
          <span className="pw-cell-stack">
            <span className="pw-truncate">{service.conductor}</span>
            {service.empresa && <small className="pw-truncate">{service.empresa}</small>}
          </span>
        </span>

        <Occupancy capacity={service.capacity} />

        <span className="pw-cell">
          <ServiceStateBadge estado={service.estado} />
          {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        </span>
      </button>

      {isOpen && (
        <div className="pw-detail" id={detailId}>
          <dl className="pw-detail-grid">
            <div className="pw-detail-item">
              <dt>Unidad / conductor</dt>
              <dd>{service.conductor}</dd>
            </div>
            <div className="pw-detail-item">
              <dt>Zona de cobertura</dt>
              <dd>{service.microZona || '—'}</dd>
            </div>
            <div className="pw-detail-item">
              <dt>Horario</dt>
              <dd>{service.horario || '—'}</dd>
            </div>
            <div className="pw-detail-item">
              <dt>Capacidad</dt>
              <dd>
                {service.capacity.known
                  ? `${service.capacity.used} de ${service.capacity.total} · ${service.capacity.free} libres`
                  : `${service.capacity.used} agentes · sin capacidad declarada`}
              </dd>
            </div>
          </dl>

          {service.agentes.length > 0 ? (
            <AgentTable agentes={service.agentes} />
          ) : (
            <p className="pw-notice" data-tone="warn">
              <Building size={16} aria-hidden="true" />
              Este servicio no tiene agentes asignados.
            </p>
          )}
        </div>
      )}
    </article>
  );
};

export default ServiceCard;
