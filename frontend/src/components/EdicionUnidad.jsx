import { useState } from 'react';
import { Loader, Save, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiFetch } from '../utils/apiClient';
import { getDocumentStatus } from '../utils/flotaDocumentStatus';

/**
 * Datos de la unidad y vigencias, dentro de la ficha del conductor.
 *
 * Antes esto era un modal aparte que se abría con el lápiz de la tabla, así que
 * para revisar a un conductor y corregir su unidad había que abrir dos
 * ventanas distintas sobre la misma persona. Ahora vive donde ya se está
 * mirando todo lo suyo.
 *
 * Las cuatro vigencias van juntas y separadas de los documentos del conductor
 * porque son de otra naturaleza: no hay archivo que subir ni cara que revisar,
 * solo una fecha que vence. Dos de ellas —ATU y licencia MTC— ni siquiera
 * tienen documento en la aplicación.
 */

const TIPOS_DE_UNIDAD = ['AUTO', 'SUV', 'VAN', 'MINIVAN', 'CAMIONETA'];

const VIGENCIAS = [
  { campo: 'soat', etiqueta: 'SOAT' },
  { campo: 'revision', etiqueta: 'Revisión Técnica' },
  { campo: 'atu', etiqueta: 'T.U.C. (ATU)' },
  { campo: 'licencia', etiqueta: 'Licencia MTC' },
];

const CAMPOS_EDITABLES = ['chofer', 'telefono', 'tipo', 'capacidad', 'soat', 'revision', 'atu', 'licencia'];

const texto = (valor) => String(valor ?? '');

const EdicionUnidad = ({ unidad, unidadId, puedeRenombrar = false, onGuardado }) => {
  const inicial = () => ({
    padron: texto(unidadId),
    chofer: texto(unidad?.chofer),
    telefono: texto(unidad?.telefono),
    tipo: texto(unidad?.tipo) || TIPOS_DE_UNIDAD[0],
    capacidad: texto(unidad?.capacidad),
    soat: texto(unidad?.soat),
    revision: texto(unidad?.revision),
    atu: texto(unidad?.atu),
    licencia: texto(unidad?.licencia),
  });

  const [datos, setDatos] = useState(inicial);
  const [guardando, setGuardando] = useState(false);

  const cambia = (campo) => (evento) => setDatos(previo => ({ ...previo, [campo]: evento.target.value }));

  const guardar = async () => {
    const padronNuevo = datos.padron.trim();
    const renombra = puedeRenombrar && padronNuevo && padronNuevo !== unidadId;
    const cambios = CAMPOS_EDITABLES.some(campo => datos[campo] !== inicial()[campo]);

    if (!renombra && !cambios) {
      toast('No hay cambios para guardar.');
      return;
    }

    setGuardando(true);
    try {
      // El padrón viaja por su propio endpoint y va primero: migra la unidad,
      // el usuario y su sesión. Si falla, no se toca nada más.
      let destino = unidadId;
      if (renombra) {
        await apiFetch(`/api/flota/${encodeURIComponent(unidadId)}/renombrar`, {
          method: 'POST',
          json: { nuevo_id: padronNuevo },
        });
        destino = padronNuevo;
      }

      await apiFetch(`/api/flota/${encodeURIComponent(destino)}`, {
        method: 'PUT',
        json: {
          chofer: datos.chofer,
          telefono: datos.telefono,
          tipo: datos.tipo,
          capacidad: Number.parseInt(datos.capacidad, 10) || 0,
          soat: datos.soat,
          revision: datos.revision,
          atu: datos.atu,
          licencia: datos.licencia,
        },
      });

      toast.success('Unidad actualizada.');
      onGuardado?.(destino);
    } catch (error) {
      toast.error(error?.message || 'No se pudo guardar la unidad.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="unidad-edicion">
      <div className="unidad-edicion-cabecera">
        <h4><Truck size={18} /> Datos de la unidad</h4>
        <button type="button" className="btn-approve-doc" onClick={guardar} disabled={guardando}>
          {guardando ? <Loader size={13} className="animate-spin" /> : <Save size={13} />} Guardar
        </button>
      </div>

      <div className="unidad-edicion-campos">
        <label className="unidad-campo">
          <span>Padrón / ID de unidad</span>
          <input value={datos.padron} onChange={cambia('padron')} disabled={!puedeRenombrar} />
          {puedeRenombrar && (
            <small>Cambiarlo migra también al conductor asociado y su sesión abierta.</small>
          )}
        </label>
        <label className="unidad-campo">
          <span>Nombre del chofer</span>
          <input value={datos.chofer} onChange={cambia('chofer')} placeholder="Nombre completo" />
        </label>
        <label className="unidad-campo">
          <span>Teléfono WhatsApp</span>
          <input value={datos.telefono} onChange={cambia('telefono')} placeholder="Ej. 987654321" />
        </label>
        <label className="unidad-campo">
          <span>Tipo</span>
          <select value={datos.tipo} onChange={cambia('tipo')}>
            {TIPOS_DE_UNIDAD.map(tipo => <option key={tipo}>{tipo}</option>)}
            {/* Una unidad con un tipo fuera de la lista conserva el suyo en vez
                de que abrir la ficha se lo cambie en silencio. */}
            {datos.tipo && !TIPOS_DE_UNIDAD.includes(datos.tipo) && <option>{datos.tipo}</option>}
          </select>
        </label>
        <label className="unidad-campo">
          <span>Capacidad (Pax)</span>
          <input type="number" min="1" value={datos.capacidad} onChange={cambia('capacidad')} />
        </label>
      </div>

      <h4 className="unidad-vigencias-titulo">Vigencias de la unidad</h4>
      <div className="unidad-edicion-campos">
        {VIGENCIAS.map(({ campo, etiqueta }) => {
          const { status, text } = getDocumentStatus(datos[campo]);
          return (
            <label className="unidad-campo" key={campo}>
              <span>{etiqueta}</span>
              <input type="date" value={datos[campo]} onChange={cambia(campo)} />
              <div className={`status-badge status-${status}`}>
                <span className="dot"></span>{text}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default EdicionUnidad;
