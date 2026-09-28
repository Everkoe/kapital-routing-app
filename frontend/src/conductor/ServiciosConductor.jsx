import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarDays, ChevronRight, CircleCheck, MapPin, Navigation, RefreshCw, Route, TriangleAlert, Users,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { apiFetch } from '../utils/apiClient';
import BotonEmergencia from './BotonEmergencia';
import DetalleServicio, { BarraDeProgreso } from './DetalleServicio';
import ModoGuia from './ModoGuia';
import {
  claveDelServicio, conMarca, esRecojo, estadoDelServicio, horaDeLima, nombreDelDia,
  objetivoDelServicio, progresoDelServicio, proximoServicio, sePuedeMarcar, serviciosDelDia,
  superponerMarcas,
} from './modeloServicios';
import './conductor.css';

// El plan puede cambiar mientras el conductor trabaja (una baja de última
// hora): se relee cada pocos minutos con la pantalla visible, y al volver a ella.
const REFRESCO_MS = 3 * 60_000;
const REFRESCO_AL_VOLVER_MS = 60_000;
// Cada minuto cambia qué servicio está en curso y cuál se puede marcar.
const RELOJ_MS = 60_000;

const ETIQUETAS = {
  en_curso: { texto: 'En curso', clase: 'cd-etiqueta--verde' },
  proximo: { texto: 'Próximo', clase: '' },
  sin_cerrar: { texto: 'Sin cerrar', clase: 'cd-etiqueta--ambar' },
  terminado: { texto: 'Hecho', clase: 'cd-etiqueta--gris' },
  vencido: { texto: 'Pasado', clase: 'cd-etiqueta--gris' },
};

const Etiqueta = ({ estado }) => {
  const etiqueta = ETIQUETAS[estado] || ETIQUETAS.proximo;
  return <span className={`cd-etiqueta ${etiqueta.clase}`}>{etiqueta.texto}</span>;
};

const TarjetaDestacada = ({ servicio, hoy, ahora, onAbrir }) => {
  const estado = estadoDelServicio(servicio, ahora);
  const dia = nombreDelDia(servicio.fecha, hoy);
  const { total } = progresoDelServicio(servicio);
  const enCurso = estado === 'en_curso';
  return (
    <button type="button" className={`cd-destacado${enCurso ? ' cd-destacado--en-curso' : ''}`} onClick={onAbrir}>
      <Etiqueta estado={estado} />
      <div className="cd-destacado-hora">
        <strong>{servicio.turno}</strong>
        <span>{esRecojo(servicio) ? 'Recojo' : 'Salida'} · {dia.titulo}</span>
      </div>
      <p className="cd-destacado-objetivo">{objetivoDelServicio(servicio)}</p>
      <div className="cd-datos">
        <span><Users size={15} /> {total} {total === 1 ? 'pasajero' : 'pasajeros'}</span>
        {servicio.cobertura && <span><MapPin size={15} /> {servicio.cobertura}</span>}
      </div>
      {enCurso && <BarraDeProgreso servicio={servicio} />}
      <span className="cd-destacado-accion">
        {enCurso ? <Navigation size={20} /> : <Route size={20} />}
        {enCurso ? 'Continuar el servicio' : 'Ver pasajeros y recorrido'}
      </span>
    </button>
  );
};

const FilaServicio = ({ servicio, ahora, onAbrir }) => {
  const estado = estadoDelServicio(servicio, ahora);
  const { total, marcados } = progresoDelServicio(servicio);
  const apagado = estado === 'terminado' || estado === 'vencido';
  return (
    <li>
      <button type="button" className={`cd-servicio${apagado ? ' cd-servicio--apagado' : ''}`} onClick={onAbrir}>
        <span className="cd-servicio-hora">
          <strong>{servicio.turno}</strong>
          <span>{esRecojo(servicio) ? 'Recojo' : 'Salida'}</span>
        </span>
        <span className="cd-servicio-cuerpo">
          <p>{objetivoDelServicio(servicio).replace(/ a las \d{2}:\d{2}$/, '')}</p>
          <span className="cd-datos">
            <span><Users size={14} /> {marcados > 0 ? `${marcados}/${total}` : total}</span>
            {servicio.cobertura && <span><MapPin size={14} /> {servicio.cobertura}</span>}
            <Etiqueta estado={estado} />
          </span>
        </span>
        <ChevronRight size={22} />
      </button>
    </li>
  );
};

