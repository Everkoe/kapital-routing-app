// App.jsx - Trigger Vercel Deploy 
import React, { useState, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Activity, Shield, ShieldCheck, MapPin, Truck, Smartphone, AlertTriangle, Key, LayoutDashboard, Settings, UserCircle, Save, LogOut, Navigation, Clock, CheckCircle2, FileText, CheckCircle, Search, Eye, Filter, User, Moon, Sun, Camera, X, Edit3, PlusCircle } from 'lucide-react';
import DocumentVerification from './components/DocumentVerification';
import { Toaster, toast } from 'react-hot-toast';
import './App.css';
import LiveMap from './LiveMap';
import FlotaView from './FlotaView';
import DriverPortal from './DriverPortal';
import GerentePortal from './GerentePortal';
import VistaReportes from './VistaReportes';
import ClientPortal from './ClientPortal';
import AdminDashboard from './AdminDashboard';

// --- Componente GlobalLoader ---
export const GlobalLoader = ({ text = "Cargando..." }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px', width: '100%', height: '100%', minHeight: '300px', boxSizing: 'border-box' }}>
    <svg width="48" height="48" viewBox="0 0 48 48" style={{ margin: '0 auto', display: 'block' }}>
      <circle cx="24" cy="24" r="20" fill="none" strokeWidth="4" stroke="var(--kapital-nav-link-active)" strokeLinecap="round" strokeDasharray="90 35.66">
        <animate attributeName="stroke-dashoffset" from="0" to="-125.66" dur="1.2s" repeatCount="indefinite" />
      </circle>
      <circle cx="24" cy="24" r="12" fill="none" strokeWidth="4" stroke="var(--kapital-accent-green)" strokeLinecap="round" strokeDasharray="40 35.40">
        <animate attributeName="stroke-dashoffset" from="0" to="75.40" dur="0.8s" repeatCount="indefinite" />
      </circle>
    </svg>
    <p style={{ marginTop: '20px', color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: 500, animation: 'pulseText 1.5s infinite' }}>{text}</p>
  </div>
);

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
                {formData.rol === 'Conductor' && (
                  <input className="auth-input" name="unidad_id" type="text" placeholder="ID de Unidad (Ej. KAP-001)" onChange={handleInputChange} required />
                )}
              </>
            )}

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


