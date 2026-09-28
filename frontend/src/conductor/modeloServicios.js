/**
 * Lo que el conductor necesita saber de sus servicios, sin React.
 *
 * Los servicios llegan de `GET /api/conductor/servicios` (función
 * `servicios_de_unidad`, supabase/010): uno por unidad, día, turno y sentido,
 * con sus pasajeros en el orden de recogida que decidió el Programador.
 *
 * Qué significa el turno está medido en el histórico, no supuesto: en un
 * RECOJO es la hora de **entrada** a la sede (el coche empieza ~85 min antes y
 * llega ~22 min antes); en una SALIDA es la hora a la que el coche **sale** de
 * la sede. No se enseña una hora estimada de recogida: el plan no la tiene y
 * sería una promesa.
 */

// Perú no cambia de hora: el desplazamiento de Lima es fijo.
const DESPLAZAMIENTO_LIMA = '-05:00';

// Cuándo se puede marcar a los pasajeros de un servicio, alrededor de su turno.
// Antes: la mediana de un recojo empieza 85 min antes de la entrada y hay
// servicios largos. Después: una salida deja a su gente ~36 min más tarde, y el
// margen es para quien marca al terminar.
export const HORAS_ANTES_DE_MARCAR = 3;
export const HORAS_DESPUES_DE_MARCAR = 6;

const HORA = 60 * 60 * 1000;

export const ESTADOS_DE_VIAJE = Object.freeze({
  A_BORDO: 'a_bordo',
  NO_SE_PRESENTO: 'no_se_presento',
});

/** El instante del turno de un servicio, leído en hora de Lima. */
export const momentoDelTurno = (servicio) => {
  const turno = /^\d{2}:\d{2}$/.test(servicio?.turno || '') ? servicio.turno : '00:00';
  return new Date(`${servicio?.fecha}T${turno}:00${DESPLAZAMIENTO_LIMA}`);
};

export const inicioDeMarcado = (servicio) =>
  new Date(momentoDelTurno(servicio).getTime() - HORAS_ANTES_DE_MARCAR * HORA);

export const finDeMarcado = (servicio) =>
  new Date(momentoDelTurno(servicio).getTime() + HORAS_DESPUES_DE_MARCAR * HORA);

export const sePuedeMarcar = (servicio, ahora = new Date()) =>
  ahora >= inicioDeMarcado(servicio) && ahora <= finDeMarcado(servicio);

export const esRecojo = (servicio) => String(servicio?.modalidad).toUpperCase() === 'RECOJO';

/** Cuántos van, cuántos subieron, cuántos no se presentaron y cuántos faltan. */
export const progresoDelServicio = (servicio) => {
  const pasajeros = Array.isArray(servicio?.pasajeros) ? servicio.pasajeros : [];
  const aBordo = pasajeros.filter((p) => p.viaje === ESTADOS_DE_VIAJE.A_BORDO).length;
  const noSePresento = pasajeros.filter((p) => p.viaje === ESTADOS_DE_VIAJE.NO_SE_PRESENTO).length;
  return {
    total: pasajeros.length,
    aBordo,
    noSePresento,
    marcados: aBordo + noSePresento,
    porMarcar: pasajeros.length - aBordo - noSePresento,
  };
};

const MINUTO = 60 * 1000;

// Cuándo suele empezar y acabar un servicio respecto de su turno (medianas del
// histórico: un recojo arranca ~85 min antes de la entrada; una salida deja a
// su gente ~36 min después). Solo sirven para decir «en curso» o «ya pasó»:
// no se enseñan como hora.
const EMPIEZA_ANTES_MIN = { RECOJO: 90, SALIDA: 10 };
const ACABA_DESPUES_MIN = { RECOJO: 30, SALIDA: 90 };

const minutosDe = (tabla, servicio) => tabla[esRecojo(servicio) ? 'RECOJO' : 'SALIDA'];

/**
 * En qué punto está un servicio:
 * - `terminado`: todos marcados (o no queda nadie que llevar);
 * - `proximo`: todavía no empezó;
 * - `en_curso`: empezó (o ya hay alguien marcado) y no ha acabado;
 * - `sin_cerrar`: acabó con gente sin marcar, y todavía se puede marcar;
 * - `vencido`: ya no se puede marcar.
 */
export const estadoDelServicio = (servicio, ahora = new Date()) => {
  const { total, porMarcar, marcados } = progresoDelServicio(servicio);
  if (total === 0 || porMarcar === 0) return 'terminado';
  if (ahora > finDeMarcado(servicio)) return 'vencido';
  const turno = momentoDelTurno(servicio).getTime();
  if (ahora.getTime() > turno + minutosDe(ACABA_DESPUES_MIN, servicio) * MINUTO) return 'sin_cerrar';
  if (marcados > 0 || ahora.getTime() >= turno - minutosDe(EMPIEZA_ANTES_MIN, servicio) * MINUTO) {
    return 'en_curso';
  }
  return 'proximo';
};

/** El servicio al que el conductor tiene que atender ahora: el primero en curso o por venir. */
export const proximoServicio = (servicios, ahora = new Date()) => {
  const pendientes = (servicios || [])
    .filter((s) => ['en_curso', 'proximo'].includes(estadoDelServicio(s, ahora)))
    .sort((a, b) => momentoDelTurno(a) - momentoDelTurno(b));
  return pendientes[0] || null;
};

/** Identifica un servicio dentro de la respuesta (no hay un id propio). */
export const claveDelServicio = (servicio) =>
  [servicio?.fecha, servicio?.unidad, servicio?.turno, servicio?.modalidad].join('|');

