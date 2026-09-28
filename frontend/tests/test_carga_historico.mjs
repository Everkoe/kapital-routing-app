import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diaEsperado, fueraDeLoEsperado, huecosAnteriores, sumarDias, tiraDeDias, yaCargadosDelError,
} from '../src/programador/model/cargaHistorico.js';

// Lo que había de verdad el 28/9: agosto entero y solo el 22 de septiembre.
const estado = {
  hoy: '2026-09-28',
  esperado: '2026-09-27',
  dias: [{ fecha: '2026-09-22', servicios: 518, cargado_en: '2026-09-23T04:12:46+00:00' }],
};

test('sumar días cruza meses sin depender de la zona del navegador', () => {
  assert.equal(sumarDias('2026-09-27', -6), '2026-09-21');
  assert.equal(sumarDias('2026-08-31', 1), '2026-09-01');
});

test('la tira son los siete días hasta el que toca, con los cargados marcados', () => {
  const tira = tiraDeDias(estado);
  assert.deepEqual(tira.map((d) => d.fecha),
    ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
  assert.deepEqual(tira.filter((d) => d.cargado).map((d) => [d.fecha, d.servicios]), [['2026-09-22', 518]]);
});

test('el día que toca es ayer, y aquí falta', () => {
  assert.deepEqual(diaEsperado(estado), { fecha: '2026-09-27', cargado: false, servicios: 0, cargadoEn: null });
  assert.equal(diaEsperado({ esperado: '2026-09-22', dias: estado.dias }).cargado, true);
  assert.equal(diaEsperado(null), null);
});

test('los huecos anteriores no cuentan el día que toca', () => {
  assert.deepEqual(huecosAnteriores(estado),
    ['2026-09-21', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
});

test('avisa cuando el archivo no es del día que tocaba', () => {
  assert.equal(fueraDeLoEsperado({ desde: '2026-09-20', hasta: '2026-09-20' }, '2026-09-27'), true);
  assert.equal(fueraDeLoEsperado({ desde: '2026-09-27', hasta: '2026-09-27' }, '2026-09-27'), false);
  // Un mes entero que incluye el día no es un error.
  assert.equal(fueraDeLoEsperado({ desde: '2026-09-01', hasta: '2026-09-30' }, '2026-09-27'), false);
  assert.equal(fueraDeLoEsperado(null, '2026-09-27'), false);
});

test('reconoce el aviso de «ya estaba cargado» y nada más', () => {
  const ya = [{ fecha: '2026-09-27', servicios: 518 }];
  assert.deepEqual(yaCargadosDelError({ mensaje: 'Ya estaba', ya_cargados: ya }), ya);
  assert.equal(yaCargadosDelError('El archivo llegó vacío.'), null);
  assert.equal(yaCargadosDelError({ ya_cargados: [] }), null);
});
