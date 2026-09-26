import {
  AlertTriangle,
  Calendar,
  ClipboardCheck,
  Clock,
  FileSpreadsheet,
  PieChart,
  RefreshCw,
  Truck,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';

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
 * la gente a buscar una función en el sitio equivocado. Por lo mismo se retiró
 * `Guardar`: cada cambio se guarda al momento desde que la programación se
 * persiste, así que un botón que anunciaba el guardado como pendiente decía lo
 * contrario de lo que pasa. Quien lo cuenta ahora es el aviso de la mesa.
 *
 * **El selector tiene dos grupos y no es un detalle de presentación.** Los días
 * del histórico son los que ya se ejecutaron y no se tocan; los de «Por
 * programar» van de hoy en adelante y son los únicos sobre los que se puede
 * trabajar. Mientras solo ofreció los primeros, el día que un programador
 * necesita —mañana— no se podía ni seleccionar.
 */

/** Una fecha ISO en el formato que se lee en Perú. */
const fechaCorta = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-PE',
    { weekday: 'short', day: '2-digit', month: 'short' });
};

/** El día de hoy en ISO según el reloj del navegador, que es el de la operación. */
const hoyISO = () => {
  const d = new Date();
  return [
    d.getFullYear(),
    `${d.getMonth() + 1}`.padStart(2, '0'),
    `${d.getDate()}`.padStart(2, '0'),
  ].join('-');
};

/** Desplaza una fecha ISO los días que se le pidan, sin salirse del día local. */
const masDias = (iso, dias) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return [
    d.getFullYear(),
    `${d.getMonth() + 1}`.padStart(2, '0'),
    `${d.getDate()}`.padStart(2, '0'),
  ].join('-');
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
  exportHelp,
  modo,
  onIrACargar,
  dia,
  dias,
  diasProgramables,
  diasConPlan,
  onCambiarDia,
}) => {
  const hoy = hoyISO();
  const manana = masDias(hoy, 1);
  const marca = (d) => (diasConPlan?.includes(d) ? '● ' : '');
  // Un día puede estar en las dos listas si el histórico llega hasta hoy.
  // Enseñarlo dos veces no aporta nada: el valor es el mismo y manda el grupo
  // que sí permite trabajar.
  const historicos = (dias || []).filter((d) => !diasProgramables?.includes(d));

  const etiquetaProxima = (d) => {
    if (d === hoy) return `hoy · ${fechaCorta(d)}`;
    if (d === manana) return `mañana · ${fechaCorta(d)}`;
    return fechaCorta(d);
  };
  const etiquetaDiaVacio = modo === 'plan'
    ? `Plan de hoy${fechaPlanificacion ? ` (${fechaCorta(fechaPlanificacion)})` : ''}`
    : `Último ejecutado${fechaPlanificacion ? ` (${fechaCorta(fechaPlanificacion)})` : ''}`;

  return (
    <>
      <header className="pw-header">
        <div className="pw-header-titles">
          <h1 className="pw-title">Programación de rutas</h1>
          <span className="pw-chip">{operacion}</span>
          <span className="pw-meta">
            <Calendar size={15} aria-hidden="true" />
            {(dias?.length > 0 || diasProgramables?.length > 0) ? (
              <select className="pw-select pw-select-inline" value={dia}
                aria-label="Día de la programación"
                title="● el día ya tiene programación creada"
                onChange={(e) => onCambiarDia?.(e.target.value)}>
                <option value="">
                  {etiquetaDiaVacio}
                </option>
                {diasProgramables?.length > 0 && (
                  <optgroup label="Por programar">
                    {diasProgramables.map((d) => (
                      <option key={d} value={d}>{marca(d)}{etiquetaProxima(d)}</option>
                    ))}
                  </optgroup>
                )}
                {historicos.length > 0 && (
                  <optgroup label="Ya ejecutado · no se edita">
                    {historicos.map((d) => (
                      <option key={d} value={d}>{marca(d)}{fechaCorta(d)}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            ) : (fechaPlanificacion ? fechaCorta(fechaPlanificacion) : 'Sin día cargado')}
          </span>
          <span className="pw-meta"><Clock size={15} aria-hidden="true" />{ventanaOperativa}</span>
        </div>

        <div className="pw-actions">
          <span className="pw-meta" role="status" title={exportHelp}>
            {exportHelp}
          </span>
          <button type="button" className="pw-btn" onClick={onIrACargar}>
            <Upload size={16} aria-hidden="true" />
            Cargar Excel
          </button>
          <button type="button" className="pw-btn" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw size={16} aria-hidden="true" />
            {isLoading ? 'Actualizando…' : 'Actualizar'}
          </button>
          <button type="button" className="pw-btn pw-btn-primary" onClick={onExport}
            disabled={!canExport} title={exportHelp} aria-label={`Exportar Excel. ${exportHelp}`}>
            <FileSpreadsheet size={16} aria-hidden="true" />
            Exportar Excel
          </button>
        </div>
      </header>

      <div className="pw-kpis">
        <Kpi Icon={Truck} value={kpis.servicios} label="Servicios en el tablero" />
        <Kpi
          Icon={ClipboardCheck}
          value={kpis.serviciosPorRevisar}
          label="Servicios por revisar"
          note={kpis.serviciosPorRevisar > 0
            ? 'Cambios detectados respecto al día anterior'
            : 'Sin cambios detectados'}
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
};

export default WorkbenchHeader;
