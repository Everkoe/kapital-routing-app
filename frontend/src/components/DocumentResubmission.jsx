import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, ArrowRight, Loader, Hourglass, ShieldCheck, FileText, Clock } from 'lucide-react';
import FileUploadZone from './FileUploadZone';
import { apiFetch } from '../utils/apiClient';
import toast from 'react-hot-toast';
import { DOCUMENTOS_CONDUCTOR, carasDeDocumento } from '../constants/documentosConductor';
import { documentoEntregado, documentosRequeridos } from '../constants/camposOnboarding';
import { subirDocumento } from '../utils/documentoStorage';
import DocumentViewer from './DocumentViewer';

const REQUEST_TIMEOUT_MS = 12000;
const MAX_DOCUMENT_SIZE_BYTES = FileUploadZone.MAX_DOCUMENT_SIZE_BYTES;

/**
 * Etiquetas derivadas del catálogo, reversos incluidos.
 *
 * Antes esta pantalla tenía su propia lista de nueve claves. Con documentos de
 * dos caras eso se vuelve un agujero: si el administrador rechaza
 * `dniScaneadoReverso` y la clave no figura aquí, el conductor no ve el rechazo
 * y no puede resubir la cara mala. El catálogo evita que las tres pantallas
 * vuelvan a desincronizarse.
 */
const DOC_LABELS = Object.fromEntries(
  DOCUMENTOS_CONDUCTOR.flatMap((documento) =>
    carasDeDocumento(documento).map((cara) => [
      cara.campo,
      cara.nombre === documento.label ? documento.label : `${documento.label} · ${cara.nombre}`,
    ]),
  ),
);

