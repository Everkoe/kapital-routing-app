import test from 'node:test';
import assert from 'node:assert/strict';
import { telefonoDeUnidad, whatsappDeUnidad } from '../src/utils/telefonoUnidad.js';

test('usa el celular del perfil cuando la unidad no tiene teléfono propio', () => {
  // Es el caso de 108 de las 109 unidades reales.
  assert.equal(telefonoDeUnidad({ telefono: '', celular: '922551637' }), '922551637');
  assert.equal(telefonoDeUnidad({ celular: '922551637' }), '922551637');
});

test('el teléfono propio de la unidad manda sobre el del perfil', () => {
  assert.equal(telefonoDeUnidad({ telefono: '987654321', celular: '922551637' }), '987654321');
});

test('sin ningún número devuelve cadena vacía, no revienta', () => {
  for (const unidad of [null, undefined, {}, { telefono: '   ', celular: null }]) {
    assert.equal(telefonoDeUnidad(unidad), '');
  }
});

test('antepone el código de país a un móvil peruano local', () => {
  // `wa.me/922551637` abre un número inexistente; con el 51 delante, funciona.
  assert.equal(whatsappDeUnidad({ celular: '922551637' }), '51922551637');
  assert.equal(whatsappDeUnidad({ celular: '922 551 637' }), '51922551637', 'ignora separadores');
});

test('un número que ya trae código de país se respeta', () => {
  assert.equal(whatsappDeUnidad({ telefono: '51987654321' }), '51987654321');
  assert.equal(whatsappDeUnidad({ telefono: '+51 987 654 321' }), '51987654321');
});

test('no enlaza lo que no puede ser un número', () => {
  // Preferible ocultar el botón a ofrecer un enlace roto.
  assert.equal(whatsappDeUnidad({ celular: '12345' }), null);
  assert.equal(whatsappDeUnidad({ celular: 'anexo interno' }), null);
  assert.equal(whatsappDeUnidad({}), null);
  assert.equal(whatsappDeUnidad(null), null);
});

test('un fijo de nueve dígitos que no empieza por 9 no se toca', () => {
  // Solo se asume Perú para el patrón de móvil; adivinar el país de otro
  // formato sería peor que dejarlo como está.
  assert.equal(whatsappDeUnidad({ telefono: '014567890' }), '014567890');
});
