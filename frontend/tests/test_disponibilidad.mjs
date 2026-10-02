import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServices } from '../src/programador/model/serviceModel.js';
import { proponer } from '../src/programador/model/motorInsercion.js';
import { comprobarDestino, personaDePendiente } from '../src/programador/model/arrastrePlan.js';
import {
  cambiosDelEditor,
  diaIso,
  diasDesde,
  diasProgramadosAfectados,
  estadoDe,
  etiquetaDeFecha,
  indexarDisponibilidad,
  marcarNoDisponibles,
  motivoNoDisponible,
  ordenarTurnos,
  reglaEfectiva,
  textoDeRegla,
} from '../src/programador/model/disponibilidad.js';

const SEDE = 'TELEPERFORMANCE BELLAVISTA';
const ruta = (conductor, turno, agentes = []) => ({
  conductor, turno, modalidad: 'RECOJO', horario: `${turno} recojo`, micro_zona: 'CLL1',
  sede: SEDE, agentes,
});

// Como llega del plan: por clave normalizada.
const REGLAS = {
  K027: { turnos: [], origen: 'fecha', nota: 'Vacaciones' },
  K030: { turnos: ['03:00', '22:00'], origen: 'semana', nota: null },
};

test('una regla es trabaja todo, descansa o solo algunos turnos', () => {
  assert.equal(estadoDe(null), 'trabaja');
  assert.equal(estadoDe(undefined), 'trabaja');
  assert.equal(estadoDe([]), 'descansa');
  assert.equal(estadoDe(['03:00']), 'solo');
  assert.equal(textoDeRegla(null), 'Trabaja');
  assert.equal(textoDeRegla([]), 'Descansa');
  // En el orden de la jornada, que empieza de noche.
  assert.equal(textoDeRegla(['03:00', '00:00', '22:00']), 'Solo 22:00, 00:00 y 03:00');
});

test('los turnos van en el orden en que se trabajan: de las 22:00 a las 07:00', () => {
  assert.deepEqual(ordenarTurnos(['07:00', '00:00', '23:00', '22:00', '03:00']),
    ['22:00', '23:00', '00:00', '03:00', '07:00']);
});

test('el motivo dice lo mismo que el servidor', () => {
  assert.equal(motivoNoDisponible(REGLAS, 'K-027', '06:00'),
    'La unidad K-027 descansa este día (Vacaciones).');
  assert.equal(motivoNoDisponible(REGLAS, 'K030', '06:00'),
    'La unidad K030 solo trabaja a las 22:00 y 03:00 este día.');
  // 22:00 y 22:01 son el mismo turno; y quien no tiene regla trabaja todo.
  assert.equal(motivoNoDisponible(REGLAS, 'K030', '22:01'), null);
  assert.equal(motivoNoDisponible(REGLAS, 'K028', '06:00'), null);
  assert.equal(motivoNoDisponible({}, 'K027', '06:00'), null);
});

test('se marcan solo los servicios de una unidad en un turno que no trabaja', () => {
  const services = buildServices([
    ruta('K027', '03:00'), ruta('K030', '03:00'), ruta('K030', '06:00'), ruta('K031', '06:00'),
  ]);
  const marcados = marcarNoDisponibles(services, REGLAS);
  assert.deepEqual(marcados.map((s) => Boolean(s.noDisponible)), [true, false, true, false]);
  // Sin reglas no se copia nada: la mesa no vuelve a pintarse por esto.
  assert.equal(marcarNoDisponibles(services, {}), services);
});

test('el motor no propone una unidad que no trabaja ese turno, y lo cuenta', () => {
  const services = marcarNoDisponibles(buildServices([
    ruta('K027', '03:00', [{ id: 'A', lat: -12.0, lng: -77.05 }]),
    ruta('K031', '03:00', [{ id: 'B', lat: -12.01, lng: -77.05 }]),
  ]), REGLAS);
  const propuesta = proponer({
    dni: 'P1', turno: '03:00', modalidad: 'RECOJO', sede: SEDE, lat: -12.0, lng: -77.05,
  }, services);
  assert.deepEqual(propuesta.candidatos.map((c) => c.service.conductor), ['K031']);
  assert.equal(propuesta.descartes.noDisponible, 1);
});

