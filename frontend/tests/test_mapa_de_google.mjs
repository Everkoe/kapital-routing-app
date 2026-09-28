import test from 'node:test';
import assert from 'node:assert/strict';
import { paradasConPunto, urlDelMapa, urlParaAbrir, ZOOM_DE_UN_PUNTO } from '../src/programador/model/mapaDeGoogle.js';

const agente = (id, lat, lng) => ({ id, nombre: `Persona ${id}`, lat, lng });

test('sin nadie con punto no hay mapa', () => {
  assert.equal(urlDelMapa([]), null);
  assert.equal(urlDelMapa([agente('A', null, null)]), null);
  assert.equal(urlParaAbrir([agente('A', null, undefined)]), null);
});

test('un domicilio es un punto, con zoom de calle', () => {
  assert.equal(urlDelMapa([agente('A', -12.0431, -77.103)]),
    `https://maps.google.com/maps?q=-12.043100,-77.103000&z=${ZOOM_DE_UN_PUNTO}&hl=es&output=embed`);
});

test('varios domicilios son una ruta en el orden del servicio', () => {
  const url = urlDelMapa([agente('A', -12.0431, -77.103), agente('B', -12.0, -77.06), agente('C', -12.1, -77.03)]);
  assert.equal(url,
    'https://maps.google.com/maps?saddr=-12.043100,-77.103000'
    + '&daddr=-12.000000,-77.060000+to:-12.100000,-77.030000&hl=es&output=embed');
});

test('quien no tiene punto no entra en la ruta, y el orden se conserva', () => {
  // Un 0 salido de `Number(null)` pondría la parada en el golfo de Guinea.
  const agentes = [agente('A', -12.1, -77.0), agente('B', null, null), agente('C', -12.2, -77.1)];
  assert.deepEqual(paradasConPunto(agentes).map((a) => a.id), ['A', 'C']);
  assert.ok(!urlDelMapa(agentes).includes('0.000000'));
});

test('a Google solo le llegan coordenadas, ni nombres ni documentos', () => {
  const url = urlDelMapa([{ ...agente('12345678', -12.1, -77.0), direccion: 'MZ B LT 4' }, agente('87654321', -12.2, -77.1)]);
  assert.ok(!url.includes('Persona'));
  assert.ok(!url.includes('12345678'));
  assert.ok(!url.includes('MZ'));
});

test('la misma ruta se puede abrir en Google Maps', () => {
  assert.equal(urlParaAbrir([agente('A', -12.1, -77.0), agente('B', -12.2, -77.1)]),
    'https://www.google.com/maps/dir/-12.100000,-77.000000/-12.200000,-77.100000');
  assert.equal(urlParaAbrir([agente('A', -12.1, -77.0)]),
    'https://www.google.com/maps/search/?api=1&query=-12.100000,-77.000000');
});

test('un punto fuera de Lima no entra en la ruta', () => {
  // Un 0,0 guardado es el golfo de Guinea: Google no encuentra camino y la ruta entera desaparece.
  const agentes = [agente('A', -12.1, -77.0), agente('B', 0, 0), agente('C', '0', '0'), agente('D', -12.2, -77.1)];
  assert.deepEqual(paradasConPunto(agentes).map((a) => a.id), ['A', 'D']);
});
