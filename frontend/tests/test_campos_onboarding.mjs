import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTADO_FALTA,
  ESTADO_INVALIDO,
  ESTADO_OK,
  ayudaDeCampo,
  camposPendientes,
  estadoDeCampo,
  progresoDe,
  seccionCompleta,
} from '../src/constants/camposOnboarding.js';

/** Un alta resuelta al completo, para partir de ahí en cada prueba. */
const altaCompleta = () => ({
  nombres: 'JUAN PEREZ',
  tipoDoc: 'DNI',
  numDoc: '11111111',
  fechaNacimiento: '2000-02-13',
  direccion: 'AV. SIEMPRE VIVA 123',
  telefonoDirecto: '906916715',
  comprobanteDomicilio: { name: 'recibo.pdf', path: 'K-500/comprobanteDomicilio.pdf' },
  dniScaneado: { name: 'dni.jpg', path: 'K-500/dniScaneado.jpg' },
  licenciaConducir: { name: 'lic.jpg', path: 'K-500/licenciaConducir.jpg' },
  recordConductor: { name: 'record.pdf', path: 'K-500/recordConductor.pdf' },
  antecedentesPoliciales: { name: 'ant.pdf', path: 'K-500/antecedentesPoliciales.pdf' },
  vehiculoMarca: 'MERCEDES',
  vehiculoPlaca: 'ABC-111',
  vehiculoCapacidad: '15',
  tarjetaPropiedad: { name: 'tp.jpg', path: 'K-500/tarjetaPropiedad.jpg' },
  soat: { name: 'soat.pdf', path: 'K-500/soat.pdf' },
  quizManejoDefensivo: { puntaje: 18, total: 20, estado: 'Aprobado' },
});

test('un alta resuelta llega al 100% y no deja nada pendiente', () => {
  const datos = altaCompleta();
  assert.equal(progresoDe(datos), 100);
  assert.deepEqual(camposPendientes(datos), []);
});

test('un DNI de siete dígitos no cuenta como completo', () => {
  // Es el caso de la captura: el conductor escribió 1111111 y el formulario no
  // le decía nada, solo se quedaba en 6%.
  const datos = { ...altaCompleta(), numDoc: '1111111' };
  assert.equal(estadoDeCampo('numDoc', datos), ESTADO_INVALIDO);
  assert.match(ayudaDeCampo('numDoc', datos), /8 d/);
  assert.ok(progresoDe(datos) < 100);
});

test('otro tipo de documento admite más de ocho dígitos', () => {
  const datos = { ...altaCompleta(), tipoDoc: 'CE', numDoc: '001234567890' };
  assert.equal(estadoDeCampo('numDoc', datos), ESTADO_OK);
});

test('un campo vacío falta, y lo dice sin hablar de formatos', () => {
  const datos = { ...altaCompleta(), direccion: '   ' };
  assert.equal(estadoDeCampo('direccion', datos), ESTADO_FALTA);
  assert.equal(ayudaDeCampo('direccion', datos), 'Falta completar este dato.');
});

test('el correo no se exige, pero mal escrito se señala', () => {
  const sinCorreo = altaCompleta();
  assert.equal(estadoDeCampo('correo', sinCorreo), ESTADO_OK, 'vacío no bloquea');
  assert.equal(progresoDe(sinCorreo), 100, 'y no cuenta para el porcentaje');

  const malEscrito = { ...sinCorreo, correo: 'camposraul0982gmail.com' };
  assert.equal(estadoDeCampo('correo', malEscrito), ESTADO_INVALIDO);
  assert.equal(progresoDe(malEscrito), 100, 'sigue sin contar para el porcentaje');
  assert.ok(camposPendientes(malEscrito).some((r) => r.campo === 'correo'));
});

test('un documento subido a Storage cuenta aunque no sea un File', () => {
  const datos = { ...altaCompleta(), soat: { name: 'soat.pdf', path: 'K-500/soat.pdf' } };
  assert.equal(estadoDeCampo('soat', datos), ESTADO_OK);
  assert.equal(estadoDeCampo('soat', { ...datos, soat: null }), ESTADO_FALTA);
});

test('el cuestionario cuenta por su resultado, no por un archivo', () => {
  const datos = altaCompleta();
  assert.equal(estadoDeCampo('quizManejoDefensivo', datos), ESTADO_OK);
  assert.equal(estadoDeCampo('quizManejoDefensivo', { ...datos, quizManejoDefensivo: null }), ESTADO_FALTA);
});

test('una capacidad de cero o de texto no sirve', () => {
  for (const capacidad of ['0', '-2', 'quince', ' ']) {
    const datos = { ...altaCompleta(), vehiculoCapacidad: capacidad };
    assert.notEqual(estadoDeCampo('vehiculoCapacidad', datos), ESTADO_OK, `capacidad ${capacidad}`);
  }
});

test('cada sección se completa por su cuenta', () => {
  const datos = { ...altaCompleta(), vehiculoPlaca: '' };
  assert.equal(seccionCompleta('personales', datos), true);
  assert.equal(seccionCompleta('vehiculares', datos), false);
  assert.equal(seccionCompleta('manejo', datos), true);
});

test('los pendientes salen en el orden del formulario', () => {
  const datos = { ...altaCompleta(), nombres: '', vehiculoPlaca: '', quizManejoDefensivo: null };
  assert.deepEqual(
    camposPendientes(datos).map((r) => r.campo),
    ['nombres', 'vehiculoPlaca', 'quizManejoDefensivo'],
  );
});
