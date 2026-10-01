import { useState } from 'react';
import { CheckCircle, Clock, Eye, Upload, XCircle } from 'lucide-react';
import DocumentDropZone from './DocumentDropZone';
import {
  TIPO_DOS_HOJAS,
  admiteReverso,
  caraBloqueada,
  caraDestinoParaArrastre,
  carasDeDocumento,
  esCaraCompleta,
  esDeAdministracion,
  textosDeCaras,
} from '../constants/documentosConductor';

/**
 * Tarjeta de revisión de un documento.
 *
 * Plana a propósito: una tarjeta dentro de otra tarjeta añade bordes y sangrías
 * que no aportan información. Los documentos de dos caras no se parten en
 * tarjetas ni en cajas anidadas — al pulsar «Subir» se despliega una fila con
 * un botón por cara, y el resto del tiempo la tarjeta se lee igual que la de un
 * documento de una sola cara.
 *
 * Arrastrar o pegar sobre la tarjeta va a la imagen completa, salvo que ya se
 * haya empezado por caras sueltas (`caraDestinoParaArrastre`). Con la imagen
 * completa subida, delante y detrás quedan bloqueadas.
 *
 * Un documento de dos hojas (el CAMO) enseña una casilla por hoja, y cada una
 * recibe lo que se le suelta, se le pega o se elige con su botón: lo de la
 * hoja 1 va a la hoja 1 y lo de la hoja 2 a la hoja 2, sea foto o PDF.
 *
 * Lo que sube Administración (el CAMO) no se aprueba ni se rechaza: lo pone
 * quien lo revisaría, y rechazarlo le pediría al conductor algo que no puede
 * subir. Basta con decir si está.
 */

const ESTADOS = {
  aprobado: { Icon: CheckCircle, clase: 'rev-ok', texto: 'Aprobado' },
  rechazado: { Icon: XCircle, clase: 'rev-no', texto: 'Rechazado' },
  pendiente: { Icon: Clock, clase: 'rev-pending', texto: 'Pendiente' },
  subido: { Icon: CheckCircle, clase: 'rev-ok', texto: 'Subido' },
};

const fuenteDeArchivo = (fileData) => {
  if (typeof fileData === 'string') return fileData;
  if (fileData && typeof fileData === 'object') {
    return fileData.base64 || fileData.url || fileData.file || '';
  }
  return '';
};

/**
 * Estado del documento a partir de sus caras presentes.
 *
 * Un rechazo manda sobre todo lo demás: si una cara está mal, el documento no
 * sirve aunque la otra esté aprobada. Y solo se da por aprobado cuando lo están
 * todas las caras subidas, para que una aprobación no tape una cara pendiente.
 */
const estadoDocumento = (caras, revisiones) => {
  const presentes = caras.filter((cara) => cara.tieneArchivo);
  if (presentes.length === 0) return null;

  const estados = presentes.map((cara) => revisiones?.[cara.campo]?.estado);
  if (estados.includes('rechazado')) return ESTADOS.rechazado;
  if (estados.every((estado) => estado === 'aprobado')) return ESTADOS.aprobado;
  return ESTADOS.pendiente;
};

/**
 * Qué caras hay, en una línea.
 *
 * Un archivo con ambas caras juntas basta por sí solo: no tiene sentido pedir
 * el reverso a quien ya escaneó el documento entero en una hoja.
 */
const resumenDeCaras = (caras, textos) => {
  const completo = caras.find(esCaraCompleta)?.tieneArchivo;
  if (completo) return textos.enUno;

  const porSeparado = caras.filter((cara) => !esCaraCompleta(cara));
  const faltan = porSeparado.filter((cara) => !cara.tieneArchivo);
  if (faltan.length === 0) return textos.separadas;

  const subidas = porSeparado.filter((cara) => cara.tieneArchivo);
  return `Solo ${subidas.map((c) => c.nombre.toLowerCase()).join(' y ')} · falta ${faltan.map((c) => c.nombre.toLowerCase()).join(' y ')}`;
};

