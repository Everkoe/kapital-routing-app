import {
  Building2, CalendarDays, ChevronLeft, CircleCheck, CircleX, Info, MapPin, Navigation,
  TriangleAlert, Undo2, Users,
} from 'lucide-react';
import {
  avisoDeUbicacion, enlacesDeNavegacion, esRecojo, horaDeLima, inicioDeMarcado, nombreDeSede,
  nombreDelDia, objetivoDelServicio, progresoDelServicio, sePuedeMarcar, ESTADOS_DE_VIAJE,
} from './modeloServicios';

export const BarraDeProgreso = ({ servicio }) => {
  const { total, aBordo, noSePresento, porMarcar } = progresoDelServicio(servicio);
  if (!total) return null;
  const partes = [
    aBordo && `${aBordo} a bordo`,
    noSePresento && `${noSePresento} no se ${noSePresento === 1 ? 'presentó' : 'presentaron'}`,
    porMarcar && `${porMarcar} por marcar`,
  ].filter(Boolean);
  return (
    <div className="cd-progreso">
      <div className="cd-progreso-barra" aria-hidden="true">
        <i className="cd-a-bordo" style={{ width: `${(aBordo / total) * 100}%` }} />
        <i className="cd-ausente" style={{ width: `${(noSePresento / total) * 100}%` }} />
      </div>
      <div className="cd-progreso-texto">{partes.join(' · ')}</div>
    </div>
  );
};

const Sede = ({ servicio }) => (
  <li className="cd-sede">
    <Building2 size={22} />
    <div>
      {nombreDeSede(servicio.sede)}
      <small>{esRecojo(servicio) ? `Destino · entrada a las ${servicio.turno}` : `Punto de partida · sale a las ${servicio.turno}`}</small>
    </div>
  </li>
);

export const EnlacesDeNavegacion = ({ pasajero, grande = false }) => {
  const enlaces = enlacesDeNavegacion(pasajero);
  const clase = `cd-boton cd-boton--azul${grande ? ' cd-boton--grande' : ''}`;
  return (
    <>
      <a className={clase} href={enlaces.googleMaps} target="_blank" rel="noopener noreferrer">
        <Navigation size={18} /> Cómo llegar
      </a>
      <a className={`cd-boton${grande ? ' cd-boton--grande' : ''}`} href={enlaces.waze} target="_blank" rel="noopener noreferrer">
        Waze
      </a>
    </>
  );
};

