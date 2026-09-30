import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diaEsperado, fueraDeLoEsperado, huecosAnteriores, resumenDeRecarga, sumarDias, tiraDeDias,
  yaCargadosDelError,
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

test('un archivo de un mes ya cargado se resume, no se lista día por día', () => {
  // Pasó con el reporte de agosto: 31 líneas que no cabían en la ventana.
  const agosto = Array.from({ length: 31 }, (_, i) => ({
    fecha: `2026-08-${String(i + 1).padStart(2, '0')}`, servicios: 700, cargado_en: '2026-09-22T17:01:00+00:00',
  }));
  const r = resumenDeRecarga(agosto, agosto.map((d) => d.fecha));
  assert.equal(r.dias, 31);
  assert.equal(r.desde, '2026-08-01');
  assert.equal(r.hasta, '2026-08-31');
  assert.equal(r.servicios, 31 * 700);
  assert.deepEqual(r.lista, []);
  assert.deepEqual(r.nuevos, []);
  assert.equal(r.subidoEl, '2026-09-22T17:01:00+00:00');
});

test('volver a cargar dice con cuántos servicios se sustituye cada día', () => {
  const ya = [{ fecha: '2026-09-22', servicios: 518, cargado_en: '2026-09-23T04:12:46+00:00' }];
  const r = resumenDeRecarga(ya, ['2026-09-22'], { '2026-09-22': 520 });
  assert.equal(r.lista[0].enArchivo, 520);
  assert.equal(r.enArchivo, 520);
  assert.deepEqual(r.cortos, []);
});

test('un archivo con bastantes menos servicios que lo cargado se avisa', () => {
  // Sustituir el día con un reporte a medias lo dejaría a medias.
  const ya = [
    { fecha: '2026-09-21', servicios: 500, cargado_en: null },
    { fecha: '2026-09-22', servicios: 518, cargado_en: null },
  ];
  const r = resumenDeRecarga(ya, ['2026-09-21', '2026-09-22'],
    { '2026-09-21': 401, '2026-09-22': 120 });
  assert.deepEqual(r.cortos, ['2026-09-22']);
  assert.equal(r.enArchivo, 521);
});

test('sin los recuentos del archivo no se inventa ninguno', () => {
  // Un servidor anterior no los manda: el diálogo sigue como antes.
  const r = resumenDeRecarga([{ fecha: '2026-09-22', servicios: 518 }], ['2026-09-22']);
  assert.equal(r.lista[0].enArchivo, null);
  assert.equal(r.enArchivo, null);
  assert.deepEqual(r.cortos, []);
});

test('pocos días se listan, y los nuevos del archivo se dicen aparte', () => {
  const ya = [{ fecha: '2026-09-22', servicios: 518, cargado_en: '2026-09-23T04:12:46+00:00' }];
  const r = resumenDeRecarga(ya, ['2026-09-21', '2026-09-22', '2026-09-23']);
  assert.deepEqual(r.lista, ya.map((dia) => ({ ...dia, enArchivo: null })));
  assert.deepEqual(r.nuevos, ['2026-09-21', '2026-09-23']);
});

test('si se subieron en días distintos no se inventa una fecha común', () => {
  const r = resumenDeRecarga([
    { fecha: '2026-09-01', servicios: 1, cargado_en: '2026-09-02T10:00:00+00:00' },
    { fecha: '2026-09-02', servicios: 1, cargado_en: '2026-09-05T10:00:00+00:00' },
    { fecha: '2026-09-03', servicios: 1, cargado_en: '2026-09-05T11:00:00+00:00' },
    { fecha: '2026-09-04', servicios: 1, cargado_en: '2026-09-05T12:00:00+00:00' },
  ], []);
  assert.equal(r.subidoEl, null);
});
