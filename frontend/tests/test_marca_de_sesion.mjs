import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLAVE_MARCA,
  CLAVE_USUARIO_ANTIGUA,
  haySesionRecordada,
  marcaDeSesion,
  olvidarSesion,
  recordarSesion,
} from '../src/utils/marcaDeSesion.js';

/** `localStorage` de mentira: lo justo para ver qué queda escrito. */
const almacenEnMemoria = (inicial = {}) => {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (clave) => (datos.has(clave) ? datos.get(clave) : null),
    setItem: (clave, valor) => { datos.set(clave, String(valor)); },
    removeItem: (clave) => { datos.delete(clave); },
    contenido: () => Object.fromEntries(datos),
  };
};

/** Como el de una ventana privada o con los datos del sitio bloqueados. */
const almacenQueFalla = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('SecurityError'); },
};

// Lo que devuelven el login y /api/user/profile para un conductor importado.
const conductor = {
  identifier: '41234567',
  email: 'quispe.mamani@kapital.com',
  dni: '41234567',
  nombre: 'Juan Quispe Mamani',
  rol: 'Conductor',
  unidad_id: 'K-027',
  estado: 'Activo',
  profileComplete: true,
  perfil_conductor: {
    numDoc: '41234567',
    direccion: 'Mz. B Lt. 12, San Juan de Lurigancho',
    celular: '922551637',
    telefonoEmergencia: '987654321',
    fechaNacimiento: '1985-03-14',
    solicitudes_cambio: { direccion: { new_value: 'Av. Próceres 450', status: 'pendiente' } },
  },
};

test('del usuario de un conductor no queda en el navegador nada suyo', () => {
  const almacen = almacenEnMemoria();

  assert.equal(recordarSesion(conductor, almacen), true);

  // Ni el perfil, ni el DNI, ni el nombre: solo la marca.
  assert.deepEqual(almacen.contenido(), { [CLAVE_MARCA]: marcaDeSesion(conductor) });
  const guardado = JSON.stringify(almacen.contenido());
  for (const dato of ['41234567', 'Quispe', 'San Juan', '922551637', '1985-03-14', 'K-027', 'Conductor']) {
    assert.ok(!guardado.includes(dato), `no debe guardarse «${dato}»`);
  }
});

test('la marca es la misma sea quien sea: no dice de quién es la sesión', () => {
  const gerente = { identifier: 'gerente@kapital.com', email: 'gerente@kapital.com', rol: 'Gerente de Operaciones' };
  const soloCorreo = { identifier: null, email: 'quispe.mamani@kapital.com', rol: 'Conductor' };

  assert.equal(typeof marcaDeSesion(conductor), 'string');
  assert.equal(marcaDeSesion(gerente), marcaDeSesion(conductor));
  // 124 de las 128 cuentas no llevan `identifier`: con el correo basta.
  assert.equal(marcaDeSesion(soloCorreo), marcaDeSesion(conductor));
});

test('sin una identidad utilizable no hay nada que recordar', () => {
  const sinIdentidad = [
    null, undefined, 'conductor', 42, [], [conductor], {},
    { nombre: 'Juan', rol: 'Conductor' },
    { identifier: '   ', email: '' },
    { identifier: 41234567 },
  ];
  for (const usuario of sinIdentidad) {
    assert.equal(marcaDeSesion(usuario), null, `con ${JSON.stringify(usuario)}`);
  }
});

test('recordar algo que no es un usuario borra la marca que hubiera', () => {
  const almacen = almacenEnMemoria({ [CLAVE_MARCA]: '1' });

  assert.equal(recordarSesion({ nombre: 'Juan' }, almacen), false);

  assert.deepEqual(almacen.contenido(), {});
});

test('recordar retira el usuario entero que guardaban las versiones anteriores', () => {
  const almacen = almacenEnMemoria({ [CLAVE_USUARIO_ANTIGUA]: JSON.stringify(conductor) });

  recordarSesion(conductor, almacen);

  assert.equal(almacen.getItem(CLAVE_USUARIO_ANTIGUA), null);
  assert.notEqual(almacen.getItem(CLAVE_MARCA), null);
});

test('lo guardado por una versión anterior cuenta como sesión', () => {
  // Si no contara, todo el que tenía sesión vería el login al desplegar.
  const conUsuarioAntiguo = almacenEnMemoria({ [CLAVE_USUARIO_ANTIGUA]: JSON.stringify(conductor) });
  // Aunque esté roto: quien decide si la sesión vale es el servidor.
  const conUsuarioRoto = almacenEnMemoria({ [CLAVE_USUARIO_ANTIGUA]: '{"identif' });

  assert.equal(haySesionRecordada(conUsuarioAntiguo), true);
  assert.equal(haySesionRecordada(conUsuarioRoto), true);
});

test('preguntar si hay sesión no escribe ni borra nada', () => {
  const inicial = { [CLAVE_USUARIO_ANTIGUA]: JSON.stringify(conductor) };
  const almacen = almacenEnMemoria(inicial);

  haySesionRecordada(almacen);

  assert.deepEqual(almacen.contenido(), inicial);
});

test('un navegador donde nadie entró no tiene sesión que validar', () => {
  assert.equal(haySesionRecordada(almacenEnMemoria()), false);
  assert.equal(haySesionRecordada(almacenEnMemoria({ kapital_theme: 'dark' })), false);
});

test('recordar y después preguntar dice que hay sesión', () => {
  const almacen = almacenEnMemoria();

  recordarSesion(conductor, almacen);

  assert.equal(haySesionRecordada(almacen), true);
});

test('olvidar borra la marca y lo que quedara de versiones anteriores', () => {
  const almacen = almacenEnMemoria({
    [CLAVE_MARCA]: '1',
    [CLAVE_USUARIO_ANTIGUA]: JSON.stringify(conductor),
    kapital_theme: 'light',
  });

  olvidarSesion(almacen);

  assert.equal(haySesionRecordada(almacen), false);
  // El tema es del navegador, no de la persona: se queda.
  assert.deepEqual(almacen.contenido(), { kapital_theme: 'light' });
});

test('si el almacenamiento no está disponible no revienta', () => {
  for (const almacen of [almacenQueFalla, null]) {
    assert.equal(haySesionRecordada(almacen), false);
    assert.equal(recordarSesion(conductor, almacen), false);
    assert.doesNotThrow(() => olvidarSesion(almacen));
  }
});

test('si no se puede borrar lo antiguo, recordar no lo da por hecho', () => {
  const almacen = almacenEnMemoria({ [CLAVE_USUARIO_ANTIGUA]: JSON.stringify(conductor) });
  almacen.removeItem = () => { throw new Error('SecurityError'); };

  assert.equal(recordarSesion(conductor, almacen), false);
});
