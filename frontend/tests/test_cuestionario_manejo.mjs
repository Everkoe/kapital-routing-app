import test from 'node:test';
import assert from 'node:assert/strict';
import { estadoPorNota, resultadoDelCuestionario } from '../src/utils/cuestionarioManejo.js';

test('la ficha enseña la nota y el estado que dejó el test', () => {
  const r = resultadoDelCuestionario({
    puntaje: 18, total: 20, estado: 'APROBADO', respuestas: {}, fechaEvaluacion: '2026-09-12T15:30:00.000Z',
  });
  assert.deepEqual(r, { puntaje: 18, total: 20, estado: 'APROBADO', fecha: '12/09/2026' });
});

test('el día es el de Lima, no el del servidor', () => {
  // Las 02:00 del 13 en UTC son todavía el 12 en Lima.
  assert.equal(resultadoDelCuestionario({ puntaje: 20, fechaEvaluacion: '2026-09-13T02:00:00Z' }).fecha, '12/09/2026');
});

test('sin rendirlo no hay resultado', () => {
  for (const vacio of [null, undefined, {}, { puntaje: null }, { puntaje: '' }, 'APROBADO']) {
    assert.equal(resultadoDelCuestionario(vacio), null, JSON.stringify(vacio));
  }
});

test('un estado que no se reconoce se deduce de la nota, con los umbrales del test', () => {
  assert.equal(resultadoDelCuestionario({ puntaje: 16, estado: 'raro' }).estado, 'OBSERVADO');
  assert.equal(resultadoDelCuestionario({ puntaje: 0 }).total, 20);
  assert.deepEqual([18, 17, 15, 14].map(estadoPorNota), ['APROBADO', 'OBSERVADO', 'OBSERVADO', 'DESAPROBADO']);
});
