import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Iconos from 'lucide-react';
import { AlertTriangle, Calendar, Inbox, RotateCcw, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiFetch } from './utils/apiClient';
import DrawerLateral from './components/DrawerLateral';
import {
  ICONO_POR_TIPO,
  estadoDeActividad,
  fechaLegible,
} from './constants/tiposDeActividad';
import './App.css';

/**
 * Historial de acciones administrativas.
 *
 * Los filtros y la paginación los resuelve el backend: el historial crece con
 * el uso y traérselo entero al navegador para filtrarlo aquí sería repetir el
 * error que ya costó caro con los documentos.
 *
 * Es de solo lectura a propósito. Un registro de auditoría que se puede editar
 * desde la misma pantalla que audita no sirve para auditar nada.
 */

const POR_PAGINA = 10;

/** Espera antes de consultar mientras se escribe, para no pedir por tecla. */
const ESPERA_BUSQUEDA_MS = 350;

const FILTROS_VACIOS = { q: '', tipo: '', actor: '', desde: '', hasta: '' };

const IconoDeTipo = ({ tipo, size = 16 }) => {
  const Icono = Iconos[ICONO_POR_TIPO[tipo]] || Iconos.Activity;
  return <Icono size={size} aria-hidden="true" />;
};

const Skeleton = ({ ancho = '100%', alto = 14 }) => (
  <span className="act-skeleton" style={{ width: ancho, height: alto }} aria-hidden="true" />
);

/**
 * Filas del detalle, en el orden en que se leen.
 *
 * Solo lo que el evento trae de verdad: un campo ausente no aparece, en vez de
 * enseñar un guion que hace pensar que el dato existe y está vacío.
 */
const datosDelEvento = (evento) => [
  { clave: 'fecha', Icono: Calendar, etiqueta: 'Fecha y hora', valor: fechaLegible(evento.created_at) },
  { clave: 'actor', Icono: Iconos.User, etiqueta: 'Responsable', valor: evento.actor_name || '—' },
  evento.actor_email && { clave: 'correo', Icono: Iconos.Mail, etiqueta: 'Correo', valor: evento.actor_email },
  evento.entity_label && { clave: 'elemento', Icono: Iconos.Package, etiqueta: 'Elemento afectado', valor: evento.entity_label },
  evento.entity_type && { clave: 'tipo', Icono: Iconos.FileText, etiqueta: 'Tipo de evento', valor: evento.entity_type },
  evento.description && { clave: 'descripcion', Icono: Iconos.AlignLeft, etiqueta: 'Descripción', valor: evento.description },
  { clave: 'id', Icono: Iconos.Hash, etiqueta: 'Identificador', valor: evento.id, mono: true },
].filter(Boolean);

