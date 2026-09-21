import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { Paperclip, MessageCircle, Loader, Download, User, Search, AlertTriangle, FileCheck, CarFront, X, Check, Send, ShieldAlert, ChevronDown } from 'lucide-react';
import { GlobalLoader } from './components/GlobalLoader';
import CorreoEditable from './components/CorreoEditable';
import CampoEditable from './components/CampoEditable';
import RegistroDeUnidad from './components/RegistroDeUnidad';
import DocumentViewer from './components/DocumentViewer';
import ImagenGuardada from './components/ImagenGuardada';
import { countFleetDocumentStatuses, getDocumentStatus, getFleetUnitId } from './utils/flotaDocumentStatus';
import { apiFetch, apiRequest } from './utils/apiClient';

import RevisionDocumentosConductor from './components/RevisionDocumentosConductor';
import { telefonoDeUnidad, whatsappDeUnidad } from './utils/telefonoUnidad';
import './App.css';

const ADMIN_WS_STATE_EVENT = 'kapital:admin-ws-state';
const ADMIN_WS_ROLES = new Set(['Administración', 'Administrador', 'Gerente de Operaciones']);

const announceAdminWebSocketState = (connected) => {
  if (typeof window === 'undefined') return;
  window.__kapitalAdminWebSocketConnected = connected;
  window.dispatchEvent(new CustomEvent(ADMIN_WS_STATE_EVENT, { detail: { connected } }));
};

/**
 * Tipos de unidad que la flota usa realmente.
 *
 * La lista anterior ofrecía «Sprinter», «Auto (Remisse)» y «Moto (Courier)»,
 * que no aparecían en ninguna de las 109 unidades, mientras que AUTO, SUV y
 * VAN —los tres mayoritarios— no estaban. La base operativa (Masivo, Remisse)
 * es un campo aparte y no se duplica en el tipo.
 */
const TIPOS_DE_UNIDAD = ['AUTO', 'SUV', 'VAN', 'MINIVAN', 'CAMIONETA'];

/** Espejo de `_ADMINISTRATION_ROLES` del backend: más estrecho que el gate admin. */
const ROLES_QUE_RENOMBRAN = new Set(['Admin', 'Administración', 'Administrador']);



// Traduce el shortcut recibido desde el dashboard al valor exacto usado en BASE_OPTIONS.
const _resolveInitialBase = (raw) => {
  if (!raw) return 'Todas';
  const upper = String(raw).toUpperCase();
  if (upper === 'MOTORIZADO' || upper.includes('SHARF')) return 'SHARF MOTORIZADO';
  if (upper === 'REMISSE') return 'REMISSE';
  if (upper === 'MASIVO') return 'MASIVO';
  return 'Todas';
};

