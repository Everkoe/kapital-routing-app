import { useMemo } from 'react';
import { ArrowRightLeft, Info, Undo2, X } from 'lucide-react';
import { opcionesParaMover } from '../model/arrastrePlan.js';
import OpcionServicio from './OpcionServicio.jsx';

/**
 * «Mover»: llevar a alguien a otro servicio sin arrastrarlo.
 *
 * Con teclado no se puede arrastrar, y con 200 servicios el destino suele
 * quedar lejos en la lista. Enseña las opciones del motor para esa persona
 * —su turno, sentido y sede, con sitio, de mejor a peor— y la salida de
 * dejarla pendiente. Lo que el motor no propone (otro turno, una unidad
 * llena) se sigue pudiendo hacer arrastrando, con su aviso.
 */
const MoverAgente = ({ persona, services, ocupado, onElegir, onDejarPendiente, onCerrar }) => {
  const opciones = useMemo(() => opcionesParaMover(persona, services), [persona, services]);
  if (!persona) return null;
  const { origen } = persona;
  const candidatos = opciones?.candidatos || [];

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pw-mover-titulo">
      <div className="modal-content pw-confirmar pw-mover">
        <button type="button" className="pw-confirmar-cerrar" onClick={onCerrar}
          aria-label="Cerrar" disabled={ocupado}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="pw-confirmar-icono historico-recarga-icono">
          <ArrowRightLeft size={22} aria-hidden="true" />
        </div>
        <h3 id="pw-mover-titulo">Mover a {persona.nombre}</h3>
        <p>Ahora va en <strong>{origen.conductor}</strong> · {origen.horario} · {origen.microZona}.</p>

        {candidatos.length > 0 ? (
          <div className="pw-mover-opciones">
            {candidatos.map((candidato, indice) => (
              <OpcionServicio key={candidato.service.id} candidato={candidato}
                principal={indice === 0} ocupado={ocupado} etiqueta="Mover aquí"
                onElegir={() => onElegir(candidato)} />
            ))}
          </div>
        ) : (
          <p className="pw-propuesta-vacia" data-tone="warn">
            <Info size={13} aria-hidden="true" />
            No hay otro servicio de su turno, sentido y sede con sitio. Puedes
            arrastrarla al servicio que elijas —te avisará de lo que no cuadre— o
            dejarla pendiente.
          </p>
        )}

        <div className="pw-confirmar-botones">
          <button type="button" className="pw-btn" onClick={onCerrar} disabled={ocupado} autoFocus>
            Cancelar
          </button>
          <button type="button" className="pw-btn" onClick={onDejarPendiente} disabled={ocupado}
            title="Sale de este servicio sin darle de baja y queda en «Novedades y pendientes»">
            <Undo2 size={16} aria-hidden="true" />
            Dejar pendiente
          </button>
        </div>
      </div>
    </div>
  );
};

export default MoverAgente;
