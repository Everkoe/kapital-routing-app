import { mismoTurno } from './motorInsercion.js';
import { fleetKey } from './serviceModel.js';

/**
 * Disponibilidad de las unidades: qué días descansa cada conductor y en qué
 * turnos trabaja. La configura el Programador desde su Flota.
 *
 * Una regla es una lista de turnos: vacía es «descansa» y con turnos es «solo
 * esos». `null` es «trabaja todo». Hay dos niveles —su semana habitual y fechas
 * concretas, que mandan sobre la semana—, y la base los resuelve para cada día
 * del plan (`disponibilidad_del_dia`, supabase/018). La misma lógica, para el
 * servidor, está en `api/disponibilidad.py`: las dos tienen que coincidir.
 */

export const DIAS_SEMANA = [
  { iso: 1, corto: 'Lun', largo: 'Lunes' },
  { iso: 2, corto: 'Mar', largo: 'Martes' },
  { iso: 3, corto: 'Mié', largo: 'Miércoles' },
  { iso: 4, corto: 'Jue', largo: 'Jueves' },
  { iso: 5, corto: 'Vie', largo: 'Viernes' },
  { iso: 6, corto: 'Sáb', largo: 'Sábado' },
  { iso: 7, corto: 'Dom', largo: 'Domingo' },
];

// La jornada empieza de noche (las salidas de las 22:00) y acaba por la
// mañana: ordenar desde el mediodía deja los turnos como se trabajan, 22:00,
// 23:00, 00:00 … 07:00. Igual que `INICIO_DE_LA_JORNADA` en el backend.
const INICIO_DE_LA_JORNADA = 12 * 60;
const MINUTOS_DIA = 24 * 60;

const enLaJornada = (turno) => {
  const [h, m] = String(turno).split(':').map(Number);
  return (((h * 60 + m) - INICIO_DE_LA_JORNADA) % MINUTOS_DIA + MINUTOS_DIA) % MINUTOS_DIA;
};

export const ordenarTurnos = (turnos) => [...(turnos || [])]
  .sort((a, b) => enLaJornada(a) - enLaJornada(b));

/** Qué se quiere decir con una regla: trabaja todo, descansa o solo algunos turnos. */
export const estadoDe = (turnos) => {
  if (turnos === null || turnos === undefined) return 'trabaja';
  return turnos.length === 0 ? 'descansa' : 'solo';
};

export const listaDeTurnos = (turnos) => {
  const orden = ordenarTurnos(turnos);
  if (orden.length <= 1) return orden.join('');
  return `${orden.slice(0, -1).join(', ')} y ${orden.at(-1)}`;
};

export const textoDeRegla = (turnos) => {
  const estado = estadoDe(turnos);
  if (estado === 'trabaja') return 'Trabaja';
  if (estado === 'descansa') return 'Descansa';
  return `Solo ${listaDeTurnos(turnos)}`;
};

/** La regla de una unidad en la disponibilidad de un día del plan, o `null`. */
export const reglaDe = (disponibilidad, codigo) => disponibilidad?.[fleetKey(codigo)] ?? null;

export const trabajaEn = (regla, turno) => (
  !regla || (regla.turnos || []).some((t) => mismoTurno(turno, t))
);

/**
 * Por qué esa unidad no puede llevar a nadie en ese turno, o `null`. El mismo
 * texto que da el servidor (`motivo_no_disponible`).
 */
export const motivoNoDisponible = (disponibilidad, codigo, turno) => {
  const regla = reglaDe(disponibilidad, codigo);
  if (trabajaEn(regla, turno)) return null;
  const turnos = regla.turnos || [];
  const texto = turnos.length === 0
    ? `La unidad ${codigo} descansa este día`
    : `La unidad ${codigo} solo trabaja a las ${listaDeTurnos(turnos)} este día`;
  const nota = String(regla.nota || '').trim();
  return `${texto}${nota ? ` (${nota}).` : '.'}`;
};

/**
 * Marca los servicios de unidades que no trabajan en su turno ese día.
 *
 * Se marca aquí, una vez, y lo leen la tarjeta, el motor de inserción y el
 * arrastre: así ninguno puede volver a calcularlo distinto.
 */
export const marcarNoDisponibles = (services, disponibilidad) => {
  if (!disponibilidad || Object.keys(disponibilidad).length === 0) return services;
  return services.map((service) => {
    if (!service.asignado || !service.turno) return service;
    const motivo = motivoNoDisponible(disponibilidad, service.conductor, service.turno);
    return motivo ? { ...service, noDisponible: motivo } : service;
  });
};

