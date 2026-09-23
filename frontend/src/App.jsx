// App.jsx - Trigger Vercel Deploy 
import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { History, Activity, Shield, ShieldCheck, MapPin, Truck, Smartphone, AlertTriangle, Key, LayoutDashboard, Settings, UserCircle, Save, LogOut, Navigation, Clock, CheckCircle2, FileText, CheckCircle, Search, Eye, Filter, User, Moon, Sun, Camera, X, Edit3, PlusCircle, MinusCircle, XCircle, CheckSquare, Calendar, Circle, Image as ImageIcon, Maximize2, Play, Check, Download, UploadCloud } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import { GlobalLoader } from './components/GlobalLoader';
import { apiFetch, logoutSession, setSessionExpiredHandler } from './utils/apiClient';
import { olvidarUrlsFirmadas } from './utils/documentoStorage';
import './App.css';

const ADMIN_WS_STATE_EVENT = 'kapital:admin-ws-state';
const ADMIN_NOTIFICATION_ROLES = new Set([
  'Administración',
  'Administrador',
  'Gerente de Operaciones',
  'Admin',
  'Programador de rutas',
]);
const ADMIN_POLL_INTERVAL_MS = 90_000;
const ADMIN_POLL_BACKOFF_BASE_MS = 60_000;
const ADMIN_POLL_BACKOFF_MAX_MS = 10 * 60_000;
const ADMIN_REQUEST_TIMEOUT_MS = 12_000;
const ADMIN_POLL_ACTIVITY_COOLDOWN_MS = 15_000;
const RETRYABLE_ADMIN_STATUS_CODES = new Set([402, 408, 429, 500, 502, 503, 504]);

export { GlobalLoader };

const LiveMap = React.lazy(() => import('./LiveMap'));
const FlotaView = React.lazy(() => import('./FlotaView'));
const DriverPortal = React.lazy(() => import('./DriverPortal'));
const GerentePortal = React.lazy(() => import('./GerentePortal'));
const VistaReportes = React.lazy(() => import('./VistaReportes'));
const ClientPortal = React.lazy(() => import('./ClientPortal'));
const AdminDashboard = React.lazy(() => import('./AdminDashboard'));
const UsersManagementTab = React.lazy(() => import('./components/UsersManagementTab'));
const HistorialActividad = React.lazy(() => import('./HistorialActividad'));
const VistaPerfil = React.lazy(() => import('./VistaPerfil'));
const ProgramadorWorkbench = React.lazy(() => import('./programador/ProgramadorWorkbench'));
const ProgramadorFlota = React.lazy(() => import('./programador/FlotaProgramador'));
const ProgramadorAnalisis = React.lazy(() => import('./programador/AnalisisView'));
const ProgramadorConfig = React.lazy(() => import('./programador/ConfiguracionView'));
const ProgramadorHistorico = React.lazy(() => import('./programador/HistoricoView'));

