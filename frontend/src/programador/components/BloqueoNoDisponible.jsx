import { CalendarCog, CalendarX2, X } from 'lucide-react';

/**
 * Se soltó a alguien en una unidad que ese día no trabaja ese turno.
 *
 * No se puede (decisión del usuario: «avisa que no se va a poder»), pero el
 * mismo aviso lleva a cambiar su disponibilidad: si el conductor sí puede ese
 * día, se corrige y se vuelve a arrastrar.
 */
const BloqueoNoDisponible = ({ bloqueo, onModificar, onCerrar }) => {
  if (!bloqueo) return null;
  const { persona, destino, motivo, unidad } = bloqueo;

  return (
    <div className="modal-overlay" role="alertdialog" aria-modal="true" aria-labelledby="pw-bloqueo-titulo">
      <div className="modal-content pw-confirmar">
        <button type="button" className="pw-confirmar-cerrar" onClick={onCerrar} aria-label="Cerrar">
          <X size={18} aria-hidden="true" />
        </button>
        <div className="pw-confirmar-icono">
          <CalendarX2 size={22} aria-hidden="true" />
        </div>
        <h3 id="pw-bloqueo-titulo">
          No se puede poner a {persona?.nombre || 'esta persona'} en {unidad}
        </h3>
        <p>{destino?.horario} · {destino?.microZona}</p>
        <p className="pw-confirmar-aviso">{motivo}</p>
        <p>Si el conductor sí puede trabajar ese turno, cambia su disponibilidad y vuelve a arrastrarlo.</p>
        <div className="pw-confirmar-botones">
          <button type="button" className="pw-btn" onClick={onCerrar} autoFocus>
            Cerrar
          </button>
          <button type="button" className="pw-btn pw-btn-primary" onClick={() => onModificar(unidad)}>
            <CalendarCog size={16} aria-hidden="true" />
            Modificar disponibilidad
          </button>
        </div>
      </div>
    </div>
  );
};

export default BloqueoNoDisponible;