test('arrastrar a una unidad no disponible no se deja, y trae el atajo para cambiarla', () => {
  const [destino] = marcarNoDisponibles(buildServices([ruta('K027', '03:00')]), REGLAS);
  const persona = personaDePendiente({
    dni: 'P1', turno: '03:00', modalidad: 'RECOJO', sede: SEDE,
  });
  const comprobado = comprobarDestino(persona, destino);
  assert.equal(comprobado.permitido, false);
  assert.match(comprobado.motivo, /descansa/);
  assert.deepEqual(comprobado.bloqueo, { unidad: 'K027', turno: '03:00' });
});

test('las fechas se cuentan en el día de Lima, sin que la zona horaria las mueva', () => {
  assert.equal(diaIso('2026-10-04'), 7); // domingo
  assert.equal(diaIso('2026-10-05'), 1); // lunes
  assert.deepEqual(diasDesde('2026-10-30', 4), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(etiquetaDeFecha('2026-10-03'), 'Sáb 03/10');
});

test('una fecha manda sobre su semana, también la que dice «trabaja todo»', () => {
  const indice = indexarDisponibilidad({
    semanal: [{ unidad: 'K027', dia: 7, turnos: [] }, { unidad: 'K027', dia: 6, turnos: ['03:00'] }],
    fechas: [
      { unidad: 'K027', fecha: '2026-10-11', turnos: null, nota: null }, // un domingo que sí trabaja
      { unidad: 'K027', fecha: '2026-10-06', turnos: [], nota: 'Médico' },
    ],
  });
  const k027 = indice.K027;
  assert.deepEqual(reglaEfectiva(k027, '2026-10-04'), { turnos: [], origen: 'semana', nota: null });
  assert.deepEqual(reglaEfectiva(k027, '2026-10-11'), { turnos: null, origen: 'fecha', nota: null });
  assert.deepEqual(reglaEfectiva(k027, '2026-10-06'), { turnos: [], origen: 'fecha', nota: 'Médico' });
  assert.deepEqual(reglaEfectiva(k027, '2026-10-07'), { turnos: null, origen: null, nota: null });
  assert.deepEqual(reglaEfectiva(undefined, '2026-10-07'), { turnos: null, origen: null, nota: null });
});

test('el editor manda solo lo que cambió, y quitar una fecha la devuelve a su semana', () => {
  const inicial = {
    semana: { 7: [], 6: ['22:00', '03:00'] },
    fechas: { '2026-10-06': { turnos: [], nota: 'Médico' }, '2026-10-08': { turnos: ['03:00'], nota: null } },
  };
  const editado = {
    // El sábado, los mismos turnos en otro orden: no es un cambio.
    semana: { 7: [], 6: ['03:00', '22:00'], 1: [] },
    fechas: { '2026-10-08': { turnos: ['03:00'], nota: null }, '2026-10-09': { turnos: null, nota: null } },
  };
  assert.deepEqual(cambiosDelEditor(inicial, editado), {
    semana: { 1: [] },
    fechas: [
      { fecha: '2026-10-06', turnos: 'semana' },
      { fecha: '2026-10-09', turnos: null, nota: null },
    ],
  });
  assert.deepEqual(cambiosDelEditor(inicial, inicial), { semana: null, fechas: [] });
  // Quitar el descanso del domingo es volver a trabajar todo (null).
  assert.deepEqual(cambiosDelEditor(inicial, { ...inicial, semana: { 6: ['22:00', '03:00'] } }).semana,
    { 7: null });
});

test('se avisa de los días ya programados que tocará guardar', () => {
  const conPlan = ['2026-10-04', '2026-10-05', '2026-10-06'];
  // Cambia el domingo de su semana y el martes 6 suelto.
  const cambios = { semana: { 7: [] }, fechas: [{ fecha: '2026-10-06', turnos: [] }] };
  assert.deepEqual(diasProgramadosAfectados(cambios, conPlan), ['2026-10-04', '2026-10-06']);
  assert.deepEqual(diasProgramadosAfectados({ semana: null, fechas: [] }, conPlan), []);
});
