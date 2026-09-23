import {
  ArrowRightLeft, Clock, GitCompareArrows, MapPin, Search, SlidersHorizontal,
} from 'lucide-react';
import { ALL } from '../model/workbenchSelectors.js';
import { SERVICE_STATE_KEYS, serviceStateLabel } from './estadoCatalog.js';

/**
 * Filtros compartidos por el tablero y el panel de novedades.
 *
 * Solo se ofrecen filtros que los datos actuales pueden responder. `Sede` y
 * `Cobertura` son hoy el mismo campo (`micro_zona`), así que se muestra uno
 * solo con su nombre real en lugar de dos desplegables que harían lo mismo.
 */

const Select = ({ id, label, Icon, value, onChange, options, allLabel }) => (
  <div className="pw-field">
    <label htmlFor={id}><Icon size={13} aria-hidden="true" />{label}</label>
    <select id={id} className="pw-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={ALL}>{allLabel}</option>
      {options.map((option) => (
        <option key={option.value ?? option} value={option.value ?? option}>
          {option.label ?? option}
        </option>
      ))}
    </select>
  </div>
);

const WorkbenchFilters = ({ filters, options, onChange }) => {
  const set = (key) => (value) => onChange({ ...filters, [key]: value });

  return (
    <section className="pw-filters" aria-label="Filtros de la programación">
      <Select
        id="pw-f-zona"
        label="Zona de cobertura"
        Icon={MapPin}
        value={filters.microZona}
        onChange={set('microZona')}
        options={options.microZonas}
        allLabel="Todas"
      />
      <Select
        id="pw-f-horario"
        label="Horario"
        Icon={Clock}
        value={filters.horario}
        onChange={set('horario')}
        options={options.horarios}
        allLabel="Todos"
      />
      <Select
        id="pw-f-estado"
        label="Estado"
        Icon={SlidersHorizontal}
        value={filters.estado}
        onChange={set('estado')}
        options={SERVICE_STATE_KEYS.map((key) => ({ value: key, label: serviceStateLabel(key) }))}
        allLabel="Todos"
      />
      <Select
        id="pw-f-asignacion"
        label="Asignación"
        Icon={ArrowRightLeft}
        value={filters.asignacion}
        onChange={set('asignacion')}
        options={[
          { value: 'asignados', label: 'Con unidad' },
          { value: 'sin_asignar', label: 'Sin unidad' },
        ]}
        allLabel="Todas"
      />

      <Select
        id="pw-f-cambio"
        label="Novedad"
        Icon={GitCompareArrows}
        value={filters.cambio}
        onChange={set('cambio')}
        options={[
          { value: 'modificados', label: 'Modificados' },
          { value: 'sin_cambio', label: 'Sin cambios' },
        ]}
        allLabel="Todos"
      />

      <div className="pw-field pw-field-search">
        <label htmlFor="pw-f-query"><Search size={13} aria-hidden="true" />Buscar</label>
        <input
          id="pw-f-query"
          type="search"
          className="pw-input"
          placeholder="Padrón, agente, documento o dirección…"
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
        />
      </div>
    </section>
  );
};

export default WorkbenchFilters;
