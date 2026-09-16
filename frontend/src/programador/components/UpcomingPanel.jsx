import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  History,
  ListChecks,
  Milestone,
  Route,
} from 'lucide-react';

/**
 * Qué llega en las siguientes entregas.
 *
 * Esta mesa cubre hoy la revisión de la programación vigente. El resto del
 * ciclo diario está diseñado pero no implementado, y el panel lo dice en vez
 * de dibujar controles que no harían nada.
 *
 * No es un aviso de relleno: es lo que lee quien aprueba la pantalla para
 * entender qué está viendo y qué no. Por eso enumera las entregas en lugar de
 * resumirlas en una frase, y por eso se puede plegar una vez leído.
 */

const ENTREGAS = [
  {
    Icon: FileSpreadsheet,
    titulo: 'Importación de los dos Excel',
    detalle:
      'La última programación y las novedades del día, con validación fila a fila. Los registros observados no se pierden: pasan al panel de novedades con su motivo.',
  },
  {
    Icon: ListChecks,
    titulo: 'Propuesta automática y revisión',
    detalle:
      'El motor propone los cambios y el Programador los aprueba o rechaza, por agente y por servicio. Un agente rechazado vuelve a novedades, nunca se elimina.',
  },
  {
    Icon: Route,
    titulo: 'Orden de recogida y destino',
    detalle:
      'La secuencia de paradas y la hora de paso por cada agente, reordenables a mano. Hoy la columna «#» del detalle es número de fila, no secuencia.',
  },
  {
    Icon: History,
    titulo: 'Guardado versionado y exportación',
    detalle:
      'Borradores con versión, historial de cambios y el Excel que sirve de base a la programación del día siguiente.',
  },
];

const UpcomingPanel = () => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <section className="pw-upcoming" aria-labelledby="pw-upcoming-title">
      <button
        type="button"
        className="pw-upcoming-head"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls="pw-upcoming-body"
      >
        <span className="pw-upcoming-icon"><Milestone size={18} aria-hidden="true" /></span>
        <span className="pw-upcoming-titles">
          <strong id="pw-upcoming-title">Esta mesa cubre hoy la revisión de la programación vigente</strong>
          <span>Lo demás del ciclo diario está diseñado y llega en las siguientes entregas.</span>
        </span>
        {isOpen ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
      </button>

      {isOpen && (
        <div className="pw-upcoming-body" id="pw-upcoming-body">
          <ol className="pw-upcoming-list">
            {ENTREGAS.map(({ Icon, titulo, detalle }, index) => (
              <li className="pw-upcoming-item" key={titulo}>
                <span className="pw-upcoming-step" aria-hidden="true">{index + 1}</span>
                <span className="pw-upcoming-text">
                  <strong><Icon size={14} aria-hidden="true" />{titulo}</strong>
                  <span>{detalle}</span>
                </span>
              </li>
            ))}
          </ol>

          <p className="pw-upcoming-note">
            Nada de esto está simulado en la pantalla: todavía no existe el contrato de backend
            que lo sostenga, y mostrarlo como si funcionara induciría a error a quien la apruebe.
          </p>
        </div>
      )}
    </section>
  );
};

export default UpcomingPanel;
