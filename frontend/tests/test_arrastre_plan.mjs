import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServices, indexFleet } from '../src/programador/model/serviceModel.js';
import {
  cambiosParaDejarPendiente,
  cambiosParaSoltar,
  comprobarDestino,
  opcionesParaMover,
  personaDePendiente,
  personaDeServicio,
  textoDeLaPosicion,
} from '../src/programador/model/arrastrePlan.js';

// Tres puntos de norte a sur, a ~1,1 km uno de otro.
const NORTE = { lat: -12.00, lng: -77.05 };
const CENTRO = { lat: -12.01, lng: -77.05 };
const SUR = { lat: -12.02, lng: -77.05 };

const FLOTA = { flota: [{ unidad_id: 'K-027', capacidad: 4 }, { unidad_id: 'K-030', capacidad: 4 }] };
const BELLAVISTA = 'TELEPERFORMANCE BELLAVISTA';

const agente = (id, punto = {}) => ({ id, nombre: `Agente ${id}`, ...punto });

const ruta = (conductor, extra) => ({
  conductor,
  micro_zona: 'CLL1',
  turno: '05:00',
  modalidad: 'RECOJO',
  horario: '05:00 recojo',
  sede: BELLAVISTA,
  agentes: [],
  ...extra,
});

const servicios = (rutas) => buildServices(rutas, indexFleet(FLOTA));

const DOS_SERVICIOS = () => servicios([
  ruta('K027', { agentes: [agente('A', CENTRO)] }),
  ruta('K030', { agentes: [agente('B', NORTE), agente('C', SUR)] }),
]);

test('soltar a alguien en su propio servicio no hace nada y no se explica', () => {
  const [origen] = DOS_SERVICIOS();
  const r = comprobarDestino(personaDeServicio(origen, origen.agentes[0]), origen);
  assert.equal(r.permitido, false);
  assert.equal(r.motivo, null);
});

test('de un servicio a otro del mismo turno, sentido y sede, sin avisos', () => {
  const [origen, destino] = DOS_SERVICIOS();
  const r = comprobarDestino(personaDeServicio(origen, origen.agentes[0]), destino);
  assert.deepEqual(r, { permitido: true, motivo: null, avisos: [] });
});

test('un recojo no se suelta en una salida, ni en otra sede', () => {
  const [origen] = DOS_SERVICIOS();
  const persona = personaDeServicio(origen, origen.agentes[0]);
  const [salida, otraSede] = servicios([
    ruta('K030', { modalidad: 'SALIDA', horario: '05:00 salida', agentes: [agente('B')] }),
    ruta('K031', { sede: 'TELEPERFORMANCE MAGDALENA', agentes: [agente('C')] }),
  ]);
  const aSalida = comprobarDestino(persona, salida);
  assert.equal(aSalida.permitido, false);
  assert.match(aSalida.motivo, /recojo.*salida/);
  const aOtraSede = comprobarDestino(persona, otraSede);
  assert.equal(aOtraSede.permitido, false);
  assert.match(aOtraSede.motivo, /MAGDALENA/);
});

test('quien ya va en el servicio de destino no se duplica', () => {
  const [origen] = DOS_SERVICIOS();
  const [conElla] = servicios([ruta('K030', { agentes: [agente('A')] })]);
  const r = comprobarDestino(personaDeServicio(origen, origen.agentes[0]), conElla);
  assert.equal(r.permitido, false);
  assert.match(r.motivo, /ya va/);
});

test('otro turno se deja, pero avisando: llegaría a otra hora', () => {
  const [origen] = DOS_SERVICIOS();
  const [otroTurno] = servicios([ruta('K030', { turno: '06:00', horario: '06:00 recojo' })]);
  const r = comprobarDestino(personaDeServicio(origen, origen.agentes[0]), otroTurno);
  assert.equal(r.permitido, true);
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /05:00.*06:00/);
});

test('las 22:00 y las 22:01 son el mismo turno también a mano', () => {
  const [origen, destino] = servicios([
    ruta('K027', { turno: '22:00', modalidad: 'SALIDA', agentes: [agente('A')] }),
    ruta('K030', { turno: '22:01', modalidad: 'SALIDA' }),
  ]);
  assert.deepEqual(comprobarDestino(personaDeServicio(origen, origen.agentes[0]), destino).avisos, []);
});

