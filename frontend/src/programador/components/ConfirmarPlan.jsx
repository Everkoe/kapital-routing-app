import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react';

/**
 * Confirmación de «Rehacer» y «Borrar» sobre la programación de un día.
 *
 * Las dos tiran trabajo de una persona, y en el caso de borrar además dejan a
 * los conductores y al cliente sin ver ese día. Por eso se dice qué se pierde
 * antes de hacerlo, y no con un `confirm()` del navegador, que no deja
 * explicarlo. La base las rechaza igualmente si el día ya pasó o si algún
 * conductor ya marcó viajes: esto es para no hacerlo sin querer, no la guarda.
 */

const TEXTOS = {
  rehacer: {
    Icono: RotateCcw,
    titulo: (dia) => `Rehacer la programación del ${dia}`,
    cuerpo: (desde) => [
      `Se vuelve a copiar del último día ejecutado${desde ? ` (${desde})` : ''}.`,
      'Se pierde todo lo hecho a mano en este día: retiros, cambios de orden, '
        + 'personas movidas o asignadas y las novedades aplicadas (habrá que volver a aplicarlas).',
    ],
    boton: 'Rehacer',
  },
  borrar: {
    Icono: Trash2,
    titulo: (dia) => `Borrar la programación del ${dia}`,
    cuerpo: () => [
      'El día se queda sin programación: los conductores y el cliente dejan de verlo.',
      'Se pierde todo lo hecho en este día. Se puede volver a crear después.',
    ],
    boton: 'Borrar',
  },
};

const ConfirmarPlan = ({ accion, dia, sembradoDesde, ocupado, onConfirmar, onCancelar }) => {
  const texto = TEXTOS[accion];
  if (!texto) return null;
  const { Icono } = texto;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pw-confirmar-titulo">
      <div className="modal-content pw-confirmar">
        <button type="button" className="pw-confirmar-cerrar" onClick={onCancelar}
          aria-label="Cancelar" disabled={ocupado}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="pw-confirmar-icono"><Icono size={22} aria-hidden="true" /></div>
        <h3 id="pw-confirmar-titulo">{texto.titulo(dia)}</h3>
        {texto.cuerpo(sembradoDesde).map((linea) => <p key={linea}>{linea}</p>)}
        <p className="pw-confirmar-aviso">
          <AlertTriangle size={14} aria-hidden="true" />
          No se puede deshacer.
        </p>
        <div className="pw-confirmar-botones">
          <button type="button" className="pw-btn" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </button>
          <button type="button" className="pw-btn pw-btn-peligro" onClick={onConfirmar}
            disabled={ocupado} autoFocus>
            <Icono size={16} aria-hidden="true" />
            {texto.boton}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmarPlan;
