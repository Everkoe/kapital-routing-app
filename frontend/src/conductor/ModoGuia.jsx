import { CircleCheck, CircleX, MapPin, TriangleAlert, Undo2, X } from 'lucide-react';
import { EnlacesDeNavegacion, BarraDeProgreso } from './DetalleServicio';
import {
  avisoDeUbicacion, esRecojo, nombreDeSede, progresoDelServicio, ESTADOS_DE_VIAJE,
} from './modeloServicios';

/**
 * Una parada cada vez, en letra grande: es lo que se mira con el coche parado
 * delante de una puerta. El último marcado se puede deshacer desde aquí mismo,
 * porque un toque equivocado se nota justo después, no tres paradas más tarde.
 */
const ModoGuia = ({ servicio, ocupados, onSalir, onMarcar }) => {
  const pasajeros = servicio.pasajeros || [];
  const indice = pasajeros.findIndex((p) => !p.viaje);
  const actual = indice >= 0 ? pasajeros[indice] : null;
  const siguiente = indice >= 0 ? pasajeros.slice(indice + 1).find((p) => !p.viaje) : null;
  const instante = (p) => Date.parse(p.marcado_en || '') || 0;
  const ultimoMarcado = pasajeros
    .filter((p) => p.viaje)
    .reduce((ultimo, p) => (!ultimo || instante(p) >= instante(ultimo) ? p : ultimo), null);
  const { aBordo, total } = progresoDelServicio(servicio);

  const cabecera = (
    <div className="cd-guia-cabecera">
      <span className="cd-guia-paso">
        {actual ? `Parada ${indice + 1} de ${total}` : 'Servicio completo'}
      </span>
      <button type="button" className="cd-boton" onClick={onSalir}>
        <X size={18} /> Salir
      </button>
    </div>
  );

  if (!actual) {
    return (
      <section className="cd-guia" aria-label="Modo guía">
        {cabecera}
        <div className="cd-completado">
          <CircleCheck size={64} />
          <h2>Todos marcados</h2>
          <p className="cd-subtitulo">
            {aBordo} de {total} a bordo.{' '}
            {esRecojo(servicio)
              ? `Siguiente: llegar a ${nombreDeSede(servicio.sede)} antes de las ${servicio.turno}.`
              : 'Servicio terminado.'}
          </p>
        </div>
        <button type="button" className="cd-boton cd-boton--azul cd-boton--grande cd-boton--ancho" onClick={onSalir}>
          Volver al servicio
        </button>
      </section>
    );
  }

  const aviso = avisoDeUbicacion(actual);
  const ocupado = ocupados.has(actual.id);

  return (
    <section className="cd-guia" aria-label="Modo guía">
      {cabecera}
      <BarraDeProgreso servicio={servicio} />

      <div className="cd-guia-tarjeta">
        <h1 className="cd-guia-nombre">{actual.nombre}</h1>
        <p className="cd-guia-direccion">
          <MapPin size={22} />
          <span>{[actual.direccion, actual.distrito].filter(Boolean).join(' · ') || 'Sin dirección registrada'}</span>
        </p>
        {aviso && <p className="cd-parada-alerta"><TriangleAlert size={14} /> {aviso}</p>}
        <div className="cd-acciones" style={{ marginTop: 16 }}>
          <EnlacesDeNavegacion pasajero={actual} grande />
        </div>
      </div>

      <button type="button" className="cd-boton cd-boton--verde cd-boton--grande cd-boton--ancho" disabled={ocupado}
              onClick={() => onMarcar(actual, ESTADOS_DE_VIAJE.A_BORDO)}>
        <CircleCheck size={24} /> A bordo
      </button>
      <button type="button" className="cd-boton cd-boton--ambar cd-boton--ancho" disabled={ocupado}
              onClick={() => onMarcar(actual, ESTADOS_DE_VIAJE.NO_SE_PRESENTO)}>
        <CircleX size={20} /> No se presentó
      </button>

      {siguiente && <p className="cd-guia-siguiente">Después: {siguiente.nombre}</p>}
      {ultimoMarcado && (
        <button type="button" className="cd-deshacer" disabled={ocupados.has(ultimoMarcado.id)}
                onClick={() => onMarcar(ultimoMarcado, null)}>
          <Undo2 size={16} /> Deshacer {ultimoMarcado.nombre} ({ultimoMarcado.viaje === ESTADOS_DE_VIAJE.A_BORDO ? 'a bordo' : 'no se presentó'})
        </button>
      )}
    </section>
  );
};

export default ModoGuia;
