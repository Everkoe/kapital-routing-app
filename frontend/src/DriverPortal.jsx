import React, { useState, useEffect } from 'react';
import DriverOnboardingWizard from './components/DriverOnboardingWizard';
import { LogOut, Sun, Moon, Pencil } from 'lucide-react';
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

  const marcarRecogido = async (horario, agenteId) => {
    try {
      const response = await fetch('/api/actualizar-pasajero', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conductor_id: conductorId,
          horario: horario,
          agente_id: agenteId,
          estado: 'Recogido'
        })
      });
      if (response.ok) {
        fetchMisRutas();
        toast.success("Pasajero marcado como recogido");
      } else {
        toast.error("Error al actualizar pasajero");
      }
    } catch (error) {
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
            
            <div className="driver-passengers-list">
              {ruta.agentes.map((agente, idx) => {
                const isRecogido = agente.estado === 'Recogido';
                return (
                  <div key={idx} className={`driver-passenger-item ${isRecogido ? 'recogido' : ''}`}>
                    <div className="driver-passenger-info">
                      <div style={{ fontWeight: 'bold' }}>{agente.nombre}</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--kapital-text-secondary)' }}>🏠 {agente.direccion}</div>
                    </div>
                    <button 
                      className={`driver-action-btn no-print ${isRecogido ? 'btn-recogido' : ''}`}
                      disabled={isRecogido}
                      onClick={() => marcarRecogido(ruta.horario, agente.id)}
                    >
                      {isRecogido ? '✓ Listo' : 'Recoger'}
                    </button>
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
          border: 1px solid var(--kapital-accent-green);
          color: var(--kapital-accent-green);
          cursor: default;
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
