import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import './App.css';

const FlotaView = ({ usuario }) => {
  const isCliente = usuario?.rol === 'Cliente';
  const [flota, setFlota] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    placa: '', capacidad: 10, tipo: 'Van', chofer: '', soat: '', revision: '', atu: '', licencia: '',
    soat_doc: '', revision_doc: '', atu_doc: '', licencia_doc: ''
  });
  const [isEditing, setIsEditing] = useState(false);

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
    const today = new Date('2026-07-27T00:00:00');
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
    setFormData({ placa: '', capacidad: 10, tipo: 'Van', chofer: '', soat: '', revision: '', atu: '', licencia: '', soat_doc: '', revision_doc: '', atu_doc: '', licencia_doc: '' });
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

  if (isLoading && flota.length === 0) return <div className="loading-indicator">Cargando datos de flota...</div>;
  if (error) return <div className="error-message">Error: {error}</div>;

  return (
    <div className="card flota-view-card" style={{ maxWidth: '100%', overflowX: 'auto', position: 'relative' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Control de Conformidad Legal y Flota</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn-secondary" onClick={handleExport} style={{ backgroundColor: '#10b981', color: 'white', border: 'none' }}>⬇️ Exportar Excel</button>
          <button className="btn-secondary" onClick={fetchFlota}>Actualizar</button>
          {!isCliente && <button className="btn-primary" onClick={handleCreate} style={{ backgroundColor: 'var(--kapital-accent-green)' }}>+ Nueva Unidad</button>}
        </div>
      </div>
      
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
        Monitoreo en tiempo real de requerimientos ATU y MTC y gestión del padrón de flota.
      </p>

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
          {flota.map((vehiculo, index) => {
            const hasDanger = 
              getStatus(vehiculo.soat).status === 'danger' || 
              getStatus(vehiculo.revision).status === 'danger' ||
              getStatus(vehiculo.atu).status === 'danger' ||
              getStatus(vehiculo.licencia).status === 'danger';

            return (
              <tr key={vehiculo.placa || index} className={hasDanger ? 'row-danger' : ''}>
                <td style={{ fontWeight: 'bold' }}>{vehiculo.placa}</td>
                <td>{vehiculo.chofer}</td>
                {!isCliente && <td>{vehiculo.tipo} ({vehiculo.capacidad} pax)</td>}
                <td>{renderBadge(vehiculo.soat, vehiculo.soat_doc)}</td>
                <td>{renderBadge(vehiculo.revision, vehiculo.revision_doc)}</td>
                <td>{renderBadge(vehiculo.atu, vehiculo.atu_doc)}</td>
                <td>{renderBadge(vehiculo.licencia, vehiculo.licencia_doc)}</td>
                {!isCliente && (
                <td>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <button className="btn-icon" onClick={() => handleEdit(vehiculo)} title="Editar">✏️</button>
                    <button className="btn-icon" onClick={() => handleDelete(vehiculo.placa)} title="Eliminar">🗑️</button>
                  </div>
                </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

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
      <style jsx>{`
        .btn-icon {
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 1.1rem;
          opacity: 0.7;
          transition: 0.2s;
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
