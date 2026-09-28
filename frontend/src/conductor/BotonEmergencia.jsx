import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Siren, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { apiFetch } from '../utils/apiClient';
import { objetivoDelServicio } from './modeloServicios';

/**
 * El SOS pide confirmación: en el bolsillo o con una mano se toca sin querer, y
 * una falsa alarma a la central cuesta tanto como una real. Antes avisaba de
 * «Central notificada» aunque la petición fallara (un `fetch` no lanza con un
 * 4xx o 5xx); ahora solo lo dice si el aviso llegó al panel de Administración.
 */
const BotonEmergencia = ({ usuario, unidad, servicio, conTexto = false }) => {
  const [abierto, setAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setEnviando(true);
    const donde = servicio ? ` Servicio: ${objetivoDelServicio(servicio)}.` : '';
    try {
      await apiFetch('/api/notifications', {
        method: 'POST',
        json: {
          title: 'Alerta SOS',
          message: `${usuario?.nombre || 'Un conductor'} (unidad ${unidad || 'sin unidad'}) pidió ayuda.${donde}`,
          type: 'error',
        },
      });
      toast.success('La central recibió tu alerta. Te contactarán enseguida.', { duration: 8000 });
      setAbierto(false);
    } catch (error) {
      toast.error(`No se pudo enviar la alerta${error?.message ? `: ${error.message}` : ''}. Llama a la central.`,
        { duration: 10000 });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <button type="button" className="cd-boton cd-boton--sos" onClick={() => setAbierto(true)} aria-label="Emergencia">
        <Siren size={22} />
        {conTexto && 'Emergencia'}
      </button>
      {/* Al `body`: la barra inferior lleva `backdrop-filter`, que encierra a
          cualquier hijo `position: fixed` dentro de ella, y la hoja no se veía. */}
      {abierto && createPortal(
        <div className="cd-velo cd-portal-capa" role="presentation" onClick={() => !enviando && setAbierto(false)}>
          <div className="cd-hoja" role="dialog" aria-modal="true" aria-labelledby="cd-sos-titulo"
               onClick={(e) => e.stopPropagation()}>
            <h2 id="cd-sos-titulo"><Siren size={26} /> Emergencia</h2>
            <p>Se avisará ahora mismo a la central con tu nombre, tu unidad y el servicio que estás haciendo.</p>
            <button type="button" className="cd-boton cd-boton--rojo cd-boton--grande cd-boton--ancho"
                    onClick={enviar} disabled={enviando}>
              <Siren size={22} /> {enviando ? 'Enviando…' : 'Enviar alerta'}
            </button>
            <button type="button" className="cd-boton cd-boton--ancho" onClick={() => setAbierto(false)}
                    disabled={enviando}>
              <X size={18} /> Cancelar
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default BotonEmergencia;