const DiaSinServicios = ({ hayPlan }) => (
  <div className="cd-vacio">
    <CalendarDays size={28} />
    {hayPlan ? (
      <>
        <strong>No tienes servicios este día</strong>
        Si cambia, aparecerá aquí.
      </>
    ) : (
      <>
        <strong>Todavía no hay programación para este día</strong>
        Cuando el Programador la prepare, aparecerá aquí.
      </>
    )}
  </div>
);

/** Lee y mantiene al día los servicios del conductor, y guarda sus marcas. */
const useServicios = () => {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [ocupados, setOcupados] = useState(() => new Set());
  const ultimaCarga = useRef(0);
  const enVuelo = useRef(null);
  // Las marcas hechas desde esta pantalla, por pasajero. Una lectura que salió
  // antes de guardarse una marca y llega después traería el estado anterior y
  // la borraría: en el modo guía, devolvía al conductor a esa parada.
  const escritas = useRef(new Map());

  // Lee sin tocar el estado hasta tener respuesta: la primera carga y la
  // periódica no enseñan el indicador; solo el botón «Actualizar» (`refrescar`).
  const cargar = useCallback(async () => {
    enVuelo.current?.abort();
    const control = new AbortController();
    enVuelo.current = control;
    const salida = Date.now();
    try {
      const respuesta = await apiFetch('/api/conductor/servicios', { signal: control.signal });
      const { servicios: leidos, vigentes } = superponerMarcas(respuesta?.servicios, escritas.current, salida);
      [...escritas.current.keys()].forEach((id) => {
        if (!vigentes.includes(id)) escritas.current.delete(id);
      });
      setDatos({ ...respuesta, servicios: leidos, leidoEn: new Date().toISOString() });
      setError(null);
      ultimaCarga.current = Date.now();
    } catch (fallo) {
      if (fallo?.name !== 'AbortError') setError(fallo);
    } finally {
      if (enVuelo.current === control) {
        enVuelo.current = null;
        setCargando(false);
      }
    }
  }, []);

  useEffect(() => {
    // La primera lectura va en un temporizador, como las siguientes: así el
    // efecto solo se suscribe y el estado cambia siempre desde un callback.
    const primera = setTimeout(cargar, 0);
    const intervalo = setInterval(() => {
      if (!document.hidden) cargar();
    }, REFRESCO_MS);
    const alVolver = () => {
      if (!document.hidden && Date.now() - ultimaCarga.current > REFRESCO_AL_VOLVER_MS) cargar();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearTimeout(primera);
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
      enVuelo.current?.abort();
    };
  }, [cargar]);

  const cambiarServicios = (cambio) =>
    setDatos((anterior) => (anterior ? { ...anterior, servicios: cambio(anterior.servicios) } : anterior));

  const marcar = async (pasajero, viaje) => {
    const antes = { viaje: pasajero.viaje, marcadoEn: pasajero.marcado_en };
    const provisional = new Date().toISOString();
    setOcupados((actual) => new Set(actual).add(pasajero.id));
    escritas.current.set(pasajero.id, { viaje, marcadoEn: provisional, pendiente: true, escritaEn: Date.now() });
    // Se enseña al momento: con mala cobertura, esperar la respuesta para cada
    // toque haría dudar de si se marcó.
    cambiarServicios((servicios) => conMarca(servicios, pasajero.id, viaje, provisional));
    try {
      const guardado = await apiFetch('/api/conductor/servicios/marcar', {
        method: 'POST',
        json: { id: pasajero.id, estado: viaje },
      });
      const final = guardado ? guardado.viaje ?? null : viaje;
      escritas.current.set(pasajero.id, {
        viaje: final, marcadoEn: guardado?.marcado_en ?? null, pendiente: false, escritaEn: Date.now(),
      });
      cambiarServicios((servicios) => conMarca(servicios, pasajero.id, final, guardado?.marcado_en));
    } catch (fallo) {
      escritas.current.delete(pasajero.id);
      cambiarServicios((servicios) => conMarca(servicios, pasajero.id, antes.viaje, antes.marcadoEn));
      const sinConexion = fallo?.status === undefined;
      toast.error(sinConexion
        ? 'Sin conexión: no se guardó. Vuelve a intentarlo.'
        : (fallo?.message || 'No se pudo guardar.'));
      // Lo de antes puede estar viejo (otra pestaña, otra marca): se relee lo
      // que dice la base, salvo sin conexión, que no traería nada.
      if (!sinConexion) cargar();
    } finally {
      setOcupados((actual) => {
        const siguiente = new Set(actual);
        siguiente.delete(pasajero.id);
        return siguiente;
      });
    }
  };

  const refrescar = () => {
    setCargando(true);
    cargar();
  };

  return { datos, error, cargando, ocupados, refrescar, marcar };
};

