import { Navigation, Repeat, Route, Users } from 'lucide-react';

/**
 * Un servicio donde podría ir alguien, con por qué: su zona, su unidad
 * habitual, cuánto se alarga el recorrido y cuántas plazas deja.
 *
 * Lo usan la propuesta de cada pendiente («Asignar aquí») y el diálogo de
 * mover a alguien de servicio («Mover aquí»): las dos eligen entre las mismas
 * opciones del motor de inserción y tienen que decirlo igual.
 */

const km = (valor) => `${valor.toLocaleString('es-PE', { maximumFractionDigits: 1 })} km`;

// «quedarían 5 de 10» se leía como cinco ocupadas: se dice «libres».
const textoPlazas = ({ plazas, libresTras }) => {
  if (plazas.total === null) return 'capacidad desconocida';
  let base;
  if (libresTras === 0) base = `se llena (${plazas.total} de ${plazas.total})`;
  else if (libresTras === 1) base = `1 libre de ${plazas.total}`;
  else base = `${libresTras} libres de ${plazas.total}`;
  return plazas.fuente === 'observada' ? `${base}, según lo que ha llevado` : base;
};

const OpcionServicio = ({ candidato, principal = false, ocupado, etiqueta, onElegir }) => {
  const { service } = candidato;
  return (
    <div className="pw-opcion" data-principal={principal || undefined}>
      <div className="pw-opcion-linea">
        <strong className="pw-mono">{service.conductor}</strong>
        <span>{service.microZona}</span>
        <span className="pw-muted">{service.horario}</span>
      </div>
      <div className="pw-opcion-motivos">
        {candidato.mismaZona && (
          <span className="pw-tag"><Route size={11} aria-hidden="true" />Su zona</span>
        )}
        {candidato.habitual && (
          <span className="pw-tag"><Repeat size={11} aria-hidden="true" />Su unidad habitual</span>
        )}
        {candidato.desvioKm !== null && (
          <span className="pw-tag pw-tag-quiet"
            title="Lo que se alarga el recorrido para recogerlo, en línea recta.">
            <Navigation size={11} aria-hidden="true" />+{km(candidato.desvioKm)}
          </span>
        )}
        <span className="pw-tag pw-tag-quiet"
          title={candidato.plazas.fuente === 'observada'
            ? 'La flota no declara capacidad para esta unidad: es lo más que ha llevado en un servicio.'
            : undefined}>
          <Users size={11} aria-hidden="true" />{textoPlazas(candidato)}
        </span>
      </div>
      <button type="button" className={`pw-btn pw-btn-sm${principal ? ' pw-btn-primary' : ''}`}
        disabled={ocupado} onClick={onElegir}>
        {etiqueta}
      </button>
    </div>
  );
};

export default OpcionServicio;
