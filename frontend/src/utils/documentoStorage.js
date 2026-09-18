import { apiFetch } from './apiClient.js';
import { documentoABase64 } from './imageUtils.js';

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
 * Se guarda mientras dure, y ni un segundo más.
 *
 * Cada foto necesita una ida y vuelta antes de poder dibujarse, y eso se veía:
 * el avatar de la lista aparecía con un parpadeo, un círculo vacío durante un
 * instante. Pedirla de nuevo en cada montaje repetía el parpadeo al cambiar de
 * pestaña o de página, para la misma imagen de siempre.
 *
 * El servidor las firma por `DOCUMENT_URL_TTL_SECONDS` —cinco minutos—, así
 * que se reutilizan durante algo menos, con margen para que ninguna caduque
 * entre que se entrega y se usa. Se guarda la promesa y no solo el resultado:
 * así una lista con la misma foto repetida hace una sola petición en vez de
 * una por tarjeta.
 */
const VIDA_DE_LA_FIRMA_MS = 5 * 60 * 1000;
const MARGEN_MS = 30 * 1000;

const firmadas = new Map();

/**
 * La URL ya resuelta, si la hay, sin esperar a nadie.
 *
 * Permite pintar la imagen en el primer fotograma cuando ya se pidió antes,
 * que es lo que quita el parpadeo al volver a una pantalla.
 */
export const urlFirmadaEnCache = (path) => {
  const guardada = firmadas.get(path);
  return guardada && guardada.expira > Date.now() ? guardada.url : '';
};

/** Se olvida todo al cerrar sesión: una firma es un permiso, y ya no lo hay. */
export const olvidarUrlsFirmadas = () => firmadas.clear();

export const urlFirmada = async (path) => {
  const guardada = firmadas.get(path);
  if (guardada && guardada.expira > Date.now()) return guardada.promesa;

  const promesa = apiFetch(`/api/documentos/url?path=${encodeURIComponent(path)}`)
    .then(({ url }) => {
      const entrada = firmadas.get(path);
      if (entrada && entrada.promesa === promesa) entrada.url = url;
      return url;
    });

  // Un fallo no se queda guardado: el siguiente intento vuelve a pedirla.
  promesa.catch(() => {
    if (firmadas.get(path)?.promesa === promesa) firmadas.delete(path);
  });

  firmadas.set(path, { promesa, url: '', expira: Date.now() + VIDA_DE_LA_FIRMA_MS - MARGEN_MS });
  return promesa;
};
