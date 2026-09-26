import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarPlus, ClipboardList, History, Inbox, Upload,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { apiFetch } from '../utils/apiClient';
import { buildPendingAgents } from './model/serviceModel.js';
import { useBoardData } from './data/useBoardData.js';
import {
  applyFilters,
  computeKpis,
  emptyFilters,
  filterOptions,
  sortServices,
} from './model/workbenchSelectors.js';
import { fecha as formatoFecha } from './fechas';
import WorkbenchHeader from './components/WorkbenchHeader.jsx';
import WorkbenchFilters from './components/WorkbenchFilters.jsx';
import ServiceCard from './components/ServiceCard.jsx';
import PendingPanel from './components/PendingPanel.jsx';
import './programador.css';

/**
 * Mesa de trabajo del Programador de Rutas.
 *
 * **Qué enseña.** La programación de un día tal como se ejecutó, reconstruida
 * del histórico que se carga en «Cargar datos». Hasta ahora leía `/api/routes`,
 * que devuelve una lista vacía desde que la programación dejó de escribirse en
 * `app_state`: el tablero estaba vacío y no había forma de llenarlo, porque el
 * Excel que sube el Programador entra en otras tablas.
 *
 * Eso la convierte en el punto de partida del trabajo real —seguir el orden
 * anterior y aplicar solo las novedades—, no en una propuesta: aquí no se
 * calcula ninguna ruta.
 *
 * Lo que deliberadamente NO está, porque hoy no existe el dato que lo sostenga:
 *
 * - Orden de recogida propuesto. El histórico trae la hora real de cada recojo
 *   y por ahí se ordenan los agentes, pero nadie secuencia paradas todavía; la
 *   columna `#` del detalle es número de fila y está rotulada como tal.
 * - Guardado versionado. Necesita una decisión sobre dónde se persiste la
 *   sesión de planificación (`docs/planning/route-programmer-contracts.md` §5).
 * - Estados de propuesta, aprobación y rechazo. Requieren un motor que proponga
 *   algo que revisar.
 *
 * Dibujar cualquiera de los tres ahora sería simular funcionalidad.
 */

// Ventana operativa fija mientras no se decida si es configurable por
// operación (decisión pendiente 22 del documento de contratos).
const VENTANA_OPERATIVA = '11:00 — 07:00';
const OPERACION = 'TP';

const Placeholder = ({ Icon, title, children, accion }) => (
  <div className="pw-placeholder">
    <Icon size={34} aria-hidden="true" />
    <h3>{title}</h3>
    <p>{children}</p>
    {accion}
  </div>
);

