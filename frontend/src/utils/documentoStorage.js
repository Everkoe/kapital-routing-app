import { apiFetch } from './apiClient';
import { documentoABase64 } from './imageUtils';

/**
 * Sube un documento a Supabase Storage y devuelve lo que se guarda en el perfil.
 *
 * Por qué no se guarda el archivo en el perfil
 * --------------------------------------------
 * Todo el estado de la aplicación vive en una sola fila de `app_state`, así que
 * guardar los documentos como base64 hacía que cada envío de perfil reescribiera
 * la fila entera. Medido: 9,8 MB que tardaban 18,7 s en subir, cuando una
 * función serverless se corta a los 10 s. El envío fallaba con un mensaje
 * genérico y sin forma de saber por qué.
 *
 * Ahora el perfil guarda `{ name, size, type, path }` —unas decenas de bytes— y
 * el archivo vive en un bucket privado. Se ve mediante URLs firmadas de vida
 * corta que solo se emiten a quien tiene sesión sobre esa unidad.
 *
 * No hay respaldo a base64 a propósito: volver a incrustarlo en silencio
 * reintroduciría el fallo que esto arregla, y encima de forma intermitente.
 * Si la subida no puede completarse, quien llama debe enterarse.
 */
export const subirDocumento = async (file, { unidadId, campo, fotoDePerfil = false }) => {
  const documento = await documentoABase64(file);

  const { path } = await apiFetch('/api/documentos/subir', {
    method: 'POST',
    json: {
      unidad_id: unidadId || '',
      campo,
      nombre: documento.name,
      tipo: documento.type,
      base64: documento.base64,
      foto_de_perfil: fotoDePerfil,
    },
  });

  return { name: documento.name, size: documento.size, type: documento.type, path };
};

/**
 * Lo que se guarda de una foto, sin la vista previa local.
 *
 * Mientras la foto sube se muestra el archivo del propio equipo, para que la
 * vista previa aparezca al instante en vez de esperar una ida y vuelta. Esa
 * `url` es un `blob:` que solo existe en esa pestaña: guardarla dejaría en la
 * base un enlace que no lleva a ninguna parte.
 */
const SOLO_LOCAL = ['url', 'base64'];

export const sinPrevisualizacion = (foto) => {
  if (!foto || typeof foto !== 'object') return foto;
  return Object.fromEntries(
    Object.entries(foto).filter(([clave]) => !SOLO_LOCAL.includes(clave)),
  );
};

/** Un documento guardado en Storage se reconoce por su ruta. */
export const esDocumentoEnStorage = (documento) =>
  Boolean(documento && typeof documento === 'object' && documento.path && !documento.base64);

/**
 * URL temporal para ver un documento del bucket.
 *
 * Se pide en el momento de abrirlo y no se guarda: caduca en minutos, así que
 * conservarla sería guardar un enlace roto.
 */
export const urlFirmada = async (path) => {
  const { url } = await apiFetch(`/api/documentos/url?path=${encodeURIComponent(path)}`);
  return url;
};