const DocumentReviewCard = ({
  documento,
  perfil,
  revisiones,
  cargando,
  onUpload,
  onReview,
  onView,
  accept,
}) => {
  const [subiendo, setSubiendo] = useState(false);
  const dosCaras = admiteReverso(documento);
  const textos = textosDeCaras(documento);
  const porHojas = documento.tipo === TIPO_DOS_HOJAS;
  const deAdministracion = esDeAdministracion(documento);

  const caras = carasDeDocumento(documento).map((cara) => ({
    ...cara,
    archivo: perfil?.[cara.campo],
    tieneArchivo: Boolean(perfil?.[cara.campo]),
  }));

  const conArchivo = caras.filter((cara) => cara.tieneArchivo);
  const estado = deAdministracion
    ? (conArchivo.length > 0 ? ESTADOS.subido : null)
    : estadoDocumento(caras, revisiones);
  const ocupado = caras.some((cara) => cargando?.[cara.campo]);

  const caraParaArrastre = caraDestinoParaArrastre(caras);

  const revisarTodas = (estadoNuevo) => {
    conArchivo.forEach((cara) => onReview(cara.campo, estadoNuevo));
  };

  return (
    <DocumentDropZone
      className={`review-doc-card${porHojas ? ' doc-por-hojas' : ''}`}
      label={documento.label}
      // Por hojas, lo recibe cada casilla: la tarjeta no adivina a cuál iba.
      disabled={ocupado || porHojas}
      onFile={(file) => onUpload(caraParaArrastre, file)}
    >
      <div className="review-doc-header">
        <span className="review-doc-name">{documento.label}</span>
        {documento.opcional && <span className="rev-badge rev-optional">Opcional</span>}
        {estado ? (
          <span className={`rev-badge ${estado.clase}`}><estado.Icon size={12} /> {estado.texto}</span>
        ) : (
          <span className="rev-badge rev-missing">Sin archivo</span>
        )}
      </div>

      {documento.detalle && <p className="doc-caras-resumen">{documento.detalle}</p>}

      {dosCaras && !porHojas && conArchivo.length > 0 && (
        <p className="doc-caras-resumen">{resumenDeCaras(caras, textos)}</p>
      )}

      {porHojas && (
        <div className="doc-hojas">
          {caras.map((cara) => (
            <DocumentDropZone
              key={cara.campo}
              className="doc-hoja"
              label={`${documento.label} · ${cara.nombre}`}
              disabled={Boolean(cargando?.[cara.campo])}
              onFile={(file) => onUpload(cara.campo, file)}
            >
              <span className="doc-hoja-nombre">{cara.nombre}</span>
              <span className={`rev-badge ${cara.tieneArchivo ? 'rev-ok' : 'rev-missing'}`}>
                {cara.tieneArchivo ? <><CheckCircle size={12} /> Subida</> : 'Sin archivo'}
              </span>
              <label className="btn-view-doc doc-subir-label">
                <Upload size={13} /> {cara.tieneArchivo ? 'Reemplazar' : 'Subir'}
                <input
                  type="file"
                  accept={accept}
                  style={{ display: 'none' }}
                  onChange={(e) => onUpload(cara.campo, e.target.files[0])}
                />
              </label>
            </DocumentDropZone>
          ))}
        </div>
      )}

      <div className="review-doc-actions">
        {conArchivo.length > 0 && (
          <button
            type="button"
            className="btn-view-doc"
            onClick={() => onView({
              name: documento.label,
              // El visor no le dice que «el conductor tendrá que volver a
              // entregarlo» a lo que nunca entrega el conductor.
              deAdministracion,
              // El visor recibe todas las caras y resuelve dentro cuál mostrar,
              // para no llenar la tarjeta de un botón «Ver» por cara.
              caras: caras.map((cara) => ({
                // El campo de cada cara, para poder quitar justo la que se mira.
                campo: cara.campo,
                nombre: dosCaras ? cara.nombre : null,
                src: fuenteDeArchivo(cara.archivo),
                // Los documentos nuevos viven en Storage: el visor pide su URL
                // firmada al abrirlos, porque caduca en minutos.
                path: cara.archivo?.path || null,
                raw: cara.archivo,
              })),
            })}
          >
            <Eye size={13} /> Ver
          </button>
        )}

        {porHojas ? null : dosCaras ? (
          <button
            type="button"
            className="btn-view-doc"
            aria-expanded={subiendo}
            onClick={() => setSubiendo((abierto) => !abierto)}
          >
            <Upload size={13} /> Subir
          </button>
        ) : (
          <label className="btn-view-doc doc-subir-label">
            <Upload size={13} /> {conArchivo.length ? 'Reemplazar' : 'Subir'}
            <input
              type="file"
              accept={accept}
              style={{ display: 'none' }}
              onChange={(e) => onUpload(documento.key, e.target.files[0])}
            />
          </label>
        )}

        {conArchivo.length > 0 && !deAdministracion && (
          <>
            <button
              type="button"
              className="btn-approve-doc"
              disabled={ocupado || estado === ESTADOS.aprobado}
              onClick={() => revisarTodas('aprobado')}
            >
              {ocupado ? '...' : <><CheckCircle size={13} /> Aprobar</>}
            </button>
            <button
              type="button"
              className="btn-reject-doc"
              disabled={ocupado || estado === ESTADOS.rechazado}
              onClick={() => revisarTodas('rechazado')}
            >
              {ocupado ? '...' : <><XCircle size={13} /> Rechazar</>}
            </button>
          </>
        )}
      </div>

      {dosCaras && subiendo && (
        <div className="doc-caras-subida">
          {caras.map((cara) => {
            const bloqueada = caraBloqueada(cara, caras);
            return (
              <label
                key={cara.campo}
                className={`btn-view-doc doc-subir-label${bloqueada ? ' doc-cara-bloqueada' : ''}`}
                aria-disabled={bloqueada}
                title={bloqueada ? textos.bloqueada : undefined}
              >
                <Upload size={13} />
                {cara.tieneArchivo ? `Reemplazar ${cara.nombre.toLowerCase()}` : `Subir ${cara.nombre.toLowerCase()}`}
                {esCaraCompleta(cara) && !cara.tieneArchivo && (
                  <span className="doc-cara-opcional">{textos.pistaCompleto}</span>
                )}
                {cara.opcional && !esCaraCompleta(cara) && !cara.tieneArchivo && !bloqueada && (
                  <span className="doc-cara-opcional">opcional</span>
                )}
                <input
                  type="file"
                  accept={accept}
                  disabled={bloqueada}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    onUpload(cara.campo, e.target.files[0]);
                    setSubiendo(false);
                  }}
                />
              </label>
            );
          })}
        </div>
      )}

      {conArchivo.length === 0 && (
        <p className="review-doc-missing">
          {deAdministracion
            ? 'Lo sube Administración; al conductor no se le pide.'
            : 'El conductor aún no ha subido este documento.'}
          {porHojas
            ? ' Arrastra cada hoja a su casilla, pégala con Ctrl+V o usa su botón.'
            : ' Arrastra el archivo aquí, pégalo con Ctrl+V o usa el botón.'}
        </p>
      )}
    </DocumentDropZone>
  );
};

export default DocumentReviewCard;
