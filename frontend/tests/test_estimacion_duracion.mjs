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

test('un RECOJO da tres columnas: cuánto dura, a qué hora salir y cuánto fiarse', () => {
  const texto = describirEstimacion(recojo, '00:00');
  assert.deepEqual(texto.duracion, {
    etiqueta: 'Duración estimada', valor: '1 h 01', detalle: 'Entre 37 min y 1 h 30',
  });
  assert.deepEqual(texto.hora, {
    etiqueta: 'Salir antes de', valor: '22:30', detalle: 'Para estar en la sede a las 00:00',
  });
  assert.deepEqual(texto.fiabilidad, {
    nivel: 'alta',
    valor: 'Alta',
    detalle: '38 servicios de esta ruta a esta hora · el rango acierta el 80% · a tiempo el 87%',
  });
  assert.equal(texto.entrenadoEl, '2026-09-29');
});

test('una SALIDA dice hacia qué hora termina de repartir', () => {
  const salida = { ...recojo, salir_antes: undefined, a_tiempo: 87, ultima_entrega: '23:05' };
  const texto = describirEstimacion(salida, '22:01');
  assert.equal(texto.hora.etiqueta, 'Última entrega hacia');
  assert.equal(texto.hora.valor, '23:05');
  // «A tiempo» solo tiene sentido cuando hay una hora a la que llegar.
  assert.doesNotMatch(texto.fiabilidad.detalle, /a tiempo/);
});

test('sin hora de salida ni de entrega, no hay segunda columna', () => {
  assert.equal(describirEstimacion({ ...recojo, salir_antes: undefined }).hora, null);
});

test('con pocos casos la fiabilidad es baja y dice cuánto puede desviarse', () => {
  const pocos = { ...recojo, casos: 3, confianza: 'baja', error_medio: 21.8 };
  assert.deepEqual(describirEstimacion(pocos).fiabilidad, {
    nivel: 'baja',
    valor: 'Baja, pocos datos',
    detalle: 'Solo 3 servicios de esta ruta a esta hora: puede desviarse unos 22 min',
  });
  assert.match(describirEstimacion({ ...pocos, casos: 0 }).fiabilidad.detalle,
    /^Sin servicios de esta ruta a esta hora/);
  assert.match(describirEstimacion({ ...pocos, casos: 1 }).fiabilidad.detalle, /^Solo 1 servicio de/);
});

test('una confianza que no se conoce se trata como media', () => {
  assert.equal(describirEstimacion({ ...recojo, confianza: 'rara' }).fiabilidad.nivel, 'media');
});

test('sin estimación, o con cifras que faltan, no se enseña nada', () => {
  assert.equal(describirEstimacion(null), null);
  assert.equal(describirEstimacion(undefined), null);
  assert.equal(describirEstimacion({ ...recojo, hasta: null }), null);
  assert.equal(describirEstimacion({ ...recojo, minutos: 'abc' }), null);
});

test('sin medición de la prueba no inventa el porcentaje', () => {
  const sinPrueba = { ...recojo, acierto_banda: null, a_tiempo: null };
  assert.equal(describirEstimacion(sinPrueba, '06:00').fiabilidad.detalle,
    '38 servicios de esta ruta a esta hora');
});
