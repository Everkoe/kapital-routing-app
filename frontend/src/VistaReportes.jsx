import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import './App.css';

const VistaReportes = () => {
  const [historial, setHistorial] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchReportes = async () => {
      try {
        const res = await fetch('/api/reportes');
        if (res.ok) {
          const data = await res.json();
          // reverse to show newest first
          setHistorial(data.historial.reverse());
        }
      } catch (err) {
        console.error("Error fetching reportes", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchReportes();
  }, []);

  const handleExport = (registro) => {
    const flatData = registro.rutas.flatMap(route => 
      route.agentes.map(agente => ({
        'Fecha Turno': registro.fecha,
        'Conductor': route.conductor,
        'Micro-Zona': route.micro_zona,
        'Horario': route.horario,
        'ID Pasajero': agente.id,
        'Dirección': agente.direccion,
        'Empresa': agente.empresa || 'N/A',
        'Estado': agente.estado || 'Asignado'
      }))
    );
    const worksheet = XLSX.utils.json_to_sheet(flatData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reporte");
    XLSX.writeFile(workbook, `Reporte_Kapital_${registro.fecha.replace(/[: ]/g, '_')}.xlsx`);
  };

  if (isLoading) return <div className="loading-indicator">Cargando reportes...</div>;

  return (
    <div className="card reportes-view-card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Reportes y Analítica Histórica</h2>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
        Descargue la información de las rutas pasadas para facturación B2B o auditoría.
      </p>

      {historial.length === 0 ? (
        <p style={{ padding: '20px', textAlign: 'center', color: '#666' }}>No hay historial de rutas archivadas aún.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {historial.map((reg, idx) => (
            <div key={idx} style={{ 
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '15px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: '8px'
            }}>
              <div>
                <h3 style={{ margin: '0 0 5px 0' }}>Operación del {reg.fecha}</h3>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  Total de rutas: {reg.rutas.length} | 
                  Total Pasajeros: {reg.rutas.reduce((acc, r) => acc + r.agentes.length, 0)}
                </span>
              </div>
              <button className="btn-secondary" onClick={() => handleExport(reg)}>Exportar Excel</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VistaReportes;
