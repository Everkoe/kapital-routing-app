import test from 'node:test';
import assert from 'node:assert/strict';
import { resultadoDeLaEdicion } from '../src/programador/model/resultadoEdicion.js';

const MOVER = { accion: 'mover' };
const ORDENAR = { accion: 'ordenar', requiere_anterior: true };
const AGREGAR = { accion: 'agregar' };

test('un arrastre que entró está hecho', () => {
  assert.equal(resultadoDeLaEdicion([MOVER, ORDENAR], {
    aplicados: 4, ignorados: 0, resultados: [1, 3],
  }).estado, 'hecho');
});

test('si el mover no entró no está hecho, aunque el ordenar tocara filas', () => {
  // Lo que encontró la revisión: con solo el total, esto se anunciaba como
  // guardado y la persona seguía en su coche de antes.
  assert.equal(resultadoDeLaEdicion([MOVER, ORDENAR], {
    aplicados: 2, ignorados: 1, resultados: [0, 2],
  }).estado, 'nada');
});

test('en una tanda de asignaciones se dice cuántas entraron', () => {
  const r = resultadoDeLaEdicion([AGREGAR, ORDENAR, AGREGAR, ORDENAR], {
    aplicados: 3, ignorados: 2, resultados: [1, 2, 0, 0],
  });
  assert.deepEqual(r, { estado: 'parcial', hechos: 1, total: 2 });
});

test('solo reordenar se juzga por el total', () => {
  assert.equal(resultadoDeLaEdicion([{ accion: 'ordenar' }], {
    aplicados: 2, ignorados: 3, resultados: [2],
  }).estado, 'hecho');
  assert.equal(resultadoDeLaEdicion([{ accion: 'ordenar' }], {
    aplicados: 0, ignorados: 3, resultados: [0],
  }).estado, 'nada');
});

test('una base sin resultados por cambio se juzga como antes', () => {
  assert.equal(resultadoDeLaEdicion([MOVER, ORDENAR], { aplicados: 0, ignorados: 2 }).estado, 'nada');
  assert.equal(resultadoDeLaEdicion([MOVER, ORDENAR], { aplicados: 3, ignorados: 0 }).estado, 'hecho');
});
