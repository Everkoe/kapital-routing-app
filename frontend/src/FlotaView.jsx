import React, { useState, useEffect } from 'react';
import './App.css';

const FlotaView = () => {
  const [flota, setFlota] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    placa: '', capacidad: 10, tipo: 'Van', chofer: '', soat: '', revision: '', atu: '', licencia: ''
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

  const renderBadge = (dateString) => {
    const { status, text } = getStatus(dateString);
    return (
      <div className={`status-badge status-${status}`} title={dateString}>
        <span className="dot"></span>
        {text}
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
    setFormData({ placa: '', capacidad: 10, tipo: 'Van', chofer: '', soat: '', revision: '', atu: '', licencia: '' });
    setIsEditing(false);
    setShowModal(true);
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
          <button className="btn-secondary" onClick={fetchFlota}>Actualizar</button>
          <button className="btn-primary" onClick={handleCreate} style={{ backgroundColor: 'var(--kapital-accent-green)' }}>+ Nueva Unidad</button>
        </div>
      </div>
      
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
        Monitoreo en tiempo real de requerimientos ATU y MTC y gestión del padrón de flota.
      </p>

      <table className="flota-table">
        <thead>
          <tr>
            <th>Unidad (Placa)</th>
            <th>Conductor</th>
            <th>Tipo / Cap.</th>
            <th>SOAT</th>
            <th>Rev. Técnica</th>
            <th>T.U.C (ATU)</th>
            <th>Licencia MTC</th>
            <th>Acciones</th>
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
                <td>{vehiculo.tipo} ({vehiculo.capacidad} pax)</td>
                <td>{renderBadge(vehiculo.soat)}</td>
                <td>{renderBadge(vehiculo.revision)}</td>
                <td>{renderBadge(vehiculo.atu)}</td>
                <td>{renderBadge(vehiculo.licencia)}</td>
                <td>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <button className="btn-icon" onClick={() => handleEdit(vehiculo)} title="Editar">✏️</button>
                    <button className="btn-icon" onClick={() => handleDelete(vehiculo.placa)} title="Eliminar">🗑️</button>
                  </div>
                </td>
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
                <input type="date" required value={formData.soat} onChange={e => setFormData({...formData, soat: e.target.value})} />
              </div>
              <div className="form-row">
                <label>Vencimiento Revisión</label>
                <input type="date" required value={formData.revision} onChange={e => setFormData({...formData, revision: e.target.value})} />
              </div>
              <div className="form-row">
                <label>Vencimiento ATU</label>
                <input type="date" required value={formData.atu} onChange={e => setFormData({...formData, atu: e.target.value})} />
              </div>
              <div className="form-row">
                <label>Vencimiento Licencia</label>
                <input type="date" required value={formData.licencia} onChange={e => setFormData({...formData, licencia: e.target.value})} />
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
          background: var(--bg-card);
          padding: 30px;
          border-radius: 12px;
          width: 90%;
          max-width: 500px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.5);
          border: 1px solid var(--border-color);
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
          gap: 5px;
        }
        .form-row label {
          font-size: 0.9rem;
          color: var(--text-secondary);
        }
        .form-row input, .form-row select {
          padding: 10px;
          border-radius: 6px;
          border: 1px solid var(--border-color);
          background: var(--bg-main);
          color: var(--text-primary);
        }
        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 20px;
        }
      `}</style>
    </div>
  );
};

export default FlotaView;
