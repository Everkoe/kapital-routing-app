import { useEffect, useState } from 'react';
import { Download, FileText, X } from 'lucide-react';
import { carasDe, esPdf, tieneContenido } from '../utils/documentoArchivo';
import { urlFirmada } from '../utils/documentoStorage';

/**
 * Visor de un documento, con sus caras dentro.
 *
 * Un documento de dos caras se abre una sola vez: el selector vive dentro del
 * visor, así se pasa de delante a detrás sin cerrarlo y se pueden comparar las
 * dos. Antes hacía falta un botón «Ver» por cara en la tarjeta, que la
 * recargaba y obligaba a cerrar y reabrir para ver la otra.
 *
 * El PDF no se incrusta a propósito: Brave y Chrome bloquean los `iframe` con
 * `data:application/pdf`, así que el visor ofrece la descarga en su lugar.
 */

const DocumentViewer = ({ documento, onClose }) => {
  // El estado arranca en la primera cara y se reinicia solo: quien monta este
  // visor le pasa un `key` por documento, así React lo remonta al abrir otro.
  // Reiniciarlo con un efecto sería el antipatrón que la regla de hooks señala.
  const [indice, setIndice] = useState(0);
  // Las URLs firmadas caducan en minutos, así que se piden al abrir la cara y
  // se guardan solo mientras el visor está en pantalla.
  const [firmadas, setFirmadas] = useState({});

  const caraActiva = carasDe(documento)[indice];
  const rutaActiva = caraActiva?.path;

  useEffect(() => {
    if (!rutaActiva || firmadas[rutaActiva]) return undefined;
    let vigente = true;
    urlFirmada(rutaActiva)
      .then(url => { if (vigente) setFirmadas(prev => ({ ...prev, [rutaActiva]: url })); })
      .catch(() => {});
    return () => { vigente = false; };
  }, [rutaActiva, firmadas]);

  if (!documento) return null;

  const caras = carasDe(documento);

  const cara = caras[Math.min(indice, caras.length - 1)];
  const src = firmadas[cara?.path] || cara?.src || '';
  const pdf = esPdf(src);
  const disponible = tieneContenido(src);
  const titulo = cara?.nombre ? `${documento.name} · ${cara.nombre}` : documento.name;

  const descargar = () => {
    if (!disponible) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = titulo;
    a.click();
  };

  return (
    <div className="doc-viewer-overlay" onClick={onClose}>
      <div
        className="doc-viewer-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: pdf ? '600px' : '900px',
          height: pdf ? 'auto' : '80vh',
          minHeight: pdf ? '300px' : 'auto',
        }}
      >
        <div className="doc-viewer-header">
          <h3>{titulo}</h3>
          <button type="button" className="close-btn-inline" onClick={onClose} title="Cerrar">
            <X size={20} />
          </button>
        </div>

        {caras.length > 1 && (
          <div className="doc-viewer-caras" role="tablist" aria-label="Caras del documento">
            {caras.map((opcion, i) => (
              <button
                key={opcion.nombre || i}
                type="button"
                role="tab"
                aria-selected={i === indice}
                className={`doc-viewer-cara${i === indice ? ' activa' : ''}`}
                onClick={() => setIndice(i)}
                disabled={!tieneContenido(opcion.src || '')}
              >
                {opcion.nombre}
                {!tieneContenido(opcion.src || '') && <span className="doc-cara-opcional">sin archivo</span>}
              </button>
            ))}
          </div>
        )}

        <div className="doc-viewer-body doc-viewer-centrado">
          {!disponible ? (
            <div className="doc-viewer-error">
              <h4>Documento no disponible</h4>
              <p>El archivo no se cargó correctamente. Pide al conductor que lo vuelva a subir.</p>
            </div>
          ) : pdf ? (
            <div className="doc-viewer-pdf">
              <FileText size={72} />
              <h3>Archivo PDF</h3>
              <button type="button" className="doc-viewer-descargar" onClick={descargar}>
                <Download size={20} /> Descargar para visualizar
              </button>
            </div>
          ) : (
            <img src={src} alt={titulo} className="doc-image" />
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentViewer;
