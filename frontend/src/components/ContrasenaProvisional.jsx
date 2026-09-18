import { useState } from 'react';
import { Check, Copy, KeyRound, X } from 'lucide-react';

/**
 * La contraseña provisional de un reinicio, mostrada una sola vez.
 *
 * Desde que las contraseñas se guardan cifradas no se puede leer la de nadie,
 * así que esta es la única vez que existe en algún sitio legible: el servidor
 * la devuelve en la respuesta del reinicio y no la guarda ni la anota en el
 * historial. Por eso el aviso insiste en copiarla antes de cerrar.
 *
 * Se muestra en grande y separada en bloques porque su destino es dictarla por
 * teléfono o WhatsApp a quien acaba de quedarse fuera.
 */

const ContrasenaProvisional = ({ datos, onCerrar }) => {
  const [copiada, setCopiada] = useState(false);

  if (!datos) return null;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(datos.password);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    } catch {
      // Sin portapapeles —contexto no seguro, permiso denegado— queda a la
      // vista para copiarla a mano, que es el motivo de mostrarla tan grande.
      setCopiada(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="titulo-provisional">
      <div className="modal-content provisional-card">
        <button type="button" className="btn-icon-sutil provisional-cerrar"
          onClick={onCerrar} aria-label="Cerrar">
          <X size={18} />
        </button>

        <div className="provisional-icono"><KeyRound size={28} aria-hidden="true" /></div>
        <h3 id="titulo-provisional" className="provisional-titulo">Contraseña provisional</h3>
        <p className="provisional-sub">
          Para <strong>{datos.nombre || 'la cuenta'}</strong>. Dícteselá y, al entrar,
          el sistema le pedirá que ponga la suya.
        </p>

        <div className="provisional-clave">
          <code>{datos.password}</code>
          <button type="button" className="provisional-copiar" onClick={copiar}>
            {copiada ? <><Check size={14} /> Copiada</> : <><Copy size={14} /> Copiar</>}
          </button>
        </div>

        <p className="provisional-aviso">
          No vuelve a mostrarse. Si la pierde, tendrá que reiniciarla otra vez.
        </p>

        {datos.sesiones_cerradas > 0 && (
          <p className="provisional-sesiones">
            Se {datos.sesiones_cerradas === 1 ? 'cerró 1 sesión abierta' : `cerraron ${datos.sesiones_cerradas} sesiones abiertas`} de esta cuenta.
          </p>
        )}

        <button type="button" className="provisional-listo" onClick={onCerrar}>
          Ya la anoté
        </button>
      </div>
    </div>
  );
};

export default ContrasenaProvisional;
