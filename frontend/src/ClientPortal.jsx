import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bus, ChevronDown, ChevronUp, CircleCheck, CircleX, Clock, LogOut, MapPin, Moon, RefreshCw, Search,
  Sun, TriangleAlert, UserX, Users,
} from 'lucide-react';
import { apiFetch } from './utils/apiClient';
import { horaDeLima, nombreDelDia, sumarDias } from './conductor/modeloServicios';
import {
  agruparPorTurno, descripcionDelVehiculo, esRecojo, estadoDePersona, filtrarServicios,
  nombreCortoDeSede, resumenDelDia, sedesDelDia, ETIQUETAS_DE_ESTADO,
} from './cliente/modeloCliente';
import './cliente/cliente.css';

// Se relee cada dos minutos con la pestaña visible, sea cual sea el día: hoy
// es cuando los conductores marcan, mañana el Programador sigue ajustando el
// plan, y un «mañana» que se deja abierto pasa a ser hoy a medianoche.
const REFRESCO_MS = 2 * 60_000;
// Lo que deja consultar el backend (DIAS_ATRAS_CLIENTE y DIAS_PROGRAMABLES).
const DIAS_ATRAS = 31;
const DIAS_ADELANTE = 13;

const MODALIDADES = [
  { valor: '', texto: 'Todo' },
  { valor: 'RECOJO', texto: 'Recojos' },
  { valor: 'SALIDA', texto: 'Salidas' },
];

/** Lee el día pedido, o hoy si no se pide ninguno, y lo relee mientras se mira. */
const useServiciosDelCliente = (fecha) => {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  const enVuelo = useRef(null);

  const cargar = useCallback(async () => {
    enVuelo.current?.abort();
    const control = new AbortController();
    enVuelo.current = control;
    try {
      const consulta = fecha ? `?fecha=${encodeURIComponent(fecha)}` : '';
      const respuesta = await apiFetch(`/api/cliente/servicios${consulta}`, { signal: control.signal });
      setDatos({ ...respuesta, leidoEn: new Date().toISOString() });
      setError(null);
    } catch (fallo) {
      if (fallo?.name !== 'AbortError') setError(fallo);
    } finally {
      if (enVuelo.current === control) {
        enVuelo.current = null;
        setCargando(false);
      }
    }
  }, [fecha]);

  useEffect(() => {
    // Primera lectura en un temporizador: el efecto solo se suscribe.
    const primera = setTimeout(cargar, 0);
    const intervalo = setInterval(() => {
      if (!document.hidden) cargar();
    }, REFRESCO_MS);
    return () => {
      clearTimeout(primera);
      clearInterval(intervalo);
      enVuelo.current?.abort();
    };
  }, [cargar, fecha]);

  const refrescar = () => {
    setCargando(true);
    cargar();
  };

  return { datos, error, cargando, refrescar };
};

const SelectorDeDia = ({ hoy, fecha, onElegir }) => {
  if (!hoy) return null;
  const dias = [sumarDias(hoy, -1), hoy, sumarDias(hoy, 1)];
  return (
    <div className="cl-dias">
      <div className="cl-segmentos" role="tablist" aria-label="Día">
        {dias.map((dia) => {
          const nombre = nombreDelDia(dia, hoy);
          return (
            <button key={dia} type="button" role="tab" aria-selected={dia === fecha}
                    className={`cl-segmento${dia === fecha ? ' cl-segmento--activo' : ''}`}
                    onClick={() => onElegir(dia)}>
              {nombre.titulo}
              <small>{nombre.fecha}</small>
            </button>
          );
        })}
      </div>
      <input type="date" className="cl-fecha" aria-label="Otro día" value={fecha || ''}
             min={sumarDias(hoy, -DIAS_ATRAS)} max={sumarDias(hoy, DIAS_ADELANTE)}
             onChange={(evento) => evento.target.value && onElegir(evento.target.value)} />
    </div>
  );
};

const Cifras = ({ resumen }) => (
  <div className="cl-cifras">
    <div className="cl-cifra">
      <span><Users size={15} /> Personas programadas</span>
      <strong>{resumen.personas}</strong>
      <small>{resumen.servicios} servicios · {resumen.unidades} unidades</small>
    </div>
    <div className="cl-cifra cl-cifra--verde">
      <span><CircleCheck size={15} /> A bordo</span>
      <strong>{resumen.aBordo}</strong>
      <small>marcados por el conductor</small>
    </div>
    <div className="cl-cifra cl-cifra--ambar">
      <span><CircleX size={15} /> No se presentaron</span>
      <strong>{resumen.noSePresento}</strong>
    </div>
    <div className="cl-cifra cl-cifra--rojo">
      <span><Clock size={15} /> Sin confirmar</span>
      <strong>{resumen.sinConfirmar}</strong>
      <small>su turno pasó y nadie los marcó</small>
    </div>
    <div className="cl-cifra">
      <span><UserX size={15} /> Sin unidad asignada</span>
      <strong>{resumen.sinUnidad}</strong>
    </div>
  </div>
);