// --- Para la Flota y su editor ------------------------------------------------

/** 1 lunes … 7 domingo de una fecha 'AAAA-MM-DD', sin que la zona horaria la mueva. */
export const diaIso = (fecha) => {
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return dia === 0 ? 7 : dia;
};

/** Los `n` días desde `desde`, en 'AAAA-MM-DD'. */
export const diasDesde = (desde, n) => {
  const base = new Date(`${desde}T00:00:00Z`);
  return Array.from({ length: n }, (_, k) => {
    const dia = new Date(base);
    dia.setUTCDate(base.getUTCDate() + k);
    return dia.toISOString().slice(0, 10);
  });
};

/** «Sáb 04/10». */
export const etiquetaDeFecha = (fecha) => {
  const [, mes, dia] = fecha.split('-');
  return `${DIAS_SEMANA[diaIso(fecha) - 1].corto} ${dia}/${mes}`;
};

/**
 * Lo que trae `GET /api/programador/disponibilidad`, por unidad:
 * `{ K027: { semana: { 7: [] }, fechas: { '2026-10-04': { turnos, nota } } } }`.
 */
export const indexarDisponibilidad = (datos) => {
  const indice = {};
  const de = (unidad) => {
    indice[unidad] ||= { semana: {}, fechas: {} };
    return indice[unidad];
  };
  for (const fila of datos?.semanal || []) {
    de(fila.unidad).semana[fila.dia] = fila.turnos || [];
  }
  for (const fila of datos?.fechas || []) {
    de(fila.unidad).fechas[fila.fecha] = { turnos: fila.turnos ?? null, nota: fila.nota || null };
  }
  return indice;
};

/** La regla que vale para una unidad un día: la de la fecha, si no la de su semana. */
export const reglaEfectiva = (deLaUnidad, fecha) => {
  const concreta = deLaUnidad?.fechas?.[fecha];
  if (concreta) return { turnos: concreta.turnos, origen: 'fecha', nota: concreta.nota };
  const semanal = deLaUnidad?.semana?.[diaIso(fecha)];
  if (semanal !== undefined) return { turnos: semanal, origen: 'semana', nota: null };
  return { turnos: null, origen: null, nota: null };
};

// Sin importar el orden: la base los devuelve por orden alfabético y el editor
// los tiene en el de la jornada.
const mismos = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  return a.length === b.length && a.every((t) => b.includes(t));
};

/**
 * Lo que cambió en el editor, como lo espera `POST /api/programador/disponibilidad`.
 *
 * `inicial` y `editado` tienen la forma de `indexarDisponibilidad` para una
 * unidad, con las fechas como `{ turnos, nota }`. Una fecha que estaba y ya no
 * está vuelve a su semana («semana»).
 */
export const cambiosDelEditor = (inicial, editado) => {
  const semana = {};
  for (const { iso } of DIAS_SEMANA) {
    const antes = inicial?.semana?.[iso] ?? null;
    const ahora = editado?.semana?.[iso] ?? null;
    if (!mismos(antes, ahora)) semana[iso] = ahora;
  }
  const fechas = [];
  const todas = new Set([
    ...Object.keys(inicial?.fechas || {}), ...Object.keys(editado?.fechas || {}),
  ]);
  for (const fecha of [...todas].sort()) {
    const antes = inicial?.fechas?.[fecha];
    const ahora = editado?.fechas?.[fecha];
    if (!ahora) {
      if (antes) fechas.push({ fecha, turnos: 'semana' });
    } else if (!antes || !mismos(antes.turnos, ahora.turnos)
               || (antes.nota || null) !== (ahora.nota || null)) {
      fechas.push({ fecha, turnos: ahora.turnos, nota: ahora.nota || null });
    }
  }
  return {
    semana: Object.keys(semana).length > 0 ? semana : null,
    fechas,
  };
};

/** Si un cambio del editor toca un día que ya tiene programación. */
export const diasProgramadosAfectados = (cambios, diasConPlan) => {
  const conPlan = (diasConPlan || []).filter(Boolean);
  const semana = new Set(Object.keys(cambios?.semana || {}).map(Number));
  const fechas = new Set((cambios?.fechas || []).map((f) => f.fecha));
  return conPlan.filter((dia) => fechas.has(dia) || semana.has(diaIso(dia)));
};
