import { useMemo } from 'react';
import { ExternalLink, MapPinOff } from 'lucide-react';
import { paradasConPunto, urlDelMapa, urlParaAbrir } from '../model/mapaDeGoogle.js';

/**
 * Los domicilios de un servicio sobre el mapa de Google.
 *
 * **Solo se dibuja lo que se sabe.** El domicilio de cada pasajero no viene
 * del archivo: lo deduce la base a partir del GPS de sus recojos, y hoy lo
 * consigue para 811 de 1.163 personas. Quien no tiene punto no se pinta en
 * ningún sitio aproximado —se cuenta aparte, bajo el mapa—, porque una
 * coordenada inventada que no se anuncia es peor que un hueco: manda a un
 * vehículo a una casa que no existe.
 *
 * Con dos o más domicilios, Google traza el camino real pasando por ellos en
 * el orden del servicio (ver `mapaDeGoogle.js`, que explica por qué es el
 * visor incrustado, sin clave, y no el mapa de Google con JavaScript). Empieza
 * en el primer domicilio: no incluye el garaje ni la sede.
 */
const ServiceMap = ({ agentes = [], titulo, plan = false }) => {
  const url = useMemo(() => urlDelMapa(agentes), [agentes]);
  const ubicados = paradasConPunto(agentes).length;
  const sinUbicar = agentes.length - ubicados;

  if (!url) {
    return (
      <div className="pw-map-vacio">
        <MapPinOff size={22} aria-hidden="true" />
        <p>
          {agentes.length === 1
            ? 'El agente de este servicio no tiene el domicilio resuelto todavía,'
            : `Ninguno de los ${agentes.length} agentes de este servicio tiene el domicilio resuelto todavía,`}
          {' así que no hay nada que situar.'}
        </p>
      </div>
    );
  }

  return (
    <div className="pw-map">
      {/* `key`: el visor no recarga si solo cambia la dirección del iframe. */}
      <iframe key={url} src={url} className="pw-map-google" loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        title={`Domicilios del servicio ${titulo || ''} en Google Maps`} />

      <p className="pw-map-nota">
        {ubicados > 1
          ? (plan
            ? 'Google calcula el camino pasando por los domicilios en el orden de la programación, desde el primero.'
            : 'Google calcula el camino pasando por los domicilios en el orden del histórico, desde el primero.')
          : 'El domicilio del único agente con ubicación.'}
        {sinUbicar > 0 && (
          <> <strong>{sinUbicar} agente(s) no aparecen</strong> porque su domicilio
            aún no está resuelto.
          </>
        )}
        {' '}
        <a className="pw-map-abrir" href={urlParaAbrir(agentes)} target="_blank" rel="noopener noreferrer">
          Abrir en Google Maps <ExternalLink size={12} aria-hidden="true" />
        </a>
      </p>
    </div>
  );
};

export default ServiceMap;
