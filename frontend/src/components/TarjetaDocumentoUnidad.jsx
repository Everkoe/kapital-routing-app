import { useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, FileText, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { validarArchivoDocumento } from '../utils/validacionDocumento';

/**
 * Tarjeta de un documento de la unidad durante el alta.
 *
 * El archivo no se sube todavía: se queda aquí hasta que la unidad exista,
 * porque su sitio en el bucket es `<padrón>/<documento>` y el padrón se decide
 * en este mismo formulario. Por eso el estado dice «listo para subir» y no
 * «subido», y por eso se puede quitar sin dejar nada atrás.
 *
 * Arrastrar, soltar y el botón terminan en la misma validación: la del resto
 * de la aplicación, para que el alta no acepte lo que la ficha rechazaría.
 */

const pesoLegible = (bytes) => `${(Number(bytes || 0) / (1024 * 1024)).toFixed(2)} MB`;

const TarjetaDocumentoUnidad = ({
  etiqueta,
  archivo,
  fecha,
  error = '',
  onArchivo,
  onFecha,
  idFecha,
}) => {
  const [arrastrando, setArrastrando] = useState(false);
  const selector = useRef(null);
  const idError = error ? `${idFecha}-error` : undefined;

  const aceptar = (candidato) => {
    if (!candidato) return;
    const problema = validarArchivoDocumento(candidato);
    if (problema) {
      toast.error(`${etiqueta}: ${problema}`);
      return;
    }
    onArchivo(candidato);
  };

  return (
    <div className={`unidad-doc${error ? ' campo-pendiente' : ''}`}>
      <div className="unidad-doc-titulo">
        <span className="unidad-doc-icono"><FileText size={18} aria-hidden="true" /></span>
        <div>
          <strong>{etiqueta}</strong>
          <span className={`unidad-doc-estado${archivo ? ' listo' : ''}`}>
            {archivo ? <><CheckCircle2 size={12} /> Listo para subir</> : 'Sin archivo'}
          </span>
        </div>
      </div>

      <label className="unidad-doc-fecha" htmlFor={idFecha}>
        <span><CalendarDays size={13} aria-hidden="true" /> Fecha de vencimiento</span>
        <input
          id={idFecha}
          type="date"
          value={fecha}
          onChange={(e) => onFecha(e.target.value)}
          aria-describedby={idError}
        />
      </label>

      {archivo ? (
        <div className="unidad-doc-archivo">
          <FileText size={16} aria-hidden="true" />
          <div>
            <span className="unidad-doc-nombre">{archivo.name}</span>
            <span className="unidad-doc-peso">{pesoLegible(archivo.size)}</span>
          </div>
          <button
            type="button"
            className="btn-icon-sutil"
            onClick={() => selector.current?.click()}
            aria-label={`Reemplazar el archivo de ${etiqueta}`}
            title="Reemplazar"
          >
            <Upload size={14} />
          </button>
          <button
            type="button"
            className="btn-icon-sutil"
            onClick={() => onArchivo(null)}
            aria-label={`Quitar el archivo de ${etiqueta}`}
            title="Quitar"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div
          className={`unidad-doc-zona${arrastrando ? ' arrastrando' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastrando(false);
            aceptar(e.dataTransfer.files?.[0]);
          }}
        >
          <Upload size={20} aria-hidden="true" />
          <p>Arrastra un archivo aquí o selecciónalo</p>
          <small>PDF, JPG, PNG o WebP · máx. 5 MB</small>
          <button type="button" className="btn-view-doc" onClick={() => selector.current?.click()}>
            Seleccionar archivo
          </button>
        </div>
      )}

      {error && <small className="campo-aviso" id={idError} role="alert">{error}</small>}

      <input
        ref={selector}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => { aceptar(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
};

export default TarjetaDocumentoUnidad;
