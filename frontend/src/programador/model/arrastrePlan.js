import {
  cambiosParaAsignar, mejorPosicion, mismoTurno, plazasDe, proponer, puntoDe,
} from './motorInsercion.js';

/**
 * Mover gente a mano por el plan: de un servicio a otro, de «Novedades y
 * pendientes» a un servicio, y de un servicio de vuelta a pendientes.
 *
 * **Qué se deja soltar** sale de las restricciones del motor de inserción,
 * pero no con la misma dureza: aquí decide una persona, y el arrastre existe
 * precisamente para las excepciones que el motor no resuelve.
 *
 * - *No se deja*: otro sentido —un recojo no va en una salida—, otra sede
 *   —ninguno de los 5.959 servicios del histórico mezcla sedes— ni un
 *   servicio donde la persona ya va.
 * - *Se deja con aviso*, que se confirma antes de guardar: otro turno (quien
 *   entra a las 06:00 llegaría a otra hora, y el motor no lo propone nunca) y
 *   pasarse de la capacidad (tres unidades han llevado más de lo que declaran,
 *   y quien programa puede saberlo).
 *
 * **Dónde cae dentro del orden**: en la posición que menos alarga el recorrido,
 * la misma que usa el motor. Si no es la buena, se arrastra la fila después.
 */

const texto = (valor) => String(valor ?? '').trim();

const SENTIDO = { RECOJO: 'recojo', SALIDA: 'salida' };
const sentidoDe = (modalidad) => SENTIDO[modalidad] || texto(modalidad).toLowerCase();

/** Lo que se arrastra desde la fila de un servicio del plan. */
export const personaDeServicio = (service, agente) => ({
  tipo: 'servicio',
  dni: texto(agente?.id),
  nombre: agente?.nombre || texto(agente?.id),
  lat: agente?.lat,
  lng: agente?.lng,
  turno: service.turno,
  modalidad: service.modalidad,
  sede: service.sede,
  cobertura: service.microZona,
  habituales: [],
  origen: service,
});

/** Lo que se arrastra desde «Novedades y pendientes» (una entrada del motor). */
export const personaDePendiente = (pendiente) => ({
  ...pendiente,
  tipo: 'pendiente',
  dni: texto(pendiente?.dni),
  nombre: pendiente?.nombre || texto(pendiente?.dni),
  modalidad: texto(pendiente?.modalidad).toUpperCase(),
  origen: null,
});

const nombreDe = (persona) => persona.nombre || persona.dni;

const NO_SE_PUEDE = (motivo) => ({ permitido: false, motivo, avisos: [] });

/**
 * Si se puede soltar a `persona` en `destino` y qué conviene saber antes.
 *
 * `motivo` explica un «no» y es `null` cuando no hay nada que explicar
 * (soltarla en su propio servicio). `avisos` son lo que se confirma.
 */
export const comprobarDestino = (persona, destino) => {
  if (!persona || !destino) return NO_SE_PUEDE(null);
  if (persona.origen && persona.origen.id === destino.id) return NO_SE_PUEDE(null);
  if (!destino.asignado) return NO_SE_PUEDE('Ese servicio no tiene unidad.');
  if ((destino.agentes || []).some((a) => texto(a?.id) === persona.dni)) {
    return NO_SE_PUEDE(`${nombreDe(persona)} ya va en este servicio.`);
  }

  const modalidad = texto(persona.modalidad).toUpperCase();
  if (modalidad && destino.modalidad && modalidad !== destino.modalidad) {
    return NO_SE_PUEDE(
      `Es de ${sentidoDe(modalidad)} y este servicio es de ${sentidoDe(destino.modalidad)}.`);
  }
  if (persona.sede && destino.sede && persona.sede !== destino.sede) {
    return NO_SE_PUEDE(`Va a ${persona.sede} y este servicio, a ${destino.sede}.`);
  }

  const avisos = [];
  if (!modalidad || !texto(persona.turno)) {
    avisos.push('Su novedad no trae turno o sentido: comprueba que este servicio sea el suyo.');
  } else if (destino.turno && !mismoTurno(persona.turno, destino.turno)) {
    avisos.push(`Su turno es a las ${persona.turno} y este servicio es de las ${destino.turno}.`);
  }
  const plazas = plazasDe(destino);
  if (plazas.total !== null && plazas.usadas + 1 > plazas.total) {
    avisos.push(`Se pasa de la capacidad: quedaría con ${plazas.usadas + 1} de ${plazas.total}`
      + (plazas.fuente === 'observada' ? ', que es lo más que ha llevado.' : '.'));
  }
  return { permitido: true, motivo: null, avisos };
};

/**
 * Los cambios que el servidor necesita para dejar a `persona` en `destino`.
 *
 * Van en una sola tanda, que el servidor aplica entera o nada: nunca queda la
 * persona fuera de su servicio sin estar en el nuevo, ni dentro con el orden a
 * medias. `posicion` es la del motor si no se pasa otra.
 */
export const cambiosParaSoltar = (persona, destino, posicionElegida = null) => {
  const posicion = Number.isInteger(posicionElegida)
    ? posicionElegida
    : mejorPosicion(destino.agentes, puntoDe(persona)).posicion;
  if (persona.tipo === 'pendiente') {
    return { posicion, cambios: cambiosParaAsignar(persona, { service: destino, posicion }) };
  }

  const { origen } = persona;
  const dnis = destino.agentes.map((a) => texto(a?.id));
  dnis.splice(posicion, 0, persona.dni);
  return {
    posicion,
    cambios: [
      {
        accion: 'mover',
        dni: persona.dni,
        desde: { vehiculo: origen.conductor, turno: origen.turno, modalidad: origen.modalidad },
        hacia: {
          vehiculo: destino.conductor,
          turno: destino.turno,
          modalidad: destino.modalidad,
          cobertura: destino.microZona,
        },
      },
      {
        accion: 'ordenar',
        vehiculo: destino.conductor,
        turno: destino.turno,
        modalidad: destino.modalidad,
        dnis,
      },
    ],
  };
};

/**
 * Sacarla de su servicio y dejarla en pendientes, **sin darla de baja**: la
 * fila queda retirada con la unidad en que iba, como hace una novedad de
 * cambio, y el pendiente lleva su turno, sentido y zona para buscarle sitio.
 */
export const cambiosParaDejarPendiente = (persona) => [{
  accion: 'a_pendientes',
  dni: persona.dni,
  vehiculo: persona.origen.conductor,
  turno: persona.origen.turno,
  modalidad: persona.origen.modalidad,
}];

/**
 * Los servicios a los que se puede mover a alguien, de mejor a peor, para
 * hacerlo sin arrastrar: con teclado, o cuando el destino está lejos en la
 * lista. Son los del motor —su turno, sentido y sede, con sitio— y por eso no
 * incluyen el suyo; lo que el motor descarta se sigue pudiendo arrastrar.
 */
export const opcionesParaMover = (persona, services) => (
  persona ? proponer(persona, services, { maxOpciones: Infinity }) : null
);

/** Cómo se dice dónde quedó, contando en qué sentido va el orden. */
export const textoDeLaPosicion = (destino, posicion) => (
  `${destino.conductor} · ${destino.horario}, ${posicion + 1}.º en el orden de `
  + (destino.modalidad === 'SALIDA' ? 'entrega' : 'recogida')
);
