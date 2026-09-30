import { AlertTriangle, ArrowRightLeft, X } from 'lucide-react';

/**
 * Confirmación de un arrastre que no cuadra del todo: a otro turno, o a una
 * unidad que se pasa de su capacidad. Se deja hacer, porque quien programa
 * puede saber algo que la tabla no dice, pero no sin decirlo antes.
 */
const ConfirmarArrastre = ({ pendiente, ocupado, onConfirmar, onCancelar }) => {
  if (!pendiente) return null;
  const { persona, destino, avisos } = pendiente;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pw-arrastre-titulo">
      <div className="modal-content pw-confirmar">
        <button type="button" className="pw-confirmar-cerrar" onClick={onCancelar}
          aria-label="Cancelar" disabled={ocupado}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="pw-confirmar-icono historico-recarga-icono">
          <ArrowRightLeft size={22} aria-hidden="true" />
        </div>
        <h3 id="pw-arrastre-titulo">
          ¿Mover a {persona.nombre} a {destino.conductor}?
        </h3>
        <p>{destino.horario} · {destino.microZona}</p>
        <ul className="pw-arrastre-avisos">
          {avisos.map((aviso) => (
            <li key={aviso}>
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{aviso}</span>
            </li>
          ))}
        </ul>
        <div className="pw-confirmar-botones">
          {/* El foco en «Cancelar»: un Enter sin querer no debe mover a nadie. */}
          <button type="button" className="pw-btn" onClick={onCancelar} disabled={ocupado} autoFocus>
            Cancelar
          </button>
          <button type="button" className="pw-btn pw-btn-primary" onClick={onConfirmar} disabled={ocupado}>
            <ArrowRightLeft size={16} aria-hidden="true" />
            Mover igualmente
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmarArrastre;
