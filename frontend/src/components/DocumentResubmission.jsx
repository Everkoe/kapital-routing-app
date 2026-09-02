import React, { useState, useEffect } from 'react';
import { AlertTriangle, ArrowRight, Loader } from 'lucide-react';
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
  const [rejectedDocs, setRejectedDocs] = useState([]);
  const [newFiles, setNewFiles] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [usuario.email]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch notifications
      const notifsRes = await fetch(`/api/conductor/notifications?email=${encodeURIComponent(usuario.email)}`);
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

      // Check which documents were rejected
      const perfil = usuario.perfil_conductor || {};
      const revisions = perfil.revision_docs || {};
      const rejected = Object.keys(revisions).filter(key => revisions[key].estado === 'rechazado');
      setRejectedDocs(rejected);

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
    // Validate that all rejected docs have a new file
    const missing = rejectedDocs.filter(key => !newFiles[key]);
    if (missing.length > 0) {
      toast.error('Por favor sube todos los documentos solicitados.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/conductor/resubmit-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: usuario.email,
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

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}>
        <Loader size={32} style={{ animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
      <div style={{ background: 'var(--bg-secondary)', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', color: '#ff6b6b' }}>
          <AlertTriangle size={32} />
          <h2 style={{ margin: 0 }}>Documentos Observados</h2>
        </div>

        <p style={{ color: 'var(--text)', marginBottom: '25px', lineHeight: '1.6' }}>
          Hemos revisado tu perfil y necesitamos que corrijas o vuelvas a subir algunos documentos para poder activarlo.
        </p>

        {notifications.length > 0 && (
          <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #ff6b6b', marginBottom: '30px' }}>
            <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)' }}>Último mensaje de Administración:</h4>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              "{notifications[0].mensaje}"
            </p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '30px' }}>
          {rejectedDocs.map(docKey => (
            <div key={docKey} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '15px', background: 'var(--bg)' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)' }}>
                {DOC_LABELS[docKey] || docKey} <span style={{ color: '#ff6b6b', fontSize: '12px' }}>(Rechazado)</span>
              </h4>
              <FileUploadZone 
                label={`Sube el nuevo ${DOC_LABELS[docKey] || docKey}`}
                file={newFiles[docKey]}
                onFileSelect={(f) => handleFileChange(docKey, f)}
              />
            </div>
          ))}
        </div>

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
      </div>
    </div>
  );
};

export default DocumentResubmission;