// --- Componente de Autenticación ---
const PantallaAuth = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isVerificationStep, setIsVerificationStep] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [formData, setFormData] = useState({ identifier: '', email: '', dni: '', password: '', confirmar_password: '', telefono: '', nombre: '', rol: 'Programador de rutas', unidad_id: '', empresa_id: '' });

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
    const registerIdentifier = formData.rol === 'Conductor' ? formData.dni : formData.email;
    const registerPayload = {
      identifier: (registerIdentifier || '').trim(),
      password: formData.password,
      nombre: formData.nombre,
      rol: formData.rol,
      telefono: formData.telefono || null,
      unidad_id: formData.unidad_id || null,
      empresa_id: formData.empresa_id || null,
    };
    const payload = isLogin
      ? { identifier: formData.identifier.trim(), password: formData.password }
      : registerPayload;

    setIsAuthLoading(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      let data = {};
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch (jsonErr) {
        data = { detail: `Error en la respuesta del servidor (${response.status})` };
      }

      if (!response.ok) {
        throw new Error(data.detail || data.message || `Error ${response.status}: Error en el servidor.`);
      }
      
      if (isLogin) {
        if (data && data.needs_password_change) {
          data.typedPassword = formData.password;
        }
        onLogin(data);
      } else {
        toast.success('¡Solicitud enviada! Tu cuenta está Pendiente de Aprobación por Administración.', { duration: 5000 });
        setIsLogin(true);
      }
    } catch (err) {
      setError(err.message);
      toast.error(`Error: ${err.message}`);
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
            
            {!isLogin && (
              <>
                <select className="auth-input" name="rol" onChange={handleInputChange} value={formData.rol}>
                  <option>Programador de rutas</option>
                  <option>Administración</option>
                  <option>Conductor</option>
                  <option>Gerente de Operaciones</option>
                </select>
              </>
            )}

            {/* El conductor también da su nombre al registrarse. Sin él entraba
                como «Conductor Pendiente» y Administración no tenía forma de
                saber a quién estaba aprobando hasta que completara el alta. */}
            {!isLogin && <input className="auth-input" name="nombre" type="text" placeholder="Nombre Completo" autoComplete="name" onChange={handleInputChange} required />}
            
            {!isLogin && formData.rol !== 'Conductor' && (
              <input className="auth-input" name="telefono" type="tel" placeholder="Teléfono" onChange={handleInputChange} required />
            )}

            {isLogin ? (
              <input className="auth-input" name="identifier" type="text" placeholder="Correo Electrónico o DNI" onChange={handleInputChange} required />
            ) : (
              formData.rol === 'Conductor' ? (
                <input className="auth-input" name="dni" type="text" placeholder="DNI (Documento de Identidad)" autoComplete="username" onChange={handleInputChange} required />
              ) : (
                <input className="auth-input" name="email" type="email" placeholder="Correo Electrónico" autoComplete="username" onChange={handleInputChange} required />
              )
            )}
            
            <input className="auth-input" name="password" type="password" placeholder="Contraseña" autoComplete={isLogin ? "current-password" : "new-password"} onChange={handleInputChange} required />
            
            {!isLogin && (
              <input className="auth-input" name="confirmar_password" type="password" placeholder="Confirmar Contraseña" autoComplete="new-password" onChange={handleInputChange} required />
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


// --- Componente de Cambio de Contraseña Forzado ---
const PasswordChangeModal = ({ user, onSuccess, onCancel }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (newPassword.length < 4) {
      setError('La contraseña debe tener al menos 4 caracteres.');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setIsLoading(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        json: {
          identifier: user.identifier || user.dni || user.email,
          old_password: user.typedPassword || user.identifier || user.dni,
          new_password: newPassword,
        },
      });

      toast.success('Contraseña actualizada correctamente.');
      onSuccess({ ...user, needs_password_change: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-form-wrapper" style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div className="auth-form-card">
          <div className="auth-logo-container">
            <ShieldCheck size={48} color="var(--kapital-accent-green)" />
          </div>
          <form onSubmit={handleSubmit} className="auth-form">
            <h2>Actualización Requerida</h2>
            <p className="auth-subtitle">
              Por motivos de seguridad, debes establecer una contraseña privada nueva para continuar.
            </p>
            {error && <p className="error-message" style={{textAlign: 'center'}}>{error}</p>}
            
            <input className="auth-input" type="password" placeholder="Nueva Contraseña" onChange={(e) => setNewPassword(e.target.value)} required />
            <input className="auth-input" type="password" placeholder="Confirmar Nueva Contraseña" onChange={(e) => setConfirmPassword(e.target.value)} required />
            
            <button type="submit" className="auth-button" disabled={isLoading}>
              {isLoading ? 'Actualizando...' : 'Guardar y Continuar'}
            </button>
            <button type="button" onClick={onCancel} className="auth-button" style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text)', marginTop: '10px' }}>
              Cancelar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// --- Componentes de Vistas ---



const Navbar = ({ vistaActual, setVistaActual, onLogout, theme, toggleTheme, usuarioActual }) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleNav = (vista) => {
    setVistaActual(vista);
    setIsOpen(false);
  };

  return (
    <>
      <nav className="navbar">
        <div className="navbar-left">
          <img src="/logo.png" alt="Kapital Routing Logo" className="navbar-logo" onClick={() => handleNav('dashboard')} />
        </div>

        {/* Desktop nav links — hidden on mobile via CSS */}
        <div className="nav-links-desktop">
          {usuarioActual?.rol === 'Programador de rutas' && (
            <>
              <a onClick={() => handleNav('dashboard')} className={vistaActual === 'dashboard' ? 'nav-link active' : 'nav-link'}>Operación</a>
              <a onClick={() => handleNav('historico')} className={vistaActual === 'historico' ? 'nav-link active' : 'nav-link'}>Cargar datos</a>
              <a onClick={() => handleNav('flota')} className={vistaActual === 'flota' ? 'nav-link active' : 'nav-link'}>Flota</a>
              <a onClick={() => handleNav('reportes')} className={vistaActual === 'reportes' ? 'nav-link active' : 'nav-link'}>Análisis</a>
              <a onClick={() => handleNav('configuracion')} className={vistaActual === 'configuracion' ? 'nav-link active' : 'nav-link'}>Configuración</a>
            </>
          )}
          {usuarioActual?.rol === 'Conductor' && (
            <a onClick={() => handleNav('dashboard')} className={vistaActual === 'dashboard' ? 'nav-link active' : 'nav-link'}>Mis Rutas</a>
          )}
          {usuarioActual?.rol === 'Cliente' && (
            <a onClick={() => handleNav('flota')} className={vistaActual === 'flota' ? 'nav-link active' : 'nav-link'}>Control de Conformidad</a>
          )}
          {['Administración', 'Administrador'].includes(usuarioActual?.rol) && (
            <>
              <a onClick={() => handleNav('dashboard')} className={vistaActual === 'dashboard' ? 'nav-link active' : 'nav-link'}>Resumen</a>
              <a onClick={() => handleNav('flota')} className={vistaActual === 'flota' ? 'nav-link active' : 'nav-link'}>Gestión de Flota</a>
              <a onClick={() => handleNav('usuarios')} className={vistaActual === 'usuarios' ? 'nav-link nav-link-icon active' : 'nav-link nav-link-icon'} style={{color: '#38BDF8'}}>
                <Shield size={18} /> Accesos
              </a>
              <a onClick={() => handleNav('historial')} className={vistaActual === 'historial' ? 'nav-link nav-link-icon active' : 'nav-link nav-link-icon'}>
                <History size={18} /> Historial
              </a>
            </>
          )}
          <span className="nav-separator">|</span>
          <a onClick={() => handleNav('perfil')} className={vistaActual === 'perfil' ? 'nav-link nav-link-icon active' : 'nav-link nav-link-icon'}>
            <User size={18} style={{ marginRight: '6px' }} /> Mi Perfil
          </a>
          <a onClick={() => { onLogout(); }} className="nav-link">Cerrar Sesión</a>
          <button onClick={toggleTheme} className="theme-toggle" title="Cambiar Tema">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} color="#facc15" fill="#facc15" />}
          </button>
        </div>

        {/* Botón hamburguesa — solo visible en mobile */}
        <button className="hamburger-menu" onClick={() => setIsOpen(!isOpen)} aria-label="Menú">
          {isOpen ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/>
            </svg>
          )}
        </button>
      </nav>

      {/* Overlay oscuro y Menu Lateral (Drawer) */}
      <div className={`nav-overlay ${isOpen ? 'open' : ''}`} onClick={() => setIsOpen(false)} />
      <div className={`nav-links ${isOpen ? 'open' : ''}`}>
        {usuarioActual?.rol === 'Programador de rutas' && (
          <>
            <a onClick={() => handleNav('dashboard')} className={vistaActual === 'dashboard' ? 'nav-link active' : 'nav-link'}>
              <LayoutDashboard size={20} />
              <span>Operación</span>
            </a>
            <a onClick={() => handleNav('historico')} className={vistaActual === 'historico' ? 'nav-link active' : 'nav-link'}>
              <UploadCloud size={20} />
              <span>Cargar datos</span>
            </a>
            <a onClick={() => handleNav('flota')} className={vistaActual === 'flota' ? 'nav-link active' : 'nav-link'}>
              <Truck size={20} />
              <span>Flota</span>
            </a>
            <a onClick={() => handleNav('reportes')} className={vistaActual === 'reportes' ? 'nav-link active' : 'nav-link'}>
              <FileText size={20} />
              <span>Análisis</span>
            </a>
            <a onClick={() => handleNav('configuracion')} className={vistaActual === 'configuracion' ? 'nav-link active' : 'nav-link'}>
              <Settings size={20} />
              <span>Configuración</span>
            </a>
          </>
        )}
        {usuarioActual?.rol === 'Conductor' && (
          <a onClick={() => handleNav('dashboard')} className={vistaActual === 'dashboard' ? 'nav-link active' : 'nav-link'}>
            <Truck size={20} />
            <span>Mis Rutas</span>
          </a>
        )}
        {usuarioActual?.rol === 'Cliente' && (
          <a onClick={() => handleNav('flota')} className={vistaActual === 'flota' ? 'nav-link active' : 'nav-link'}>
            <Truck size={20} />
            <span>Conformidad</span>
          </a>
        )}
        {['Administración', 'Administrador'].includes(usuarioActual?.rol) && (
          <>
            <a onClick={() => handleNav('dashboard')} className={vistaActual === 'dashboard' ? 'nav-link active' : 'nav-link'}>
              <LayoutDashboard size={20} />
              <span>Resumen</span>
            </a>
            <a onClick={() => handleNav('flota')} className={vistaActual === 'flota' ? 'nav-link active' : 'nav-link'}>
              <Truck size={20} />
              <span>Gestión de Flota</span>
            </a>
            <a onClick={() => handleNav('usuarios')} className={vistaActual === 'usuarios' ? 'nav-link active' : 'nav-link'} style={vistaActual === 'usuarios' ? {color: '#38BDF8'} : {}}>
              <Shield size={20} />
              <span>Accesos B2B</span>
            </a>
            <a onClick={() => handleNav('historial')} className={vistaActual === 'historial' ? 'nav-link active' : 'nav-link'}>
              <History size={20} />
              <span>Historial</span>
            </a>
          </>
        )}
        <span className="nav-separator" style={{display: 'none'}}>|</span>
        <a onClick={() => handleNav('perfil')} className={vistaActual === 'perfil' ? 'nav-link active' : 'nav-link'}>
          <User size={20} />
          <span>Mi Perfil</span>
        </a>
        <a onClick={() => { onLogout(); setIsOpen(false); }} className="nav-link" style={{marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.05)', color: '#ef4444'}}>
          <LogOut size={20} />
          <span>Cerrar Sesión</span>
        </a>
        
        <a onClick={toggleTheme} className="nav-link" style={{cursor: 'pointer'}}>
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} color="#facc15" fill="#facc15" />}
          <span>Tema {theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
        </a>
      </div>
    </>
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
    const zones = {};
    routes.forEach(r => {
      const z = r.micro_zona || 'Sin Zona';
      if (!zones[z]) zones[z] = 0;
      zones[z] += r.agentes.length;
    });
    return Object.keys(zones).map(z => ({ name: z, pasajeros: zones[z] })).sort((a,b) => b.pasajeros - a.pasajeros).slice(0, 15); // Top 15 zones
  }, [routes]);

  const pieData = useMemo(() => {
    let asignados = 0;
    let sinAsignar = 0;
    routes.forEach(r => {
      if (r.conductor && r.conductor.trim() !== "SIN ASIGNAR") {
        asignados += r.agentes.length;
      } else {
        sinAsignar += r.agentes.length;
      }
    });
    if (asignados === 0 && sinAsignar === 0) return [{name: 'Sin datos', value: 1}];
    return [
      { name: 'Asignados', value: asignados },
      { name: 'Faltan Asignar', value: sinAsignar }
    ];
  }, [routes]);
  
  const COLORS = ['#10B981', '#f59e0b', '#334155'];

  return ( 
    <div style={{display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '20px'}}>
      <div className="kpi-container">
        <KPICard title="Total Agentes" value={kpis.totalAgentes} color="#38bdf8" />
        <KPICard title="Flota Activa (Vehículos)" value={kpis.flotaActiva} color="#10B981" />
        <KPICard title="Rutas Programadas" value={kpis.rutasProgramadas} color="#f59e0b" />
        <KPICard title="Tasa de Optimización" value={`${kpis.tasaOptimizacion}%`} color="#14b8a6" />
      </div> 
      {routes.length > 0 && (
      <div style={{display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px'}}>
        <div className="card" style={{flex: '2 1 400px', minWidth: '280px', height: '340px'}}>
          <h3 style={{marginTop: 0, padding: '15px 20px', borderBottom: '1px solid var(--kapital-border)'}}>Demanda por Zona</h3>
          <ResponsiveContainer width="100%" height="80%">
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 25 }}>
              <XAxis dataKey="name" stroke="var(--kapital-text-secondary)" tick={{fontSize: 10}} angle={-35} textAnchor="end" interval={0} />
              <YAxis stroke="var(--kapital-text-secondary)" tick={{fontSize: 11}} />
              <Tooltip contentStyle={{backgroundColor: 'var(--kapital-card-bg)', border: '1px solid var(--kapital-border)', borderRadius: '8px'}} />
              <Bar dataKey="pasajeros" fill="#38bdf8" name="Pasajeros" radius={[4,4,0,0]} barSize={24} animationDuration={1000} animationEasing="ease-out" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card" style={{flex: '1 1 280px', minWidth: '280px', height: '340px'}}>
           <h3 style={{marginTop: 0, padding: '15px 20px', borderBottom: '1px solid var(--kapital-border)'}}>Progreso de Asignación</h3>
           <ResponsiveContainer width="100%" height="80%">
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={5} dataKey="value" animationDuration={1000} animationEasing="ease-out">
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{backgroundColor: 'var(--kapital-card-bg)', border: '1px solid var(--kapital-border)', borderRadius: '8px'}} />
              <Legend wrapperStyle={{fontSize:"12px"}} />
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
const DashboardView = ({ routes, setRoutes, usuarioActual, sessionSaved, onSaveSession, onUnsaveSession, onSessionDirty }) => {
  const syncToBackend = async (newRoutes) => {
    try {
      await apiFetch('/api/routes', {
        method: 'POST',
        headers: { 'X-Owner-Email': usuarioActual?.email || 'Desconocido' },
        json: newRoutes,
      });
    } catch (err) {
      console.error("Error guardando cambios:", err);
    }
  };

  const [selectedFile, setSelectedFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
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
          toast.error('Esta unidad ya está llena (máx 15 pasajeros).');
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
  };

  const handleFileChange = (event) => { 
    const file = event.target.files[0];
    if (!file) return;
    setSelectedFile(file); 
    setRoutes([]); 
    setError(null);

  };

  const handleGenerateRoutes = async () => {
    if (!selectedFile) {
      toast.error("Por favor, seleccione un archivo Excel para procesar.");
      return;
    }
    setIsLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('fecha', filtroFecha);
    formData.append('hora', filtroHora);
    formData.append('sentido', filtroSentido);
    formData.append('sede', filtroSede);

    try {
      const result = await apiFetch('/api/assign-routes/', { method: 'POST', body: formData });
      setRoutes(result);
      if (onSessionDirty) onSessionDirty(); // Mark session as unsaved after new generation
      toast.success(`Rutas generadas para ${new Set(result.map(r => r.conductor)).size} vehículos.`);
    } catch (err) {
      const detail = err?.payload?.detail;
      const message = typeof detail === 'object'
        ? JSON.stringify(detail).replace(/[\[\]"{}]+/g, ' ')
        : (err.message || 'Ocurrió un error interno en el servidor.');
      setError(message);
    } finally {
      setIsLoading(false);

    }
  };

  const handleEmergencyAction = async (emergencyData) => {
    const { conductor_id, tipo_emergencia, horario } = emergencyData;
    if (tipo_emergencia === 'Retraso por Tráfico') {
      const message = `ALERTA DE TRÁFICO: La ruta de ${conductor_id} presenta retrasos.`;
      toast(message);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/emergency-reassign/', { method: 'POST', json: emergencyData });
      toast.success(data.message);
      setRoutes(data.rutas_actualizadas);
    } catch (err) {
      toast.error(`Error: ${err.message}`);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualAssign = (routeToAssign) => {
    const newDriverId = prompt(`Ingrese el ID de la unidad (ej. TAXI-001) para la zona ${routeToAssign.micro_zona}:`);
    if (newDriverId) {
      setRoutes(prevRoutes => prevRoutes.map(route => route === routeToAssign ? { ...route, conductor: newDriverId } : route));
      toast.success(`Ruta en ${routeToAssign.micro_zona} asignada a la unidad ${newDriverId}.`);
    }
  };

  const handleExportToExcel = async () => {
    if (routes.length === 0) return;
    const flatData = routes.flatMap(route => route.agentes.map(agente => ({ 'Conductor': route.conductor, 'Micro-Zona': route.micro_zona, 'Horario': route.horario, 'DNI': agente.id, 'Nombre': agente.nombre, 'Dirección': agente.direccion })));
    const worksheet = XLSX.utils.json_to_sheet(flatData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Rutas");
    XLSX.writeFile(workbook, "Rutas_Export.xlsx");
    toast.success('Exportación a Excel generada.');
  };

  const handleClearBoard = async () => {
    if(!window.confirm("¿Limpiar tablero?")) return;
    setRoutes([]);
    setSelectedFile(null);
    setFileInputKey(prev => prev + 1);
    setError(null);
    // Clear saved session too
    localStorage.removeItem('kapital_saved_session');
    if (onUnsaveSession) onUnsaveSession();
    // Clear on backend
    try {
      await apiFetch('/api/routes', {
        method: 'POST',
        json: [],
      });
    } catch(e) {
      console.error("Error clearing board on server:", e);
    }
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
              <input key={fileInputKey} type="file" accept=".xlsx, .xls" onChange={handleFileChange} style={{ opacity: 0, position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'pointer', zIndex: 10 }} />
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
                  {/* Session Lock Button */}
                  <button
                    onClick={sessionSaved ? onUnsaveSession : onSaveSession}
                    title={sessionSaved ? 'Sesión guardada - Clic para desbloquear' : 'Guardar sesión para que persista al recargar'}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px',
                      borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.9rem',
                      transition: 'all 0.2s ease',
                      background: sessionSaved ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.12)',
                      color: sessionSaved ? '#10b981' : 'var(--primary-color)',
                      border: sessionSaved ? '1px solid #10b981' : '1px solid var(--primary-color)',
                    }}
                  >
                    <span style={{ fontSize: '1.1rem' }}>{sessionSaved ? '🔒' : '🔓'}</span>
                    {sessionSaved ? 'Sesión Guardada' : 'Guardar Sesión'}
                  </button>
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
      {routes.length > 0 && (
        <React.Suspense fallback={<GlobalLoader text="Cargando mapa..." />}>
          <LiveMap routes={routes} />
        </React.Suspense>
      )}
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
const clearStoredUser = () => {
  try {
    localStorage.removeItem('kapital_user');
  } catch {
    // Storage can be unavailable in private browsing; the in-memory session
    // remains unauthenticated in that case.
  }
};
const SESSION_VALIDATION_TIMEOUT_MS = 10000;

function App() {


  const [usuarioActual, setUsuarioActual] = useState(null);
  const profileRefreshRef = React.useRef(0);
  const [isRestoringSession, setIsRestoringSession] = useState(() => {
    try {
      return Boolean(localStorage.getItem('kapital_user'));
    } catch {
      return false;
    }
  });
  const [pendingPasswordChangeUser, setPendingPasswordChangeUser] = useState(null);

  const [vistaActual, setVistaActual] = useState('dashboard');
  const [vistaParams, setVistaParams] = useState({});

  const handleNavigate = (vista, params = {}) => {
    setVistaActual(vista);
    setVistaParams(params);
  };
  const [routes, setRoutes] = useState(() => {
    // Restore saved session if it exists
    try {
      const saved = localStorage.getItem('kapital_saved_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch(e) {}
    return [];
  });
  const [sessionSaved, setSessionSaved] = useState(() => !!localStorage.getItem('kapital_saved_session'));
  const [theme, setTheme] = useState(localStorage.getItem('kapital_theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('kapital_theme', theme);
  }, [theme]);



  const handleSaveSession = async () => {
    if (routes.length === 0) return;
    localStorage.setItem('kapital_saved_session', JSON.stringify(routes));
    setSessionSaved(true);
    const publicando = toast.loading('Publicando al Gerente de Operaciones…');
    try {
      const data = await apiFetch('/api/routes/publish', {
        method: 'POST',
        json: routes,
      });
      toast.success(data.message || 'Datos publicados al Gerente.', { id: publicando });
    } catch (e) {
      toast.error(e?.status
        ? 'Sesión guardada localmente. Error al publicar al Gerente.'
        : 'Sesión guardada localmente (sin conexión al servidor).', { id: publicando });
    }
  };

  const handleUnsaveSession = () => {
    localStorage.removeItem('kapital_saved_session');
    setSessionSaved(false);
    toast('Sesión desbloqueada. El tablero no persistirá al recargar.');
  };

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Punto único donde la app reacciona a una sesión caducada. Antes de esto
  // ninguna de las llamadas manejaba un 401: los botones fallaban en silencio.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      profileRefreshRef.current += 1;
      clearStoredUser();
      setUsuarioActual(null);
      toast.error('Tu sesión expiró. Vuelve a iniciar sesión.');
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeoutId;
    const controller = new AbortController();

    const restoreSession = async () => {
      let parsedUser;

      try {
        const userFromStorage = localStorage.getItem('kapital_user');
        if (!userFromStorage) {
          if (!cancelled) setIsRestoringSession(false);
          return;
        }
        parsedUser = JSON.parse(userFromStorage);
      } catch (err) {
        clearStoredUser();
        if (!cancelled) {
          setUsuarioActual(null);
          setIsRestoringSession(false);
        }
        console.warn('No se pudo leer la sesión almacenada:', err);
        return;
      }

      const userKey = parsedUser?.identifier || parsedUser?.email;
      if (!userKey) {
        clearStoredUser();
        if (!cancelled) {
          setUsuarioActual(null);
          setIsRestoringSession(false);
        }
        return;
      }

      try {
        // La identidad la decide el servidor a partir de la cookie, no
        // localStorage, que aquí solo indica que este navegador ya inició
        // sesión alguna vez (la cookie es HttpOnly y JS no puede verla).
        timeoutId = setTimeout(() => controller.abort(), SESSION_VALIDATION_TIMEOUT_MS);
        const identity = await apiFetch('/api/auth/me', { signal: controller.signal });

        if (!identity || typeof identity !== 'object' || !(identity.identifier || identity.email)) {
          throw new Error('La sesión validada no contiene una identidad utilizable.');
        }
        if (cancelled) return;

        // El perfil trae `perfil_conductor`, que /api/auth/me no incluye y que
        // renderVista necesita. Si falla, la sesión sigue siendo válida: se
        // continúa con la identidad del servidor en lugar de expulsar.
        const profileKey = identity.identifier || identity.email;
        let profile = null;
        try {
          profile = await apiFetch(`/api/user/profile?email=${encodeURIComponent(profileKey)}`, {
            signal: controller.signal,
          });
        } catch (profileErr) {
          if (profileErr?.name !== 'AbortError') {
            console.warn('Sesión válida pero no se pudo cargar el perfil:', profileErr);
          }
        }

        if (cancelled) return;
        const freshUser = { ...parsedUser, ...identity, ...(profile || {}) };
        localStorage.setItem('kapital_user', JSON.stringify(freshUser));
        setUsuarioActual(freshUser);
      } catch (err) {
        if (cancelled) return;
        // A cached user is not a valid session. Remove it so a failed backend
        // validation cannot leave the app in a stale authenticated state.
        clearStoredUser();
        setUsuarioActual(null);
        console.warn('Error validando la sesión almacenada:', err);
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setIsRestoringSession(false);
      }
    };

    restoreSession();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, []);

  const handleLogin = (userData) => {
    if (userData.needs_password_change) {
      setPendingPasswordChangeUser(userData);
    } else {
      localStorage.setItem('kapital_user', JSON.stringify(userData));
      setUsuarioActual(userData);
      // Sin esto, la vista de la sesión anterior sobrevive al cambio de cuenta.
      setVistaActual('dashboard');
      setVistaParams({});

      // Immediately fetch fresh profile so perfil_conductor is loaded before
      // renderVista evaluates it — prevents the "Documentos Faltantes" flash on login
      const refreshRequestId = ++profileRefreshRef.current;
      const userKey = userData.identifier || userData.email;
      if (userKey) {
        const invalidateSession = () => {
          if (refreshRequestId !== profileRefreshRef.current) return;
          clearStoredUser();
          setUsuarioActual(null);
        };
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SESSION_VALIDATION_TIMEOUT_MS);

        apiFetch(`/api/user/profile?email=${encodeURIComponent(userKey)}`, {
          signal: controller.signal,
        })
          .then(data => {
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
              throw new Error('La respuesta del perfil no es válida.');
            }
            return data;
          })
          .then(data => {
            if (data && refreshRequestId === profileRefreshRef.current) {
              const freshUser = { ...userData, ...data };
              localStorage.setItem('kapital_user', JSON.stringify(freshUser));
              setUsuarioActual(freshUser);
            }
          })
          .catch(err => {
            invalidateSession();
            if (err?.name !== 'AbortError') {
              console.warn('Error fetching fresh profile on login:', err);
            }
          })
          .finally(() => clearTimeout(timeoutId));
      }
    }
  };

  const handleLogout = () => {
    profileRefreshRef.current += 1;
    // Se revoca en servidor sin esperar: el estado local se limpia igualmente,
    // porque dejar al usuario en la app si el backend no contesta sería peor.
    logoutSession();
    clearStoredUser();
    // Una URL firmada es un permiso con fecha: si en este mismo navegador
    // entra otra persona, no debe heredar las de la anterior.
    olvidarUrlsFirmadas();
    setUsuarioActual(null);
  };



  const lastNotifIdRef = React.useRef(null);
  const adminPollTimerRef = React.useRef(null);
  const adminPollAbortRef = React.useRef(null);
  const [adminRealtimeConnected, setAdminRealtimeConnected] = useState(() => (
    typeof window !== 'undefined' && window.__kapitalAdminWebSocketConnected === true
  ));

  // FlotaView owns the admin WebSocket. The event lets this global fallback
  // stop immediately when real-time delivery is available.
  useEffect(() => {
    const syncAdminRealtimeState = (event) => {
      const connected = event?.detail?.connected ?? window.__kapitalAdminWebSocketConnected === true;
      setAdminRealtimeConnected(Boolean(connected));
    };
    window.addEventListener(ADMIN_WS_STATE_EVENT, syncAdminRealtimeState);
    syncAdminRealtimeState();
    return () => window.removeEventListener(ADMIN_WS_STATE_EVENT, syncAdminRealtimeState);
  }, []);

  useEffect(() => {
    const canReceiveNotifications = ADMIN_NOTIFICATION_ROLES.has(usuarioActual?.rol);
    if (!canReceiveNotifications || adminRealtimeConnected) return undefined;

    if (lastNotifIdRef.current === null) {
      try {
        const storedId = Number.parseInt(localStorage.getItem('kapital_admin_last_notif_id') || '0', 10);
        lastNotifIdRef.current = Number.isFinite(storedId) ? storedId : 0;
      } catch {
        lastNotifIdRef.current = 0;
      }
    }

    let disposed = false;
    let timerId = null;
    let inFlight = false;
    let backoffMs = 0;
    let lastRunAt = 0;

    const clearTimer = () => {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      adminPollTimerRef.current = null;
    };

    let checkNotifications;
    const schedule = (delay) => {
      if (disposed || document.hidden || adminRealtimeConnected || window.__kapitalAdminWebSocketConnected === true) return;
      clearTimer();
      timerId = setTimeout(() => {
        timerId = null;
        adminPollTimerRef.current = null;
        checkNotifications(false, false);
      }, Math.max(0, delay));
      adminPollTimerRef.current = timerId;
    };

    checkNotifications = async (suppressToasts = false, force = false) => {
      if (disposed || document.hidden || adminRealtimeConnected || window.__kapitalAdminWebSocketConnected === true || inFlight) return;
      if (!force && Date.now() - lastRunAt < ADMIN_POLL_ACTIVITY_COOLDOWN_MS) {
        schedule(ADMIN_POLL_INTERVAL_MS);
        return;
      }

      lastRunAt = Date.now();
      inFlight = true;
      const controller = new AbortController();
      adminPollAbortRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), ADMIN_REQUEST_TIMEOUT_MS);
      let nextDelay = ADMIN_POLL_INTERVAL_MS;

      try {
        const res = await fetch(`/api/notifications?last_id=${lastNotifIdRef.current || 0}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          if (RETRYABLE_ADMIN_STATUS_CODES.has(res.status)) {
            backoffMs = backoffMs > 0
              ? Math.min(backoffMs * 2, ADMIN_POLL_BACKOFF_MAX_MS)
              : ADMIN_POLL_BACKOFF_BASE_MS;
            nextDelay = backoffMs;
          }
          return;
        }

        const payload = await res.json();
        const newNotifs = Array.isArray(payload) ? payload : [];
        if (newNotifs.length > 0) {
          const maxId = Math.max(...newNotifs.map(notification => Number.parseInt(notification.id, 10) || 0));
          if (maxId > (lastNotifIdRef.current || 0)) {
            lastNotifIdRef.current = maxId;
            try {
              localStorage.setItem('kapital_admin_last_notif_id', String(maxId));
            } catch {
              // Local persistence is optional; the in-memory cursor still works.
            }

            if (!suppressToasts) {
              newNotifs.forEach(notification => {
                const msg = notification.message || notification.mensaje || notification.titulo || 'Nueva notificación';
                if (notification.type === 'success') toast.success(msg, { id: `notif-${notification.id}` });
                else if (notification.type === 'error') toast.error(msg, { id: `notif-${notification.id}`, duration: 8000 });
                else toast(msg, { id: `notif-${notification.id}`, icon: '🔔' });
              });
            }
          }
        }
        backoffMs = 0;
      } catch (error) {
        if (error?.name !== 'AbortError' || !disposed) {
          backoffMs = backoffMs > 0
            ? Math.min(backoffMs * 2, ADMIN_POLL_BACKOFF_MAX_MS)
            : ADMIN_POLL_BACKOFF_BASE_MS;
          nextDelay = backoffMs;
        }
      } finally {
        clearTimeout(timeoutId);
        if (adminPollAbortRef.current === controller) adminPollAbortRef.current = null;
        inFlight = false;
        if (!disposed && !document.hidden && !adminRealtimeConnected && window.__kapitalAdminWebSocketConnected !== true) {
          schedule(nextDelay);
        }
      }
    };

    const wakePolling = () => {
      if (disposed || document.hidden || adminRealtimeConnected || window.__kapitalAdminWebSocketConnected === true) return;
      if (Date.now() - lastRunAt < ADMIN_POLL_ACTIVITY_COOLDOWN_MS) {
        schedule(ADMIN_POLL_INTERVAL_MS);
        return;
      }
      clearTimer();
      checkNotifications(false, true);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
        adminPollAbortRef.current?.abort();
      } else {
        wakePolling();
      }
    };

    checkNotifications(true, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', wakePolling);

    return () => {
      disposed = true;
      clearTimer();
      adminPollAbortRef.current?.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', wakePolling);
    };
  }, [adminRealtimeConnected, usuarioActual?.rol]);


  const renderVista = () => {
    // Un conductor solo tiene su portal y su perfil. Antes esta rama devolvía
    // el portal únicamente cuando `vistaActual` era 'dashboard', así que al
    // entrar con una cuenta de conductor sobre una sesión de administración
    // —sin recargar la página— la vista anterior seguía puesta y el conductor
    // veía la gestión de flota entera, con los datos de los demás.
    //
    // Qué pantalla le toca dentro del portal (alta, resubida o rutas) lo
    // decide `DriverPortal`, que ya tenía esa lógica: aquí estaba repetida.
    if (usuarioActual?.rol === 'Conductor') {
      if (vistaActual === 'perfil') {
        return <VistaPerfil usuario={usuarioActual} setUsuarioActual={setUsuarioActual} onLogout={handleLogout} />;
      }
      return <DriverPortal usuario={usuarioActual} setUsuarioActual={setUsuarioActual} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} />;
    }

    switch (vistaActual) {
      case 'historico':
        // La carga del reporte diario es del Programador: es quien lo descarga
        // de la intranet. La vista solo se enlaza desde su menú; si otro rol
        // llega aquí a mano, se le deja en la flota en vez de dibujarle un
        // panel con props que no le corresponden.
        if (usuarioActual?.rol !== 'Programador de rutas') {
          return <FlotaView usuario={usuarioActual} />;
        }
        return (
          <React.Suspense fallback={<GlobalLoader text="Cargando histórico..." />}>
            <ProgramadorHistorico />
          </React.Suspense>
        );
      case 'flota':
        // Para el Programador, la flota es consulta de capacidad. `FlotaView`
        // resuelve otro problema —documentos, altas y bajas— y son operaciones
        // que este rol no necesita ni debe poder ejecutar.
        return usuarioActual?.rol === 'Programador de rutas'
          ? <ProgramadorFlota />
          : <FlotaView usuario={usuarioActual} initialBase={vistaParams?.base} />;
      case 'reportes':
        // El Programador ve Análisis: `VistaReportes` lee `/api/reportes`, que
        // devuelve un historial vacío porque esa clave no se alimenta todavía.
        return usuarioActual?.rol === 'Programador de rutas'
          ? <ProgramadorAnalisis onIrACargar={() => handleNavigate('historico')} />
          : <VistaReportes />;
      case 'configuracion':
        return usuarioActual?.rol === 'Programador de rutas'
          ? <ProgramadorConfig />
          : <VistaConfiguracion />;
      case 'usuarios': return <UsersManagementTab usuarioActual={usuarioActual} initialTab={vistaParams?.tab || 'Todos'} />;
      case 'historial':
        // La auditoría es de Administración. Quien no lo sea cae en su propia
        // pantalla en vez de recibir un 403 del backend con la vista vacía.
        return ['Administración', 'Administrador'].includes(usuarioActual?.rol)
          ? <HistorialActividad />
          : <AdminDashboard onNavigate={handleNavigate} usuario={usuarioActual} />;
      case 'perfil': return <VistaPerfil usuario={usuarioActual} setUsuarioActual={setUsuarioActual} onLogout={handleLogout} />;
      case 'dashboard':
      default:
        if (usuarioActual?.rol === 'Cliente') {
          return <FlotaView usuario={usuarioActual} />;
        }
        if (usuarioActual?.rol === 'Conductor') {
          return <DriverPortal usuario={usuarioActual} setUsuarioActual={setUsuarioActual} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} />;
        }
        if (['Administración', 'Administrador'].includes(usuarioActual?.rol)) {
          return <AdminDashboard onNavigate={handleNavigate} usuario={usuarioActual} />;
        }
        // El Programador estrena su propia mesa de trabajo. `DashboardView`
        // sigue sirviendo al resto de roles administrativos hasta que la mesa
        // cubra la generación de rutas (ver docs/planning §6).
        if (usuarioActual?.rol === 'Programador de rutas') {
          return (
            <React.Suspense fallback={<GlobalLoader text="Cargando programación..." />}>
              <ProgramadorWorkbench onIrACargar={() => handleNavigate('historico')} />
            </React.Suspense>
          );
        }
        return <DashboardView routes={routes} setRoutes={setRoutes} usuarioActual={usuarioActual} sessionSaved={sessionSaved} onSaveSession={handleSaveSession} onUnsaveSession={handleUnsaveSession} onSessionDirty={() => setSessionSaved(false)} />;
    }
  };


  if (isRestoringSession) {
    return <GlobalLoader text="Validando sesión..." />;
  }

  if (!usuarioActual) {
    if (pendingPasswordChangeUser) {
      return (
        <>
          <Toaster position="top-right" />
          <PasswordChangeModal 
            user={pendingPasswordChangeUser} 
            onSuccess={(updatedUser) => {
              setPendingPasswordChangeUser(null);
              handleLogin(updatedUser);
            }}
            onCancel={() => setPendingPasswordChangeUser(null)}
          />
        </>
      );
    }
    return (
      <>
        <Toaster position="top-right" toastOptions={{
          style: {
            background: 'var(--bg-secondary)',
            color: 'var(--text)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
          }
        }} />
        <PantallaAuth onLogin={handleLogin} />
      </>
    );
  }

  if (usuarioActual.rol === 'Gerente de Operaciones') {
    return (
      <>
        <Toaster position="top-right" />
        <React.Suspense fallback={<GlobalLoader text="Cargando portal..." />}>
          <GerentePortal usuario={usuarioActual} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} />
        </React.Suspense>
      </>
    );
  }

  if (usuarioActual.rol === 'Cliente') {
    return (
      <>
        <Toaster position="top-right" />
        <React.Suspense fallback={<GlobalLoader text="Cargando portal..." />}>
          <ClientPortal usuario={usuarioActual} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} />
        </React.Suspense>
      </>
    );
  }

  return (
    <div className="App">
      <Toaster position="top-right" toastOptions={{
          style: {
            background: 'var(--bg-secondary)',
            color: 'var(--text)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
          }
        }} />
      <Navbar vistaActual={vistaActual} setVistaActual={setVistaActual} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} usuarioActual={usuarioActual} />
      <main className="app-container">
        <React.Suspense fallback={<GlobalLoader text="Cargando..." />}>
          {renderVista()}
        </React.Suspense>
      </main>
    </div>
  );
}

export default App;
