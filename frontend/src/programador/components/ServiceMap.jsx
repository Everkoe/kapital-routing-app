import { useMemo } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet';
import { MapPinOff } from 'lucide-react';
import L from 'leaflet';
import { hasCoordinate } from '../model/serviceModel.js';
import 'leaflet/dist/leaflet.css';

/**
 * Los domicilios de un servicio sobre el mapa.
 *
 * **Solo se dibuja lo que se sabe.** El domicilio de cada pasajero no viene
 * del archivo: lo deduce la base a partir del GPS de sus recojos, y hoy lo
 * consigue para 811 de 1.163 personas. Quien no tiene punto no se pinta en
 * ningún sitio aproximado —se cuenta aparte, bajo el mapa—, porque una
 * coordenada inventada que no se anuncia es peor que un hueco: manda a un
 * vehículo a una casa que no existe.
 *
 * La línea que une los puntos **no es la ruta**. Es el orden en que se recogió
 * a la gente según el histórico, en línea recta. No hay callejero detrás y no
 * se debe leer como el camino que hizo el vehículo.
 */

// Leaflet resuelve sus iconos por ruta relativa y con Vite eso no funciona.
// Es el mismo arreglo que ya hace `LiveMap`.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

/** Un punto numerado, en el color que le corresponda por ser nuevo o no. */
const marcador = (orden, nuevo) => L.divIcon({
  className: 'pw-map-pin-wrap',
  html: `<span class="pw-map-pin${nuevo ? ' es-nuevo' : ''}">${orden}</span>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const ServiceMap = ({ agentes = [], titulo, plan = false }) => {
  const ubicados = useMemo(
    () => agentes
      .map((agente, indice) => ({ ...agente, orden: indice + 1 }))
      // `hasCoordinate` y no `Number.isFinite(Number(...))`: `Number(null)`
      // vale 0, y cada agente sin ubicación se pintaba en el (0, 0), en el
      // golfo de Guinea, alejando el mapa a medio mundo. Con 352 personas aún
      // sin ubicar, pasaba en casi cualquier servicio.
      .filter((agente) => hasCoordinate(agente.lat) && hasCoordinate(agente.lng)),
    [agentes],
  );

  const sinUbicar = agentes.length - ubicados.length;

  if (ubicados.length === 0) {
    return (
      <div className="pw-map-vacio">
        <MapPinOff size={22} aria-hidden="true" />
        <p>
          Ninguno de los {agentes.length} agentes de este servicio tiene el
          domicilio resuelto todavía, así que no hay nada que situar.
        </p>
      </div>
    );
  }

  const trazo = ubicados.map((a) => [Number(a.lat), Number(a.lng)]);

  // El encuadre sale de los propios puntos, no de un zoom fijo: con un zoom
  // fijo y el centro en la media, dos domicilios separados se quedaban fuera
  // de la vista y el mapa aparecía vacío. Con un solo punto no hay extensión
  // que encuadrar, así que ahí sí se centra y se fija el zoom.
  const unico = trazo.length === 1;
  const encuadre = unico
    ? { center: trazo[0], zoom: 15 }
    : { bounds: trazo, boundsOptions: { padding: [28, 28], maxZoom: 15 } };

  return (
    <div className="pw-map">
      <MapContainer {...encuadre} scrollWheelZoom={false}
        style={{ height: '280px', width: '100%' }}
        aria-label={`Domicilios del servicio ${titulo || ''}`}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {trazo.length > 1 && (
          <Polyline positions={trazo} pathOptions={{ weight: 2, opacity: 0.5, dashArray: '5 6' }} />
        )}
        {ubicados.map((agente) => (
          <Marker key={`${agente.id}-${agente.orden}`}
            position={[Number(agente.lat), Number(agente.lng)]}
            icon={marcador(agente.orden, agente.nuevo)}>
            <Popup>
              <strong>{agente.nombre}</strong>
              <br />{agente.direccion || 'Sin dirección'}
              {agente.hora && <><br />Recogido a las {String(agente.hora).slice(0, 5)}</>}
              {agente.nuevo && <><br /><em>Nuevo en este servicio</em></>}
              {agente.ubicacion === 'dudosa' && (
                <><br /><em>Ubicación aproximada</em></>
              )}
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <p className="pw-map-nota">
        {plan
          ? 'La línea es el orden de recogida de la programación, en línea recta: no es el camino que hará el vehículo.'
          : 'La línea es el orden de recogida del histórico, en línea recta: no es el camino que hizo el vehículo.'}
        {sinUbicar > 0 && (
          <> <strong>{sinUbicar} agente(s) no aparecen</strong> porque su domicilio
            aún no está resuelto.
          </>
        )}
      </p>
    </div>
  );
};

export default ServiceMap;
