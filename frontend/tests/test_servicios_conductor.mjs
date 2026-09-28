import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avisoDeUbicacion,
  conMarca,
  enlacesDeNavegacion,
  estadoDelServicio,
  horaDeLima,
  momentoDelTurno,
  nombreDeSede,
  nombreDelDia,
  objetivoDelServicio,
  progresoDelServicio,
  proximoServicio,
  sePuedeMarcar,
  serviciosDelDia,
  sumarDias,
} from '../src/conductor/modeloServicios.js';

const pasajero = (id, extra = {}) => ({
  id, nombre: `P${id}`, direccion: 'MZ A LT 1', distrito: 'SJL',
  lat: -12.0, lng: -77.0, ubicacion: 'resuelta', viaje: null, ...extra,
});

const servicio = (turno, extra = {}) => ({
  fecha: '2026-09-27', unidad: 'K027', turno, modalidad: 'RECOJO',
  sede: 'TELEPERFORMANCE BELLAVISTA', pasajeros: [pasajero(1), pasajero(2)], ...extra,
});

// Un instante de Lima escrito tal cual, sea cual sea la zona del equipo.
const lima = (fechaHora) => new Date(`${fechaHora}:00-05:00`);

test('el turno se lee en hora de Lima, no en la del teléfono', () => {
  assert.equal(momentoDelTurno(servicio('22:01')).toISOString(), '2026-09-28T03:01:00.000Z');
});

test('se marca desde tres horas antes del turno hasta seis después', () => {
  const s = servicio('22:01');
  assert.equal(sePuedeMarcar(s, lima('2026-09-27T19:00')), false);
  assert.equal(sePuedeMarcar(s, lima('2026-09-27T19:01')), true);
  assert.equal(sePuedeMarcar(s, lima('2026-09-28T04:01')), true);
  assert.equal(sePuedeMarcar(s, lima('2026-09-28T04:02')), false);
});

test('un recojo de madrugada se marca la noche anterior', () => {
  // Entrada a las 00:30 del domingo: los recojos empiezan el sábado por la noche.
  const s = servicio('00:30', { fecha: '2026-09-28' });
  assert.equal(sePuedeMarcar(s, lima('2026-09-27T22:00')), true);
});

test('el progreso cuenta a bordo, ausentes y lo que falta', () => {
  const s = servicio('22:01', {
    pasajeros: [pasajero(1, { viaje: 'a_bordo' }), pasajero(2, { viaje: 'no_se_presento' }), pasajero(3)],
  });
  assert.deepEqual(progresoDelServicio(s), { total: 3, aBordo: 1, noSePresento: 1, marcados: 2, porMarcar: 1 });
});

test('el estado de un servicio sigue su turno y sus marcas', () => {
  const s = servicio('22:01');
  assert.equal(estadoDelServicio(s, lima('2026-09-27T12:00')), 'proximo');
  // Se puede marcar desde las 19:01, pero un recojo arranca hacia las 20:31.
  assert.equal(estadoDelServicio(s, lima('2026-09-27T20:00')), 'proximo');
  assert.equal(estadoDelServicio(conMarca([s], 1, 'a_bordo')[0], lima('2026-09-27T20:00')), 'en_curso');
  assert.equal(estadoDelServicio(s, lima('2026-09-27T21:00')), 'en_curso');
  // Pasada la entrada, el recojo acabó: queda gente sin marcar, y aún se puede.
  assert.equal(estadoDelServicio(s, lima('2026-09-27T22:40')), 'sin_cerrar');
  assert.equal(estadoDelServicio(s, lima('2026-09-28T05:00')), 'vencido');
  // Una salida está en curso desde poco antes de su hora y hasta que deja a todos.
  const salida = servicio('17:01', { modalidad: 'SALIDA' });
  assert.equal(estadoDelServicio(salida, lima('2026-09-27T16:30')), 'proximo');
  assert.equal(estadoDelServicio(salida, lima('2026-09-27T18:00')), 'en_curso');
  assert.equal(estadoDelServicio(salida, lima('2026-09-27T18:40')), 'sin_cerrar');
  const todos = conMarca(conMarca([s], 1, 'a_bordo'), 2, 'no_se_presento')[0];
  assert.equal(estadoDelServicio(todos, lima('2026-09-27T21:00')), 'terminado');
  assert.equal(estadoDelServicio({ ...s, pasajeros: [] }, lima('2026-09-27T12:00')), 'terminado');
});

