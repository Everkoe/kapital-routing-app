import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPendingAgents,
  buildServices,
  distinctDocuments,
  indexFleet,
  markDuplicates,
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
import { derivePlanRouteChanges } from '../src/programador/data/useBoardData.js';

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

test('los agentes sin asignar incluyen a los que el plan dejó por colocar', () => {
  // Sobre un plan no hay servicios huérfanos: quien se queda fuera sale de
  // todo servicio y pasa a pendientes. Sin contarlos, el KPI daba cero justo
  // después de aplicar las novedades, que es cuando tiene algo que decir.
  const services = buildServices(
    [ruta('KAP-003', 'SJM', '16:30', [agente('A1'), agente('A2')])],
    indexFleet(FLOTA),
  );

  assert.equal(computeKpis(services).agentesSinAsignar, 0);
  assert.equal(computeKpis(services, 4).agentesSinAsignar, 4);
  assert.equal(computeKpis(services, 4).agentesAsignados, 2,
    'los pendientes no se cuentan dos veces');
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

test('un documento repetido dentro del mismo servicio no colisiona', () => {
  // Los datos reales traen DNIs duplicados. Dos entradas con la misma clave
  // hacen que React omita filas sin avisar al usuario.
  const services = buildServices(
    [
      ruta(UNASSIGNED, 'LA MOLINA', '00:00', [
        agente('79626052'),
        agente('79626052'),
        agente('77700962'),
      ]),
    ],
    indexFleet(FLOTA),
  );

  const pendientes = buildPendingAgents(services);
  const ids = pendientes.map((p) => p.id);

  assert.equal(pendientes.length, 3, 'ninguna entrada se pierde');
  assert.equal(new Set(ids).size, 3, 'y ninguna clave se repite');
  assert.deepEqual(
    pendientes.map((p) => p.duplicado),
    [false, true, false],
    'el duplicado queda marcado para poder mostrarlo',
  );
});

test('marca los documentos repetidos de un servicio sin eliminarlos', () => {
  // Caso real: K-027 figura «4/4 · Unidad completa» llevando dos personas,
  // cada una repetida. Deduplicar sería una decisión de negocio que nadie ha
  // tomado; borrar pasajeros por iniciativa propia es peor que señalarlos.
  const agentes = [agente('78007498'), agente('77152526'), agente('78007498'), agente('77152526')];

  const marcados = markDuplicates(agentes);

  assert.equal(marcados.length, 4, 'no se elimina ninguno');
  assert.deepEqual(marcados.map((a) => a.duplicado), [false, false, true, true]);
  assert.equal(distinctDocuments(agentes), 2, 'dos personas reales en una unidad "llena"');
});

test('un documento vacío no se considera repetido de otro vacío', () => {
  const marcados = markDuplicates([agente(''), agente('')]);

  assert.deepEqual(
    marcados.map((a) => a.duplicado),
    [false, false],
    'sin documento no hay identidad que comparar',
  );
  assert.equal(distinctDocuments([agente(''), agente('')]), 0);
});

test('un agente con ubicación de respaldo se trata como sin ubicación', () => {
  // El backend marca `ubicacion_estimada` cuando la fila no traía coordenada
  // legible. Sin honrar esa marca, el agente llegaba con coordenadas válidas
  // —las del punto de respaldo— y pasaba por bien ubicado.
  const services = buildServices(
    [
      ruta(UNASSIGNED, 'CALLAO', '00:00', [
        agente('CON-GPS'),
        { ...agente('RESPALDO'), ubicacion_estimada: true },
      ]),
    ],
    indexFleet(FLOTA),
  );

  assert.deepEqual(
    buildPendingAgents(services).map((p) => p.motivo),
    ['sin_unidad', 'sin_ubicacion'],
  );
});

test('ALL es un centinela que ningún dato real puede igualar por accidente', () => {
  assert.equal(emptyFilters().microZona, ALL);
  assert.ok(ALL.startsWith('__') && ALL.endsWith('__'));
});

test('el padrón se busca con guion o sin él: es el mismo vehículo', () => {
  // La flota lo registra como «K-027» y el histórico de la intranet como
  // «K027». Quien busca su unidad la escribe como está impresa, con guion, y
  // antes no encontraba nada.
  const services = buildServices(
    [ruta('K027', 'CALLAO', '03:00 recojo', [agente('A1')])],
    indexFleet(FLOTA),
  );

  for (const query of ['K-027', 'K027', 'k 027', 'k-027']) {
    assert.equal(
      applyFilters(services, { ...emptyFilters(), query }).length, 1,
      `no encontró la unidad buscando «${query}»`,
    );
  }
  assert.equal(
    applyFilters(services, { ...emptyFilters(), query: 'K-028' }).length, 0,
    'no debe encontrar una unidad distinta',
  );
});

test('el filtro de novedad separa lo modificado de lo que sigue igual', () => {
  // «Modificado» no es una etiqueta del archivo: sale de comparar los
  // documentos del servicio contra los del día cargado anterior.
  const services = buildServices(
    [
      { ...ruta('K027', 'CALLAO', '03:00', [agente('A1')]),
        cambio: { modificado: true, nuevos: 1, salieron: [], servicio_nuevo: false } },
      { ...ruta('K142', 'CALLAO', '04:00', [agente('A2')]),
        cambio: { modificado: false, nuevos: 0, salieron: [], servicio_nuevo: false } },
    ],
    indexFleet(FLOTA),
  );

  assert.equal(services[0].modificado, true);
  assert.equal(services[1].modificado, false);
  assert.equal(
    applyFilters(services, { ...emptyFilters(), cambio: 'modificados' }).length, 1);
  assert.equal(
    applyFilters(services, { ...emptyFilters(), cambio: 'sin_cambio' }).length, 1);
  assert.equal(applyFilters(services, emptyFilters()).length, 2);
});

test('un servicio sin información de cambio no se declara modificado', () => {
  const services = buildServices(
    [ruta('K027', 'CALLAO', '03:00', [agente('A1')])], indexFleet(FLOTA));
  assert.equal(services[0].modificado, false);
  assert.equal(services[0].cambio, null);
});

test('una letra sola busca el padrón, no a todos los que la llevan en el nombre', () => {
  // Escribir «K» devolvía 96 de 135 servicios porque hay agentes que se
  // llaman KEIKO o KAROL. Quien escribe una letra está mirando sus unidades.
  const services = buildServices(
    [
      ruta('K027', 'CALLAO', '03:00', [agente('A1')]),
      ruta('K142', 'CALLAO', '04:00', [agente('A2')]),
      { ...ruta('V026', 'BLL', '05:00', [agente('A3')]),
        agentes: [{ id: 'A3', nombre: 'KEIKO BARBARAN', direccion: 'CALLE K 1' }] },
    ],
    indexFleet(FLOTA),
  );

  const porK = applyFilters(services, { ...emptyFilters(), query: 'K' });
  assert.deepEqual(porK.map((s) => s.conductor), ['K027', 'K142']);

  const porV = applyFilters(services, { ...emptyFilters(), query: 'V' });
  assert.deepEqual(porV.map((s) => s.conductor), ['V026']);

  const porPrefijo = applyFilters(services, { ...emptyFilters(), query: 'K0' });
  assert.deepEqual(porPrefijo.map((s) => s.conductor), ['K027']);
});

test('lo que no es un padrón se sigue buscando en agentes y direcciones', () => {
  // Los padrones son una letra y tres dígitos, así que «KEIKO» no es prefijo
  // de ninguno y cae por su propio peso en la búsqueda general.
  const services = buildServices(
    [
      ruta('K027', 'CALLAO', '03:00', [agente('A1')]),
      { ...ruta('V026', 'BLL', '05:00', [agente('A3')]),
        agentes: [{ id: 'A3', nombre: 'KEIKO BARBARAN', direccion: 'JR LIMA 540' }] },
    ],
    indexFleet(FLOTA),
  );

  assert.deepEqual(
    applyFilters(services, { ...emptyFilters(), query: 'keiko' }).map((s) => s.conductor),
    ['V026'],
  );
  assert.deepEqual(
    applyFilters(services, { ...emptyFilters(), query: 'jr lima' }).map((s) => s.conductor),
    ['V026'],
  );
});

test('los retirados viajan aparte y no cuentan como ocupación', () => {
  // Un retirado no ocupa asiento, pero tampoco se borra: el día siguiente
  // necesita saber que alguien iba a viajar y se cayó.
  const services = buildServices(
    [{
      ...ruta('K027', 'CALLAO', '03:00', [agente('A1'), agente('A2')]),
      retirados: [{ id: 'A9', nombre: 'QUIEN SE CAYO', nota: 'Baja del cliente' }],
    }],
    indexFleet(FLOTA),
  );

  assert.equal(services[0].agentCount, 2, 'solo cuentan los que viajan');
  assert.equal(services[0].capacity.used, 2);
  assert.equal(services[0].retirados.length, 1);
  assert.equal(services[0].retirados[0].nombre, 'QUIEN SE CAYO');
});

test('sin retirados el campo es una lista vacía, no undefined', () => {
  // La tarjeta hace `service.retirados?.length`; devolver undefined obligaría
  // a que cada consumidor se acordara del interrogante.
  const services = buildServices(
    [ruta('K027', 'CALLAO', '03:00', [agente('A1')])], indexFleet(FLOTA));
  assert.deepEqual(services[0].retirados, []);
});

test('el plan deriva un servicio modificado desde filas persistidas', () => {
  const route = {
    conductor: 'K027',
    agentes: [{ id: 'A1', origen: 'historico' }],
    retirados: [{ id: 'A2', nota: 'Baja del cliente' }],
  };

  const changed = derivePlanRouteChanges(route);

  assert.equal(changed.cambio.modificado, true);
  assert.deepEqual(changed.cambio.salieron, ['A2']);
  assert.notEqual(changed, route, 'la derivación no muta la respuesta del caché');
});

test('una fila manual también hace visible el servicio como modificado', () => {
  const changed = derivePlanRouteChanges({
    conductor: 'K027',
    agentes: [{ id: 'A1', origen: 'manual', estado: 'programado' }],
    retirados: [],
  });

  assert.equal(changed.cambio.modificado, true);
  assert.equal(changed.cambio.nuevos, 1);
});
