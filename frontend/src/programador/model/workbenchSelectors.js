/**
 * KPIs y filtros de la mesa del Programador.
 *
 * Todo aquí es puro y sin React a propósito: son las reglas que deciden qué ve
 * el Programador, y deben poder probarse sin montar un árbol de componentes.
 */

// Extensión explícita: Node la exige al ejecutar las pruebas, aunque Vite la
// resuelva sin ella.
import { UNASSIGNED } from './serviceModel.js';

const norm = (value) => String(value ?? '').trim();
const lower = (value) => norm(value).toLowerCase();

export const ALL = '__all__';

export const emptyFilters = () => ({
  microZona: ALL,
  horario: ALL,
  estado: ALL,
  asignacion: ALL, // ALL | asignados | sin_asignar
  cambio: ALL, // ALL | modificados | sin_cambio
  query: '',
});

/**
 * KPIs del encabezado.
 *
 * `capacidadLibre` solo suma servicios cuya unidad declara capacidad. Cuando
 * alguna no la declara se informa aparte en `capacidadDesconocida`, para que la
 * cifra no se lea como un total exacto que en realidad es parcial.
 *
 * `sinColocar` son los pendientes del plan, y suman a «agentes sin asignar»
 * porque son exactamente eso. Sin ellos el contador daba cero justo después de
 * aplicar las novedades —cuando el plan no tiene servicios huérfanos, sino
 * personas fuera de todo servicio—, que es el único momento en que ese número
 * tenía algo que decir.
 */
export const computeKpis = (services, sinColocar = 0) => {
  const list = Array.isArray(services) ? services : [];

  return list.reduce(
    (acc, service) => {
      acc.servicios += 1;
      if (service.asignado) {
        acc.serviciosAsignados += 1;
        acc.agentesAsignados += service.agentCount;
        if (service.capacity.known) acc.capacidadLibre += service.capacity.free;
        else acc.capacidadDesconocida += 1;
        if (service.capacity.over) acc.excedidos += 1;
      } else {
        acc.agentesSinAsignar += service.agentCount;
      }
      return acc;
    },
    {
      servicios: 0,
      serviciosAsignados: 0,
      agentesAsignados: 0,
      agentesSinAsignar: sinColocar,
      capacidadLibre: 0,
      capacidadDesconocida: 0,
      excedidos: 0,
    },
  );
};

/** Valores presentes en los datos, para poblar los desplegables. */
export const filterOptions = (services) => {
  const list = Array.isArray(services) ? services : [];
  const collect = (pick) =>
    [...new Set(list.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));

  return {
    microZonas: collect((s) => s.microZona),
    horarios: collect((s) => s.horario),
  };
};

/**
 * Padrón escrito de cualquiera de las dos formas.
 *
 * La flota registra «K-027» y el histórico de la intranet «K027», así que
 * quien buscaba su unidad con el guion —que es como está impresa— no
 * encontraba nada. Comparar sin guiones ni espacios hace que las dos formas
 * lleguen al mismo sitio.
 */
const soloAlfanumerico = (valor) => lower(valor).replace(/[^a-z0-9]/g, '');

/** Si esa unidad empieza por lo que se ha escrito. */
const esPadron = (service, padron) =>
  Boolean(padron) && soloAlfanumerico(service.conductor).startsWith(padron);

/**
 * Busca en el servicio y también dentro de sus agentes: el Programador busca
 * por nombre o dirección de una persona tanto como por unidad.
 */
const matchesQuery = (service, query) => {
  if (!query) return true;
  const needle = lower(query);
  const inService = [service.conductor, service.microZona, service.horario, service.empresa]
    .some((field) => lower(field).includes(needle));
  if (inService) return true;

  return service.agentes.some((agente) =>
    [agente?.id, agente?.nombre, agente?.direccion].some((field) => lower(field).includes(needle)),
  );
};

/**
 * El padrón manda sobre el resto de la búsqueda.
 *
 * Buscar por texto suelto dentro de los agentes es útil, pero con una letra
 * sola lo inunda todo: escribir «K» devolvía 96 de 135 servicios porque hay
 * agentes que se llaman KEIKO o KAROL. Y lo que el Programador está haciendo
 * al escribir «K» es mirar sus unidades, no buscar a nadie.
 *
 * Por eso, si lo escrito es el principio de algún padrón, se enseñan **solo**
 * esas unidades. Si no lo es, se busca en todo como antes. La regla no es
 * ambigua porque los padrones son una letra y tres dígitos: «V» y «V02» son
 * prefijos de unidad, y «VEGA» no lo es de ninguna, así que un apellido cae
 * por su propio peso en la búsqueda general.
 */
export const applyFilters = (services, filters) => {
  const list = Array.isArray(services) ? services : [];
  const f = { ...emptyFilters(), ...(filters || {}) };

  const previos = list.filter((service) => {
    if (f.microZona !== ALL && service.microZona !== f.microZona) return false;
    if (f.horario !== ALL && service.horario !== f.horario) return false;
    if (f.estado !== ALL && service.estado !== f.estado) return false;
    if (f.asignacion === 'asignados' && !service.asignado) return false;
    if (f.asignacion === 'sin_asignar' && service.asignado) return false;
    if (f.cambio === 'modificados' && !service.modificado) return false;
    if (f.cambio === 'sin_cambio' && service.modificado) return false;
    return true;
  });

  if (!f.query) return previos;

  const padron = soloAlfanumerico(f.query);
  const porPadron = previos.filter((service) => esPadron(service, padron));
  if (porPadron.length > 0) return porPadron;

  return previos.filter((service) => matchesQuery(service, f.query));
};

/**
 * Orden cronológico por horario, con los servicios sin asignar al final: son
 * trabajo pendiente, no parte de la secuencia del día.
 */
export const sortServices = (services) =>
  [...(services || [])].sort((a, b) => {
    if (a.asignado !== b.asignado) return a.asignado ? -1 : 1;
    const byHorario = norm(a.horario).localeCompare(norm(b.horario), 'es', { numeric: true });
    if (byHorario !== 0) return byHorario;
    return norm(a.microZona).localeCompare(norm(b.microZona), 'es');
  });

export const isUnassigned = (conductor) => norm(conductor) === UNASSIGNED || !norm(conductor);
