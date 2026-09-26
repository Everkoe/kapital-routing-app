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
  cambiosDeLaTanda, cambiosParaAsignar, proponer, proponerTodas,
} from './model/motorInsercion.js';
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
 * **Qué enseña.** La programación del día seleccionado. Si ya existe un plan,
 * se lee de las tablas persistentes de planificación; si todavía no existe,
 * se muestra el histórico que se carga en «Cargar datos» para poder sembrarlo.
 * La mesa dejó de depender de `/api/routes` y de la fila monolítica de
 * `app_state`, que no contenían la programación que el Programador sube.
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
 * - Historial versionado de revisiones. El plan actual sí se persiste, pero
 *   todavía no existe un contrato de versiones, aprobación y rechazo.
 *
 * Dibujar cualquiera de los tres ahora sería simular funcionalidad.
 */

// Ventana operativa fija mientras no se decida si es configurable por
// operación (decisión pendiente 22 del documento de contratos).
const VENTANA_OPERATIVA = '11:00 — 07:00';
const OPERACION = 'TP';

const rpcErrorMessage = (payload, fallback) => {
  if (!payload || typeof payload !== 'object' || !payload.error) return null;
  if (typeof payload.error === 'string') return payload.error;
  if (typeof payload.error?.detail === 'string') return payload.error.detail;
  return fallback;
};

const requireRpcSuccess = (payload, fallback) => {
  const message = rpcErrorMessage(payload, fallback);
  if (message) throw new Error(message);
  return payload;
};

const pendingIdentity = (pending, index) => {
  const key = [pending?.id, pending?.turno, pending?.modalidad]
    .map((value) => String(value ?? '').trim())
    .join('|');
  return key || `pendiente-sin-datos-${index}`;
};

