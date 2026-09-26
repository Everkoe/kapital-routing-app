import { fleetKey, hasCoordinate } from './serviceModel.js';

/**
 * Motor de inserción: en qué servicio entra cada pendiente.
 *
 * **Por qué inserción y no un optimizador.** Medido sobre el histórico, el
 * problema diario descompuesto por día × turno × sentido × zona tiene una
 * mediana de un pasajero y un vehículo por celda, y la ruta de cada persona es
 * estable al 100%: lo que se mueve cada día son unas pocas personas, no el
 * mapa entero. Rehacer las rutas desde cero cada mañana rompería justo la
 * continuidad que la operación pide —seguir el orden anterior y aplicar solo
 * las novedades—, así que el motor coge a cada pendiente y busca el hueco que
 * menos estropea lo que ya funciona.
 *
 * **Qué decide y qué no.** Propone; no asigna. Asigna una persona con un clic,
 * y así sigue siendo ella quien decide. Solo busca sitio en servicios que ya
 * existen, del mismo turno, sentido y sede: no abre servicios nuevos ni
 * encadena turnos, porque eso sí depende de reglas de la operación que no
 * están escritas en ninguna parte (tiempo máximo a bordo, antelación del
 * recojo, margen entre turnos) y resolverlas a ojo sería inventárselas.
 *
 * **Las restricciones, y de dónde sale cada una:**
 *
 * - *Sentido y turno*: un recojo no va en una salida, ni las 05:00 en las
 *   06:00. Con un minuto de tolerancia, ver `TOLERANCIA_TURNO_MIN`.
 * - *Sede*: ninguno de los 5.959 servicios del histórico mezcla sedes.
 * - *Plazas*: la capacidad declarada en la flota; si no la hay, lo más que esa
 *   unidad ha llevado de verdad en un servicio. En las unidades que declaran
 *   capacidad, ese máximo coincide con ella en 23 de 39.
 *
 * **Cómo ordena las opciones:** primero las de su zona —su zona es su ruta—,
 * después el menor desvío, y a igualdad, las que dejan más plazas libres. Que
 * sea su unidad habitual se enseña, pero no reordena: el desvío ya lo dice casi
 * siempre, y una regla más sería una regla más que explicar.
 *
 * El desvío es en línea recta. Está medido que la geometría explica poco de la
 * duración de un servicio, así que no se convierte en minutos: sería una
 * promesa de hora que nadie puede cumplir. Sirve para comparar opciones, y
 * para eso basta.
 */

/**
 * Cuántos minutos pueden separar dos turnos para ser el mismo.
 *
 * La intranet escribe las salidas habituales como `22:01`, `00:01`, `02:01`,
 * y las novedades las piden a las `22:00`. Medido: la salida de las 22:01 son
 * 457 servicios en 32 días; la de las 22:00, 26. Exigir el turno exacto dejaba
 * al motor sin ver la salida habitual. Un minuto cubre esa convención y nada
 * más: si alguien puede esperar al coche de las 22:15 es una regla de la
 * operación, no una del motor.
 */
export const TOLERANCIA_TURNO_MIN = 1;

/** Cuántas opciones se enseñan por persona, contando la propuesta. */
export const MAX_OPCIONES = 3;

const RADIO_TIERRA_KM = 6371;
const MINUTOS_DIA = 24 * 60;

const texto = (valor) => String(valor ?? '').trim();

const aRadianes = (grados) => (grados * Math.PI) / 180;

