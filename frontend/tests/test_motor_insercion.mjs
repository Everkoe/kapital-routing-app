import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServices, indexFleet } from '../src/programador/model/serviceModel.js';
import {
  cambiosDeLaTanda,
  cambiosParaAsignar,
  distanciaKm,
  mejorPosicion,
  mismoTurno,
  proponer,
  proponerTodas,
} from '../src/programador/model/motorInsercion.js';

// Tres puntos en línea recta, de norte a sur, a ~1,1 km uno de otro.
const NORTE = { lat: -12.00, lng: -77.05 };
const CENTRO = { lat: -12.01, lng: -77.05 };
const SUR = { lat: -12.02, lng: -77.05 };
const LEJOS = { lat: -12.20, lng: -77.05 };

const FLOTA = { flota: [{ unidad_id: 'K-027', capacidad: 4 }] };

const agente = (id, punto = {}) => ({ id, nombre: `Agente ${id}`, ...punto });

const ruta = (conductor, extra) => ({
  conductor,
  micro_zona: 'CLL1',
  turno: '05:00',
  modalidad: 'RECOJO',
  horario: '05:00 recojo',
  sede: 'TELEPERFORMANCE BELLAVISTA',
  agentes: [],
  ...extra,
});

const pendiente = (extra) => ({
  dni: 'P1',
  turno: '05:00',
  modalidad: 'RECOJO',
  cobertura: 'CLL1',
  sede: 'TELEPERFORMANCE BELLAVISTA',
  ...CENTRO,
  habituales: [],
  motivo: 'cambio',
  ...extra,
});

const servicios = (rutas) => buildServices(rutas, indexFleet(FLOTA));

test('la distancia es la de la esfera, no la del plano', () => {
  assert.ok(Math.abs(distanciaKm(NORTE, CENTRO) - 1.112) < 0.01);
});

test('un minuto de diferencia es el mismo turno, quince no', () => {
  // La intranet escribe las salidas habituales como 22:01 y las novedades las
  // piden a las 22:00: sin esta tolerancia el motor no veía la salida de las
  // 22:01, que son 457 servicios frente a 26.
  assert.equal(mismoTurno('22:00', '22:01'), true);
  assert.equal(mismoTurno('22:00', '22:15'), false);
  assert.equal(mismoTurno('23:59', '00:00'), true, 'también a través de medianoche');
  assert.equal(mismoTurno('05:00', null), false);
});

test('inserta entre las dos paradas que menos se desvían', () => {
  const r = mejorPosicion([agente('A', NORTE), agente('B', SUR)], CENTRO);

  assert.equal(r.posicion, 1, 'entre el norte y el sur');
  assert.ok(r.desvioKm < 0.01, 'está justo en el camino');
});

test('un agente sin ubicación no rompe el cálculo ni pierde su sitio', () => {
  const r = mejorPosicion(
    [agente('A', NORTE), agente('X'), agente('B', SUR)],
    CENTRO,
  );

  assert.ok(r.posicion === 1 || r.posicion === 2);
  assert.ok(r.desvioKm < 0.01);
});

test('solo propone servicios del mismo turno, sentido y sede', () => {
  const r = proponer(pendiente(), servicios([
    ruta('V100', { agentes: [agente('A', NORTE)] }),
    ruta('V101', { turno: '06:00', horario: '06:00 recojo', agentes: [agente('B', NORTE)] }),
    ruta('V102', { modalidad: 'SALIDA', horario: '05:00 salida', agentes: [agente('C', NORTE)] }),
    ruta('V103', { sede: 'TELEPERFORMANCE MAGDALENA', agentes: [agente('D', NORTE)] }),
  ]));

  assert.deepEqual(r.candidatos.map((c) => c.service.conductor), ['V100']);
  assert.equal(r.descartes.otraSede, 1);
});

test('no propone un servicio lleno, ni por capacidad declarada ni por la observada', () => {
  const r = proponer(pendiente(), servicios([
    // K-027 declara 4 y ya lleva 4.
    ruta('K027', { agentes: ['A', 'B', 'C', 'D'].map((id) => agente(id, NORTE)) }),
    // Sin capacidad declarada, pero nunca ha llevado más de 2.
    ruta('V200', { max_llevado: 2, agentes: ['E', 'F'].map((id) => agente(id, NORTE)) }),
    ruta('V201', { max_llevado: 6, agentes: [agente('G', NORTE)] }),
  ]));

  assert.deepEqual(r.candidatos.map((c) => c.service.conductor), ['V201']);
  assert.equal(r.descartes.llenos, 2);
  assert.equal(r.candidatos[0].plazas.fuente, 'observada');
});

test('su zona va antes que un desvío menor en otra', () => {
  const r = proponer(pendiente(), servicios([
    ruta('V300', { micro_zona: 'CLL2', max_llevado: 6, agentes: [agente('A', CENTRO)] }),
    ruta('V301', { max_llevado: 6, agentes: [agente('B', LEJOS)] }),
  ]));

  assert.deepEqual(r.candidatos.map((c) => c.service.conductor), ['V301', 'V300']);
  assert.equal(r.candidatos[0].mismaZona, true);
});

