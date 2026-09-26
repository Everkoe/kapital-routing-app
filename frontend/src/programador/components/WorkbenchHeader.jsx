import {
  AlertTriangle,
  Calendar,
  ClipboardCheck,
  Clock,
  FileSpreadsheet,
  PieChart,
  RefreshCw,
  Save,
  Truck,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import PreviewAction from './PreviewAction.jsx';

/**
 * Encabezado y tira de KPIs.
 *
 * Los KPIs son derivados, no declarados: salen de las rutas realmente cargadas.
 * `Espacios libres` solo suma unidades que declaran capacidad y avisa aparte
 * cuántas quedaron fuera del cálculo, para que la cifra no se lea como un total
 * exacto cuando en realidad es parcial.
 *
 * `Cargar Excel` ya no es un control apagado: lleva a «Cargar datos», que es
 * donde de verdad se suben los dos archivos. Estuvo deshabilitado mientras esa
 * entrega no existía, y anunciarlo como pendiente cuando ya está hecho manda a
 * la gente a buscar una función en el sitio equivocado.
 *
 * `Guardar` sigue siendo `PreviewAction` porque su backend sí está por hacer.
 */

/** Una fecha ISO en el formato que se lee en Perú. */
const fechaCorta = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-PE',
    { weekday: 'short', day: '2-digit', month: 'short' });
};

const Kpi = ({ Icon, value, label, note, tone }) => (
  <div className="pw-kpi">
    <span className="pw-kpi-icon" data-tone={tone}><Icon size={19} aria-hidden="true" /></span>
    <span>
      <strong className="pw-kpi-value">{value}</strong>
      <span className="pw-kpi-label">{label}</span>
      {note && <span className="pw-kpi-note">{note}</span>}
    </span>
  </div>
);

const WorkbenchHeader = ({
  kpis,
  operacion,
  fechaPlanificacion,
  ventanaOperativa,
  isLoading,
  onRefresh,
  onExport,
  canExport,
  onIrACargar,
  dia,
  dias,
  diasConPlan,
  onCambiarDia,
}) => (
  <>
    <header className="pw-header">
      <div className="pw-header-titles">
        <h1 className="pw-title">Programación de rutas</h1>
        <span className="pw-chip">{operacion}</span>
        <span className="pw-meta">
          <Calendar size={15} aria-hidden="true" />
          {dias?.length > 0 ? (
            <select className="pw-select pw-select-inline" value={dia}
              aria-label="Día de la programación"
              onChange={(e) => onCambiarDia?.(e.target.value)}>
              <option value="">Último cargado{fechaPlanificacion ? ` (${fechaCorta(fechaPlanificacion)})` : ''}</option>
              {/* El punto marca los días que ya tienen programación creada:
                  sin él, elegir un día es a ciegas y no se sabe cuál se puede
                  editar hasta abrirlo. */}
              {dias.map((d) => (
                <option key={d} value={d}>
                  {diasConPlan?.includes(d) ? '● ' : ''}{fechaCorta(d)}
                </option>
              ))}
            </select>
          ) : (fechaPlanificacion ? fechaCorta(fechaPlanificacion) : 'Sin día cargado')}
        </span>
        <span className="pw-meta"><Clock size={15} aria-hidden="true" />{ventanaOperativa}</span>
      </div>

      <div className="pw-actions">
        <button type="button" className="pw-btn" onClick={onIrACargar}>
          <Upload size={16} aria-hidden="true" />
          Cargar Excel
        </button>
        <PreviewAction Icon={Save} entrega="Guardado versionado">
          Guardar
        </PreviewAction>
        <button type="button" className="pw-btn" onClick={onRefresh} disabled={isLoading}>
          <RefreshCw size={16} aria-hidden="true" />
          {isLoading ? 'Actualizando…' : 'Actualizar'}
        </button>
        <button type="button" className="pw-btn pw-btn-primary" onClick={onExport} disabled={!canExport}>
          <FileSpreadsheet size={16} aria-hidden="true" />
          Exportar Excel
        </button>
      </div>
    </header>

    <div className="pw-kpis">
      <Kpi Icon={Truck} value={kpis.servicios} label="Servicios en el tablero" />
      <Kpi
        Icon={ClipboardCheck}
        value={0}
        label="Servicios por revisar"
        note="Sin propuesta que revisar todavía"
      />
      <Kpi Icon={Users} value={kpis.agentesAsignados} label="Agentes asignados" />
      <Kpi Icon={UserPlus} value={kpis.agentesSinAsignar} label="Agentes sin asignar" />
      <Kpi
        Icon={PieChart}
        value={kpis.capacidadLibre}
        label="Espacios libres"
        note={
          kpis.capacidadDesconocida > 0
            ? `${kpis.capacidadDesconocida} unidad(es) sin capacidad declarada`
            : null
        }
      />
      <Kpi
        Icon={AlertTriangle}
        value={kpis.excedidos}
        label="Servicios sobre capacidad"
        tone={kpis.excedidos > 0 ? 'danger' : undefined}
      />
    </div>
  </>
);

export default WorkbenchHeader;
