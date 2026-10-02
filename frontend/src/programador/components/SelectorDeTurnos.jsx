import { useState } from 'react';
import { estadoDe, ordenarTurnos } from '../model/disponibilidad.js';

/**
 * Trabaja, descansa o solo algunos turnos —y cuáles—, para un día.
 *
 * `valor`: `null` trabaja todo, `[]` descansa, `['03:00', …]` solo esos, y
 * `undefined` «como su semana» (solo en un día concreto, con `conSemana`).
 * Los turnos se marcan como botones: así sirve igual para «de 12 a 5» que para
 * «solo el de las 6».
 */
const SelectorDeTurnos = ({
  valor, turnos, onCambiar, etiqueta, conSemana = false, textoSemana = '', deshabilitado = false,
}) => {
  // «Solo algunos turnos» recién elegido y sin ninguno marcado todavía: se
  // guarda como descanso, pero se siguen enseñando los turnos para marcarlos.
  const [eligiendo, setEligiendo] = useState(false);
  const marcados = Array.isArray(valor) ? valor : [];
  const modo = valor === undefined
    ? 'semana'
    : (eligiendo && marcados.length === 0 ? 'solo' : estadoDe(valor));

  const opciones = [
    ...(conSemana ? [['semana', `Como su semana · ${textoSemana}`]] : []),
    ['trabaja', 'Trabaja'],
    ['descansa', 'Descansa'],
    ['solo', 'Solo algunos turnos'],
  ];

  const elegir = (nuevo) => {
    setEligiendo(nuevo === 'solo');
    if (nuevo === 'semana') onCambiar(undefined);
    else if (nuevo === 'trabaja') onCambiar(null);
    else if (nuevo === 'descansa') onCambiar([]);
    else onCambiar(estadoDe(valor) === 'solo' ? valor : []);
  };

  // Los de la operación y, por si acaso, los que ya tenga guardados aunque hoy
  // no salgan en el histórico.
  const lista = ordenarTurnos([...new Set([...(turnos || []), ...marcados])]);
  const alternar = (turno) => {
    const nuevos = marcados.includes(turno)
      ? marcados.filter((t) => t !== turno)
      : [...marcados, turno];
    onCambiar(ordenarTurnos(nuevos));
  };

  return (
    <div className="pw-disp-selector">
      <div className="pw-seg" role="radiogroup" aria-label={etiqueta}>
        {opciones.map(([clave, texto]) => (
          <button key={clave} type="button" role="radio" className="pw-seg-opcion"
            aria-checked={modo === clave} data-activa={modo === clave || undefined}
            onClick={() => elegir(clave)} disabled={deshabilitado}>
            {texto}
          </button>
        ))}
      </div>
      {modo === 'solo' && (
        <div className="pw-disp-turnos" role="group" aria-label={`Turnos que trabaja · ${etiqueta}`}>
          {lista.map((turno) => (
            <button key={turno} type="button" className="pw-disp-turno"
              aria-pressed={marcados.includes(turno)} onClick={() => alternar(turno)}
              disabled={deshabilitado}>
              {turno}
            </button>
          ))}
          {marcados.length === 0 && (
            <small className="pw-disp-ayuda">Marca los turnos que trabaja; sin ninguno, descansa.</small>
          )}
        </div>
      )}
    </div>
  );
};

export default SelectorDeTurnos;
