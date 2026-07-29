import React, { useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default Leaflet icons in Vite/React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const LiveMap = ({ routes }) => {
  const center = [-12.0464, -77.0428];

  // Estados de filtros
  const [filtroTipo, setFiltroTipo] = useState('Todos');
  const [filtroHorario, setFiltroHorario] = useState('Todos');
  const [filtroEmpresa, setFiltroEmpresa] = useState('Todas');
  const [filtroConductor, setFiltroConductor] = useState('Todos');

  // Determinar Tipo basado en el string de horario
  const getTipoFromHorario = (horarioStr = '') => {
    const lower = horarioStr.toLowerCase();
    if (lower.includes('ingreso')) return 'Ingreso';
    if (lower.includes('salida')) return 'Salida';
    return 'Otro';
  };

  // Pre-procesar todos los marcadores y opciones de filtro
  const { allMarkers, opciones } = useMemo(() => {
    const markers = [];
    const horarios = new Set();
    const empresas = new Set();
    const conductores = new Set();
    const tipos = new Set();

    routes.forEach(route => {
      if (route.agentes) {
        // En ausencia de campo empresa nativo, por ahora usamos "Generica" si no viene
        const empresa = route.empresa || 'No especificada'; 
        const horario = route.horario || 'Sin Horario';
        const conductor = route.conductor || 'Sin Asignar';
        const tipo = getTipoFromHorario(horario);

        horarios.add(horario);
        empresas.add(empresa);
        conductores.add(conductor);
        tipos.add(tipo);

        route.agentes.forEach(ag => {
          if (ag.lat && ag.lng) {
            markers.push({
              lat: ag.lat,
              lng: ag.lng,
              id: ag.id,
              conductor: conductor,
              zona: route.micro_zona,
              horario: horario,
              direccion: ag.direccion,
              empresa: empresa,
              tipo: tipo
            });
          }
        });
      }
    });

    return { 
      allMarkers: markers,
      opciones: {
        tipos: Array.from(tipos),
        horarios: Array.from(horarios).sort(),
        empresas: Array.from(empresas).sort(),
        conductores: Array.from(conductores).sort()
      }
    };
  }, [routes]);

  // Aplicar filtros
  const filteredMarkers = useMemo(() => {
    return allMarkers.filter(m => {
      const matchTipo = filtroTipo === 'Todos' || m.tipo === filtroTipo;
      const matchHorario = filtroHorario === 'Todos' || m.horario === filtroHorario;
      const matchEmpresa = filtroEmpresa === 'Todas' || m.empresa === filtroEmpresa;
      const matchConductor = filtroConductor === 'Todos' || m.conductor === filtroConductor;
      return matchTipo && matchHorario && matchEmpresa && matchConductor;
    });
  }, [allMarkers, filtroTipo, filtroHorario, filtroEmpresa, filtroConductor]);

  if (allMarkers.length === 0) {
    return null;
  }

  return (
    <div className="card live-map-card">
      <div className="card-header" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <h2 style={{ margin: 0 }}>Live Tracking - Filtros Inteligentes</h2>
        
        {/* Panel de Filtros */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <select className="auth-input" style={{ width: 'auto', marginBottom: 0, padding: '8px 12px' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
            <option value="Todos">Tipo: Todos</option>
            {opciones.tipos.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          
          <select className="auth-input" style={{ width: 'auto', marginBottom: 0, padding: '8px 12px' }} value={filtroHorario} onChange={e => setFiltroHorario(e.target.value)}>
            <option value="Todos">Horario: Todos</option>
            {opciones.horarios.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
          
          <select className="auth-input" style={{ width: 'auto', marginBottom: 0, padding: '8px 12px' }} value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)}>
            <option value="Todas">Empresa: Todas</option>
            {opciones.empresas.map(e => <option key={e} value={e}>{e}</option>)}
          </select>

          <select className="auth-input" style={{ width: 'auto', marginBottom: 0, padding: '8px 12px' }} value={filtroConductor} onChange={e => setFiltroConductor(e.target.value)}>
            <option value="Todos">Conductor: Todos</option>
            {opciones.conductores.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          
          <div style={{ padding: '8px 12px', background: 'var(--kapital-badge-bg)', color: 'var(--kapital-badge-text)', borderRadius: '12px', border: '1px solid rgba(56,189,248,0.2)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', fontWeight: 'bold' }}>
            Viendo {filteredMarkers.length} agentes
          </div>
        </div>
      </div>
      
      <div className="live-map-wrapper" style={{ height: '600px', width: '100%', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
        <MapContainer center={center} zoom={11} scrollWheelZoom={true} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution='&copy; CARTO'
          />
          {filteredMarkers.map((m, idx) => (
            <Marker position={[m.lat, m.lng]} key={`${m.id}-${idx}`}>
              <Popup>
                <div style={{ fontFamily: 'Inter, sans-serif' }}>
                  <strong style={{ color: '#0A2540' }}>{m.id}</strong><br/>
                  <span style={{ color: '#525F7F', fontSize: '12px' }}>{m.direccion}</span><br/>
                  <span style={{ color: '#06b6d4', fontSize: '12px', fontWeight: 'bold' }}>{m.tipo} - {m.empresa}</span><br/>
                  <hr style={{ margin: '5px 0', border: 'none', borderTop: '1px solid #eee' }} />
                  <strong>Unidad:</strong> <span style={{ color: '#0284c7' }}>{m.conductor}</span><br/>
                  <strong>Turno:</strong> {m.horario}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
};

export default LiveMap;