const Parada = ({ pasajero, numero, esSiguiente, puedeMarcar, ocupado, onMarcar }) => {
  const marca = pasajero.viaje;
  const aviso = avisoDeUbicacion(pasajero);
  const claseNumero = marca === ESTADOS_DE_VIAJE.A_BORDO
    ? 'cd-numero cd-numero--verde'
    : marca === ESTADOS_DE_VIAJE.NO_SE_PRESENTO ? 'cd-numero cd-numero--ambar' : 'cd-numero';
  const clase = ['cd-parada', esSiguiente && 'cd-parada--siguiente', marca && 'cd-parada--hecha']
    .filter(Boolean).join(' ');

  return (
    <li className={clase}>
      <span className={claseNumero} aria-label={`Parada ${numero}`}>
        {marca === ESTADOS_DE_VIAJE.A_BORDO && <CircleCheck size={20} />}
        {marca === ESTADOS_DE_VIAJE.NO_SE_PRESENTO && <CircleX size={20} />}
        {!marca && numero}
      </span>
      <div>
        <p className="cd-parada-nombre">{pasajero.nombre}</p>
        <p className="cd-parada-direccion">
          {[pasajero.direccion, pasajero.distrito].filter(Boolean).join(' · ') || 'Sin dirección registrada'}
        </p>
        {aviso && <p className="cd-parada-alerta"><TriangleAlert size={14} /> {aviso}</p>}
      </div>

      {/* Los botones ocupan todo el ancho de la tarjeta, no solo la columna del
          nombre: en un teléfono de 375 px, «No se presentó» no cabía en una línea. */}
      <div className="cd-parada-botones">
        {marca ? (
          <div className="cd-marca">
            <span className={`cd-etiqueta ${marca === ESTADOS_DE_VIAJE.A_BORDO ? 'cd-etiqueta--verde' : 'cd-etiqueta--ambar'}`}>
              {marca === ESTADOS_DE_VIAJE.A_BORDO ? 'A bordo' : 'No se presentó'}
              {pasajero.marcado_en && ` · ${horaDeLima(pasajero.marcado_en)}`}
            </span>
            {puedeMarcar && (
              <button type="button" className="cd-deshacer" disabled={ocupado} onClick={() => onMarcar(pasajero, null)}>
                <Undo2 size={16} /> Deshacer
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="cd-acciones">
              <EnlacesDeNavegacion pasajero={pasajero} />
            </div>
            {puedeMarcar && (
              <div className="cd-acciones">
                <button type="button" className="cd-boton cd-boton--ambar" disabled={ocupado}
                        onClick={() => onMarcar(pasajero, ESTADOS_DE_VIAJE.NO_SE_PRESENTO)}>
                  <CircleX size={18} /> No se presentó
                </button>
                <button type="button" className="cd-boton cd-boton--verde" disabled={ocupado}
                        onClick={() => onMarcar(pasajero, ESTADOS_DE_VIAJE.A_BORDO)}>
                  <CircleCheck size={18} /> A bordo
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
};

const AvisoDeMarcado = ({ servicio, ahora }) => {
  if (sePuedeMarcar(servicio, ahora)) return null;
  const inicio = inicioDeMarcado(servicio);
  if (ahora < inicio) {
    return (
      <div className="cd-aviso">
        <Info size={18} />
        <span>Podrás marcar a los pasajeros desde las {horaDeLima(inicio.toISOString())}.</span>
      </div>
    );
  }
  return (
    <div className="cd-aviso">
      <Info size={18} />
      <span>Este servicio ya pasó y no admite más marcas.</span>
    </div>
  );
};

const DetalleServicio = ({ servicio, hoy, ahora, ocupados, onVolver, onMarcar }) => {
  const dia = nombreDelDia(servicio.fecha, hoy);
  const puedeMarcar = sePuedeMarcar(servicio, ahora);
  const pasajeros = servicio.pasajeros || [];
  const siguiente = pasajeros.find((p) => !p.viaje);

  return (
    <section aria-label="Detalle del servicio">
      <button type="button" className="cd-volver" onClick={onVolver}>
        <ChevronLeft size={20} /> Mis servicios
      </button>
      <h1 className="cd-detalle-titulo">
        <strong>{servicio.turno}</strong>
        <span>{esRecojo(servicio) ? 'Recojo' : 'Salida'}</span>
      </h1>
      <p className="cd-detalle-objetivo">{objetivoDelServicio(servicio)}</p>
      <div className="cd-datos" style={{ marginBottom: 14 }}>
        <span><CalendarDays size={15} /> {dia.titulo === dia.fecha ? dia.fecha : `${dia.titulo}, ${dia.fecha}`}</span>
        <span><Users size={15} /> {pasajeros.length} {pasajeros.length === 1 ? 'pasajero' : 'pasajeros'}</span>
        {servicio.cobertura && <span><MapPin size={15} /> {servicio.cobertura}</span>}
      </div>

      {servicio.ya_no_viajan?.length > 0 && (
        <div className="cd-aviso cd-aviso--ambar">
          <TriangleAlert size={18} />
          <span>
            <strong>Ya no van en este servicio</strong>
            {servicio.ya_no_viajan.join(', ')}. No hace falta ir a buscarles.
          </span>
        </div>
      )}
      <AvisoDeMarcado servicio={servicio} ahora={ahora} />

      {pasajeros.length > 0 && (
        <div className="cd-tarjeta">
          <BarraDeProgreso servicio={servicio} />
        </div>
      )}

      {pasajeros.length === 0 ? (
        <div className="cd-vacio">
          <Users size={28} />
          <strong>No queda nadie en este servicio</strong>
          El Programador lo dejó sin pasajeros.
        </div>
      ) : (
        <ol className="cd-paradas">
          {!esRecojo(servicio) && <Sede servicio={servicio} />}
          {pasajeros.map((pasajero, indice) => (
            <Parada
              key={pasajero.id}
              pasajero={pasajero}
              numero={indice + 1}
              esSiguiente={puedeMarcar && pasajero === siguiente}
              puedeMarcar={puedeMarcar}
              ocupado={ocupados.has(pasajero.id)}
              onMarcar={onMarcar}
            />
          ))}
          {esRecojo(servicio) && <Sede servicio={servicio} />}
        </ol>
      )}
    </section>
  );
};

export default DetalleServicio;
