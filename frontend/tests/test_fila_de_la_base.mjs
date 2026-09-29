import test from 'node:test';
import assert from 'node:assert/strict';
import { ESPEJO_EN_PERFIL, esDeMasivo, fechaLegible, valorDeLaUnidad } from '../src/utils/filaDeLaBase.js';

test('manda la unidad: es lo que se edita en la ficha y lo que sale en el Excel', () => {
  // Pasó con la K-027: el teléfono cambiado en la ficha, y el perfil con el viejo.
  const flota = { telefono: '999999999', marca: 'KIA' };
  const perfil = { telefonoDirecto: '922551637', vehiculoMarca: 'TOYOTA' };
  assert.equal(valorDeLaUnidad(flota, perfil, 'telefono'), '999999999');
  assert.equal(valorDeLaUnidad(flota, perfil, 'marca'), 'KIA');
});

test('lo que la unidad no tiene lo pone el perfil del conductor', () => {
  assert.equal(valorDeLaUnidad({ placa: '  ' }, { placa: 'BUR-628' }, 'placa'), 'BUR-628');
  assert.equal(valorDeLaUnidad(null, null, 'color'), '');
});

test('una placa igual al padrón no es una placa', () => {
  assert.equal(valorDeLaUnidad({ placa: 'k-050' }, { placa: 'BUR-628' }, 'placa', 'K-050'), 'BUR-628');
  assert.equal(valorDeLaUnidad({ placa: 'K-050', unidad_id: 'K-050' }, {}, 'placa'), '');
  assert.equal(valorDeLaUnidad({ placa: 'ABC-123' }, { placa: 'BUR-628' }, 'placa', 'K-050'), 'ABC-123');
});

test('el grupo solo se elige en masivo', () => {
  assert.equal(esDeMasivo('MASIVO'), true);
  assert.equal(esDeMasivo('Sharf Motorizado'), false);
  assert.equal(esDeMasivo(undefined), false);
});

test('cada campo con copia tiene la suya en el perfil', () => {
  assert.deepEqual(Object.keys(ESPEJO_EN_PERFIL), ['telefono', 'placa', 'marca', 'modelo', 'ano', 'color']);
});

test('la fecha se lee como día/mes/año, y lo que no se entiende se deja', () => {
  assert.equal(fechaLegible('1989-05-26'), '26/05/1989');
  assert.equal(fechaLegible('26/05/1989'), '26/05/1989');
  assert.equal(fechaLegible(null), '');
});