/** Qué pantalla se ve, con el botón «atrás» del teléfono funcionando. */
const useVista = () => {
  // Se empieza siempre por la lista: lo que haya quedado en el historial es de
  // una visita anterior (volver del perfil, u otra cuenta en la misma pestaña).
  const [vista, setVista] = useState({ tipo: 'lista' });

  useEffect(() => {
    if (window.history.state?.kapitalConductor) {
      const limpio = { ...window.history.state };
      delete limpio.kapitalConductor;
      window.history.replaceState(limpio, '');
    }
    const alVolver = (evento) => setVista(evento.state?.kapitalConductor || { tipo: 'lista' });
    window.addEventListener('popstate', alVolver);
    return () => window.removeEventListener('popstate', alVolver);
  }, []);

  const ir = (nueva) => {
    window.history.pushState({ ...(window.history.state || {}), kapitalConductor: nueva }, '');
    setVista(nueva);
    window.scrollTo(0, 0);
  };
  const volver = () => {
    if (window.history.state?.kapitalConductor) window.history.back();
    else setVista({ tipo: 'lista' });
  };
  return { vista, ir, volver };
};

const ServiciosConductor = ({ usuario, avisos = null }) => {
  const { datos, error, cargando, ocupados, refrescar, marcar } = useServicios();
  const { vista, ir, volver } = useVista();
  const [ahora, setAhora] = useState(() => new Date());
  const [diaElegido, setDiaElegido] = useState(null);

  useEffect(() => {
    const reloj = setInterval(() => setAhora(new Date()), RELOJ_MS);
    return () => clearInterval(reloj);
  }, []);

  const servicios = datos?.servicios || [];
  const hoy = datos?.hoy;
  const proximo = proximoServicio(servicios, ahora);
  const abierto = vista.tipo !== 'lista'
    ? servicios.find((s) => claveDelServicio(s) === vista.clave) || null
    : null;
  const unidad = datos?.unidad || usuario?.unidad_id || '';

  if (!datos && !error) {
    return <main className="cd-portal"><div className="cd-vacio">Cargando tus servicios…</div></main>;
  }

  // La emergencia está siempre al alcance del pulgar; al lado, la acción de la
  // pantalla si la hay.
  const barraInferior = (accion) => (
    <div className="cd-barra-inferior">
      <div className={`cd-barra-inferior-contenido${accion ? '' : ' cd-barra-inferior-contenido--sola'}`}>
        <BotonEmergencia usuario={usuario} unidad={unidad} servicio={abierto || proximo} conTexto={!accion} />
        {accion}
      </div>
    </div>
  );

  if (abierto && vista.tipo === 'guia') {
    return (
      <main className="cd-portal">
        <ModoGuia servicio={abierto} ocupados={ocupados} onSalir={volver} onMarcar={marcar} />
        {barraInferior(null)}
      </main>
    );
  }

  if (abierto) {
    const puedeGuiar = sePuedeMarcar(abierto, ahora) && progresoDelServicio(abierto).porMarcar > 0;
    return (
      <main className="cd-portal">
        <DetalleServicio servicio={abierto} hoy={hoy} ahora={ahora} ocupados={ocupados}
                         onVolver={volver} onMarcar={marcar} />
        {barraInferior(puedeGuiar && (
          <button type="button" className="cd-boton cd-boton--verde"
                  onClick={() => ir({ tipo: 'guia', clave: claveDelServicio(abierto) })}>
            <Navigation size={20} /> Modo guía
          </button>
        ))}
      </main>
    );
  }

  const dias = datos?.dias || [];
  // Pasada la medianoche, el día elegido puede haber salido de las pestañas.
  const diaActivo = diaElegido && dias.includes(diaElegido)
    ? diaElegido
    : (proximo && dias.includes(proximo.fecha) ? proximo.fecha : hoy);
  const delDia = serviciosDelDia(servicios, diaActivo);
  const sinCerrar = servicios.filter((s) => estadoDelServicio(s, ahora) === 'sin_cerrar');

  return (
    <main className="cd-portal">
      <header className="cd-cabecera">
        <div>
          <h1 className="cd-saludo">Mis servicios</h1>
          <p className="cd-subtitulo">
            {unidad && <span className="cd-unidad">{unidad}</span>}
            {datos?.leidoEn && ` Actualizado ${horaDeLima(datos.leidoEn)}`}
          </p>
        </div>
        <button type="button" className="cd-boton-icono" onClick={refrescar} disabled={cargando}
                aria-label="Actualizar">
          <RefreshCw size={20} className={cargando ? 'cd-girando' : ''} />
        </button>
      </header>

      {error && (
        <div className="cd-aviso cd-aviso--rojo">
          <TriangleAlert size={18} />
          <span>
            <strong>{datos ? 'No se pudo actualizar' : 'No se pudieron cargar tus servicios'}</strong>
            {error.message || 'Revisa tu conexión.'}
            {datos?.leidoEn && ` Lo que ves es de las ${horaDeLima(datos.leidoEn)}.`}
          </span>
        </div>
      )}
      {vista.tipo !== 'lista' && !abierto && datos && (
        <div className="cd-aviso cd-aviso--ambar">
          <TriangleAlert size={18} />
          <span>Ese servicio ya no está en tu programación.</span>
        </div>
      )}
      {avisos}
      {sinCerrar.map((s) => (
        <button key={claveDelServicio(s)} type="button" className="cd-aviso cd-aviso--ambar cd-boton--ancho"
                style={{ border: 'none', cursor: 'pointer', textAlign: 'left' }}
                onClick={() => ir({ tipo: 'detalle', clave: claveDelServicio(s) })}>
          <TriangleAlert size={18} />
          <span>
            <strong>Quedan pasajeros sin marcar</strong>
            {progresoDelServicio(s).porMarcar} en el servicio de las {s.turno}. Toca para marcarlos.
          </span>
        </button>
      ))}

      {proximo && (
        <TarjetaDestacada servicio={proximo} hoy={hoy} ahora={ahora}
                          onAbrir={() => ir({ tipo: 'detalle', clave: claveDelServicio(proximo) })} />
      )}

      {datos && (
        <>
          <div className="cd-pestanas" role="tablist">
            {dias.map((dia) => {
              const nombre = nombreDelDia(dia, hoy);
              const cuantos = serviciosDelDia(servicios, dia).length;
              return (
                <button key={dia} type="button" role="tab" aria-selected={dia === diaActivo}
                        className={`cd-pestana${dia === diaActivo ? ' cd-pestana--activa' : ''}`}
                        onClick={() => setDiaElegido(dia)}>
                  {nombre.titulo}{cuantos > 0 && ` (${cuantos})`}
                  <small>{nombre.fecha}</small>
                </button>
              );
            })}
          </div>

          {delDia.length === 0 ? (
            <DiaSinServicios hayPlan={(datos.dias_con_plan || []).includes(diaActivo)} />
          ) : (
            <ul className="cd-lista">
              {delDia.map((s) => (
                <FilaServicio key={claveDelServicio(s)} servicio={s} ahora={ahora}
                              onAbrir={() => ir({ tipo: 'detalle', clave: claveDelServicio(s) })} />
              ))}
            </ul>
          )}
          {delDia.length > 0 && delDia.every((s) => estadoDelServicio(s, ahora) === 'terminado') && (
            <p className="cd-subtitulo" style={{ marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <CircleCheck size={16} /> Todos los servicios de este día están marcados.
            </p>
          )}
        </>
      )}

      {barraInferior(null)}
    </main>
  );
};

export default ServiciosConductor;
