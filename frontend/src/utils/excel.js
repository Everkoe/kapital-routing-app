import { toast } from 'react-hot-toast';

/**
 * La librería de Excel, cargada solo cuando se exporta.
 *
 * Pesa 275 KB y estaba en el paquete que descarga todo el mundo al abrir la
 * aplicación —también el conductor desde el teléfono—, aunque solo se usa al
 * pulsar «Exportar». Tras la primera vez el navegador ya la tiene.
 */
const cargarExcel = () => import('xlsx');

/**
 * Escribe un libro con una hoja por cada `{ nombre, filas }` que traiga filas.
 * Devuelve si se generó: con la conexión caída la librería no llega, y sin
 * este aviso el botón no haría nada.
 */
export const exportarLibro = async (hojas, nombreDeArchivo) => {
  let XLSX;
  try {
    XLSX = await cargarExcel();
  } catch {
    toast.error('No se pudo preparar el Excel. Revisa la conexión e inténtalo de nuevo.');
    return false;
  }
  const libro = XLSX.utils.book_new();
  for (const { nombre, filas } of hojas) {
    if (filas.length > 0) XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(filas), nombre);
  }
  XLSX.writeFile(libro, nombreDeArchivo);
  return true;
};
