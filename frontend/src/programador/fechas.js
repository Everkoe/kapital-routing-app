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

export default fecha;
