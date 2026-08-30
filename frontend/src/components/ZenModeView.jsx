import React, { useState } from 'react';
import { Phone, MessageCircle, Navigation, MapPin, XCircle, CheckCircle } from 'lucide-react';
import { compressImage } from '../utils/imageUtils';

const ZenModeView = ({ ruta, conductorId, onExitZen, onActualizarPasajero }) => {
  const [isUploading, setIsUploading] = useState(false);

  // Find first passenger that is not 'Recogido' and not 'Ausente'
  const nextPassenger = ruta.agentes.find(a => a.estado !== 'Recogido' && a.estado !== 'Ausente');

  if (!nextPassenger) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '20px', textAlign: 'center' }}>
        <CheckCircle size={64} color="#10b981" style={{ marginBottom: '20px' }} />
        <h2>¡Ruta Completada!</h2>
        <p style={{ color: 'var(--kapital-text-secondary)', marginBottom: '30px' }}>Has recogido o gestionado a todos los pasajeros de esta ruta.</p>
        <button onClick={onExitZen} style={{ background: 'var(--kapital-blue-deep)', color: 'white', border: 'none', padding: '15px 30px', borderRadius: '12px', fontSize: '1.2rem', fontWeight: 'bold', cursor: 'pointer' }}>
          Volver a Mis Rutas
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Zen Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--kapital-text-primary)', fontSize: '1.5rem' }}>Próxima Parada</h2>
          <span style={{ color: 'var(--kapital-text-secondary)', fontSize: '0.9rem' }}>
            Ruta {ruta.horario} {ruta.zona ? `- ${ruta.zona}` : ''}
          </span>
        </div>
        <button onClick={onExitZen} style={{ background: 'transparent', border: '1px solid var(--kapital-border)', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--kapital-text-primary)' }}>
          <XCircle size={18} /> Salir
        </button>
      </div>

      {/* Massive Passenger Card */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ background: 'var(--kapital-card-bg)', borderRadius: '24px', padding: '20px', boxShadow: '0 20px 40px rgba(0,0,0,0.1)', border: '2px solid var(--kapital-accent-green)', textAlign: 'center' }}>
          
          <h1 style={{ fontSize: '1.8rem', lineHeight: '1.2', margin: '0 0 15px 0', color: 'var(--kapital-text-primary)', wordBreak: 'break-word' }}>
            {nextPassenger.nombre}
          </h1>
          
          <div style={{ fontSize: '1rem', lineHeight: '1.4', color: 'var(--kapital-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '25px', padding: '0 10px' }}>
            <MapPin size={20} color="#38BDF8" style={{ flexShrink: 0 }} /> 
            <span style={{ textAlign: 'left' }}>{nextPassenger.direccion}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '30px' }}>
            <a href={`https://www.waze.com/ul?q=${encodeURIComponent(nextPassenger.direccion)}`} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', background: 'rgba(56, 189, 248, 0.1)', borderRadius: '16px', color: '#38BDF8', textDecoration: 'none', fontWeight: 'bold', fontSize: '1.2rem', gap: '10px' }}>
              <Navigation size={32} />
              Navegar
            </a>
            <a href={`https://wa.me/51${nextPassenger.telefono || ''}?text=${encodeURIComponent('Hola ' + nextPassenger.nombre + ', tu transporte de Kapital Routing está afuera.')}`} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '16px', color: '#22c55e', textDecoration: 'none', fontWeight: 'bold', fontSize: '1.2rem', gap: '10px' }}>
              <MessageCircle size={32} />
              Avisar
            </a>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <button 
              onClick={() => onActualizarPasajero(ruta.horario, nextPassenger.id, 'Recogido')}
              style={{ background: 'var(--kapital-accent-green)', color: 'white', border: 'none', padding: '20px', borderRadius: '16px', fontSize: '1.5rem', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', boxShadow: '0 10px 20px rgba(16, 185, 129, 0.3)' }}
            >
              <CheckCircle size={28} /> RECOGIDO
            </button>
            
            <button 
              onClick={() => {
                if(window.confirm(`¿Seguro que ${nextPassenger.nombre} no se presentó?`)) {
                  onActualizarPasajero(ruta.horario, nextPassenger.id, 'Ausente');
                }
              }}
              disabled={isUploading}
              style={{ background: 'transparent', color: '#f59e0b', border: '2px solid #f59e0b', padding: '15px', borderRadius: '16px', fontSize: '1.2rem', fontWeight: 'bold', cursor: 'pointer', opacity: isUploading ? 0.5 : 1 }}
            >
              Marcar como Ausente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ZenModeView;
