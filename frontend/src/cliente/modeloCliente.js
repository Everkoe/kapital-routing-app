/**
 * Lo que el cliente ve del transporte de su personal, sin React.
 *
 * Los datos llegan de `GET /api/cliente/servicios` (función
 * `servicios_de_empresa`, supabase/010): los servicios del día con la unidad,
 * quién la conduce y cada persona con lo que marcó el conductor, más quien
 * viaja ese día y todavía no tiene unidad.
 */

import { esRecojo, momentoDelTurno, nombreDeSede } from '../conductor/modeloServicios.js';

export { esRecojo, nombreDeSede };

// Pasado este margen tras el turno, lo que el conductor no marcó ya no está
// «programado»: nadie lo confirmó. Es el mismo que usa el conductor para dar
// un servicio por acabado (una salida deja a su gente ~36 min después).
const MARGEN_CONFIRMACION_MIN = { RECOJO: 30, SALIDA: 90 };

const sinAcentos = (texto) =>
  String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * La sede sin el nombre de la empresa, que el cliente ya sabe:
 * «TELEPERFORMANCE BELLAVISTA» → «Bellavista».
 */
export const nombreCortoDeSede = (sede, empresa) => {
  const completo = nombreDeSede(sede);
  const prefijo = sinAcentos(empresa).replace(/[^A-Z0-9]/g, '');
  if (!prefijo) return completo;
  const palabras = completo.split(' ');
  for (let corte = 1; corte < palabras.length; corte += 1) {
    const inicio = sinAcentos(palabras.slice(0, corte).join('')).replace(/[^A-Z0-9]/g, '');
    if (inicio === prefijo) return palabras.slice(corte).join(' ');
  }
  return completo;
};

/** Cómo va una persona: lo que marcó el conductor, o si aún puede pasar. */
export const estadoDePersona = (persona, servicio, fecha, ahora = new Date()) => {
  if (persona?.viaje === 'a_bordo') return 'a_bordo';
  if (persona?.viaje === 'no_se_presento') return 'no_se_presento';
  const margen = MARGEN_CONFIRMACION_MIN[esRecojo(servicio) ? 'RECOJO' : 'SALIDA'];
  const limite = momentoDelTurno({ fecha, turno: servicio?.turno }).getTime() + margen * 60_000;
  return ahora.getTime() > limite ? 'sin_confirmar' : 'programado';
};

export const ETIQUETAS_DE_ESTADO = Object.freeze({
  a_bordo: 'A bordo',
  no_se_presento: 'No se presentó',
  sin_confirmar: 'Sin confirmar',
  programado: 'Programado',
});

/** Las cifras del día: personas, cómo van, servicios, unidades y sin unidad. */
export const resumenDelDia = (respuesta, ahora = new Date()) => {
  const servicios = respuesta?.servicios || [];
  const cuenta = { a_bordo: 0, no_se_presento: 0, sin_confirmar: 0, programado: 0 };
  let personas = 0;
  servicios.forEach((servicio) => {
    (servicio.personas || []).forEach((persona) => {
      personas += 1;
      cuenta[estadoDePersona(persona, servicio, respuesta.fecha, ahora)] += 1;
    });
  });
  return {
    personas,
    aBordo: cuenta.a_bordo,
    noSePresento: cuenta.no_se_presento,
    sinConfirmar: cuenta.sin_confirmar,
    programados: cuenta.programado,
    servicios: servicios.length,
    unidades: new Set(servicios.map((s) => s.unidad)).size,
    sinUnidad: (respuesta?.pendientes || []).length,
  };
};

/** Las sedes del día, con cuántas personas van a cada una, de más a menos. */
export const sedesDelDia = (servicios) => {
  const cuentas = new Map();
  (servicios || []).forEach((servicio) => {
    (servicio.personas || []).forEach((persona) => {
      const sede = persona.sede || servicio.sede || '';
      cuentas.set(sede, (cuentas.get(sede) || 0) + 1);
    });
  });
  return [...cuentas.entries()]
    .map(([sede, personas]) => ({ sede, personas }))
    .sort((a, b) => b.personas - a.personas || a.sede.localeCompare(b.sede));
};

const coincideServicio = (servicio, buscado) => {
  const conductor = servicio.conductor || {};
  return [servicio.unidad, conductor.placa, conductor.nombre].some((campo) => sinAcentos(campo).includes(buscado));
};

const coincidePersona = (persona, buscado) =>
  sinAcentos(persona.nombre).includes(buscado) || String(persona.dni || '').includes(buscado);

/**
 * Los servicios que cumplen los filtros. Buscar a una persona deja en su
 * servicio solo a quien coincide; buscar una unidad, placa o conductor deja el
 * servicio entero. No cambia los servicios originales.
 */
export const filtrarServicios = (servicios, { sede = '', modalidad = '', texto = '' } = {}) => {
  const buscado = sinAcentos(texto).trim();
  return (servicios || []).flatMap((servicio) => {
    if (modalidad && String(servicio.modalidad).toUpperCase() !== modalidad) return [];
    let personas = servicio.personas || [];
    if (sede) personas = personas.filter((p) => (p.sede || servicio.sede) === sede);
    if (!personas.length) return [];
    if (buscado && !coincideServicio(servicio, buscado)) {
      personas = personas.filter((p) => coincidePersona(p, buscado));
      if (!personas.length) return [];
    }
    return [personas === servicio.personas ? servicio : { ...servicio, personas }];
  });
};

/** Los servicios agrupados por turno y sentido, en orden de hora. */
export const agruparPorTurno = (servicios) => {
  const grupos = new Map();
  (servicios || []).forEach((servicio) => {
    const clave = `${servicio.turno}|${servicio.modalidad}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { clave, turno: servicio.turno, modalidad: servicio.modalidad, servicios: [], personas: 0 });
    }
    const grupo = grupos.get(clave);
    grupo.servicios.push(servicio);
    grupo.personas += (servicio.personas || []).length;
  });
  return [...grupos.values()].sort((a, b) =>
    a.turno.localeCompare(b.turno) || String(a.modalidad).localeCompare(String(b.modalidad)));
};

/** «Toyota Hiace · blanco · ABC-123», con lo que haya. */
export const descripcionDelVehiculo = (conductor) => {
  if (!conductor) return '';
  const modelo = [conductor.marca, conductor.modelo].filter(Boolean).join(' ');
  return [modelo, conductor.color && String(conductor.color).toLowerCase(), conductor.placa]
    .filter(Boolean).join(' · ');
};
