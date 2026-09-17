import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTADOS_ACTIVIDAD,
  ICONO_POR_TIPO,
  estadoDeActividad,
  fechaLegible,
} from '../src/constants/tiposDeActividad.js';

test('un estado conocido trae su etiqueta escrita, no solo un color', () => {
  // El color acompaña; la palabra es lo que hace legible el evento para quien
  // no distingue el verde del ámbar.
  assert.equal(estadoDeActividad('success').etiqueta, 'Éxito');
  assert.equal(estadoDeActividad('error').etiqueta, 'Error');
  assert.equal(estadoDeActividad('warning').etiqueta, 'Advertencia');
});

test('un estado desconocido no rompe la fila: cae en información', () => {
  assert.equal(estadoDeActividad('lo-que-sea'), ESTADOS_ACTIVIDAD.info);
  assert.equal(estadoDeActividad(undefined), ESTADOS_ACTIVIDAD.info);
});

test('cada tipo que registra el backend tiene su icono', () => {
  // Si se añade un tipo nuevo al backend sin icono, esta prueba lo recuerda.
  for (const tipo of ['Usuario inició sesión', 'Unidad actualizada', 'Documento cargado',
                      'Documento aprobado', 'Documento rechazado', 'Acceso aprobado',
                      'Usuario desactivado', 'Usuario reactivado']) {
    assert.ok(ICONO_POR_TIPO[tipo], `falta icono para ${tipo}`);
  }
});

test('lo de hoy y lo de ayer se dicen con palabras', () => {
  const ahora = new Date('2026-09-17T15:00:00');
  assert.match(fechaLegible(new Date('2026-09-17T12:45:00').toISOString(), ahora), /^Hoy, /);
  assert.match(fechaLegible(new Date('2026-09-16T18:20:00').toISOString(), ahora), /^Ayer, /);
});

test('lo más antiguo lleva su fecha completa', () => {
  const ahora = new Date('2026-09-17T15:00:00');
  const texto = fechaLegible(new Date('2026-09-10T09:30:00').toISOString(), ahora);
  assert.ok(!texto.startsWith('Hoy'), texto);
  assert.ok(!texto.startsWith('Ayer'), texto);
  assert.match(texto, /10.*2026/);
});

test('una fecha ausente o ilegible no imprime «Invalid Date»', () => {
  for (const entrada of [null, undefined, '', 'no-es-fecha']) {
    assert.equal(fechaLegible(entrada), '—');
  }
});
