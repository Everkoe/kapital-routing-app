import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardList, Inbox, Upload } from 'lucide-react';
import { toast } from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { buildPendingAgents } from './model/serviceModel.js';
import { useBoardData } from './data/useBoardData.js';
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

const formatToday = () =>
  new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });

const Placeholder = ({ Icon, title, children, accion }) => (
  <div className="pw-placeholder">
    <Icon size={34} aria-hidden="true" />
    <h3>{title}</h3>
    <p>{children}</p>
    {accion}
  </div>
);

const ProgramadorWorkbench = ({ onIrACargar }) => {
  // Los datos los sirve el cargador compartido: las cuatro secciones del
  // Programador leen el mismo tablero y volver a descargarlo en cada cambio de
  // pestaña costaría ~493 KB de egress sin aportar nada.
  const { services, isLoading, error, refresh } = useBoardData();
  const [filters, setFilters] = useState(emptyFilters);
  const [openServiceId, setOpenServiceId] = useState(null);

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
        onRefresh={refresh}
        onExport={handleExport}
        canExport={!isLoading && visibleServices.length > 0}
        onIrACargar={onIrACargar}
      />

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
              // Un tablero vacío sin decir qué hacer deja a quien lo mira
              // buscando el botón por toda la aplicación. Aquí se nombra la
              // sección y los dos archivos, y se lleva de un clic.
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
                Los Excel se suben en <strong>Cargar datos</strong>: el reporte «Detalle»
                de la intranet, en la pestaña «Histórico de la operación»; el archivo de
                novedades que manda el cliente, en «Novedades del cliente».
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
