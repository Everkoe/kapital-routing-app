import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { Shield, ShieldAlert, ShieldCheck, CheckCircle2, XCircle, Search, Calendar, Building, Info, FileText } from 'lucide-react';

const DocumentVerification = ({ placa, doc, style, cachedResults = {} }) => {
  const [verifying, setVerifying] = useState({});
  const [localResults, setLocalResults] = useState({});

  const results = { ...cachedResults, ...localResults };

  const handleVerify = async (type, param) => {
    if (!param) return toast.error(`Falta parámetro para verificar ${type}`);
    setVerifying(prev => ({ ...prev, [type]: true }));
    try {
      const res = await fetch(`/api/verify/${type}/${encodeURIComponent(param)}`);
      const data = await res.json();
      setLocalResults(prev => ({ ...prev, [type]: data }));
      
      if (data.valido) {
        toast.success(`Validación exitosa: ${type.toUpperCase()}`);
      } else {
        toast.error(`Atención: Problemas con ${type.toUpperCase()}`);
      }
    } catch (e) {
      toast.error(`Error verificando ${type}`);
    } finally {
      setVerifying(prev => ({ ...prev, [type]: false }));
    }
  };

  const renderResultCard = (type, res) => {
    if (!res) return null;
    const isOk = res.valido;
    const bg = isOk ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)';
    const color = isOk ? '#10b981' : '#ef4444';
    const borderColor = isOk ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';

    return (
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        style={{
          background: bg,
          border: `1px solid ${borderColor}`,
          color: 'var(--text)',
          padding: '12px',
          borderRadius: '10px',
          marginTop: '12px',
          boxShadow: `0 4px 12px ${isOk ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}`,
          backdropFilter: 'blur(10px)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div style={{ position: 'absolute', top: '-10px', right: '-10px', opacity: 0.1, color }}>
          {isOk ? <ShieldCheck size={80} /> : <ShieldAlert size={80} />}
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginBottom: '15px', color, textAlign: 'center' }}>
          {isOk ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
          <strong style={{ fontSize: '1rem', lineHeight: '1.2' }}>{res.mensaje}</strong>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)', position: 'relative', zIndex: 1 }}>
          {res.fechaVencimiento && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Calendar size={14} /> Vence: {res.fechaVencimiento}
            </div>
          )}
          {res.compania && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Building size={14} /> Cía: {res.compania}
            </div>
          )}
          {res.centro && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Building size={14} /> Centro: {res.centro}
            </div>
          )}
          {res.claseCategoria && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Info size={14} /> Clase: {res.claseCategoria}
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  const renderScanEffect = () => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 0', gap: '10px' }}>
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
        transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
        style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(56, 189, 248, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(56, 189, 248, 0.3)' }}
      >
        <Search size={20} color="#38BDF8" />
      </motion.div>
      <span style={{ fontSize: '0.8rem', color: '#38BDF8', fontWeight: 500 }}>Buscando en BD...</span>
    </div>
  );

  const buttonStyle = (disabled) => ({
    width: '100%',
    padding: '10px',
    background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    boxShadow: disabled ? 'none' : '0 4px 10px rgba(14, 165, 233, 0.3)',
    transition: 'all 0.2s ease',
  });

  return (
    <div style={{ background: 'var(--kapital-card-bg)', padding: '20px', borderRadius: '16px', border: '1px solid var(--kapital-border)', boxShadow: '0 8px 30px rgba(0,0,0,0.1)', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '20px', paddingBottom: '15px', borderBottom: '1px solid var(--kapital-border)' }}>
        <div style={{ background: 'rgba(56, 189, 248, 0.1)', padding: '10px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Shield size={24} color="#38BDF8" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h4 style={{ margin: 0, color: 'var(--kapital-text-primary)', fontSize: '1.2rem', fontWeight: 600 }}>Centro de Validación en Línea</h4>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Conexión directa MTC / APESEG</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
        
        {/* SOAT */}
        <div style={{ background: 'var(--bg)', padding: '15px', borderRadius: '12px', border: '1px solid var(--kapital-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '15px' }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>SOAT</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'var(--kapital-bg)', padding: '4px 8px', borderRadius: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Placa: {placa || '-'}</span>
          </div>
          
          <AnimatePresence mode="wait">
            {verifying.soat ? (
              <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {renderScanEffect()}
              </motion.div>
            ) : !results.soat ? (
              <motion.button key="btn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                disabled={!placa}
                onClick={() => handleVerify('soat', placa)}
                style={buttonStyle(!placa)}
              >
                <Search size={16} /> Verificar
              </motion.button>
            ) : null}
          </AnimatePresence>
          {renderResultCard('soat', results.soat)}
        </div>

        {/* CITV */}
        <div style={{ background: 'var(--bg)', padding: '15px', borderRadius: '12px', border: '1px solid var(--kapital-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '15px' }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>Rev. Técnica</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'var(--kapital-bg)', padding: '4px 8px', borderRadius: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Placa: {placa || '-'}</span>
          </div>
          
          <AnimatePresence mode="wait">
            {verifying.citv ? (
              <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {renderScanEffect()}
              </motion.div>
            ) : !results.citv ? (
              <motion.button key="btn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                disabled={!placa}
                onClick={() => handleVerify('citv', placa)}
                style={buttonStyle(!placa)}
              >
                <Search size={16} /> Verificar
              </motion.button>
            ) : null}
          </AnimatePresence>
          {renderResultCard('citv', results.citv)}
        </div>

        {/* LICENCIA */}
        <div style={{ background: 'var(--bg)', padding: '15px', borderRadius: '12px', border: '1px solid var(--kapital-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '15px' }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>Licencia</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'var(--kapital-bg)', padding: '4px 8px', borderRadius: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Doc: {doc || '-'}</span>
          </div>
          
          <AnimatePresence mode="wait">
            {verifying.licencia ? (
              <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {renderScanEffect()}
              </motion.div>
            ) : !results.licencia ? (
              <motion.button key="btn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                disabled={!doc}
                onClick={() => handleVerify('licencia', doc)}
                style={buttonStyle(!doc)}
              >
                <FileText size={16} /> Verificar
              </motion.button>
            ) : null}
          </AnimatePresence>
          {renderResultCard('licencia', results.licencia)}
        </div>

      </div>
    </div>
  );
};

export default DocumentVerification;
