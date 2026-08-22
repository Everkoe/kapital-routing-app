import React, { useState } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { Phone, MessageCircle, Navigation, CheckCircle, AlertTriangle } from 'lucide-react';

const SwipeablePassenger = ({ agente, isNext, isCompletado, onSwipeAction }) => {
  const [isProcessing, setIsProcessing] = useState(false);
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
      if(window.confirm(`¿Seguro que ${agente.nombre} no se presentó?`)) {
        setIsProcessing(true);
        await onSwipeAction('Ausente');
        animate(x, 0, { duration: 0.3 });
        setIsProcessing(false);
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

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px', marginBottom: '10px' }}>
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
        <div className="driver-passenger-info" style={{ flex: 1, color: 'var(--kapital-text-primary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '1.05rem', color: isNext ? '#38BDF8' : 'var(--kapital-text-primary)' }}>
            {agente?.nombre || 'Pasajero Sin Nombre'}
            {isRecogido && <span style={{marginLeft: '8px', color: '#10b981', fontSize: '0.8rem'}}>✓ Listo</span>}
            {isAusente && <span style={{marginLeft: '8px', color: '#f59e0b', fontSize: '0.8rem'}}>❌ Ausente</span>}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--kapital-text-secondary)' }}>
            🏠 {agente?.direccion || 'Sin dirección'}
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
