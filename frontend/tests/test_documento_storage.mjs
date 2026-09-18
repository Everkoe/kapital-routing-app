import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * La caché de URLs firmadas.
 *
 * Cada foto necesita una ida y vuelta antes de dibujarse, y eso se veía como
 * un parpadeo. Reutilizarla mientras dure lo quita en todas las vistas menos
 * la primera; lo que no puede hacer es sobrevivir a su caducidad ni a un
 * cierre de sesión, porque una firma es un permiso con fecha.
 */

let peticiones = [];
let respuesta = async (ruta) => ({ url: `https://bucket/${ruta}?firma=${peticiones.length}` });

const { urlFirmada, urlFirmadaEnCache, olvidarUrlsFirmadas } =
  await import('../src/utils/documentoStorage.js');

// Se intercepta la red a través de `fetch`, que es lo que `apiFetch` usa.
globalThis.fetch = async (url) => {
  peticiones.push(String(url));
  const ruta = new URL(String(url), 'http://local').searchParams.get('path');
  return new Response(JSON.stringify(await respuesta(ruta)), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};

const limpiar = () => { peticiones = []; olvidarUrlsFirmadas(); };

test('la misma ruta no se firma dos veces', async () => {
  limpiar();
  const a = await urlFirmada('avatares/uno.jpg');
  const b = await urlFirmada('avatares/uno.jpg');

  assert.equal(a, b);
  assert.equal(peticiones.length, 1, 'la segunda sale de la cache');
});

test('varias tarjetas con la misma foto hacen una sola peticion', async () => {
  limpiar();
  // Es el caso de la lista de usuarios: todas montan a la vez.
  const [a, b, c] = await Promise.all([
    urlFirmada('avatares/dos.jpg'),
    urlFirmada('avatares/dos.jpg'),
    urlFirmada('avatares/dos.jpg'),
  ]);

  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(peticiones.length, 1, 'se comparte la promesa en vuelo');
});

test('la version sincrona solo responde si ya esta resuelta', async () => {
  limpiar();
  assert.equal(urlFirmadaEnCache('avatares/tres.jpg'), '', 'sin pedirla, nada');

  const enVuelo = urlFirmada('avatares/tres.jpg');
  assert.equal(urlFirmadaEnCache('avatares/tres.jpg'), '', 'mientras viaja, tampoco');

  const url = await enVuelo;
  assert.equal(urlFirmadaEnCache('avatares/tres.jpg'), url, 'ya resuelta, al instante');
});

test('cerrar sesion olvida las firmas', async () => {
  limpiar();
  await urlFirmada('avatares/cuatro.jpg');
  assert.notEqual(urlFirmadaEnCache('avatares/cuatro.jpg'), '');

  olvidarUrlsFirmadas();

  assert.equal(urlFirmadaEnCache('avatares/cuatro.jpg'), '', 'una firma es un permiso');
  await urlFirmada('avatares/cuatro.jpg');
  assert.equal(peticiones.length, 2, 'se vuelve a pedir');
});

test('una firma fallida no se queda guardada', async () => {
  limpiar();
  respuesta = async () => { throw new Error('sin red'); };
  globalThis.fetch = async () => { peticiones.push('fallo'); throw new Error('sin red'); };

  await assert.rejects(() => urlFirmada('avatares/cinco.jpg'));
  assert.equal(urlFirmadaEnCache('avatares/cinco.jpg'), '', 'no se cachea un fallo');

  globalThis.fetch = async (url) => {
    peticiones.push(String(url));
    return new Response(JSON.stringify({ url: 'https://bucket/ok' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  assert.equal(await urlFirmada('avatares/cinco.jpg'), 'https://bucket/ok',
    'el siguiente intento lo vuelve a intentar');
});
