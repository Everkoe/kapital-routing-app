import test from 'node:test';
import assert from 'node:assert/strict';
import { describirEstimacion, duracionLegible } from '../src/programador/model/estimacionDuracion.js';

const recojo = {
  minutos: 61, desde: 37, hasta: 90, acierto_banda: 80, casos: 38, confianza: 'alta',
  error_medio: 15.7, entrenado_el: '2026-09-29', salir_antes: '22:30', a_tiempo: 87,
};

test('las duraciones se leen en minutos y en horas', () => {
  assert.equal(duracionLegible(48), '48 min');
  assert.equal(duracionLegible(60), '1 h 00');
  assert.equal(duracionLegible(65.4), '1 h 05');
});

test('un RECOJO dice a qué hora salir para llegar al turno, con lo medido', () => {
  const texto = describirEstimacion(recojo, '00:00');
  assert.equal(texto.principal, '1 h 01');
  assert.equal(texto.banda, 'entre 37 min y 1 h 30 (acertó el 80% en la prueba)');
  assert.equal(texto.accion, 'Salir antes de las 22:30 para estar en la sede antes de las 00:00 (se logró el 87% en la prueba)');
  assert.equal(texto.aviso, null);
  assert.equal(texto.entrenadoEl, '2026-09-29');
});

test('una SALIDA dice hacia qué hora termina de repartir', () => {
  const salida = { ...recojo, salir_antes: undefined, a_tiempo: undefined, ultima_entrega: '23:05' };
  assert.equal(describirEstimacion(salida, '22:01').accion, 'Última entrega hacia las 23:05');
});

test('con pocos casos avisa, con el error que se midió en ese caso', () => {
  const pocos = { ...recojo, casos: 3, confianza: 'baja', error_medio: 21.8 };
  assert.equal(describirEstimacion(pocos).aviso,
    'Solo 3 servicios de esta ruta a esta hora: con tan pocos, el error medio en la prueba fue de 22 min.');
  const ninguno = { ...pocos, casos: 0 };
  assert.match(describirEstimacion(ninguno).aviso, /^Ningún servicio de esta ruta a esta hora/);
  assert.match(describirEstimacion({ ...pocos, casos: 1 }).aviso, /^Solo 1 servicio de/);
});

test('sin estimación, o con cifras que faltan, no se enseña nada', () => {
  assert.equal(describirEstimacion(null), null);
  assert.equal(describirEstimacion(undefined), null);
  assert.equal(describirEstimacion({ ...recojo, hasta: null }), null);
  assert.equal(describirEstimacion({ ...recojo, minutos: 'abc' }), null);
});

test('sin medición de la prueba no inventa el porcentaje', () => {
  const sinPrueba = { ...recojo, acierto_banda: null, a_tiempo: null };
  const texto = describirEstimacion(sinPrueba, '06:00');
  assert.equal(texto.banda, 'entre 37 min y 1 h 30');
  assert.equal(texto.accion, 'Salir antes de las 22:30 para estar en la sede antes de las 06:00');
});
