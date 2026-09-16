import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServices, indexFleet, UNASSIGNED } from '../src/programador/model/serviceModel.js';
import {
  capacityAnalysis,
  capacityDistribution,
  dataQuality,
  fleetWithLoad,
  zoneBreakdown,
} from '../src/programador/model/analytics.js';

const FLOTA = indexFleet({
  flota: [
    { unidad_id: 'K-001', capacidad: 4, chofer: 'Uno' },
    { unidad_id: 'K-002', capacidad: 4, chofer: 'Dos' },
    { unidad_id: 'K-003', capacidad: 10, chofer: 'Tres' },
    { unidad_id: 'K-004', capacidad: null, chofer: 'Cuatro' },
  ],
});

const agente = (id, extra = {}) => ({
  id,
  nombre: `Agente ${id}`,
  direccion: `Calle ${id}`,
  lat: -12.04,
  lng: -77.04,
  empresa: 'KAPITAL BUSINESS',
  ...extra,
});

const ruta = (conductor, micro_zona, horario, agentes) => ({ conductor, micro_zona, horario, agentes });

/** Reproduce el patrón real: una unidad «llena» de duplicados. */
const TABLERO = buildServices(
  [
    // 4/4 ocupados, pero solo 2 personas.
    ruta('K-001', 'CALLAO', '00:00', [agente('A'), agente('B'), agente('A'), agente('B')]),
    // 3/4, sin repetidos.
    ruta('K-002', 'CALLAO', '00:00', [agente('C'), agente('D'), agente('E')]),
    // 2/10.
    ruta('K-003', 'BELLAVISTA', '00:00', [agente('F'), agente('G')]),
    // Pendientes: «A» ya va montada en K-001.
    ruta(UNASSIGNED, 'BELLAVISTA', '00:00', [agente('A'), agente('H')]),
  ],
  FLOTA,
);

test('separa registros de personas, que es donde el tablero engaña', () => {
  const q = dataQuality(TABLERO);

  assert.equal(q.registros, 11, 'once registros de pasajero');
  assert.equal(q.personas, 8, 'pero solo ocho personas distintas');
  assert.equal(q.registrosDuplicados, 2, 'dos registros sobran en K-001');
  assert.equal(q.serviciosConRepetidos, 1);
  assert.equal(q.serviciosTotales, 4);
});

test('detecta a quien está a la vez asignado y pendiente', () => {
  const q = dataQuality(TABLERO);

  // «A» viaja en K-001 y además figura en la lista de pendientes. No es un
  // estado válido: el Programador la trataría dos veces.
  assert.equal(q.personasEnAmbosEstados, 1);
  assert.equal(q.personasAsignadas, 7);
  assert.equal(q.personasPendientes, 2);
});

test('cuantifica la capacidad que los duplicados esconden', () => {
  const c = capacityAnalysis(TABLERO);

  assert.equal(c.unidades, 3, 'solo las asignadas con capacidad declarada');
  assert.equal(c.capacidadTotal, 18, '4 + 4 + 10');
  assert.equal(c.ocupadosPorRegistro, 9);
  assert.equal(c.ocupadosPorPersona, 7, 'K-001 lleva 2 personas, no 4');
  assert.equal(c.libresActuales, 9, 'lo que muestra el tablero hoy');
  assert.equal(c.libresSiSeDeduplica, 11, 'lo que habría sin registros repetidos');
  assert.equal(c.llenas, 1);
  assert.equal(c.sobreCapacidad, 0);
});

test('una unidad sin capacidad declarada se informa aparte, no se asume', () => {
  const servicios = buildServices(
    [ruta('K-004', 'ATE', '00:00', [agente('X')]), ruta('K-003', 'ATE', '00:00', [agente('Y')])],
    FLOTA,
  );
  const c = capacityAnalysis(servicios);

  assert.equal(c.sinCapacidadDeclarada, 1);
  assert.equal(c.unidades, 1, 'no entra en los totales');
  assert.equal(c.capacidadTotal, 10);
});

test('la distribución por zona separa registros de personas', () => {
  const zonas = zoneBreakdown(TABLERO);

  const callao = zonas.find((z) => z.zona === 'CALLAO');
  assert.equal(callao.servicios, 2);
  assert.equal(callao.registros, 7);
  assert.equal(callao.personas, 5, 'A, B, C, D, E');

  const bellavista = zonas.find((z) => z.zona === 'BELLAVISTA');
  assert.equal(bellavista.pendientes, 2, 'los registros sin unidad de esa zona');
});

test('una zona con espacio final no se cuenta dos veces', () => {
  // La base real trae «BELLAVISTA» y «BELLAVISTA » como zonas distintas.
  const servicios = buildServices(
    [
      ruta('K-001', 'BELLAVISTA', '00:00', [agente('A')]),
      ruta('K-002', 'BELLAVISTA ', '00:00', [agente('B')]),
    ],
    FLOTA,
  );

  const zonas = zoneBreakdown(servicios);
  assert.equal(zonas.length, 1, 'el espacio sobrante no crea una zona nueva');
  assert.equal(zonas[0].servicios, 2);
});

test('el reparto de capacidades ordena y agrupa la flota', () => {
  const dist = capacityDistribution(FLOTA);

  assert.deepEqual(dist, [
    { capacidad: 4, unidades: 2 },
    { capacidad: 10, unidades: 1 },
    { capacidad: null, unidades: 1 },
  ]);
  assert.equal(dist.at(-1).capacidad, null, 'lo desconocido va al final');
});

test('cruza flota y tablero, y señala las unidades sin ruta', () => {
  const unidades = fleetWithLoad(FLOTA, TABLERO);

  const k1 = unidades.find((u) => u.unidad_id === 'K-001');
  assert.equal(k1.registros, 4);
  assert.equal(k1.personas, 2);
  assert.equal(k1.libres, 0, 'por registros, que es como opera hoy');

  const k4 = unidades.find((u) => u.unidad_id === 'K-004');
  assert.equal(k4.sinUsar, true);
  assert.equal(k4.libres, null, 'sin capacidad declarada no hay libres que calcular');
});

test('no revienta con entradas vacías o inválidas', () => {
  for (const entrada of [null, undefined, [], 'basura']) {
    assert.equal(dataQuality(entrada).registros, 0);
    assert.equal(capacityAnalysis(entrada).unidades, 0);
    assert.deepEqual(zoneBreakdown(entrada), []);
  }
  assert.deepEqual(capacityDistribution(null), []);
  assert.deepEqual(fleetWithLoad(null, null), []);
});
