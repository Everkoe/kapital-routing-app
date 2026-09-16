import { CheckCircle, Clock, Eye, Upload, XCircle } from 'lucide-react';
import DocumentDropZone from './DocumentDropZone';
import { admiteReverso, claveReverso } from '../constants/documentosConductor';

/**
 * Tarjeta de revisión de un documento, con sus caras dentro.
 *
 * Un documento de dos caras ocupaba antes dos tarjetas, y con trece documentos
 * el panel se volvía una pared de tarjetas difícil de recorrer. Aquí cada
 * documento es una sola tarjeta y sus caras son filas: se sigue viendo el
 * estado de ambas de un vistazo, sin abrir modales que escondan lo que falta.
 *
 * La revisión sigue siendo por cara. El administrador puede rechazar solo el
 * reverso borroso sin tumbar el anverso, que ya estaba bien, y el conductor
 * resube únicamente esa cara.
 */

const ESTADOS = {
  aprobado: { Icon: CheckCircle, clase: 'rev-ok', texto: 'Aprobado' },
  rechazado: { Icon: XCircle, clase: 'rev-no', texto: 'Rechazado' },
  pendiente: { Icon: Clock, clase: 'rev-pending', texto: 'Pendiente' },
};

const fuenteDeArchivo = (fileData) => {
  if (typeof fileData === 'string') return fileData;
  if (fileData && typeof fileData === 'object') {
    return fileData.base64 || fileData.url || fileData.file || '';
  }
  return '';
};

const EstadoCara = ({ revision, tieneArchivo }) => {
  if (!tieneArchivo) return <span className="rev-badge rev-missing">Sin archivo</span>;
  const estado = ESTADOS[revision?.estado] || ESTADOS.pendiente;
  return (
    <span className={`rev-badge ${estado.clase}`}>
      <estado.Icon size={12} /> {estado.texto}
    </span>
  );
};

const CaraDocumento = ({
  campo,
  nombre,
  opcional,
  fileData,
  revision,
  cargando,
  onUpload,
  onReview,
  onView,
  mostrarNombre,
  accept,
}) => {
  const tieneArchivo = Boolean(fileData);

  return (
    <DocumentDropZone
      className="doc-cara"
      label={nombre}
      disabled={cargando}
      onFile={(file) => onUpload(campo, file)}
    >
      <div className="doc-cara-info">
        {mostrarNombre && <span className="doc-cara-nombre">{nombre}</span>}
        {opcional && <span className="rev-badge rev-optional">Opcional</span>}
        <EstadoCara revision={revision} tieneArchivo={tieneArchivo} />
      </div>

      <div className="doc-cara-acciones">
        {tieneArchivo && (
          <button
            type="button"
            className="btn-view-doc"
            title="Ver documento"
            onClick={() => onView({ name: nombre, src: fuenteDeArchivo(fileData), raw: fileData })}
          >
            <Eye size={13} /> Ver
          </button>
        )}

        <label className="btn-view-doc doc-cara-subir" title={tieneArchivo ? 'Reemplazar archivo' : 'Subir archivo'}>
          <Upload size={13} /> {tieneArchivo ? 'Reemplazar' : 'Subir'}
          <input
            type="file"
            accept={accept}
            style={{ display: 'none' }}
            onChange={(e) => onUpload(campo, e.target.files[0])}
          />
        </label>

        {tieneArchivo && (
          <>
            <button
              type="button"
              className="btn-approve-doc"
              disabled={cargando || revision?.estado === 'aprobado'}
              onClick={() => onReview(campo, 'aprobado')}
            >
              {cargando ? '...' : <><CheckCircle size={13} /> Aprobar</>}
            </button>
            <button
              type="button"
              className="btn-reject-doc"
              disabled={cargando || revision?.estado === 'rechazado'}
              onClick={() => onReview(campo, 'rechazado')}
            >
              {cargando ? '...' : <><XCircle size={13} /> Rechazar</>}
            </button>
          </>
        )}
      </div>

      {!tieneArchivo && (
        <p className="review-doc-missing">
          Arrastra el archivo aquí o usa el botón.
        </p>
      )}
    </DocumentDropZone>
  );
};

const DocumentReviewCard = ({
  documento,
  perfil,
  revisiones,
  cargando,
  onUpload,
  onReview,
  onView,
  accept,
}) => {
  const dosCaras = admiteReverso(documento);

  const caras = dosCaras
    ? [
        { campo: documento.key, nombre: 'Anverso', opcional: documento.opcional },
        // El reverso siempre es opcional: un PDF puede traer ambas páginas.
        { campo: claveReverso(documento.key), nombre: 'Reverso', opcional: true },
      ]
    : [{ campo: documento.key, nombre: documento.label, opcional: documento.opcional }];

  return (
    <div className="review-doc-card">
      <div className="review-doc-header">
        <span className="review-doc-name">{documento.label}</span>
        {documento.opcional && <span className="rev-badge rev-optional">Opcional</span>}
      </div>

      <div className="doc-caras">
        {caras.map((cara) => (
          <CaraDocumento
            key={cara.campo}
            campo={cara.campo}
            nombre={cara.nombre}
            opcional={dosCaras ? cara.opcional && cara.nombre === 'Reverso' : false}
            fileData={perfil?.[cara.campo]}
            revision={revisiones?.[cara.campo]}
            cargando={cargando?.[cara.campo]}
            onUpload={onUpload}
            onReview={onReview}
            onView={onView}
            mostrarNombre={dosCaras}
            accept={accept}
          />
        ))}
      </div>
    </div>
  );
};

export default DocumentReviewCard;