test('el próximo servicio es el primero sin terminar, aunque sea de mañana', () => {
  const tarde = servicio('17:01', { modalidad: 'SALIDA' });
  const noche = servicio('22:01');
  const madrugada = servicio('00:30', { fecha: '2026-09-28' });
  const servicios = [madrugada, noche, tarde];
  assert.equal(proximoServicio(servicios, lima('2026-09-27T12:00')), tarde);
  assert.equal(proximoServicio(servicios, lima('2026-09-27T21:00')), noche);
  // Acabado el de la noche, aunque quede alguien sin marcar, toca el de madrugada.
  assert.equal(proximoServicio(servicios, lima('2026-09-27T23:30')), madrugada);
  assert.equal(proximoServicio([], lima('2026-09-27T12:00')), null);
});

test('los servicios de un día salen en orden de turno', () => {
  const s = [servicio('22:01'), servicio('06:00'), servicio('01:00', { fecha: '2026-09-28' })];
  assert.deepEqual(serviciosDelDia(s, '2026-09-27').map((x) => x.turno), ['06:00', '22:01']);
});

test('la sede y el objetivo se leen como una frase', () => {
  assert.equal(nombreDeSede('TELEPERFORMANCE MIRAFLORES 2'), 'Teleperformance Miraflores 2');
  assert.equal(nombreDeSede(null), 'la sede');
  assert.equal(objetivoDelServicio(servicio('22:01')), 'Entrada en Teleperformance Bellavista a las 22:01');
  assert.equal(objetivoDelServicio(servicio('07:01', { modalidad: 'SALIDA' })),
    'Salida de Teleperformance Bellavista a las 07:01');
});

test('los días se nombran respecto de hoy y llevan su fecha', () => {
  assert.deepEqual(nombreDelDia('2026-09-27', '2026-09-27'), { titulo: 'Hoy', fecha: 'dom 27 sep' });
  assert.deepEqual(nombreDelDia('2026-09-28', '2026-09-27'), { titulo: 'Mañana', fecha: 'lun 28 sep' });
  assert.deepEqual(nombreDelDia('2026-09-26', '2026-09-27'), { titulo: 'Ayer', fecha: 'sáb 26 sep' });
  assert.deepEqual(nombreDelDia('2026-10-01', '2026-09-27'), { titulo: 'jue 1 oct', fecha: 'jue 1 oct' });
  assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
});

test('la hora de una marca se enseña en hora de Lima', () => {
  assert.equal(horaDeLima('2026-09-28T02:34:10.5+00:00'), '21:34');
  assert.equal(horaDeLima(null), '');
});

test('se navega al punto si lo hay, y a la dirección si no', () => {
  const conPunto = enlacesDeNavegacion(pasajero(1));
  assert.equal(conPunto.porDireccion, false);
  assert.match(conPunto.googleMaps, /destination=-12,-77/);
  const sinPunto = enlacesDeNavegacion(pasajero(2, { lat: null, lng: null, ubicacion: 'no_resuelta' }));
  assert.equal(sinPunto.porDireccion, true);
  assert.match(sinPunto.googleMaps, /destination=MZ%20A%20LT%201%2C%20SJL%2C%20Lima/);
  // Un 0 que viene de un null no es una coordenada (el golfo de Guinea).
  assert.equal(enlacesDeNavegacion(pasajero(3, { lat: null, lng: null, ubicacion: 'dudosa' })).porDireccion, true);
});

test('solo se avisa de la ubicación cuando no es fiable', () => {
  assert.equal(avisoDeUbicacion(pasajero(1)), '');
  assert.match(avisoDeUbicacion(pasajero(1, { ubicacion: 'dudosa' })), /aproximada/);
  assert.match(avisoDeUbicacion(pasajero(1, { lat: null, lng: null, ubicacion: 'no_resuelta' })), /dirección/);
});

test('marcar cambia solo a ese pasajero y no toca lo anterior', () => {
  const antes = [servicio('22:01'), servicio('06:00', { pasajeros: [pasajero(9)] })];
  const despues = conMarca(antes, 2, 'a_bordo', '2026-09-28T02:00:00Z');
  assert.equal(despues[0].pasajeros[1].viaje, 'a_bordo');
  assert.equal(despues[0].pasajeros[1].marcado_en, '2026-09-28T02:00:00Z');
  assert.equal(antes[0].pasajeros[1].viaje, null);
  assert.equal(despues[1], antes[1]);
  assert.equal(conMarca(despues, 2, null)[0].pasajeros[1].marcado_en, null);
});
