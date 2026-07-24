// App.jsx
import React, { useState, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import './App.css';

// --- Componente de Autenticación ---
const PantallaAuth = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({ email: '', password: '', nombre: '', rol: 'Administrador' });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    const payload = isLogin ? { email: formData.email, password: formData.password } : formData;

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
        alert('¡Registro exitoso! Por favor, inicia sesión.');
        setIsLogin(true);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-branding">
        <h1>Kapital Routing</h1>
        <p>Revolucionando la logística corporativa.</p>
      </div>
      <div className="auth-form-wrapper">
        <form onSubmit={handleSubmit} className="auth-form">
          <h2>{isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'}</h2>
          {error && <p className="error-message" style={{textAlign: 'center'}}>{error}</p>}
          {!isLogin && <input className="auth-input" name="nombre" type="text" placeholder="Nombre Completo" onChange={handleInputChange} required />}
          <input className="auth-input" name="email" type="email" placeholder="Correo Electrónico" onChange={handleInputChange} required />
          <input className="auth-input" name="password" type="password" placeholder="Contraseña" onChange={handleInputChange} required />
          {!isLogin && (
            <select className="auth-input" name="rol" onChange={handleInputChange}>
              <option>Administrador</option>
              <option>Coordinador</option>
            </select>
          )}
          <button type="submit" className="auth-button">{isLogin ? 'Ingresar' : 'Registrarse'}</button>
          <p className="auth-toggle" onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? '¿No tienes cuenta? Regístrate aquí' : '¿Ya tienes cuenta? Inicia sesión'}
          </p>
        </form>
      </div>
    </div>
  );
};


