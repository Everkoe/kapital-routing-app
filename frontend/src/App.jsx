// App.jsx - Trigger Vercel Deploy 
import React, { useState, useMemo, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Shield, User, Moon, Sun } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import './App.css';
import LiveMap from './LiveMap';
import FlotaView from './FlotaView';
import DriverPortal from './DriverPortal';
import GerentePortal from './GerentePortal';
import CopilotChat from './CopilotChat';
import VistaReportes from './VistaReportes';

// --- Componente de Autenticación ---
const PantallaAuth = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isVerificationStep, setIsVerificationStep] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [formData, setFormData] = useState({ email: '', password: '', confirmar_password: '', telefono: '', nombre: '', rol: 'Programador de rutas', unidad_id: '', empresa_id: '' });

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
            
                {!isLogin && <input className="auth-input" name="nombre" type="text" placeholder="Nombre Completo" onChange={handleInputChange} required />}
                {!isLogin && <input className="auth-input" name="telefono" type="tel" placeholder="Teléfono" onChange={handleInputChange} required />}
                <input className="auth-input" name="email" type="email" placeholder="Correo Electrónico" onChange={handleInputChange} required />
                <input className="auth-input" name="password" type="password" placeholder="Contraseña" onChange={handleInputChange} required />
                {!isLogin && <input className="auth-input" name="confirmar_password" type="password" placeholder="Confirmar Contraseña" onChange={handleInputChange} required />}
                
                {!isLogin && (
                  <>
                    <select className="auth-input" name="rol" onChange={handleInputChange}>
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
    "Programador de rutas": ['#6366f1','rgba(99,102,241,0.15)'],
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
const UsersManagementTab = ({ usuarioActual }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [modal, setModal] = useState({ isOpen: false, config: null, onConfirm: null });
  const [driverModal, setDriverModal] = useState({ isOpen: false, user: null });

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
                  background: 'linear-gradient(135deg, var(--primary-color, #6366f1), #8b5cf6)', fontSize: '1.1rem',
                  boxShadow: '0 4px 12px rgba(99,102,241,0.35)',
                }}>🛡️</div>
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
          {loading ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '12px', animation: 'spin 1s linear infinite' }}>⚙️</div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <p style={{ margin: 0 }}>Cargando usuarios...</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 6px' }}>
                <thead>
                  <tr>
                    {['Usuario', 'Correo Electrónico', 'Rol', 'Estado', 'Acciones'].map(h => (
                      <th key={h} style={{
                        padding: '8px 14px', fontSize: '10px', fontWeight: 700, letterSpacing: '1.2px',
                        textTransform: 'uppercase', color: 'var(--text-secondary)', textAlign: 'left',
                        borderBottom: '2px solid var(--border-color)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.email}
                      style={{ borderRadius: '10px', transition: 'background 0.15s', cursor: 'default' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '13px 14px', borderRadius: '10px 0 0 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'linear-gradient(135deg, var(--primary-color, #6366f1), #8b5cf6)',
                            color: 'white', fontWeight: 700, fontSize: '0.88rem',
                            boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                          }}>{u.nombre?.charAt(0)?.toUpperCase() || '?'}</div>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{u.nombre}</span>
                        </div>
                      </td>
                      <td style={{ padding: '13px 14px', color: 'var(--text-secondary)', fontSize: '0.86rem' }}>{u.email}</td>
                      <td style={{ padding: '13px 14px' }}><RoleBadge rol={u.rol} /></td>
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
            </div>
          )}
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
    <nav className="navbar">
      <div className="navbar-left">
        <img src="/logo.png" alt="Kapital Routing Logo" className="navbar-logo" onClick={() => handleNav('dashboard')} />
      </div>
      
      <button className="hamburger-menu" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? '✕' : '☰'}
      </button>

      <div className={`nav-links ${isOpen ? 'open' : ''}`}>
        {usuarioActual?.rol === 'Programador de rutas' && (
          <>
            <a onClick={() => handleNav('dashboard')} className={vistaActual === 'dashboard' ? 'nav-link active' : 'nav-link'}>Tablero</a>
            <a onClick={() => handleNav('reportes')} className={vistaActual === 'reportes' ? 'nav-link active' : 'nav-link'}>Reportes</a>
            <a onClick={() => handleNav('configuracion')} className={vistaActual === 'configuracion' ? 'nav-link active' : 'nav-link'}>Configuración</a>
          </>
        )}
        
        {['Administración', 'Administrador'].includes(usuarioActual?.rol) && (
          <>
           <a onClick={() => handleNav('flota')} className={vistaActual === 'flota' ? 'nav-link active' : 'nav-link'}>Gestión de Flota</a>
           <a onClick={() => handleNav('usuarios')} className={vistaActual === 'usuarios' ? 'nav-link nav-link-icon active' : 'nav-link nav-link-icon'} style={{color: '#38BDF8'}}>
             <Shield size={18} style={{ marginRight: '6px' }} /> Accesos
           </a>
          </>
        )}
        
        <span className="nav-separator">|</span>
        
        <a onClick={() => handleNav('perfil')} className={vistaActual === 'perfil' ? 'nav-link nav-link-icon active' : 'nav-link nav-link-icon'}>
          <User size={18} style={{ marginRight: '6px' }} /> Mi Perfil
        </a>
        <a onClick={() => { onLogout(); setIsOpen(false); }} className="nav-link">Cerrar Sesión</a>
        
        <button onClick={toggleTheme} className="theme-toggle" title="Cambiar Tema">
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} color="#facc15" fill="#facc15" />}
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

  return (
    <div className="card profile-wrapper">
      <div className="profile-tabs">
        <button className={activeTab === 'personal' ? 'active' : ''} onClick={() => setActiveTab('personal')}>Información Personal</button>
        <button className={activeTab === 'security' ? 'active' : ''} onClick={() => setActiveTab('security')}>Seguridad</button>
      </div>
      
      <div className="profile-content">
        {activeTab === 'personal' && (
          <div className="profile-layout-grid">
            <div className="profile-avatar-column">
              <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''} profile-dropzone`}>
                <input {...getInputProps()} />
                <div className="avatar-preview-container">
                  {avatar ? (
                    <img src={avatar} alt="Avatar" className="profile-avatar-img" />
                  ) : (
                    <div className="profile-avatar">{usuario.nombre.charAt(0)}</div>
                  )}
                  <div className="avatar-overlay">
                    <span className="camera-icon">📷</span>
                  </div>
                </div>
                <p className="dropzone-text">{isDragActive ? 'Suelta aquí' : 'Cambiar Foto'}</p>
              </div>
              <p className="avatar-hint">Formatos: JPG, PNG (Max 2MB)</p>
            </div>
            
            <div className="profile-form-column">
              <h3 className="profile-section-title">Información Básica</h3>
              <form className="profile-form" onSubmit={handleSave}>
                <div className="form-group">
                  <label>Nombre Completo</label>
                  <input type="text" name="nombre" value={formData.nombre} onChange={handleChange} className="form-input" required />
                </div>
                <div className="form-group">
                  <label>Correo Electrónico</label>
                  <input type="email" value={usuario.email} className="form-input disabled-input" disabled />
                  <span className="input-hint">El correo no puede modificarse por seguridad.</span>
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
        <KPICard title="Tasa de Optimización" value={`${kpis.tasaOptimizacion}%`} color="#8b5cf6" />
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
    document.body.setAttribute('data-theme', theme);
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
  
  const [lastNotifId, setLastNotifId] = useState(0);

  useEffect(() => {
    if (!usuarioActual || !['Administración', 'Administrador', 'Gerente de Operaciones'].includes(usuarioActual.rol)) return;
    
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/notifications?last_id=${lastNotifId}`);
        if (res.ok) {
          const newNotifs = await res.json();
          if (newNotifs.length > 0) {
            const maxId = Math.max(...newNotifs.map(n => n.id));
            setLastNotifId(maxId);
            
            newNotifs.forEach(n => {
              // Play a small beep (using HTML5 Audio or silent if preferred)
              // We will just use the toast visually
              if (n.type === 'success') toast.success(n.message, { id: `notif-${n.id}` });
              else if (n.type === 'error') toast.error(n.message, { id: `notif-${n.id}`, duration: 8000 });
              else toast(n.message, { id: `notif-${n.id}`, icon: 'ℹ️' });
            });
          }
        }
      } catch (e) { }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [usuarioActual, lastNotifId]);

  const renderVista = () => {
    // If the user is Administración and they don't have dashboard, force them to 'usuarios'
    if (['Administración', 'Administrador'].includes(usuarioActual?.rol) && vistaActual === 'dashboard') {
      return <UsersManagementTab usuarioActual={usuarioActual} />;
    }

    switch (vistaActual) {
      case 'flota': return <FlotaView />;
      case 'reportes': return <VistaReportes />;
      case 'configuracion': return <VistaConfiguracion />;
      case 'usuarios': return <UsersManagementTab usuarioActual={usuarioActual} />;
      case 'perfil': return <VistaPerfil usuario={usuarioActual} setUsuarioActual={setUsuarioActual} onLogout={handleLogout} />;
      case 'dashboard':
      default:
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

  if (usuarioActual.rol === 'Conductor') {
    return (
      <>
        <Toaster position="top-right" />
        <DriverPortal usuario={usuarioActual} setUsuarioActual={setUsuarioActual} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} />
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
        <CopilotChat />
      </main>
    </div>
  );
}

export default App;
