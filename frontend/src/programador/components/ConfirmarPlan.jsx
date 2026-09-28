import { AlertTriangle, Trash2, X } from 'lucide-react';

/**
 * Confirmación de «Borrar» la programación de un día.
 *
 * Tira el trabajo de una persona y deja a los conductores y al cliente sin ver
 * ese día, así que se dice antes, y no con un `confirm()` del navegador, que
 * no deja explicarlo. Empezar de cero es borrar y volver a pulsar «Crear
 * programación»: un «Rehacer» aparte se probó y confundía, porque hacía lo
 * mismo en un paso. La base rechaza el borrado igualmente si el día ya pasó o
 * si algún conductor ya marcó viajes: esto es para no hacerlo sin querer.
 */
const ConfirmarPlan = ({ abierto, dia, ocupado, onConfirmar, onCancelar }) => {
  if (!abierto) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pw-confirmar-titulo">
      <div className="modal-content pw-confirmar">
        <button type="button" className="pw-confirmar-cerrar" onClick={onCancelar}
          aria-label="Cancelar" disabled={ocupado}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="pw-confirmar-icono"><Trash2 size={22} aria-hidden="true" /></div>
        <h3 id="pw-confirmar-titulo">Borrar la programación del {dia}</h3>
        <p>El día se queda sin programación: los conductores y el cliente dejan de verlo.</p>
        <p>
          Se pierde todo lo hecho en este día. Para empezar de cero, vuelve a
          pulsar «Crear programación».
        </p>
        <p className="pw-confirmar-aviso">
          <AlertTriangle size={14} aria-hidden="true" />
          No se puede deshacer.
        </p>
        <div className="pw-confirmar-botones">
          {/* El foco en «Cancelar»: un Enter sin querer no debe borrar el día. */}
          <button type="button" className="pw-btn" onClick={onCancelar} disabled={ocupado} autoFocus>
            Cancelar
          </button>
          <button type="button" className="pw-btn pw-btn-peligro" onClick={onConfirmar}
            disabled={ocupado}>
            <Trash2 size={16} aria-hidden="true" />
            Borrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmarPlan;
