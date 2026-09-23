import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

/**
 * La caja donde se suelta el Excel.
 *
 * La comparten las dos cargas del Programador —el histórico y las novedades—
 * porque son el mismo gesto con otro archivo, y tener dos copias del mismo
 * dropzone acaba con una de las dos comportándose distinto.
 */
const ACEPTA = '.xls,.xlsx';

const ZonaDeCarga = ({ ocupada, titulo, instruccion, onArchivo }) => {
  const [arrastrando, setArrastrando] = useState(false);
  const selector = useRef(null);

  const entregar = (archivo) => {
    if (archivo && !ocupada) onArchivo(archivo);
  };

  return (
    <div
      className={`historico-zona${arrastrando ? ' arrastrando' : ''}${ocupada ? ' ocupada' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
      onDragLeave={() => setArrastrando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastrando(false);
        entregar(e.dataTransfer.files?.[0]);
      }}
    >
      <Upload size={26} aria-hidden="true" />
      <p>{ocupada ? 'Procesando el archivo…' : titulo}</p>
      <small>{instruccion}</small>
      <button type="button" className="pw-btn pw-btn-primary" disabled={ocupada}
        onClick={() => selector.current?.click()}>
        Seleccionar archivo
      </button>
      <input ref={selector} type="file" accept={ACEPTA} style={{ display: 'none' }}
        aria-hidden="true" tabIndex={-1}
        onChange={(e) => { entregar(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
};

export default ZonaDeCarga;
