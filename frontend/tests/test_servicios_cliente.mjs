import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparPorTurno,
  descripcionDelVehiculo,
  estadoDePersona,
  filtrarServicios,
  nombreCortoDeSede,
  resumenDelDia,
  sedesDelDia,
} from '../src/cliente/modeloCliente.js';

const lima = (fechaHora) => new Date(`${fechaHora}:00-05:00`);

const persona = (dni, extra = {}) => ({
  dni, nombre: `Persona ${dni}`, distrito: 'SJL', sede: 'TELEPERFORMANCE BELLAVISTA', viaje: null, ...extra,
});

const RESPUESTA = {
  fecha: '2026-09-27',
  servicios: [
    {
      unidad: 'K027', turno: '22:01', modalidad: 'RECOJO', sede: 'TELEPERFORMANCE BELLAVISTA',
      conductor: { nombre: 'Juan Pérez', placa: 'ABC-123', marca: 'Toyota', modelo: 'Hiace', color: 'BLANCO' },
      personas: [persona('111', { viaje: 'a_bordo' }), persona('222', { nombre: 'María Núñez' })],
    },
    {
      unidad: 'V026', turno: '07:01', modalidad: 'SALIDA', sede: 'TELEPERFORMANCE MAGDALENA', conductor: null,
      personas: [persona('333', { sede: 'TELEPERFORMANCE MAGDALENA', viaje: 'no_se_presento' })],
    },
    {
      unidad: 'K100', turno: '22:01', modalidad: 'RECOJO', sede: 'TELEPERFORMANCE BELLAVISTA',
      conductor: { nombre: 'Ana', placa: 'XYZ-9' },
      personas: [persona('444')],
    },
  ],
  pendientes: [{ dni: '555', nombre: 'Sin coche', turno: '22:01' }],
};

test('la sede se muestra sin el nombre de la empresa', () => {
  assert.equal(nombreCortoDeSede('TELEPERFORMANCE BELLAVISTA', 'TELEPERFORMANCE'), 'Bellavista');
  assert.equal(nombreCortoDeSede('TELEPERFORMANCE MIRAFLORES 2', 'Teleperformance'), 'Miraflores 2');
  assert.equal(nombreCortoDeSede('KONECTA SURCO', 'TELEPERFORMANCE'), 'Konecta Surco');
  assert.equal(nombreCortoDeSede('TELEPERFORMANCE', 'TELEPERFORMANCE'), 'Teleperformance');
});

test('sin marca, una persona está programada hasta que pasa su turno', () => {
  const servicio = RESPUESTA.servicios[0];
  assert.equal(estadoDePersona(persona('1'), servicio, '2026-09-27', lima('2026-09-27T21:00')), 'programado');
  assert.equal(estadoDePersona(persona('1'), servicio, '2026-09-27', lima('2026-09-27T22:40')), 'sin_confirmar');
  assert.equal(estadoDePersona(persona('1', { viaje: 'a_bordo' }), servicio, '2026-09-27', lima('2026-09-27T12:00')), 'a_bordo');
});

test('el resumen cuenta personas, estados, servicios y quien no tiene unidad', () => {
  assert.deepEqual(resumenDelDia(RESPUESTA, lima('2026-09-27T12:00')), {
    personas: 4, aBordo: 1, noSePresento: 1, sinConfirmar: 0, programados: 2,
    servicios: 3, unidades: 3, sinUnidad: 1,
  });
  assert.equal(resumenDelDia({}).personas, 0);
});

test('las sedes salen con cuántas personas van, de más a menos', () => {
  assert.deepEqual(sedesDelDia(RESPUESTA.servicios), [
    { sede: 'TELEPERFORMANCE BELLAVISTA', personas: 3 },
    { sede: 'TELEPERFORMANCE MAGDALENA', personas: 1 },
  ]);
});

test('filtrar por sede y sentido no toca los servicios originales', () => {
  const salida = filtrarServicios(RESPUESTA.servicios, { modalidad: 'SALIDA' });
  assert.deepEqual(salida.map((s) => s.unidad), ['V026']);
  const magdalena = filtrarServicios(RESPUESTA.servicios, { sede: 'TELEPERFORMANCE MAGDALENA' });
  assert.deepEqual(magdalena.map((s) => s.unidad), ['V026']);
  assert.equal(filtrarServicios(RESPUESTA.servicios).length, 3);
  assert.equal(filtrarServicios(RESPUESTA.servicios)[0], RESPUESTA.servicios[0]);
});

test('buscar a una persona deja solo a esa persona en su servicio', () => {
  const porNombre = filtrarServicios(RESPUESTA.servicios, { texto: 'maria nunez' });
  assert.equal(porNombre.length, 1);
  assert.deepEqual(porNombre[0].personas.map((p) => p.dni), ['222']);
  assert.equal(RESPUESTA.servicios[0].personas.length, 2);
  assert.deepEqual(filtrarServicios(RESPUESTA.servicios, { texto: '333' }).map((s) => s.unidad), ['V026']);
});

test('buscar una unidad, placa o conductor deja el servicio entero', () => {
  const porPlaca = filtrarServicios(RESPUESTA.servicios, { texto: 'abc-123' });
  assert.equal(porPlaca.length, 1);
  assert.equal(porPlaca[0].personas.length, 2);
  assert.deepEqual(filtrarServicios(RESPUESTA.servicios, { texto: 'perez' }).map((s) => s.unidad), ['K027']);
  assert.deepEqual(filtrarServicios(RESPUESTA.servicios, { texto: 'k100' }).map((s) => s.unidad), ['K100']);
});

test('los servicios se agrupan por turno y sentido, en orden de hora', () => {
  const grupos = agruparPorTurno(RESPUESTA.servicios);
  assert.deepEqual(grupos.map((g) => [g.turno, g.modalidad, g.servicios.length, g.personas]), [
    ['07:01', 'SALIDA', 1, 1],
    ['22:01', 'RECOJO', 2, 3],
  ]);
});

test('el vehículo se describe con lo que haya', () => {
  assert.equal(descripcionDelVehiculo(RESPUESTA.servicios[0].conductor), 'Toyota Hiace · blanco · ABC-123');
  assert.equal(descripcionDelVehiculo({ placa: 'XYZ-9' }), 'XYZ-9');
  assert.equal(descripcionDelVehiculo(null), '');
});