const TarjetaServicio = ({ servicio, fecha, empresa, ahora, abierto, onAlternar }) => {
  const personas = servicio.personas || [];
  const estados = personas.map((p) => estadoDePersona(p, servicio, fecha, ahora));
  const aBordo = estados.filter((e) => e === 'a_bordo').length;
  const ausentes = estados.filter((e) => e === 'no_se_presento').length;
  const conductor = servicio.conductor;
  return (
    <article className="cl-servicio">
      <div className="cl-servicio-cabecera">
        <span className="cl-unidad">{servicio.unidad}</span>
        <div>
          <p>{conductor?.nombre || 'Unidad sin conductor registrado'}</p>
          {descripcionDelVehiculo(conductor) && <small>{descripcionDelVehiculo(conductor)}</small>}
        </div>
      </div>
      <div className="cl-datos">
        <span><MapPin size={13} /> {nombreCortoDeSede(servicio.sede, empresa)}</span>
        {servicio.cobertura && <span>{servicio.cobertura}</span>}
        <span><Users size={13} /> {aBordo}/{personas.length} a bordo</span>
      </div>
      <div className="cl-progreso" aria-hidden="true">
        <i className="cl-a-bordo" style={{ width: `${(aBordo / Math.max(personas.length, 1)) * 100}%` }} />
        <i className="cl-ausente" style={{ width: `${(ausentes / Math.max(personas.length, 1)) * 100}%` }} />
      </div>
      <button type="button" className="cl-desplegar" onClick={onAlternar} aria-expanded={abierto}>
        {abierto ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        {abierto ? 'Ocultar personas' : `Ver personas (${personas.length})`}
      </button>
      {abierto && (
        <ul className="cl-personas">
          {personas.map((persona, indice) => (
            <li key={persona.dni} className="cl-persona">
              <div>
                <p>{persona.nombre}</p>
                <small>{[persona.dni, persona.distrito].filter(Boolean).join(' · ')}</small>
              </div>
              <span className={`cl-estado cl-estado--${estados[indice]}`}>
                {ETIQUETAS_DE_ESTADO[estados[indice]]}
                {persona.marcado_en && ` · ${horaDeLima(persona.marcado_en)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
};

const Pendientes = ({ pendientes, empresa }) => {
  if (!pendientes?.length) return null;
  return (
    <section className="cl-pendientes">
      <h2><TriangleAlert size={18} /> {pendientes.length} {pendientes.length === 1 ? 'persona viaja' : 'personas viajan'} este día sin unidad asignada todavía</h2>
      <ul>
        {pendientes.map((p) => (
          <li key={`${p.dni}-${p.turno}-${p.modalidad}`}>
            {p.nombre}
            {p.turno && ` · ${p.turno}`}
            {p.modalidad && ` ${esRecojo(p) ? 'recojo' : 'salida'}`}
            {p.sede && ` · ${nombreCortoDeSede(p.sede, empresa)}`}
          </li>
        ))}
      </ul>
    </section>
  );
};

const ClientPortal = ({ usuario, onLogout, theme, toggleTheme }) => {
  const [fecha, setFecha] = useState(null);
  const { datos, error, cargando, refrescar } = useServiciosDelCliente(fecha);
  const [sede, setSede] = useState('');
  const [modalidad, setModalidad] = useState('');
  const [texto, setTexto] = useState('');
  const [abiertos, setAbiertos] = useState(() => new Set());

  const empresa = datos?.empresa || usuario?.empresa_id || '';
  const hoy = datos?.hoy;
  const diaActivo = fecha || hoy;
  const ahora = datos?.leidoEn ? new Date(datos.leidoEn) : new Date();
  // Lo leído solo vale si es del día elegido: al cambiar de día, hasta que llega
  // la respuesta nueva, no se enseña el anterior con el nombre de este.
  const delDia = datos && diaActivo && datos.fecha === diaActivo ? datos : null;
  const servicios = delDia?.servicios || [];
  const filtrados = filtrarServicios(servicios, { sede, modalidad, texto });
  const grupos = agruparPorTurno(filtrados);
  const resumen = resumenDelDia(delDia || {}, ahora);
  const buscando = texto.trim().length > 0;

  const alternar = (clave) => setAbiertos((actual) => {
    const siguiente = new Set(actual);
    if (siguiente.has(clave)) siguiente.delete(clave);
    else siguiente.add(clave);
    return siguiente;
  });

  return (
    <div className="cl-portal">
      <header className="cl-barra">
        <div className="cl-marca">
          <img src="/logo.png" alt="Kapital Routing" />
          <span>{nombreCortoDeSede(empresa, '') || 'Cliente'}</span>
        </div>
        <div className="cl-barra-acciones">
          {toggleTheme && (
            <button type="button" className="cl-boton cl-boton--icono" onClick={toggleTheme}
                    aria-label={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          )}
          <button type="button" className="cl-boton" onClick={onLogout}>
            <LogOut size={18} /> <span className="cl-boton-texto">Cerrar sesión</span>
          </button>
        </div>
      </header>

      <main className="cl-contenido">
        <div className="cl-titulo">
          <div>
            <h1>Transporte de tu personal</h1>
            <p>
              {datos?.leidoEn ? `Actualizado a las ${horaDeLima(datos.leidoEn)}` : 'Cargando…'}
              {datos?.leidoEn && ' · se actualiza solo cada 2 minutos'}
            </p>
          </div>
          <button type="button" className="cl-boton cl-boton--icono" onClick={refrescar} disabled={cargando}
                  aria-label="Actualizar">
            <RefreshCw size={18} className={cargando ? 'cl-girando' : ''} />
          </button>
        </div>

        {/* Hoy se pide sin fecha: así el «hoy» lo decide el servidor (Lima) y se relee solo. */}
        <SelectorDeDia hoy={hoy} fecha={diaActivo}
                       onElegir={(dia) => { setFecha(dia === hoy ? null : dia); setSede(''); }} />

        {error && (
          <div className="cl-aviso cl-aviso--rojo">
            <TriangleAlert size={18} />
            <span><strong>No se pudo cargar</strong>{error.message || 'Revisa tu conexión.'}</span>
          </div>
        )}
        {delDia && !delDia.existe && (
          <div className="cl-aviso">
            <Clock size={18} />
            <span>
              <strong>Todavía no hay programación para este día</strong>
              Cuando esté lista, aparecerá aquí con la unidad de cada persona.
            </span>
          </div>
        )}

        <Cifras resumen={resumen} />

        <div className="cl-filtros">
          <label className="cl-buscar">
            <Search size={18} />
            <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)}
                   placeholder="Buscar por nombre, DNI, unidad o placa" aria-label="Buscar" />
          </label>
          <div className="cl-chips" role="group" aria-label="Sentido">
            {MODALIDADES.map((m) => (
              <button key={m.valor || 'todo'} type="button"
                      className={`cl-chip${modalidad === m.valor ? ' cl-chip--activo' : ''}`}
                      onClick={() => setModalidad(m.valor)}>
                {m.texto}
              </button>
            ))}
          </div>
          {sedesDelDia(servicios).length > 1 && (
            <div className="cl-chips" role="group" aria-label="Sede">
              <button type="button" className={`cl-chip${!sede ? ' cl-chip--activo' : ''}`} onClick={() => setSede('')}>
                Todas las sedes
              </button>
              {sedesDelDia(servicios).map(({ sede: nombre, personas }) => (
                <button key={nombre} type="button" className={`cl-chip${sede === nombre ? ' cl-chip--activo' : ''}`}
                        onClick={() => setSede(nombre)}>
                  {nombreCortoDeSede(nombre, empresa)} ({personas})
                </button>
              ))}
            </div>
          )}
        </div>

        {!buscando && <Pendientes pendientes={delDia?.pendientes} empresa={empresa} />}

        {delDia && grupos.length === 0 && (
          <div className="cl-vacio">
            <strong>{buscando || sede || modalidad ? 'Nada coincide con la búsqueda' : 'No hay servicios de tu personal este día'}</strong>
            {(buscando || sede || modalidad) && 'Prueba con otro nombre, otra sede o quita los filtros.'}
          </div>
        )}

        {grupos.map((grupo) => (
          <section key={grupo.clave} className="cl-grupo">
            <h2 className="cl-grupo-cabecera">
              <strong>{grupo.turno}</strong>
              <span>
                <Bus size={14} style={{ verticalAlign: '-2px' }} />{' '}
                {esRecojo(grupo) ? 'Recojo · entrada a la sede' : 'Salida de la sede'} · {grupo.servicios.length}{' '}
                {grupo.servicios.length === 1 ? 'unidad' : 'unidades'} · {grupo.personas}{' '}
                {grupo.personas === 1 ? 'persona' : 'personas'}
              </span>
            </h2>
            <div className="cl-rejilla">
              {grupo.servicios.map((servicio) => {
                const clave = `${servicio.unidad}|${servicio.turno}|${servicio.modalidad}`;
                return (
                  <TarjetaServicio key={clave} servicio={servicio} fecha={diaActivo} empresa={empresa} ahora={ahora}
                                   abierto={buscando || abiertos.has(clave)} onAlternar={() => alternar(clave)} />
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
};

export default ClientPortal;
