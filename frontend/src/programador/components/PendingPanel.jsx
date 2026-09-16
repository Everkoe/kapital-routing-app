import { useMemo } from 'react';
import { CheckCircle2, Info, MapPin, UserPlus } from 'lucide-react';
import { NoveltyReasonBadge } from './estados.jsx';

/**
 * Panel de novedades y pendientes.
 *
 * Los agentes que aparecen aquí son reales: el motor actual agrupa bajo el
 * conductor «SIN ASIGNAR» a todo pasajero que no cupo en ninguna unidad, y en
 * la base vigente eso es la mayoría. No hay categorías inventadas — el motivo
 * se deriva del propio registro (sin coordenadas, sin dirección, sin unidad).
 *
 * Todavía no hay arrastre: asignar un agente exige un endpoint de escritura que
 * no existe. El panel informa en vez de ofrecer un botón que no haría nada.
 */

const initials = (nombre, agenteId) => {
  const source = String(nombre || agenteId || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

const MAX_VISIBLE = 50;

const PendingPanel = ({ pending }) => {
  const counts = useMemo(
    () =>
      pending.reduce(
        (acc, agent) => {
          acc.total += 1;
          acc[agent.motivo] = (acc[agent.motivo] || 0) + 1;
          return acc;
        },
        { total: 0 },
      ),
    [pending],
  );

  const visible = pending.slice(0, MAX_VISIBLE);

  return (
    <section className="pw-panel" aria-labelledby="pw-pending-title">
      <div className="pw-panel-head">
        <h2 className="pw-panel-title" id="pw-pending-title">Novedades y pendientes</h2>
        <span className="pw-panel-count">{counts.total} agentes</span>
      </div>

      {counts.total > 0 && (
        <div className="pw-novelty-counts">
          <div className="pw-novelty-count">
            <strong>{counts.sin_unidad || 0}</strong>
            <span><UserPlus size={12} aria-hidden="true" />Sin unidad</span>
          </div>
          <div className="pw-novelty-count">
            <strong>{counts.sin_ubicacion || 0}</strong>
            <span><MapPin size={12} aria-hidden="true" />Sin ubicación</span>
          </div>
          <div className="pw-novelty-count">
            <strong>{counts.direccion_incompleta || 0}</strong>
            <span><Info size={12} aria-hidden="true" />Dirección incompleta</span>
          </div>
        </div>
      )}

      <div className="pw-panel-body">
        {counts.total === 0 ? (
          <div className="pw-placeholder">
            <CheckCircle2 size={34} aria-hidden="true" />
            <h3>Todo asignado</h3>
            <p>No quedan agentes pendientes en la programación cargada.</p>
          </div>
        ) : (
          <>
            {visible.map((agent) => (
              <article className="pw-agent-card" key={agent.id}>
                <span className="pw-avatar" aria-hidden="true">{initials(agent.nombre, agent.agenteId)}</span>
                <div className="pw-agent-body">
                  <div className="pw-agent-name pw-truncate">{agent.nombre || agent.agenteId || 'Sin nombre'}</div>
                  <div className="pw-agent-meta pw-truncate">
                    {[agent.microZona, agent.horario].filter(Boolean).join(' · ') || 'Sin zona ni horario'}
                  </div>
                  <div className="pw-agent-meta pw-truncate">{agent.direccion || 'Sin dirección'}</div>
                  <NoveltyReasonBadge motivo={agent.motivo} />
                </div>
              </article>
            ))}

            {pending.length > MAX_VISIBLE && (
              <p className="pw-notice">
                <Info size={16} aria-hidden="true" />
                Se muestran {MAX_VISIBLE} de {pending.length}. Usa los filtros para acotar la lista.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default PendingPanel;