const FlotaView = ({ usuario, initialBase }) => {
  const isCliente = usuario?.rol === 'Cliente';
  // Renombrar migra la clave que relaciona unidad, conductor y sesión, así que
  // se reserva a Administración. El backend lo exige igual; esto solo evita
  // ofrecer un control que iba a devolver 403.
  const puedeRenombrar = ROLES_QUE_RENOMBRAN.has(usuario?.rol);
  const [flota, setFlota] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [baseFilter, setBaseFilter] = useState(() => _resolveInitialBase(initialBase));
  const [baseDropdownOpen, setBaseDropdownOpen] = useState(false);
  const baseDropdownRef = useRef(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef(null);

  const BASE_OPTIONS = [
    { key: 'Todas', label: 'Todas las Bases' },
    { key: 'MASIVO', label: 'Masivo General' },
    { key: 'REMISSE', label: 'Remisse' },
    { key: 'SHARF MOTORIZADO', label: 'Sharf Motorizado' }
  ];

  const EXPORT_OPTIONS = [
    { key: 'MASIVO', label: 'BASE MASIVO 2026', filename: 'BASE MASIVO 2026.xlsx' },
    { key: 'REMISSE', label: 'BASE REMISSE 2026', filename: 'BASE REMISSE 2026.xlsx' },
    { key: 'TODAS', label: 'Todas las bases (una hoja)', filename: 'BASE FLOTA 2026.xlsx' },
  ];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (baseDropdownRef.current && !baseDropdownRef.current.contains(event.target)) {
        setBaseDropdownOpen(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const [showModal, setShowModal] = useState(false);
  const [viendoDocumento, setViendoDocumento] = useState(null);


  // Conductor Modal state
  const [isConductorModalOpen, setIsConductorModalOpen] = useState(false);
  const [conductorInfo, setConductorInfo] = useState(null);
  const [isLoadingConductor, setIsLoadingConductor] = useState(false);

  const [resolveLoading, setResolveLoading] = useState({});
  const [notifyMsg, setNotifyMsg] = useState('');
  const [isSendingNotify, setIsSendingNotify] = useState(false);
  
  // Doc Viewer State

  // --- Admin WebSocket: notificaciones de conductores en tiempo real ---
  const [adminNotifs, setAdminNotifs] = useState([]);
  const wsAdminRef = useRef(null);
  const wsAdminReconnectRef = useRef(null);
  const wsAdminAttemptsRef = useRef(0);
  const wsAdminHeartbeatRef = useRef(null);
  const wsAdminIntentionalCloseRef = useRef(false);
  const connectAdminWSRef = useRef(null);

  const usuarioRef = useRef(usuario);
  useEffect(() => {
    usuarioRef.current = usuario;
  }, [usuario]);

  const closeAdminWS = useCallback(() => {
    wsAdminIntentionalCloseRef.current = true;
    if (wsAdminReconnectRef.current) {
      clearTimeout(wsAdminReconnectRef.current);
      wsAdminReconnectRef.current = null;
    }
    if (wsAdminHeartbeatRef.current) {
      clearInterval(wsAdminHeartbeatRef.current);
      wsAdminHeartbeatRef.current = null;
    }
    const currentSocket = wsAdminRef.current;
    wsAdminRef.current = null;
    if (currentSocket) {
      currentSocket.onclose = null;
      currentSocket.close();
    }
    announceAdminWebSocketState(false);
  }, []);

  const connectAdminWS = useCallback(() => {
    const userKey = usuarioRef.current?.identifier || usuarioRef.current?.email;
    if (!userKey || document.hidden || !ADMIN_WS_ROLES.has(usuarioRef.current?.rol) || typeof WebSocket === 'undefined') return;
    if (wsAdminRef.current?.readyState === WebSocket.OPEN || wsAdminRef.current?.readyState === WebSocket.CONNECTING) return;

    wsAdminIntentionalCloseRef.current = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${encodeURIComponent(userKey)}`;
    const ws = new WebSocket(wsUrl);
    wsAdminRef.current = ws;

    ws.onopen = () => {
      wsAdminAttemptsRef.current = 0;
      if (wsAdminHeartbeatRef.current) clearInterval(wsAdminHeartbeatRef.current);
      wsAdminHeartbeatRef.current = setInterval(() => {
        if (!document.hidden && ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 30000);
      announceAdminWebSocketState(true);
    };

    ws.onmessage = (event) => {
      if (event.data === 'pong') return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.tipo === 'docs_resubmitted') {
          toast(`📥 ${msg.conductor_nombre} resubió sus documentos`, { icon: '📌', duration: 7000 });
          setAdminNotifs(prev => [{ ...msg, leido: false, id: Date.now() }, ...prev]);
        }
      } catch(e) {}
    };

    ws.onclose = () => {
      if (ws !== wsAdminRef.current) return;
      wsAdminRef.current = null;
      if (wsAdminHeartbeatRef.current) {
        clearInterval(wsAdminHeartbeatRef.current);
        wsAdminHeartbeatRef.current = null;
      }
      announceAdminWebSocketState(false);
      if (wsAdminIntentionalCloseRef.current || document.hidden) return;
      const delay = Math.min(1000 * 2 ** wsAdminAttemptsRef.current, 30000);
      wsAdminAttemptsRef.current += 1;
      wsAdminReconnectRef.current = setTimeout(() => {
        wsAdminReconnectRef.current = null;
        connectAdminWSRef.current?.();
      }, delay);
    };

    ws.onerror = () => ws.close();
  }, []);

  const canReceiveAdminNotifications = ADMIN_WS_ROLES.has(usuario?.rol);
  useEffect(() => {
    connectAdminWSRef.current = connectAdminWS;
    return () => {
      if (connectAdminWSRef.current === connectAdminWS) connectAdminWSRef.current = null;
    };
  }, [connectAdminWS]);

  useEffect(() => {
    if (!canReceiveAdminNotifications) {
      closeAdminWS();
      return undefined;
    }

    const syncAdminWebSocket = () => {
      if (document.hidden) {
        closeAdminWS();
      } else {
        connectAdminWS();
      }
    };

    syncAdminWebSocket();
    document.addEventListener('visibilitychange', syncAdminWebSocket);
    window.addEventListener('focus', syncAdminWebSocket);
    return () => {
      document.removeEventListener('visibilitychange', syncAdminWebSocket);
      window.removeEventListener('focus', syncAdminWebSocket);
      closeAdminWS();
    };
  }, [canReceiveAdminNotifications, connectAdminWS, closeAdminWS]);

  const handleResolveDataRequest = async (campo, action) => {
    if (!conductorInfo || !usuario) return;
    setResolveLoading(prev => ({ ...prev, [campo]: true }));
    try {
      await apiFetch('/api/admin/resolve-update', {
        method: 'POST',
        json: {
          admin_email: usuario?.identifier || usuario?.email || '',
          conductor_email: conductorInfo?.usuario?.identifier || conductorInfo?.usuario?.email || conductorInfo?.flota?.conductor || '',
          field: campo,
          action: action,
        },
      });
      
      // Update local state to reflect the change immediately
      const updatedConductorInfo = { ...conductorInfo };
      if (updatedConductorInfo.usuario?.perfil_conductor) {
        if (action === 'approve') {
          const newVal = updatedConductorInfo.usuario.perfil_conductor.solicitudes_cambio[campo].new_value;
          updatedConductorInfo.usuario.perfil_conductor[campo] = newVal;
        }
        if (updatedConductorInfo.usuario.perfil_conductor.solicitudes_cambio[campo]) {
          updatedConductorInfo.usuario.perfil_conductor.solicitudes_cambio[campo].status = action === 'approve' ? 'aprobado' : 'rechazado';
        }
      }
      setConductorInfo(updatedConductorInfo);
      
      toast.success(`Solicitud ${action === 'approve' ? '✅ Aprobada' : '❌ Rechazada'}`);
      
      // Refresh list to update main table badges if necessary
      fetchFlota();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setResolveLoading(prev => ({ ...prev, [campo]: false }));
    }
  };

  const handleNotifyDriver = async () => {
    if (!notifyMsg.trim() || !conductorInfo || !usuario) return;
    setIsSendingNotify(true);
    try {
      await apiFetch('/api/admin/driver/notify', {
        method: 'POST',
        json: {
          admin_email: usuario?.email || usuario?.identifier || '',
          conductor_email: conductorInfo?.usuario?.email || conductorInfo?.usuario?.identifier || conductorInfo?.flota?.conductor || '',
          mensaje: notifyMsg,
        },
      });
      toast.success('✉️ Aviso enviado al conductor exitosamente');
      setNotifyMsg('');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setIsSendingNotify(false);
    }
  };
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pageSizeDropdownOpen, setPageSizeDropdownOpen] = useState(false);
  const pageSizeDropdownRef = React.useRef(null);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, searchTerm]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pageSizeDropdownRef.current && !pageSizeDropdownRef.current.contains(e.target)) {
        setPageSizeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /**
   * Guarda un solo campo de la unidad, desde el lápiz que hay junto al valor.
   *
   * El padrón es el único que no viaja por aquí: renombrarlo migra la unidad,
   * el usuario y su sesión, así que tiene endpoint propio y hay que recargar
   * la ficha con la clave nueva.
   */
  const guardarCampoUnidad = async (campo, valor) => {
    const unidadActual = conductorInfo?.unidad_id || getFleetUnitId(conductorInfo?.flota || {});
    if (!unidadActual) return;

    if (campo === 'padron') {
      const nuevo = String(valor).trim();
      if (!nuevo || nuevo === unidadActual) return;
      await apiFetch(`/api/flota/${encodeURIComponent(unidadActual)}/renombrar`, {
        method: 'POST',
        json: { nuevo_id: nuevo },
      });
      toast.success('Padrón actualizado.');
      await fetchFlota();
      await handleOpenConductor(nuevo);
      return;
    }

    const valorFinal = campo === 'capacidad' ? Number.parseInt(valor, 10) || 0 : valor;
    await apiFetch(`/api/flota/${encodeURIComponent(unidadActual)}`, {
      method: 'PUT',
      json: { [campo]: valorFinal },
    });
    setConductorInfo(previo => ({ ...previo, flota: { ...previo?.flota, [campo]: valorFinal } }));
    toast.success('Unidad actualizada.');
    fetchFlota();
  };

  const handleOpenConductor = async (unidadId) => {
    if (!unidadId) return;
    setIsConductorModalOpen(true);
    setIsLoadingConductor(true);
    try {
      const res = await fetch(`/api/conductor/info/${unidadId}`);
      if (res.ok) {
        const data = await res.json();
        setConductorInfo(data);
      } else {
        setConductorInfo(null);
      }
    } catch (e) {
      console.error(e);
      setConductorInfo(null);
    } finally {
      setIsLoadingConductor(false);
    }
  };

  const closeConductorModal = () => {
    setIsConductorModalOpen(false);
    setConductorInfo(null);
  };

  const fetchFlota = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/flota');
      if (!response.ok) throw new Error('Error fetching fleet data');
      const data = await response.json();
      setFlota(data.flota);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFlota();
  }, []);

  useEffect(() => {
    if (showModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => { document.body.style.overflow = 'unset'; };
  }, [showModal]);

  const renderBadge = (dateString, documento, etiqueta = 'documento') => {
    const { status, text, daysRemaining } = getDocumentStatus(dateString);
    const title = daysRemaining === null ? 'Sin fecha de vencimiento' : `${dateString} · ${daysRemaining} día${daysRemaining === 1 ? '' : 's'} restante${daysRemaining === 1 ? '' : 's'}`;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div className={`status-badge status-${status}`} title={title}>
          <span className="dot"></span>
          {text}
        </div>
        {/* El adjunto se abre en el visor compartido. Antes era un enlace a la
            cadena guardada, que desde que los documentos viven en Storage ya no
            es una URL sino una ruta: el enlace llevaba a ninguna parte. */}
        {documento && (
          <button
            type="button"
            className="btn-icon-sutil"
            title="Ver el documento adjunto"
            aria-label={`Ver el documento de ${etiqueta}`}
            onClick={() => setViendoDocumento({
              name: etiqueta,
              caras: [{
                nombre: null,
                src: typeof documento === 'string' ? documento : (documento.base64 || documento.url || ''),
                path: typeof documento === 'object' ? documento.path || null : null,
              }],
            })}
          >
            <Paperclip size={14} />
          </button>
        )}
      </div>
    );
  };

  // Aquí había un botón de eliminar la unidad. Se retiró porque dar de baja a
  // alguien ya se hace en Accesos, donde está junto a desactivar y con su
  // confirmación: tener una segunda puerta en la tabla de flota solo repartía
  // la misma decisión en dos sitios, y esta era la que estaba a un clic de
  // distancia en cada fila. El endpoint sigue existiendo.


  const handleCreate = () => setShowModal(true);

  // Delega la generación al backend, que rellena la plantilla oficial
  // (BASE MASIVO 2026 / BASE REMISSE 2026) con datos frescos de Supabase.
  // Así preservamos los colores por GRUPO, cabecera coloreada y anchos de columna.
  const handleExportBase = async (baseKey) => {
    setExportMenuOpen(false);
    const option = EXPORT_OPTIONS.find(o => o.key === baseKey);
    const filename = option?.filename || 'BASE FLOTA 2026.xlsx';
    const toastId = toast.loading(`Generando ${filename}...`);
    try {
      const res = await apiRequest(`/api/flota/export?base=${encodeURIComponent(baseKey)}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`Descargado: ${filename}`, { id: toastId });
    } catch (err) {
      toast.error(`No se pudo exportar: ${err.message || err}`, { id: toastId });
    }
  };

  if (isLoading && flota.length === 0) return <div className="card" style={{ padding: '60px', textAlign: 'center' }}><GlobalLoader text="Cargando datos de flota..." /></div>;
  if (error) return <div className="error-message">Error: {error}</div>;

  const filteredFlota = flota.filter(vehiculo => {
    const matchesSearch = (vehiculo.placa || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (vehiculo.real_placa || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (vehiculo.chofer || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (vehiculo.unidad_id || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBase = baseFilter === 'Todas' || (vehiculo.base && vehiculo.base.toLowerCase().trim().includes(baseFilter.toLowerCase().trim()));
    return matchesSearch && matchesBase;
  });

  // KPIs calculations
  const totalUnits = flota.length;
  const documentStatusCounts = countFleetDocumentStatuses(flota);
  const validDocsCount = documentStatusCounts.valid;
  const expiringDocsCount = documentStatusCounts.expiring;
  const expiredDocsCount = documentStatusCounts.expired;

  return (
    <div className="card flota-view-card" style={{ maxWidth: '100%', overflowX: 'auto', position: 'relative' }}>
      <div className="card-header" style={{ marginBottom: '16px' }}>
        {/* Header content: Left (Title + Desc) / Right (Buttons + Search) */}
        <div className="flota-header-container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
          {/* Left Column */}
          <div className="flota-header-left" style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: '1 1 300px' }}>
            <h2 style={{ margin: 0 }}>Control de Conformidad Legal y Flota</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
              Monitoreo en tiempo real de la documentación y gestión del padrón de flota.
            </p>
          </div>
          
          {/* Right Column */}
          <div className="flota-header-right" style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'stretch', flex: '0 0 auto' }}>
            <div className="flota-header-buttons" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <div ref={exportMenuRef} style={{ position: 'relative' }}>
                <button
                  className="btn-secondary"
                  onClick={() => setExportMenuOpen(o => !o)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '0.85rem' }}
                >
                  <Download size={14} /> Exportar Excel
                  <ChevronDown size={14} style={{ opacity: 0.7, transition: 'transform 0.2s', transform: exportMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                </button>
                {exportMenuOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      right: 0,
                      background: 'var(--bg-secondary, #1e293b)',
                      border: '1px solid var(--border-color, #334155)',
                      borderRadius: '10px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)',
                      minWidth: '240px',
                      overflow: 'hidden',
                      zIndex: 30,
                    }}
                  >
                    <div style={{
                      padding: '10px 14px',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--text-secondary)',
                      borderBottom: '1px solid var(--border-color)',
                    }}>
                      Elegir base a exportar
                    </div>
                    {EXPORT_OPTIONS.map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => handleExportBase(opt.key)}
                        style={{
                          display: 'block',
                          width: '100%',
                          padding: '10px 14px',
                          fontSize: '0.875rem',
                          textAlign: 'left',
                          background: 'transparent',
                          color: 'var(--text-primary)',
                          border: 'none',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg, rgba(255,255,255,0.04))'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="btn-secondary" onClick={fetchFlota} style={{ padding: '8px 14px', fontSize: '0.85rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>Actualizar</button>
              {!isCliente && <button className="btn-primary" onClick={handleCreate} style={{ padding: '8px 14px', fontSize: '0.85rem' }}>+ Nueva Unidad</button>}
            </div>
            
            <div style={{ display: 'flex', gap: '10px', width: '100%', position: 'relative' }}>
              <div ref={baseDropdownRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setBaseDropdownOpen(!baseDropdownOpen)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '8px 14px', borderRadius: '8px',
                    border: `1px solid ${baseDropdownOpen ? 'var(--primary-color)' : 'var(--border-color)'}`,
                    background: 'var(--bg)',
                    cursor: 'pointer', transition: 'all 0.2s',
                    boxShadow: baseDropdownOpen ? '0 0 0 3px rgba(0,229,191,0.1)' : 'none',
                    height: '100%',
                    minWidth: '200px',
                    justifyContent: 'space-between'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>BASE</span>
                    <span style={{ width: '1px', height: '14px', background: 'var(--border-color)', display: 'inline-block' }} />
                    <span style={{ color: baseFilter !== 'Todas' ? 'var(--primary-color)' : 'var(--text-primary)', whiteSpace: 'nowrap', fontSize: '0.875rem' }}>
                      {BASE_OPTIONS.find(b => b.key === baseFilter)?.label || 'Todas las Bases'}
                    </span>
                  </div>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transition: 'transform 0.2s', transform: baseDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', opacity: 0.5 }}>
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>

                {baseDropdownOpen && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100,
                    background: 'var(--bg)', border: '1px solid var(--border-color)',
                    borderRadius: '10px', padding: '6px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                    minWidth: '220px',
                    animation: 'dropdownIn 0.15s ease-out',
                  }}>
                    <style>{`@keyframes dropdownIn { from { opacity:0; transform: translateY(-6px); } to { opacity:1; transform: translateY(0); } }`}</style>
                    {BASE_OPTIONS.map(({ key, label }) => (
                      <button key={key}
                        onClick={() => { setBaseFilter(key); setBaseDropdownOpen(false); }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '9px 12px', borderRadius: '7px', border: 'none',
                          background: baseFilter === key ? 'var(--accent-bg)' : 'transparent',
                          color: baseFilter === key ? 'var(--primary-color)' : 'var(--text-primary)',
                          fontWeight: baseFilter === key ? 700 : 500,
                          fontSize: '0.875rem', cursor: 'pointer', transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { if (baseFilter !== key) e.target.style.background = 'var(--bg-secondary)'; }}
                        onMouseLeave={e => { e.target.style.background = baseFilter === key ? 'var(--accent-bg)' : 'transparent'; }}
                      >
                        {label}
                        {baseFilter === key && <span style={{ float: 'right', opacity: 0.7 }}>✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
                <input
                  type="text"
                  placeholder="Buscar unidad o conductor..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flota-search-input-override"
                  style={{ width: '100%', height: '100%', minHeight: '38px', padding: '7px 12px 7px 32px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.875rem', transition: 'border-color 0.2s', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {!isCliente && (
        <div className="flota-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '20px', marginTop: '10px' }}>
          <div style={{ background: 'var(--bg-secondary)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div style={{ padding: '10px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', borderRadius: '8px' }}><CarFront size={24} /></div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Total Unidades</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{totalUnits}</div>
            </div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '15px' }}>
            <div style={{ padding: '10px', background: 'rgba(10, 185, 129, 0.1)', color: '#10b981', borderRadius: '8px' }}><FileCheck size={24} /></div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Doc. Vigentes</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--kapital-accent-green)' }}>{validDocsCount}</div>
            </div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '15px', borderColor: expiringDocsCount > 0 ? 'rgba(234, 179, 8, 0.3)' : 'var(--border-color)' }}>
            <div style={{ padding: '10px', background: 'rgba(234, 179, 8, 0.1)', color: '#eab308', borderRadius: '8px' }}><AlertTriangle size={24} /></div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Por Vencer (15d)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--kapital-accent-orange)' }}>{expiringDocsCount}</div>
            </div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '15px', borderColor: expiredDocsCount > 0 ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-color)' }}>
            <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px' }}><AlertTriangle size={24} /></div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Vencidos</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--kapital-accent-red)' }}>{expiredDocsCount}</div>
            </div>
          </div>
        </div>
      )}

      {/* Flota table - scrollable on mobile */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table className="flota-table">
        <thead>
          <tr>
            <th>PADRÓN</th>
            <th>{isCliente ? 'NAME' : 'Conductor'}</th>
            {!isCliente && <th>Tipo / Cap.</th>}
            <th>SOAT</th>
            <th>Rev. Técnica</th>
            <th>Licencia MTC</th>
            {!isCliente && <th>Contacto</th>}
          </tr>
        </thead>
        <tbody>
          {(() => {
            const totalPages = Math.ceil(filteredFlota.length / pageSize);
            const paginatedFlota = filteredFlota.slice((currentPage - 1) * pageSize, currentPage * pageSize);
            
            if (filteredFlota.length === 0) {
              return (
                <tr>
                  <td colSpan={isCliente ? 6 : 8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    No se encontraron unidades que coincidan con la búsqueda.
                  </td>
                </tr>
              );
            }

            return paginatedFlota.map((vehiculo, index) => {
            const hasDanger =
              getDocumentStatus(vehiculo.soat).status === 'danger' ||
              getDocumentStatus(vehiculo.revision).status === 'danger' ||
              getDocumentStatus(vehiculo.atu).status === 'danger' ||
              getDocumentStatus(vehiculo.licencia).status === 'danger';

            return (
              <tr key={vehiculo.unidad_id || index} className={hasDanger ? 'row-danger' : ''}>
                <td style={{ fontWeight: 'bold' }}>{vehiculo.unidad_id}</td>
                <td>
                  <span
                    style={{ cursor: 'pointer', textDecoration: 'underline', color: '#38bdf8', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => handleOpenConductor(vehiculo.unidad_id)}
                    title="Ver perfil del conductor"
                  >
                    {vehiculo.chofer}
                    {vehiculo.has_pending_requests && (
                      <span title="Tiene solicitudes de cambio pendientes" style={{ width: '8px', height: '8px', backgroundColor: '#f59e0b', borderRadius: '50%', flexShrink: 0 }}></span>
                    )}
                  </span>
                </td>
                {/* Ni el tipo ni la capacidad se preguntan siempre en el alta.
                    Sin respaldo la celda quedaba como « (15 pax)», con el tipo
                    en blanco, que parecía un fallo de carga en vez de un dato
                    que nadie ha rellenado todavía. */}
                {!isCliente && (
                  <td>
                    {vehiculo.tipo || 'Sin tipo'}
                    {' '}({vehiculo.capacidad ? `${vehiculo.capacidad} pax` : 'sin capacidad'})
                  </td>
                )}
                <td>{renderBadge(vehiculo.soat, vehiculo.soat_doc, 'SOAT')}</td>
                <td>{renderBadge(vehiculo.revision, vehiculo.revision_doc, 'Revisión técnica')}</td>
                <td>{renderBadge(vehiculo.licencia, vehiculo.licencia_doc, 'Licencia MTC')}</td>
                {!isCliente && (
                <td>
                  {/* La acción lleva su nombre escrito, pero no el número.
                      Un icono suelto dejaba la celda vacía y obligaba a pasar
                      el ratón para saber qué hacía; enseñar el teléfono lo
                      arreglaba, pero ponía los 112 a la vista de cualquiera que
                      mire la pantalla o la fotografíe, y para ahorrar un clic:
                      el número sigue estando en la ficha del conductor.

                      El número casi siempre viene del perfil del conductor y no
                      del registro de flota: mirar solo `telefono` escondía este
                      botón en 108 de 109 unidades. */}
                  {whatsappDeUnidad(vehiculo) ? (
                    <a
                      href={`https://wa.me/${whatsappDeUnidad(vehiculo)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="unidad-contacto"
                      title={`Escribir por WhatsApp a ${vehiculo.chofer || 'el conductor'}`}
                    >
                      <MessageCircle size={14} aria-hidden="true" />
                      <span>Escribir</span>
                    </a>
                  ) : (
                    <span className="unidad-sin-contacto">Sin teléfono</span>
                  )}
                </td>
                )}
              </tr>
            );
          });
          })()}
        </tbody>
      </table>
      </div>{/* end scrollable table wrapper */}

      {/* Pagination Controls */}
      {filteredFlota.length > 0 && (() => {
        const totalPages = Math.ceil(filteredFlota.length / pageSize);
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 4px', borderTop: '1px solid var(--border-color)', marginTop: '10px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Mostrando {(currentPage - 1) * pageSize + 1} – {Math.min(currentPage * pageSize, filteredFlota.length)} de {filteredFlota.length} unidades
            </div>
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Filas por pág:</span>
                <div ref={pageSizeDropdownRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setPageSizeDropdownOpen(!pageSizeDropdownOpen)}
                    style={{ padding: '6px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '6px', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', minWidth: '65px', justifyContent: 'space-between', boxShadow: pageSizeDropdownOpen ? '0 0 0 2px var(--accent-border)' : 'none', transition: 'all 0.15s' }}
                  >
                    {pageSize} <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>▼</span>
                  </button>
                  {pageSizeDropdownOpen && (
                    <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, width: '100%', minWidth: '70px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)', overflow: 'hidden', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
                      {[10, 50, 100].map(size => (
                        <button key={size}
                          onClick={() => { setPageSize(size); setPageSizeDropdownOpen(false); }}
                          style={{ padding: '8px 12px', background: pageSize === size ? 'var(--accent-bg)' : 'transparent', color: pageSize === size ? 'var(--primary-color)' : 'var(--text-secondary)', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.02)', textAlign: 'left', fontSize: '0.85rem', cursor: 'pointer', fontWeight: pageSize === size ? 600 : 500, transition: 'background 0.15s' }}
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
                  style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--border-color)', background: currentPage === 1 ? 'transparent' : 'var(--bg-secondary)', color: currentPage === 1 ? 'var(--text-muted)' : 'var(--text-primary)', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.5 : 1, transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}
                  onMouseEnter={e => { if (currentPage !== 1) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={e => { if (currentPage !== 1) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                >
                  <span style={{ fontSize: '14px', lineHeight: 1 }}>«</span> Anterior
                </button>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages || totalPages === 0}
                  style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--border-color)', background: (currentPage === totalPages || totalPages === 0) ? 'transparent' : 'var(--bg-secondary)', color: (currentPage === totalPages || totalPages === 0) ? 'var(--text-muted)' : 'var(--text-primary)', cursor: (currentPage === totalPages || totalPages === 0) ? 'not-allowed' : 'pointer', opacity: (currentPage === totalPages || totalPages === 0) ? 0.5 : 1, transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}
                  onMouseEnter={e => { if (currentPage !== totalPages && totalPages !== 0) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={e => { if (currentPage !== totalPages && totalPages !== 0) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                >
                  Siguiente <span style={{ fontSize: '14px', lineHeight: 1 }}>»</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Driver Profile Modal */}
      {isConductorModalOpen && (
        <div className="modal-overlay" onClick={closeConductorModal}>
          <div className="conductor-profile" onClick={e => e.stopPropagation()}>
            <button className="close-btn" onClick={closeConductorModal} title="Cerrar"><X size={24} /></button>
            {isLoadingConductor ? (
                <div style={{ padding: '50px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px', opacity: 0.5 }}>
                    <Loader size={32} style={{ animation: 'spin 1s linear infinite' }} />
                  </div>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <p>Cargando perfil del conductor...</p>
              </div>
            ) : conductorInfo ? (
              <div className="profile-layout">
                {/* LEFT: Avatar + Vehicle Photo */}
                <div className="profile-left">
                  <div className="driver-photo">
                    {conductorInfo.usuario.avatar ? (
                      <ImagenGuardada imagen={conductorInfo.usuario.avatar} alt="Conductor" />
                    ) : (
                      <div className="avatar-placeholder" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={40} strokeWidth={1.5} /></div>
                    )}
                  </div>
                  {/* El padrón se edita en su propio rótulo: repetirlo en una
                      fila «Padrón: K-027» debajo era leer dos veces lo mismo. */}
                  <h2 className="driver-id">
                    <CampoEditable
                      valor={conductorInfo.unidad_id}
                      editable={puedeRenombrar}
                      onGuardar={(valor) => guardarCampoUnidad('padron', valor)}
                    />
                  </h2>
                  {/* El nombre se edita aquí, que es donde ya se lee. Tenerlo
                      además como fila «Nombre en la flota» dentro de la tarjeta
                      era el mismo dato dos veces. */}
                  <h3 className="driver-name">
                    <CampoEditable
                      valor={conductorInfo.flota?.chofer || conductorInfo.usuario.nombre || ''}
                      vacio="Sin nombre"
                      onGuardar={(valor) => guardarCampoUnidad('chofer', valor)}
                    />
                  </h3>
                  <CorreoEditable
                    identificador={conductorInfo.usuario.identifier || conductorInfo.usuario.email}
                    correo={conductorInfo.usuario.email}
                    onGuardado={(email) => setConductorInfo(previo => ({
                      ...previo,
                      usuario: { ...previo.usuario, email },
                    }))}
                  />

                  {/* La foto vive en Storage desde la migración, así que el
                      perfil solo guarda su ruta: pasársela a `img` dejaba la
                      imagen rota aunque el archivo siguiera en el bucket. */}
                  <div className="vehicle-photo" style={{marginTop:'0'}}>
                    <ImagenGuardada
                      imagen={conductorInfo.usuario.perfil_conductor?.fotoVehiculo}
                      alt="Vehículo"
                      style={{width:'100%',height:'100%',objectFit:'cover'}}
                    />
                    {!conductorInfo.usuario.perfil_conductor?.fotoVehiculo && (
                      <div className="vehicle-placeholder"><CarFront size={36} strokeWidth={1} /><p style={{fontSize:'0.75rem',marginTop:'6px'}}>Sin foto de vehículo</p></div>
                    )}
                  </div>
                </div>

                {/* RIGHT: Info + Docs review */}
                <div className="profile-right">
                  <div className="info-grid">
                    <div className="info-section">
                      <h4>Información del conductor</h4>
                      <p><strong>DNI/Documento:</strong> {conductorInfo.usuario.perfil_conductor?.tipoDoc || 'DNI'} {conductorInfo.usuario.perfil_conductor?.numDoc || 'No registrado'}</p>
                      <p><strong>Nacimiento:</strong> {conductorInfo.usuario.perfil_conductor?.fechaNacimiento || '—'}</p>
                      <p><strong>Dirección:</strong> {conductorInfo.usuario.perfil_conductor?.direccion || '—'}</p>
                      {/* Un solo teléfono: el que usa el botón de WhatsApp. El
                          de la unidad manda, y si no lo tiene se muestra el que
                          declaró el conductor, que es de donde sale el enlace.
                          Antes aparecían los dos, repetidos y sin saber cuál
                          mandaba. */}
                      <CampoEditable
                        etiqueta="Teléfono"
                        valor={telefonoDeUnidad({ ...conductorInfo.flota, celular: conductorInfo.usuario.perfil_conductor?.telefonoDirecto })}
                        vacio="Sin teléfono"
                        onGuardar={(valor) => guardarCampoUnidad('telefono', valor)}
                      />
                      {conductorInfo.usuario.perfil_conductor?.telefonoEmergencia && (
                        <p><strong>Emergencia:</strong> {conductorInfo.usuario.perfil_conductor.telefonoEmergencia}</p>
                      )}
                    </div>
                    <div className="info-section">
                      <h4>Información del vehículo</h4>
                      <p><strong>Marca/Modelo:</strong> {conductorInfo.usuario.perfil_conductor?.vehiculoMarca || '—'} {conductorInfo.usuario.perfil_conductor?.vehiculoModelo || ''}</p>
                      <p><strong>Año / Color:</strong> {conductorInfo.usuario.perfil_conductor?.vehiculoAnio || '—'} / {conductorInfo.usuario.perfil_conductor?.vehiculoColor || '—'}</p>
                      <p><strong>Placa:</strong> {conductorInfo.usuario.perfil_conductor?.placa || conductorInfo.flota?.placa || conductorInfo.unidad_id}</p>
                      {/* Tipo y capacidad son los de la unidad, no los que
                          declaró el conductor: son los que usa el ruteo. */}
                      <CampoEditable
                        etiqueta="Tipo"
                        valor={conductorInfo.flota?.tipo}
                        opciones={TIPOS_DE_UNIDAD}
                        vacio="Sin tipo"
                        onGuardar={(valor) => guardarCampoUnidad('tipo', valor)}
                      />
                      <CampoEditable
                        etiqueta="Capacidad"
                        valor={conductorInfo.flota?.capacidad}
                        tipo="number"
                        vacio="Sin capacidad"
                        onGuardar={(valor) => guardarCampoUnidad('capacidad', valor)}
                      >
                        {conductorInfo.flota?.capacidad ? `${conductorInfo.flota.capacidad} pasajeros` : ''}
                      </CampoEditable>
                    </div>

                    {(conductorInfo.usuario.perfil_conductor?.vehiculo2_habilitado === 'true' || conductorInfo.usuario.perfil_conductor?.vehiculo2_habilitado === true) && (
                      <div className="info-section">
                        <h4 style={{ color: 'var(--text-primary)' }}>Información del vehículo 2</h4>
                        <p><strong>Marca/Modelo:</strong> {conductorInfo.usuario.perfil_conductor?.vehiculoMarca2 || '—'} {conductorInfo.usuario.perfil_conductor?.vehiculoModelo2 || ''}</p>
                        <p><strong>Año / Color:</strong> {conductorInfo.usuario.perfil_conductor?.vehiculoAnio2 || '—'} / {conductorInfo.usuario.perfil_conductor?.vehiculoColor2 || '—'}</p>
                        <p><strong>Placa:</strong> {conductorInfo.usuario.perfil_conductor?.placa2 || '—'}</p>
                        <p><strong>Capacidad:</strong> {conductorInfo.usuario.perfil_conductor?.capacidadVehiculo2 || '—'} pasajeros</p>
                      </div>
                    )}
                  </div>


                  {/* DATA UPDATE REQUESTS PANEL */}
                  {conductorInfo?.usuario?.perfil_conductor?.solicitudes_cambio && Object.entries(conductorInfo.usuario.perfil_conductor.solicitudes_cambio || {}).filter(([_, req]) => req?.status === 'pendiente').length > 0 && (
                    <div className="docs-section" style={{ borderColor: '#f59e0b', background: 'rgba(245,158,11,0.02)', marginTop: '20px' }}>
                      <h4 style={{display:'flex', alignItems:'center', gap:'8px', color: '#f59e0b'}}>
                        <AlertTriangle size={18} />
                        Solicitudes de Cambio de Datos
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {Object.entries(conductorInfo.usuario.perfil_conductor.solicitudes_cambio)
                          .filter(([_, req]) => req?.status === 'pendiente')
                          .map(([field, req]) => {
                            const isResolving = resolveLoading?.[field];
                            let currentVal = conductorInfo.usuario.perfil_conductor[field];
                            if (currentVal === undefined || currentVal === null) currentVal = '—';
                            else if (typeof currentVal === 'object') currentVal = JSON.stringify(currentVal);

                            // Special render for vehiculo2_habilitado
                            if (field === 'vehiculo2_habilitado') {
                              return (
                                <div key={field} style={{ background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', marginBottom: '8px' }}>Solicitud: Habilitar Vehículo 2</div>
                                      <div style={{ fontSize: '0.85rem', color: 'var(--kapital-text-primary)' }}>
                                        El conductor desea registrar un segundo vehículo. Al aprobar, se le habilitarán los campos en su perfil.
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', marginLeft: '12px', flexShrink: 0 }}>
                                      <button className="btn-icon" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: 'none', padding: '6px', borderRadius: '6px', cursor: 'pointer' }} onClick={() => handleResolveDataRequest(field, 'approve')} disabled={isResolving} title="Aprobar"><Check size={16} /></button>
                                      <button className="btn-icon" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'none', padding: '6px', borderRadius: '6px', cursor: 'pointer' }} onClick={() => handleResolveDataRequest(field, 'reject')} disabled={isResolving} title="Rechazar"><X size={16} /></button>
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            let newVal = req?.new_value;
                            if (typeof newVal === 'object') newVal = JSON.stringify(newVal);

                            return (
                              <div key={field} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                <div>
                                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{String(field).replace(/([A-Z])/g, ' $1').trim()}</div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
                                    <span style={{ textDecoration: 'line-through', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{currentVal}</span>
                                    <span>➔</span>
                                    <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>{newVal}</span>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button 
                                    className="btn-icon"
                                    style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: 'none', padding: '6px', borderRadius: '6px', cursor: 'pointer' }}
                                    onClick={() => handleResolveDataRequest(field, 'approve')}
                                    disabled={isResolving}
                                    title="Aprobar"
                                  >
                                    <Check size={16} />
                                  </button>
                                  <button 
                                    className="btn-icon"
                                    style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'none', padding: '6px', borderRadius: '6px', cursor: 'pointer' }}
                                    onClick={() => handleResolveDataRequest(field, 'reject')}
                                    disabled={isResolving}
                                    title="Rechazar"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        }
                      </div>
                    </div>
                  )}

                  {/* La misma revisión que muestra Accesos: un solo
                      componente para las dos pantallas. */}
                  <div className="docs-section">
                    <RevisionDocumentosConductor
                      vigencias={conductorInfo.flota}
                      onGuardarVigencia={guardarCampoUnidad}
                      conductor={conductorInfo.usuario}
                      unidadId={conductorInfo?.unidad_id || conductorInfo?.flota?.unidad_id || ''}
                      adminEmail={usuario?.email || usuario?.identifier || ''}
                      onDocumentoSubido={(campo, documento) => setConductorInfo(previo => ({
                        ...previo,
                        usuario: {
                          ...previo.usuario,
                          perfil_conductor: { ...previo.usuario?.perfil_conductor, [campo]: documento },
                        },
                      }))}
                    />
                  </div>

                  {/* API VERIFICATION */}
                  {/* <DocumentVerification
                    placa={conductorInfo.usuario.perfil_conductor?.vehiculoPlaca || conductorInfo.flota?.placa || conductorInfo.unidad_id}
                    doc={conductorInfo.usuario.perfil_conductor?.numDoc || conductorInfo.usuario.nombre}
                    cachedResults={{
                      soat: conductorInfo.usuario.perfil_conductor?.validacion_soat,
                      citv: conductorInfo.usuario.perfil_conductor?.validacion_citv,
                      licencia: conductorInfo.usuario.perfil_conductor?.validacion_licencia
                    }}
                  /> */}

                  {/* NOTIFY DRIVER */}
                  <div className="notify-section">
                    <h4 style={{display:'flex', alignItems:'center', gap:'8px', margin:'0 0 12px 0'}}>
                      <ShieldAlert size={18} color="#f59e0b" />
                      Enviar Aviso al Conductor
                    </h4>
                    <p style={{fontSize:'0.82rem', color:'var(--text-secondary)', margin:'0 0 10px 0'}}>
                      El conductor recibirá esta notificación en su portal.
                    </p>
                    <textarea
                      value={notifyMsg}
                      onChange={e => setNotifyMsg(e.target.value)}
                      placeholder={`Ej: Estimado ${conductorInfo.usuario.nombre}, por favor vuelva a enviar su licencia de conducir ya que la imagen no es legible.`}
                      className="notify-textarea"
                      rows={3}
                    />
                    <button
                      className="btn-primary"
                      style={{marginTop:'10px', display:'flex', alignItems:'center', gap:'8px', padding:'10px 20px'}}
                      onClick={handleNotifyDriver}
                      disabled={isSendingNotify || !notifyMsg.trim()}
                    >
                      <Send size={15} />
                      {isSendingNotify ? 'Enviando...' : 'Enviar Aviso'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '50px', textAlign: 'center' }}>
                <p className="error-message">No se pudo cargar la información del conductor.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* El alta vive en su propio componente: era un formulario estrecho con
          scroll interno y un único campo «Placa/ID» que mezclaba el padrón con
          la matrícula. */}
      <DocumentViewer
        key={viendoDocumento?.name}
        documento={viendoDocumento}
        onClose={() => setViendoDocumento(null)}
      />

      {showModal && (
        <RegistroDeUnidad
          onCerrar={() => setShowModal(false)}
          onRegistrada={() => fetchFlota()}
        />
      )}


    </div>
  );
};

export default FlotaView;
