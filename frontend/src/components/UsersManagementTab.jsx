import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, XCircle, MinusCircle, CheckSquare, X, Eye, FileText, Download, Truck, Shield, Search, User } from 'lucide-react';
import { GlobalLoader } from './GlobalLoader';
import DocumentVerification from './DocumentVerification';

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
          margin: '0 auto 20px',
        }}>
          {config?.icon || <AlertTriangle size={32} color="var(--primary-color)" />}
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
  const [padronModal, setPadronModal] = useState({ isOpen: false, email: null, padron: '' });
  const [adminDocViewer, setAdminDocViewer] = useState(null); // { name, src }

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
        type: 'success', icon: <CheckCircle2 size={36} color="#10b981" />, title: 'Aprobar Acceso',
        message: `¿Confirmas que deseas otorgar acceso a la plataforma a este usuario? Podrá iniciar sesión de inmediato.`,
        userEmail: targetEmail, confirmText: `Aprobar a ${userName}`,
      },
      reject_pending: {
        type: 'danger', icon: <XCircle size={36} color="#ef4444" />, title: 'Denegar Solicitud',
        message: `Esta acción rechazará la solicitud de acceso y eliminará la cuenta pendiente del sistema.`,
        userEmail: targetEmail, confirmText: 'Sí, denegar acceso',
      },
      deactivate: {
        type: 'danger', icon: <MinusCircle size={36} color="#ef4444" />, title: 'Desactivar Usuario Activo',
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

  const confirmReview = (email, action) => {
    closeDriverModal();
    const targetUser = users.find(u => u.email === email);
    if (targetUser?.rol === 'Conductor' && action === 'approve') {
      setPadronModal({ isOpen: true, email: email, padron: '' });
      return;
    }
    executeReview(email, action, '');
  };

  const executeReview = async (email, action, padron) => {
    setActionLoading(email);
    try {
      const apiAction = action === 'approve' ? 'approve' : 'reject';
      const method = action === 'approve' ? 'PUT' : 'DELETE';
      const unidadIdParam = padron ? `&unidad_id=${encodeURIComponent(padron.trim())}` : '';
      const res = await fetch(`/api/admin/users/${apiAction}/${encodeURIComponent(email)}?admin_email=${encodeURIComponent(usuarioActual.email)}${unidadIdParam}`, { method });
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

  const submitPadron = () => {
    if (!padronModal.padron || !padronModal.padron.trim()) {
      toast.error("Debe asignar un Padrón para aprobar a un conductor.");
      return;
    }
    const email = padronModal.email;
    setPadronModal({ isOpen: false, email: null, padron: '' });
    executeReview(email, 'approve', padronModal.padron);
  };

  const openAdminDoc = (label, docObj) => {
    const src = typeof docObj === 'string' ? docObj : docObj?.url || docObj?.base64 || docObj?.data || null;
    if (!src) return;
    setAdminDocViewer({ name: label, src, raw: docObj });
  };

  const renderDocRow = (label, docObj) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {label}: {docObj ? <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CheckSquare size={16} color="#10b981" /> Subido</span> : <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><X size={16} color="#ef4444" strokeWidth={3} /> Falta</span>}
      </span>
      {docObj && (
        <button
          onClick={() => openAdminDoc(label, docObj)}
          style={{ padding: '4px 10px', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', color: '#38BDF8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Eye size={14} color="#38BDF8" /> Ver Archivo
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
        <div onClick={closeDriverModal} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: '16px', padding: '30px', maxWidth: '600px', width: '90%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
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

              {/* <DocumentVerification
                doc={driverModal.user?.perfil_conductor?.numDoc || driverModal.user?.nombre}
                placa={driverModal.user?.perfil_conductor?.vehiculoPlaca}
                cachedResults={{
                  soat: driverModal.user?.perfil_conductor?.validacion_soat,
                  citv: driverModal.user?.perfil_conductor?.validacion_citv,
                  licencia: driverModal.user?.perfil_conductor?.validacion_licencia
                }}
              /> */}
            </div>

            <div style={{ display: 'flex', gap: '15px', marginTop: '30px', justifyContent: 'flex-end' }}>
              <button onClick={closeDriverModal} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer' }}>Cerrar</button>
              <button onClick={() => confirmReview(driverModal.user.email, 'reject')} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer' }}>Rechazar</button>
              <button onClick={() => confirmReview(driverModal.user.email, 'approve')} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#10b981', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>Aprobar Conductor</button>
            </div>
          </div>
        </div>
      )}

      {padronModal.isOpen && (
        <div onClick={() => setPadronModal({ isOpen: false, email: null, padron: '' })} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-secondary, #1a1d2e)', border: '1px solid var(--border-color, #2e303a)', borderRadius: '16px', padding: '32px 40px', maxWidth: '480px', width: '90%', textAlign: 'center', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <div style={{ background: 'rgba(16, 185, 129, 0.12)', padding: '14px', borderRadius: '50%' }}>
                <Truck size={34} color="#10b981" />
              </div>
            </div>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.4rem', fontWeight: 'bold' }}>Asignar Padrón</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.95rem', lineHeight: '1.4' }}>
              Asigna un número de Padrón o ID de Unidad definitivo para autorizar a este conductor.
            </p>
            <input
              type="text"
              className="form-input"
              style={{
                width: '100%', marginBottom: '24px', textAlign: 'center',
                fontSize: '1.05rem', padding: '10px', borderRadius: '8px',
                border: '1px solid var(--border-color)', background: 'var(--bg, #0f172a)'
              }}
              placeholder="Ej. KAP-001"
              value={padronModal.padron}
              onChange={e => setPadronModal({ ...padronModal, padron: e.target.value })}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setPadronModal({ isOpen: false, email: null, padron: '' })} className="btn-secondary" style={{ flex: 1, padding: '10px', fontSize: '0.95rem' }}>Cancelar</button>
              <button onClick={submitPadron} className="btn-primary" style={{ flex: 1, padding: '10px', background: '#10b981', fontSize: '0.95rem' }}>Confirmar Aprobación</button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Document Viewer Modal - image only */}
      {adminDocViewer && (() => {
        const src = adminDocViewer.src || '';
        const hasData = src.startsWith('data:') || src.startsWith('http');
        const isPdf = src.toLowerCase().includes('.pdf') || src.startsWith('data:application/pdf');
        const downloadDoc = () => {
          if (!hasData) return;
          const a = document.createElement('a');
          a.href = src;
          a.download = adminDocViewer.name;
          a.click();
        };
        return (
          <div onClick={() => setAdminDocViewer(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: isPdf ? '600px' : '900px', height: isPdf ? 'auto' : '80vh', minHeight: isPdf ? '300px' : 'auto', background: 'var(--bg-secondary, #1a1d2e)', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '15px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, color: 'var(--text-primary, #fff)' }}>{adminDocViewer.name}</h3>
                <button onClick={() => setAdminDocViewer(null)} style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', padding: '4px' }}><X size={22} /></button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '40px 30px' }}>
                {hasData ? (
                  isPdf ? (
                    <div style={{ padding: '20px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                        <FileText size={72} color="#38BDF8" />
                      </div>
                      <h3 style={{ color: 'var(--text-primary)', marginBottom: '30px', fontSize: '1.4rem' }}>Archivo PDF</h3>
                      <button onClick={downloadDoc} style={{ padding: '12px 24px', background: 'var(--primary, #38BDF8)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 auto' }}>
                        <Download size={20} /> Descargar para visualizar
                      </button>
                    </div>
                  ) : (
                    <img src={src} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '8px' }} alt={adminDocViewer.name} />
                  )
                ) : (
                  <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📄</div>
                    <h3 style={{ color: 'var(--text-primary, #fff)', marginBottom: '8px' }}>{adminDocViewer.name}</h3>
                    <p style={{ color: '#aaa' }}>No hay archivo disponible para previsualizar.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
                                  display: 'flex', alignItems: 'center', gap: '6px'
                                }}
                                  onMouseEnter={e => { e.target.style.background = '#10b981'; e.target.style.color = '#fff'; e.target.style.boxShadow = '0 4px 12px rgba(16,185,129,0.4)'; }}
                                  onMouseLeave={e => { e.target.style.background = 'rgba(16,185,129,0.1)'; e.target.style.color = '#10b981'; e.target.style.boxShadow = 'none'; }}>
                                  <CheckCircle2 size={14} /> Aprobar
                                </button>
                                <button onClick={() => requestAction(u.email, 'reject_pending', u.nombre)} style={{
                                  padding: '6px 13px', borderRadius: '8px', border: '1px solid #ef444466',
                                  background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: 'pointer',
                                  fontWeight: 600, fontSize: '0.8rem', transition: 'all 0.18s', whiteSpace: 'nowrap',
                                  display: 'flex', alignItems: 'center', gap: '6px'
                                }}
                                  onMouseEnter={e => { e.target.style.background = '#ef4444'; e.target.style.color = '#fff'; e.target.style.boxShadow = '0 4px 12px rgba(239,68,68,0.4)'; }}
                                  onMouseLeave={e => { e.target.style.background = 'rgba(239,68,68,0.1)'; e.target.style.color = '#ef4444'; e.target.style.boxShadow = 'none'; }}>
                                  <XCircle size={14} /> Denegar
                                </button>
                              </>
                            )}
                            {u.estado === 'Pendiente Revisión' && (
                              <button onClick={() => handleReviewDriver(u)} style={{
                                padding: '6px 13px', borderRadius: '8px', border: '1px solid #3b82f666',
                                background: 'rgba(59,130,246,0.1)', color: '#3b82f6', cursor: 'pointer',
                                fontWeight: 600, fontSize: '0.8rem', transition: 'all 0.18s', whiteSpace: 'nowrap',
                                display: 'flex', alignItems: 'center', gap: '6px'
                              }}
                                onMouseEnter={e => { e.target.style.background = '#3b82f6'; e.target.style.color = '#fff'; e.target.style.boxShadow = '0 4px 12px rgba(59,130,246,0.4)'; }}
                                onMouseLeave={e => { e.target.style.background = 'rgba(59,130,246,0.1)'; e.target.style.color = '#3b82f6'; e.target.style.boxShadow = 'none'; }}>
                                <Search size={14} /> Revisar Perfil
                              </button>
                            )}
                            {u.estado === 'Activo' && u.email !== usuarioActual.email && (
                              <button onClick={() => requestAction(u.email, 'deactivate', u.nombre)} style={{
                                padding: '6px 13px', borderRadius: '8px', border: '1px solid #ef444455',
                                background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer',
                                fontWeight: 600, fontSize: '0.8rem', transition: 'all 0.18s', whiteSpace: 'nowrap',
                                display: 'flex', alignItems: 'center', gap: '6px'
                              }}
                                onMouseEnter={e => { e.target.style.background = '#ef4444'; e.target.style.color = '#fff'; e.target.style.boxShadow = '0 4px 12px rgba(239,68,68,0.4)'; }}
                                onMouseLeave={e => { e.target.style.background = 'rgba(239,68,68,0.08)'; e.target.style.color = '#ef4444'; e.target.style.boxShadow = 'none'; }}>
                                <MinusCircle size={14} /> Desactivar
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
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}>
                    <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: '50%', border: '1px solid var(--border-color)' }}>
                      <User size={36} color="var(--text-secondary)" />
                    </div>
                  </div>
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

export default UsersManagementTab;
