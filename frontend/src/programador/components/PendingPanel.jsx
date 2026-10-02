import { useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, GripVertical, Info, ListChecks, MapPin,
  Route, Undo2, UserPlus,
} from 'lucide-react';
import { NoveltyReasonBadge } from './estados.jsx';
import OpcionServicio from './OpcionServicio.jsx';

/**
 * Panel de novedades y pendientes.
 *
 * **Sobre un plan**, cada pendiente trae la propuesta del motor de inserción
 * (`model/motorInsercion.js`): en qué servicio entraría, por qué, y un botón
 * para asignarlo. La propuesta no se aplica sola: la decide quien programa,
 * de una en una o todas juntas. Cuando no cabe en ningún sitio se dice por
 * qué —llenos, otra sede, ningún servicio de su turno—, porque «no cabe» sin
 * motivo deja sin saber si falta una unidad o sobra una restricción.
 *
 * **Sobre el histórico** no se asigna nada: lo que pasó no se edita. Los
 * agentes que aparecen son los que el día dejó sin unidad, con el motivo
 * derivado del propio registro (sin coordenadas, sin dirección, sin unidad).
 *
 * **Se arrastra en los dos sentidos** (sobre un plan): cada pendiente se lleva
 * a cualquier servicio del tablero, también a uno que el motor no propone, y
 * a quien va en un servicio se le suelta aquí para dejarlo pendiente sin darle
 * de baja. Qué se deja soltar dónde lo decide `model/arrastrePlan.js`.
 */

