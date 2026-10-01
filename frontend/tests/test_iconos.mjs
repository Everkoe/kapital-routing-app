import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ICONO_POR_TIPO } from '../src/constants/tiposDeActividad.js';
import { ICONOS_DE_ACTIVIDAD, iconoDeActividad } from '../src/constants/iconosDeActividad.js';

const archivos = (dir) => readdirSync(dir).flatMap((nombre) => {
  const ruta = join(dir, nombre);
  return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
});

test('ningún archivo importa todos los iconos de golpe', () => {
  // Con uno solo, los más de mil iconos de lucide-react (624 KB) entran en el
  // paquete que descarga todo el mundo al abrir la aplicación.
  const culpables = archivos(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))
    .filter((ruta) => /\.(jsx?|mjs)$/.test(ruta))
    .filter((ruta) => /import\s+\*\s+as\s+\w+\s+from\s+['"]lucide-react['"]/.test(readFileSync(ruta, 'utf8')));
  assert.deepEqual(culpables, []);
});

test('cada tipo del historial tiene su icono importado', () => {
  for (const [tipo, nombre] of Object.entries(ICONO_POR_TIPO)) {
    assert.ok(ICONOS_DE_ACTIVIDAD[nombre], `falta ${nombre} (${tipo}) en iconosDeActividad.js`);
    assert.equal(iconoDeActividad(tipo), ICONOS_DE_ACTIVIDAD[nombre]);
  }
  assert.equal(iconoDeActividad('Un tipo nuevo'), ICONOS_DE_ACTIVIDAD.Activity, 'lo desconocido, con el neutro');
});
