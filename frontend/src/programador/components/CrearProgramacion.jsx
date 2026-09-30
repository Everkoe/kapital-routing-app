import { CalendarPlus } from 'lucide-react';
import { fechaCorta, mismoDiaDeLaSemana } from '../fechas';

/**
 * «Crear programación», eligiendo de qué día ejecutado se copia.
 *
 * Por defecto es el último ejecutado antes de ese día —seguir el orden
 * anterior—, pero un domingo no se parece a un martes: medido en agosto, un
 * domingo lleva unos 390 servicios y un día laborable unos 800. Por eso se
 * señalan los días que caen en el mismo día de la semana. El servidor ya
 * aceptaba el día de origen; la pantalla no dejaba elegirlo.
 */
const CrearProgramacion = ({ dia, diasEjecutados, desde, onCambiarDesde, ocupado, onCrear }) => {
  const ordenados = [...(diasEjecutados || [])].sort().reverse();
  const ultimoAntes = ordenados.find((d) => d < dia) ?? ordenados[0];

  return (
    <span className="pw-crear">
      {ordenados.length > 0 && (
        <label className="pw-crear-desde">
          <span>Copiar de</span>
          <select className="pw-select" value={desde} disabled={ocupado}
            onChange={(e) => onCambiarDesde(e.target.value)}>
            <option value="">
              el último ejecutado{ultimoAntes ? ` (${fechaCorta(ultimoAntes)})` : ''}
            </option>
            {ordenados.map((d) => (
              <option key={d} value={d}>
                {fechaCorta(d)}{mismoDiaDeLaSemana(d, dia) ? ' · mismo día de la semana' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className="pw-btn pw-btn-primary" onClick={onCrear} disabled={ocupado}>
        <CalendarPlus size={16} aria-hidden="true" />
        Crear programación
      </button>
    </span>
  );
};

export default CrearProgramacion;
