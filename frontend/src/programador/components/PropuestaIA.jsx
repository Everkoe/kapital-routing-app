import { useState } from 'react';
import {
  AlertTriangle, ArrowRightLeft, CheckCircle2, ChevronDown, ChevronRight, Info, Loader2, Sparkles, X,
} from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';
import {
  avisosDeLaPropuesta, filasDeComparacion, OBJETIVOS, textoDeConfirmacion,
} from '../model/propuestaIA.js';

const pedir = async (ruta, cuerpo) => apiFetch(ruta, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(cuerpo),
});

const Comparacion = ({ propuesta }) => (
  <table className="pw-ia-tabla">
    <thead>
      <tr><th scope="col" /><th scope="col">Plan actual</th><th scope="col">Propuesta</th><th scope="col" /></tr>
    </thead>
    <tbody>
      {filasDeComparacion(propuesta).map((f) => (
        <tr key={f.etiqueta}>
          <th scope="row">{f.etiqueta}</th>
          <td>{f.actual}</td>
          <td><strong>{f.propuesta}</strong></td>
          <td className="pw-ia-variacion" data-tono={f.tono}>{f.variacion || ''}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const Personas = ({ titulo, lista }) => {
  const [abierto, setAbierto] = useState(false);
  if (!lista?.length) return null;
  const Flecha = abierto ? ChevronDown : ChevronRight;
  return (
    <div className="pw-ia-lista">
      <button type="button" className="pw-ia-desplegar" onClick={() => setAbierto(!abierto)}
        aria-expanded={abierto}>
        <Flecha size={14} aria-hidden="true" /> {titulo} ({lista.length})
      </button>
      {abierto && (
        <ul>
          {lista.map((p) => (
            <li key={`${p.id}|${p.turno}|${p.modalidad}`}>
              <strong>{p.nombre || p.id}</strong> · {p.turno} {String(p.modalidad || '').toLowerCase()}
              {' · '}{p.unidad}
              <small>{p.motivo}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const Servicios = ({ servicios }) => {
  const [abierto, setAbierto] = useState(false);
  if (!servicios?.length) return null;
  const Flecha = abierto ? ChevronDown : ChevronRight;
  return (
    <div className="pw-ia-lista">
      <button type="button" className="pw-ia-desplegar" onClick={() => setAbierto(!abierto)}
        aria-expanded={abierto}>
        <Flecha size={14} aria-hidden="true" /> Servicios propuestos ({servicios.length})
      </button>
      {abierto && (
        <ul>
          {servicios.map((s) => (
            <li key={`${s.unidad}|${s.turno}|${s.modalidad}`}>
              <strong>{s.unidad}</strong> · {s.turno} {s.modalidad.toLowerCase()} · de {s.inicio} a {s.fin}
              <ol className="pw-ia-paradas">
                {s.agentes.map((a) => (
                  <li key={a.id}>
                    {a.hora} · {a.nombre || a.id}
                    {a.cambia && (
                      <span className="pw-ia-cambia" title={`Hoy va en ${a.antes}`}>
                        <ArrowRightLeft size={11} aria-hidden="true" /> antes {a.antes}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

/**
 * «Proponer con IA»: VROOM reorganiza el día y se compara con el plan actual.
 *
 * Nada cambia hasta pulsar «Aplicar», que pide confirmación; después se puede
 * deshacer desde el aviso del plan. Es una propuesta: la decisión sigue siendo
 * del Programador.
 */
const PropuestaIA = ({ abierto, dia, diaLegible, onCerrar, onAplicada }) => {
  const [objetivo, setObjetivo] = useState('unidades');
  const [propuesta, setPropuesta] = useState(null);
  const [estado, setEstado] = useState('eligiendo');
  const [error, setError] = useState(null);

  if (!abierto) return null;
  const ocupado = estado === 'calculando' || estado === 'aplicando';

  const cerrar = () => {
    if (ocupado) return;
    setPropuesta(null);
    setEstado('eligiendo');
    setError(null);
    onCerrar();
  };

  const calcular = async () => {
    setEstado('calculando');
    setError(null);
    try {
      setPropuesta(await pedir('/api/programador/plan/proponer', { fecha: dia, objetivo }));
      setEstado('lista');
    } catch (fallo) {
      setError(fallo?.message || 'No se pudo calcular la propuesta.');
      setEstado('eligiendo');
    }
  };

  const aplicar = async () => {
    setEstado('aplicando');
    setError(null);
    try {
      const resultado = await pedir('/api/programador/plan/aplicar-propuesta',
        { fecha: dia, cambios: propuesta.cambios });
      onAplicada({ resultado, deshacer: propuesta.deshacer, movidas: propuesta.movidas });
      setPropuesta(null);
      setEstado('eligiendo');
    } catch (fallo) {
      setError(fallo?.message || 'No se pudo aplicar la propuesta.');
      setEstado('confirmando');
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pw-ia-titulo">
      <div className="modal-content pw-confirmar pw-ia">
        <button type="button" className="pw-confirmar-cerrar" onClick={cerrar}
          aria-label="Cerrar" disabled={ocupado}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="pw-confirmar-icono pw-ia-icono"><Sparkles size={22} aria-hidden="true" /></div>
        <h3 id="pw-ia-titulo">Proponer con IA · {diaLegible}</h3>
        <p>
          La IA reorganiza las unidades y el orden de recogida de todo el día, turno por turno, con las
          reglas de la operación: como mucho 90 min a bordo y en la sede entre 10 y 45 min antes del
          turno, con 10 min de margen. No cambia nada hasta que la apliques.
        </p>

        {!propuesta && (
          <>
            <fieldset className="pw-ia-objetivos" disabled={ocupado}>
              <legend>¿Qué buscas?</legend>
              {OBJETIVOS.map((o) => (
                <label key={o.id} className="pw-ia-objetivo" data-activo={objetivo === o.id}>
                  <input type="radio" name="pw-ia-objetivo" value={o.id} checked={objetivo === o.id}
                    onChange={() => setObjetivo(o.id)} />
                  <span><strong>{o.etiqueta}</strong><small>{o.ayuda}</small></span>
                </label>
              ))}
            </fieldset>
            <div className="pw-confirmar-botones">
              <button type="button" className="pw-btn" onClick={cerrar} disabled={ocupado}>Cancelar</button>
              <button type="button" className="pw-btn pw-btn-primary" onClick={calcular} disabled={ocupado}>
                {estado === 'calculando'
                  ? <><Loader2 size={16} className="pw-ia-girando" aria-hidden="true" /> Calculando…</>
                  : <><Sparkles size={16} aria-hidden="true" /> Calcular propuesta</>}
              </button>
            </div>
          </>
        )}

        {propuesta && (
          <>
            <Comparacion propuesta={propuesta} />
            <p className="pw-ia-nota">
              Lo actual y lo propuesto se miden con el mismo modelo de tiempos, sacado del histórico
              ({propuesta.sede}). Calculado en {propuesta.segundos} s.
            </p>
            {avisosDeLaPropuesta(propuesta).map((a) => (
              <p key={a.texto} className="pw-notice" data-tone={a.tono === 'warn' ? 'warn' : undefined}>
                {a.tono === 'warn'
                  ? <AlertTriangle size={16} aria-hidden="true" />
                  : <Info size={16} aria-hidden="true" />}
                <span>{a.texto}</span>
              </p>
            ))}
            <Personas titulo="Sin sitio en la propuesta" lista={propuesta.sin_asignar} />
            <Personas titulo="Excepciones por distancia" lista={propuesta.excepciones} />
            <Servicios servicios={propuesta.servicios} />

            {estado === 'confirmando' || estado === 'aplicando' ? (
              <div className="pw-ia-confirmacion">
                <p><CheckCircle2 size={16} aria-hidden="true" /> {textoDeConfirmacion(propuesta)}</p>
                <div className="pw-confirmar-botones">
                  <button type="button" className="pw-btn" onClick={() => setEstado('lista')}
                    disabled={ocupado} autoFocus>
                    Volver
                  </button>
                  <button type="button" className="pw-btn pw-btn-primary" onClick={aplicar} disabled={ocupado}>
                    {estado === 'aplicando' ? 'Aplicando…' : 'Sí, aplicar'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="pw-confirmar-botones">
                <button type="button" className="pw-btn" onClick={() => { setPropuesta(null); setEstado('eligiendo'); }}>
                  Otra propuesta
                </button>
                <button type="button" className="pw-btn pw-btn-primary" onClick={() => setEstado('confirmando')}
                  disabled={!propuesta.cambios?.length}>
                  Aplicar propuesta
                </button>
              </div>
            )}
          </>
        )}

        {error && (
          <p className="pw-notice" data-tone="danger" role="alert">
            <AlertTriangle size={16} aria-hidden="true" /> <span>{error}</span>
          </p>
        )}
      </div>
    </div>
  );
};

export default PropuestaIA;
