import React, { useState, useEffect } from 'react';
import DriverOnboardingWizard from './components/DriverOnboardingWizard';
import { LogOut, Sun, Moon, Pencil, MapPin, MessageCircle, Phone, Navigation, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import './App.css';

const DriverPortal = ({ usuario, setUsuarioActual, onLogout, theme, toggleTheme }) => {
  const [rutas, setRutas] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Si el usuario ya está en revisión, su perfil está completo
  const [profileComplete, setProfileComplete] = useState(usuario.profileComplete || usuario.estado === 'Pendiente Revisión' || false);

  const [conductorId, setConductorId] = useState(usuario.unidad_id || 'KAP-001');

  // Poll for status changes if pending
  useEffect(() => {
    if (usuario.estado !== 'Pendiente Revisión') return;
    
    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/user/profile?email=${encodeURIComponent(usuario.email)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.estado === 'Activo') {
            toast.success("¡Tu perfil ha sido aprobado!");
            const updatedUser = { ...usuario, ...data };
            localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
            if (setUsuarioActual) setUsuarioActual(updatedUser);
          }
        }
      } catch(e) {}
    };
    
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [usuario, setUsuarioActual]);

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
          body: JSON.stringify({ email: usuario.email, unidad_id: nuevoId.trim().toUpperCase() })
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

  const actualizarEstadoPasajero = async (horario, agenteId, estado) => {
    try {
      const response = await fetch('/api/actualizar-pasajero', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conductor_id: conductorId,
          horario: horario,
          agente_id: agenteId,
          estado: estado
        })
      });
      if (response.ok) {
        fetchMisRutas();
        toast.success(`Pasajero marcado como ${estado}`);
      } else {
        toast.error("Error al actualizar pasajero");
      }
    } catch (error) {
      toast.error("Error de red");
    }
  };
      toast.error("Error al actualizar pasajero");
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
        body: JSON.stringify({ email: usuario.email, perfilData: data })
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
      toast.error("Ocurrió un error al enviar el perfil. Intenta de nuevo.");
      console.error(error);
    }
  };

  if (!profileComplete) {
    return (
      <div className="driver-portal">
        <nav className="navbar no-print">
          <div className="navbar-left">
            <img src="/logo.png" alt="Kapital Routing Logo" className="navbar-logo" />
          </div>
          <div className="nav-links">
            <span style={{ color: '#f8fafc', fontWeight: 600, marginRight: '20px' }}>¡Hola, {usuario.nombre}!</span>
            <span className="nav-separator">|</span>
            <a onClick={onLogout} className="nav-link nav-link-icon">
              <LogOut size={18} style={{ marginRight: '6px' }} /> Salir
            </a>
            <button onClick={toggleTheme} className="theme-toggle" title="Cambiar Tema">
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} color="#facc15" fill="#facc15" />}
            </button>
          </div>
        </nav>
        <main style={{ padding: '20px' }}>
          <DriverOnboardingWizard usuario={usuario} onComplete={handleProfileComplete} />
        </main>
      </div>
    );
  }

  if (usuario.estado === 'Pendiente Revisión') {
    return (
      <div className="driver-portal" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <nav className="navbar no-print">
          <div className="navbar-left">
            <img src="/logo.png" alt="Kapital Routing Logo" className="navbar-logo" />
          </div>
          <div className="nav-links">
            <span style={{ color: '#f8fafc', fontWeight: 600, marginRight: '20px' }}>¡Hola, {usuario.nombre}!</span>
            <span className="nav-separator">|</span>
            <a onClick={onLogout} className="nav-link nav-link-icon">
              <LogOut size={18} style={{ marginRight: '6px' }} /> Salir
            </a>
            <button onClick={toggleTheme} className="theme-toggle" title="Cambiar Tema">
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} color="#facc15" fill="#facc15" />}
            </button>
          </div>
        </nav>
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'var(--bg)', padding: '40px', borderRadius: '12px', boxShadow: 'var(--shadow)', textAlign: 'center', maxWidth: '500px' }}>
            <h2 style={{ color: 'var(--kapital-blue-deep)', marginBottom: '15px' }}>⏳ Perfil en Revisión</h2>
            <p style={{ color: 'var(--text)', lineHeight: '1.6' }}>
              Hemos recibido tu información exitosamente. Nuestro equipo está verificando tus datos y documentos.
            </p>
            <p style={{ color: 'var(--text)', lineHeight: '1.6', marginTop: '10px' }}>
              Por favor, regresa más tarde. Podrás acceder a tus rutas asignadas una vez que tu perfil sea aprobado.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (isLoading) return <div className="loading-indicator" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Cargando tus rutas...</div>;

  return (
    <div className="driver-portal">
      <nav className="navbar no-print">
        <div className="navbar-left">
          <img src="/logo.png" alt="Kapital Routing Logo" className="navbar-logo" />
        </div>
        <div className="nav-links">
          <span style={{ color: '#f8fafc', fontWeight: 600, marginRight: '10px' }}>¡Hola, {usuario.nombre}!</span>
          <span style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'flex', alignItems: 'center', marginRight: '20px' }}>
            (Unidad: {conductorId})
            <button onClick={cambiarUnidad} style={{ marginLeft: '6px', background: 'transparent', border: 'none', color: '#38BDF8', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="Cambiar Unidad">
              <Pencil size={14} />
            </button>
          </span>
          <span className="nav-separator">|</span>
          <a onClick={onLogout} className="nav-link nav-link-icon">
            <LogOut size={18} style={{ marginRight: '6px' }} /> Salir
          </a>
          <button onClick={toggleTheme} className="theme-toggle" title="Cambiar Tema">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} color="#facc15" fill="#facc15" />}
          </button>
        </div>
      </nav>

      <main className="driver-content">
        <button className="no-print" onClick={enviarSOS} style={{ width: '100%', background: '#dc2626', color: 'white', padding: '15px', borderRadius: '8px', border: 'none', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '20px', boxShadow: '0 4px 6px rgba(220, 38, 38, 0.3)', cursor: 'pointer' }}>
          🚨 BOTÓN DE EMERGENCIA (SOS)
        </button>

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
                const isRecogido = agente.estado === 'Recogido';
                const isAusente = agente.estado === 'Ausente';
                const isCompletado = isRecogido || isAusente;
                
                // Encontrar el primer pasajero no completado para resaltarlo
                const firstPendingIdx = ruta.agentes.findIndex(a => a.estado !== 'Recogido' && a.estado !== 'Ausente');
                const isNext = idx === firstPendingIdx;

                return (
                  <div key={idx} className={`driver-passenger-item ${isCompletado ? 'recogido' : ''} ${isNext ? 'next-passenger-glow' : ''}`}>
                    <div className="driver-passenger-info" style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', fontSize: '1.05rem', color: isNext ? '#38BDF8' : 'inherit' }}>{agente.nombre}</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--kapital-text-secondary)', marginTop: '4px' }}>🏠 {agente.direccion}</div>
                      
                      {/* Botones de acción rápida */}
                      {!isCompletado && (
                        <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }} className="no-print">
                          <a href={`https://www.waze.com/ul?q=${encodeURIComponent(agente.direccion)}`} target="_blank" rel="noopener noreferrer" className="quick-action-btn waze">
                            <Navigation size={14} /> Waze
                          </a>
                          <a href={`https://wa.me/51${agente.telefono || ''}?text=${encodeURIComponent('Hola ' + agente.nombre + ', tu transporte de Kapital Routing está afuera.')}`} target="_blank" rel="noopener noreferrer" className="quick-action-btn whatsapp">
                            <MessageCircle size={14} /> 
                          </a>
                          <a href={`tel:${agente.telefono || ''}`} className="quick-action-btn phone">
                            <Phone size={14} />
                          </a>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end', marginLeft: '10px' }}>
                      <button 
                        className={`driver-action-btn no-print ${isCompletado ? 'btn-recogido' : ''}`}
                        disabled={isCompletado}
                        onClick={() => actualizarEstadoPasajero(ruta.horario, agente.id, 'Recogido')}
                      >
                        {isRecogido ? '✓ Listo' : isAusente ? '❌ Ausente' : 'Recoger'}
                      </button>
                      {!isCompletado && (
                        <button 
                          className="driver-action-btn ausente-btn no-print"
                          onClick={() => {
                            if(window.confirm(`¿Seguro que ${agente.nombre} no se presentó?`)) {
                              actualizarEstadoPasajero(ruta.horario, agente.id, 'Ausente');
                            }
                          }}
                        >
                          <AlertTriangle size={14} style={{ marginRight: '4px' }}/> Ausente
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </main>

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
    </div>
  );
};

export default DriverPortal;
