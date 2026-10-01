import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPOS_PERSONALES,
  CAMPOS_VEHICULO,
  MINIMO_CONTRASENA,
  cuentaDe,
  estadoDe,
  fechaLegible,
  fortalezaDe,
  iniciales,
  mensajeDeError,
  problemaDelCambio,
  solicitudPendiente,
  valorDelPerfil,
  vehiculo2Habilitado,
} from '../src/perfil/modeloPerfil.js';

test('las iniciales salen del nombre, y sin nombre no se inventan', () => {
  assert.equal(iniciales('Ana López Díaz'), 'AL');
  assert.equal(iniciales('Programador'), 'PR');
  assert.equal(iniciales('  '), '?');
});

test('la cuenta se llama por lo que es: correo, DNI o cuenta', () => {
  assert.deepEqual(cuentaDe({ identifier: 'prog@kapital.com' }), { etiqueta: 'Correo', valor: 'prog@kapital.com' });
  // Casi ninguna cuenta de conductor lleva `identifier`.
  assert.deepEqual(cuentaDe({ dni: '74538840' }), { etiqueta: 'DNI', valor: '74538840' });
  assert.deepEqual(cuentaDe({ identifier: 'SM001' }), { etiqueta: 'Cuenta', valor: 'SM001' });
  assert.equal(cuentaDe({}).valor, '—');
});

test('el estado de la cuenta se dice en palabras y con su tono', () => {
  assert.deepEqual(estadoDe({ estado: 'Activo' }), { texto: 'Cuenta activa', tono: 'ok' });
  assert.equal(estadoDe({}).tono, 'ok');
  assert.equal(estadoDe({ estado: 'Documentos Observados' }).tono, 'aviso');
  assert.deepEqual(estadoDe({ estado: 'Raro' }), { texto: 'Raro', tono: 'neutro' });
});

test('la fortaleza orienta y solo lo que exige el servidor es obligatorio', () => {
  assert.equal(fortalezaDe('').nivel, null);
  assert.equal(fortalezaDe('abc').nivel, 'corta');
  assert.equal(fortalezaDe('abcd').nivel, 'debil');
  assert.equal(fortalezaDe('kapital2026').nivel, 'aceptable');
  assert.equal(fortalezaDe('Kapital2026').nivel, 'buena');
  assert.equal(fortalezaDe('Kapital-2026!').nivel, 'fuerte');
  const obligatorios = fortalezaDe('x').requisitos.filter((r) => r.obligatorio);
  assert.deepEqual(obligatorios.map((r) => r.texto), [`Al menos ${MINIMO_CONTRASENA} caracteres`]);
});

test('el cambio de contraseña dice qué falta antes de mandar nada', () => {
  assert.match(problemaDelCambio({ actual: '', nueva: 'nueva1', confirmacion: 'nueva1' }), /actual/);
  assert.match(problemaDelCambio({ actual: 'vieja', nueva: 'abc', confirmacion: 'abc' }), /al menos 4/);
  assert.match(problemaDelCambio({ actual: 'misma', nueva: 'misma', confirmacion: 'misma' }), /distinta/);
  assert.match(problemaDelCambio({ actual: 'vieja', nueva: 'nueva1', confirmacion: 'nueva2' }), /no coinciden/);
  assert.equal(problemaDelCambio({ actual: 'vieja', nueva: 'nueva1', confirmacion: 'nueva1' }), null);
});

test('las fechas ISO se leen como en Perú', () => {
  assert.equal(fechaLegible('1990-05-12'), '12/05/1990');
  assert.equal(fechaLegible('12/05/1990'), '12/05/1990');
});

test('un dato que falta no se rellena con uno inventado', () => {
  // La pantalla anterior decía «15 pax» de capacidad a quien no la tenía.
  const capacidad = CAMPOS_VEHICULO.find((c) => c.clave === 'capacidadVehiculo');
  assert.equal(valorDelPerfil({}, capacidad), null);
  assert.equal(valorDelPerfil({ capacidadVehiculo: 4 }, capacidad), '4 pasajeros');
  const nacimiento = CAMPOS_PERSONALES.find((c) => c.clave === 'fechaNacimiento');
  assert.equal(valorDelPerfil({ fechaNacimiento: '1990-05-12' }, nacimiento), '12/05/1990');
  assert.equal(valorDelPerfil({ direccion: '   ' }, CAMPOS_PERSONALES[1]), null);
});

test('solo una solicitud pendiente cuenta como pendiente', () => {
  const perfil = { solicitudes_cambio: {
    placa: { status: 'pendiente', new_value: 'ABC-123' },
    color: { status: 'aprobado', new_value: 'Rojo' },
  } };
  assert.equal(solicitudPendiente(perfil, 'placa').new_value, 'ABC-123');
  assert.equal(solicitudPendiente(perfil, 'color'), null);
  assert.equal(solicitudPendiente(undefined, 'placa'), null);
});

test('el segundo vehículo se reconoce aunque venga como texto', () => {
  assert.equal(vehiculo2Habilitado({ vehiculo2_habilitado: 'true' }), true);
  assert.equal(vehiculo2Habilitado({ vehiculo2_habilitado: true }), true);
  assert.equal(vehiculo2Habilitado({}), false);
});

test('un error de validación se resume en palabras', () => {
  assert.equal(mensajeDeError({ payload: { detail: [{ msg: 'Campo requerido' }] } }, 'x'), 'Campo requerido');
  assert.equal(mensajeDeError({ message: 'La contraseña actual no es correcta.' }, 'x'),
    'La contraseña actual no es correcta.');
  assert.equal(mensajeDeError(null, 'No se pudo.'), 'No se pudo.');
});
