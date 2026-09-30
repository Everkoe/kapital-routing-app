import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avisosDeLaPropuesta, filasDeComparacion, OBJETIVOS, textoDeConfirmacion, variacion,
} from '../src/programador/model/propuestaIA.js';

const propuesta = {
  reglas: { max_a_bordo: 90 },
  actual: { unidades: 42, horas: 67.8, a_bordo_mediana: 33, a_bordo_max: 142, por_encima_de_la_regla: 6 },
  propuesta: { unidades: 21, horas: 52, a_bordo_mediana: 38, a_bordo_max: 80, por_encima_de_la_regla: 0 },
  unidades_de_la_sede: { actual: 51, propuesta: 46 },
  sin_asignar: [{ id: '1' }],
  excepciones: [],
  intactos: { servicios: 52, personas: 201, sin_ubicar: 83 },
  movidas: 179,
};

test('la variación dice cuánto cambia, con el signo de verdad', () => {
  assert.equal(variacion(42, 21), '−50%');
  assert.equal(variacion(33, 38), '+15%');
  assert.equal(variacion(10, 10), 'igual');
  assert.equal(variacion(0, 5), null);
  assert.equal(variacion(null, 5), null);
});

test('la comparación marca como mejor lo que baja y como peor lo que sube', () => {
  const filas = filasDeComparacion(propuesta);
  const por = Object.fromEntries(filas.map((f) => [f.etiqueta, f]));
  assert.equal(por['Unidades en la sede'].actual, '51');
  assert.equal(por['Unidades en la sede'].tono, 'mejor');
  assert.equal(por['Horas de trabajo'].propuesta, '52 h');
  assert.equal(por['A bordo, mediana'].tono, 'peor');
  assert.equal(por['A bordo, máximo'].variacion, '−44%');
  assert.equal(por['Personas por encima de 90 min'].propuesta, '0');
});

test('sin datos no hay tabla', () => {
  assert.deepEqual(filasDeComparacion(null), []);
  assert.deepEqual(filasDeComparacion({ actual: {} }), []);
});

test('los avisos dicen quién se queda fuera y qué no se tocó', () => {
  const avisos = avisosDeLaPropuesta(propuesta);
  assert.equal(avisos.length, 2);
  assert.match(avisos[0].texto, /^1 persona sin sitio/);
  assert.match(avisos[1].texto, /52 servicios se quedan como están .*83 personas/);
  assert.deepEqual(avisosDeLaPropuesta({ ...propuesta, sin_asignar: [], intactos: {} }), []);
  const lejos = avisosDeLaPropuesta({ ...propuesta, sin_asignar: [], intactos: {}, excepciones: [{}, {}] });
  assert.match(lejos[0].texto, /^2 personas viven tan lejos/);
});

test('la confirmación cuenta a quien cambia de unidad', () => {
  assert.equal(textoDeConfirmacion(propuesta),
    '179 personas cambian de unidad y se reordenan los servicios. Podrás deshacerlo justo después.');
  assert.match(textoDeConfirmacion({ movidas: 0 }), /solo cambia el orden/);
});

test('los dos objetivos que acepta el backend', () => {
  assert.deepEqual(OBJETIVOS.map((o) => o.id), ['unidades', 'tiempo']);
});
