import { useEffect, useState } from 'react';
import { Download, FileText, Loader, Trash2, X } from 'lucide-react';
import { caraTieneDocumento, carasDe, esPdf, tieneContenido } from '../utils/documentoArchivo';
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

const DocumentViewer = ({
  documento,
  onClose,
  pie = null,
  // Quitar el archivo de la cara que se mira. Solo lo pasa la revisión de
  // Administración: sin él, el visor no ofrece borrar nada.
  onEliminar = null,
}) => {
  // El estado arranca en la primera cara que tiene archivo —«Completo» va
  // primera y a menudo está vacía: abrir por ella decía «no disponible» con el
  // DNI subido en «Delante»— y se reinicia solo: quien monta este visor le pasa
  // un `key` por documento, así React lo remonta al abrir otro. Reiniciarlo con
  // un efecto sería el antipatrón que la regla de hooks señala.
  const [indice, setIndice] = useState(
    () => Math.max(0, carasDe(documento).findIndex(caraTieneDocumento)),
  );
  // Las URLs firmadas caducan en minutos, así que se piden al abrir la cara y
  // se guardan solo mientras el visor está en pantalla.
  const [firmadas, setFirmadas] = useState({});
  // Borrar pide confirmación en el propio visor: es lo único que no se deshace.
  const [confirmando, setConfirmando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

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
  // Un documento en Storage no tiene contenido hasta que llega su firma.
  // Mientras tanto está cargando, no roto: decir «no disponible» durante ese
  // instante hacía parpadear un error en cada apertura.
  const esperandoFirma = Boolean(cara?.path) && !firmadas[cara.path];
  const titulo = cara?.nombre ? `${documento.name} · ${cara.nombre}` : documento.name;

  const puedeEliminar = Boolean(onEliminar && cara?.campo && caraTieneDocumento(cara));

  const eliminar = async () => {
    setEliminando(true);
    try {
      await onEliminar(cara);
    } catch {
      // Quien elimina anuncia el error; aquí basta con volver a ofrecerlo.
      setEliminando(false);
      setConfirmando(false);
    }
  };

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
          <div className="doc-viewer-acciones">
            {puedeEliminar && !confirmando && (
              <button
                type="button"
                className="doc-viewer-eliminar"
                onClick={() => setConfirmando(true)}
                title="Quitar este archivo, por ejemplo si se subió por error"
              >
                <Trash2 size={15} /> Eliminar
              </button>
            )}
            <button type="button" className="close-btn-inline" onClick={onClose} title="Cerrar">
              <X size={20} />
            </button>
          </div>
        </div>

        {confirmando && (
          <div className="doc-viewer-confirmar" role="alertdialog" aria-label="Confirmar la eliminación">
            <p>
              ¿Eliminar <strong>{titulo}</strong>?
              {documento.deAdministracion
                ? ' Se borra el archivo.'
                : ' Se borra el archivo, y el conductor tendrá que volver a entregarlo.'}
            </p>
            <div className="doc-viewer-confirmar-botones">
              <button type="button" className="btn-secondary" onClick={() => setConfirmando(false)} disabled={eliminando}>
                Cancelar
              </button>
              <button type="button" className="doc-viewer-eliminar-si" onClick={eliminar} disabled={eliminando}>
                {eliminando ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />} Sí, eliminar
              </button>
            </div>
          </div>
        )}

        {caras.length > 1 && (
          <div className="doc-viewer-caras" role="tablist" aria-label="Caras del documento">
            {caras.map((opcion, i) => (
              <button
                key={opcion.nombre || i}
                type="button"
                role="tab"
                aria-selected={i === indice}
                className={`doc-viewer-cara${i === indice ? ' activa' : ''}`}
                onClick={() => { setIndice(i); setConfirmando(false); }}
                disabled={!caraTieneDocumento(opcion)}
              >
                {opcion.nombre}
                {!caraTieneDocumento(opcion) && <span className="doc-cara-opcional">sin archivo</span>}
              </button>
            ))}
          </div>
        )}

        <div className="doc-viewer-body doc-viewer-centrado">
          {esperandoFirma ? (
            <div className="doc-viewer-cargando">
              <Loader size={28} className="animate-spin" aria-hidden="true" />
              <p>Cargando documento…</p>
            </div>
          ) : !disponible ? (
            <div className="doc-viewer-error">
              <h4>Documento no disponible</h4>
              <p>
                El archivo no se cargó correctamente.
                {documento.deAdministracion ? ' Vuelve a subirlo.' : ' Pide al conductor que lo vuelva a subir.'}
              </p>
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

        {/* La vigencia del documento, donde se está mirando el documento. */}
        {pie && <div className="doc-viewer-pie">{pie}</div>}
      </div>
    </div>
  );
};

export default DocumentViewer;