const DocumentResubmission = ({ usuario, onComplete, notifications: notificationsProp }) => {
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newFiles, setNewFiles] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewingDoc, setViewingDoc] = useState(null);
  const markedNotificationIdsRef = useRef(new Set());
  const revisions = usuario?.perfil_conductor?.revision_docs || {};
  const rejectedDocs = Object.keys(revisions).filter(key => revisions[key].estado?.toLowerCase() === 'rechazado');
  // Solo falta lo que de verdad se pidió. Antes se recorría el catálogo entero
  // y se daba por «faltante» todo lo que no estuviera subido: los reversos
  // opcionales, las referencias laborales y hasta el cuestionario de manejo,
  // que no es un archivo. El conductor entregaba todo y seguía viendo el aviso.
  const requeridos = new Set(documentosRequeridos());
  const missingDocs = Object.keys(DOC_LABELS).filter(key => {
    const revision = revisions[key];
    // Si Administración lo marcó, manda su marca, sea el documento que sea.
    if (revision) return revision.estado?.toLowerCase() === 'faltante';
    if (!requeridos.has(key)) return false;
    return !documentoEntregado(key, usuario?.perfil_conductor);
  });
  const hasRejectedOrMissing = rejectedDocs.length > 0 || missingDocs.length > 0;

  const userKey = usuario?.identifier || usuario?.email;
  const hasExternalNotifications = Array.isArray(notificationsProp);
  const displayedNotifications = hasExternalNotifications ? notificationsProp : notifications;
  const notificationsLoading = hasExternalNotifications || !userKey ? false : isLoading;

  useEffect(() => {
    let disposed = false;
    let controller = null;
    let timeoutId = null;

    if (hasExternalNotifications) {
      // DriverPortal already owns the notification read request. Keep the
      // existing UX of marking messages read without fetching the same large
      // profile JSON a second time.
      const unread = notificationsProp.filter(notification => !notification.leido);
      unread.forEach(notification => {
        const notificationId = String(notification.id ?? '');
        if (!notificationId || markedNotificationIdsRef.current.has(notificationId)) return;
        markedNotificationIdsRef.current.add(notificationId);
        fetch('/api/conductor/notifications/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notif_id: notification.id }),
        }).catch(() => {});
      });

      return () => { disposed = true; };
    }

    if (!userKey) {
      return () => { disposed = true; };
    }

    const fetchData = async () => {
      setIsLoading(true);
      controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        // Fetch notifications only when this component is not receiving the
        // already-fetched list from DriverPortal.
        const notifs = await apiFetch(`/api/conductor/notifications?email=${encodeURIComponent(userKey)}`, {
          signal: controller.signal,
        });
        if (!disposed) setNotifications(Array.isArray(notifs) ? notifs : []);

        // Mark as read while reusing the same abort signal and handling
        // failures silently so one unavailable notification cannot break UX.
        const unread = Array.isArray(notifs) ? notifs.filter(notification => !notification.leido) : [];
        await Promise.allSettled(unread.map(notification => apiFetch('/api/conductor/notifications/mark-read', {
          method: 'POST',
          json: { notif_id: notification.id },
          signal: controller.signal,
        })));
      } catch (error) {
        if (!disposed && error?.name !== 'AbortError') {
          console.warn('No se pudieron cargar las notificaciones:', error);
        }
      } finally {
        clearTimeout(timeoutId);
        if (!disposed) setIsLoading(false);
      }
    };

    fetchData();
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timeoutId);
    };
  }, [hasExternalNotifications, notificationsProp, userKey]);

  const handleFileChange = (docKey, file) => {
    if (!file) {
      setNewFiles(prev => {
        const next = { ...prev };
        delete next[docKey];
        return next;
      });
      return;
    }

    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      toast.error(`El archivo supera el límite de ${(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)).toFixed(0)} MB.`);
      return;
    }

    subirDocumento(file, { unidadId: usuario?.unidad_id || '', campo: docKey })
      .then(documento => setNewFiles(prev => ({ ...prev, [docKey]: documento })))
      .catch(err => toast.error(err?.message || 'No se pudo subir el documento. Intenta nuevamente.'));
  };

  const handleSubmit = async () => {
    // Validate that all rejected/missing docs have a new file
    const missing = [...rejectedDocs, ...missingDocs].filter(key => !newFiles[key]);
    if (missing.length > 0) {
      toast.error('Por favor sube todos los documentos solicitados.');
      return;
    }

    const oversizedFile = Object.values(newFiles).find(file => file?.size > MAX_DOCUMENT_SIZE_BYTES);
    if (oversizedFile) {
      toast.error(`El archivo ${oversizedFile.name || 'seleccionado'} supera el límite de ${(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)).toFixed(0)} MB.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const userKey = usuario.identifier || usuario.email;
      const res = await fetch('/api/conductor/resubmit-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userKey,
          docs: newFiles
        })
      });

      if (!res.ok) throw new Error('Error al enviar documentos');
      
      const data = await res.json();
      toast.success('Documentos enviados correctamente.');
      if (onComplete) onComplete(data);
    } catch (error) {
      console.error(error);
      toast.error('Ocurrió un error al enviar los documentos.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPending = usuario.estado === 'Pendiente Revisión';
  const hasRejected = rejectedDocs.length > 0;
  // We don't change hasRejected here to avoid breaking the logic that displays the "Último mensaje de Administración" if there are actually rejected ones.

  if (notificationsLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}>
        <Loader size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      {/* Visor compartido: la copia en línea que había aquí solo sabía leer
          `src`, así que no mostraba los documentos guardados en Storage. */}
      <DocumentViewer
        key={viewingDoc?.name}
        documento={viewingDoc}
        onClose={() => setViewingDoc(null)}
      />

      <div>
        
        {isPending && !hasRejectedOrMissing ? (
          <div style={{ textAlign: 'center', padding: '10px 0 20px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '10px', color: 'var(--text-primary)' }}>
              <Hourglass size={22} color="var(--kapital-blue, #3b82f6)" />
              <h4 style={{ margin: 0, fontSize: '1rem' }}>Perfil en Revisión</h4>
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', fontSize: '0.9rem', maxWidth: '480px', margin: '0 auto' }}>
              Hemos recibido tu información. Nuestro equipo está verificando tus documentos.
            </p>
          </div>
        ) : hasRejectedOrMissing ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px', color: '#ff6b6b' }}>
              <AlertTriangle size={22} />
              <h4 style={{ margin: 0 }}>Documentos Observados</h4>
            </div>
            <p style={{ color: 'var(--text)', marginBottom: '20px', lineHeight: '1.6', fontSize: '0.9rem' }}>
              Necesitamos que subas o corrijas los siguientes documentos.
            </p>
          </>
        ) : (
          <>
            <h4 style={{ margin: '0 0 8px 0', textAlign: 'center', color: 'var(--text-primary)' }}>Documentos Subidos</h4>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '25px', lineHeight: '1.6', textAlign: 'center', fontSize: '0.9rem' }}>
              Aquí puedes ver los documentos que has proporcionado. Estos no pueden ser modificados a menos que sean rechazados por un administrador.
            </p>
          </>
        )}

        {displayedNotifications.length > 0 && hasRejected && (
          <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #ff6b6b', marginBottom: '30px' }}>
            <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)' }}>Último mensaje de Administración:</h4>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              "{displayedNotifications[0].mensaje}"
            </p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          {Object.keys(DOC_LABELS).map(docKey => {
            const hasDoc = !!usuario?.perfil_conductor?.[docKey];
            const revision = revisions[docKey];
            const estado = revision ? revision.estado?.toLowerCase() : (hasDoc ? 'pendiente' : 'faltante');
            
            if (estado === 'faltante' || estado === 'rechazado') {
              return (
                <div key={docKey} style={{ gridColumn: '1 / -1', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '15px', background: 'var(--bg)' }}>
                  <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)' }}>
                    {DOC_LABELS[docKey]} <span style={{ color: '#ff6b6b', fontSize: '12px' }}>({estado === 'faltante' ? 'Faltante' : 'Rechazado'})</span>
                  </h4>
                  <FileUploadZone 
                    label={`Sube el ${estado === 'faltante' ? '' : 'nuevo '}${DOC_LABELS[docKey]}`}
                    file={newFiles[docKey]}
                    onFileSelect={(f) => handleFileChange(docKey, f)}
                  />
                </div>
              );
            }

            return (
              <div key={docKey} style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: '25px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                <h4 style={{ margin: 0, color: 'var(--text-primary)', textAlign: 'center', fontSize: '1.05rem' }}>
                  {DOC_LABELS[docKey]}
                </h4>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                  <button 
                    onClick={() => {
                      const fileData = newFiles[docKey] || usuario.perfil_conductor[docKey];
                      let docSrc = '';
                      if (typeof fileData === 'string') {
                        docSrc = fileData;
                      } else if (fileData && typeof fileData === 'object') {
                        docSrc = fileData.base64 || fileData.url || fileData.file || '';
                      }
                      setViewingDoc({
                        name: DOC_LABELS[docKey],
                        caras: [{ nombre: null, src: docSrc, path: fileData?.path || null, raw: fileData }],
                      });
                    }}
                    style={{ background: 'transparent', border: 'none', color: '#f59e0b', fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: 0 }}
                  >
                    <FileText size={16} /> Ver Archivo
                  </button>
                  <span style={{ 
                    display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', fontWeight: '600',
                    color: estado === 'aprobado' ? '#10b981' : '#f59e0b'
                  }}>
                    {estado === 'aprobado' ? <><ShieldCheck size={16} /> Aprobado</> : <><Clock size={16} /> En Revisión</>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {hasRejectedOrMissing && (
          <button 
            onClick={handleSubmit}
            disabled={isSubmitting}
            style={{ 
              width: '100%', 
              padding: '16px', 
              background: 'var(--primary-color, #2563eb)', 
              color: 'white', 
              border: 'none', 
              borderRadius: '8px',
              fontSize: '1.1rem',
              fontWeight: 'bold',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            {isSubmitting ? (
              <>
                <Loader size={20} style={{ animation: 'spin 1s linear infinite' }} /> Enviando...
              </>
            ) : (
              <>
                Reenviar a Revisión <ArrowRight size={20} />
              </>
            )}
          </button>
        )}
      </div>
    </>
  );
};

export default DocumentResubmission;
