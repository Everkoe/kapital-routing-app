import test from 'node:test';
import assert from 'node:assert/strict';
import { carasDe, esPdf, tieneContenido } from '../src/utils/documentoArchivo.js';

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
