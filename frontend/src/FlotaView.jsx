import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { MessageCircle, Pencil, Trash2, Loader, Download, User, Search, AlertTriangle, FileCheck, CarFront, Eye, Clock, X, CheckCircle, XCircle, Send, ShieldCheck, ShieldAlert, FileText } from 'lucide-react';
import { GlobalLoader } from './App';
import DocumentVerification from './components/DocumentVerification';

import './App.css';


const FlotaView = ({ usuario }) => {
  const isCliente = usuario?.rol === 'Cliente';
  const [flota, setFlota] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    placa: '', capacidad: 10, tipo: 'Van', chofer: '', telefono: '', soat: '', revision: '', atu: '', licencia: '',
    soat_doc: '', revision_doc: '', atu_doc: '', licencia_doc: ''
  });
  const [isEditing, setIsEditing] = useState(false);

  // Conductor Modal state
  const [isConductorModalOpen, setIsConductorModalOpen] = useState(false);
  const [conductorInfo, setConductorInfo] = useState(null);
  const [isLoadingConductor, setIsLoadingConductor] = useState(false);

  const [reviewLoading, setReviewLoading] = useState({});
  const [notifyMsg, setNotifyMsg] = useState('');
  const [isSendingNotify, setIsSendingNotify] = useState(false);
  const [localRevisionDocs, setLocalRevisionDocs] = useState({});
  
  // Doc Viewer State
  const [viewingDoc, setViewingDoc] = useState(null);

  // Sync localRevisionDocs when conductorInfo loads
  useEffect(() => {
    if (conductorInfo) {
      setLocalRevisionDocs(conductorInfo.usuario?.perfil_conductor?.revision_docs || {});
    }
  }, [conductorInfo]);

  const handleDocReview = async (campo, estado) => {
    if (!conductorInfo || !usuario) return;
    setReviewLoading(prev => ({ ...prev, [campo]: true }));
    try {
      const res = await fetch('/api/admin/driver/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_email: usuario.email || usuario.identifier,
          conductor_email: conductorInfo.usuario.email,
          campo,
          estado,
        })
      });
      if (!res.ok) throw new Error('Error al revisar documento');
      const data = await res.json();
      setLocalRevisionDocs(data.revision_docs || {});
      toast.success(`Documento marcado como ${estado === 'aprobado' ? '✅ Aprobado' : '❌ Rechazado'}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setReviewLoading(prev => ({ ...prev, [campo]: false }));
    }
  };

  const handleNotifyDriver = async () => {
    if (!notifyMsg.trim() || !conductorInfo || !usuario) return;
    setIsSendingNotify(true);
    try {
      const res = await fetch('/api/admin/driver/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_email: usuario.email || usuario.identifier,
          conductor_email: conductorInfo.usuario.email,
          mensaje: notifyMsg,
        })
      });
      if (!res.ok) throw new Error('Error al enviar aviso');
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

  const getStatus = (dateString) => {
    if (!dateString) return { status: 'unknown', text: 'N/A' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(dateString + 'T00:00:00');
    const diffTime = targetDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { status: 'danger', text: 'Vencido' };
    } else if (diffDays <= 15) {
      return { status: 'warning', text: `Vence en ${diffDays} d` };
    } else {
      return { status: 'success', text: 'Vigente' };
    }
  };

  const renderBadge = (dateString, docUrl) => {
    const { status, text } = getStatus(dateString);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div className={`status-badge status-${status}`} title={dateString}>
          <span className="dot"></span>
          {text}
        </div>
        {docUrl && (
          <a href={docUrl} target="_blank" rel="noreferrer" title="Ver Documento Adjunto" style={{ textDecoration: 'none', fontSize: '1.2rem', cursor: 'pointer' }}>
            📎
          </a>
        )}
      </div>
    );
  };

  const handleDelete = async (placa) => {
    if (!window.confirm(`¿Estás seguro de eliminar la unidad ${placa}?`)) return;
    try {
      const res = await fetch(`/api/flota/${placa}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar');
      fetchFlota();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleEdit = (vehiculo) => {
    setFormData(vehiculo);
    setIsEditing(true);
    setShowModal(true);
  };

  const handleCreate = () => {
    setFormData({ placa: '', capacidad: 10, tipo: 'Van', chofer: '', telefono: '', soat: '', revision: '', atu: '', licencia: '', soat_doc: '', revision_doc: '', atu_doc: '', licencia_doc: '' });
    setIsEditing(false);
    setShowModal(true);
  };

  const handleFileUpload = (e, field) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setFormData(prev => ({ ...prev, [field]: event.target.result }));
    };
    reader.readAsDataURL(file);
  };

  const handleExport = () => {
    const headers = ['UNIDAD (PLACA)', 'CONDUCTOR', 'TIPO / CAP.', 'SOAT', 'REV. TECNICA', 'T.U.C (ATU)', 'LICENCIA MTC'];
    const rows = flota.map(v => [
      v.placa, v.chofer, `${v.tipo} (${v.capacidad} pax)`,
      v.soat, v.revision, v.atu, v.licencia
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + 
      [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "Matriz_Legal_Flota.csv");
    document.body.appendChild(link);
    link.click();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const method = isEditing ? 'PUT' : 'POST';
      const url = isEditing ? `/api/flota/${formData.placa}` : '/api/flota';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Error al guardar');
      }
      setShowModal(false);
      fetchFlota();
    } catch (err) {
      alert(err.message);
    }
  };

  if (isLoading && flota.length === 0) return <div className="card" style={{ padding: '60px', textAlign: 'center' }}><GlobalLoader text="Cargando datos de flota..." /></div>;
  if (error) return <div className="error-message">Error: {error}</div>;

  const filteredFlota = flota.filter(vehiculo => 
    (vehiculo.placa || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (vehiculo.chofer || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  // KPIs calculations
  const totalUnits = flota.length;
  let expiringDocsCount = 0;
  let expiredDocsCount = 0;

  flota.forEach(vehiculo => {
    const docs = [vehiculo.soat, vehiculo.revision, vehiculo.atu, vehiculo.licencia];
    docs.forEach(docDate => {
      const { status } = getStatus(docDate);
      if (status === 'danger') expiredDocsCount++;
      if (status === 'warning') expiringDocsCount++;
    });
  });

  return (
    <div className="card flota-view-card" style={{ maxWidth: '100%', overflowX: 'auto', position: 'relative' }}>
      <div className="card-header" style={{ marginBottom: '16px' }}>
        {/* Header content: Left (Title + Desc) / Right (Buttons + Search) */}
        <div className="flota-header-container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
          {/* Left Column */}
          <div className="flota-header-left" style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: '1 1 300px' }}>
            <h2 style={{ margin: 0 }}>Control de Conformidad Legal y Flota</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
              Monitoreo en tiempo real de requerimientos ATU y MTC y gestión del padrón de flota.
            </p>
          </div>
          
          {/* Right Column */}
          <div className="flota-header-right" style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'stretch', flex: '0 0 auto' }}>
            <div className="flota-header-buttons" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '0.85rem' }}><Download size={14} /> Exportar Excel</button>
              <button className="btn-secondary" onClick={fetchFlota} style={{ padding: '8px 14px', fontSize: '0.85rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>Actualizar</button>
              {!isCliente && <button className="btn-primary" onClick={handleCreate} style={{ padding: '8px 14px', fontSize: '0.85rem' }}>+ Nueva Unidad</button>}
            </div>
            
            <div style={{ position: 'relative', width: '100%' }}>
              <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Buscar unidad o conductor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flota-search-input-override"
                style={{ width: '100%', padding: '7px 12px 7px 32px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.875rem', transition: 'border-color 0.2s', boxSizing: 'border-box' }}
              />
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
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>{totalUnits * 4 - expiringDocsCount - expiredDocsCount}</div>
            </div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '15px', borderColor: expiringDocsCount > 0 ? 'rgba(234, 179, 8, 0.3)' : 'var(--border-color)' }}>
            <div style={{ padding: '10px', background: 'rgba(234, 179, 8, 0.1)', color: '#eab308', borderRadius: '8px' }}><AlertTriangle size={24} /></div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Por Vencer (15d)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#eab308' }}>{expiringDocsCount}</div>
            </div>
          </div>
          <div style={{ background: 'var(--bg-secondary)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '15px', borderColor: expiredDocsCount > 0 ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-color)' }}>
            <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px' }}><AlertTriangle size={24} /></div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Vencidos</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ef4444' }}>{expiredDocsCount}</div>
            </div>
          </div>
        </div>
      )}

      {/* Flota table - scrollable on mobile */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table className="flota-table">
        <thead>
          <tr>
            <th>{isCliente ? 'PADRON' : 'Unidad (Placa)'}</th>
            <th>{isCliente ? 'NAME' : 'Conductor'}</th>
            {!isCliente && <th>Tipo / Cap.</th>}
            <th>SOAT</th>
            <th>Rev. Técnica</th>
            <th>T.U.C (ATU)</th>
            <th>Licencia MTC</th>
            {!isCliente && <th>Acciones</th>}
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
              getStatus(vehiculo.soat).status === 'danger' || 
              getStatus(vehiculo.revision).status === 'danger' ||
              getStatus(vehiculo.atu).status === 'danger' ||
              getStatus(vehiculo.licencia).status === 'danger';

            return (
              <tr key={vehiculo.placa || index} className={hasDanger ? 'row-danger' : ''}>
                <td style={{ fontWeight: 'bold' }}>{vehiculo.placa}</td>
                <td>
                  <span
                    style={{ cursor: 'pointer', textDecoration: 'underline', color: '#38bdf8' }}
                    onClick={() => handleOpenConductor(vehiculo.placa)}
                    title="Ver perfil del conductor"
                  >
                    {vehiculo.chofer}
                  </span>
                </td>
                {!isCliente && <td>{vehiculo.tipo} ({vehiculo.capacidad} pax)</td>}
                <td>{renderBadge(vehiculo.soat, vehiculo.soat_doc)}</td>
                <td>{renderBadge(vehiculo.revision, vehiculo.revision_doc)}</td>
                <td>{renderBadge(vehiculo.atu, vehiculo.atu_doc)}</td>
                <td>{renderBadge(vehiculo.licencia, vehiculo.licencia_doc)}</td>
                {!isCliente && (
                <td>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    {vehiculo.telefono && (
                      <a href={`https://wa.me/${vehiculo.telefono.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="btn-icon" title="Contactar por WhatsApp" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><MessageCircle size={15} /></a>
                    )}
                    <button className="btn-icon" onClick={() => handleEdit(vehiculo)} title="Editar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Pencil size={15} /></button>
                    <button className="btn-icon" onClick={() => handleDelete(vehiculo.placa)} title="Eliminar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={15} /></button>
                  </div>
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
                      <img src={conductorInfo.usuario.avatar} alt="Conductor" />
                    ) : (
                      <div className="avatar-placeholder" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={40} strokeWidth={1.5} /></div>
                    )}
                  </div>
                  <h2 className="driver-id">{conductorInfo.unidad_id}</h2>
                  <h3 className="driver-name">{conductorInfo.usuario.nombre?.toUpperCase()}</h3>
                  <p style={{fontSize:'0.78rem', color:'var(--text-secondary)', margin:'4px 0 12px'}}>{conductorInfo.usuario.email}</p>

                  {/* Vehicle photo from profile */}
                  {conductorInfo.usuario.perfil_conductor?.fotoVehiculo ? (
                    <div className="vehicle-photo" style={{marginTop:'0'}}>
                      <img src={conductorInfo.usuario.perfil_conductor.fotoVehiculo} alt="Vehículo" style={{width:'100%',height:'100%',objectFit:'cover'}} />
                    </div>
                  ) : (
                    <div className="vehicle-photo" style={{marginTop:'0'}}>
                      <div className="vehicle-placeholder"><CarFront size={36} strokeWidth={1} /><p style={{fontSize:'0.75rem',marginTop:'6px'}}>Sin foto de vehículo</p></div>
                    </div>
                  )}
                </div>

                {/* RIGHT: Info + Docs review */}
                <div className="profile-right">
                  <div className="info-grid">
                    <div className="info-section">
                      <h4>Información del conductor</h4>
                      <p><strong>DNI/Documento:</strong> {conductorInfo.usuario.perfil_conductor?.tipoDoc || 'DNI'} {conductorInfo.usuario.perfil_conductor?.numDoc || 'No registrado'}</p>
                      <p><strong>Nacimiento:</strong> {conductorInfo.usuario.perfil_conductor?.fechaNacimiento || '—'}</p>
                      <p><strong>Dirección:</strong> {conductorInfo.usuario.perfil_conductor?.direccion || '—'}</p>
                      <p><strong>Teléfonos:</strong> {conductorInfo.usuario.perfil_conductor?.telefonoDirecto || '—'} {conductorInfo.usuario.perfil_conductor?.telefonoEmergencia ? `/ ${conductorInfo.usuario.perfil_conductor.telefonoEmergencia}` : ''}</p>
                    </div>
                    <div className="info-section">
                      <h4>Información del vehículo</h4>
                      <p><strong>Marca/Modelo:</strong> {conductorInfo.usuario.perfil_conductor?.vehiculoMarca || '—'} {conductorInfo.usuario.perfil_conductor?.vehiculoModelo || ''}</p>
                      <p><strong>Año / Color:</strong> {conductorInfo.usuario.perfil_conductor?.vehiculoAnio || '—'} / {conductorInfo.usuario.perfil_conductor?.vehiculoColor || '—'}</p>
                      <p><strong>Placa:</strong> {conductorInfo.flota?.placa || conductorInfo.unidad_id}</p>
                      <p><strong>Capacidad:</strong> {conductorInfo.flota?.capacidad || 15} pasajeros</p>
                    </div>
                  </div>

                  {/* DOCUMENT REVIEW PANEL */}
                  <div className="docs-section">
                    <h4 style={{display:'flex', alignItems:'center', gap:'8px'}}>
                      <ShieldCheck size={18} color="#38bdf8" />
                      Revisión de Documentos del Conductor
                    </h4>
                    <div className="review-docs-grid">
                      {[
                        { key: 'comprobanteDomicilio', label: 'Comprobante de Domicilio' },
                        { key: 'dniScaneado', label: 'DNI Escaneado' },
                        { key: 'licenciaConducir', label: 'Licencia de Conducir' },
                        { key: 'recordConductor', label: 'Récord de Conductor' },
                        { key: 'antecedentesPoliciales', label: 'Antecedentes Policiales' },
                        { key: 'cv', label: 'Currículum Vitae' },
                        { key: 'tarjetaPropiedad', label: 'Tarjeta de Propiedad' },
                        { key: 'soat', label: 'SOAT' },
                        { key: 'revisionTecnica', label: 'Revisión Técnica' },
                      ].map((doc) => {
                        const fileData = conductorInfo.usuario.perfil_conductor?.[doc.key];
                        const rev = localRevisionDocs[doc.key];
                        const isLoading = reviewLoading[doc.key];
                        return (
                          <div key={doc.key} className="review-doc-card">
                            <div className="review-doc-header">
                              <FileText size={15} style={{flexShrink:0, color:'var(--text-secondary)'}} />
                              <span className="review-doc-name">{doc.label}</span>
                              {rev ? (
                                rev.estado === 'aprobado'
                                  ? <span className="rev-badge rev-ok"><CheckCircle size={12} /> Aprobado</span>
                                  : <span className="rev-badge rev-no"><XCircle size={12} /> Rechazado</span>
                              ) : (
                                fileData
                                  ? <span className="rev-badge rev-pending"><Clock size={12} /> Pendiente</span>
                                  : <span className="rev-badge rev-missing">Sin archivo</span>
                              )}
                            </div>
                            {fileData && (
                              <div className="review-doc-actions">
                                <button className="btn-view-doc" onClick={() => {
                                  let docSrc = '';
                                  if (typeof fileData === 'string') {
                                    docSrc = fileData;
                                  } else if (fileData && typeof fileData === 'object') {
                                    docSrc = fileData.base64 || fileData.url || fileData.file || '';
                                  }
                                  setViewingDoc({ name: doc.label, src: docSrc, raw: fileData });
                                }}>
                                  <Eye size={13} /> Ver
                                </button>
                                <button
                                  className="btn-approve-doc"
                                  disabled={isLoading || rev?.estado === 'aprobado'}
                                  onClick={() => handleDocReview(doc.key, 'aprobado')}
                                >
                                  {isLoading ? '...' : <><CheckCircle size={13} /> Aprobar</>}
                                </button>
                                <button
                                  className="btn-reject-doc"
                                  disabled={isLoading || rev?.estado === 'rechazado'}
                                  onClick={() => handleDocReview(doc.key, 'rechazado')}
                                >
                                  {isLoading ? '...' : <><XCircle size={13} /> Rechazar</>}
                                </button>
                              </div>
                            )}
                            {!fileData && (
                              <p className="review-doc-missing">El conductor aún no ha subido este documento.</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* API VERIFICATION */}
                  <DocumentVerification
                    placa={conductorInfo.usuario.perfil_conductor?.vehiculoPlaca || conductorInfo.flota?.placa || conductorInfo.unidad_id}
                    doc={conductorInfo.usuario.perfil_conductor?.numDoc || conductorInfo.usuario.nombre}
                    cachedResults={{
                      soat: conductorInfo.usuario.perfil_conductor?.validacion_soat,
                      citv: conductorInfo.usuario.perfil_conductor?.validacion_citv,
                      licencia: conductorInfo.usuario.perfil_conductor?.validacion_licencia
                    }}
                  />

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

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>{isEditing ? 'Editar Unidad' : 'Registrar Nueva Unidad'}</h3>
            <form onSubmit={handleSubmit} className="flota-form">
              <div className="form-scroll-area">
              <div className="form-row">
                <label>Placa/ID</label>
                <input required disabled={isEditing} value={formData.placa} onChange={e => setFormData({...formData, placa: e.target.value})} placeholder="Ej. KAP-008" />
              </div>
              <div className="form-row">
                <label>Nombre Chofer</label>
                <input required value={formData.chofer} onChange={e => setFormData({...formData, chofer: e.target.value})} placeholder="Nombre completo" />
              </div>
              <div className="form-row">
                <label>Teléfono WhatsApp (Opcional)</label>
                <input value={formData.telefono || ''} onChange={e => setFormData({...formData, telefono: e.target.value})} placeholder="Ej. 51987654321" />
              </div>
              <div className="form-row">
                <label>Tipo</label>
                <select value={formData.tipo} onChange={e => setFormData({...formData, tipo: e.target.value})}>
                  <option>Sprinter</option>
                  <option>Van</option>
                  <option>Auto (Remisse)</option>
                  <option>Moto (Courier)</option>
                </select>
              </div>
              <div className="form-row">
                <label>Capacidad (Pax)</label>
                <input type="number" required value={formData.capacidad} onChange={e => setFormData({...formData, capacidad: parseInt(e.target.value)})} min="1" />
              </div>
              <div className="form-row">
                <label>Vencimiento SOAT</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input type="date" required value={formData.soat} onChange={e => setFormData({...formData, soat: e.target.value})} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label className="custom-file-upload">
                      <input type="file" accept="image/*,.pdf" onChange={e => handleFileUpload(e, 'soat_doc')} style={{ display: 'none' }} />
                      📎 {formData.soat_doc ? 'Reemplazar' : 'Adjuntar Documento'}
                    </label>
                    {formData.soat_doc && <a href={formData.soat_doc} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--kapital-blue-deep)', fontWeight: 'bold' }}>Ver SOAT</a>}
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label>Vencimiento Revisión</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input type="date" required value={formData.revision} onChange={e => setFormData({...formData, revision: e.target.value})} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label className="custom-file-upload">
                      <input type="file" accept="image/*,.pdf" onChange={e => handleFileUpload(e, 'revision_doc')} style={{ display: 'none' }} />
                      📎 {formData.revision_doc ? 'Reemplazar' : 'Adjuntar Documento'}
                    </label>
                    {formData.revision_doc && <a href={formData.revision_doc} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--kapital-blue-deep)', fontWeight: 'bold' }}>Ver Revisión</a>}
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label>Vencimiento ATU</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input type="date" required value={formData.atu} onChange={e => setFormData({...formData, atu: e.target.value})} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label className="custom-file-upload">
                      <input type="file" accept="image/*,.pdf" onChange={e => handleFileUpload(e, 'atu_doc')} style={{ display: 'none' }} />
                      📎 {formData.atu_doc ? 'Reemplazar' : 'Adjuntar Documento'}
                    </label>
                    {formData.atu_doc && <a href={formData.atu_doc} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--kapital-blue-deep)', fontWeight: 'bold' }}>Ver ATU</a>}
                  </div>
                </div>
              </div>
              <div className="form-row">
                <label>Vencimiento Licencia</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input type="date" required value={formData.licencia} onChange={e => setFormData({...formData, licencia: e.target.value})} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label className="custom-file-upload">
                      <input type="file" accept="image/*,.pdf" onChange={e => handleFileUpload(e, 'licencia_doc')} style={{ display: 'none' }} />
                      📎 {formData.licencia_doc ? 'Reemplazar' : 'Adjuntar Documento'}
                    </label>
                    {formData.licencia_doc && <a href={formData.licencia_doc} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--kapital-blue-deep)', fontWeight: 'bold' }}>Ver Licencia</a>}
                  </div>
                </div>
              </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary">Guardar</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <style>{`
        /* Modal Profile CSS */
        .conductor-profile {
          background: var(--bg-secondary, #ffffff); border-radius: 16px; padding: 24px;
          width: 95%; max-width: 1100px; max-height: 90vh; overflow-y: auto;
          position: relative; color: var(--text-primary);
          box-shadow: 0 10px 40px rgba(0,0,0,0.3);
          border: 1px solid var(--border-color);
        }
        .close-btn {
          position: absolute; top: 16px; right: 16px;
          background: var(--bg-secondary, #ffffff); border: 1px solid var(--border-color); 
          color: var(--text-secondary); cursor: pointer;
          transition: all 0.2s; padding: 6px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          z-index: 10; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .close-btn:hover { color: var(--primary-color); transform: scale(1.1); border-color: var(--primary-color); }
        
        .profile-layout {
          display: flex; gap: 24px; margin-top: 5px;
        }
        @media (max-width: 768px) {
          .profile-layout { flex-direction: column; }
        }
        .profile-left {
          flex: 0 0 240px; text-align: center;
        }
        .driver-photo {
          width: 100%; aspect-ratio: 1/1; background: var(--bg, #f1f5f9); border-radius: 12px;
          display: flex; align-items: center; justify-content: center; overflow: hidden;
          margin-bottom: 16px; border: 1px solid var(--border-color);
        }
        .driver-photo img { width: 100%; height: 100%; object-fit: cover; }
        .avatar-placeholder { opacity: 0.5; color: var(--text-muted); }
        .driver-id { font-size: 1.1rem; margin: 0 0 4px 0; color: var(--primary-color, #38bdf8); font-weight: 600; letter-spacing: 1px; }
        .driver-name { font-size: 1.25rem; margin: 0; color: var(--text-primary); opacity: 0.9; }
        
        .profile-right {
          flex: 1; display: flex; flex-direction: column; gap: 16px;
        }
        .vehicle-photo {
          width: 100%; aspect-ratio: 21/9; background: var(--bg, #f1f5f9); border-radius: 12px;
          display: flex; align-items: center; justify-content: center; overflow: hidden;
          border: 1px solid var(--border-color);
        }
        .vehicle-placeholder { text-align: center; font-size: 20px; opacity: 0.5; color: var(--text-muted); }
        
        .info-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
        }
        @media (max-width: 600px) {
          .info-grid { grid-template-columns: 1fr; }
        }
        .info-section {
          background: var(--bg, #f9fafb); padding: 20px; border-radius: 12px;
          border: 1px solid var(--border-color);
        }
        .info-section h4 {
          font-size: 1.1rem; margin: 0 0 15px 0; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; color: var(--text-secondary);
        }
        .info-section p { margin: 8px 0; font-size: 0.9rem; color: var(--text-secondary); }
        .info-section strong { color: var(--text-primary); font-weight: 600; }
        
        .docs-section {
          background: var(--bg, #f9fafb); padding: 20px; border-radius: 12px;
          border: 1px solid var(--border-color);
        }
        .docs-section h4 {
          font-size: 1.1rem; margin: 0 0 15px 0; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; color: var(--text-secondary);
        }
        .docs-grid {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
        }
        @media (max-width: 900px) {
          .docs-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 600px) {
          .docs-grid { grid-template-columns: 1fr; }
        }
        .doc-item {
          display: flex; justify-content: space-between; align-items: center;
          background: var(--bg-secondary, #ffffff); padding: 10px 14px; border-radius: 8px;
          font-size: 0.85rem; border: 1px solid var(--border-color);
          color: var(--text-primary); transition: border-color 0.2s;
        }
        .doc-item:hover { border-color: var(--primary-color); }
        .text-green { color: #10b981; font-weight: 600; margin-left: 5px; }
        .btn-view-doc {
          background: var(--accent-bg, rgba(56,189,248,0.1)); 
          border: 1px solid var(--accent-border, rgba(56,189,248,0.3)); 
          color: var(--primary-color, #38bdf8);
          padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; 
          transition: all 0.2s; display: flex; align-items: center; gap: 6px; font-weight: 600;
        }
        .btn-view-doc:hover {
          background: var(--primary-color);
          color: #ffffff;
        }

        /* Review doc cards */
        .review-docs-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px;
        }
        .review-doc-card {
          background: var(--bg-secondary, #fff); border: 1px solid var(--border-color);
          border-radius: 10px; padding: 12px 14px;
          display: flex; flex-direction: column; gap: 10px;
          transition: border-color 0.2s;
        }
        .review-doc-card:hover { border-color: rgba(56,189,248,0.4); }
        .review-doc-header {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        }
        .review-doc-name {
          flex: 1; font-size: 0.82rem; font-weight: 600; color: var(--text-primary);
        }
        .rev-badge {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 20px;
          white-space: nowrap;
        }
        .rev-ok { background: rgba(34,197,94,0.12); color: #22c55e; }
        .rev-no { background: rgba(239,68,68,0.12); color: #ef4444; }
        .rev-pending { background: rgba(245,158,11,0.12); color: #f59e0b; }
        .rev-missing { background: rgba(100,116,139,0.1); color: var(--text-secondary); }
        .review-doc-actions {
          display: flex; gap: 6px; flex-wrap: wrap;
        }
        .btn-approve-doc {
          display: flex; align-items: center; gap: 4px;
          background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3);
          color: #22c55e; padding: 5px 10px; border-radius: 6px;
          font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .btn-approve-doc:hover:not(:disabled) { background: #22c55e; color: #fff; }
        .btn-approve-doc:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-reject-doc {
          display: flex; align-items: center; gap: 4px;
          background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);
          color: #ef4444; padding: 5px 10px; border-radius: 6px;
          font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .btn-reject-doc:hover:not(:disabled) { background: #ef4444; color: #fff; }
        .btn-reject-doc:disabled { opacity: 0.4; cursor: not-allowed; }
        .review-doc-missing {
          font-size: 0.75rem; color: var(--text-secondary); margin: 0;
          font-style: italic;
        }

        /* Notify section */
        .notify-section {
          background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.2);
          border-radius: 12px; padding: 20px;
        }
        .notify-textarea {
          width: 100%; padding: 10px 12px; border-radius: 8px;
          border: 1px solid var(--border-color); background: var(--bg-secondary);
          color: var(--text-primary); font-size: 0.88rem; resize: vertical;
          outline: none; transition: border-color 0.2s; font-family: inherit;
          box-sizing: border-box;
        }
        .notify-textarea:focus { border-color: #f59e0b; }

        .btn-icon {
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 1.1rem;
          opacity: 0.7;
          transition: 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 6px;
          padding: 0;
          color: var(--text-secondary);
          flex-shrink: 0;
        }
        .btn-icon:hover {
          opacity: 1;
          transform: scale(1.1);
        }
        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }
        .modal-content {
          background: var(--kapital-card-bg);
          padding: 30px;
          border-radius: 12px;
          width: 90%;
          max-width: 500px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          border: 1px solid var(--kapital-border);
          display: flex;
          flex-direction: column;
        }
        .form-scroll-area {
          max-height: 60vh;
          overflow-y: auto;
          padding-right: 15px;
          margin-bottom: 20px;
        }
        .form-scroll-area::-webkit-scrollbar {
          width: 6px;
        }
        .form-scroll-area::-webkit-scrollbar-track {
          background: transparent;
        }
        .form-scroll-area::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        .form-scroll-area::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
        .custom-file-upload {
          display: inline-block;
          padding: 8px 12px;
          border-radius: 6px;
          border: 1px dashed var(--kapital-border);
          background: #f8fafc;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 0.85rem;
          font-weight: 500;
          transition: all 0.2s;
        }
        .custom-file-upload:hover {
          background: var(--kapital-light-blue);
          color: var(--kapital-blue-deep);
          border-color: var(--kapital-blue-deep);
        }
        .modal-content h3 {
          margin-top: 0;
          color: var(--kapital-text-primary);
          font-weight: 700;
        }
        .flota-form {
          display: flex;
          flex-direction: column;
          gap: 15px;
          margin-top: 20px;
        }
        .form-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .form-row label {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--kapital-text-secondary);
        }
        .form-row input, .form-row select {
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--kapital-border);
          background: var(--kapital-bg);
          color: var(--kapital-text-primary);
          font-size: 0.95rem;
          outline: none;
          transition: border-color 0.2s;
        }
        .form-row input:focus, .form-row select:focus {
          border-color: var(--kapital-nav-link-active);
        }
        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 25px;
        }

        /* DOC VIEWER MODAL */
        .doc-viewer-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.8); backdrop-filter: blur(5px);
          display: flex; align-items: center; justify-content: center;
          z-index: 9999; padding: 20px;
        }
        .doc-viewer-content {
          background: var(--bg-secondary); border-radius: 12px; width: 100%; max-width: 900px;
          display: flex; flex-direction: column; overflow: hidden;
          box-shadow: 0 10px 40px rgba(0,0,0,0.4); border: 1px solid var(--border-color);
        }
        .doc-viewer-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 15px 20px; border-bottom: 1px solid var(--border-color);
        }
        .doc-viewer-header h3 {
          margin: 0; font-size: 1.1rem; font-weight: 600; color: var(--text-primary);
        }
        .close-btn-inline {
          background: transparent; border: none; color: var(--text-secondary);
          cursor: pointer; padding: 4px; border-radius: 4px; display: flex;
          align-items: center; justify-content: center; transition: all 0.2s;
        }
        .close-btn-inline:hover { background: rgba(239,68,68,0.1); color: #ef4444; }
        .doc-viewer-body {
          padding: 0; background: #e2e8f0; display: flex; align-items: center; justify-content: center;
          height: 80vh; max-height: 800px;
        }
        .doc-iframe {
          width: 100%; height: 100%; border: none;
        }
        .doc-image {
          max-width: 100%; max-height: 100%; object-fit: contain;
        }
      `}</style>

      {/* DOCUMENT VIEWER MODAL */}
      {viewingDoc && (
        <div className="doc-viewer-overlay" onClick={() => setViewingDoc(null)}>
          <div className="doc-viewer-content" onClick={e => e.stopPropagation()}>
            <div className="doc-viewer-header">
              <h3>{viewingDoc.name}</h3>
              <button className="close-btn-inline" onClick={() => setViewingDoc(null)}><X size={20} /></button>
            </div>
            <div className="doc-viewer-body" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', color: '#fff', padding: '20px', textAlign: 'center' }}>
              {(!viewingDoc.src || viewingDoc.src === '') ? (
                <div style={{ padding: '30px', background: 'rgba(255,100,100,0.1)', borderRadius: '8px', border: '1px solid rgba(255,100,100,0.3)' }}>
                  <h4 style={{ color: '#ff6b6b', marginBottom: '10px' }}>Documento no disponible o dañado</h4>
                  <p style={{ fontSize: '14px', color: '#ccc' }}>El archivo no se cargó correctamente al servidor. Por favor, solicite al conductor que lo vuelva a subir.</p>
                </div>
              ) : typeof viewingDoc.src === 'string' && (viewingDoc.src.includes('application/pdf') || viewingDoc.src.includes('.pdf')) ? (
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

export default FlotaView;
