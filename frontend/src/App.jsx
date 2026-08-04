// App.jsx - Trigger Vercel Deploy 
import React, { useState, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

import './App.css';
import LiveMap from './LiveMap';
import FlotaView from './FlotaView';
import DriverPortal from './DriverPortal';
import ClientPortal from './ClientPortal';
import CopilotChat from './CopilotChat';
import VistaReportes from './VistaReportes';

// --- Componente de Autenticación ---
const PantallaAuth = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isVerificationStep, setIsVerificationStep] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [formData, setFormData] = useState({ email: '', password: '', confirmar_password: '', telefono: '', nombre: '', rol: 'Administrador', unidad_id: '', empresa_id: '' });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!isLogin) {
      if (formData.password !== formData.confirmar_password) {
        setError('Las contraseñas no coinciden.');
        return;
      }
    }

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    const payload = isLogin ? { email: formData.email, password: formData.password } : formData;

    setIsAuthLoading(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Ocurrió un error.');
      }
      if (isLogin) {
        onLogin(data);
      } else {
        alert('¡Solicitud enviada! Tu cuenta está Pendiente de Aprobación por un Administrador.');
        setIsLogin(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsAuthLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-branding">
        <div className="auth-branding-content">
          <h1>Kapital Routing</h1>
          <p>Revolucionando la logística corporativa y la asignación inteligente con tecnología de vanguardia.</p>
          <div className="auth-decorative-circle"></div>
        </div>
      </div>
      <div className="auth-form-wrapper">
        <div className="auth-form-card">
          <div className="auth-logo-container">
            <img src="/logo.png" alt="Kapital Routing Logo" className="auth-logo" onError={(e) => e.target.style.display='none'} />
          </div>
          <form onSubmit={handleSubmit} className="auth-form">
            <h2>
              {isLogin ? 'Bienvenido de nuevo' : 'Solicitar Acceso'}
            </h2>
            <p className="auth-subtitle">
              {isLogin ? 'Ingresa tus credenciales para acceder al sistema' : 'Únete a nuestra plataforma logística (Aprobación Requerida)'}
            </p>
            {error && <p className="error-message" style={{textAlign: 'center'}}>{error}</p>}
            
                {!isLogin && <input className="auth-input" name="nombre" type="text" placeholder="Nombre Completo" onChange={handleInputChange} required />}
                {!isLogin && <input className="auth-input" name="telefono" type="tel" placeholder="Teléfono" onChange={handleInputChange} required />}
                <input className="auth-input" name="email" type="email" placeholder="Correo Electrónico" onChange={handleInputChange} required />
                <input className="auth-input" name="password" type="password" placeholder="Contraseña" onChange={handleInputChange} required />
                {!isLogin && <input className="auth-input" name="confirmar_password" type="password" placeholder="Confirmar Contraseña" onChange={handleInputChange} required />}
                
                {!isLogin && (
                  <>
                    <select className="auth-input" name="rol" onChange={handleInputChange}>
                      <option>Administrador</option>
                      <option>Conductor</option>
                      <option>Cliente</option>
                    </select>
                    {formData.rol === 'Conductor' && (
                      <input className="auth-input" name="unidad_id" type="text" placeholder="ID de Unidad (Ej. KAP-001)" onChange={handleInputChange} required />
                    )}
                    {formData.rol === 'Cliente' && (
                      <input className="auth-input" name="empresa_id" type="text" placeholder="Código de Empresa (Ej. GLOBO_AZUL)" onChange={handleInputChange} required />
                    )}
                  </>
                )}
            
            <button type="submit" className="auth-button" disabled={isAuthLoading}>
              {isAuthLoading ? (
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'}}>
                  <span className="auth-spinner"></span>
                  {isLogin ? 'Iniciando sesión...' : 'Registrando...'}
                </div>
              ) : (
                isLogin ? 'Ingresar' : 'Enviar Solicitud'
              )}
            </button>
            
            <p className="auth-toggle" onClick={() => setIsLogin(!isLogin)}>
              {isLogin ? '¿No tienes cuenta? Solicita acceso' : '¿Ya tienes cuenta? Inicia sesión'}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};


// --- Componentes de Vistas ---
const UsersManagementTab = ({ usuarioActual }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    try {
      const res = await fetch(`/api/admin/users?email=${encodeURIComponent(usuarioActual.email)}`);
      const data = await res.json();
      if (res.ok) setUsers(data.usuarios || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAction = async (targetEmail, action) => {
    try {
      const res = await fetch(`/api/admin/users/${action}/${encodeURIComponent(targetEmail)}?admin_email=${encodeURIComponent(usuarioActual.email)}`, {
        method: action === 'approve' ? 'PUT' : 'DELETE'
      });
      if (res.ok) fetchUsers();
      else alert("Error al realizar la acción");
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="card">
      <h2>Gestión de Accesos (B2B)</h2>
      <p>Administra las solicitudes de ingreso a la plataforma Kapital Routing.</p>
      
      {loading ? <p>Cargando...</p> : (
        <table className="rt-table" style={{width: '100%', marginTop: '20px'}}>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.email}>
                <td>{u.nombre}</td>
                <td>{u.email}</td>
                <td>{u.rol}</td>
                <td>
                  <span style={{ 
                    padding: '4px 8px', borderRadius: '4px', fontSize: '12px',
                    backgroundColor: u.estado === 'Activo' ? '#28a745' : '#ffc107',
                    color: u.estado === 'Activo' ? 'white' : 'black'
                  }}>{u.estado}</span>
                </td>
                <td>
                  {u.estado === 'Pendiente' && (
                    <>
                      <button onClick={() => handleAction(u.email, 'approve')} style={{marginRight: '8px', backgroundColor: '#28a745', border: 'none', color: 'white', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer'}}>✅ Aprobar</button>
                      <button onClick={() => handleAction(u.email, 'reject')} style={{backgroundColor: '#dc3545', border: 'none', color: 'white', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer'}}>❌ Denegar</button>
                    </>
                  )}
                  {u.estado === 'Activo' && u.email !== usuarioActual.email && (
                    <button onClick={() => handleAction(u.email, 'reject')} style={{backgroundColor: '#dc3545', border: 'none', color: 'white', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer'}}>Desactivar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const Navbar = ({ vistaActual, setVistaActual, onLogout, theme, toggleTheme, usuarioActual }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  const handleNav = (vista) => {
    setVistaActual(vista);
    setIsOpen(false);
  };

  return (
    <nav className="navbar">
      <img src="/logo.png" alt="Kapital Routing Logo" className="navbar-logo" onClick={() => handleNav('dashboard')} />
      <button className="hamburger-menu" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? '✕' : '☰'}
      </button>
      <div className={`nav-links ${isOpen ? 'open' : ''}`}>
        <a onClick={() => handleNav('dashboard')} className={vistaActual === 'dashboard' ? 'nav-link active' : 'nav-link'}>Tablero</a>
        <a onClick={() => handleNav('flota')} className={vistaActual === 'flota' ? 'nav-link active' : 'nav-link'}>Gestión de Flota</a>
        <a onClick={() => handleNav('reportes')} className={vistaActual === 'reportes' ? 'nav-link active' : 'nav-link'}>Reportes</a>
        <a onClick={() => handleNav('configuracion')} className={vistaActual === 'configuracion' ? 'nav-link active' : 'nav-link'}>Configuración</a>
        
        {usuarioActual?.rol === 'Administrador' && (
           <a onClick={() => handleNav('usuarios')} className={vistaActual === 'usuarios' ? 'nav-link active' : 'nav-link'} style={{color: '#007aff'}}>🛡️ Usuarios</a>
        )}
        
        <span className="nav-separator">|</span>
        <a onClick={() => handleNav('perfil')} className={vistaActual === 'perfil' ? 'nav-link active' : 'nav-link'}>👤 Mi Perfil</a>
        <a onClick={() => { onLogout(); setIsOpen(false); }} className="nav-link">Cerrar Sesión</a>
        <button onClick={toggleTheme} className="theme-toggle" title="Cambiar Tema">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
    </nav>
  );
};

const VistaPerfil = ({ usuario, setUsuarioActual, onLogout }) => {
  const [activeTab, setActiveTab] = useState('personal');
  const [formData, setFormData] = useState({ nombre: usuario.nombre, current_password: '', new_password: '' });
  const [avatar, setAvatar] = useState(usuario.avatar || null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const onDrop = (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setAvatar(e.target.result);
      reader.readAsDataURL(file);
    }
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: {'image/*': []}, maxFiles: 1 });

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });
    
    try {
      const payload = {
        email: usuario.email,
        nombre: formData.nombre !== usuario.nombre ? formData.nombre : undefined,
        current_password: formData.current_password || undefined,
        new_password: formData.new_password || undefined,
        avatar: avatar !== usuario.avatar ? avatar : undefined
      };
      
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404) {
          alert('Sesión expirada o usuario no encontrado. Por favor, inicia sesión nuevamente.');
          onLogout();
          return;
        }
        throw new Error(data.detail || 'Error al actualizar perfil');
      }
      
      setUsuarioActual(data);
      localStorage.setItem('kapital_user', JSON.stringify(data));
      setMessage({ type: 'success', text: 'Perfil actualizado correctamente.' });
      setFormData(prev => ({ ...prev, current_password: '', new_password: '' }));
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card profile-wrapper">
      <div className="profile-tabs">
        <button className={activeTab === 'personal' ? 'active' : ''} onClick={() => setActiveTab('personal')}>Información Personal</button>
        <button className={activeTab === 'security' ? 'active' : ''} onClick={() => setActiveTab('security')}>Seguridad</button>
      </div>
      
      <div className="profile-content">
        {message.text && <div className={`profile-alert ${message.type}`}>{message.text}</div>}
        
        {activeTab === 'personal' && (
          <form className="config-form" onSubmit={handleSave}>
            <div className="avatar-section">
              <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
                <input {...getInputProps()} />
                {avatar ? (
                  <img src={avatar} alt="Avatar" className="profile-avatar-img" />
                ) : (
                  <div className="profile-avatar">{usuario.nombre.charAt(0)}</div>
                )}
                <p>{isDragActive ? 'Suelta la imagen aquí...' : 'Arrastra una nueva foto de perfil o haz clic'}</p>
              </div>
            </div>
            <label>Nombre Completo</label>
            <input type="text" name="nombre" value={formData.nombre} onChange={handleChange} className="form-input" required />
            <label>Correo Electrónico</label>
            <input type="email" value={usuario.email} className="form-input disabled-input" disabled />
            <label>Rol de Usuario</label>
            <input type="text" value={usuario.rol} className="form-input disabled-input" disabled />
            
            <button type="submit" className="btn-primary profile-save-btn" disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          </form>
        )}

        {activeTab === 'security' && (
          <form className="config-form" onSubmit={handleSave}>
            <label>Contraseña Actual</label>
            <input type="password" name="current_password" value={formData.current_password} onChange={handleChange} className="form-input" required />
            <label>Nueva Contraseña</label>
            <input type="password" name="new_password" value={formData.new_password} onChange={handleChange} className="form-input" required />
            
            <button type="submit" className="btn-primary profile-save-btn" disabled={loading || !formData.new_password}>
              {loading ? 'Actualizando...' : 'Actualizar Contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

// ... (El resto de los componentes de Vistas y Dashboard permanecen sin cambios)
const VistaFlota = () => ( <div className="card"><div className="card-header"><h2>Gestión de Flota</h2></div></div> );
const VistaConfiguracion = () => ( <div className="card"><div className="card-header"><h2>Configuración del Algoritmo</h2></div></div> );
const KPICard = ({ title, value, color }) => ( <div className="kpi-card" style={{ borderLeftColor: color }}><span className="kpi-value">{value}</span><span className="kpi-title">{title}</span></div> );
const KPIDashboard = ({ routes }) => { 
  const kpis = useMemo(() => { 
    const totalAgentes = routes.reduce((sum, route) => sum + route.agentes.length, 0); 
    const flotaActiva = new Set(routes.filter(r => r.conductor !== "SIN ASIGNAR").map(r => r.conductor)).size; 
    const capacidadTotal = flotaActiva * 15; 
    const tasaOptimizacion = capacidadTotal > 0 ? ((totalAgentes / capacidadTotal) * 100).toFixed(1) : 0; 
    const rutasProgramadas = routes.length; 
    return { totalAgentes, flotaActiva, tasaOptimizacion, rutasProgramadas }; 
  }, [routes]); 

  const chartData = useMemo(() => {
    return routes.map(r => ({
      name: r.conductor,
      pasajeros: r.agentes.length,
      vacios: 15 - r.agentes.length
    }));
  }, [routes]);

  const pieData = [
    { name: 'Ocupado', value: parseFloat(kpis.tasaOptimizacion) },
    { name: 'Libre', value: 100 - parseFloat(kpis.tasaOptimizacion) }
  ];
  const COLORS = ['#10B981', '#334155'];

  return ( 
    <div style={{display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '20px'}}>
      <div className="kpi-container">
        <KPICard title="Total Agentes" value={kpis.totalAgentes} color="#38bdf8" />
        <KPICard title="Flota Activa (Vehículos)" value={kpis.flotaActiva} color="#10B981" />
        <KPICard title="Rutas Programadas" value={kpis.rutasProgramadas} color="#f59e0b" />
        <KPICard title="Tasa de Optimización" value={`${kpis.tasaOptimizacion}%`} color="#8b5cf6" />
      </div> 
      {routes.length > 0 && (
      <div style={{display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px'}}>
        <div className="card" style={{flex: '1 1 300px', minWidth: '280px', height: '320px'}}>
          <h3 style={{marginTop: 0, padding: '15px 20px', borderBottom: '1px solid var(--kapital-border)'}}>Carga por Unidad</h3>
          <ResponsiveContainer width="100%" height="80%">
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <XAxis dataKey="name" stroke="var(--kapital-text-secondary)" />
              <YAxis stroke="var(--kapital-text-secondary)" />
              <Tooltip contentStyle={{backgroundColor: 'var(--kapital-card-bg)', border: '1px solid var(--kapital-border)'}} />
              <Legend />
              <Bar dataKey="pasajeros" stackId="a" fill="#38bdf8" name="Pasajeros" />
              <Bar dataKey="vacios" stackId="a" fill="rgba(56, 189, 248, 0.2)" name="Asientos Vacíos" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card" style={{flex: '1 1 280px', minWidth: '280px', height: '320px'}}>
           <h3 style={{marginTop: 0, padding: '15px 20px', borderBottom: '1px solid var(--kapital-border)'}}>Eficiencia Global</h3>
           <ResponsiveContainer width="100%" height="80%">
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{backgroundColor: 'var(--kapital-card-bg)', border: '1px solid var(--kapital-border)'}} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      )}
    </div>
  ); 
};
const DriverCard = ({ route, routeIndex, onManualAssign, onDragStart, onDrop }) => { 
  const notificarWhatsApp = () => { 
    const message = `Hola ${route.conductor}, tu ruta de las ${route.horario} en ${route.micro_zona} ha sido asignada. Llevas a ${route.agentes.length} pasajeros.`; 
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank'); 
  }; 
  return ( 
    <div 
      className="driver-card" 
      onDragOver={(e) => e.preventDefault()} 
      onDrop={(e) => onDrop(e, routeIndex)}
      style={{ transition: 'all 0.3s ease' }}
    >
      <div className="driver-card-header">
        <div>
          <h3>{route.conductor}</h3>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--kapital-text-secondary)' }}>{route.horario}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="micro-zone-badge">{route.micro_zona}</span>
          {route.conductor === "SIN ASIGNAR" ? 
            <button onClick={() => onManualAssign(route)} className="btn-manual-assign">Asignar Unidad</button> : 
            <button onClick={notificarWhatsApp} className="btn-whatsapp">Notificar</button>
          }
        </div>
      </div>
      <ul className="agent-list" style={{ minHeight: '50px' }}>
        {route.agentes.map(agente => (
          <li 
            key={agente.id} 
            draggable 
            onDragStart={(e) => onDragStart(e, routeIndex, agente.id)}
            style={{ cursor: 'grab', display: 'flex', alignItems: 'center', gap: '8px' }}
            title="Arrastra para reasignar"
          >
             <span style={{opacity: 0.5}}>⠿</span> {agente.id} - {agente.direccion}
          </li>
        ))}
      </ul>
      <div style={{textAlign: 'center', fontSize: '0.75rem', opacity: 0.4, marginTop: '10px'}}>Arrastra aquí pasajeros</div>
    </div> 
  ); 
};
const EmergencyCenter = ({ onEmergencyAction, isLoading }) => { const [conductorId, setConductorId] = useState(''); const [tipoEmergencia, setTipoEmergencia] = useState('Baja Total (Siniestro)'); const [horario, setHorario] = useState('Todos los turnos'); const handleActionClick = () => { if (conductorId) onEmergencyAction({ conductor_id: conductorId, tipo_emergencia: tipoEmergencia, horario }); }; const isSos = tipoEmergencia === 'Retraso por Tráfico'; const buttonClass = isSos ? 'btn-sos' : 'btn-danger'; const buttonText = isSos ? 'Enviar SOS por WhatsApp' : 'Reasignar Emergencia'; return ( <div className="card"><div className="card-header"><h2>Centro de Control de Incidentes</h2></div><div className="emergency-form"><input className="form-input" type="text" placeholder="ID Conductor Afectado" value={conductorId} onChange={(e) => setConductorId(e.target.value)} /><select className="form-select" value={tipoEmergencia} onChange={(e) => setTipoEmergencia(e.target.value)}><option>Baja Total (Siniestro)</option><option>Falla Temporal (Reasignar Turno)</option><option>Retraso por Tráfico</option></select><select className="form-select" value={horario} onChange={(e) => setHorario(e.target.value)} disabled={isSos}><option>Todos los turnos</option><option>08:00 AM</option><option>10:00 AM</option><option>06:00 PM</option></select><button className={buttonClass} onClick={handleActionClick} disabled={isLoading || !conductorId}>{buttonText}</button></div></div> ); };
const AuditLog = ({ logs }) => ( <div className="card"><div className="card-header"><h2>Registro de Actividad (Audit Log)</h2></div><div className="audit-log-container">{logs.map((log, index) => <p key={index} className="log-entry">{log}</p>)}</div></div> );
const DashboardView = ({ routes, addLog, setRoutes }) => {
  const syncToBackend = async (newRoutes) => {
    try {
      await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRoutes)
      });
    } catch (err) {
      console.error("Error guardando cambios:", err);
    }
  };

  const [selectedFile, setSelectedFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Filtros de Smart Routing
  const [filtroFecha, setFiltroFecha] = useState('');
  const [filtroHora, setFiltroHora] = useState('00:00');
  const [filtroSentido, setFiltroSentido] = useState('INGRESO');
  const [filtroSede, setFiltroSede] = useState('BELLAVISTA');
  
  const handleDragStart = (e, fromRouteIndex, agenteId) => {
    e.dataTransfer.setData('fromRouteIndex', fromRouteIndex);
    e.dataTransfer.setData('agenteId', agenteId);
  };

  const handleDrop = (e, toRouteIndex) => {
    e.preventDefault();
    const fromRouteIndex = parseInt(e.dataTransfer.getData('fromRouteIndex'), 10);
    const agenteId = e.dataTransfer.getData('agenteId');
    if (isNaN(fromRouteIndex) || fromRouteIndex === toRouteIndex) return;
    setRoutes(prevRoutes => {
      const newRoutes = [...prevRoutes];
      const fromRoute = { ...newRoutes[fromRouteIndex], agentes: [...newRoutes[fromRouteIndex].agentes] };
      const toRoute = { ...newRoutes[toRouteIndex], agentes: [...newRoutes[toRouteIndex].agentes] };
      const agenteIndex = fromRoute.agentes.findIndex(a => a.id === agenteId);
      if(agenteIndex > -1) {
        if(toRoute.agentes.length >= 15) {
          alert('Esta unidad ya está llena (máx 15 pasajeros).');
          return prevRoutes;
        }
        const [agente] = fromRoute.agentes.splice(agenteIndex, 1);
        toRoute.agentes.push(agente);
      }
      newRoutes[fromRouteIndex] = fromRoute;
      newRoutes[toRouteIndex] = toRoute;
      syncToBackend(newRoutes);
      return newRoutes;
    });
    addLog(`Pasajero ${agenteId} reasignado manualmente por Drag & Drop.`);
  };

  const handleFileChange = (event) => { 
    setSelectedFile(event.target.files[0]); 
    setRoutes([]); 
    setError(null); 
  };

  const handleGenerateRoutes = async () => {
    if (!selectedFile) {
      setError("Por favor, seleccione un archivo Excel para procesar.");
      return;
    }
    // Ya no es obligatorio llenar todos los filtros (si dejan vacio, el backend trae todo)
    setIsLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('fecha', filtroFecha);
    formData.append('hora', filtroHora);
    formData.append('sentido', filtroSentido);
    formData.append('sede', filtroSede);

    try {
      const response = await fetch(`/api/assign-routes/`, { method: 'POST', body: formData });
      if (!response.ok) {
        const errData = await response.json();
        let errMsg = errData.detail;
        if (typeof errMsg === 'object') {
          errMsg = JSON.stringify(errMsg).replace(/[\[\]"{}]+/g, ' '); // Clean up the JSON string for the user
        }
        throw new Error(errMsg || 'Ocurrió un error interno en el servidor.');
      }
      const result = await response.json();
      setRoutes(result);
      addLog(`Rutas generadas para ${new Set(result.map(r => r.conductor)).size} vehículos usando Smart Routing.`);
    } catch (err) {
      setError(err.message);
      addLog(`ERROR al generar rutas: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmergencyAction = async (emergencyData) => {
    const { conductor_id, tipo_emergencia, horario } = emergencyData;
    if (tipo_emergencia === 'Retraso por Tráfico') {
      const message = `ALERTA DE TRÁFICO: La ruta de ${conductor_id} presenta retrasos.`;
      alert(message);
      addLog(message);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/emergency-reassign/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(emergencyData) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Error en la reasignación.');
      alert(data.message);
      setRoutes(data.rutas_actualizadas);
      addLog(`🚨 URGENTE: Ruta de ${conductor_id} (${horario}) reasignada a ${data.rescatista_id}.`);
    } catch (err) {
      alert(`Error: ${err.message}`);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualAssign = (routeToAssign) => {
    const newDriverId = prompt(`Ingrese el ID de la unidad (ej. TAXI-001) para la zona ${routeToAssign.micro_zona}:`);
    if (newDriverId) {
      setRoutes(prevRoutes => prevRoutes.map(route => route === routeToAssign ? { ...route, conductor: newDriverId } : route));
      addLog(`✅ Ruta en ${routeToAssign.micro_zona} asignada a unidad ${newDriverId}.`);
    }
  };

  const handleExportToExcel = async () => {
    if (routes.length === 0) return;
    const flatData = routes.flatMap(route => route.agentes.map(agente => ({ 'Conductor': route.conductor, 'Micro-Zona': route.micro_zona, 'Horario': route.horario, 'DNI': agente.id, 'Nombre': agente.nombre, 'Dirección': agente.direccion })));
    const worksheet = XLSX.utils.json_to_sheet(flatData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Rutas");
    XLSX.writeFile(workbook, "Rutas_Export.xlsx");
    addLog("Exportación a Excel generada.");
  };

  const handleClearBoard = async () => {
    if(!window.confirm("¿Limpiar tablero?")) return;
    setRoutes([]);
    localStorage.removeItem('kapital_current_routes');
    setSelectedFile(null);
    setError(null);
  };

  return (
    <>
      <KPIDashboard routes={routes} />
      
      <div className="card" style={{ padding: '0', overflow: 'hidden', border: '1px solid var(--border-color)', boxShadow: '0 10px 40px rgba(0,0,0,0.12)' }}>
        
        {/* Header Premium */}
        <div className="premium-card-header">
          <h2 style={{ margin: '0 0 10px 0', fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '15px', position: 'relative', zIndex: 1 }}>
            <span style={{ fontSize: '2.5rem' }}>🧠</span> Motor de Ruteo Automático
            <span style={{ fontSize: '1rem', background: 'rgba(255,255,255,0.25)', padding: '5px 12px', borderRadius: '30px', backdropFilter: 'blur(10px)', letterSpacing: '0.5px' }}>Powered by IA</span>
          </h2>
          <p style={{ margin: 0, opacity: 0.95, fontSize: '1.05rem', position: 'relative', zIndex: 1 }}>
            Nuestra inteligencia espacial aglomerará automáticamente grupos de 15 pasajeros buscando las rutas de mayor eficiencia térmica.
          </p>
        </div>
        
        {/* Grid Principal Responsivo */}
        <div className="dashboard-grid">
          
          {/* Columna Izquierda: Filtros Inteligentes */}
          <div style={{ borderRight: '1px solid var(--border-color)', paddingRight: '20px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '25px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.3rem' }}>
              <span className="badge-step">1</span> Filtros del Turno
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '25px', fontStyle: 'italic' }}>
              Si no configuras filtros, procesaremos toda la base de datos libremente.
            </p>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <div className="filter-group">
                <label style={{display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)'}}>📅 Fecha Exacta</label>
                <input className="form-input-premium" type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)} />
              </div>
              <div className="filter-group">
                <label style={{display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)'}}>⏰ Hora de Inicio</label>
                <input className="form-input-premium" type="time" value={filtroHora} onChange={e => setFiltroHora(e.target.value)} />
              </div>
              <div className="filter-group">
                <label style={{display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)'}}>🔄 Sentido de Ruta</label>
                <input className="form-input-premium" type="text" value={filtroSentido} onChange={e => setFiltroSentido(e.target.value)} placeholder="Ej: INGRESO" />
              </div>
              <div className="filter-group">
                <label style={{display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)'}}>🏢 Sede Corporativa</label>
                <input className="form-input-premium" type="text" value={filtroSede} onChange={e => setFiltroSede(e.target.value)} placeholder="Ej: BELLAVISTA" />
              </div>
            </div>
          </div>

          {/* Columna Derecha: Dropzone y Subida de Archivo */}
          <div style={{ paddingLeft: '10px', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ marginTop: 0, marginBottom: '25px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.3rem' }}>
              <span className="badge-step">2</span> Base de Datos
            </h3>
            
            <div className="file-dropzone">
              <input type="file" accept=".xlsx, .xls" onChange={handleFileChange} style={{ opacity: 0, position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'pointer', zIndex: 10 }} />
              <div className="folder-icon">📂</div>
              <p style={{ margin: 0, fontWeight: '700', fontSize: '1.2rem', color: 'var(--primary-color)', textAlign: 'center' }}>
                {selectedFile ? selectedFile.name : "Arrastra o haz clic para subir tu Excel"}
              </p>
              <p style={{ margin: '10px 0 0 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                Soporta .xlsx (El motor filtrará y mapeará las columnas)
              </p>
            </div>
          </div>
        </div>

        {/* Footer Acción */}
        <div style={{ padding: '25px 30px', background: 'var(--bg-primary)', borderTop: '1px solid var(--border-color)', display: 'flex', flexWrap: 'wrap', gap: '15px', justifyContent: 'space-between', alignItems: 'center' }}>
           <div style={{ display: 'flex', gap: '10px' }}>
             {routes.length > 0 && (
                <>
                  <button className="btn-secondary" onClick={handleExportToExcel} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '8px' }}>
                    <span style={{ fontSize: '1.2rem' }}>📥</span> Exportar Excel
                  </button>
                  <button className="btn-danger" onClick={handleClearBoard} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '8px', background: 'transparent', color: '#ef4444', border: '1px solid #ef4444' }}>
                    <span style={{ fontSize: '1.2rem' }}>🗑️</span> Limpiar Tablero
                  </button>
                </>
              )}
           </div>
           
           <button 
              className="btn-generate-ai" 
              onClick={handleGenerateRoutes} 
              disabled={isLoading || !selectedFile}
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin" style={{ height: '20px', width: '20px' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75"></path></svg>
                  Analizando Coordenadas...
                </>
              ) : (
                <>🚀 Iniciar Generación Automática</>
              )}
           </button>
        </div>
      </div>
      
      {isLoading && <div className="loading-indicator">Ejecutando algoritmo K-Means. Agrupando cientos de pasajeros...</div>}
      {error && <div className="error-message">Error: {error}</div>}
      {routes.length > 0 && <LiveMap routes={routes} />}
      {routes.length > 0 && (
        <div className="routes-grid">
          {routes.map((route, index) => (
            <DriverCard key={`${route.conductor}-${index}`} route={route} routeIndex={index} onManualAssign={handleManualAssign} onDragStart={handleDragStart} onDrop={handleDrop} />
          ))}
        </div>
      )}
      <EmergencyCenter onEmergencyAction={handleEmergencyAction} isLoading={isLoading} />
    </>
  );
};


// --- Componente Raíz ---
function App() {


  const [usuarioActual, setUsuarioActual] = useState(null);
  const [vistaActual, setVistaActual] = useState('dashboard');
  const [routes, setRoutes] = useState(() => {
    const savedRoutes = localStorage.getItem('kapital_current_routes');
    return savedRoutes ? JSON.parse(savedRoutes) : [];
  });
  const [logs, setLogs] = useState(() => {
    const savedLogs = localStorage.getItem('kapital_audit_logs');
    return savedLogs ? JSON.parse(savedLogs) : [];
  });
  const [theme, setTheme] = useState(localStorage.getItem('kapital_theme') || 'dark');

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('kapital_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('kapital_current_routes', JSON.stringify(routes));
  }, [routes]);

  // Sincronización en Tiempo Real
  useEffect(() => {
    if (!usuarioActual) return;
    const syncRoutes = async () => {
      try {
        const res = await fetch('/api/routes');
        if (res.ok) {
          const data = await res.json();
          setRoutes(prev => JSON.stringify(prev) !== JSON.stringify(data) ? data : prev);
        }
      } catch (err) {
        console.error("Error en sincronización en tiempo real:", err);
      }
    };
    
    const intervalId = setInterval(syncRoutes, 3000);
    syncRoutes();
    
    return () => clearInterval(intervalId);
  }, [usuarioActual]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  useEffect(() => {
    const userFromStorage = localStorage.getItem('kapital_user');
    if (userFromStorage) {
      setUsuarioActual(JSON.parse(userFromStorage));
    }
  }, []);

  const handleLogin = (userData) => {
    localStorage.setItem('kapital_user', JSON.stringify(userData));
    setUsuarioActual(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('kapital_user');
    setUsuarioActual(null);
  };

  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prevLogs => {
      const newLogs = [`[${timestamp}] - ${message}`, ...prevLogs].slice(0, 50);
      localStorage.setItem('kapital_audit_logs', JSON.stringify(newLogs));
      return newLogs;
    });
  };

  const renderVista = () => {
    switch (vistaActual) {
      case 'flota': return <FlotaView />;
      case 'reportes': return <VistaReportes />;
      case 'configuracion': return <VistaConfiguracion />;
      case 'usuarios': return <UsersManagementTab usuarioActual={usuarioActual} />;
      case 'perfil': return <VistaPerfil usuario={usuarioActual} setUsuarioActual={setUsuarioActual} onLogout={handleLogout} />;
      case 'dashboard':
      default:
        return <DashboardView routes={routes} addLog={addLog} setRoutes={setRoutes} />;
    }
  };

  if (!usuarioActual) {
    return <PantallaAuth onLogin={handleLogin} />;
  }

  if (usuarioActual.rol === 'Conductor') {
    return <DriverPortal usuario={usuarioActual} setUsuarioActual={setUsuarioActual} onLogout={handleLogout} />;
  }

  if (usuarioActual.rol === 'Cliente') {
    return <ClientPortal usuario={usuarioActual} onLogout={handleLogout} />;
  }

  return (
    <div className="App">
      <Navbar vistaActual={vistaActual} setVistaActual={setVistaActual} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} usuarioActual={usuarioActual} />
      <main className="app-container">
        {renderVista()}
        <AuditLog logs={logs} />
        <CopilotChat />
      </main>
    </div>
  );
}

export default App;
