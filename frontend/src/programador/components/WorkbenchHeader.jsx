import {
  AlertTriangle,
  Calendar,
  Clock,
  FileSpreadsheet,
  PieChart,
  RefreshCw,
  Truck,
  UserPlus,
  Users,
} from 'lucide-react';

/**
 * Encabezado y tira de KPIs.
 *
 * Los KPIs son derivados, no declarados: salen de las rutas realmente cargadas.
 * `Capacidad libre` solo suma unidades que declaran capacidad y avisa aparte
 * cuántas quedaron fuera del cálculo, para que la cifra no se lea como un total
 * exacto cuando en realidad es parcial.
 */

const Kpi = ({ Icon, value, label, note }) => (
  <div className="pw-kpi">
    <span className="pw-kpi-icon"><Icon size={19} aria-hidden="true" /></span>
    <span>
      <strong className="pw-kpi-value">{value}</strong>
      <span className="pw-kpi-label">{label}</span>
      {note && <span className="pw-kpi-note">{note}</span>}
    </span>
  </div>
);

const WorkbenchHeader = ({ kpis, operacion, fechaPlanificacion, ventanaOperativa, isLoading, onRefresh, onExport, canExport }) => (
  <>
    <header className="pw-header">
      <div className="pw-header-titles">
        <h1 className="pw-title">Programación de rutas</h1>
        <span className="pw-chip">{operacion}</span>
        <span className="pw-meta"><Calendar size={15} aria-hidden="true" />{fechaPlanificacion}</span>
        <span className="pw-meta"><Clock size={15} aria-hidden="true" />{ventanaOperativa}</span>
      </div>

      <div className="pw-actions">
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
      />
    </div>
  </>
);

export default WorkbenchHeader;
