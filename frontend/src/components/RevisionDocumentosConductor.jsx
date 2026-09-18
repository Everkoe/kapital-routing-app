import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import DocumentReviewCard from './DocumentReviewCard';
import DocumentViewer from './DocumentViewer';
import FileUploadZone from './FileUploadZone';
import { apiFetch } from '../utils/apiClient';
import { subirDocumento } from '../utils/documentoStorage';
import { validarArchivoDocumento } from '../utils/validacionDocumento';
import { DOCUMENTOS_CONDUCTOR, vigenciaDeDocumento } from '../constants/documentosConductor';
import { getDocumentStatus } from '../utils/flotaDocumentStatus';
import CampoEditable from './CampoEditable';

/**
 * Revisión de los documentos de un conductor, con su visor.
 *
 * Existía solo dentro de Gestión de Flota. La pantalla de Accesos —donde se
 * aprueba a un conductor nuevo— tenía su propia lista de siete filas escrita a
 * mano, y ya se había desviado: le faltaba el DNI escaneado, pedía
 * `antecedentesPenales` cuando el campo se llama `antecedentesPoliciales`, y su
 * botón «Ver Archivo» solo sabía leer `base64`, así que con los documentos en
 * Storage no hacía nada.
 *
 * Al compartir este componente, las dos pantallas muestran los mismos
 * documentos con el mismo aspecto y no pueden volver a separarse.
 */

const ACCEPT = Object.keys(FileUploadZone.DEFAULT_DOCUMENT_ACCEPT).join(',');

const RevisionDocumentosConductor = ({
  conductor,
  unidadId = '',
  adminEmail = '',
  titulo = 'Revisión de Documentos del Conductor',
  onDocumentoSubido,
  // Vencimientos de la unidad y cómo guardarlos. Solo los tiene Gestión de
  // Flota: en Accesos el conductor todavía no tiene unidad, así que la barra
  // no aparece en vez de mostrar una fecha que no existe.
  vigencias = null,
  onGuardarVigencia = null,
}) => {
  const [revisiones, setRevisiones] = useState({});
  const [cargando, setCargando] = useState({});
  const [viendo, setViendo] = useState(null);

  const perfil = conductor?.perfil_conductor;
  const conductorEmail = conductor?.email || conductor?.identifier || '';

  useEffect(() => {
    setRevisiones(perfil?.revision_docs || {});
  }, [perfil]);

  const revisarDocumento = async (campo, estado) => {
    if (!conductorEmail) return;
    setCargando(previo => ({ ...previo, [campo]: true }));
    try {
      const data = await apiFetch('/api/admin/driver/review', {
        method: 'POST',
        json: { admin_email: adminEmail, conductor_email: conductorEmail, campo, estado },
      });
      setRevisiones(data.revision_docs || {});
      toast.success(`Documento ${estado === 'aprobado' ? 'aprobado' : 'rechazado'}.`);
    } catch (error) {
      toast.error(error?.message || 'No se pudo registrar la revisión.');
    } finally {
      setCargando(previo => ({ ...previo, [campo]: false }));
    }
  };

  const subirEnNombreDelConductor = async (campo, file) => {
    if (!file || !conductorEmail) return;
    const problema = validarArchivoDocumento(file);
    if (problema) {
      toast.error(problema);
      return;
    }

    setCargando(previo => ({ ...previo, [campo]: true }));
    try {
      // El archivo va a Storage y el perfil guarda solo su ruta. Guardarlo
      // dentro llevaba la fila de estado a casi diez megas.
      const documento = await subirDocumento(file, { unidadId, campo });
      await apiFetch('/api/conductor/resubmit-docs', {
        method: 'POST',
        json: { email: conductorEmail, docs: { [campo]: documento }, uploaded_by: 'admin' },
      });
      onDocumentoSubido?.(campo, documento);
      toast.success('Documento subido.');
    } catch (error) {
      toast.error(error?.message || 'No se pudo subir el documento.');
    } finally {
      setCargando(previo => ({ ...previo, [campo]: false }));
    }
  };

  /**
   * Barra con el vencimiento del documento abierto.
   *
   * Solo para los tres que tienen uno —SOAT, revisión técnica y licencia—, y
   * solo cuando quien usa el componente sabe guardarlo.
   */
  const barraDeVigencia = (clave) => {
    const vigencia = vigenciaDeDocumento(clave);
    if (!vigencia || !vigencias || !onGuardarVigencia) return null;

    const valor = vigencias[vigencia.campo] || '';
    const { status, text } = getDocumentStatus(valor);
    return (
      <div className="doc-viewer-vigencia">
        <CampoEditable
          etiqueta={vigencia.etiqueta}
          valor={valor}
          tipo="date"
          vacio="Sin fecha"
          onGuardar={(nuevo) => onGuardarVigencia(vigencia.campo, nuevo)}
        >
          <span className="campo-editable-vigencia">
            {valor || 'Sin fecha'}
            <span className={`status-badge status-${status}`}><span className="dot"></span>{text}</span>
          </span>
        </CampoEditable>
      </div>
    );
  };

  return (
    <>
      <div className="review-docs-section">
        <h4 className="review-docs-title">
          <ShieldCheck size={18} /> {titulo}
        </h4>
        <div className="review-docs-grid">
          {DOCUMENTOS_CONDUCTOR.map((documento) => (
            <DocumentReviewCard
              key={documento.key}
              documento={documento}
              perfil={perfil}
              revisiones={revisiones}
              cargando={cargando}
              accept={ACCEPT}
              onUpload={subirEnNombreDelConductor}
              onReview={revisarDocumento}
              onView={(abierto) => setViendo({ ...abierto, clave: documento.key })}
            />
          ))}
        </div>
      </div>

      <DocumentViewer
        key={viendo?.name}
        documento={viendo}
        onClose={() => setViendo(null)}
        pie={barraDeVigencia(viendo?.clave)}
      />
    </>
  );
};

export default RevisionDocumentosConductor;