// --- Componentes de Vistas ---
const Navbar = ({ vistaActual, setVistaActual, onLogout }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  const handleNav = (vista) => {
    setVistaActual(vista);
    setIsOpen(false);
  };

  return (
    <nav className="navbar">
      <h1 className="navbar-title">Kapital Routing</h1>
      <button className="hamburger-menu" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? '✕' : '☰'}
      </button>
      <div className={`nav-links ${isOpen ? 'open' : ''}`}>
        <a onClick={() => handleNav('dashboard')} className={vistaActual === 'dashboard' ? 'nav-link active' : 'nav-link'}>Dashboard</a>
        <a onClick={() => handleNav('flota')} className={vistaActual === 'flota' ? 'nav-link active' : 'nav-link'}>Gestión de Flota</a>
        <a onClick={() => handleNav('reportes')} className={vistaActual === 'reportes' ? 'nav-link active' : 'nav-link'}>Reportes</a>
        <a onClick={() => handleNav('configuracion')} className={vistaActual === 'configuracion' ? 'nav-link active' : 'nav-link'}>Configuración</a>
        <span className="nav-separator">|</span>
        <a onClick={() => handleNav('perfil')} className={vistaActual === 'perfil' ? 'nav-link active' : 'nav-link'}>👤 Mi Perfil</a>
        <a onClick={() => { onLogout(); setIsOpen(false); }} className="nav-link">Cerrar Sesión</a>
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
const VistaReportes = () => ( <div className="card"><div className="card-header"><h2>Reportes Históricos</h2></div></div> );
const VistaConfiguracion = () => ( <div className="card"><div className="card-header"><h2>Configuración del Algoritmo</h2></div></div> );
const KPICard = ({ title, value, color }) => ( <div className="kpi-card" style={{ borderLeftColor: color }}><span className="kpi-value">{value}</span><span className="kpi-title">{title}</span></div> );
const KPIDashboard = ({ routes }) => { const kpis = useMemo(() => { const totalAgentes = routes.reduce((sum, route) => sum + route.agentes.length, 0); const flotaActiva = new Set(routes.filter(r => r.conductor !== "SIN ASIGNAR").map(r => r.conductor)).size; const capacidadTotal = flotaActiva * 15; const tasaOptimizacion = capacidadTotal > 0 ? ((totalAgentes / capacidadTotal) * 100).toFixed(1) : 0; const rutasProgramadas = routes.length; return { totalAgentes, flotaActiva, tasaOptimizacion, rutasProgramadas }; }, [routes]); return ( <div className="kpi-container"><KPICard title="Total Agentes" value={kpis.totalAgentes} color="#007BFF" /><KPICard title="Flota Activa (Vehículos)" value={kpis.flotaActiva} color="#10B981" /><KPICard title="Rutas Programadas" value={kpis.rutasProgramadas} color="#fd7e14" /><KPICard title="Tasa de Optimización" value={`${kpis.tasaOptimizacion}%`} color="#6f42c1" /></div> ); };
const DriverCard = ({ route, onManualAssign }) => { const notificarWhatsApp = () => { const message = `Hola ${route.conductor}, tu ruta de las ${route.horario} en ${route.micro_zona} ha sido asignada. Llevas a ${route.agentes.length} pasajeros.`; window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank'); }; return ( <div className="driver-card"><div className="driver-card-header"><div><h3>{route.conductor}</h3><p style={{ margin: 0, fontSize: '0.9rem', color: '#525F7F' }}>{route.horario}</p></div><div style={{ textAlign: 'right' }}><span className="micro-zone-badge">{route.micro_zona}</span>{route.conductor === "SIN ASIGNAR" ? <button onClick={() => onManualAssign(route)} className="btn-manual-assign">Asignar Unidad</button> : <button onClick={notificarWhatsApp} className="btn-whatsapp">Notificar</button>}</div></div><ul className="agent-list">{route.agentes.map(agente => <li key={agente.id}>{agente.id} - {agente.direccion}</li>)}</ul></div> ); };
const EmergencyCenter = ({ onEmergencyAction, isLoading }) => { const [conductorId, setConductorId] = useState(''); const [tipoEmergencia, setTipoEmergencia] = useState('Baja Total (Siniestro)'); const [horario, setHorario] = useState('Todos los turnos'); const handleActionClick = () => { if (conductorId) onEmergencyAction({ conductor_id: conductorId, tipo_emergencia: tipoEmergencia, horario }); }; const isSos = tipoEmergencia === 'Retraso por Tráfico'; const buttonClass = isSos ? 'btn-sos' : 'btn-danger'; const buttonText = isSos ? 'Enviar SOS por WhatsApp' : 'Reasignar Emergencia'; return ( <div className="card"><div className="card-header"><h2>Centro de Control de Incidentes</h2></div><div className="emergency-form"><input className="form-input" type="text" placeholder="ID Conductor Afectado" value={conductorId} onChange={(e) => setConductorId(e.target.value)} /><select className="form-select" value={tipoEmergencia} onChange={(e) => setTipoEmergencia(e.target.value)}><option>Baja Total (Siniestro)</option><option>Falla Temporal (Reasignar Turno)</option><option>Retraso por Tráfico</option></select><select className="form-select" value={horario} onChange={(e) => setHorario(e.target.value)} disabled={isSos}><option>Todos los turnos</option><option>08:00 AM</option><option>10:00 AM</option><option>06:00 PM</option></select><button className={buttonClass} onClick={handleActionClick} disabled={isLoading || !conductorId}>{buttonText}</button></div></div> ); };
const AuditLog = ({ logs }) => ( <div className="card"><div className="card-header"><h2>Registro de Actividad (Audit Log)</h2></div><div className="audit-log-container">{logs.map((log, index) => <p key={index} className="log-entry">{log}</p>)}</div></div> );
const DashboardView = ({ routes, addLog, setRoutes }) => { const [selectedFile, setSelectedFile] = useState(null); const [isLoading, setIsLoading] = useState(false); const [error, setError] = useState(null); const handleFileChange = (event) => { setSelectedFile(event.target.files[0]); setRoutes([]); setError(null); }; const handleGenerateRoutes = async () => { if (!selectedFile) { setError("Por favor, seleccione un archivo Excel para procesar."); return; } setIsLoading(true); setError(null); const formData = new FormData(); formData.append('file', selectedFile); try { const response = await fetch(`/api/assign-routes/`, { method: 'POST', body: formData }); if (!response.ok) throw new Error((await response.json()).detail || 'Ocurrió un error.'); const result = await response.json(); setRoutes(result); addLog(`Rutas generadas para ${new Set(result.map(r => r.conductor)).size} vehículos.`); } catch (err) { setError(err.message); addLog(`ERROR al generar rutas: ${err.message}`); } finally { setIsLoading(false); } }; const handleEmergencyAction = async (emergencyData) => { const { conductor_id, tipo_emergencia, horario } = emergencyData; if (tipo_emergencia === 'Retraso por Tráfico') { const message = `ALERTA DE TRÁFICO: La ruta del conductor ${conductor_id} presenta retrasos. Se notificará a los pasajeros.`; alert(message); addLog(message); return; } setIsLoading(true); setError(null); try { const response = await fetch(`/api/emergency-reassign/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(emergencyData) }); const data = await response.json(); if (!response.ok) throw new Error(data.detail || 'Error en la reasignación.'); alert(data.message); setRoutes(data.rutas_actualizadas); addLog(`🚨 URGENTE: Ruta de ${conductor_id} (${horario}) reasignada a la unidad ${data.rescatista_id}.`); } catch (err) { alert(`Error: ${err.message}`); setError(err.message); addLog(`ERROR en emergencia para ${conductor_id}: ${err.message}`); } finally { setIsLoading(false); } }; const handleManualAssign = (routeToAssign) => { const newDriverId = prompt(`Ingrese el ID de la unidad externa o retén (ej. TAXI-001) para la ruta de ${routeToAssign.micro_zona} a las ${routeToAssign.horario}:`); if (newDriverId) { setRoutes(prevRoutes => prevRoutes.map(route => route === routeToAssign ? { ...route, conductor: newDriverId } : route)); addLog(`✅ RESOLUCIÓN: Ruta de desborde en ${routeToAssign.micro_zona} (${routeToAssign.horario}) asignada manualmente a la unidad ${newDriverId}.`); } }; const handleExportToExcel = () => { if (routes.length === 0) return; const flatData = routes.flatMap(route => route.agentes.map(agente => ({ 'Conductor': route.conductor, 'Micro-Zona': route.micro_zona, 'Horario': route.horario, 'ID Agente': agente.id, 'Dirección': agente.direccion }))); const worksheet = XLSX.utils.json_to_sheet(flatData); const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, "Rutas Kapital"); XLSX.writeFile(workbook, "Rutas_Kapital_Export.xlsx"); addLog("Exportación a Excel generada."); }; const handleClearBoard = () => { setRoutes([]); setSelectedFile(null); setError(null); addLog("Tablero reiniciado para nuevo turno."); }; return ( <> <KPIDashboard routes={routes} /> <div className="card"> <div className="card-header"><h2>Panel de Operaciones Logísticas</h2></div> <div className="controls-container"> <input type="file" accept=".xlsx, .xls" onChange={handleFileChange} /> <button className="btn-primary" onClick={handleGenerateRoutes} disabled={isLoading || !selectedFile}>{isLoading ? 'Procesando...' : 'Generar Rutas'}</button> {routes.length > 0 && (<><button className="btn-secondary" onClick={handleExportToExcel}>Exportar a Excel</button><button className="btn-clear" onClick={handleClearBoard}>Limpiar Tablero</button></>)} </div> </div> {isLoading && <div className="loading-indicator">Procesando...</div>} {error && <div className="error-message">Error: {error}</div>} {routes.length > 0 && <div className="routes-grid">{routes.map((route, index) => <DriverCard key={`${route.conductor}-${index}`} route={route} onManualAssign={handleManualAssign} />)}</div>} <EmergencyCenter onEmergencyAction={handleEmergencyAction} isLoading={isLoading} /> </> ); };


// --- Componente Raíz ---
function App() {
  const [usuarioActual, setUsuarioActual] = useState(null);
  const [vistaActual, setVistaActual] = useState('dashboard');
  const [routes, setRoutes] = useState([]);
  const [logs, setLogs] = useState([]);

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
    setLogs(prevLogs => [`[${timestamp}] - ${message}`, ...prevLogs]);
  };

  const renderVista = () => {
    switch (vistaActual) {
      case 'flota': return <VistaFlota />;
      case 'reportes': return <VistaReportes />;
      case 'configuracion': return <VistaConfiguracion />;
      case 'perfil': return <VistaPerfil usuario={usuarioActual} setUsuarioActual={setUsuarioActual} onLogout={handleLogout} />;
      case 'dashboard':
      default:
        return <DashboardView routes={routes} addLog={addLog} setRoutes={setRoutes} />;
    }
  };

  if (!usuarioActual) {
    return <PantallaAuth onLogin={handleLogin} />;
  }

  return (
    <div className="App">
      <Navbar vistaActual={vistaActual} setVistaActual={setVistaActual} onLogout={handleLogout} />
      <main className="app-container">
        {renderVista()}
        <AuditLog logs={logs} />
      </main>
    </div>
  );
}

export default App;
