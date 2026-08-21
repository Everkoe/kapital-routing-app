import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { MessageCircle, Pencil, Trash2, Loader, Download, User, Search, AlertTriangle, FileCheck, CarFront } from 'lucide-react';
import { GlobalLoader } from './App';

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

  // Pagination state
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
          {/* Left Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: '1 1 300px' }}>
            <h2 style={{ margin: 0 }}>Control de Conformidad Legal y Flota</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
              Monitoreo en tiempo real de requerimientos ATU y MTC y gestión del padrón de flota.
            </p>
          </div>
          
          {/* Right Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'stretch', flex: '0 0 auto' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '20px', marginTop: '10px' }}>
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
            <button className="close-btn" onClick={closeConductorModal}>&times;</button>
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
                <div className="profile-left">
                  <div className="driver-photo">
                    {conductorInfo.usuario.avatar ? (
                      <img src={conductorInfo.usuario.avatar} alt="Conductor" />
                    ) : (
                      <div className="avatar-placeholder" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={40} strokeWidth={1.5} /></div>
                    )}
                  </div>
                  <h2 className="driver-id">{conductorInfo.unidad_id}</h2>
                  <h3 className="driver-name">{conductorInfo.usuario.nombre.toUpperCase()}</h3>
                </div>
                <div className="profile-right">
                  <div className="vehicle-photo">
                    <img src="https://images.unsplash.com/photo-1619682817481-e994891cd1f5?auto=format&fit=crop&q=80&w=1600" alt="Vehículo" style={{width: '100%', height: '100%', objectFit: 'cover'}} />
                  </div>
                  <div className="info-grid">
                    <div className="info-section">
                      <h4>Información del conductor</h4>
                      <p><strong>DNI/Documento:</strong> {conductorInfo.usuario.perfil_conductor?.tipoDoc || 'DNI'} {conductorInfo.usuario.perfil_conductor?.numDoc || 'No registrado'}</p>
                      <p><strong>Fecha de Nacimiento:</strong> {conductorInfo.usuario.perfil_conductor?.fechaNacimiento || 'No registrado'}</p>
                      <p><strong>Dirección:</strong> {conductorInfo.usuario.perfil_conductor?.direccion || 'No registrado'}</p>
                      <p><strong>Teléfonos:</strong> {conductorInfo.usuario.perfil_conductor?.telefonoDirecto || 'No registrado'} {conductorInfo.usuario.perfil_conductor?.telefonoEmergencia ? `/ ${conductorInfo.usuario.perfil_conductor.telefonoEmergencia}` : ''}</p>
                    </div>
                    <div className="info-section">
                      <h4>Información del vehículo</h4>
                      <p><strong>Marca y Modelo:</strong> {conductorInfo.usuario.perfil_conductor?.vehiculoMarca || conductorInfo.flota?.tipo || 'Vehículo'} {conductorInfo.usuario.perfil_conductor?.vehiculoModelo || ''}</p>
                      <p><strong>Año y Color:</strong> {conductorInfo.usuario.perfil_conductor?.vehiculoAnio || 'N/A'} / {conductorInfo.usuario.perfil_conductor?.vehiculoColor || 'N/A'}</p>
                      <p><strong>Placa:</strong> {conductorInfo.flota?.placa || conductorInfo.unidad_id}</p>
                      <p><strong>Capacidad:</strong> {conductorInfo.flota?.capacidad || 15} pasajeros</p>
                    </div>
                  </div>
                  <div className="docs-section">
                    <h4>Documentación</h4>
                    <div className="docs-grid">
                      {[
                        { name: 'Comprobante de domicilio', file: conductorInfo.usuario.perfil_conductor?.comprobanteDomicilio },
                        { name: 'Licencia de Conducir', file: conductorInfo.usuario.perfil_conductor?.licenciaConducir },
                        { name: 'Récord de Conductor', file: conductorInfo.usuario.perfil_conductor?.recordConductor },
                        { name: 'Antecedentes', file: conductorInfo.usuario.perfil_conductor?.antecedentesPenales },
                        { name: 'Tarjeta de Propiedad', file: conductorInfo.flota?.tarjeta_propiedad || conductorInfo.usuario.perfil_conductor?.tarjetaPropiedad },
                        { name: 'SOAT', file: conductorInfo.flota?.soat_doc || conductorInfo.usuario.perfil_conductor?.soat },
                        { name: 'Revisión Técnica', file: conductorInfo.flota?.revision_doc || conductorInfo.usuario.perfil_conductor?.revisionTecnica }
                      ].map((doc, i) => (
                        <div key={i} className="doc-item">
                          <span>{doc.name}{!doc.file && <span style={{color: '#f59e0b', marginLeft: '5px'}}>⏳ Falta</span>}</span>
                          {doc.file && (
                            <button className="btn-view-doc" onClick={() => window.open(doc.file, '_blank')}>👁️ Ver Archivo</button>
                          )}
                        </div>
                      ))}
                    </div>
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
          background: #1a1a24; border-radius: 16px; padding: 30px;
          width: 90%; max-width: 1000px; max-height: 90vh; overflow-y: auto;
          position: relative; color: #fff;
          box-shadow: 0 10px 40px rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.1);
        }
        .close-btn {
          position: absolute; top: 15px; right: 20px;
          background: transparent; border: none; color: #fff; font-size: 24px; cursor: pointer;
          opacity: 0.7; transition: opacity 0.2s;
        }
        .close-btn:hover { opacity: 1; }
        
        .profile-layout {
          display: flex; gap: 30px; margin-top: 10px;
        }
        @media (max-width: 768px) {
          .profile-layout { flex-direction: column; }
        }
        .profile-left {
          flex: 0 0 280px; text-align: center;
        }
        .driver-photo {
          width: 100%; aspect-ratio: 9/16; background: #2a2a3c; border-radius: 12px;
          display: flex; align-items: center; justify-content: center; overflow: hidden;
          margin-bottom: 20px; border: 1px solid rgba(255,255,255,0.05);
        }
        .driver-photo img { width: 100%; height: 100%; object-fit: cover; }
        .avatar-placeholder { font-size: 80px; opacity: 0.5; }
        .driver-id { font-size: 1.2rem; margin: 0 0 5px 0; color: #38bdf8; font-weight: 600; letter-spacing: 1px; }
        .driver-name { font-size: 1.4rem; margin: 0; opacity: 0.9; }
        
        .profile-right {
          flex: 1; display: flex; flex-direction: column; gap: 20px;
        }
        .vehicle-photo {
          width: 100%; aspect-ratio: 21/9; background: #2a2a3c; border-radius: 12px;
          display: flex; align-items: center; justify-content: center; overflow: hidden;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .vehicle-placeholder { text-align: center; font-size: 24px; opacity: 0.5; }
        
        .info-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
        }
        @media (max-width: 500px) {
          .info-grid { grid-template-columns: 1fr; }
        }
        .info-section {
          background: rgba(255,255,255,0.02); padding: 20px; border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .info-section h4 {
          font-size: 1.1rem; margin: 0 0 15px 0; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; color: #a1a1aa;
        }
        .info-section p { margin: 8px 0; font-size: 0.9rem; opacity: 0.8; }
        .info-section strong { color: #f4f4f5; font-weight: 600; opacity: 1; }
        
        .docs-section {
          background: rgba(255,255,255,0.02); padding: 20px; border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .docs-section h4 {
          font-size: 1.1rem; margin: 0 0 15px 0; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; color: #a1a1aa;
        }
        .docs-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
        }
        @media (max-width: 500px) {
          .docs-grid { grid-template-columns: 1fr; }
        }
        .doc-item {
          display: flex; justify-content: space-between; align-items: center;
          background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: 8px;
          font-size: 0.85rem; border: 1px solid rgba(255,255,255,0.03);
        }
        .text-green { color: #10b981; font-weight: 600; margin-left: 5px; }
        .btn-view-doc {
          background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.3); color: #38bdf8;
          padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: all 0.2s;
        }
        .btn-view-doc:hover {
          background: rgba(56,189,248,0.2);
        }

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
      `}</style>
    </div>
  );
};

export default FlotaView;
