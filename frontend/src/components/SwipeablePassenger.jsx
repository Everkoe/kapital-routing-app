import React, { useState, useRef } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { Phone, MessageCircle, Navigation, CheckCircle, AlertTriangle, MapPin } from 'lucide-react';
import { compressImage } from '../utils/imageUtils';

const SwipeablePassenger = ({ agente, isNext, isCompletado, onSwipeAction, onImageClick }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const cameraInputRef = useRef(null);
  const x = useMotionValue(0);
  const background = useTransform(
    x,
    [-100, 0, 100],
    ['#f59e0b', 'var(--kapital-card-bg)', '#10b981']
  );
  
  const iconOpacityRight = useTransform(x, [0, 50], [0, 1]);
  const iconOpacityLeft = useTransform(x, [0, -50], [0, 1]);

  const handleDragEnd = async (e, { offset }) => {
    if (isCompletado || isProcessing) return;

    if (offset.x > 100) {
      // Swipe Right -> Recogido
      setIsProcessing(true);
      await onSwipeAction('Recogido');
      animate(x, 0, { duration: 0.3 });
      setIsProcessing(false);
    } else if (offset.x < -100) {
      // Swipe Left -> Ausente
      if(window.confirm(`¿Seguro que ${agente.nombre} no se presentó?\n\nSe requiere foto de evidencia. Presiona OK para abrir la cámara.`)) {
        if (cameraInputRef.current) {
          cameraInputRef.current.click();
        }
      } else {
        animate(x, 0, { type: 'spring', stiffness: 300, damping: 20 });
      }
    } else {
      // Bounce back
      animate(x, 0, { type: 'spring', stiffness: 300, damping: 20 });
    }
  };

  const isRecogido = agente.estado === 'Recogido';
  const isAusente = agente.estado === 'Ausente';

  const handleCameraCapture = async (e) => {
    const file = e.target.files[0];
    if (!file) {
      animate(x, 0, { type: 'spring', stiffness: 300, damping: 20 });
      return;
    }
    setIsProcessing(true);
    try {
      const compressedBase64Str = await compressImage(file); 
      await onSwipeAction('Ausente', compressedBase64Str);
      animate(x, 0, { duration: 0.3 });
    } catch (error) {
      console.error("Error compressing image:", error);
      alert("Error al procesar la foto. Intenta nuevamente.");
      animate(x, 0, { type: 'spring', stiffness: 300, damping: 20 });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px', marginBottom: '10px' }}>
      <input 
        type="file" 
        accept="image/*" 
        capture="environment" 
        ref={cameraInputRef}
        style={{ display: 'none' }}
        onChange={handleCameraCapture}
      />
      {/* Background Layer showing Action Icons */}
      <motion.div style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
        background, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', borderRadius: '12px'
      }}>
        <motion.div style={{ opacity: iconOpacityRight, color: 'white', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
          <CheckCircle size={24} /> Recogido
        </motion.div>
        <motion.div style={{ opacity: iconOpacityLeft, color: 'white', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
           Ausente <AlertTriangle size={24} />
        </motion.div>
      </motion.div>

      {/* Foreground Draggable Card */}
      <motion.div
        drag={isCompletado || isProcessing ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        style={{ position: 'relative', x, background: 'var(--kapital-card-bg)', zIndex: 2, padding: '15px 20px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--kapital-border)' }}
        onDragEnd={handleDragEnd}
        className={`driver-passenger-item-draggable ${isCompletado ? 'recogido' : ''} ${isNext ? 'next-passenger-glow' : ''}`}
      >
        <div className="driver-passenger-info" style={{ flex: 1, color: 'var(--kapital-text-primary)', display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
          
          {/* Status Badges */}
          {(isRecogido || isAusente) && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '2px' }}>
              {isRecogido && <span style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }}>✓ PASAJERO RECOGIDO</span>}
              {isAusente && <span style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }}>❌ PASAJERO AUSENTE</span>}
            </div>
          )}

          <div style={{ fontWeight: '800', fontSize: '1.05rem', color: isNext ? '#38BDF8' : 'var(--kapital-text-primary)', lineHeight: '1.3', wordBreak: 'break-word' }}>
            {agente?.nombre || 'Pasajero Sin Nombre'}
          </div>
          
          <div style={{ fontSize: '0.85rem', color: 'var(--kapital-text-secondary)', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
            <MapPin size={14} style={{ marginTop: '2px', flexShrink: 0, color: 'var(--kapital-text-muted)' }} />
            <span style={{ flex: 1, lineHeight: '1.4' }}>{agente?.direccion || 'Sin dirección'}</span>
          </div>
          
          {/* Botones de acción rápida */}
          {!isCompletado && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }} className="no-print">
              <a href={`https://www.waze.com/ul?q=${encodeURIComponent(agente?.direccion || '')}`} target="_blank" rel="noopener noreferrer" className="quick-action-btn waze" onPointerDown={e => e.stopPropagation()}>
                <Navigation size={14} /> Waze
              </a>
              <a href={`https://wa.me/51${agente?.telefono || ''}?text=${encodeURIComponent('Hola ' + (agente?.nombre || '') + ', tu transporte de Kapital Routing está afuera.')}`} target="_blank" rel="noopener noreferrer" className="quick-action-btn whatsapp" onPointerDown={e => e.stopPropagation()}>
                <MessageCircle size={14} /> 
              </a>
              <a href={`tel:${agente?.telefono || ''}`} className="quick-action-btn phone" onPointerDown={e => e.stopPropagation()}>
                <Phone size={14} />
              </a>
            </div>
          )}
        </div>
        
        {/* Photo Thumbnail for Ausente passengers */}
        {isAusente && agente.evidencia_foto_url && (
          <div 
            onClick={() => onImageClick && onImageClick(agente.evidencia_foto_url)}
            style={{ 
              marginLeft: '12px',
              cursor: 'zoom-in',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
              border: '2px solid rgba(255,255,255,0.1)',
              width: '65px', height: '65px',
              flexShrink: 0,
              position: 'relative'
            }}
          >
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.7)', color: 'white', fontSize: '0.55rem', textAlign: 'center', padding: '3px 0', fontWeight: 'bold', backdropFilter: 'blur(2px)' }}>
              EVIDENCIA
            </div>
            <img 
              src={agente.evidencia_foto_url} 
              alt="Evidencia" 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}
        
        {!isCompletado && !isProcessing && (
          <div className="swipe-hint" style={{ opacity: 0.5, display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: '0.7rem' }}>
            <span>↔️</span>
            <span>Deslizar</span>
          </div>
        )}
        {isProcessing && (
          <div style={{ opacity: 0.5 }}>...</div>
        )}
      </motion.div>
    </div>
  );
};

export default SwipeablePassenger;
