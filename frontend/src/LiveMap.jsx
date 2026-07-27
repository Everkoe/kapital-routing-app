import React from 'react';
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
  // Centro de Lima por defecto
  const center = [-12.0464, -77.0428];
  
  // Extraer todos los agentes con sus coordenadas
  const markers = [];
  routes.forEach(route => {
    if(route.agentes) {
      route.agentes.forEach(ag => {
        if (ag.lat && ag.lng) {
          markers.push({
            lat: ag.lat,
            lng: ag.lng,
            id: ag.id,
            conductor: route.conductor,
            zona: route.micro_zona,
            horario: route.horario,
            direccion: ag.direccion
          });
        }
      });
    }
  });

  if (markers.length === 0) {
    return null;
  }

  return (
    <div className="card live-map-card">
      <div className="card-header">
        <h2>Live Tracking - Puntos de Recojo</h2>
      </div>
      <div className="live-map-wrapper" style={{ height: '400px', width: '100%', borderRadius: '12px', overflow: 'hidden' }}>
        <MapContainer center={center} zoom={11} scrollWheelZoom={true} style={{ height: '100%', width: '100%' }}>
          {/* TileLayer corporativo (CARTO Voyager) */}
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />
          {markers.map((m, idx) => (
            <Marker position={[m.lat, m.lng]} key={`${m.id}-${idx}`}>
              <Popup>
                <div style={{ fontFamily: 'Inter, sans-serif' }}>
                  <strong style={{ color: '#0A2540' }}>{m.id}</strong><br/>
                  <span style={{ color: '#525F7F', fontSize: '12px' }}>{m.direccion}</span><br/>
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
