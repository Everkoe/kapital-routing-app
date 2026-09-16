import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardList, Inbox } from 'lucide-react';
import { toast } from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { apiFetch } from '../utils/apiClient';
import { buildPendingAgents, buildServices, indexFleet } from './model/serviceModel.js';
import {
  applyFilters,
  computeKpis,
  emptyFilters,
  filterOptions,
  sortServices,
} from './model/workbenchSelectors.js';
import WorkbenchHeader from './components/WorkbenchHeader.jsx';
import WorkbenchFilters from './components/WorkbenchFilters.jsx';
import ServiceCard from './components/ServiceCard.jsx';
import PendingPanel from './components/PendingPanel.jsx';
import UpcomingPanel from './components/UpcomingPanel.jsx';
import './programador.css';

/**
 * Mesa de trabajo del Programador de Rutas.
 *
 * Primera entrega: tablero de lectura y revisión sobre el contrato de rutas que
 * el backend ya expone. No introduce endpoints nuevos ni toca el motor de
 * asignación, que sigue congelado.
 *
 * Lo que deliberadamente NO está, porque hoy no existe el dato que lo sostenga:
 *
 * - Orden de recogida y hora de paso por agente. El backend agrupa pasajeros
 *   pero no secuencia paradas; la columna `#` del detalle es número de fila y
 *   está rotulada como tal.
 * - Importación de los dos Excel y guardado versionado. Necesitan el contrato
 *   de `docs/planning/route-programmer-contracts.md` §4 y una decisión sobre
 *   dónde se persiste la sesión de planificación (§5).
 * - Estados de propuesta, aprobación y rechazo. Requieren un motor que proponga
 *   algo que revisar.
 *
 * Dibujar cualquiera de los tres ahora sería simular funcionalidad.
 */

// Ventana operativa fija mientras no se decida si es configurable por
// operación (decisión pendiente 22 del documento de contratos).
const VENTANA_OPERATIVA = '11:00 — 07:00';
const OPERACION = 'TP';

const formatToday = () =>
  new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });

const Placeholder = ({ Icon, title, children }) => (
  <div className="pw-placeholder">
    <Icon size={34} aria-hidden="true" />
    <h3>{title}</h3>
    <p>{children}</p>
  </div>
);

const ProgramadorWorkbench = () => {
  const [routes, setRoutes] = useState([]);
  const [fleetIndex, setFleetIndex] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [openServiceId, setOpenServiceId] = useState(null);

  /**
   * Carga el tablero. No toca `isLoading` al entrar a propósito: el estado
   * inicial ya es `true` para el montaje, y el botón Actualizar lo enciende por
   * su cuenta. Así la primera escritura de estado ocurre después de un `await`
   * y el efecto no muta estado de forma síncrona.
   */
  const fetchBoard = useCallback(async (signal) => {
    try {
      // La flota es opcional: sin ella el tablero sigue siendo útil, solo que
      // muestra la ocupación sin denominador. Por eso no aborta la carga.
      const [routesData, fleetData] = await Promise.all([
        apiFetch('/api/routes', { signal }),
        apiFetch('/api/flota', { signal }).catch(() => null),
      ]);
      if (signal?.aborted) return;
      setRoutes(Array.isArray(routesData) ? routesData : []);
      setFleetIndex(indexFleet(fleetData));
      setError(null);
    } catch (err) {
      // Una carga cancelada por desmontaje no es un fallo que mostrar.
      if (signal?.aborted || err?.name === 'AbortError') return;
      setError(err?.message || 'No se pudo cargar la programación.');
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Cancelar al desmontar evita que una respuesta tardía escriba sobre un
    // componente que ya no está, y descarta la respuesta vieja si se recarga.
    const controller = new AbortController();
    // Cargar al montar acaba escribiendo estado por definición, y el proyecto
    // no usa todavía una librería de datos (TanStack Query, SWR) que lo saque
    // fuera del efecto. Las dos trampas que la regla protege sí están cubiertas
    // aquí: la petición se cancela al desmontar y la escritura ocurre tras el
    // `await`, nunca de forma síncrona.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchBoard(controller.signal);
    return () => controller.abort();
  }, [fetchBoard]);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    setError(null);
    fetchBoard();
  }, [fetchBoard]);

  const services = useMemo(() => buildServices(routes, fleetIndex), [routes, fleetIndex]);
  const kpis = useMemo(() => computeKpis(services), [services]);
  const options = useMemo(() => filterOptions(services), [services]);

  const visibleServices = useMemo(
    () => sortServices(applyFilters(services, filters)),
    [services, filters],
  );

  const pending = useMemo(
    () => buildPendingAgents(applyFilters(services, { ...filters, asignacion: 'sin_asignar' })),
    [services, filters],
  );

  const toggleService = useCallback(
    (id) => setOpenServiceId((current) => (current === id ? null : id)),
    [],
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
        fechaPlanificacion={formatToday()}
        ventanaOperativa={VENTANA_OPERATIVA}
        isLoading={isLoading}
        onRefresh={handleRefresh}
        onExport={handleExport}
        canExport={!isLoading && visibleServices.length > 0}
      />

      <UpcomingPanel />

      {error && (
        <p className="pw-notice" data-tone="danger" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          {error}
        </p>
      )}

      <WorkbenchFilters filters={filters} options={options} onChange={setFilters} />

      <div className="pw-columns">
        <section className="pw-panel" aria-labelledby="pw-board-title">
          <div className="pw-panel-head">
            <h2 className="pw-panel-title" id="pw-board-title">Programación</h2>
            <span className="pw-panel-count">
              {visibleServices.length === services.length
                ? `${services.length} servicios`
                : `${visibleServices.length} de ${services.length} servicios`}
            </span>
          </div>

          <div className="pw-panel-body">
            {isLoading && (
              <Placeholder Icon={ClipboardList} title="Cargando programación…">
                Leyendo las rutas vigentes del servidor.
              </Placeholder>
            )}

            {!isLoading && services.length === 0 && !error && (
              <Placeholder Icon={Inbox} title="No hay programación cargada">
                El tablero está vacío. Cuando exista la importación de los dos Excel, la
                programación del día aparecerá aquí.
              </Placeholder>
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