const ProgramadorWorkbench = ({ onIrACargar }) => {
  // El día que se está mirando. Vacío significa «el último cargado», que es
  // lo que el Programador quiere ver al entrar.
  const [dia, setDia] = useState('');
  // Los datos los sirve el cargador compartido: las secciones del Programador
  // leen el mismo tablero y volver a descargarlo en cada cambio de pestaña
  // costaría ~96 KB de egress sin aportar nada.
  const {
    services, isLoading, error, refresh, fecha, dias, comparadoCon,
    modo, sembradoDesde, pendientes: pendientesGuardados, diasConPlan,
    diasProgramables,
  } = useBoardData(dia);

  // Sobre qué día se puede trabajar. Vacío significa «el último ejecutado», que
  // nunca lo es: un día que ya pasó no se programa, se consulta. Sin esta
  // distinción el botón de crear sembraba el día del histórico que estabas
  // mirando, o sea programaba el pasado.
  const esProgramable = Boolean(dia) && diasProgramables.includes(dia);
  const [guardando, setGuardando] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [openServiceId, setOpenServiceId] = useState(null);

  const options = useMemo(() => filterOptions(services), [services]);

  const visibleServices = useMemo(
    () => sortServices(applyFilters(services, filters)),
    [services, filters],
  );

  // Con un plan, los pendientes son los que el plan dice: gente que tiene que
  // viajar y todavía no tiene sitio. Sin plan son los que el tablero deja sin
  // unidad, que es lo que había antes.
  const pending = useMemo(() => {
    if (modo === 'plan') {
      return pendientesGuardados.map((p) => ({
        id: `${p.id}-${p.turno || ''}`,
        agenteId: p.id,
        nombre: p.nombre,
        direccion: p.direccion,
        microZona: p.cobertura,
        horario: [p.turno, p.modalidad && p.modalidad.toLowerCase()]
          .filter(Boolean).join(' '),
        motivo: p.motivo,
        detalle: p.detalle,
      }));
    }
    return buildPendingAgents(
      applyFilters(services, { ...filters, asignacion: 'sin_asignar' }));
  }, [modo, pendientesGuardados, services, filters]);

  // Solo en el plan: en el histórico los pendientes salen de los propios
  // servicios sin unidad, que el KPI ya cuenta, y sumarlos sería contarlos dos
  // veces.
  const kpis = useMemo(
    () => computeKpis(services, modo === 'plan' ? pending.length : 0),
    [services, modo, pending.length]);

  const toggleService = useCallback(
    (id) => setOpenServiceId((current) => (current === id ? null : id)),
    [],
  );

  const crearPlan = useCallback(async () => {
    if (!esProgramable) {
      toast.error('Elige primero un día de «Por programar».');
      return;
    }
    setGuardando(true);
    const aviso = toast.loading('Creando la programación…');
    try {
      const r = await apiFetch('/api/programador/plan/sembrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha: dia }),
      });
      if (r?.sin_historico) throw new Error('No hay histórico del que partir.');
      toast.success(r.ya_existia
        ? 'Ese día ya tenía programación.'
        : `${r.creadas} asignaciones copiadas del ${r.sembrado_desde}.`, { id: aviso });
      await refresh();
    } catch (fallo) {
      toast.error(fallo?.message || 'No se pudo crear la programación.', { id: aviso });
    } finally {
      setGuardando(false);
    }
  }, [dia, esProgramable, refresh]);

  // Cada cambio se guarda al momento y no al pulsar un botón. Acumularlos
  // obliga a resolver qué pasa si alguien cierra la pestaña a medias, y ese
  // «¿guardé?» es justo lo que no debe tener quien programa a las cinco de la
  // mañana.
  const editar = useCallback(async (cambios, mensaje) => {
    setGuardando(true);
    try {
      await apiFetch('/api/programador/plan/editar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha: fecha || dia, cambios }),
      });
      toast.success(mensaje);
      await refresh();
    } catch (fallo) {
      toast.error(fallo?.message || 'No se pudo guardar el cambio.');
    } finally {
      setGuardando(false);
    }
  }, [dia, fecha, refresh]);

  const retirar = useCallback((service, agente) => editar([{
    accion: 'retirar', dni: agente.id, vehiculo: service.conductor,
    turno: service.horario.split(' ')[0],
    modalidad: service.horario.split(' ')[1]?.toUpperCase(),
    nota: 'Retirado por el Programador',
  }], `${agente.nombre || agente.id} ya no viaja en este servicio.`), [editar]);

  const reponer = useCallback((service, agente) => editar([{
    accion: 'reponer', dni: agente.id, vehiculo: service.conductor,
    turno: service.horario.split(' ')[0],
    modalidad: service.horario.split(' ')[1]?.toUpperCase(),
  }], `${agente.nombre || agente.id} vuelve al servicio.`), [editar]);

  const botonCrear = (
    <button type="button" className="pw-btn pw-btn-primary"
      onClick={crearPlan} disabled={guardando}>
      <CalendarPlus size={16} aria-hidden="true" />
      Crear programación
    </button>
  );

  const handleExport = useCallback(() => {
    // Exporta lo que el Programador está viendo, no el tablero completo: si
    // filtró, exportar otra cosa sería una sorpresa desagradable.
    const rows = visibleServices.flatMap((service) =>
      service.agentes.map((agente) => ({
        Servicio: service.id,
        Horario: service.horario,
        Zona: service.microZona,
        Unidad: service.conductor,
        Capacidad: service.capacity.known ? service.capacity.total : 'No declarada',
        Documento: agente?.id || '',
        Agente: agente?.nombre || '',
        Dirección: agente?.direccion || '',
        Empresa: agente?.empresa || '',
      })),
    );

    if (rows.length === 0) {
      toast.error('No hay agentes en la vista actual para exportar.');
      return;
    }

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Programación');
    XLSX.writeFile(book, `programacion_${OPERACION}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`Exportados ${rows.length} registros.`);
  }, [visibleServices]);

  return (
    <div className="pw-root">
      <WorkbenchHeader
        kpis={kpis}
        operacion={OPERACION}
        fechaPlanificacion={fecha}
        ventanaOperativa={VENTANA_OPERATIVA}
        isLoading={isLoading}
        onRefresh={refresh}
        onExport={handleExport}
        canExport={!isLoading && visibleServices.length > 0}
        onIrACargar={onIrACargar}
        dia={dia}
        dias={dias}
        diasProgramables={diasProgramables}
        diasConPlan={diasConPlan}
        onCambiarDia={setDia}
      />

      {error && (
        <p className="pw-notice" data-tone="danger" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          {error}
        </p>
      )}

      {/* Lo que se está mirando no es obvio y importa: un histórico no se
          puede tocar y un plan sí. Decirlo evita que alguien intente editar
          un día que ya pasó y crea que la aplicación no responde. */}
      {!isLoading && !error && (
        modo === 'plan' ? (
          <p className="pw-notice" data-tone="ok">
            <ClipboardList size={16} aria-hidden="true" />
            <span>
              Programación editable
              {sembradoDesde && <> · copiada del {formatoFecha(sembradoDesde)}</>}
              {' · '}
              {/* Decirlo aquí y no en un botón: el guardado no es una acción
                  que alguien tenga que recordar, y un «Guardar» apagado hacía
                  creer lo contrario. */}
              {guardando ? 'guardando…' : 'cada cambio se guarda solo'}
            </span>
          </p>
        ) : esProgramable ? (
          <p className="pw-notice">
            <CalendarPlus size={16} aria-hidden="true" />
            <span>
              Este día <strong>todavía no tiene programación</strong>. Se crea
              copiando el último día ejecutado y a partir de ahí se edita.
            </span>
            {botonCrear}
          </p>
        ) : services.length > 0 && (
          <p className="pw-notice">
            <History size={16} aria-hidden="true" />
            <span>
              Estás viendo <strong>lo que se ejecutó</strong> ese día, y no se
              edita. Para trabajar, elige arriba un día
              de <strong>«Por programar»</strong>.
            </span>
          </p>
        )
      )}

      <WorkbenchFilters filters={filters} options={options} onChange={setFilters} />

      <div className="pw-columns">
        <section className="pw-panel" aria-labelledby="pw-board-title">
          <div className="pw-panel-head">
            <h2 className="pw-panel-title" id="pw-board-title">
              Programación
              {comparadoCon && (
                // Sin esto, «Cambió» no dice cambió respecto a qué, y el día
                // de comparación no tiene por qué ser el natural anterior:
                // es el último que se cargó.
                <small className="pw-panel-sub">
                  Los cambios se miden contra el {formatoFecha(comparadoCon)},
                  que es el día anterior que tienes cargado.
                </small>
              )}
            </h2>
            <span className="pw-panel-count">
              {visibleServices.length === services.length
                ? `${services.length} servicios`
                : `${visibleServices.length} de ${services.length} servicios`}
            </span>
          </div>

          <div className="pw-panel-body">
            {isLoading && (
              <Placeholder Icon={ClipboardList} title="Cargando programación…">
                Leyendo del histórico el día seleccionado.
              </Placeholder>
            )}

            {!isLoading && services.length === 0 && !error && (
              // Un tablero vacío sin decir qué hacer deja a quien lo mira
              // buscando el botón por toda la aplicación. Y lo que hay que
              // hacer no es lo mismo en los dos casos: en un día por programar
              // falta crearlo, no subir nada.
              esProgramable ? (
                <Placeholder
                  Icon={CalendarPlus}
                  title="Este día no tiene programación todavía"
                  accion={botonCrear}
                >
                  Se crea copiando el último día ejecutado —seguir el orden
                  anterior— y encima se aplican las novedades del cliente.
                </Placeholder>
              ) : (
                <Placeholder
                  Icon={Inbox}
                  title="No hay programación cargada"
                  accion={(
                    <button type="button" className="pw-btn pw-btn-primary"
                      onClick={onIrACargar}>
                      <Upload size={16} aria-hidden="true" />
                      Ir a «Cargar datos»
                    </button>
                  )}
                >
                  Este tablero sale del histórico. Los Excel se suben en
                  <strong> Cargar datos</strong>: el reporte «Detalle» de la intranet, en la
                  pestaña «Histórico de la operación»; el archivo de novedades que manda el
                  cliente, en «Novedades del cliente».
                </Placeholder>
              )
            )}

            {!isLoading && services.length > 0 && visibleServices.length === 0 && (
              <Placeholder Icon={Inbox} title="Ningún servicio coincide">
                Ajusta o limpia los filtros para volver a ver la programación completa.
              </Placeholder>
            )}

            {!isLoading &&
              visibleServices.map((service, index) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  ordinal={index + 1}
                  isOpen={openServiceId === service.id}
                  onToggle={toggleService}
                  comparadoCon={comparadoCon ? formatoFecha(comparadoCon) : null}
                  onRetirar={modo === 'plan' ? retirar : null}
                  onReponer={modo === 'plan' ? reponer : null}
                />
              ))}
          </div>
        </section>

        <PendingPanel pending={pending} />
      </div>
    </div>
  );
};

export default ProgramadorWorkbench;
