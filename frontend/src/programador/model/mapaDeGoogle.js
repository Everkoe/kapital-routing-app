/**
 * La dirección del mapa de Google que enseña un servicio, sin React.
 *
 * Es el visor incrustado de Google Maps (`output=embed`), el mismo que da el
 * botón «Insertar un mapa» de Google: no necesita clave, ni cuenta, ni
 * facturación. El mapa de Google con JavaScript sí las exige (tarjeta
 * registrada y cuenta de pago activa aunque no se pase de lo gratuito), y el
 * usuario no quiere pagar Google Cloud para ver un mapa. Contrapartida: esta
 * forma no está documentada como API; si Google la retirara, la salida oficial
 * es la Maps Embed API, gratuita e ilimitada, pero con clave.
 *
 * Con dos o más domicilios es una ruta: Google calcula el camino real, calle
 * por calle, pasando por ellos en el orden del servicio (medido: funciona con
 * 20 paradas). Con uno, un punto.
 *
 * **Solo van los que tienen punto**, y como coordenadas, no como texto:
 *   - el punto sale del GPS de sus propios recojos (29 m de error mediano) y
 *     es mejor que lo que Google deduciría de la dirección;
 *   - se probó a mandar la dirección escrita de quienes no tienen punto y
 *     Google no encontró ninguna de cuatro reales (manzana y lote, o una calle
 *     llevada a otro distrito). Una parada que Google no encuentra rompe la
 *     ruta entera, así que esas personas se cuentan aparte, bajo el mapa.
 *
 * A Google solo le llegan coordenadas: ni nombres ni documentos.
 */
import { hasCoordinate } from './serviceModel.js';

const VISOR = 'https://maps.google.com/maps';

// Zoom para un solo domicilio: se ve la manzana y las calles de alrededor.
export const ZOOM_DE_UN_PUNTO = 16;

const coordenada = (agente) => `${Number(agente.lat).toFixed(6)},${Number(agente.lng).toFixed(6)}`;

// Lima y Callao con margen, los mismos límites que usa la base al deducir
// domicilios. Un punto fuera —un 0,0 guardado es el golfo de Guinea— no tiene
// camino por carretera, y Google entonces no dibuja la ruta entera.
const EN_LIMA = { latMin: -13.2, latMax: -11.0, lngMin: -77.6, lngMax: -76.3 };

const enLima = (a) => {
  const lat = Number(a.lat);
  const lng = Number(a.lng);
  return lat >= EN_LIMA.latMin && lat <= EN_LIMA.latMax && lng >= EN_LIMA.lngMin && lng <= EN_LIMA.lngMax;
};

/** Los agentes que tienen punto en Lima, en el orden del servicio. */
export const paradasConPunto = (agentes) =>
  (agentes || []).filter((a) => hasCoordinate(a?.lat) && hasCoordinate(a?.lng) && enLima(a));

/** La URL del visor para esos agentes, o `null` si ninguno tiene punto. */
export const urlDelMapa = (agentes) => {
  const paradas = paradasConPunto(agentes).map(coordenada);
  if (paradas.length === 0) return null;
  if (paradas.length === 1) {
    return `${VISOR}?q=${paradas[0]}&z=${ZOOM_DE_UN_PUNTO}&hl=es&output=embed`;
  }
  // `+to:` separa las paradas y va tal cual: Google lo lee como «y después a».
  const [origen, ...resto] = paradas;
  return `${VISOR}?saddr=${origen}&daddr=${resto.join('+to:')}&hl=es&output=embed`;
};

/** La misma ruta, para abrirla en Google Maps (la web o la app del celular). */
export const urlParaAbrir = (agentes) => {
  const paradas = paradasConPunto(agentes).map(coordenada);
  if (paradas.length === 0) return null;
  if (paradas.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${paradas[0]}`;
  }
  return `https://www.google.com/maps/dir/${paradas.join('/')}`;
};