/** Distancia en línea recta entre dos puntos, en kilómetros. */
export const distanciaKm = (a, b) => {
  const dLat = aRadianes(b.lat - a.lat);
  const dLng = aRadianes(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(aRadianes(a.lat)) * Math.cos(aRadianes(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.sqrt(h));
};

const puntoDe = (algo) => (
  hasCoordinate(algo?.lat) && hasCoordinate(algo?.lng)
    ? { lat: Number(algo.lat), lng: Number(algo.lng) }
    : null
);

const minutosDe = (hhmm) => {
  const [h, m] = texto(hhmm).split(':').map(Number);
  return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null;
};

/** Si dos turnos son el mismo, contando que el día da la vuelta a medianoche. */
export const mismoTurno = (a, b, tolerancia = TOLERANCIA_TURNO_MIN) => {
  const ma = minutosDe(a);
  const mb = minutosDe(b);
  if (ma === null || mb === null) return false;
  const diferencia = Math.abs(ma - mb) % MINUTOS_DIA;
  return Math.min(diferencia, MINUTOS_DIA - diferencia) <= tolerancia;
};

/**
 * Dónde meter un punto en una secuencia de paradas para desviarse lo menos.
 *
 * `posicion` es un índice sobre la lista completa, contando a los agentes sin
 * ubicación: ellos no entran en la geometría, pero conservan su sitio en el
 * orden. Es la inserción más barata clásica sobre un recorrido abierto, porque
 * no se conoce el punto exacto de la sede y un extremo inventado sesgaría el
 * resultado más de lo que lo arregla.
 */
export const mejorPosicion = (agentes, punto) => {
  const lista = Array.isArray(agentes) ? agentes : [];
  const puntos = lista.map(puntoDe);
  if (!punto || puntos.every((p) => p === null)) {
    return { posicion: lista.length, desvioKm: null };
  }

  let mejor = { posicion: lista.length, desvioKm: Infinity };
  for (let k = 0; k <= lista.length; k += 1) {
    const antes = puntos.slice(0, k).filter(Boolean).at(-1) ?? null;
    const despues = puntos.slice(k).find(Boolean) ?? null;
    let coste;
    if (antes && despues) {
      coste = distanciaKm(antes, punto) + distanciaKm(punto, despues)
        - distanciaKm(antes, despues);
    } else {
      coste = distanciaKm(antes ?? despues, punto);
    }
    if (coste < mejor.desvioKm - 1e-9) mejor = { posicion: k, desvioKm: coste };
  }
  return { posicion: mejor.posicion, desvioKm: Math.max(0, mejor.desvioKm) };
};

/** Plazas de un servicio: las declaradas, o las demostradas si no hay otras. */
const plazasDe = (service) => {
  const usadas = service.agentes.length;
  if (service.capacity?.known) {
    return { usadas, total: service.capacity.total, fuente: 'declarada' };
  }
  if (service.maxLlevado) {
    return { usadas, total: service.maxLlevado, fuente: 'observada' };
  }
  return { usadas, total: null, fuente: null };
};

const libresTras = (plazas) => (plazas.total === null ? null : plazas.total - plazas.usadas - 1);

const compararCandidatos = (a, b) => {
  if (a.mismaZona !== b.mismaZona) return a.mismaZona ? -1 : 1;
  if (a.desvioKm !== b.desvioKm) {
    if (a.desvioKm === null) return 1;
    if (b.desvioKm === null) return -1;
    return a.desvioKm - b.desvioKm;
  }
  const la = libresTras(a.plazas) ?? -1;
  const lb = libresTras(b.plazas) ?? -1;
  return lb - la;
};

/**
 * Las opciones de un pendiente, de mejor a peor.
 *
 * `pendiente`: `{ dni, turno, modalidad, cobertura, sede, lat, lng,
 * habituales, motivo }`. `services`: los de `buildServices` sobre un plan.
 *
 * Devuelve `estado` —`con_propuesta`, `sin_sitio` o `sin_turno`—, las
 * mejores `candidatos`, cuántos había en total y por qué se descartaron los
 * demás: decir «no cabe en ninguno» sin decir por qué deja a quien programa
 * sin saber si falta una unidad o sobra una restricción.
 */
export const proponer = (pendiente, services, { maxOpciones = MAX_OPCIONES } = {}) => {
  const descartes = { otraSede: 0, llenos: 0, yaEsta: 0 };
  const turno = texto(pendiente?.turno);
  const modalidad = texto(pendiente?.modalidad).toUpperCase();
  if (!turno || !modalidad) {
    return { estado: 'sin_turno', candidatos: [], total: 0, descartes, sinUbicacion: false };
  }

  const punto = puntoDe(pendiente);
  const dni = texto(pendiente.dni);
  const sede = texto(pendiente.sede);
  const zona = texto(pendiente.cobertura);
  const habituales = new Set((pendiente.habituales || []).map(fleetKey));

  const candidatos = [];
  for (const service of services || []) {
    if (!service?.asignado || service.modalidad !== modalidad) continue;
    if (!mismoTurno(service.turno, turno)) continue;
    if (service.agentes.some((a) => texto(a?.id) === dni)) {
      descartes.yaEsta += 1;
      continue;
    }
    if (sede && service.sede && service.sede !== sede) {
      descartes.otraSede += 1;
      continue;
    }
    const plazas = plazasDe(service);
    if (plazas.total !== null && plazas.usadas + 1 > plazas.total) {
      descartes.llenos += 1;
      continue;
    }
    const { posicion, desvioKm } = mejorPosicion(service.agentes, punto);
    candidatos.push({
      service,
      posicion,
      desvioKm,
      mismaZona: Boolean(zona) && service.microZona === zona,
      habitual: habituales.has(fleetKey(service.conductor)),
      plazas,
      libresTras: libresTras(plazas),
    });
  }

  candidatos.sort(compararCandidatos);
  return {
    estado: candidatos.length > 0 ? 'con_propuesta' : 'sin_sitio',
    candidatos: candidatos.slice(0, maxOpciones),
    total: candidatos.length,
    descartes,
    sinUbicacion: punto === null,
  };
};

/**
 * Los cambios que el servidor necesita para asignar a alguien en un sitio.
 *
 * `agregar` lo mete al final y `ordenar` lo deja donde el motor dijo. Van en
 * la misma tanda porque el servidor la aplica entera o nada: nunca queda la
 * persona dentro y el orden a medias.
 */
export const cambiosParaAsignar = (pendiente, candidato) => {
  const { service, posicion } = candidato;
  const dni = texto(pendiente.dni);
  const dnis = service.agentes.map((a) => texto(a?.id));
  dnis.splice(posicion, 0, dni);
  return [
    {
      accion: 'agregar',
      dni,
      vehiculo: service.conductor,
      turno: service.turno,
      modalidad: service.modalidad,
      cobertura: service.microZona,
      // Si entró por una novedad del cliente, que la fila lo diga: es la
      // diferencia entre algo que decidió una persona y algo que vino de fuera.
      origen: ['alta', 'cambio'].includes(pendiente.motivo) ? 'novedad' : 'manual',
    },
    {
      accion: 'ordenar',
      vehiculo: service.conductor,
      turno: service.turno,
      modalidad: service.modalidad,
      dnis,
    },
  ];
};

/** El mismo servicio con una persona más en su sitio, sin tocar el original. */
const conUnoMas = (service, pendiente, posicion) => {
  const agentes = [...service.agentes];
  agentes.splice(posicion, 0, {
    id: texto(pendiente.dni),
    nombre: pendiente.nombre,
    lat: pendiente.lat,
    lng: pendiente.lng,
    origen: 'manual',
  });
  return { ...service, agentes, agentCount: agentes.length };
};

/**
 * Propuestas para todos los pendientes a la vez, sin dar dos veces la misma
 * plaza.
 *
 * Una por una, en orden y actualizando los servicios tras cada elección: si
 * dos personas quieren el último asiento de un coche, la segunda ve el coche
 * lleno y busca otro. Se empieza por quien menos opciones tiene, porque
 * atender por orden de llegada deja fuera a alguien que solo cabía en un sitio
 * para dárselo a otro que tenía tres.
 */
export const proponerTodas = (pendientes, services, opciones = {}) => {
  const lista = Array.isArray(pendientes) ? pendientes : [];
  const orden = lista
    .map((pendiente, indice) => ({
      pendiente, indice, opciones: proponer(pendiente, services, opciones).total,
    }))
    .sort((a, b) => a.opciones - b.opciones || a.indice - b.indice);

  let actuales = services || [];
  const resultado = [];
  for (const [paso, { pendiente, indice }] of orden.entries()) {
    const propuesta = proponer(pendiente, actuales, opciones);
    const elegido = propuesta.candidatos[0] ?? null;
    const cambios = elegido ? cambiosParaAsignar(pendiente, elegido) : [];
    if (elegido) {
      actuales = actuales.map((s) => (s === elegido.service
        ? conUnoMas(s, pendiente, elegido.posicion) : s));
    }
    resultado.push({ ...propuesta, pendiente, indice, paso, elegido, cambios });
  }
  return resultado.sort((a, b) => a.indice - b.indice);
};

/**
 * Los cambios de una tanda, en el orden en que el motor los fue eligiendo.
 *
 * No en el de la lista: si dos personas van al mismo coche, el `ordenar` de la
 * segunda ya cuenta con la primera dentro. Aplicados al revés, el de la
 * primera llegaría después y dejaría a dos personas con la misma posición.
 */
export const cambiosDeLaTanda = (tanda) => [...(tanda || [])]
  .sort((a, b) => a.paso - b.paso)
  .flatMap((t) => t.cambios || []);
