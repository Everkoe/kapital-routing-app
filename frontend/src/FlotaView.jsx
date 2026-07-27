import React, { useState, useEffect } from 'react';
import './App.css'; // Asumiendo que usamos las mismas clases base

const FlotaView = () => {
  const [flota, setFlota] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchFlota = async () => {
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
    fetchFlota();
  }, []);

  // Función para determinar el estado (semáforo) de un documento
  const getStatus = (dateString) => {
    if (!dateString) return { status: 'unknown', text: 'N/A' };
    
    const today = new Date('2026-07-27T00:00:00'); // Usamos la fecha actual referenciada
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

  if (isLoading) return <div className="loading-indicator">Cargando datos de flota...</div>;
  if (error) return <div className="error-message">Error: {error}</div>;

  return (
    <div className="card flota-view-card" style={{ maxWidth: '100%', overflowX: 'auto' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Control de Conformidad Legal (Compliance)</h2>
        <button className="btn-primary" onClick={() => window.location.reload()}>Actualizar</button>
      </div>
      
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
        Monitoreo en tiempo real de los requerimientos de la ATU y MTC para operaciones B2B.
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
            <th>Acción</th>
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
              <tr key={index} className={hasDanger ? 'row-danger' : ''}>
                <td style={{ fontWeight: 'bold' }}>{vehiculo.placa}</td>
                <td>{vehiculo.chofer}</td>
                <td>{vehiculo.tipo} ({vehiculo.capacidad} pax)</td>
                <td>{renderBadge(vehiculo.soat)}</td>
                <td>{renderBadge(vehiculo.revision)}</td>
                <td>{renderBadge(vehiculo.atu)}</td>
                <td>{renderBadge(vehiculo.licencia)}</td>
                <td>
                  <button className="btn-secondary" style={{ padding: '5px 10px', fontSize: '0.8rem', opacity: hasDanger ? 0.5 : 1 }} disabled={hasDanger}>
                    {hasDanger ? 'Bloqueado' : 'Editar'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default FlotaView;
