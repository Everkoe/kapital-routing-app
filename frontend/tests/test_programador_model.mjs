import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPendingAgents,
  buildServices,
  indexFleet,
  resolveCapacity,
  UNASSIGNED,
} from '../src/programador/model/serviceModel.js';
import {
  ALL,
  applyFilters,
  computeKpis,
  emptyFilters,
  filterOptions,
  sortServices,
} from '../src/programador/model/workbenchSelectors.js';

// La flota real declara unidades de distinta capacidad. Ese es justamente el
// dato que el tablero anterior ignoraba al escribir 15 a mano.
const FLOTA = {
  flota: [
    { unidad_id: 'KAP-001', capacidad: 12, chofer: 'Juan Pérez' },
    { unidad_id: 'KAP-002', capacidad: 15, chofer: 'Carlos Gómez' },
    { unidad_id: 'KAP-003', capacidad: 10, chofer: 'Luis Ramírez' },
  ],
};

const agente = (id, extra = {}) => ({
  id,
  nombre: `Agente ${id}`,
  direccion: `Calle ${id}`,
  lat: -12.04,
  lng: -77.04,
  empresa: 'KAPITAL',
  ...extra,
});

const ruta = (conductor, micro_zona, horario, agentes) => ({
  conductor,
  micro_zona,
  horario,
  agentes,
});

test('la capacidad sale de la unidad, nunca de una constante', () => {
  const fleet = indexFleet(FLOTA);

  assert.equal(resolveCapacity('KAP-003', 9, fleet).total, 10);
  assert.equal(resolveCapacity('KAP-003', 9, fleet).free, 1);
  assert.equal(resolveCapacity('KAP-001', 9, fleet).total, 12);
  assert.equal(resolveCapacity('KAP-002', 9, fleet).total, 15);
});

test('una unidad desconocida no inventa un total: informa que no lo sabe', () => {
  const capacity = resolveCapacity('KAP-999', 7, indexFleet(FLOTA));

  assert.equal(capacity.known, false);
  assert.equal(capacity.total, null);
  assert.equal(capacity.free, null);
  assert.equal(capacity.used, 7);
});

test('detecta el exceso de capacidad en vez de recortarlo en silencio', () => {
  const capacity = resolveCapacity('KAP-003', 12, indexFleet(FLOTA));

  assert.equal(capacity.over, true);
  assert.equal(capacity.full, true);
  assert.equal(capacity.free, 0, 'los espacios libres nunca son negativos');
});

test('la identidad del servicio no depende del orden del array', () => {
  const routes = [
    ruta('KAP-001', 'SJM', '16:30', [agente('A1')]),
    ruta('KAP-002', 'Ate', '12:30', [agente('A2')]),
  ];

  const enOrden = buildServices(routes, indexFleet(FLOTA));
  const invertido = buildServices([...routes].reverse(), indexFleet(FLOTA));

  assert.deepEqual(
    enOrden.map((s) => s.id).sort(),
    invertido.map((s) => s.id).sort(),
    'reordenar la entrada no puede cambiar a qué servicio apunta una acción',
  );
});

test('dos rutas con los mismos datos de negocio reciben identidades distintas', () => {
  const services = buildServices(
    [
      ruta('KAP-001', 'SJM', '16:30', [agente('A1')]),
      ruta('KAP-001', 'SJM', '16:30', [agente('A2')]),
    ],
    indexFleet(FLOTA),
  );

  assert.equal(services.length, 2);
  assert.notEqual(services[0].id, services[1].id);
});

test('no produce estados que el backend todavía no puede respaldar', () => {
  const services = buildServices(
    [
      ruta('KAP-001', 'SJM', '16:30', [agente('A1')]),
      ruta('KAP-003', 'Ate', '12:30', Array.from({ length: 10 }, (_, i) => agente(`B${i}`))),
      ruta(UNASSIGNED, 'Callao', '18:00', [agente('C1')]),
    ],
    indexFleet(FLOTA),
  );

  const estados = services.map((s) => s.estado);
  assert.deepEqual(estados, ['programado', 'completo', 'sin_asignar']);
  for (const estado of estados) {
    assert.ok(
      !['modificado', 'pendiente', 'aprobado', 'rechazado'].includes(estado),
      'sin motor de optimización ni flujo de aprobación, esos estados serían simulados',
    );
  }
});

test('una entrada malformada se descarta sin tumbar el tablero', () => {
  const services = buildServices(
    [null, 'basura', { conductor: 'KAP-001' }, ruta('KAP-002', 'SJM', '16:30', [agente('A1')])],
    indexFleet(FLOTA),
  );

  assert.equal(services.length, 2, 'la ruta sin agentes es válida; null y string no');
  assert.equal(services[0].agentCount, 0);
});

