import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESCALA_MAXIMA, PASO_DE_ZOOM, VISTA_INICIAL,
  acotarVista, desplazar, escalaTrasRueda, zoomHacia,
} from '../src/utils/zoomDeImagen.js';

// Un marco de 800×600 con la imagen encajada a lo alto: 450×600 a escala 1.
const MEDIDAS = { marco: { ancho: 800, alto: 600 }, imagen: { ancho: 450, alto: 600 } };
const CENTRO = { x: 0, y: 0 };

test('acercar desde el centro amplía sin mover la imagen', () => {
  const vista = zoomHacia(VISTA_INICIAL, 2, CENTRO, MEDIDAS);
  assert.deepEqual(vista, { escala: 2, x: 0, y: 0 });
});

test('acercar hacia un punto deja ese punto bajo el cursor', () => {
  // A escala 2 la imagen mide 900×1200 y puede moverse ±50 en x y ±300 en y.
  const punto = { x: 100, y: -200 };
  const vista = zoomHacia(VISTA_INICIAL, 2, punto, MEDIDAS);

  // El punto de la imagen que estaba bajo el cursor, (100, -200), sigue ahí:
  // centro + punto × escala = (x + 200, y − 400) tiene que dar (100, −200),
  // salvo donde el tope lo impide (en x solo puede moverse 50).
  assert.equal(vista.escala, 2);
  assert.equal(vista.x, -50, 'en x llega al tope: la imagen no deja hueco');
  assert.equal(vista.y, 200);
});

test('la escala no baja de 1 ni pasa del máximo', () => {
  assert.equal(zoomHacia(VISTA_INICIAL, 0.3, CENTRO, MEDIDAS).escala, 1);
  assert.equal(zoomHacia(VISTA_INICIAL, 50, CENTRO, MEDIDAS).escala, ESCALA_MAXIMA);
  assert.equal(zoomHacia(VISTA_INICIAL, Number.NaN, CENTRO, MEDIDAS).escala, 1);
});

test('volver a escala 1 recentra la imagen', () => {
  const ampliada = { escala: 3, x: 120, y: -300 };
  assert.deepEqual(zoomHacia(ampliada, 1, { x: 300, y: 200 }, MEDIDAS), VISTA_INICIAL);
});

test('arrastrar no saca la imagen del marco', () => {
  const ampliada = zoomHacia(VISTA_INICIAL, 2, CENTRO, MEDIDAS);

  assert.deepEqual(desplazar(ampliada, 30, -100, MEDIDAS), { escala: 2, x: 30, y: -100 });
  // Más allá del borde, se queda en el borde: ±50 en x, ±300 en y.
  assert.deepEqual(desplazar(ampliada, 999, -999, MEDIDAS), { escala: 2, x: 50, y: -300 });
});

test('mientras la imagen cabe a lo ancho, no se mueve de lado', () => {
  // A escala 1,5 mide 675 de ancho: cabe en los 800 del marco.
  const vista = acotarVista({ escala: 1.5, x: 200, y: 100 }, MEDIDAS);
  assert.equal(vista.x, 0);
  assert.equal(vista.y, 100, 'a lo alto sí sobresale (900 de 600) y se puede mover');
});

test('sin medidas todavía (la imagen no ha cargado), no se desplaza', () => {
  const sinMedir = { marco: { ancho: 0, alto: 0 }, imagen: { ancho: 0, alto: 0 } };
  assert.deepEqual(zoomHacia(VISTA_INICIAL, 2, { x: 100, y: 100 }, sinMedir), { escala: 2, x: 0, y: 0 });
});

test('una muesca de la rueda acerca o aleja un paso', () => {
  // Una muesca del ratón son unos 100 píxeles de `deltaY`; hacia arriba es negativo.
  assert.ok(Math.abs(escalaTrasRueda(1, -100) - PASO_DE_ZOOM) < 1e-9);
  assert.ok(Math.abs(escalaTrasRueda(PASO_DE_ZOOM, 100) - 1) < 1e-9);
  // En líneas (Firefox), una línea vale lo que unos 33 píxeles.
  assert.ok(Math.abs(escalaTrasRueda(1, -3, 1) - escalaTrasRueda(1, -99)) < 1e-9);
});

test('el pellizco del panel táctil, con deltas pequeños, acerca poco a poco', () => {
  const escala = escalaTrasRueda(1, -4);
  assert.ok(escala > 1 && escala < 1.02);
});