const initials = (nombre, agenteId) => {
  const source = String(nombre || agenteId || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

const MAX_VISIBLE = 50;

/** Por qué no hay sitio, en palabras. */
const porQueNoCabe = ({ descartes, total }) => {
  const motivos = [];
  if (descartes.llenos) motivos.push(`${descartes.llenos} ${descartes.llenos === 1 ? 'lleno' : 'llenos'}`);
  if (descartes.otraSede) motivos.push(`${descartes.otraSede} a otra sede`);
  if (descartes.noDisponible) {
    motivos.push(`${descartes.noDisponible} con la unidad no disponible`);
  }
  if (motivos.length === 0 && total === 0) return 'No hay ningún servicio de su turno y sentido.';
  return `Servicios de su turno: ${motivos.join(', ')}.`;
};

const Opcion = ({ candidato, principal, ocupado, onAsignar }) => (
  <OpcionServicio candidato={candidato} principal={principal} ocupado={ocupado}
    etiqueta="Asignar aquí" onElegir={onAsignar} />
);

const Propuesta = ({ resultado, ocupado, onAsignar }) => {
  const [abierto, setAbierto] = useState(false);
  if (!resultado) return null;

  if (resultado.estado === 'sin_turno') {
    return (
      <p className="pw-propuesta-vacia">
        <Info size={13} aria-hidden="true" />
        La novedad no trae turno o sentido: no hay con qué buscarle sitio.
      </p>
    );
  }
  if (resultado.estado === 'sin_sitio') {
    return (
      <p className="pw-propuesta-vacia" data-tone="warn">
        <AlertTriangle size={13} aria-hidden="true" />
        No cabe en ningún servicio que ya exista. {porQueNoCabe(resultado)} Puedes
        arrastrarlo al servicio que elijas: te avisará de lo que no cuadre.
      </p>
    );
  }

  const [mejor, ...otras] = resultado.candidatos;
  const restantes = resultado.total - 1;
  return (
    <div className="pw-propuesta">
      <span className="pw-propuesta-titulo">Propuesta</span>
      {resultado.sinUbicacion && (
        <span className="pw-state" data-tone="warn">
          <MapPin size={12} aria-hidden="true" />
          Sin ubicación: se ordena por plazas libres, no por distancia
        </span>
      )}
      <Opcion candidato={mejor} principal ocupado={ocupado}
        onAsignar={() => onAsignar(mejor)} />
      {otras.length > 0 && (
        <>
          <button type="button" className="pw-propuesta-mas" onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}>
            {abierto ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
            {abierto ? 'Ocultar' : `Otras opciones (${restantes})`}
          </button>
          {abierto && otras.map((c) => (
            <Opcion key={c.service.id} candidato={c} ocupado={ocupado}
              onAsignar={() => onAsignar(c)} />
          ))}
        </>
      )}
    </div>
  );
};

const PendingPanel = ({
  pending,
  totalPending = pending.length,
  modoPlan = false,
  propuestas,
  asignables = 0,
  ocupado = false,
  onAsignar,
  onAsignarTodas,
  arrastre = null,
  onArrastrarPendiente,
  onTerminarArrastre,
  onDejarPendiente,
}) => {
  // Solo sobre un plan: en el histórico no se mueve a nadie.
  const arrastrable = modoPlan && Boolean(onArrastrarPendiente);
  // Quien viene arrastrado desde un servicio se puede soltar aquí.
  const recibe = modoPlan && arrastre?.tipo === 'servicio' && Boolean(onDejarPendiente);
  const counts = useMemo(
    () => pending.reduce(
      (acc, agent) => {
        acc.total += 1;
        acc[agent.motivo] = (acc[agent.motivo] || 0) + 1;
        const estado = propuestas?.get(agent.pendingKey)?.estado;
        if (estado) acc[estado] = (acc[estado] || 0) + 1;
        if (propuestas?.get(agent.pendingKey)?.sinUbicacion) acc.sinUbicacion += 1;
        return acc;
      },
      { total: 0, sinUbicacion: 0 },
    ),
    [pending, propuestas],
  );

  const visible = pending.slice(0, MAX_VISIBLE);

  return (
    <section className="pw-panel" aria-labelledby="pw-pending-title"
      data-soltar={recibe ? 'si' : undefined}
      onDragOver={recibe ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
      onDrop={recibe ? (e) => { e.preventDefault(); onDejarPendiente(); } : undefined}>
      <div className="pw-panel-head">
        <h2 className="pw-panel-title" id="pw-pending-title">Novedades y pendientes</h2>
        <span className="pw-panel-tools">
          {modoPlan && asignables > 0 && (
            // Aplica las propuestas tal como se ven: calculadas juntas, sin
            // repetir plaza. Es un atajo para el lunes con veinte novedades,
            // no una decisión que el motor tome solo.
            <button type="button" className="pw-btn pw-btn-primary pw-btn-sm"
              disabled={ocupado} onClick={onAsignarTodas}>
              <ListChecks size={14} aria-hidden="true" />
              {asignables === 1 ? 'Asignar la propuesta' : `Asignar todas (${asignables})`}
            </button>
          )}
          <span className="pw-panel-count">
            {totalPending !== counts.total
              ? `${counts.total} de ${totalPending} agentes`
              : `${counts.total} agentes`}
          </span>
        </span>
      </div>

      {counts.total > 0 && (modoPlan ? (
        <div className="pw-novelty-counts">
          <div className="pw-novelty-count">
            <strong>{counts.con_propuesta || 0}</strong>
            <span><CheckCircle2 size={12} aria-hidden="true" />Con propuesta</span>
          </div>
          <div className="pw-novelty-count">
            <strong>{(counts.sin_sitio || 0) + (counts.sin_turno || 0)}</strong>
            <span><AlertTriangle size={12} aria-hidden="true" />Sin sitio</span>
          </div>
          <div className="pw-novelty-count">
            <strong>{counts.sinUbicacion}</strong>
            <span><MapPin size={12} aria-hidden="true" />Sin ubicación</span>
          </div>
        </div>
      ) : (
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
      ))}

      <div className="pw-panel-body">
        {counts.total === 0 ? (
          <div className="pw-placeholder">
            {totalPending > 0 ? <Info size={34} aria-hidden="true" /> : (
              <CheckCircle2 size={34} aria-hidden="true" />
            )}
            <h3>{totalPending > 0 ? 'Ningún pendiente coincide' : 'Todo asignado'}</h3>
            <p>{totalPending > 0
              ? 'Ajusta o limpia los filtros para volver a ver los pendientes.'
              : 'No quedan agentes pendientes en la programación cargada.'}</p>
          </div>
        ) : (
          <>
            {visible.map((agent) => (
              <article className="pw-agent-card" key={agent.pendingKey || agent.id}
                draggable={arrastrable || undefined}
                data-arrastrando={(arrastrable && arrastre?.clave === agent.pendingKey) || undefined}
                title={arrastrable ? 'Arrástralo a un servicio del tablero para asignarlo ahí' : undefined}
                onDragStart={arrastrable ? (e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  // Firefox no empieza el arrastre sin algún dato.
                  e.dataTransfer.setData('text/plain', String(agent.agenteId || agent.pendingKey));
                  onArrastrarPendiente(agent.pendingKey);
                } : undefined}
                onDragEnd={arrastrable ? onTerminarArrastre : undefined}>
                {arrastrable && <GripVertical size={14} className="pw-agent-asa" aria-hidden="true" />}
                <span className="pw-avatar" aria-hidden="true">{initials(agent.nombre, agent.agenteId)}</span>
                <div className="pw-agent-body">
                  <div className="pw-agent-name pw-truncate">{agent.nombre || agent.agenteId || 'Sin nombre'}</div>
                  <div className="pw-agent-meta pw-truncate">
                    {[agent.microZona, agent.horario].filter(Boolean).join(' · ') || 'Sin zona ni horario'}
                  </div>
                  <div className="pw-agent-meta pw-truncate">{agent.direccion || 'Sin dirección'}</div>
                  <NoveltyReasonBadge motivo={agent.motivo} />
                  {/* Qué cambió, con las palabras de la novedad: sin esto no se
                      sabe si alguien está aquí por un turno nuevo o una mudanza. */}
                  {agent.detalle && (
                    <div className="pw-agent-meta">{agent.detalle}</div>
                  )}
                  {/* El documento se repite dentro del mismo servicio. Es un
                      problema de los datos de origen, y el Programador debe
                      verlo aquí en vez de descubrirlo al exportar. */}
                  {agent.duplicado && (
                    <span className="pw-state" data-tone="warn">
                      <AlertTriangle size={13} aria-hidden="true" />
                      Documento duplicado
                    </span>
                  )}
                  {modoPlan && (
                    <Propuesta
                      resultado={propuestas?.get(agent.pendingKey)}
                      ocupado={ocupado}
                      onAsignar={(candidato) => onAsignar?.(agent.pendingKey, candidato)}
                    />
                  )}
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

      {/* Cómo elige, dicho una vez y a la vista: una propuesta que no se sabe
          de dónde sale no se puede discutir, solo aceptar o ignorar. */}
      {modoPlan && (recibe ? (
        <div className="pw-dropzone" data-activa="true">
          <Undo2 size={18} aria-hidden="true" />
          <span>
            <strong>Suelta aquí para dejarlo pendiente</strong>
            <span>
              Sale de {arrastre.origen?.conductor || 'su servicio'} sin darle de baja: queda en
              esta lista para asignarlo a otro servicio.
            </span>
          </span>
        </div>
      ) : (
        <div className="pw-dropzone">
          <Route size={18} aria-hidden="true" />
          <span>
            <strong>Cómo elige la propuesta</strong>
            <span>
              Busca sitio en los servicios que ya existen del mismo turno, sentido
              y sede. Prefiere su zona y, dentro de ella, el menor desvío en línea
              recta. Las plazas son las que declara la flota o, si no declara
              ninguna, lo más que esa unidad ha llevado. No abre servicios nuevos.
              Para decidir tú, arrastra a la persona al servicio que quieras.
            </span>
          </span>
        </div>
      ))}
    </section>
  );
};

export default PendingPanel;