/** Aplica los mismos filtros del tablero a los pendientes que guardó el plan. */
const filterSavedPending = (pending, filters) => {
  const rows = (pending || []).map((agent) => ({
    id: `pendiente|${agent.id}`,
    conductor: 'SIN ASIGNAR',
    microZona: agent.microZona,
    horario: agent.horario,
    empresa: agent.empresa,
    estado: 'sin_asignar',
    asignado: false,
    modificado: ['alta', 'cambio'].includes(agent.motivo),
    agentes: [{
      id: agent.agenteId,
      nombre: agent.nombre,
      direccion: agent.direccion,
    }],
    pendiente: agent,
  }));

  return applyFilters(rows, filters).map((row) => row.pendiente);
};

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

  // Contra qué se mide «Cambió»: en el histórico, el día cargado anterior; en
  // un plan, el día del que se copió.
  const referencia = modo === 'plan' ? sembradoDesde : comparadoCon;
  const [guardando, setGuardando] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [openServiceId, setOpenServiceId] = useState(null);

  const options = useMemo(() => {
    const base = filterOptions(services);
    if (modo !== 'plan') return base;

    // Un pendiente puede traer una zona/turno que todavía no existe en una
    // ruta asignada. Si no entra en las opciones, el filtro no podría llegar
    // a esa fila aunque la búsqueda sí la encontrara.
    const union = (actual, nuevos) => [...new Set([
      ...actual,
      ...nuevos.filter(Boolean),
    ])].sort((a, b) => a.localeCompare(b, 'es'));
    return {
      microZonas: union(base.microZonas, pendientesGuardados.map((p) => p.cobertura)),
      horarios: union(base.horarios, pendientesGuardados.map((p) => [
        p.turno,
        p.modalidad && p.modalidad.toLowerCase(),
      ].filter(Boolean).join(' '))),
    };
  }, [modo, pendientesGuardados, services]);

  const visibleServices = useMemo(
    () => sortServices(applyFilters(services, filters)),
    [services, filters],
  );

  // Con un plan, los pendientes son los que el plan dice: gente que tiene que
  // viajar y todavía no tiene sitio. Sin plan son los que el tablero deja sin
  // unidad, que es lo que había antes.
  const pendientesDelPlan = useMemo(
    () => pendientesGuardados.map((p, index) => ({
      id: pendingIdentity(p, index),
      pendingKey: pendingIdentity(p, index),
      agenteId: p.id,
      nombre: p.nombre,
      direccion: p.direccion,
      microZona: p.cobertura,
      turno: p.turno,
      modalidad: p.modalidad,
      horario: [p.turno, p.modalidad && p.modalidad.toLowerCase()]
        .filter(Boolean).join(' '),
      motivo: p.motivo,
      detalle: p.detalle,
    })),
    [pendientesGuardados],
  );

  // Lo que el motor necesita de cada pendiente, con la misma clave que el
  // panel para poder encontrar su propuesta.
  const pendientesMotor = useMemo(
    () => pendientesGuardados.map((p, index) => ({
      clave: pendingIdentity(p, index),
      dni: p.id,
      nombre: p.nombre,
      turno: p.turno,
      modalidad: p.modalidad,
      cobertura: p.cobertura,
      sede: p.sede,
      lat: p.lat,
      lng: p.lng,
      habituales: p.habituales,
      motivo: p.motivo,
    })),
    [pendientesGuardados],
  );

  // Todas a la vez y no una por persona: si dos quieren el último asiento de
  // un coche, verlas por separado le daría el mismo sitio a las dos. Se
  // calcula sobre todos los pendientes, no sobre los filtrados, para que la
  // propuesta de alguien no cambie según lo que se esté mirando.
  const tanda = useMemo(
    () => (modo === 'plan' ? proponerTodas(pendientesMotor, services) : []),
    [modo, pendientesMotor, services],
  );
  const propuestas = useMemo(
    () => new Map(tanda.map((t) => [t.pendiente.clave, t])),
    [tanda],
  );
  const asignables = tanda.filter((t) => t.elegido).length;

  const pendientesHistoricos = useMemo(
    () => buildPendingAgents(services),
    [services],
  );

  const pending = useMemo(() => {
    if (modo === 'plan') return filterSavedPending(pendientesDelPlan, filters);
    return buildPendingAgents(
      applyFilters(services, { ...filters, asignacion: 'sin_asignar' }));
  }, [modo, pendientesDelPlan, services, filters]);

  // Solo en el plan: en el histórico los pendientes salen de los propios
  // servicios sin unidad, que el KPI ya cuenta, y sumarlos sería contarlos dos
  // veces.
  const kpis = useMemo(
    () => ({
      ...computeKpis(services, modo === 'plan' ? pendientesDelPlan.length : 0),
      serviciosPorRevisar: services.filter((service) => service.modificado).length,
    }),
    [services, modo, pendientesDelPlan.length]);

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
      const r = requireRpcSuccess(await apiFetch('/api/programador/plan/sembrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha: dia }),
      }), 'No se pudo crear la programación.');
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
      const respuesta = await apiFetch('/api/programador/plan/editar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha: fecha || dia, cambios }),
      });
      requireRpcSuccess(respuesta, 'El plan no aceptó el cambio.');
      toast.success(mensaje);
      await refresh();
      return true;
    } catch (fallo) {
      toast.error(fallo?.message || 'No se pudo guardar el cambio.');
      // Quien enseñó el cambio antes de guardarlo —el orden arrastrado— tiene
      // que saber que no se guardó para deshacerlo en pantalla.
      return false;
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

  const ordenar = useCallback((service, dnis) => editar([{
    accion: 'ordenar', vehiculo: service.conductor, turno: service.turno,
    modalidad: service.modalidad, dnis,
  }], 'Orden de recogida guardado.'), [editar]);

  // La propuesta que se ve se calculó suponiendo que los demás pendientes
  // también entraban. Al asignar solo a una persona se recalcula contra el
  // plan real, para que su posición en el orden no cuente con gente que
  // todavía no está.
  const asignar = useCallback((clave, candidato) => {
    const persona = pendientesMotor.find((p) => p.clave === clave);
    const real = persona && proponer(persona, services, { maxOpciones: Infinity })
      .candidatos.find((c) => c.service.id === candidato.service.id);
    if (!real) {
      toast.error('Ese servicio ya no tiene sitio. Vuelve a mirar las opciones.');
      return;
    }
    editar(cambiosParaAsignar(persona, real),
      `${persona.nombre || persona.dni} va en ${real.service.conductor}.`);
  }, [editar, pendientesMotor, services]);

  const asignarTodas = useCallback(() => {
    const cambios = cambiosDeLaTanda(tanda);
    if (cambios.length === 0) return;
    editar(cambios, `${asignables} ${asignables === 1 ? 'persona asignada' : 'personas asignadas'}.`);
  }, [asignables, editar, tanda]);

  const botonCrear = (
    <button type="button" className="pw-btn pw-btn-primary"
      onClick={crearPlan} disabled={guardando}>
      <CalendarPlus size={16} aria-hidden="true" />
      Crear programación
    </button>
  );

  const handleExport = useCallback(() => {
    // La exportación es una entrega del plan, no una captura de la vista.
    // Aunque haya filtros activos, el archivo incluye todos los servicios y
    // una hoja aparte con quienes siguen pendientes de colocar.
    const rows = services.flatMap((service) =>
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
    const pendingRows = pendientesDelPlan.map((agent) => ({
      Documento: agent.agenteId || '',
      Agente: agent.nombre || '',
      Dirección: agent.direccion || '',
      Zona: agent.microZona || '',
      Turno: agent.turno || '',
      Modalidad: agent.modalidad || '',
      Motivo: agent.motivo || '',
      Detalle: agent.detalle || '',
    }));

    if (rows.length === 0 && pendingRows.length === 0) {
      toast.error('El plan no tiene servicios ni pendientes para exportar.');
      return;
    }

    const book = XLSX.utils.book_new();
    if (rows.length > 0) {
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Programación');
    }
    if (pendingRows.length > 0) {
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(pendingRows), 'Pendientes');
    }
    XLSX.writeFile(book, `programacion_${OPERACION}_${fecha || dia || 'sin-fecha'}.xlsx`);
    const filtrosActivos = Object.entries(filters).some(([clave, valor]) => (
      clave === 'query' ? Boolean(String(valor || '').trim()) : valor !== '__all__'
    ));
    toast.success(
      `Exportado el plan completo: ${rows.length} registros y ${pendingRows.length} pendientes.`
      + (filtrosActivos ? ' Los filtros solo afectan la vista.' : ''),
    );
  }, [dia, fecha, filters, pendientesDelPlan, services]);

  const exportHelp = modo === 'plan'
    ? 'Exporta el plan completo; los filtros solo afectan la vista.'
    : 'Disponible al seleccionar un día de «Por programar».';

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
        canExport={modo === 'plan' && !isLoading
          && (services.length > 0 || pendientesDelPlan.length > 0)}
        exportHelp={exportHelp}
        modo={modo}
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
              {referencia && (
                // Sin esto, «Cambió» no dice cambió respecto a qué, y el día
                // de comparación no tiene por qué ser el natural anterior:
                // es el último que se cargó. En un plan es otro: el día del
                // que se copió, porque lo que cambia es lo que se ha tocado.
                <small className="pw-panel-sub">
                  {modo === 'plan'
                    ? <>Los cambios se miden contra lo copiado del {formatoFecha(referencia)}.</>
                    : <>Los cambios se miden contra el {formatoFecha(referencia)},
                      que es el día anterior que tienes cargado.</>}
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
                  comparadoCon={referencia ? formatoFecha(referencia) : null}
                  historical={modo !== 'plan'}
                  onRetirar={modo === 'plan' ? retirar : null}
                  onOrdenar={modo === 'plan' ? ordenar : null}
                  onReponer={modo === 'plan' ? reponer : null}
                />
              ))}
          </div>
        </section>

        <PendingPanel
          pending={pending}
          totalPending={modo === 'plan' ? pendientesDelPlan.length : pendientesHistoricos.length}
          modoPlan={modo === 'plan'}
          propuestas={propuestas}
          asignables={asignables}
          ocupado={guardando}
          onAsignar={asignar}
          onAsignarTodas={asignarTodas}
        />
      </div>
    </div>
  );
};

export default ProgramadorWorkbench;
