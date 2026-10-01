import { nombreDeDescarga } from './documentoArchivo.js';

// Lo que tarda en soltarse la copia local: lo justo para que la descarga arranque.
const ESPERA_ANTES_DE_LIBERAR_MS = 1000;

/**
 * Guarda en el equipo el archivo que enseña el visor.
 *
 * No basta con un enlace con `download` a la URL: la URL firmada es de otro
 * origen (el bucket), y ahí el navegador ignora `download` y abre la imagen en
 * la pestaña en vez de guardarla. Se baja primero como copia local (`blob:`),
 * que sí es del mismo origen, y de paso su tipo da la extensión del nombre.
 * Lanza si no se pudo bajar, para que quien llama lo diga.
 */
export const descargarArchivo = async (src, { titulo, prefijo, nombreOriginal, tipo }) => {
  const respuesta = await fetch(src);
  if (!respuesta.ok) throw new Error(`No se pudo bajar el archivo (${respuesta.status}).`);
  const blob = await respuesta.blob();

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreDeDescarga({ titulo, prefijo, nombreOriginal, tipo: blob.type || tipo });
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), ESPERA_ANTES_DE_LIBERAR_MS);
};
