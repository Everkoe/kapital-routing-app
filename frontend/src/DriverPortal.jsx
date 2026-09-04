import React, { useState, useEffect, useRef, useCallback } from 'react';
import DriverOnboardingWizard from './components/DriverOnboardingWizard';
import DocumentResubmission from './components/DocumentResubmission';
import SwipeablePassenger from './components/SwipeablePassenger';
import ZenModeView from './components/ZenModeView';
import { LogOut, Sun, Moon, Pencil, MapPin, MessageCircle, Phone, Navigation, AlertTriangle, Play, Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import './App.css';

const DriverPortal = ({ usuario, setUsuarioActual, onLogout, theme, toggleTheme }) => {
  const [rutas, setRutas] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [notificaciones, setNotificaciones] = useState(() => {
    try {
      const stored = localStorage.getItem(`kapital_notifs_${usuario?.identifier || usuario?.email}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  
  useEffect(() => {
    if (usuario) {
      localStorage.setItem(`kapital_notifs_${usuario.identifier || usuario.email}`, JSON.stringify(notificaciones));
    }
  }, [notificaciones, usuario]);

  const [showNotifications, setShowNotifications] = useState(false);
  
  // Si el usuario ya está en revisión, su perfil está completo
  const [profileComplete, setProfileComplete] = useState(usuario.profileComplete || usuario.estado === 'Pendiente Revisión' || false);

  const [conductorId, setConductorId] = useState(usuario.unidad_id || 'KAP-001');
  
  // Estado para Modo Conducción
  const [activeZenRouteIndex, setActiveZenRouteIndex] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);

  // --- WebSocket en tiempo real (reemplaza el polling) ---
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);

  const usuarioRef = useRef(usuario);
  useEffect(() => {
    usuarioRef.current = usuario;
  }, [usuario]);

  const connectWebSocket = useCallback(() => {
    const userKey = usuarioRef.current?.identifier || usuarioRef.current?.email;
    if (!userKey) return;

    // Usar ws:// o wss:// según el protocolo de la página
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${encodeURIComponent(userKey)}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Conectado al servidor en tiempo real');
      reconnectAttemptsRef.current = 0;
      // Heartbeat ping cada 30s para mantener la conexión viva
      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 30000);
      ws._heartbeat = heartbeat;
    };

    ws.onmessage = (event) => {
      if (event.data === 'pong') return;
      try {
        const msg = JSON.parse(event.data);

        if (msg.tipo === 'notificacion') {
          // Aviso del admin (mensaje libre)
          toast(msg.mensaje, { icon: '🔔', duration: 6000 });
          setNotificaciones(prev => [{ ...msg, leido: false }, ...prev]);
        }

        else if (msg.tipo === 'documento_revisado') {
          // Un documento fue aprobado o rechazado
          if (msg.estado === 'aprobado') {
            toast.success(`✅ ${msg.campo}: Documento aprobado`, { duration: 5000 });
          } else {
            toast.error(`❌ ${msg.campo}: Documento rechazado${msg.nota ? ' — ' + msg.nota : ''}`, { duration: 7000 });
          }
          setNotificaciones(prev => [{
            id: Date.now(),
            tipo: 'documento_revisado',
            titulo: msg.titulo,
            mensaje: msg.mensaje,
            campo: msg.campo,
            estado: msg.estado,
            fecha: msg.fecha,
            leido: false
          }, ...prev]);
          // Recargar perfil para obtener el estado actualizado
          const userKeyProfile = usuarioRef.current?.identifier || usuarioRef.current?.email;
          if (userKeyProfile) {
            fetch(`/api/user/profile?email=${encodeURIComponent(userKeyProfile)}`)
              .then(r => r.ok ? r.json() : null)
              .then(data => {
                if (data) {
                  const currentUser = usuarioRef.current;
                  if (data.estado === 'Documentos Observados' && currentUser.estado !== 'Documentos Observados') {
                    toast.error('⚠️ Tienes documentos observados. Por favor, revísalos.', { duration: 8000 });
                  }
                  if (data.estado === 'Activo' && currentUser.estado === 'Pendiente Revisión') {
                    toast.success('🎉 ¡Tu perfil ha sido aprobado!', { duration: 6000 });
                  }
                  const updatedUser = { ...currentUser, ...data };
                  localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
                  if (setUsuarioActual) setUsuarioActual(updatedUser);
                }
              })
              .catch(() => {});
          }
        }

        else if (msg.tipo === 'estado_actualizado') {
          // Estado general del usuario cambió
          const currentUser = usuarioRef.current;
          const updatedUser = { ...currentUser, estado: msg.estado };
          localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
          if (setUsuarioActual) setUsuarioActual(updatedUser);
          toast(msg.mensaje || `Tu estado cambió a: ${msg.estado}`, { icon: 'ℹ️' });
        }

      } catch (e) {
        console.warn('[WS] Error parseando mensaje:', e);
      }
    };

    ws.onclose = (event) => {
      if (ws._heartbeat) clearInterval(ws._heartbeat);
      console.log('[WS] Conexión cerrada, reintentando...');
      // Reconexión con backoff exponencial (máx 30s)
      const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30000);
      reconnectAttemptsRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(connectWebSocket, delay);
    };

    ws.onerror = (err) => {
      console.warn('[WS] Error de conexión:', err);
      ws.close();
    };
  }, [setUsuarioActual]);

  useEffect(() => {
    connectWebSocket();
    return () => {
      // Cleanup: cerrar WS y cancelar reconexión pendiente
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Evitar reconexión al desmontar
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  const markNotificationRead = async (id) => {
    try {
      await fetch('/api/conductor/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: usuario.email || usuario.identifier, notif_id: id })
      });
      setNotificaciones(notificaciones.filter(n => n.id !== id));
    } catch(e) {}
  };

  const fetchMisRutas = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/mis-rutas/${conductorId}`);
      if (!response.ok) throw new Error('Error al obtener rutas');
      const data = await response.json();
      setRutas(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMisRutas();
  }, [conductorId]);

  const cambiarUnidad = async () => {
    const nuevoId = prompt("Ingresa el nuevo ID de tu Unidad (Ej. KAP-002):", conductorId);
    if (nuevoId && nuevoId.trim() !== conductorId) {
      try {
        const response = await fetch('/api/user/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: usuario.identifier || usuario.email, unidad_id: nuevoId.trim().toUpperCase() })
        });
        if (!response.ok) throw new Error('Error al actualizar unidad');
        const updatedUser = await response.json();
        
        localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
        if (setUsuarioActual) {
          setUsuarioActual(updatedUser);
        }
        setConductorId(nuevoId.trim().toUpperCase());
        toast.success("Unidad actualizada exitosamente");
      } catch (err) {
        toast.error("Hubo un error al cambiar la unidad: " + err.message);
      }
    }
  };

  const actualizarEstadoPasajero = async (horario, agenteId, estado, evidenciaFoto = null) => {
    // Actualización Optimista
    setRutas(prevRutas => prevRutas.map(ruta => {
      if (ruta.horario === horario) {
        return {
          ...ruta,
          agentes: ruta.agentes.map(agente => 
            agente.id === agenteId ? { ...agente, estado: estado } : agente
          )
        };
      }
      return ruta;
    }));

    try {
      const response = await fetch('/api/actualizar-pasajero', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conductor_id: conductorId,
          horario: horario,
          agente_id: agenteId,
          estado: estado,
          evidencia_foto: evidenciaFoto
        })
      });
      if (response.ok) {
        // fetchMisRutas(); ya no recargamos de frente por el optimismo
        toast.success(`Pasajero marcado como ${estado}`);
      } else {
        toast.error("Error al actualizar pasajero");
      }
    } catch (error) {
      toast.error("Error de red");
    }
  };

  const enviarSOS = async () => {
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '🚨 Alerta SOS',
          message: `El conductor ${usuario.nombre} (Unidad: ${conductorId}) ha emitido una alerta SOS.`,
          type: 'error'
        })
      });
      toast.success("Central Notificada. Te estamos contactando a la brevedad.", { icon: '🚨' });
    } catch (e) {
      toast.error("No se pudo notificar a la central");
    }
  };

  const handleProfileComplete = async (data) => {
    try {
      const response = await fetch('/api/driver/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: usuario.email || usuario.identifier, perfilData: data })
      });
      if (!response.ok) throw new Error('Error al enviar perfil');
      
      const updatedUser = { ...usuario, estado: 'Pendiente Revisión' };
      localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
      if (setUsuarioActual) {
        setUsuarioActual(updatedUser);
      }
      setProfileComplete(true);
      toast.success("Perfil enviado para revisión.");
    } catch (error) {
      console.error(error);
      toast.error("Hubo un error al enviar tu perfil.");
    }
  };

  const handleResubmissionComplete = (data) => {
    const updatedUser = { ...usuario, estado: data.estado || 'Pendiente Revisión' };
    localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
    if (setUsuarioActual) {
      setUsuarioActual(updatedUser);
    }
    toast.success("Documentos enviados para revisión.");
  };

  if (!profileComplete) {
    return (
      <main style={{ padding: '20px' }}>
        <DriverOnboardingWizard usuario={usuario} onComplete={handleProfileComplete} />
      </main>
    );
  }

  if (usuario.estado === 'Documentos Observados' || usuario.estado === 'Pendiente Revisión') {
    return (
      <main style={{ padding: '20px', minHeight: '100vh', background: 'var(--bg)' }}>
        <DocumentResubmission usuario={usuario} onComplete={handleResubmissionComplete} />
      </main>
    );
  }

  if (isLoading) return <div className="loading-indicator" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Cargando tus rutas...</div>;

  return (
    <>
      <main className="driver-content">
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '15px', color: 'var(--text-secondary)' }}>
          <span style={{ fontSize: '0.9rem' }}>Unidad Asignada: <strong>{conductorId}</strong></span>
          <button onClick={cambiarUnidad} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }} title="Cambiar Unidad">
            <Pencil size={12} /> Cambiar
          </button>
        </div>

        <button className="no-print" onClick={enviarSOS} style={{ width: '100%', background: '#dc2626', color: 'white', padding: '15px', borderRadius: '8px', border: 'none', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '20px', boxShadow: '0 4px 6px rgba(220, 38, 38, 0.3)', cursor: 'pointer' }}>
          🚨 BOTÓN DE EMERGENCIA (SOS)
        </button>

        {notificaciones.length > 0 && (
          <div className="no-print" style={{ marginBottom: '20px', background: 'var(--bg-secondary)', border: '1px solid var(--kapital-accent-orange)', borderRadius: '8px', padding: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h4 style={{ margin: 0, color: 'var(--kapital-accent-orange)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                🔔 Notificaciones ({notificaciones.length})
              </h4>
              <button onClick={() => setShowNotifications(!showNotifications)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.9rem' }}>
                {showNotifications ? 'Ocultar' : 'Ver'}
              </button>
            </div>
            {showNotifications && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', overflowX: 'hidden' }}>
                <AnimatePresence>
                  {notificaciones.map(n => (
                    <motion.div 
                      key={n.id} 
                      initial={{ opacity: 0, x: -50 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: (n._swipeDir || 100) }}
                      drag="x"
                      dragConstraints={{ left: 0, right: 0 }}
                      onDragEnd={(e, { offset }) => {
                        if (offset.x > 80 || offset.x < -80) {
                          n._swipeDir = offset.x > 0 ? 100 : -100;
                          markNotificationRead(n.id);
                        }
                      }}
                      style={{ background: 'var(--bg)', padding: '10px', borderRadius: '6px', borderLeft: '4px solid var(--kapital-accent-orange)', position: 'relative', touchAction: 'pan-y' }}
                    >
                      <button onClick={() => markNotificationRead(n.id)} style={{ position: 'absolute', top: '5px', right: '5px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                        ✕
                      </button>
                      <strong>{n.titulo}</strong>
                      <p style={{ margin: '5px 0 0 0', fontSize: '0.9rem', color: 'var(--text-primary)' }}>{n.mensaje}</p>
                      <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '5px' }}>De: {n.de}</small>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}

        {activeZenRouteIndex !== null ? (
          <ZenModeView 
            ruta={rutas[activeZenRouteIndex]}
            conductorId={conductorId}
            onExitZen={() => setActiveZenRouteIndex(null)}
            onActualizarPasajero={actualizarEstadoPasajero}
          />
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--kapital-border)', paddingBottom: '10px', marginBottom: '15px' }}>
              <h3 style={{ margin: 0 }}>Mis Rutas de Hoy</h3>
          <button className="no-print" onClick={() => window.print()} style={{ background: 'var(--kapital-accent-green)', border: 'none', color: 'white', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
            🖨️ Imprimir Manifiesto
          </button>
        </div>
        
        {error && <p className="error-message">{error}</p>}
        {rutas.length === 0 && !error && <p>No tienes rutas asignadas en este momento.</p>}

        {rutas.map((ruta, index) => (
          <div key={index} className="driver-route-card">
            <div className="driver-route-header">
              <span className="driver-route-time">🕒 {ruta.horario}</span>
              <span className="driver-route-zone">📍 {ruta.zona}</span>
            </div>
            
            {/* Barra de progreso de la ruta */}
            <div style={{ marginBottom: '15px', background: 'var(--kapital-bg)', borderRadius: '10px', height: '12px', overflow: 'hidden', border: '1px solid var(--kapital-border)' }}>
              <div style={{ width: `${(ruta.agentes.filter(a => a.estado === 'Recogido' || a.estado === 'Ausente').length / ruta.agentes.length) * 100}%`, height: '100%', background: 'var(--kapital-accent-green)', transition: 'width 0.5s ease' }} />
            </div>

            <div className="driver-passengers-list">
              {ruta.agentes.map((agente, idx) => {
                const isCompletado = agente.estado === 'Recogido' || agente.estado === 'Ausente';
                const firstPendingIdx = ruta.agentes.findIndex(a => a.estado !== 'Recogido' && a.estado !== 'Ausente');
                const isNext = idx === firstPendingIdx;

                return (
                  <SwipeablePassenger 
                    key={idx}
                    agente={agente}
                    isNext={isNext}
                    isCompletado={isCompletado}
                    onSwipeAction={(estado, evidencia) => actualizarEstadoPasajero(ruta.horario, agente.id, estado, evidencia)}
                    onImageClick={setPreviewImage}
                  />
                );
              })}
            </div>
            
            <button 
              className="no-print"
              onClick={() => setActiveZenRouteIndex(index)}
              style={{ width: '100%', marginTop: '15px', background: 'var(--kapital-blue-deep)', color: 'white', padding: '12px', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            >
              <Play size={18} /> INICIAR RUTA
            </button>
          </div>
        ))}
        </>
        )}
      </main>

      {/* Fullscreen Photo Preview Modal */}
      {previewImage && (
        <div 
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0, 0, 0, 0.8)', backdropFilter: 'blur(10px)',
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px', cursor: 'zoom-out'
          }}
          onClick={() => setPreviewImage(null)}
        >
          <img 
            src={previewImage} 
            alt="Evidencia" 
            style={{
              maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
              borderRadius: '12px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
            }} 
            onClick={(e) => e.stopPropagation()}
          />
          <button 
            onClick={() => setPreviewImage(null)}
            style={{
              position: 'absolute', top: '20px', right: '20px',
              background: 'white', color: 'black', border: 'none',
              borderRadius: '50%', width: '40px', height: '40px',
              fontWeight: 'bold', fontSize: '20px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>
      )}

      <style jsx>{`
        .driver-portal {
          min-height: 100vh;
          background-color: var(--kapital-bg);
          color: var(--kapital-text-primary);
        }
        .driver-header {
          background-color: var(--kapital-card-bg);
          padding: 20px;
          border-bottom: 1px solid var(--kapital-border);
        }
        .driver-content {
          padding: 20px;
          max-width: 600px;
          margin: 0 auto;
        }
        .driver-route-card {
          background-color: var(--kapital-card-bg);
          border-radius: 12px;
          padding: 15px;
          margin-bottom: 20px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .driver-route-header {
          display: flex;
          justify-content: space-between;
          border-bottom: 1px solid var(--kapital-border);
          padding-bottom: 10px;
          margin-bottom: 15px;
          font-weight: bold;
        }
        .driver-passenger-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px 0;
          border-bottom: 1px solid var(--kapital-border);
        }
        .driver-passenger-item:last-child {
          border-bottom: none;
        }
        .driver-passenger-item.recogido {
          opacity: 0.5;
        }
        .driver-action-btn {
          background-color: var(--kapital-accent-green);
          color: white;
          border: none;
          padding: 12px 20px;
          border-radius: 8px;
          font-weight: bold;
          font-size: 0.9rem;
          min-width: 100px;
          cursor: pointer;
        }
        .driver-action-btn.btn-recogido {
          background-color: transparent;
          border: 1px solid var(--kapital-border);
          color: var(--kapital-text-secondary);
          cursor: default;
        }
        .driver-action-btn.ausente-btn {
          background-color: transparent;
          border: 1px solid #f59e0b;
          color: #f59e0b;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.8rem;
        }
        .driver-action-btn.ausente-btn:hover {
          background-color: rgba(245, 158, 11, 0.1);
        }
        
        .quick-action-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 600;
          text-decoration: none;
          transition: all 0.2s ease;
        }
        .quick-action-btn.waze { background: rgba(56, 189, 248, 0.1); color: #38BDF8; border: 1px solid rgba(56, 189, 248, 0.3); }
        .quick-action-btn.waze:hover { background: rgba(56, 189, 248, 0.2); }
        .quick-action-btn.whatsapp { background: rgba(34, 197, 94, 0.1); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
        .quick-action-btn.whatsapp:hover { background: rgba(34, 197, 94, 0.2); }
        .quick-action-btn.phone { background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); }
        .quick-action-btn.phone:hover { background: rgba(148, 163, 184, 0.2); }

        .next-passenger-glow {
          border-left: 4px solid #38BDF8;
          background: linear-gradient(90deg, rgba(56, 189, 248, 0.08) 0%, transparent 100%);
          padding-left: 15px;
          margin-left: -15px;
          animation: pulseGlow 2s infinite;
        }
        @keyframes pulseGlow {
          0% { box-shadow: inset 2px 0 0px rgba(56, 189, 248, 0); }
          50% { box-shadow: inset 4px 0 10px rgba(56, 189, 248, 0.2); }
          100% { box-shadow: inset 2px 0 0px rgba(56, 189, 248, 0); }
        }
        @media print {
          .no-print { display: none !important; }
          .driver-portal { background: white !important; color: black !important; padding: 0; min-height: auto; }
          .driver-route-card { border: 1px solid #ccc !important; box-shadow: none !important; page-break-inside: avoid; }
          body { background: white; }
          * { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; }
          .driver-content { padding: 0 !important; max-width: 100% !important; }
          h3 { color: black !important; }
          .driver-passenger-info div { color: black !important; }
          }
        `}</style>
    </>
  );
};

export default DriverPortal;