const HistorialActividad = () => {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [pagina, setPagina] = useState(1);
  const [detalle, setDetalle] = useState(null);

  // La búsqueda se retrasa; el resto de filtros se aplican al momento porque
  // salen de un desplegable o de un calendario, no de teclear.
  const [busqueda, setBusqueda] = useState('');
  const [primeraCarga, setPrimeraCarga] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => {
      setFiltros(previo => (previo.q === busqueda ? previo : { ...previo, q: busqueda }));
      setPagina(1);
    }, ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(id);
  }, [busqueda]);

  const hayFiltros = useMemo(
    () => Object.entries(filtros).some(([, valor]) => valor !== ''),
    [filtros],
  );

  const consultar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const parametros = new URLSearchParams({ pagina: String(pagina), limite: String(POR_PAGINA) });
      Object.entries(filtros).forEach(([clave, valor]) => { if (valor) parametros.set(clave, valor); });
      setDatos(await apiFetch(`/api/actividad?${parametros}`));
    } catch (err) {
      setError(err?.message || 'No se pudo cargar el historial.');
    } finally {
      setCargando(false);
      setPrimeraCarga(false);
    }
  }, [filtros, pagina]);

  useEffect(() => {
    // `consultar` arranca poniendo el estado de carga, y hacerlo dentro del
    // cuerpo del efecto encadena un render de más. Se aplaza un tick.
    const id = setTimeout(consultar, 0);
    return () => clearTimeout(id);
  }, [consultar]);

  const limpiar = () => {
    setBusqueda('');
    setFiltros(FILTROS_VACIOS);
    setPagina(1);
  };

  const exportar = () => {
    const eventos = datos?.eventos || [];
    if (eventos.length === 0) return;
    const columnas = ['Actividad', 'Responsable', 'Correo', 'Elemento', 'Fecha', 'Estado', 'Descripción'];
    const filas = eventos.map(e => [
      e.action_type, e.actor_name, e.actor_email, e.entity_label,
      e.created_at, estadoDeActividad(e.status).etiqueta, e.description,
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));

    // El BOM va escapado: escrito literal, el linter lo lee como un espacio
    // irregular. Hace que Excel abra el CSV en UTF-8 sin romper los acentos.
    const csv = '\uFEFF' + [columnas.join(','), ...filas].join('\n');

    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    enlace.download = `historial-actividad-pagina-${datos.pagina}.csv`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
    toast.success(`Exportados ${eventos.length} eventos de esta página.`);
  };

  const eventos = datos?.eventos || [];
  const resumen = datos?.resumen;
  const desde = resumen?.total ? (datos.pagina - 1) * datos.limite + 1 : 0;
  const hasta = Math.min(datos ? datos.pagina * datos.limite : 0, resumen?.total || 0);

  const indicadores = [
    { clave: 'total', Icono: Iconos.FileText, valor: resumen?.total, etiqueta: 'eventos' },
    { clave: 'hoy', Icono: Calendar, valor: resumen?.hoy, etiqueta: 'hoy' },
    { clave: 'responsables', Icono: Iconos.Users, valor: resumen?.responsables, etiqueta: 'responsables' },
  ];

  return (
    <div className="historial-actividad">
      <header className="historial-cabecera">
        <h1>Historial de actividad</h1>
        <p>Consulta y audita las acciones realizadas dentro de Kapital Routing.</p>
      </header>

      <div className="historial-indicadores">
        {indicadores.map(({ clave, Icono, valor, etiqueta }) => (
          <div className="historial-indicador" key={clave}>
            <span className="historial-indicador-icono"><Icono size={20} aria-hidden="true" /></span>
            <div>
              <strong>{cargando && primeraCarga ? <Skeleton ancho="48px" alto={24} /> : (valor ?? 0)}</strong>
              <span>{etiqueta}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="historial-filtros">
        <label className="historial-busqueda">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por usuario, unidad o acción…"
            aria-label="Buscar en el historial"
          />
        </label>

        <select
          value={filtros.tipo}
          aria-label="Filtrar por tipo de evento"
          onChange={(e) => { setFiltros({ ...filtros, tipo: e.target.value }); setPagina(1); }}
        >
          <option value="">Todos los eventos</option>
          {(datos?.tipos || []).map(tipo => <option key={tipo} value={tipo}>{tipo}</option>)}
        </select>

        <select
          value={filtros.actor}
          aria-label="Filtrar por responsable"
          onChange={(e) => { setFiltros({ ...filtros, actor: e.target.value }); setPagina(1); }}
        >
          <option value="">Todos los responsables</option>
          {(datos?.responsables || []).map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        <input
          type="date"
          value={filtros.desde}
          aria-label="Desde la fecha"
          onChange={(e) => { setFiltros({ ...filtros, desde: e.target.value }); setPagina(1); }}
        />
        <input
          type="date"
          value={filtros.hasta}
          aria-label="Hasta la fecha"
          onChange={(e) => { setFiltros({ ...filtros, hasta: e.target.value }); setPagina(1); }}
        />

        {hayFiltros && (
          <button type="button" className="btn-view-doc" onClick={limpiar}>
            <X size={14} /> Limpiar
          </button>
        )}
        {eventos.length > 0 && (
          <button type="button" className="btn-approve-doc" onClick={exportar}>
            <Iconos.Download size={14} /> Exportar
          </button>
        )}
      </div>

      {error ? (
        <div className="historial-estado" role="alert">
          <AlertTriangle size={30} aria-hidden="true" />
          <h4>No se pudo cargar el historial</h4>
          <p>{error}</p>
          <button type="button" className="btn-approve-doc" onClick={consultar}>
            <RotateCcw size={14} /> Reintentar
          </button>
        </div>
      ) : (
        <div className="historial-tabla-caja">
          <table className="historial-tabla">
            <thead>
              <tr>
                <th scope="col">Actividad</th>
                <th scope="col">Responsable</th>
                <th scope="col">Elemento</th>
                <th scope="col">Fecha y hora</th>
                <th scope="col">Estado</th>
                <th scope="col">Detalles</th>
              </tr>
            </thead>
            <tbody>
              {cargando && eventos.length === 0
                ? Array.from({ length: 5 }, (_, i) => (
                    <tr key={`esqueleto-${i}`}>
                      {Array.from({ length: 6 }, (__, c) => <td key={c}><Skeleton /></td>)}
                    </tr>
                  ))
                : eventos.map((evento) => {
                    const estado = estadoDeActividad(evento.status);
                    return (
                      <tr key={evento.id}>
                        <td>
                          <span className={`historial-actividad-nombre ${estado.clase}`}>
                            <IconoDeTipo tipo={evento.action_type} />
                            {evento.action_type}
                          </span>
                        </td>
                        <td>{evento.actor_email || evento.actor_name || '—'}</td>
                        <td>{evento.entity_label || '—'}</td>
                        <td>{fechaLegible(evento.created_at)}</td>
                        <td><span className={`act-badge ${estado.clase}`}>{estado.etiqueta}</span></td>
                        <td>
                          <button type="button" className="historial-ver" onClick={() => setDetalle(evento)}>
                            Ver detalle
                          </button>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>

          {!cargando && eventos.length === 0 && (
            <div className="historial-estado">
              <Inbox size={30} aria-hidden="true" />
              {hayFiltros ? (
                <>
                  <h4>No se encontraron eventos con los filtros seleccionados.</h4>
                  <button type="button" className="btn-view-doc" onClick={limpiar}>
                    <X size={14} /> Limpiar filtros
                  </button>
                </>
              ) : (
                <h4>No hay actividad registrada todavía.</h4>
              )}
            </div>
          )}

          {eventos.length > 0 && (
            <div className="historial-paginacion">
              <span>Mostrando {desde}–{hasta} de {resumen?.total || 0} eventos</span>
              <div>
                <button
                  type="button"
                  className="btn-view-doc"
                  disabled={datos.pagina <= 1 || cargando}
                  onClick={() => setPagina(p => Math.max(1, p - 1))}
                >
                  Anterior
                </button>
                <span className="historial-pagina-actual">{datos.pagina} / {datos.paginas}</span>
                <button
                  type="button"
                  className="btn-view-doc"
                  disabled={datos.pagina >= datos.paginas || cargando}
                  onClick={() => setPagina(p => p + 1)}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <DrawerLateral
        abierto={Boolean(detalle)}
        titulo="Detalle de actividad"
        onCerrar={() => setDetalle(null)}
        pie={<button type="button" className="btn-view-doc" onClick={() => setDetalle(null)}>Cerrar</button>}
      >
        {detalle && (
          <>
            <div className="drawer-titular">
              <span className={`historial-indicador-icono ${estadoDeActividad(detalle.status).clase}`}>
                <IconoDeTipo tipo={detalle.action_type} size={22} />
              </span>
              <div>
                <h4>{detalle.action_type}</h4>
                <span className={`act-badge ${estadoDeActividad(detalle.status).clase}`}>
                  {estadoDeActividad(detalle.status).etiqueta}
                </span>
              </div>
            </div>

            <section className="drawer-bloque">
              <h5>Información del evento</h5>
              <ul className="drawer-datos">
                {datosDelEvento(detalle).map(({ clave, Icono, etiqueta, valor, mono }) => (
                  <li key={clave}>
                    <span className="drawer-dato-icono"><Icono size={16} aria-hidden="true" /></span>
                    <div>
                      <span className="drawer-dato-etiqueta">{etiqueta}</span>
                      <span className={`drawer-dato-valor${mono ? ' drawer-id' : ''}`}>{valor}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Solo cuando el evento guardó valores: una comparación vacía o
                inventada sería peor que no enseñar ninguna. */}
            {Array.isArray(detalle.changes) && detalle.changes.length > 0 && (
              <section className="drawer-bloque">
                <h5>Cambios realizados</h5>
                <table className="drawer-cambios">
                  <thead>
                    <tr><th scope="col">Campo</th><th scope="col">Valor anterior</th><th scope="col">Valor nuevo</th></tr>
                  </thead>
                  <tbody>
                    {detalle.changes.map((c) => (
                      <tr key={c.campo}>
                        <td>{c.campo}</td>
                        <td><span className="valor-anterior">{c.anterior || '—'}</span></td>
                        <td><span className="valor-nuevo">{c.nuevo || '—'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
      </DrawerLateral>
    </div>
  );
};

export default HistorialActividad;