export const serviciosDelDia = (servicios, fecha) =>
  (servicios || [])
    .filter((s) => s.fecha === fecha)
    .sort((a, b) => momentoDelTurno(a) - momentoDelTurno(b));

/** «TELEPERFORMANCE BELLAVISTA» → «Teleperformance Bellavista». */
export const nombreDeSede = (sede) => {
  const texto = String(sede || '').trim();
  if (!texto) return 'la sede';
  return texto
    .toLowerCase()
    .split(/\s+/)
    .map((palabra) => (/^\d+$/.test(palabra) ? palabra : palabra.charAt(0).toUpperCase() + palabra.slice(1)))
    .join(' ');
};

/** La frase que dice qué hay que hacer con el turno de un servicio. */
export const objetivoDelServicio = (servicio) =>
  esRecojo(servicio)
    ? `Entrada en ${nombreDeSede(servicio.sede)} a las ${servicio.turno}`
    : `Salida de ${nombreDeSede(servicio.sede)} a las ${servicio.turno}`;

const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const diaUTC = (fecha) => {
  const [anio, mes, dia] = String(fecha || '').split('-').map(Number);
  return anio && mes && dia ? new Date(Date.UTC(anio, mes - 1, dia)) : null;
};

/** La fecha ISO `n` días después. */
export const sumarDias = (fecha, n) => {
  const base = diaUTC(fecha);
  return base ? new Date(base.getTime() + n * 24 * HORA).toISOString().slice(0, 10) : '';
};

/** «Hoy», «Mañana», «Ayer» o el día de la semana, con la fecha siempre al lado. */
export const nombreDelDia = (fecha, hoy) => {
  const base = diaUTC(fecha);
  if (!base) return { titulo: String(fecha || ''), fecha: '' };
  const corto = `${DIAS_SEMANA[base.getUTCDay()]} ${base.getUTCDate()} ${MESES[base.getUTCMonth()]}`;
  const relativo = { [hoy]: 'Hoy', [sumarDias(hoy, 1)]: 'Mañana', [sumarDias(hoy, -1)]: 'Ayer' }[fecha];
  return { titulo: relativo || corto, fecha: corto };
};

/** «21:34», en hora de Lima, de un instante ISO. */
export const horaDeLima = (iso) => {
  if (!iso) return '';
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return '';
  return new Date(instante.getTime() - 5 * HORA).toISOString().slice(11, 16);
};

const tieneCoordenada = (pasajero) =>
  pasajero?.lat !== null && pasajero?.lat !== undefined && pasajero?.lng !== null && pasajero?.lng !== undefined
  && Number.isFinite(Number(pasajero.lat)) && Number.isFinite(Number(pasajero.lng))
  && pasajero.ubicacion !== 'no_resuelta';

const direccionBuscable = (pasajero) =>
  [pasajero?.direccion, pasajero?.distrito, 'Lima'].filter(Boolean).join(', ');

/**
 * Cómo llegar a un pasajero. Con su punto en el mapa, al punto; sin él, a la
 * dirección escrita, que es lo único cierto que hay (ver `estado_ubicacion`:
 * a quien no se ubicó no se le inventa una coordenada).
 */
export const enlacesDeNavegacion = (pasajero) => {
  if (tieneCoordenada(pasajero)) {
    const punto = `${Number(pasajero.lat)},${Number(pasajero.lng)}`;
    return {
      googleMaps: `https://www.google.com/maps/dir/?api=1&destination=${punto}&travelmode=driving`,
      waze: `https://waze.com/ul?ll=${punto}&navigate=yes`,
      porDireccion: false,
    };
  }
  const direccion = encodeURIComponent(direccionBuscable(pasajero));
  return {
    googleMaps: `https://www.google.com/maps/dir/?api=1&destination=${direccion}&travelmode=driving`,
    waze: `https://waze.com/ul?q=${direccion}&navigate=yes`,
    porDireccion: true,
  };
};

/** Un aviso sobre la ubicación, o nada si es fiable. */
export const avisoDeUbicacion = (pasajero) => {
  if (pasajero?.ubicacion === 'resuelta') return '';
  if (tieneCoordenada(pasajero)) return 'Ubicación aproximada: confirma con la dirección.';
  return 'Sin punto en el mapa: guíate por la dirección.';
};

/** El pasajero con su marca cambiada, sin tocar el servicio original. */
export const conMarca = (servicios, idPasajero, viaje, marcadoEn = null) =>
  (servicios || []).map((servicio) => {
    if (!(servicio.pasajeros || []).some((p) => p.id === idPasajero)) return servicio;
    return {
      ...servicio,
      pasajeros: servicio.pasajeros.map((p) =>
        p.id === idPasajero ? { ...p, viaje, marcado_en: viaje ? marcadoEn : null } : p),
    };
  });

/**
 * Lo leído del servidor con las marcas hechas desde esta pantalla encima.
 *
 * Una lectura que salió antes de guardarse una marca y llega después trae el
 * estado anterior, y la borraría. Manda la marca si sigue sin respuesta o se
 * escribió después de salir la lectura; las anteriores ya vienen en lo leído y
 * dejan de hacer falta. `vigentes` dice cuáles hay que seguir recordando.
 */
export const superponerMarcas = (servicios, escritas, salida) => {
  let resultado = servicios || [];
  const vigentes = [];
  for (const [id, marca] of escritas) {
    if (marca.pendiente || marca.escritaEn >= salida) {
      resultado = conMarca(resultado, id, marca.viaje, marca.marcadoEn);
      vigentes.push(id);
    }
  }
  return { servicios: resultado, vigentes };
};