test('los agentes sin unidad alimentan el panel de novedades con su motivo real', () => {
  const services = buildServices(
    [
      ruta(UNASSIGNED, 'Callao', '18:00', [
        agente('SIN-GPS', { lat: null, lng: null }),
        agente('SIN-DIR', { direccion: '' }),
        agente('OK'),
      ]),
      ruta('KAP-001', 'SJM', '16:30', [agente('ASIGNADO')]),
    ],
    indexFleet(FLOTA),
  );

  const pendientes = buildPendingAgents(services);

  assert.equal(pendientes.length, 3, 'solo los de rutas SIN ASIGNAR');
  assert.deepEqual(
    pendientes.map((p) => p.motivo),
    ['sin_ubicacion', 'direccion_incompleta', 'sin_unidad'],
  );
});

test('los KPI separan la capacidad conocida de la que no lo es', () => {
  const kpis = computeKpis(
    buildServices(
      [
        ruta('KAP-003', 'SJM', '16:30', [agente('A1'), agente('A2')]), // 2 de 10
        ruta('KAP-999', 'Ate', '12:30', [agente('B1')]), // capacidad desconocida
        ruta(UNASSIGNED, 'Callao', '18:00', [agente('C1'), agente('C2')]),
      ],
      indexFleet(FLOTA),
    ),
  );

  assert.equal(kpis.servicios, 3);
  assert.equal(kpis.agentesAsignados, 3);
  assert.equal(kpis.agentesSinAsignar, 2);
  assert.equal(kpis.capacidadLibre, 8, 'solo suma unidades que declaran capacidad');
  assert.equal(kpis.capacidadDesconocida, 1, 'y dice cuántas quedaron fuera del cálculo');
});

test('la búsqueda encuentra por agente, no solo por servicio', () => {
  const services = buildServices(
    [
      ruta('KAP-001', 'SJM', '16:30', [agente('A1', { nombre: 'Jimena Castillo' })]),
      ruta('KAP-002', 'Ate', '12:30', [agente('B1', { nombre: 'Otro' })]),
    ],
    indexFleet(FLOTA),
  );

  const porNombre = applyFilters(services, { ...emptyFilters(), query: 'jimena' });
  assert.equal(porNombre.length, 1);
  assert.equal(porNombre[0].conductor, 'KAP-001');

  const porDireccion = applyFilters(services, { ...emptyFilters(), query: 'calle b1' });
  assert.equal(porDireccion.length, 1);
  assert.equal(porDireccion[0].conductor, 'KAP-002');
});

test('los filtros se combinan y el filtro vacío no oculta nada', () => {
  const services = buildServices(
    [
      ruta('KAP-001', 'SJM', '16:30', [agente('A1')]),
      ruta('KAP-002', 'SJM', '12:30', [agente('B1')]),
      ruta(UNASSIGNED, 'Ate', '12:30', [agente('C1')]),
    ],
    indexFleet(FLOTA),
  );

  assert.equal(applyFilters(services, emptyFilters()).length, 3);
  assert.equal(applyFilters(services, { ...emptyFilters(), microZona: 'SJM' }).length, 2);
  assert.equal(
    applyFilters(services, { ...emptyFilters(), microZona: 'SJM', horario: '12:30' }).length,
    1,
  );
  assert.equal(applyFilters(services, { ...emptyFilters(), asignacion: 'sin_asignar' }).length, 1);
});

test('las opciones de filtro salen de los datos y no se repiten', () => {
  const options = filterOptions(
    buildServices(
      [
        ruta('KAP-001', 'SJM', '16:30', []),
        ruta('KAP-002', 'SJM', '12:30', []),
        ruta('KAP-003', 'Ate', '12:30', []),
      ],
      indexFleet(FLOTA),
    ),
  );

  assert.deepEqual(options.microZonas, ['Ate', 'SJM']);
  assert.deepEqual(options.horarios, ['12:30', '16:30']);
});

test('el orden es cronológico y deja lo no asignado al final', () => {
  const services = buildServices(
    [
      ruta(UNASSIGNED, 'Callao', '08:00', [agente('C1')]),
      ruta('KAP-001', 'SJM', '16:30', [agente('A1')]),
      ruta('KAP-002', 'Ate', '09:00', [agente('B1')]),
    ],
    indexFleet(FLOTA),
  );

  assert.deepEqual(
    sortServices(services).map((s) => s.horario),
    ['09:00', '16:30', '08:00'],
  );
});

test('ALL es un centinela que ningún dato real puede igualar por accidente', () => {
  assert.equal(emptyFilters().microZona, ALL);
  assert.ok(ALL.startsWith('__') && ALL.endsWith('__'));
});
