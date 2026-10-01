import { useState } from 'react';
import { Pencil, X } from 'lucide-react';

/**
 * Pedir a Administración que cambie un dato del conductor.
 *
 * Los datos del conductor y de su vehículo no se cambian solos: los revisa
 * Administración, y el cambio se aplica cuando lo aprueba. Se dice antes de
 * enviar para que nadie espere verlo cambiado al momento.
 */
const SolicitarCambio = ({ campo, valorActual, onEnviar, onCerrar }) => {
  const [valor, setValor] = useState(valorActual || '');
  const [enviando, setEnviando] = useState(false);
  const limpio = valor.trim();
  const titulo = `pf-solicitud-${campo.clave}`;

  const enviar = async (e) => {
    e.preventDefault();
    if (!limpio) return;
    setEnviando(true);
    const hecho = await onEnviar(limpio);
    setEnviando(false);
    if (hecho) onCerrar();
  };

  return (
    <div className="pf-modal-fondo" role="presentation" onClick={enviando ? undefined : onCerrar}>
      <div className="pf-modal" role="dialog" aria-modal="true" aria-labelledby={titulo}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape' && !enviando) onCerrar(); }}>
        <header className="pf-modal-cabecera">
          <span className="pf-tarjeta-icono" aria-hidden="true"><Pencil size={16} /></span>
          <span>
            <h2 id={titulo} className="pf-tarjeta-titulo">Solicitar cambio</h2>
            <p className="pf-tarjeta-subtitulo">{campo.etiqueta}</p>
          </span>
          <button type="button" className="pf-btn pf-btn-icono" onClick={onCerrar} disabled={enviando}
            aria-label="Cerrar">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <form className="pf-formulario" onSubmit={enviar}>
          <p className="pf-nota">
            Administración revisa la solicitud y el dato cambia cuando la aprueba.
          </p>
          {valorActual && (
            <p className="pf-modal-actual">Ahora: <strong>{valorActual}</strong></p>
          )}
          <div className="pf-campo">
            <label htmlFor={`${titulo}-valor`} className="pf-campo-etiqueta">Nuevo valor</label>
            <input id={`${titulo}-valor`} className="pf-input" value={valor} autoFocus maxLength={120}
              onChange={(e) => setValor(e.target.value)} disabled={enviando} />
          </div>
          <div className="pf-acciones">
            <button type="button" className="pf-btn" onClick={onCerrar} disabled={enviando}>Cancelar</button>
            <button type="submit" className="pf-btn pf-btn-primario"
              disabled={enviando || !limpio || limpio === valorActual}>
              {enviando ? 'Enviando…' : 'Enviar solicitud'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SolicitarCambio;
