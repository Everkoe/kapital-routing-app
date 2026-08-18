import React, { useState, useEffect } from 'react';
import './App.css';

const ClientPortal = ({ usuario, onLogout }) => {
  const [rutas, setRutas] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [isConductorModalOpen, setIsConductorModalOpen] = useState(false);
  const [conductorInfo, setConductorInfo] = useState(null);
  const [isLoadingConductor, setIsLoadingConductor] = useState(false);

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

  const handleOpenConductor = async (unidadId) => {
    if (!unidadId || unidadId === 'SIN ASIGNAR') return;
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
                      <td>
                        <span 
                          className="badge-unidad" 
                          style={{ cursor: ruta.conductor !== 'SIN ASIGNAR' ? 'pointer' : 'default', textDecoration: ruta.conductor !== 'SIN ASIGNAR' ? 'underline' : 'none', color: '#38bdf8' }}
                          onClick={() => handleOpenConductor(ruta.conductor)}
                          title={ruta.conductor !== 'SIN ASIGNAR' ? 'Ver perfil del conductor' : ''}
                        >
                          {ruta.conductor}
                        </span>
                      </td>
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

      {isConductorModalOpen && (
        <div className="modal-overlay" onClick={closeConductorModal}>
          <div className="modal-content conductor-profile" onClick={e => e.stopPropagation()}>
            <button className="close-btn" onClick={closeConductorModal}>&times;</button>
            {isLoadingConductor ? (
              <div style={{ padding: '50px', textAlign: 'center' }}>
                <div className="loading-spinner" style={{ fontSize: '2rem', animation: 'spin 1s linear infinite' }}>⚙️</div>
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
                      <div className="avatar-placeholder">👤</div>
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
                      <p><strong>DNI/Documento:</strong> {conductorInfo.usuario.perfil_conductor?.tipoDoc || 'CE'} {conductorInfo.usuario.perfil_conductor?.numDoc || 'No registrado'}</p>
                      <p><strong>Fecha de Nacimiento:</strong> {conductorInfo.usuario.perfil_conductor?.fechaNacimiento || 'No registrado'}</p>
                      <p><strong>Dirección:</strong> {conductorInfo.usuario.perfil_conductor?.direccion || 'No registrado'}</p>
                      <p><strong>Teléfonos:</strong> {conductorInfo.usuario.perfil_conductor?.telefonoDirecto || 'No registrado'} / {conductorInfo.usuario.perfil_conductor?.telefonoEmergencia || ''}</p>
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
                      {['Comprobante de domicilio', 'Licencia de Conducir', 'Récord de Conductor', 'Antecedentes', 'Tarjeta de Propiedad', 'SOAT', 'Revisión Técnica'].map((doc, i) => (
                        <div key={i} className="doc-item">
                          <span>{doc}: <span className="text-green">✅ Subido</span></span>
                          <button className="btn-view-doc">👁️ Ver Archivo</button>
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
        
        /* Modal Profile CSS */
        .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.7); backdrop-filter: blur(5px);
          display: flex; align-items: center; justify-content: center; z-index: 1000;
          animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        
        .modal-content.conductor-profile {
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
      `}</style>
    </div>
  );
};

export default ClientPortal;
