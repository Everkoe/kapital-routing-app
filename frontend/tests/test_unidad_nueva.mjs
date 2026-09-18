import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPACIDAD_MAXIMA,
  CAPACIDAD_SUGERIDA,
  DOCUMENTOS_DE_UNIDAD,
  TIPOS_DE_UNIDAD,
  capacidadValida,
  erroresDeUnidad,
  normalizarCodigo,
  tieneCambios,
} from '../src/constants/unidadNueva.js';

/** Un alta mínima que debe poder registrarse. */
const altaValida = () => ({
  padron: 'K-500', placa: 'ABC-123', chofer: 'JUAN PEREZ',
  telefono: '987654321', tipo: 'AUTO', capacidad: '4',
  dni: '45757485', password: 'kapital1',
});

test('padrón y placa son campos distintos y los dos obligatorios', () => {
  // El formulario anterior tenía un único «Placa/ID» que viajaba como padrón,
  // así que las unidades creadas a mano se quedaban sin matrícula.
  assert.deepEqual(erroresDeUnidad(altaValida()), {});
  assert.ok(erroresDeUnidad({ ...altaValida(), padron: '' }).padron);
  assert.ok(erroresDeUnidad({ ...altaValida(), placa: '' }).placa);
});

test('el padrón y la placa se guardan en mayúsculas y sin espacios', () => {
  assert.equal(normalizarCodigo('  k-027 '), 'K-027');
  assert.equal(normalizarCodigo('bur-628'), 'BUR-628');
  assert.equal(normalizarCodigo(null), '');
});

test('AUTO propone 4 plazas, no 10', () => {
  // Las 42 unidades AUTO de la flota llevan 4 sin una sola excepción; el
  // formulario anterior arrancaba siempre en 10.
  assert.equal(CAPACIDAD_SUGERIDA.AUTO, 4);
  assert.notEqual(CAPACIDAD_SUGERIDA.AUTO, 10);
  assert.equal(CAPACIDAD_SUGERIDA.MINIVAN, 7);
});

test('no se propone capacidad donde la flota no es unánime', () => {
  // SUV va de 4 a 7 y VAN de 7 a 15: proponer un número sería inventarlo.
  for (const tipo of ['SUV', 'VAN', 'CAMIONETA']) {
    assert.equal(CAPACIDAD_SUGERIDA[tipo], undefined, tipo);
  }
});

test('la capacidad solo admite enteros positivos dentro del tope', () => {
  for (const valor of ['4', '1', String(CAPACIDAD_MAXIMA)]) {
    assert.equal(capacidadValida(valor), true, valor);
  }
  for (const valor of ['0', '-3', '', 'cuatro', String(CAPACIDAD_MAXIMA + 1)]) {
    assert.equal(capacidadValida(valor), false, valor);
  }
});

test('el teléfono de contacto es obligatorio y completo', () => {
  // Es por donde se avisa de una reasignación o una emergencia: sin él la
  // unidad queda incomunicada.
  assert.ok(erroresDeUnidad({ ...altaValida(), telefono: '' }).telefono);
  assert.ok(erroresDeUnidad({ ...altaValida(), telefono: '9876' }).telefono);
  assert.equal(erroresDeUnidad({ ...altaValida(), telefono: '987654321' }).telefono, undefined);
});

test('el alta exige DNI y contraseña para crear la cuenta del conductor', () => {
  // Sin cuenta, la unidad nace con un conductor que no puede entrar a subir su
  // documentación.
  assert.ok(erroresDeUnidad({ ...altaValida(), dni: '' }).dni);
  assert.ok(erroresDeUnidad({ ...altaValida(), dni: '4575' }).dni, 'un DNI a medias no vale');
  assert.ok(erroresDeUnidad({ ...altaValida(), dni: '457574850' }).dni, 'ni uno de más');
  assert.ok(erroresDeUnidad({ ...altaValida(), password: '' }).password);
  assert.ok(erroresDeUnidad({ ...altaValida(), password: 'ab' }).password);
});

test('el DNI admite el formato con el que se escribe a mano', () => {
  assert.equal(erroresDeUnidad({ ...altaValida(), dni: '45.757.485' }).dni, undefined);
  assert.equal(erroresDeUnidad({ ...altaValida(), dni: ' 45757485 ' }).dni, undefined);
});

test('el formulario solo pide los tres documentos de la unidad', () => {
  // El T.U.C. (ATU) ya no se solicita al dar de alta.
  assert.deepEqual(DOCUMENTOS_DE_UNIDAD.map((d) => d.campo), ['soat', 'revision', 'licencia']);
  assert.ok(!DOCUMENTOS_DE_UNIDAD.some((d) => d.campo === 'atu'));
});

test('los tipos ofrecidos son los que la flota usa de verdad', () => {
  assert.deepEqual(TIPOS_DE_UNIDAD, ['AUTO', 'SUV', 'VAN', 'MINIVAN', 'CAMIONETA']);
});

test('un formulario recién abierto no cuenta como modificado', () => {
  // Solo el tipo viene con valor por defecto: no debe disparar el aviso de
  // «hay cambios sin guardar» al cerrar sin haber escrito nada.
  const vacio = { padron: '', placa: '', chofer: '', telefono: '', tipo: 'AUTO', capacidad: '' };
  assert.equal(tieneCambios(vacio, {}), false);
  assert.equal(tieneCambios({ ...vacio, padron: 'K-1' }, {}), true);
  assert.equal(tieneCambios(vacio, { soat: { name: 'x.pdf' } }), true);
});
