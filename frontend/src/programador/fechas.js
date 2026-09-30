/**
 * Una fecha ISO en el formato que se lee en Perú, o una raya si no hay.
 *
 * Vive en su propio archivo porque la usan los dos paneles de carga y
 * exportarla desde uno de ellos rompe el refresco en caliente de Vite, que
 * solo funciona cuando un archivo exporta componentes y nada más.
 */
export const fecha = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-PE');
};

/** Una fecha ISO corta y con el día de la semana: «mar, 22 set.». */
export const fechaCorta = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-PE',
    { weekday: 'short', day: '2-digit', month: 'short' });
};

/** Si dos fechas ISO caen en el mismo día de la semana. */
export const mismoDiaDeLaSemana = (a, b) => {
  const da = new Date(`${a}T00:00:00`);
  const db = new Date(`${b}T00:00:00`);
  return !Number.isNaN(da.getTime()) && !Number.isNaN(db.getTime()) && da.getDay() === db.getDay();
};

/** El día de hoy en ISO según el reloj del navegador, que es el de la operación. */
export const hoyISO = () => {
  const d = new Date();
  return [
    d.getFullYear(),
    `${d.getMonth() + 1}`.padStart(2, '0'),
    `${d.getDate()}`.padStart(2, '0'),
  ].join('-');
};

export default fecha;
