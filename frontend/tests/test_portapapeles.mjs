import test from 'node:test';
import assert from 'node:assert/strict';
import { archivoDePortapapeles, pegadoEnCampoDeTexto } from '../src/utils/documentoArchivo.js';

const archivo = (nombre) => ({ name: nombre, tipo: 'file' });

test('toma el archivo cuando el pegado lo trae directamente', () => {
  const clip = { files: [archivo('captura.png')], items: [] };

  assert.equal(archivoDePortapapeles(clip).name, 'captura.png');
});

test('busca entre los elementos cuando no hay lista de archivos', () => {
  // Algunos navegadores solo exponen el fichero a través de `items`.
  const clip = {
    files: [],
    items: [
      { kind: 'string', getAsFile: () => null },
      { kind: 'file', getAsFile: () => archivo('pegada.png') },
    ],
  };

  assert.equal(archivoDePortapapeles(clip).name, 'pegada.png');
});

test('un pegado de solo texto no produce archivo', () => {
  // Debe devolver null para que el pegado normal siga su curso.
  const clip = { files: [], items: [{ kind: 'string', getAsFile: () => null }] };

  assert.equal(archivoDePortapapeles(clip), null);
  assert.equal(archivoDePortapapeles(null), null);
  assert.equal(archivoDePortapapeles({}), null);
});

test('un elemento de tipo fichero sin contenido no cuenta', () => {
  const clip = { files: [], items: [{ kind: 'file', getAsFile: () => null }] };

  assert.equal(archivoDePortapapeles(clip), null);
});

test('reconoce cuándo el pegado iba a un campo de texto', () => {
  const enInput = { closest: (sel) => (sel.includes('input') ? {} : null) };
  const enTarjeta = { closest: () => null };

  assert.equal(pegadoEnCampoDeTexto(enInput), true);
  assert.equal(pegadoEnCampoDeTexto(enTarjeta), false);
  assert.equal(pegadoEnCampoDeTexto(null), false, 'sin destino no debe reventar');
});
