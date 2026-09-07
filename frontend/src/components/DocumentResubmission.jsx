import React, { useState, useEffect } from 'react';
import { AlertTriangle, ArrowRight, Loader, Hourglass, CheckCircle2, ShieldCheck, FileText, X, Clock } from 'lucide-react';
import FileUploadZone from './FileUploadZone';
import toast from 'react-hot-toast';

const DOC_LABELS = {
  comprobanteDomicilio: 'Comprobante de Domicilio',
  dniScaneado: 'DNI Escaneado',
  licenciaConducir: 'Licencia de Conducir',
  recordConductor: 'Récord de Conductor',
  antecedentesPoliciales: 'Antecedentes Policiales',
  cv: 'Currículum Vitae',
  tarjetaPropiedad: 'Tarjeta de Propiedad',
  soat: 'SOAT',
  revisionTecnica: 'Revisión Técnica'
};

const DocumentResubmission = ({ usuario, onComplete }) => {
  const [notifications, setNotifications] = useState([]);
  const revisions = usuario?.perfil_conductor?.revision_docs || {};
  const rejectedDocs = Object.keys(revisions).filter(key => revisions[key].estado?.toLowerCase() === 'rechazado');
  const missingDocs = Object.keys(DOC_LABELS).filter(key => {
    if (key === 'revisionTecnica') return false; // Optional document
    const hasDoc = !!usuario?.perfil_conductor?.[key];
    const revision = revisions[key];
    const estado = revision ? revision.estado?.toLowerCase() : (hasDoc ? 'pendiente' : 'faltante');
    return estado === 'faltante';
  });
  const hasRejectedOrMissing = rejectedDocs.length > 0 || missingDocs.length > 0;

  useEffect(() => {
    fetchData();
  }, [usuario.identifier, usuario.email]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const userKey = usuario.identifier || usuario.email;
      // Fetch notifications
      const notifsRes = await fetch(`/api/conductor/notifications?email=${encodeURIComponent(userKey)}`);
      if (notifsRes.ok) {
        const notifs = await notifsRes.json();
        setNotifications(notifs);
        
        // Mark as read
        notifs.filter(n => !n.leido).forEach(async (n) => {
          await fetch('/api/conductor/notifications/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notif_id: n.id })
          });
        });
      }

      // The rejectedDocs is now computed directly from props above
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (docKey, file) => {
    if (!file) {
      setNewFiles(prev => {
        const next = { ...prev };
        delete next[docKey];
        return next;
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result;
      setNewFiles(prev => ({
        ...prev,
        [docKey]: { name: file.name, size: file.size, type: file.type, base64 }
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    // Validate that all rejected/missing docs have a new file
    const missing = [...rejectedDocs, ...missingDocs].filter(key => !newFiles[key]);
    if (missing.length > 0) {
      toast.error('Por favor sube todos los documentos solicitados.');
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
      if (onComplete) onComplete({ ...usuario, estado: data.estado });
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

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}>
        <Loader size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      {viewingDoc && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ width: '100%', maxWidth: '900px', background: 'var(--bg-secondary)', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>{viewingDoc.name}</h3>
              <button onClick={() => setViewingDoc(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={24} /></button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#000', padding: '20px' }}>
              <img src={viewingDoc.src} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} alt="Documento" />
            </div>
          </div>
        </div>
      )}
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <div style={{ background: 'var(--bg-secondary)', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        
        {isPending && !hasRejectedOrMissing ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '20px', color: 'var(--text-primary)' }}>
              <Hourglass size={36} color="var(--kapital-blue, #3b82f6)" />
              <h2 style={{ margin: 0, fontSize: '1.8rem' }}>Perfil en Revisión</h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '25px', lineHeight: '1.6', fontSize: '1.05rem', maxWidth: '480px', margin: '0 auto' }}>
              Hemos recibido tu información exitosamente. Nuestro equipo está verificando tus datos y los documentos que has subido. Por favor, regresa más tarde.
            </p>
          </div>
        ) : hasRejectedOrMissing ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', color: '#ff6b6b' }}>
              <AlertTriangle size={32} />
              <h2 style={{ margin: 0 }}>Documentos Observados</h2>
            </div>
            <p style={{ color: 'var(--text)', marginBottom: '25px', lineHeight: '1.6' }}>
              Necesitamos que subas o corrijas los siguientes documentos para completar tu perfil.
            </p>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px', color: 'var(--text-primary)' }}>
              <h2 style={{ margin: 0, textAlign: 'center' }}>Documentos Subidos</h2>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '35px', lineHeight: '1.6', textAlign: 'center' }}>
              Aquí puedes ver los documentos que has proporcionado. Estos no pueden ser modificados a menos que sean rechazados por un administrador.
            </p>
          </>
        )}

        {notifications.length > 0 && hasRejected && (
          <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #ff6b6b', marginBottom: '30px' }}>
            <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)' }}>Último mensaje de Administración:</h4>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              "{notifications[0].mensaje}"
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
                      const fileData = usuario.perfil_conductor[docKey];
                      let docSrc = '';
                      if (typeof fileData === 'string') {
                        docSrc = fileData;
                      } else if (fileData && typeof fileData === 'object') {
                        docSrc = fileData.base64 || fileData.url || fileData.file || '';
                      }
                      setViewingDoc({ name: DOC_LABELS[docKey], src: docSrc });
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
    </div>
    </>
  );
};

export default DocumentResubmission;