// --- Componentes de Vistas ---
// --- Confirmation Modal ---
const ConfirmModal = ({ isOpen, config, onConfirm, onCancel }) => {
  if (!isOpen) return null;
  const isDanger = config?.type === 'danger';
  const isSuccess = config?.type === 'success';
  const accentColor = isDanger ? '#ef4444' : isSuccess ? '#10b981' : 'var(--primary-color)';
  const accentBg = isDanger ? 'rgba(239,68,68,0.12)' : isSuccess ? 'rgba(16,185,129,0.12)' : 'rgba(99,102,241,0.12)';
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.65)',
      backdropFilter: 'blur(8px)',
      animation: 'fadeInOverlay 0.2s ease',
    }}>
      <style>{`
        @keyframes fadeInOverlay { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUpModal { from { opacity:0; transform:translateY(24px) scale(0.97) } to { opacity:1; transform:translateY(0) scale(1) } }
        .confirm-modal-card { animation: slideUpModal 0.25s cubic-bezier(0.34,1.56,0.64,1) both; }
        .confirm-btn { transition: all 0.18s ease; }
        .confirm-btn:hover { transform: translateY(-2px); filter: brightness(1.12); }
        .confirm-btn:active { transform: translateY(0px); }
      `}</style>
      <div className="confirm-modal-card" style={{
        background: 'var(--bg-secondary, #1a1d2e)',
        border: '1px solid var(--border-color, #2e303a)',
        borderRadius: '20px',
        padding: '40px',
        width: '100%', maxWidth: '420px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Solid accent top bar instead of glow */}
        <div style={{ position:'absolute', top:0, left:0, right:0, height:'4px', background: accentColor }} />

        {/* Icon */}
        <div style={{
          width: '72px', height: '72px', borderRadius: '50%',
          background: accentBg, border: `2px solid ${accentColor}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px', fontSize: '2rem',
        }}>
          {config?.icon || '⚠️'}
        </div>

        <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary, #f3f4f6)', fontSize: '1.2rem', fontWeight: 700 }}>
          {config?.title || '¿Confirmar acción?'}
        </h3>
        <p style={{ margin: '0 0 10px', color: 'var(--text-secondary, #9ca3af)', fontSize: '0.92rem', lineHeight: 1.6 }}>
          {config?.message}
        </p>
        {config?.userEmail && (
          <div style={{
            display: 'inline-block', padding: '6px 14px', borderRadius: '30px',
            background: accentBg, border: `1px solid ${accentColor}44`,
            color: accentColor, fontSize: '0.82rem', fontWeight: 600, marginBottom: '24px',
            wordBreak: 'break-all',
          }}>
            {config.userEmail}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          <button className="confirm-btn" onClick={onCancel} style={{
            flex: 1, padding: '12px', borderRadius: '10px', cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--border-color, #2e303a)',
            color: 'var(--text-secondary, #9ca3af)', fontWeight: 600, fontSize: '0.9rem',
          }}>
            Cancelar
          </button>
          <button className="confirm-btn" onClick={onConfirm} style={{
            flex: 1, padding: '12px', borderRadius: '10px', cursor: 'pointer',
            background: accentColor,
            border: 'none', color: '#fff', fontWeight: 700, fontSize: '0.9rem',
          }}>
            {config?.confirmText || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Roles and Status Badges ---
const RoleBadge = ({ rol }) => {
  const colors = {
    "Administrador": ['#3b82f6','#3b82f622'], // Legacy support
    "Administración": ['#3b82f6','#3b82f622'],
    "Programador de rutas": ['#0ea5e9','rgba(14,165,233,0.15)'],
    "Conductor": ['#10b981','rgba(16,185,129,0.15)'],
    "Gerente de Operaciones": ['#f59e0b','rgba(245,158,11,0.15)']
  };
  const [c, bg] = colors[rol] || ['#9ca3af','rgba(156,163,175,0.15)'];
  return <span style={{ padding:'4px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:700, letterSpacing:'0.5px', color:c, background:bg, border:`1px solid ${c}44` }}>{rol}</span>;
};
const StatusBadge = ({ estado }) => {
  const isPending = estado === 'Pendiente';
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:'5px',
      padding:'4px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:700,
      color: isPending ? '#f59e0b' : '#10b981',
      background: isPending ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
      border: `1px solid ${isPending ? '#f59e0b44' : '#10b98144'}`,
    }}>
      <span style={{ width:'6px', height:'6px', borderRadius:'50%', background: isPending ? '#f59e0b' : '#10b981', display:'inline-block', boxShadow: isPending ? '0 0 6px #f59e0b' : '0 0 6px #10b981' }} />
      {estado}
    </span>
  );
};


// --- Users Management Tab ---
const UsersManagementTab = ({ usuarioActual, initialTab = 'Todos' }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [modal, setModal] = useState({ isOpen: false, config: null, onConfirm: null });
  const [driverModal, setDriverModal] = useState({ isOpen: false, user: null });
  
  // CRM Features
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);
  const [activeRole, setActiveRole] = useState('Todos');
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pageSizeDropdownOpen, setPageSizeDropdownOpen] = useState(false);
  const roleDropdownRef = React.useRef(null);
  const pageSizeDropdownRef = React.useRef(null);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, activeRole, pageSize]);

  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(e.target)) {
        setRoleDropdownOpen(false);
      }
      if (pageSizeDropdownRef.current && !pageSizeDropdownRef.current.contains(e.target)) {
        setPageSizeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const ROLE_OPTIONS = [
    { key: 'Todos', label: 'Todos los roles' },
    { key: 'Administración', label: 'Administración' },
    { key: 'Gerente de Operaciones', label: 'Gerencia' },
    { key: 'Programador de rutas', label: 'Programador de Rutas' },
    { key: 'Conductor', label: 'Conductor' },
    { key: 'Cliente', label: 'Cliente B2B' },
  ];
  
  const formatTimeAgo = (isoDate) => {
    if (!isoDate) return 'Nunca';
    const date = new Date(isoDate);
    const diff = Math.floor((new Date() - date) / 1000);
    if (diff < 60) return 'Hace unos segundos';
    if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} horas`;
    if (diff < 172800) return 'Ayer';
    return date.toLocaleDateString();
  };

  const filteredUsers = users.filter(u => {
    let matchesTab = false;
    if (activeTab === 'Todos') matchesTab = true;
    else if (activeTab === 'Pendientes') matchesTab = u.estado.includes('Pendiente');
    else if (activeTab === 'Rechazados') matchesTab = u.estado === 'Rechazado' || u.estado === 'Inactivo';
    else matchesTab = u.estado === 'Activo' && !!u.last_login;

    let matchesRole = false;
    if (activeRole === 'Todos') matchesRole = true;
    else matchesRole = u.rol === activeRole || (u.rol === 'Administrador' && activeRole === 'Administración'); // Legacy support

    return matchesTab && matchesRole;
  });

  const totalPages = Math.ceil(filteredUsers.length / pageSize);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const fetchUsers = async () => {
    try {
      const res = await fetch(`/api/admin/users?email=${encodeURIComponent(usuarioActual.email)}`);
      if (res.ok) {
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        setUsers(data.usuarios || []);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  const closeModal = () => setModal({ isOpen: false, config: null, onConfirm: null });

  const requestAction = (targetEmail, action, userName) => {
    const configs = {
      approve: {
        type: 'success', icon: '✅', title: 'Aprobar Acceso',
        message: `¿Confirmas que deseas otorgar acceso a la plataforma a este usuario? Podrá iniciar sesión de inmediato.`,
        userEmail: targetEmail, confirmText: `Aprobar a ${userName}`,
      },
      reject_pending: {
        type: 'danger', icon: '🚫', title: 'Denegar Solicitud',
        message: `Esta acción rechazará la solicitud de acceso y eliminará la cuenta pendiente del sistema.`,
        userEmail: targetEmail, confirmText: 'Sí, denegar acceso',
      },
      deactivate: {
        type: 'danger', icon: '⛔', title: 'Desactivar Usuario Activo',
        message: `¿Estás seguro? Este usuario perderá acceso inmediato a la plataforma. Esta acción no se puede deshacer fácilmente.`,
        userEmail: targetEmail, confirmText: 'Sí, desactivar cuenta',
      },
    };
    const cfg = configs[action];
    setModal({
      isOpen: true,
      config: cfg,
      onConfirm: async () => {
        closeModal();
        setActionLoading(targetEmail);
        try {
          const apiAction = action === 'approve' ? 'approve' : 'reject';
          const method = action === 'approve' ? 'PUT' : 'DELETE';
          const res = await fetch(`/api/admin/users/${apiAction}/${encodeURIComponent(targetEmail)}?admin_email=${encodeURIComponent(usuarioActual.email)}`, { method });
          if (res.ok) await fetchUsers();
          else toast.error('Error al realizar la acción');
        } catch (e) { console.error(e); }
        finally { setActionLoading(null); }
      },
    });
  };

  const pendingCount = users.filter(u => u.estado === 'Pendiente' || u.estado === 'Pendiente Revisión').length;

  const handleReviewDriver = (user) => {
    setDriverModal({ isOpen: true, user });
  };

  const closeDriverModal = () => setDriverModal({ isOpen: false, user: null });

  const confirmReview = async (email, action) => {
    closeDriverModal();
    setActionLoading(email);
    try {
      const apiAction = action === 'approve' ? 'approve' : 'reject';
      const method = action === 'approve' ? 'PUT' : 'DELETE';
      const res = await fetch(`/api/admin/users/${apiAction}/${encodeURIComponent(email)}?admin_email=${encodeURIComponent(usuarioActual.email)}`, { method });
      if (res.ok) {
        toast.success(action === 'approve' ? 'Conductor aprobado' : 'Conductor rechazado');
        await fetchUsers();
      }
      else toast.error('Error al realizar la acción');
    } catch (e) { 
      console.error(e); 
      toast.error('Error de conexión');
    }
    finally { setActionLoading(null); }
  };

  const renderDocRow = (label, docObj) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <span>{label}: {docObj ? '✅ Subido' : '❌ Falta'}</span>
      {docObj && (
        <button 
          onClick={() => toast.info(`En la versión de producción, esto abrirá el visor del documento.`)}
          style={{ padding: '4px 10px', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', color: '#38BDF8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          👁️ Ver Archivo
        </button>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
        <GlobalLoader text="Cargando usuarios..." />
      </div>
    );
  }

  return (
    <>
      <ConfirmModal isOpen={modal.isOpen} config={modal.config} onConfirm={modal.onConfirm} onCancel={closeModal} />
      {driverModal.isOpen && driverModal.user && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg)', borderRadius: '16px', padding: '30px', maxWidth: '600px', width: '90%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            <h3 style={{ marginTop: 0, borderBottom: '1px solid var(--border-color)', paddingBottom: '15px' }}>Revisión de Perfil: {driverModal.user.nombre}</h3>
            
            <div style={{ marginTop: '20px' }}>
              <p><strong>DNI/Documento:</strong> {driverModal.user.perfil_conductor?.tipoDoc} {driverModal.user.perfil_conductor?.numDoc}</p>
              <p><strong>Fecha de Nacimiento:</strong> {driverModal.user.perfil_conductor?.fechaNacimiento} ({driverModal.user.perfil_conductor?.edad} años)</p>
              <p><strong>Dirección:</strong> {driverModal.user.perfil_conductor?.direccion}</p>
              <p><strong>Teléfonos:</strong> {driverModal.user.perfil_conductor?.telefonoDirecto} / {driverModal.user.perfil_conductor?.telefonoEmergencia}</p>
              
              <h4 style={{ marginTop: '20px', borderBottom: '1px solid var(--border-color)' }}>Datos Vehiculares</h4>
              <p><strong>Marca y Modelo:</strong> {driverModal.user.perfil_conductor?.vehiculoMarca} {driverModal.user.perfil_conductor?.vehiculoModelo}</p>
              <p><strong>Año y Color:</strong> {driverModal.user.perfil_conductor?.vehiculoAnio} / {driverModal.user.perfil_conductor?.vehiculoColor}</p>
              <p><strong>Placa:</strong> {driverModal.user.perfil_conductor?.vehiculoPlaca}</p>
              <p><strong>Capacidad:</strong> {driverModal.user.perfil_conductor?.vehiculoCapacidad} pasajeros</p>
              
              <h4 style={{ marginTop: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '5px' }}>Documentos</h4>
              <div style={{ marginTop: '10px' }}>
                {renderDocRow('Comprobante de domicilio', driverModal.user.perfil_conductor?.comprobanteDomicilio)}
                {renderDocRow('Licencia de Conducir', driverModal.user.perfil_conductor?.licenciaConducir)}
                {renderDocRow('Récord de Conductor', driverModal.user.perfil_conductor?.recordConductor)}
                {renderDocRow('Antecedentes', driverModal.user.perfil_conductor?.antecedentesPenales)}
                {renderDocRow('Tarjeta de Propiedad', driverModal.user.perfil_conductor?.tarjetaPropiedad)}
                {renderDocRow('SOAT', driverModal.user.perfil_conductor?.soat)}
                {renderDocRow('Revisión Técnica', driverModal.user.perfil_conductor?.revisionTecnica)}
              </div>
              
              <DocumentVerification 
                doc={driverModal.user?.perfil_conductor?.numDoc || driverModal.user?.nombre} 
                placa={driverModal.user?.perfil_conductor?.vehiculoPlaca}
                cachedResults={{
                  soat: driverModal.user?.perfil_conductor?.validacion_soat,
                  citv: driverModal.user?.perfil_conductor?.validacion_citv,
                  licencia: driverModal.user?.perfil_conductor?.validacion_licencia
                }}
              />
            </div>
            
            <div style={{ display: 'flex', gap: '15px', marginTop: '30px', justifyContent: 'flex-end' }}>
              <button onClick={closeDriverModal} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer' }}>Cerrar</button>
              <button onClick={() => confirmReview(driverModal.user.email, 'reject')} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer' }}>Rechazar</button>
              <button onClick={() => confirmReview(driverModal.user.email, 'approve')} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#10b981', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>Aprobar Conductor</button>
            </div>
          </div>
        </div>
      )}
      <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--border-color)', boxShadow: '0 10px 40px rgba(0,0,0,0.12)' }}>

        {/* Premium Header — consistent with rest of app */}
        <div className="premium-card-header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                <div style={{
                  width: '34px', height: '34px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(135deg, #0ea5e9, var(--primary-color))', fontSize: '1.1rem',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                }}>
                  <Shield size={18} color="white" strokeWidth={2.5} />
                </div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Gestión de Accesos B2B
                </h2>
              </div>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.87rem', paddingLeft: '44px' }}>
                Administra solicitudes de ingreso a la plataforma Kapital Routing.
              </p>
            </div>
            {pendingCount > 0 && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 18px',
                borderRadius: '30px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.45)',
                color: '#f59e0b', fontWeight: 700, fontSize: '0.85rem', animation: 'pulse 2s infinite',
                boxShadow: '0 0 16px rgba(245,158,11,0.15)',
              }}>
                <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.7} }`}</style>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', boxShadow: '0 0 8px #f59e0b', display: 'inline-block' }} />
                {pendingCount} solicitud{pendingCount > 1 ? 'es' : ''} pendiente{pendingCount > 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '24px 28px' }}>
          <div style={{ overflowX: 'auto' }}>
            {/* Filters Bar */}
            <style>{`
                .crm-tab-btn {
                  background: transparent;
                  border: none;
                  padding: 8px 18px;
                  font-size: 0.88rem;
                  font-weight: 600;
                  border-radius: 8px;
                  cursor: pointer;
                  transition: background 0.2s, color 0.2s, box-shadow 0.2s;
                  color: var(--text-secondary);
                  letter-spacing: 0.02em;
                }
                .crm-tab-btn.active {
                  background: var(--primary-color);
                  color: #fff;
                  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
                }
                .crm-tab-btn:not(.active):hover {
                  background: var(--border-color);
                  color: var(--text-primary);
                }
                .role-pill {
                  display: inline-flex;
                  align-items: center;
                  gap: 6px;
                  padding: 6px 14px;
                  border-radius: 20px;
                  font-size: 0.8rem;
                  font-weight: 600;
                  cursor: pointer;
                  border: 1.5px solid var(--border-color);
                  background: transparent;
                  color: var(--text-secondary);
                  transition: all 0.2s;
                }
                .role-pill:hover {
                  border-color: var(--primary-color);
                  color: var(--text-primary);
                }
                .role-pill.active {
                  background: var(--accent-bg);
                  border-color: var(--primary-color);
                  color: var(--primary-color);
                }
              `}</style>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
                {/* Status Tabs */}
                <div style={{
                  display: 'flex', gap: '4px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px', padding: '4px'
                }}>
                  {[
                    { key: 'Todos', label: 'Todos', dot: null },
                    { key: 'Pendientes', label: 'Pendientes', dot: '#f59e0b' },
                    { key: 'Activos', label: 'Activos', dot: '#10b981' },
                    { key: 'Rechazados', label: 'Rechazados', dot: '#ef4444' },
                  ].map(({ key, label, dot }) => (
                    <button key={key}
                      className={`crm-tab-btn${activeTab === key ? ' active' : ''}`}
                      onClick={() => setActiveTab(key)}>
                      {dot && <span style={{
                        display: 'inline-block', width: '7px', height: '7px',
                        borderRadius: '50%', background: activeTab === key ? 'rgba(255,255,255,0.8)' : dot,
                        marginRight: '5px', flexShrink: 0,
                      }} />}
                      {label}
                    </button>
                  ))}
                </div>

                {/* Role Dropdown */}
                <div ref={roleDropdownRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setRoleDropdownOpen(o => !o)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '8px',
                      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)', borderRadius: '8px',
                      padding: '8px 14px', fontSize: '0.875rem', fontWeight: 600,
                      cursor: 'pointer', transition: 'border-color 0.2s, box-shadow 0.2s',
                      boxShadow: roleDropdownOpen ? '0 0 0 2px var(--accent-border)' : 'none',
                      borderColor: roleDropdownOpen ? 'var(--primary-color)' : 'var(--border-color)',
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Rol</span>
                    <span style={{ width: '1px', height: '14px', background: 'var(--border-color)', display: 'inline-block' }} />
                    <span style={{ color: activeRole !== 'Todos' ? 'var(--primary-color)' : 'var(--text-primary)' }}>
                      {ROLE_OPTIONS.find(r => r.key === activeRole)?.label || 'Todos los roles'}
                    </span>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: '2px', transition: 'transform 0.2s', transform: roleDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', opacity: 0.5 }}>
                      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>

                  {roleDropdownOpen && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100,
                      background: 'var(--bg)', border: '1px solid var(--border-color)',
                      borderRadius: '10px', padding: '6px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                      minWidth: '200px',
                      animation: 'dropdownIn 0.15s ease-out',
                    }}>
                      <style>{`@keyframes dropdownIn { from { opacity:0; transform: translateY(-6px); } to { opacity:1; transform: translateY(0); } }`}</style>
                      {ROLE_OPTIONS.map(({ key, label }) => (
                        <button key={key}
                          onClick={() => { setActiveRole(key); setRoleDropdownOpen(false); }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '9px 12px', borderRadius: '7px', border: 'none',
                            background: activeRole === key ? 'var(--accent-bg)' : 'transparent',
                            color: activeRole === key ? 'var(--primary-color)' : 'var(--text-primary)',
                            fontWeight: activeRole === key ? 700 : 500,
                            fontSize: '0.875rem', cursor: 'pointer', transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => { if (activeRole !== key) e.target.style.background = 'var(--bg-secondary)'; }}
                          onMouseLeave={e => { e.target.style.background = activeRole === key ? 'var(--accent-bg)' : 'transparent'; }}
                        >
                          {label}
                          {activeRole === key && <span style={{ float: 'right', opacity: 0.7 }}>✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px' }}>
                <thead>
                  <tr>
                    {['Usuario', 'Correo Electrónico', 'Rol', 'Última Conexión', 'Estado', 'Acciones'].map(h => (
                      <th key={h} style={{
                        padding: '8px 14px', fontSize: '10px', fontWeight: 700, letterSpacing: '1.2px',
                        textTransform: 'uppercase', color: 'var(--text-secondary)', textAlign: 'left',
                        borderBottom: '2px solid var(--border-color)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                     <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '60px 20px' }}>
                          <div style={{ fontSize: '3rem', marginBottom: '15px', opacity: 0.5 }}>📂</div>
                          <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)', fontSize: '1.1rem' }}>No se encontraron usuarios</h4>
                          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '300px', margin: '0 auto' }}>
                            No hay registros que coincidan con los filtros seleccionados de "{activeTab}" y "{activeRole}".
                          </p>
                        </td>
                     </tr>
                  ) : paginatedUsers.map(u => (
                    <tr key={u.email}
                      style={{ borderRadius: '10px', transition: 'background 0.15s', cursor: 'default' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '13px 14px', borderRadius: '10px 0 0 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {u.avatar ? (
                            <img src={u.avatar} alt={u.nombre}
                              style={{
                                width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                                objectFit: 'cover',
                                border: '2px solid var(--border-color)',
                              }}
                              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                            />
                          ) : null}
                          <div style={{
                            width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                            display: u.avatar ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'linear-gradient(135deg, #0d9488, #14b8a6)',
                            color: 'white', fontWeight: 700, fontSize: '0.88rem',
                            border: '2px solid rgba(13,148,136,0.3)',
                          }}>{u.nombre?.charAt(0)?.toUpperCase() || '?'}</div>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{u.nombre}</span>
                        </div>
                      </td>
                      <td style={{ padding: '13px 14px', color: 'var(--text-secondary)', fontSize: '0.86rem' }}>{u.email}</td>
                      <td style={{ padding: '13px 14px' }}><RoleBadge rol={u.rol} /></td>
                      <td style={{ padding: '13px 14px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{formatTimeAgo(u.last_login)}</td>
                      <td style={{ padding: '13px 14px' }}><StatusBadge estado={u.estado} /></td>
                      <td style={{ padding: '13px 14px', borderRadius: '0 10px 10px 0' }}>
                        {actionLoading === u.email ? (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.83rem' }}>Procesando…</span>
                        ) : (
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                            {u.estado === 'Pendiente' && (
                              <>
                                <button onClick={() => requestAction(u.email, 'approve', u.nombre)} style={{
                                  padding: '6px 13px', borderRadius: '8px', border: '1px solid #10b98166',
                                  background: 'rgba(16,185,129,0.1)', color: '#10b981', cursor: 'pointer',
                                  fontWeight: 600, fontSize: '0.8rem', transition: 'all 0.18s', whiteSpace: 'nowrap',
                                }}
                                  onMouseEnter={e => { e.target.style.background = '#10b981'; e.target.style.color = '#fff'; e.target.style.boxShadow = '0 4px 12px rgba(16,185,129,0.4)'; }}
                                  onMouseLeave={e => { e.target.style.background = 'rgba(16,185,129,0.1)'; e.target.style.color = '#10b981'; e.target.style.boxShadow = 'none'; }}>
                                  ✅ Aprobar
                                </button>
                                <button onClick={() => requestAction(u.email, 'reject_pending', u.nombre)} style={{
                                  padding: '6px 13px', borderRadius: '8px', border: '1px solid #ef444466',
                                  background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: 'pointer',
                                  fontWeight: 600, fontSize: '0.8rem', transition: 'all 0.18s', whiteSpace: 'nowrap',
                                }}
                                  onMouseEnter={e => { e.target.style.background = '#ef4444'; e.target.style.color = '#fff'; e.target.style.boxShadow = '0 4px 12px rgba(239,68,68,0.4)'; }}
                                  onMouseLeave={e => { e.target.style.background = 'rgba(239,68,68,0.1)'; e.target.style.color = '#ef4444'; e.target.style.boxShadow = 'none'; }}>
                                  ❌ Denegar
                                </button>
                              </>
                            )}
                            {u.estado === 'Pendiente Revisión' && (
                              <button onClick={() => handleReviewDriver(u)} style={{
                                padding: '6px 13px', borderRadius: '8px', border: '1px solid #3b82f666',
                                background: 'rgba(59,130,246,0.1)', color: '#3b82f6', cursor: 'pointer',
                                fontWeight: 600, fontSize: '0.8rem', transition: 'all 0.18s', whiteSpace: 'nowrap',
                              }}
                                onMouseEnter={e => { e.target.style.background = '#3b82f6'; e.target.style.color = '#fff'; e.target.style.boxShadow = '0 4px 12px rgba(59,130,246,0.4)'; }}
                                onMouseLeave={e => { e.target.style.background = 'rgba(59,130,246,0.1)'; e.target.style.color = '#3b82f6'; e.target.style.boxShadow = 'none'; }}>
                                🔍 Revisar Perfil
                              </button>
                            )}
                            {u.estado === 'Activo' && u.email !== usuarioActual.email && (
                              <button onClick={() => requestAction(u.email, 'deactivate', u.nombre)} style={{
                                padding: '6px 13px', borderRadius: '8px', border: '1px solid #ef444455',
                                background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer',
                                fontWeight: 600, fontSize: '0.8rem', transition: 'all 0.18s', whiteSpace: 'nowrap',
                              }}
                                onMouseEnter={e => { e.target.style.background = '#ef4444'; e.target.style.color = '#fff'; e.target.style.boxShadow = '0 4px 12px rgba(239,68,68,0.4)'; }}
                                onMouseLeave={e => { e.target.style.background = 'rgba(239,68,68,0.08)'; e.target.style.color = '#ef4444'; e.target.style.boxShadow = 'none'; }}>
                                ⛔ Desactivar
                              </button>
                            )}
                            {u.email === usuarioActual.email && (
                              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>Tu cuenta</span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && (
                <div style={{ textAlign: 'center', padding: '56px 24px', color: 'var(--text-secondary)' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>👥</div>
                  <p style={{ margin: 0, fontSize: '0.95rem' }}>No hay usuarios registrados aún.</p>
                </div>
              )}
              {filteredUsers.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 4px', borderTop: '1px solid var(--border-color)', marginTop: '10px', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Mostrando {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredUsers.length)} de {filteredUsers.length} usuarios
                  </div>
                  <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Filas por pág:</span>
                      <div ref={pageSizeDropdownRef} style={{ position: 'relative' }}>
                        <button 
                          onClick={() => setPageSizeDropdownOpen(!pageSizeDropdownOpen)}
                          style={{
                            padding: '6px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                            color: 'var(--text-primary)', borderRadius: '6px', fontSize: '0.85rem', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px', minWidth: '65px', justifyContent: 'space-between',
                            boxShadow: pageSizeDropdownOpen ? '0 0 0 2px var(--accent-border)' : 'none',
                            transition: 'all 0.15s'
                          }}
                        >
                          {pageSize}
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>▼</span>
                        </button>
                        {pageSizeDropdownOpen && (
                          <div style={{
                            position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, width: '100%', minWidth: '70px',
                            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                            borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', overflow: 'hidden', zIndex: 100,
                            display: 'flex', flexDirection: 'column'
                          }}>
                            {[10, 50, 100].map(size => (
                              <button key={size}
                                onClick={() => { setPageSize(size); setPageSizeDropdownOpen(false); }}
                                style={{
                                  padding: '8px 12px', background: pageSize === size ? 'var(--accent-bg)' : 'transparent',
                                  color: pageSize === size ? 'var(--primary-color)' : 'var(--text-secondary)',
                                  border: 'none', borderBottom: '1px solid rgba(255,255,255,0.02)', textAlign: 'left',
                                  fontSize: '0.85rem', cursor: 'pointer', fontWeight: pageSize === size ? 600 : 500,
                                  transition: 'background 0.15s'
                                }}
                                onMouseEnter={e => { if (pageSize !== size) e.target.style.background = 'rgba(255,255,255,0.03)'; }}
                                onMouseLeave={e => { e.target.style.background = pageSize === size ? 'var(--accent-bg)' : 'transparent'; }}
                              >
                                {size}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        style={{ 
                          padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--border-color)', 
                          background: currentPage === 1 ? 'transparent' : 'var(--bg-secondary)', 
                          color: currentPage === 1 ? 'var(--text-muted)' : 'var(--text-primary)', 
                          cursor: currentPage === 1 ? 'not-allowed' : 'pointer', 
                          opacity: currentPage === 1 ? 0.5 : 1, transition: 'all 0.15s',
                          display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem'
                        }}
                        onMouseEnter={e => { if (currentPage !== 1) e.target.style.background = 'var(--bg-hover)'; }}
                        onMouseLeave={e => { if (currentPage !== 1) e.target.style.background = 'var(--bg-secondary)'; }}
                      >
                        <span style={{ fontSize: '14px', lineHeight: 1 }}>«</span> Anterior
                      </button>
                      <button 
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                        disabled={currentPage === totalPages || totalPages === 0}
                        style={{ 
                          padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--border-color)', 
                          background: (currentPage === totalPages || totalPages === 0) ? 'transparent' : 'var(--bg-secondary)', 
                          color: (currentPage === totalPages || totalPages === 0) ? 'var(--text-muted)' : 'var(--text-primary)', 
                          cursor: (currentPage === totalPages || totalPages === 0) ? 'not-allowed' : 'pointer', 
                          opacity: (currentPage === totalPages || totalPages === 0) ? 0.5 : 1, transition: 'all 0.15s',
                          display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem'
                        }}
                        onMouseEnter={e => { if (currentPage !== totalPages && totalPages !== 0) e.target.style.background = 'var(--bg-hover)'; }}
                        onMouseLeave={e => { if (currentPage !== totalPages && totalPages !== 0) e.target.style.background = 'var(--bg-secondary)'; }}
                      >
                        Siguiente <span style={{ fontSize: '14px', lineHeight: 1 }}>»</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
        </div>
      </div>
    </>
  );
};


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
              <a onClick={() => handleNav('dashboard')} className={vistaActual === 'dashboard' ? 'nav-link active' : 'nav-link'}>Tablero</a>
              <a onClick={() => handleNav('reportes')} className={vistaActual === 'reportes' ? 'nav-link active' : 'nav-link'}>Reportes</a>
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
              <span>Tablero</span>
            </a>
            <a onClick={() => handleNav('reportes')} className={vistaActual === 'reportes' ? 'nav-link active' : 'nav-link'}>
              <FileText size={20} />
              <span>Reportes</span>
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

const DOC_LABELS = {
  comprobanteDomicilio: 'Comprobante de Domicilio',
  dniScaneado: 'DNI Escaneado',
  licenciaConducir: 'Licencia de Conducir',
  recordConductor: 'Récord de Conductor',
  antecedentesPoliciales: 'Antecedentes Policiales',
  cv: 'Currículum Vitae',
  tarjetaPropiedad: 'Tarjeta de Propiedad',
  soat: 'SOAT',
  revisionTecnica: 'Revisión Técnica'
};

const VistaPerfil = ({ usuario, setUsuarioActual, onLogout }) => {
  const [activeTab, setActiveTab] = useState('personal');
  const [formData, setFormData] = useState({ nombre: usuario.nombre, current_password: '', new_password: '' });
  const [avatar, setAvatar] = useState(usuario.avatar || null);
  const [fotoVehiculo, setFotoVehiculo] = useState(usuario.perfil_conductor?.fotoVehiculo || null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [viewingDoc, setViewingDoc] = useState(null);
  
  // Update Request State
  const [editingField, setEditingField] = useState(null);
  const [updateRequestValue, setUpdateRequestValue] = useState('');

  // Vehículo 2 multi-field modal
  const [showVehiculo2Modal, setShowVehiculo2Modal] = useState(false);
  const [vehiculo2Form, setVehiculo2Form] = useState({
    placa2: '', vehiculoMarca2: '', vehiculoModelo2: '',
    vehiculoAnio2: '', vehiculoColor2: '', capacidadVehiculo2: ''
  });

  const handleRequestUpdate = async (e) => {
    e.preventDefault();
    if (!updateRequestValue.trim()) {
      toast.error('El valor no puede estar vacío');
      return;
    }
    
    setLoading(true);
    try {
      const res = await fetch('/api/conductor/request-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: usuario.identifier,
          field: editingField.key,
          new_value: updateRequestValue.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Error al solicitar cambio');
      
      toast.success('Solicitud enviada correctamente. En revisión por administrador.');
      setEditingField(null);
      setUpdateRequestValue('');
      
      // Update local state to reflect the pending request immediately
      const updatedUser = { ...usuario };
      if (!updatedUser.perfil_conductor) updatedUser.perfil_conductor = {};
      if (!updatedUser.perfil_conductor.solicitudes_cambio) updatedUser.perfil_conductor.solicitudes_cambio = {};
      updatedUser.perfil_conductor.solicitudes_cambio[editingField.key] = {
        new_value: updateRequestValue.trim(),
        status: 'pendiente',
        timestamp: new Date().toISOString()
      };
      setUsuarioActual(updatedUser);
      localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
      
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };


  const onDrop = (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setAvatar(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleRequestVehiculo2 = async (e) => {
    e.preventDefault();
    if (!vehiculo2Form.placa2.trim()) {
      toast.error('La placa del segundo vehículo es obligatoria');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/conductor/request-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: usuario.identifier,
          field: 'vehiculo2',
          new_value: JSON.stringify(vehiculo2Form)
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Error al enviar solicitud');

      toast.success('Solicitud de Vehículo 2 enviada. En revisión por el administrador.');
      setShowVehiculo2Modal(false);
      setVehiculo2Form({ placa2: '', vehiculoMarca2: '', vehiculoModelo2: '', vehiculoAnio2: '', vehiculoColor2: '', capacidadVehiculo2: '' });

      // Update local state
      const updatedUser = { ...usuario };
      if (!updatedUser.perfil_conductor) updatedUser.perfil_conductor = {};
      if (!updatedUser.perfil_conductor.solicitudes_cambio) updatedUser.perfil_conductor.solicitudes_cambio = {};
      updatedUser.perfil_conductor.solicitudes_cambio['vehiculo2'] = {
        new_value: JSON.stringify(vehiculo2Form),
        status: 'pendiente',
        timestamp: new Date().toISOString()
      };
      setUsuarioActual(updatedUser);
      localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: {'image/*': []}, maxFiles: 1 });

  const onDropVehiculo = (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setFotoVehiculo(e.target.result);
      reader.readAsDataURL(file);
    }
  };
  const { getRootProps: getRootPropsVehiculo, getInputProps: getInputPropsVehiculo, isDragActive: isDragActiveVehiculo } = useDropzone({ onDrop: onDropVehiculo, accept: {'image/*': []}, maxFiles: 1 });

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const payload = {
        identifier: usuario.identifier,
        nombre: formData.nombre !== usuario.nombre ? formData.nombre : undefined,
        current_password: formData.current_password || undefined,
        new_password: formData.new_password || undefined,
        avatar: avatar !== usuario.avatar ? avatar : undefined,
        fotoVehiculo: fotoVehiculo !== usuario.perfil_conductor?.fotoVehiculo ? fotoVehiculo : undefined
      };
      
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404) {
          toast.error('Sesión expirada. Inicia sesión nuevamente.');
          onLogout();
          return;
        }
        throw new Error(data.detail || 'Error al actualizar perfil');
      }
      
      setUsuarioActual(data);
      localStorage.setItem('kapital_user', JSON.stringify(data));
      toast.success('Perfil actualizado correctamente.');
      setFormData(prev => ({ ...prev, current_password: '', new_password: '' }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderEditableField = (label, key, defaultVal = '', suffix = '') => {
    const rawVal = usuario.perfil_conductor?.[key] || defaultVal;
    const displayVal = rawVal ? `${rawVal}${suffix}` : '—';
    const pendingRequest = usuario.perfil_conductor?.solicitudes_cambio?.[key];
    const isPending = pendingRequest && pendingRequest.status === 'pendiente';

    return (
      <div className="form-group" style={{ marginBottom: 0 }} key={key}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ margin: 0 }}>{label}</label>
          {isPending ? (
            <span style={{ fontSize: '0.75rem', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }} title={`En revisión: ${pendingRequest.new_value}`}>
              Revisión
            </span>
          ) : (
            <button 
              type="button" 
              onClick={() => { setEditingField({ key, label }); setUpdateRequestValue(rawVal); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '2px', display: 'flex' }}
              title="Solicitar cambio"
            >
              <Edit3 size={14} />
            </button>
          )}
        </div>
        <input type="text" value={displayVal} className="form-input disabled-input" style={{ fontSize: '0.95rem' }} disabled />
      </div>
    );
  };

  return (
    <div className="card profile-wrapper">
      <div className="profile-tabs">
        <button className={activeTab === 'personal' ? 'active' : ''} onClick={() => setActiveTab('personal')}>Perfil</button>
        {usuario.rol === 'Conductor' && (
          <button className={activeTab === 'documents' ? 'active' : ''} onClick={() => setActiveTab('documents')}>Información</button>
        )}
        <button className={activeTab === 'security' ? 'active' : ''} onClick={() => setActiveTab('security')}>Seguridad</button>
      </div>
      
      <div className="profile-content">
        {activeTab === 'personal' && (
          <div className="profile-layout-grid">
            <div className="profile-avatar-column">
              {/* Foto de Perfil */}
              <div className="photo-upload-card">
                <div className="photo-upload-label">Foto de Perfil</div>
                <div {...getRootProps()} className={`photo-upload-zone ${isDragActive ? 'drag-active' : ''}`}>
                  <input {...getInputProps()} />
                  <div className="photo-preview-circle">
                    {avatar ? (
                      <img src={avatar} alt="Avatar" className="photo-preview-img" />
                    ) : (
                      <div className="photo-placeholder-circle">
                        <span className="photo-placeholder-initial">{usuario.nombre.charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                    <div className="photo-overlay">
                      <Camera size={22} color="white" />
                    </div>
                  </div>
                  <div className="photo-upload-meta">
                    <span className="photo-upload-action">{isDragActive ? 'Suelta aquí...' : 'Haz clic o arrastra'}</span>
                    <span className="photo-upload-hint">JPG, PNG · Máx 2MB</span>
                  </div>
                </div>
              </div>

              {/* Foto del Vehículo - solo conductores */}
              {usuario.rol === 'Conductor' && (
                <div className="photo-upload-card" style={{marginTop: '16px'}}>
                  <div className="photo-upload-label">Foto del Vehículo</div>
                  <div {...getRootPropsVehiculo()} className={`photo-upload-zone ${isDragActiveVehiculo ? 'drag-active' : ''}`}>
                    <input {...getInputPropsVehiculo()} />
                    <div className="photo-preview-rect">
                      {fotoVehiculo ? (
                        <img src={fotoVehiculo} alt="Vehículo" className="photo-preview-img-rect" />
                      ) : (
                        <div className="photo-placeholder-rect">
                          <Truck size={36} color="#38bdf8" />
                          <span style={{fontSize:'0.75rem', color:'#38bdf8', marginTop:'6px', fontWeight:600}}>Sin foto aún</span>
                        </div>
                      )}
                      <div className="photo-overlay-rect">
                        <Camera size={22} color="white" />
                      </div>
                    </div>
                    <div className="photo-upload-meta">
                      <span className="photo-upload-action">{isDragActiveVehiculo ? 'Suelta aquí...' : 'Haz clic o arrastra'}</span>
                      <span className="photo-upload-hint">JPG, PNG · Foto clara del exterior</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            
            <div className="profile-form-column">
              <h3 className="profile-section-title">Información Básica</h3>
              <form className="profile-form" onSubmit={handleSave}>
                <div className="form-group">
                  <label>Nombre Completo</label>
                  <input type="text" name="nombre" value={formData.nombre} onChange={handleChange} className="form-input" required />
                </div>
                {usuario.rol === 'Conductor' && usuario.perfil_conductor?.numDoc && (
                  <div className="form-group">
                    <label>DNI</label>
                    <input type="text" value={usuario.perfil_conductor.numDoc} className="form-input disabled-input" disabled />
                    <span className="input-hint">Validado por RENIEC.</span>
                  </div>
                )}
                <div className="form-group">
                  <label>{(usuario.identifier || usuario.email || '').includes('@') ? 'Correo Electrónico' : 'Identificador de Cuenta'}</label>
                  <input type="text" value={usuario.identifier || usuario.email || ''} className="form-input disabled-input" disabled />
                  <span className="input-hint">No puede modificarse por seguridad.</span>
                </div>
                <div className="form-group">
                  <label>Rol de Usuario</label>
                  <input type="text" value={usuario.rol} className="form-input disabled-input" disabled />
                </div>
                
                <div className="profile-actions">
                  <button type="submit" className="btn-primary profile-save-btn" disabled={loading}>
                    {loading ? 'Guardando...' : 'Guardar Cambios'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="profile-layout-grid">
            <div className="profile-avatar-column">
               <div className="security-icon-wrapper">
                 <span className="security-icon">🔒</span>
               </div>
               <h4 className="security-title">Seguridad de la Cuenta</h4>
               <p className="security-desc">Usa una contraseña segura de al menos 6 caracteres que no uses en otros sitios web.</p>
            </div>
            <div className="profile-form-column">
              <h3 className="profile-section-title">Cambiar Contraseña</h3>
              <form className="profile-form" onSubmit={handleSave}>
                <div className="form-group">
                  <label>Contraseña Actual</label>
                  <input type="password" name="current_password" value={formData.current_password} onChange={handleChange} className="form-input" required />
                </div>
                <div className="form-group">
                  <label>Nueva Contraseña</label>
                  <input type="password" name="new_password" value={formData.new_password} onChange={handleChange} className="form-input" required />
                </div>
                
                <div className="profile-actions">
                  <button type="submit" className="btn-primary profile-save-btn" disabled={loading || !formData.new_password}>
                    {loading ? 'Actualizando...' : 'Actualizar Contraseña'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'documents' && usuario.rol === 'Conductor' && (
          <div className="profile-layout-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="profile-form-column" style={{ width: '100%' }}>
              
              {usuario.perfil_conductor && (
                <div style={{ marginBottom: '30px', padding: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h3 className="profile-section-title" style={{ marginBottom: '20px' }}>Información Registrada</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px' }}>
                    {renderEditableField('Nacimiento', 'fechaNacimiento')}
                    {renderEditableField('Dirección', 'direccion')}
                    {renderEditableField('Teléfono Directo', 'telefonoDirecto')}
                    {renderEditableField('Teléfono de Emergencia', 'telefonoEmergencia')}
                    {renderEditableField('Vehículo (Marca)', 'vehiculoMarca')}
                    {renderEditableField('Vehículo (Modelo)', 'vehiculoModelo')}
                    {renderEditableField('Año', 'vehiculoAnio')}
                    {renderEditableField('Color', 'vehiculoColor')}
                    {renderEditableField('Placa', 'placa')}

                    {renderEditableField('Capacidad Vehicular', 'capacidadVehiculo', '15', ' pax')}
                  </div>
                </div>
              )}



              <h3 className="profile-section-title">Documentos Subidos</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Aquí puedes ver los documentos que has proporcionado. Estos no pueden ser modificados a menos que sean rechazados por un administrador.</p>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
                {Object.keys(DOC_LABELS).map(docKey => {
                  const fileUrl = usuario.perfil_conductor?.[docKey];
                  const statusObj = usuario.perfil_conductor?.revision_docs?.[docKey];
                  const estado = statusObj ? statusObj.estado?.toLowerCase() : (fileUrl ? 'pendiente' : 'faltante');

                  if (!fileUrl && estado === 'faltante') return null;

                  return (
                    <div key={docKey} style={{ background: 'var(--bg-secondary)', padding: '15px', borderRadius: '8px', border: '1px solid var(--kapital-border)' }}>
                      <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)' }}>{DOC_LABELS[docKey]}</h4>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        {fileUrl ? (
                          <button type="button" onClick={(e) => { 
                            e.preventDefault(); 
                            let docSrc = '';
                            if (typeof fileUrl === 'string') {
                              docSrc = fileUrl;
                            } else if (fileUrl && typeof fileUrl === 'object') {
                              docSrc = fileUrl.base64 || fileUrl.url || fileUrl.file || '';
                            }
                            setViewingDoc({ name: DOC_LABELS[docKey], src: docSrc }); 
                          }} style={{ background: 'none', border: 'none', color: 'var(--kapital-accent-orange)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.95rem', fontWeight: 500, padding: 0 }}>
                            <FileText size={16} /> Ver Archivo
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)' }}>Sin archivo</span>
                        )}
                        {estado === 'aprobado' && <span style={{ color: 'var(--kapital-accent-green)', fontWeight: 'bold', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}><ShieldCheck size={16}/> Aprobado</span>}
                        {estado === 'rechazado' && <span style={{ color: '#ff6b6b', fontWeight: 'bold', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={16}/> Rechazado</span>}
                        {estado === 'pendiente' && <span style={{ color: '#eab308', fontWeight: 'bold', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={16}/> En Revisión</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* === VEHÍCULO 2 MULTI-FIELD MODAL === */}
      {showVehiculo2Modal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          onClick={() => setShowVehiculo2Modal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--kapital-card-bg)', borderRadius: '12px', width: '100%', maxWidth: '500px', boxShadow: '0 8px 32px rgba(0,0,0,0.28)', border: '1px solid var(--kapital-border)', overflow: 'hidden' }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--kapital-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <PlusCircle size={15} style={{ color: '#3b82f6' }} />
                </div>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '0.95rem', color: 'var(--kapital-text-primary)' }}>Solicitar Vehículo 2</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--kapital-text-secondary)', marginTop: '1px' }}>El administrador revisará y aprobará la información</div>
                </div>
              </div>
              <button onClick={() => setShowVehiculo2Modal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--kapital-text-secondary)', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(148,163,184,0.15)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <X size={18} />
              </button>
            </div>
            {/* Body */}
            <form onSubmit={handleRequestVehiculo2} style={{ padding: '22px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '18px' }}>
                {[
                  { label: 'Placa *', key: 'placa2', required: true },
                  { label: 'Marca', key: 'vehiculoMarca2' },
                  { label: 'Modelo', key: 'vehiculoModelo2' },
                  { label: 'Año', key: 'vehiculoAnio2' },
                  { label: 'Color', key: 'vehiculoColor2' },
                  { label: 'Capacidad (pax)', key: 'capacidadVehiculo2' },
                ].map(({ label, key, required }) => (
                  <div key={key}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--kapital-text-secondary)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {label}
                    </label>
                    <input
                      type="text"
                      required={required}
                      value={vehiculo2Form[key]}
                      onChange={e => setVehiculo2Form(prev => ({ ...prev, [key]: e.target.value }))}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1.5px solid var(--kapital-border)', background: 'var(--kapital-bg)', color: 'var(--kapital-text-primary)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
                      onFocus={e => e.target.style.borderColor = '#3b82f6'}
                      onBlur={e => e.target.style.borderColor = 'var(--kapital-border)'}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowVehiculo2Modal(false)}
                  style={{ padding: '9px 18px', borderRadius: '8px', border: '1.5px solid var(--kapital-border)', background: 'none', color: 'var(--kapital-text-secondary)', fontWeight: '500', fontSize: '0.88rem', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(148,163,184,0.1)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  Cancelar
                </button>
                <button type="submit" disabled={loading}
                  style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', background: loading ? '#60a5fa' : '#3b82f6', color: '#fff', fontWeight: '600', fontSize: '0.88rem', cursor: loading ? 'not-allowed' : 'pointer' }}
                  onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#2563eb'; }}
                  onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#3b82f6'; }}>
                  {loading ? 'Enviando...' : 'Enviar solicitud'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingField && (
        <div 
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setEditingField(null)}
        >
          <div 
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--kapital-card-bg)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '420px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
              border: '1px solid var(--kapital-border)',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 22px',
              borderBottom: '1px solid var(--kapital-border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '8px',
                  background: 'rgba(59,130,246,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Edit3 size={15} style={{ color: '#3b82f6' }} />
                </div>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '0.95rem', color: 'var(--kapital-text-primary)' }}>
                    Solicitar cambio
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--kapital-text-secondary)', marginTop: '1px' }}>
                    {editingField.label}
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setEditingField(null)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--kapital-text-secondary)', padding: '6px', borderRadius: '6px',
                  display: 'flex', alignItems: 'center',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(148,163,184,0.15)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '22px' }}>
              <div style={{
                background: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: '8px',
                padding: '12px 14px',
                marginBottom: '20px',
                fontSize: '0.85rem',
                color: 'var(--kapital-text-secondary)',
                lineHeight: '1.55',
              }}>
                Tu solicitud será enviada al administrador para su revisión. El cambio se aplicará únicamente si es aprobado.
              </div>

              <form onSubmit={handleRequestUpdate}>
                <div style={{ marginBottom: '18px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    color: 'var(--kapital-text-secondary)',
                    marginBottom: '7px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}>
                    Nuevo valor — {editingField.label}
                  </label>
                  <input
                    type="text"
                    value={updateRequestValue}
                    onChange={(e) => setUpdateRequestValue(e.target.value)}
                    autoFocus
                    placeholder={`Escribe el nuevo ${editingField.label.toLowerCase()}...`}
                    style={{
                      width: '100%',
                      padding: '10px 13px',
                      borderRadius: '8px',
                      border: '1.5px solid var(--kapital-border)',
                      background: 'var(--kapital-bg)',
                      color: 'var(--kapital-text-primary)',
                      fontSize: '0.92rem',
                      outline: 'none',
                      transition: 'border-color 0.15s',
                      boxSizing: 'border-box',
                    }}
                    onFocus={e => e.target.style.borderColor = '#3b82f6'}
                    onBlur={e => e.target.style.borderColor = 'var(--kapital-border)'}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setEditingField(null)}
                    style={{
                      padding: '9px 18px',
                      borderRadius: '8px',
                      border: '1.5px solid var(--kapital-border)',
                      background: 'none',
                      color: 'var(--kapital-text-secondary)',
                      fontWeight: '500',
                      fontSize: '0.88rem',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(148,163,184,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      padding: '9px 20px',
                      borderRadius: '8px',
                      border: 'none',
                      background: loading ? '#60a5fa' : '#3b82f6',
                      color: '#fff',
                      fontWeight: '600',
                      fontSize: '0.88rem',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      transition: 'background 0.15s',
                      display: 'flex', alignItems: 'center', gap: '6px',
                    }}
                    onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#2563eb'; }}
                    onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#3b82f6'; }}
                  >
                    {loading ? 'Enviando...' : 'Enviar solicitud'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}



      {viewingDoc && (
        <div className="doc-viewer-overlay" onClick={() => setViewingDoc(null)}>
          <div className="doc-viewer-content" onClick={e => e.stopPropagation()}>
            <div className="doc-viewer-header">
              <h3>{viewingDoc.name}</h3>
              <button className="close-btn-inline" onClick={() => setViewingDoc(null)}><X size={20} /></button>
            </div>
            <div className="doc-viewer-body">
              {(!viewingDoc.src || viewingDoc.src === '') ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>
                  <p>No se pudo cargar el documento o el archivo está vacío.</p>
                </div>
              ) : typeof viewingDoc.src === 'string' && (viewingDoc.src.includes('application/pdf') || viewingDoc.src.endsWith('.pdf') || viewingDoc.src.startsWith('data:application/pdf')) ? (
                <iframe src={viewingDoc.src} className="doc-iframe" title="Visor de Documento" />
              ) : (
                <img src={viewingDoc.src} alt={viewingDoc.name} className="doc-image" />
              )}
            </div>
          </div>
        </div>
      )}
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
const AuditLog = ({ logs }) => ( <div className="card"><div className="card-header"><h2>Registro de Actividad (Audit Log)</h2></div><div className="audit-log-container">{logs.map((log, index) => <p key={index} className="log-entry">{log}</p>)}</div></div> );
const DashboardView = ({ routes, addLog, setRoutes, usuarioActual, sessionSaved, onSaveSession, onUnsaveSession, onSessionDirty }) => {
  const syncToBackend = async (newRoutes) => {
    try {
      await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Owner-Email': usuarioActual?.email || 'Desconocido' },
        body: JSON.stringify(newRoutes)
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
    addLog(`Pasajero ${agenteId} reasignado manualmente por Drag & Drop.`);
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
      const response = await fetch(`/api/assign-routes/`, { method: 'POST', body: formData });
      if (!response.ok) {
        const errData = await response.json();
        let errMsg = errData.detail;
        if (typeof errMsg === 'object') {
          errMsg = JSON.stringify(errMsg).replace(/[\[\]"{}]+/g, ' ');
        }
        throw new Error(errMsg || 'Ocurrió un error interno en el servidor.');
      }
      const result = await response.json();
      setRoutes(result);
      if (onSessionDirty) onSessionDirty(); // Mark session as unsaved after new generation
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
      toast.info(message);
      addLog(message);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/emergency-reassign/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(emergencyData) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Error en la reasignación.');
      toast.success(data.message);
      setRoutes(data.rutas_actualizadas);
      addLog(`🚨 URGENTE: Ruta de ${conductor_id} (${horario}) reasignada a ${data.rescatista_id}.`);
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
    setSelectedFile(null);
    setFileInputKey(prev => prev + 1);
    setError(null);
    // Clear saved session too
    localStorage.removeItem('kapital_saved_session');
    if (onUnsaveSession) onUnsaveSession();
    // Clear on backend
    try {
      await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([])
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
  const [logs, setLogs] = useState(() => {
    const savedLogs = localStorage.getItem('kapital_audit_logs');
    return savedLogs ? JSON.parse(savedLogs) : [];
  });
  const [theme, setTheme] = useState(localStorage.getItem('kapital_theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('kapital_theme', theme);
  }, [theme]);



  const handleSaveSession = async () => {
    if (routes.length === 0) return;
    localStorage.setItem('kapital_saved_session', JSON.stringify(routes));
    setSessionSaved(true);
    addLog('Sesión guardada. Publicando al Gerente de Operaciones...');
    try {
      const res = await fetch('/api/routes/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(routes),
      });
      if (res.ok) {
        const data = await res.json();
        addLog(`✅ ${data.message || 'Datos publicados al Gerente.'}`);
      } else {
        addLog('⚠️ Sesión guardada localmente. Error al publicar al Gerente.');
      }
    } catch (e) {
      addLog('⚠️ Sesión guardada localmente (sin conexión al servidor).');
    }
  };

  const handleUnsaveSession = () => {
    localStorage.removeItem('kapital_saved_session');
    setSessionSaved(false);
    addLog('Sesión desbloqueada. El tablero no persistirá al recargar.');
  };

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  useEffect(() => {
    const userFromStorage = localStorage.getItem('kapital_user');
    if (userFromStorage) {
      const parsedUser = JSON.parse(userFromStorage);
      setUsuarioActual(parsedUser);
      
      // Fetch fresh profile from backend to ensure we're not stuck with stale state
      const userKey = parsedUser.identifier || parsedUser.email;
      if (userKey) {
        fetch(`/api/user/profile?email=${encodeURIComponent(userKey)}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data) {
              const freshUser = { ...parsedUser, ...data };
              localStorage.setItem('kapital_user', JSON.stringify(freshUser));
              setUsuarioActual(freshUser);
            }
          })
          .catch(err => console.warn('Error fetching fresh profile on load:', err));
      }
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
  
  const isFetchingRef = React.useRef(false);
  const initializedRef = React.useRef(false);
  const [lastNotifId, setLastNotifId] = useState(0);

  useEffect(() => {
    if (!usuarioActual || !['Administración', 'Administrador', 'Gerente de Operaciones'].includes(usuarioActual.rol)) return;
    
    const checkNotifications = async (suppressToasts) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      try {
        const res = await fetch(`/api/notifications?last_id=${lastNotifId}`);
        if (res.ok) {
          const newNotifs = await res.json();
          if (newNotifs.length > 0) {
            const maxId = Math.max(...newNotifs.map(n => n.id));
            setLastNotifId(maxId);
            
            if (!suppressToasts) {
              newNotifs.forEach(n => {
                const msg = n.message || n.mensaje || 'Nueva notificación';
                if (n.type === 'success') toast.success(msg, { id: `notif-${n.id}` });
                else if (n.type === 'error') toast.error(msg, { id: `notif-${n.id}`, duration: 8000 });
                else toast(msg, { id: `notif-${n.id}`, icon: 'ℹ️' });
              });
            }
          }
        }
      } catch (e) { } finally {
        isFetchingRef.current = false;
        initializedRef.current = true;
      }
    };

    if (lastNotifId === 0 && !initializedRef.current) {
      checkNotifications(true);
    }
    
    const interval = setInterval(() => {
      if (initializedRef.current) checkNotifications(false);
    }, 5000);
    
    return () => clearInterval(interval);
  }, [usuarioActual, lastNotifId]);

  const renderVista = () => {

    switch (vistaActual) {
      case 'flota': return <FlotaView usuario={usuarioActual} />;
      case 'reportes': return <VistaReportes />;
      case 'configuracion': return <VistaConfiguracion />;
      case 'usuarios': return <UsersManagementTab usuarioActual={usuarioActual} initialTab={vistaParams?.tab || 'Todos'} />;
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
        return <DashboardView routes={routes} addLog={addLog} setRoutes={setRoutes} usuarioActual={usuarioActual} sessionSaved={sessionSaved} onSaveSession={handleSaveSession} onUnsaveSession={handleUnsaveSession} onSessionDirty={() => setSessionSaved(false)} />;
    }
  };


  if (!usuarioActual) {
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
        <GerentePortal usuario={usuarioActual} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} />
      </>
    );
  }

  if (usuarioActual.rol === 'Cliente') {
    return (
      <>
        <Toaster position="top-right" />
        <ClientPortal usuario={usuarioActual} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} />
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
        {renderVista()}
        <AuditLog logs={logs} />
      </main>
    </div>
  );
}

export default App;
