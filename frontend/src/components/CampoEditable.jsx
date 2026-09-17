import { useState } from 'react';
import { Check, Loader, Pencil, X } from 'lucide-react';

/**
 * Un valor que se lee, y que se edita en el sitio donde se lee.
 *
 * Es el patrón que ya usaba el correo del conductor, generalizado. La
 * alternativa era un formulario aparte con los mismos campos repetidos debajo
 * de la ficha, que obligaba a leer dos veces lo mismo y no dejaba claro cuál
 * de los dos valores mandaba.
 *
 * El guardado lo resuelve quien lo usa: este componente solo sabe pasar de
 * texto a campo y avisar del valor nuevo. Mientras `onGuardar` trabaja muestra
 * el reloj, y si lanza un error se queda abierto con lo escrito, para que no
 * haya que teclearlo otra vez.
 */

const CampoEditable = ({
  // Sin etiqueta se muestra solo el valor: sirve para los que ya tienen su
  // rótulo alrededor, como el padrón bajo la foto del conductor.
  etiqueta = '',
  valor,
  onGuardar,
  tipo = 'text',
  opciones = null,
  vacio = 'Sin registrar',
  editable = true,
  children,
}) => {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState('');
  const [guardando, setGuardando] = useState(false);

  const actual = String(valor ?? '');

  const abrir = () => {
    setBorrador(actual);
    setEditando(true);
  };

  const guardar = async () => {
    const limpio = borrador.trim();
    if (limpio === actual.trim()) {
      setEditando(false);
      return;
    }
    setGuardando(true);
    try {
      await onGuardar(limpio);
      setEditando(false);
    } catch {
      // El error lo anuncia quien guarda; aquí basta con no cerrar.
    } finally {
      setGuardando(false);
    }
  };

  if (!editando) {
    return (
      <span className="campo-editable">
        {etiqueta && <strong>{etiqueta}:</strong>}
        <span className={actual ? '' : 'campo-editable-vacio'}>{children || actual || vacio}</span>
        {editable && (
          <button type="button" className="btn-icon-sutil" onClick={abrir} title={`Editar ${(etiqueta || 'valor').toLowerCase()}`}>
            <Pencil size={12} />
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="campo-editable campo-editable-abierto">
      {etiqueta && <strong>{etiqueta}:</strong>}
      {opciones ? (
        <select value={borrador} disabled={guardando} onChange={(e) => setBorrador(e.target.value)}>
          {opciones.map((opcion) => <option key={opcion}>{opcion}</option>)}
          {borrador && !opciones.includes(borrador) && <option>{borrador}</option>}
        </select>
      ) : (
        <input
          type={tipo}
          value={borrador}
          autoFocus
          disabled={guardando}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') guardar();
            if (e.key === 'Escape') setEditando(false);
          }}
        />
      )}
      <button type="button" className="btn-icon-sutil" onClick={guardar} disabled={guardando} title="Guardar">
        {guardando ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
      </button>
      <button type="button" className="btn-icon-sutil" onClick={() => setEditando(false)} disabled={guardando} title="Cancelar">
        <X size={12} />
      </button>
    </span>
  );
};

export default CampoEditable;
