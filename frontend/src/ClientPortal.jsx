import React, { useState, useEffect } from 'react';
import './App.css';

const ClientPortal = ({ usuario, onLogout }) => {
  const [rutas, setRutas] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const empresaId = usuario.empresa_id || 'GLOBO_AZUL';

  useEffect(() => {
    const fetchMisRutas = async () => {
      try {
        const response = await fetch(`/api/cliente/rutas/${empresaId}`);
        if (!response.ok) throw new Error('Error al obtener datos');
        const data = await response.json();
        setRutas(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMisRutas();
  }, [empresaId]);

  const pasajerosTotales = rutas.reduce((acc, ruta) => acc + (ruta.agentes ? ruta.agentes.length : 0), 0);
  const pasajerosRecogidos = rutas.reduce((acc, ruta) => 
    acc + (ruta.agentes ? ruta.agentes.filter(a => a.estado === 'Recogido').length : 0), 0);
  
  const unidadesAsignadas = new Set(rutas.map(r => r.conductor)).size;

  if (isLoading) return <div className="loading-indicator" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Cargando datos corporativos...</div>;

  return (
    <div className="client-portal">
      <header className="client-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1200px', margin: '0 auto' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem', color: 'var(--kapital-accent-blue)' }}>Kapital <span style={{color: 'white'}}>Corporate</span></h1>
            <p style={{ margin: 0, opacity: 0.8, fontSize: '0.9rem' }}>Dashboard de Auditoría: <strong>{empresaId}</strong></p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <span style={{ fontSize: '0.9rem', opacity: 0.9 }}>👤 {usuario.nombre}</span>
            <button onClick={onLogout} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.3)', color: 'white', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer' }}>Cerrar Sesión</button>
          </div>
        </div>
      </header>

      <main className="client-content">
        <div className="client-kpi-grid">
          <div className="client-kpi-card">
            <h3>Personal en Ruta Hoy</h3>
            <div className="kpi-value">{pasajerosTotales}</div>
          </div>
          <div className="client-kpi-card">
            <h3>Personal Recogido</h3>
            <div className="kpi-value" style={{color: 'var(--kapital-accent-green)'}}>{pasajerosRecogidos}</div>
          </div>
          <div className="client-kpi-card">
            <h3>Unidades Desplegadas</h3>
            <div className="kpi-value">{unidadesAsignadas}</div>
          </div>
        </div>

        <div className="client-section">
          <h2>Estado Detallado del Personal</h2>
          {error && <p className="error-message">{error}</p>}
          {rutas.length === 0 && !error && <p>No hay rutas asignadas para su empresa en este momento.</p>}
          
          <div className="table-responsive">
            <table className="client-table">
              <thead>
                <tr>
                  <th>Nombre del Empleado</th>
                  <th>Dirección</th>
                  <th>Horario</th>
                  <th>Unidad Asignada</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {rutas.map(ruta => 
                  ruta.agentes.map(agente => (
                    <tr key={`${ruta.conductor}-${ruta.horario}-${agente.id}`}>
                      <td><strong>{agente.nombre || `Agente ${agente.id}`}</strong></td>
                      <td style={{opacity: 0.8}}>{agente.direccion}</td>
                      <td>{ruta.horario}</td>
                      <td><span className="badge-unidad">{ruta.conductor}</span></td>
                      <td>
                        <span className={`badge-estado ${agente.estado === 'Recogido' ? 'estado-verde' : 'estado-amarillo'}`}>
                          {agente.estado === 'Recogido' ? '✅ Recogido' : '⏳ Pendiente'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <style jsx>{`
        .client-portal {
          min-height: 100vh;
          background-color: var(--kapital-bg);
          color: var(--kapital-text-primary);
        }
        .client-header {
          background-color: var(--kapital-surface);
          padding: 20px 30px;
          border-bottom: 1px solid var(--kapital-border);
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .client-content {
          padding: 30px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .client-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 40px;
        }
        .client-kpi-card {
          background: linear-gradient(145deg, var(--kapital-surface) 0%, rgba(20,20,30,0.5) 100%);
          border: 1px solid var(--kapital-border);
          border-radius: 12px;
          padding: 25px;
          text-align: center;
          transition: transform 0.2s ease;
        }
        .client-kpi-card:hover {
          transform: translateY(-2px);
          border-color: var(--kapital-accent-blue);
        }
        .client-kpi-card h3 {
          margin: 0 0 10px 0;
          font-size: 1rem;
          opacity: 0.7;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .kpi-value {
          font-size: 3rem;
          font-weight: 800;
        }
        .client-section {
          background-color: var(--kapital-surface);
          border-radius: 12px;
          padding: 25px;
          border: 1px solid var(--kapital-border);
        }
        .client-section h2 {
          margin-top: 0;
          margin-bottom: 20px;
          font-size: 1.4rem;
          border-bottom: 1px solid var(--kapital-border);
          padding-bottom: 10px;
        }
        .table-responsive {
          overflow-x: auto;
        }
        .client-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        .client-table th {
          padding: 12px 15px;
          background-color: rgba(255,255,255,0.05);
          color: var(--kapital-text-secondary);
          font-weight: 600;
          border-bottom: 2px solid var(--kapital-border);
        }
        .client-table td {
          padding: 15px;
          border-bottom: 1px solid var(--kapital-border);
        }
        .client-table tr:hover td {
          background-color: rgba(255,255,255,0.02);
        }
        .badge-unidad {
          background-color: rgba(255,255,255,0.1);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.85rem;
          font-family: monospace;
        }
        .badge-estado {
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 0.85rem;
          font-weight: bold;
        }
        .estado-verde {
          background-color: rgba(16, 185, 129, 0.2);
          color: #10b981;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }
        .estado-amarillo {
          background-color: rgba(245, 158, 11, 0.2);
          color: #f59e0b;
          border: 1px solid rgba(245, 158, 11, 0.3);
        }
      `}</style>
    </div>
  );
};

export default ClientPortal;
