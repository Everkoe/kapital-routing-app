import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Building,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GripVertical,
  History,
  MapPin,
  RotateCcw,
  UserMinus,
  UserPlus,
  Truck,
  X,
} from 'lucide-react';
import { distinctDocuments, markDuplicates } from '../model/serviceModel.js';
import { ServiceStateBadge } from './estados.jsx';
import PreviewAction from './PreviewAction.jsx';
import ServiceMap from './ServiceMap.jsx';

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

const ORIGEN_LABELS = {
  historico: 'Original',
  novedad: 'Novedad',
  manual: 'Manual',
};

const ESTADO_LABELS = {
  programado: { label: 'Programado', tone: 'ok' },
  retirado: { label: 'Retirado', tone: 'danger' },
};

const AgentOrigin = ({ agente, historical }) => {
  const origen = String(agente?.origen || '').trim().toLowerCase();
  const label = origen
    ? (ORIGEN_LABELS[origen] || 'No informado')
    : (historical ? 'Original' : 'No informado');
  return (
    <span className="pw-tag pw-tag-quiet" title={agente?.nota || undefined}>
      {label}
    </span>
  );
};

const AgentStatus = ({ agente }) => {
  const estado = String(agente?.estado || '').trim().toLowerCase();
  const info = ESTADO_LABELS[estado] || { label: 'No informado', tone: 'neutral' };
  return (
    <span className="pw-state" data-tone={info.tone} title={agente?.nota || undefined}>
      {info.label}
    </span>
  );
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

/** La lista con un elemento cambiado de sitio, sin tocar la original. */
const moverEn = (lista, desde, hasta) => {
  const copia = [...lista];
  const [movido] = copia.splice(desde, 1);
  copia.splice(hasta, 0, movido);
  return copia;
};

const AgentTable = ({ agentes, comparadoCon, onRetirar, onOrdenar, historical }) => {
  // El orden recién soltado, mientras el servidor lo guarda. Sin esto la fila
  // vuelve a su sitio hasta que llega la relectura y parece que el arrastre no
  // funcionó. La tarjeta monta la tabla con una `key` hecha del orden, así que
  // en cuanto llegan los datos nuevos esto se descarta solo.
  const [enEspera, setEnEspera] = useState(null);
  const [arrastrado, setArrastrado] = useState(null);
  const [destino, setDestino] = useState(null);
  const filas = enEspera ?? agentes;
  const puedeOrdenar = Boolean(onOrdenar) && filas.length > 1;

  const reordenar = async (desde, hasta) => {
    if (desde === null || desde === hasta || hasta < 0 || hasta >= filas.length) return;
    const nuevas = moverEn(filas, desde, hasta);
    setEnEspera(nuevas);
    const guardado = await onOrdenar(nuevas.map((a) => a.id));
    if (!guardado) setEnEspera(null);
  };

  const soltarArrastre = () => {
    setArrastrado(null);
    setDestino(null);
  };

  // Dónde caería la fila: encima o debajo según venga de arriba o de abajo.
  const marcaDestino = (index) => {
    if (arrastrado === null || destino !== index || arrastrado === index) return undefined;
    return arrastrado < index ? 'debajo' : 'encima';
  };

  return (
  <div className="pw-table-scroll">
    <table className="pw-table">
      <thead>
        <tr>
          {puedeOrdenar ? (
            <th scope="col" title="Orden de recogida del plan. Arrastra la fila o usa las flechas para cambiarlo.">#</th>
          ) : (
            /* En el histórico es el orden real en que se recogió a cada
               persona, según la hora. Lo que pasó no se reordena. */
            <th scope="col" title="Orden real de recogida, según la hora del histórico.">#</th>
          )}
          <th scope="col">Agente</th>
          <th scope="col">Documento</th>
          <th scope="col">Dirección</th>
          <th scope="col">Origen</th>
          <th scope="col">Estado</th>
          <th scope="col">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {markDuplicates(filas).map((agente, index) => (
          <tr key={`${agente?.id || 'sin-id'}-${index}`} data-duplicado={agente.duplicado}
            draggable={puedeOrdenar || undefined}
            data-arrastrando={arrastrado === index || undefined}
            data-destino={marcaDestino(index)}
            onDragStart={puedeOrdenar ? (e) => {
              setArrastrado(index);
              e.dataTransfer.effectAllowed = 'move';
              // Firefox no empieza el arrastre sin algún dato.
              e.dataTransfer.setData('text/plain', String(agente?.id ?? index));
            } : undefined}
            onDragOver={puedeOrdenar ? (e) => { e.preventDefault(); setDestino(index); } : undefined}
            onDrop={puedeOrdenar ? (e) => {
              e.preventDefault();
              reordenar(arrastrado, index);
              soltarArrastre();
            } : undefined}
            onDragEnd={puedeOrdenar ? soltarArrastre : undefined}>
            <td className="pw-mono">
              <span className="pw-orden">
                {puedeOrdenar && <GripVertical size={14} className="pw-orden-asa" aria-hidden="true" />}
                {String(index + 1).padStart(2, '0')}
                {puedeOrdenar && (
                  <span className="pw-orden-flechas">
                    <button type="button" className="pw-orden-flecha" disabled={index === 0}
                      aria-label={`Recoger antes a ${agente?.nombre || agente?.id}`}
                      onClick={() => reordenar(index, index - 1)}>
                      <ChevronUp size={12} aria-hidden="true" />
                    </button>
                    <button type="button" className="pw-orden-flecha"
                      disabled={index === filas.length - 1}
                      aria-label={`Recoger después a ${agente?.nombre || agente?.id}`}
                      onClick={() => reordenar(index, index + 1)}>
                      <ChevronDown size={12} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </span>
            </td>
            <td>
              {agente?.nombre || 'Sin nombre'}
              {agente?.nuevo && (
                <span className="pw-state" data-tone="ok"
                  title={`No viajaba en esta unidad y turno ${comparadoCon ? `el ${comparadoCon}` : 'el día cargado anterior'}.`}>
                  <UserPlus size={12} aria-hidden="true" />Entró
                </span>
              )}
            </td>
            <td className="pw-mono">
              {agente?.id || '—'}
              {agente.duplicado && (
                <span className="pw-state" data-tone="warn" title="Este documento ya aparece en este mismo servicio.">
                  <AlertTriangle size={12} aria-hidden="true" />Repetido
                </span>
              )}
            </td>
            <td>{agente?.direccion || 'Sin dirección'}</td>
            <td>
              <AgentOrigin agente={agente} historical={historical} />
              {agente?.nota && <small className="pw-detail-nota">{agente.nota}</small>}
            </td>
            <td><AgentStatus agente={agente} /></td>
            <td>
              <span className="pw-row-actions">
                {onRetirar ? (
                  /* Sobre un plan sí hay algo que hacer: sacar a alguien del
                     servicio. Aprobar y rechazar siguen sin existir porque no
                     hay propuesta que revisar. */
                  <button type="button" className="pw-btn pw-btn-sm"
                    onClick={() => onRetirar(agente)}
                    title="Sacar a esta persona del servicio">
                    <UserMinus size={13} aria-hidden="true" />
                    Retirar
                  </button>
                ) : (
                  <>
                    <PreviewAction Icon={Check} size="sm" entrega="Propuesta automática y revisión">
                      Aprobar
                    </PreviewAction>
                    <PreviewAction Icon={X} size="sm" entrega="Propuesta automática y revisión">
                      Rechazar
                    </PreviewAction>
                  </>
                )}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
  );
};

const ServiceCard = ({ service, ordinal, isOpen, onToggle, comparadoCon,
                      onRetirar, onReponer, onOrdenar, historical }) => {
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
          {service.modificado && (
            <span className="pw-tag pw-tag-cambio"
              title={service.cambio?.servicio_nuevo
                ? `Esta unidad no hacía este turno ${comparadoCon ? `el ${comparadoCon}` : 'el día cargado anterior'}.`
                : `Entró o salió gente respecto ${comparadoCon ? `al ${comparadoCon}` : 'al día cargado anterior'}.`}>
              <History size={11} aria-hidden="true" />
              {service.cambio?.servicio_nuevo ? 'Servicio nuevo' : 'Cambió'}
            </span>
          )}
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
              <dt>Duración medida</dt>
              {service.duracion ? (
                <dd>
                  {Math.round(service.duracion.p50)} min
                  <small className="pw-detail-nota">
                    {' '}· hasta {Math.round(service.duracion.p90)} min en el 10% peor
                    {' '}· {service.duracion.casos} casos
                  </small>
                </dd>
              ) : (
                <dd className="pw-muted">Sin casos suficientes en el histórico</dd>
              )}
            </div>
            <div className="pw-detail-item">
              <dt>Orden de recogida</dt>
              <dd className="pw-muted">
                {onOrdenar ? 'El del plan: arrastra las filas para cambiarlo'
                  : 'Por la hora real del histórico'}
              </dd>
            </div>
          </dl>

          {service.modificado && (
            <p className="pw-notice" data-tone="warn">
              <History size={16} aria-hidden="true" />
              <span>
                {service.cambio?.servicio_nuevo
                  ? 'Este servicio no existía en el día cargado anterior: la unidad no hacía este turno.'
                  : `Cambió respecto ${comparadoCon ? `al ${comparadoCon}` : 'al día cargado anterior'}.`}
                {service.cambio?.nuevos > 0 && (
                  <> <strong>{service.cambio.nuevos}</strong> agente(s) entraron.</>
                )}
                {service.cambio?.salieron?.length > 0 && (
                  <> Salieron: <strong>{service.cambio.salieron.join(', ')}</strong>.</>
                )}
              </span>
            </p>
          )}

          <h4 className="pw-detail-heading">Dónde viven</h4>
          <ServiceMap agentes={service.agentes} titulo={service.id} plan={Boolean(onOrdenar)} />

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
            <AgentTable key={service.agentes.map((a) => a?.id).join('|')}
              agentes={service.agentes} comparadoCon={comparadoCon}
              historical={historical}
              onRetirar={onRetirar ? (agente) => onRetirar(service, agente) : null}
              onOrdenar={onOrdenar ? (dnis) => onOrdenar(service, dnis) : null} />
          ) : (
            <p className="pw-notice" data-tone="warn">
              <Building size={16} aria-hidden="true" />
              Este servicio no tiene agentes asignados.
            </p>
          )}

          {/* Los retirados no se borran: el día siguiente necesita saber que
              alguien iba a viajar y se cayó, y quien revisa necesita poder
              deshacerlo sin volver a buscar a la persona. Van fuera del
              condicional de arriba porque un servicio puede quedarse sin nadie
              a bordo y seguir teniendo retirados que enseñar. */}
          {service.retirados?.length > 0 && (
            <>
              <h4 className="pw-detail-heading">
                Retirados de este servicio ({service.retirados.length})
              </h4>
              <ul className="pw-retirados">
                {service.retirados.map((agente) => (
                  <li key={agente.id}>
                    <span className="pw-truncate">
                      {agente.nombre || agente.id}
                      {agente.nota && <small> · {agente.nota}</small>}
                    </span>
                    {onReponer && (
                      <button type="button" className="pw-btn pw-btn-sm"
                        onClick={() => onReponer(service, agente)}
                        title="Devolver a esta persona al servicio">
                        <RotateCcw size={13} aria-hidden="true" />
                        Reponer
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
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
