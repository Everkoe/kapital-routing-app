import { useState } from 'react';
import { CheckCircle, Clock, Eye, Upload, XCircle } from 'lucide-react';
import DocumentDropZone from './DocumentDropZone';
import {
  CARA_DELANTE,
  CARA_DETRAS,
  admiteReverso,
  caraDestinoParaArrastre,
  claveReverso,
} from '../constants/documentosConductor';

/**
 * Tarjeta de revisión de un documento.
 *
 * Plana a propósito: una tarjeta dentro de otra tarjeta añade bordes y sangrías
 * que no aportan información. Los documentos de dos caras no se parten en
 * tarjetas ni en cajas anidadas — al pulsar «Subir» se despliega una fila con
 * un botón por cara, y el resto del tiempo la tarjeta se lee igual que la de un
 * documento de una sola cara.
 *
 * Arrastrar sobre la tarjeta llena **el primer hueco libre**, anverso antes que
 * reverso. Es la regla más predecible: sin ella habría que adivinar a qué cara
 * iba un archivo soltado sobre el conjunto.
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

/**
 * Estado del documento a partir de sus caras presentes.
 *
 * Un rechazo manda sobre todo lo demás: si una cara está mal, el documento no
 * sirve aunque la otra esté aprobada. Y solo se da por aprobado cuando lo están
 * todas las caras subidas, para que una aprobación no tape una cara pendiente.
 */
const estadoDocumento = (caras, revisiones) => {
  const presentes = caras.filter((cara) => cara.tieneArchivo);
  if (presentes.length === 0) return null;

  const estados = presentes.map((cara) => revisiones?.[cara.campo]?.estado);
  if (estados.includes('rechazado')) return ESTADOS.rechazado;
  if (estados.every((estado) => estado === 'aprobado')) return ESTADOS.aprobado;
  return ESTADOS.pendiente;
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
  const [subiendo, setSubiendo] = useState(false);
  const dosCaras = admiteReverso(documento);

  const caras = (dosCaras
    ? [
        { campo: documento.key, nombre: CARA_DELANTE },
        // La cara de detrás siempre es opcional: un PDF puede traer ambas.
        { campo: claveReverso(documento.key), nombre: CARA_DETRAS, opcional: true },
      ]
    : [{ campo: documento.key, nombre: documento.label }]
  ).map((cara) => ({ ...cara, archivo: perfil?.[cara.campo], tieneArchivo: Boolean(perfil?.[cara.campo]) }));

  const conArchivo = caras.filter((cara) => cara.tieneArchivo);
  const estado = estadoDocumento(caras, revisiones);
  const ocupado = caras.some((cara) => cargando?.[cara.campo]);

  const caraParaArrastre = caraDestinoParaArrastre(caras);

  const revisarTodas = (estadoNuevo) => {
    conArchivo.forEach((cara) => onReview(cara.campo, estadoNuevo));
  };

  return (
    <DocumentDropZone
      className="review-doc-card"
      label={documento.label}
      disabled={ocupado}
      onFile={(file) => onUpload(caraParaArrastre, file)}
    >
      <div className="review-doc-header">
        <span className="review-doc-name">{documento.label}</span>
        {documento.opcional && <span className="rev-badge rev-optional">Opcional</span>}
        {estado ? (
          <span className={`rev-badge ${estado.clase}`}><estado.Icon size={12} /> {estado.texto}</span>
        ) : (
          <span className="rev-badge rev-missing">Sin archivo</span>
        )}
      </div>

      {dosCaras && conArchivo.length > 0 && (
        <p className="doc-caras-resumen">
          {conArchivo.length === caras.length
            ? 'Delante y detrás subidos'
            : `Solo ${conArchivo[0].nombre.toLowerCase()} · falta ${caras.find((c) => !c.tieneArchivo).nombre.toLowerCase()}`}
        </p>
      )}

      <div className="review-doc-actions">
        {conArchivo.length > 0 && (
          <button
            type="button"
            className="btn-view-doc"
            onClick={() => onView({
              name: documento.label,
              // El visor recibe todas las caras y resuelve dentro cuál mostrar,
              // para no llenar la tarjeta de un botón «Ver» por cara.
              caras: caras.map((cara) => ({
                nombre: dosCaras ? cara.nombre : null,
                src: fuenteDeArchivo(cara.archivo),
                raw: cara.archivo,
              })),
            })}
          >
            <Eye size={13} /> Ver
          </button>
        )}

        {dosCaras ? (
          <button
            type="button"
            className="btn-view-doc"
            aria-expanded={subiendo}
            onClick={() => setSubiendo((abierto) => !abierto)}
          >
            <Upload size={13} /> Subir
          </button>
        ) : (
          <label className="btn-view-doc doc-subir-label">
            <Upload size={13} /> {conArchivo.length ? 'Reemplazar' : 'Subir'}
            <input
              type="file"
              accept={accept}
              style={{ display: 'none' }}
              onChange={(e) => onUpload(documento.key, e.target.files[0])}
            />
          </label>
        )}

        {conArchivo.length > 0 && (
          <>
            <button
              type="button"
              className="btn-approve-doc"
              disabled={ocupado || estado === ESTADOS.aprobado}
              onClick={() => revisarTodas('aprobado')}
            >
              {ocupado ? '...' : <><CheckCircle size={13} /> Aprobar</>}
            </button>
            <button
              type="button"
              className="btn-reject-doc"
              disabled={ocupado || estado === ESTADOS.rechazado}
              onClick={() => revisarTodas('rechazado')}
            >
              {ocupado ? '...' : <><XCircle size={13} /> Rechazar</>}
            </button>
          </>
        )}
      </div>

      {dosCaras && subiendo && (
        <div className="doc-caras-subida">
          {caras.map((cara) => (
            <label key={cara.campo} className="btn-view-doc doc-subir-label">
              <Upload size={13} />
              {cara.tieneArchivo ? `Reemplazar ${cara.nombre.toLowerCase()}` : `Subir ${cara.nombre.toLowerCase()}`}
              {cara.opcional && !cara.tieneArchivo && <span className="doc-cara-opcional">opcional</span>}
              <input
                type="file"
                accept={accept}
                style={{ display: 'none' }}
                onChange={(e) => {
                  onUpload(cara.campo, e.target.files[0]);
                  setSubiendo(false);
                }}
              />
            </label>
          ))}
        </div>
      )}

      {conArchivo.length === 0 && (
        <p className="review-doc-missing">
          El conductor aún no ha subido este documento. Arrastra el archivo aquí o usa el botón.
        </p>
      )}
    </DocumentDropZone>
  );
};

export default DocumentReviewCard;
