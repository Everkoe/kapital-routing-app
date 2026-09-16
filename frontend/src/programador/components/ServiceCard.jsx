import {
  AlertTriangle,
  ArrowRightLeft,
  Building,
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  History,
  MapPin,
  Truck,
  X,
} from 'lucide-react';
import { distinctDocuments, markDuplicates } from '../model/serviceModel.js';
import { ServiceStateBadge } from './estados.jsx';
import PreviewAction from './PreviewAction.jsx';

/**
 * Tarjeta de servicio y su detalle expandible.
 *
 * La ocupación se muestra con el total real de la unidad. Cuando la flota no
 * declara capacidad para esa unidad se escribe «11 agentes» en vez de inventar
 * un denominador: el tablero anterior escribía `/15` para todas, mientras la
 * flota real tiene unidades de 10, 12, 15 — y de 4 en producción.
 *
 * El detalle muestra la forma completa de la revisión —origen, estado y
 * acciones por agente, más aprobar/rechazar el servicio— aunque esos controles
 * no estén operativos: sin motor no hay propuesta que revisar. Se marcan con
 * `PreviewAction` para que se vean sin engañar.
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
          {/* Número de fila, no secuencia de recogida: el backend todavía no
              ordena las paradas. El orden llega con la entrega 3, y será
              editable a mano. Ver docs/planning §1. */}
          <th scope="col" title="Número de fila. El orden de recogida llega en la entrega 3.">#</th>
          <th scope="col">Agente</th>
          <th scope="col">Documento</th>
          <th scope="col">Dirección</th>
          <th scope="col">Origen</th>
          <th scope="col">Estado</th>
          <th scope="col">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {markDuplicates(agentes).map((agente, index) => (
          <tr key={`${agente?.id || 'sin-id'}-${index}`} data-duplicado={agente.duplicado}>
            <td className="pw-mono">
              <span className="pw-row-grip">
                <GripVertical size={13} aria-hidden="true" />
                {String(index + 1).padStart(2, '0')}
              </span>
            </td>
            <td>{agente?.nombre || 'Sin nombre'}</td>
            <td className="pw-mono">
              {agente?.id || '—'}
              {agente.duplicado && (
                <span className="pw-state" data-tone="warn" title="Este documento ya aparece en este mismo servicio.">
                  <AlertTriangle size={12} aria-hidden="true" />Repetido
                </span>
              )}
            </td>
            <td>{agente?.direccion || 'Sin dirección'}</td>
            {/* Todo lo cargado hoy es original: no hay motor que agregue ni mueva. */}
            <td><span className="pw-tag pw-tag-quiet">Original</span></td>
            <td><ServiceStateBadge estado="programado" size={13} /></td>
            <td>
              <span className="pw-row-actions">
                <PreviewAction Icon={Check} size="sm" entrega="Propuesta automática y revisión">
                  Aprobar
                </PreviewAction>
                <PreviewAction Icon={X} size="sm" entrega="Propuesta automática y revisión">
                  Rechazar
                </PreviewAction>
              </span>
            </td>
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
            <div className="pw-detail-item">
              <dt>Duración estimada</dt>
              <dd className="pw-muted">Con el orden de recogida</dd>
            </div>
            <div className="pw-detail-item">
              <dt>Llegada a destino</dt>
              <dd className="pw-muted">Con el orden de recogida</dd>
            </div>
          </dl>

          <h4 className="pw-detail-heading">Agentes del servicio ({service.agentCount})</h4>

          {distinctDocuments(service.agentes) < service.agentCount && (
            <p className="pw-notice" data-tone="warn">
              <AlertTriangle size={16} aria-hidden="true" />
              {/* Un solo hijo de texto: `.pw-notice` es flex y cualquier elemento
                  suelto se convertiría en columna propia. */}
              <span>
                La ocupación cuenta {service.agentCount} registros pero solo{' '}
                {distinctDocuments(service.agentes)} documentos distintos: hay pasajeros
                repetidos, así que la capacidad mostrada está inflada. Son la misma persona en
                días distintos: el Excel de origen cubre la semana completa y se cargó entera en
                un solo tablero, sin conservar la fecha. Ver la sección Análisis.
              </span>
            </p>
          )}

          {service.agentes.length > 0 ? (
            <AgentTable agentes={service.agentes} />
          ) : (
            <p className="pw-notice" data-tone="warn">
              <Building size={16} aria-hidden="true" />
              Este servicio no tiene agentes asignados.
            </p>
          )}

          <div className="pw-detail-footer">
            <span className="pw-history-hint">
              <History size={15} aria-hidden="true" />
              El historial de cambios se registra desde la entrega 4.
            </span>
            <span className="pw-row-actions">
              <PreviewAction Icon={X} entrega="Propuesta automática y revisión">
                Rechazar propuesta
              </PreviewAction>
              <PreviewAction Icon={Check} variant="primary" entrega="Propuesta automática y revisión">
                Aprobar cambios del servicio
              </PreviewAction>
            </span>
          </div>
        </div>
      )}
    </article>
  );
};

export default ServiceCard;
