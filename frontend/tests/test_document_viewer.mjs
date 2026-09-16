import test from 'node:test';
import assert from 'node:assert/strict';
import { caraTieneDocumento, carasDe, esPdf, tieneContenido } from '../src/utils/documentoArchivo.js';

test('reconoce un PDF tanto por extensión como por data URL', () => {
  assert.equal(esPdf('data:application/pdf;base64,AAAA'), true);
  assert.equal(esPdf('https://x.test/contrato.PDF'), true, 'la extensión puede venir en mayúsculas');
  assert.equal(esPdf('data:image/png;base64,AAAA'), false);
  assert.equal(esPdf(''), false);
  assert.equal(esPdf(), false, 'sin argumento no debe reventar');
});

test('solo considera con contenido lo que el navegador puede mostrar', () => {
  assert.equal(tieneContenido('data:image/png;base64,AAAA'), true);
  assert.equal(tieneContenido('https://x.test/a.png'), true);
  // Una ruta relativa o un nombre suelto no sirven: el visor mostraría un roto.
  assert.equal(tieneContenido('/uploads/a.png'), false);
  assert.equal(tieneContenido(''), false);
  assert.equal(tieneContenido(), false);
});

test('un documento de una sola cara se normaliza a una lista de uno', () => {
  const caras = carasDe({ name: 'CV', src: 'data:image/png;base64,AA' });

  assert.equal(caras.length, 1);
  assert.equal(caras[0].nombre, null, 'sin nombre de cara, el visor no lo anuncia');
  assert.equal(caras[0].src, 'data:image/png;base64,AA');
});

test('un documento de dos caras conserva las suyas y su orden', () => {
  const caras = carasDe({
    name: 'DNI',
    caras: [
      { nombre: 'Delante', src: 'data:image/png;base64,AA' },
      { nombre: 'Detrás', src: '' },
    ],
  });

  assert.deepEqual(caras.map((c) => c.nombre), ['Delante', 'Detrás']);
  assert.equal(tieneContenido(caras[1].src), false, 'la cara vacía se podrá deshabilitar');
});

test('sin documento no hay caras que resolver', () => {
  assert.deepEqual(carasDe(null).map((c) => c.src), [undefined]);
});

test('una cara guardada en Storage cuenta como documento, aunque no traiga contenido', () => {
  // Su contenido no existe hasta que llega la URL firmada. Mirar solo `src`
  // marcaba como «sin archivo» todo lo que estaba subido al bucket.
  assert.equal(caraTieneDocumento({ src: '', path: 'K-027/dniScaneado.jpg' }), true);
  assert.equal(caraTieneDocumento({ src: 'data:image/png;base64,AA' }), true);
});

test('una cara sin contenido ni ruta no tiene documento', () => {
  assert.equal(caraTieneDocumento({ src: '' }), false);
  assert.equal(caraTieneDocumento({}), false);
  assert.equal(caraTieneDocumento(null), false);
  // Una ruta relativa suelta no es contenido mostrable ni una ruta de bucket.
  assert.equal(caraTieneDocumento({ src: '/uploads/a.png' }), false);
});

test('un documento de una sola cara conserva su ruta de Storage', () => {
  // El visor pide la firma con `cara.path`. Si la cara implícita lo perdiera,
  // un documento de una sola cara —los del conductor— nunca se mostraría.
  const [cara] = carasDe({ name: 'Licencia', src: '', path: 'K-027/licencia.jpg' });
  assert.equal(cara.path, 'K-027/licencia.jpg');
  assert.equal(caraTieneDocumento(cara), true);
});