test('pasarse de la capacidad se deja, avisando', () => {
  const [origen] = DOS_SERVICIOS();
  const [lleno] = servicios([ruta('K030', { agentes: ['B', 'C', 'D', 'E'].map((id) => agente(id)) })]);
  const r = comprobarDestino(personaDeServicio(origen, origen.agentes[0]), lleno);
  assert.equal(r.permitido, true);
  assert.match(r.avisos[0], /5 de 4/);
});

test('una novedad sin turno ni sentido se deja soltar, pero se avisa', () => {
  const [, destino] = DOS_SERVICIOS();
  const persona = personaDePendiente({ clave: 'P1', dni: 'P1', turno: '', modalidad: '' });
  const r = comprobarDestino(persona, destino);
  assert.equal(r.permitido, true);
  assert.match(r.avisos[0], /no trae turno/);
});

test('mover es una tanda: sale de su servicio y entra donde menos alarga el recorrido', () => {
  const [origen, destino] = DOS_SERVICIOS();
  const { posicion, cambios } = cambiosParaSoltar(personaDeServicio(origen, origen.agentes[0]), destino);
  // Vive en el centro: entre el del norte y el del sur.
  assert.equal(posicion, 1);
  assert.deepEqual(cambios, [
    {
      accion: 'mover',
      dni: 'A',
      desde: { vehiculo: 'K027', turno: '05:00', modalidad: 'RECOJO' },
      hacia: { vehiculo: 'K030', turno: '05:00', modalidad: 'RECOJO', cobertura: 'CLL1' },
    },
    {
      accion: 'ordenar', vehiculo: 'K030', turno: '05:00', modalidad: 'RECOJO',
      dnis: ['B', 'A', 'C'], requiere_anterior: true,
    },
  ]);
});

test('una posición elegida manda sobre la del motor', () => {
  const [origen, destino] = DOS_SERVICIOS();
  const { posicion, cambios } = cambiosParaSoltar(
    personaDeServicio(origen, origen.agentes[0]), destino, 2);
  assert.equal(posicion, 2);
  assert.deepEqual(cambios[1].dnis, ['B', 'C', 'A']);
});

test('desde pendientes se agrega con el origen de la novedad', () => {
  const [, destino] = DOS_SERVICIOS();
  const persona = personaDePendiente({
    clave: 'P1|05:00|RECOJO', dni: 'P1', nombre: 'Nueva', turno: '05:00', modalidad: 'RECOJO',
    cobertura: 'CLL1', sede: BELLAVISTA, ...CENTRO, habituales: [], motivo: 'alta',
  });
  const { cambios } = cambiosParaSoltar(persona, destino);
  assert.equal(cambios[0].accion, 'agregar');
  assert.equal(cambios[0].origen, 'novedad');
  assert.equal(cambios[0].vehiculo, 'K030');
  assert.deepEqual(cambios[1].dnis, ['B', 'P1', 'C']);
});

test('dejarla pendiente saca de su unidad, sin baja', () => {
  const [origen] = DOS_SERVICIOS();
  assert.deepEqual(cambiosParaDejarPendiente(personaDeServicio(origen, origen.agentes[0])), [
    { accion: 'a_pendientes', dni: 'A', vehiculo: 'K027', turno: '05:00', modalidad: 'RECOJO' },
  ]);
});

test('las opciones para mover sin arrastrar no incluyen su servicio ni otro turno', () => {
  const lista = servicios([
    ruta('K027', { agentes: [agente('A', CENTRO)] }),
    ruta('K030', { agentes: [agente('B', NORTE)] }),
    ruta('K031', { turno: '06:00', horario: '06:00 recojo' }),
  ]);
  const opciones = opcionesParaMover(personaDeServicio(lista[0], lista[0].agentes[0]), lista);
  assert.deepEqual(opciones.candidatos.map((c) => c.service.conductor), ['K030']);
});

test('el aviso de dónde quedó habla de recogida o de entrega según el sentido', () => {
  const [recojo, salida] = servicios([
    ruta('K027'), ruta('K030', { modalidad: 'SALIDA', horario: '22:01 salida' }),
  ]);
  assert.equal(textoDeLaPosicion(recojo, 0), 'K027 · 05:00 recojo, 1.º en el orden de recogida');
  assert.match(textoDeLaPosicion(salida, 2), /3\.º en el orden de entrega/);
});