test('marca su unidad habitual, con el código escrito como sea', () => {
  const r = proponer(pendiente({ habituales: ['V-400'] }), servicios([
    ruta('V400', { max_llevado: 6, agentes: [agente('A', NORTE)] }),
  ]));

  assert.equal(r.candidatos[0].habitual, true);
});

test('sin ubicación propone igual, ordenado por plazas libres y avisándolo', () => {
  const r = proponer(pendiente({ lat: null, lng: null }), servicios([
    ruta('V500', { max_llevado: 3, agentes: [agente('A', NORTE), agente('B', NORTE)] }),
    ruta('V501', { max_llevado: 8, agentes: [agente('C', NORTE)] }),
  ]));

  assert.equal(r.sinUbicacion, true);
  assert.deepEqual(r.candidatos.map((c) => c.service.conductor), ['V501', 'V500']);
  assert.equal(r.candidatos[0].desvioKm, null);
});

test('sin turno o sentido no hay nada que proponer, y lo dice', () => {
  const r = proponer(pendiente({ turno: null }), servicios([ruta('V600', {})]));

  assert.equal(r.estado, 'sin_turno');
  assert.deepEqual(r.candidatos, []);
});

test('asignar es agregar y dejar el orden con la persona en su sitio', () => {
  const [service] = servicios([
    ruta('V700', { max_llevado: 6, agentes: [agente('A', NORTE), agente('B', SUR)] }),
  ]);
  const { candidatos: [candidato] } = proponer(pendiente(), [service]);

  const cambios = cambiosParaAsignar(pendiente(), candidato);

  assert.deepEqual(cambios, [
    { accion: 'agregar', dni: 'P1', vehiculo: 'V700', turno: '05:00',
      modalidad: 'RECOJO', cobertura: 'CLL1', origen: 'novedad' },
    { accion: 'ordenar', vehiculo: 'V700', turno: '05:00', modalidad: 'RECOJO',
      dnis: ['A', 'P1', 'B'] },
  ]);
});

test('en tanda, el último sitio es para quien no tiene otro', () => {
  // P1 (05:00) puede ir en V800 o en V802 y prefiere V800, que le queda más
  // cerca. P2 (05:01) solo cabe en V800: V802 sale a las 04:59, a dos minutos.
  // Atendiendo por orden de llegada, P1 se quedaría V800 y P2 fuera. Hay que
  // empezar por quien menos opciones tiene.
  const rutas = servicios([
    ruta('V800', { max_llevado: 2, agentes: [agente('A', NORTE)] }),
    ruta('V802', { max_llevado: 2, turno: '04:59', horario: '04:59 recojo',
      agentes: [agente('B', LEJOS)] }),
  ]);
  const p1 = pendiente({ dni: 'P1', turno: '05:00' });
  const p2 = pendiente({ dni: 'P2', turno: '05:01' });

  const tanda = proponerTodas([p1, p2], rutas);
  const destino = Object.fromEntries(
    tanda.map((t) => [t.pendiente.dni, t.elegido?.service.conductor ?? null]));

  assert.deepEqual(destino, { P1: 'V802', P2: 'V800' });
});

test('en tanda, dos personas en el mismo servicio quedan las dos en el orden', () => {
  // P2 solo cabe en V900; P1 también podría ir en V901. El motor atiende
  // primero a P2 aunque en la lista vaya segunda, y los dos acaban en V900: es
  // el caso en que aplicar los cambios en el orden de la lista rompe el orden.
  const rutas = servicios([
    ruta('V900', { max_llevado: 6, agentes: [agente('A', NORTE), agente('B', SUR)] }),
    ruta('V901', { max_llevado: 6, turno: '04:59', horario: '04:59 recojo',
      agentes: [agente('C', LEJOS)] }),
  ]);

  const tanda = proponerTodas(
    [pendiente({ dni: 'P1', turno: '05:00', ...CENTRO }),
      pendiente({ dni: 'P2', turno: '05:01', ...CENTRO })],
    rutas,
  );
  assert.deepEqual(tanda.map((t) => t.elegido.service.conductor), ['V900', 'V900']);
  assert.deepEqual(tanda.map((t) => t.paso), [1, 0], 'P2 se atiende primero');
  const cambios = cambiosDeLaTanda(tanda);
  const ordenes = cambios.filter((c) => c.accion === 'ordenar');

  // El último `ordenar` del servicio manda, así que tiene que traer a todos.
  assert.deepEqual([...ordenes.at(-1).dnis].sort(), ['A', 'B', 'P1', 'P2']);
  // Y cada `ordenar` llega después del `agregar` de todos los que nombra.
  cambios.forEach((c, i) => {
    if (c.accion !== 'ordenar') return;
    const agregados = new Set(cambios.slice(0, i)
      .filter((x) => x.accion === 'agregar').map((x) => x.dni));
    c.dnis.filter((d) => d.startsWith('P'))
      .forEach((d) => assert.ok(agregados.has(d), `${d} se ordena antes de agregarse`));
  });
});
