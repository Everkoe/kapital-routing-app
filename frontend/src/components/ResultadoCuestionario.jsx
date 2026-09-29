import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { resultadoDelCuestionario } from '../utils/cuestionarioManejo';

/**
 * El cuestionario de manejo defensivo en la revisión de documentos.
 *
 * Estaba como un documento más, con «Sin archivo» y un botón de subir, cuando
 * no es un papel sino el test que el conductor rinde en su alta. Ocupa el mismo
 * sitio y con el mismo aspecto que las tarjetas de al lado, pero enseña lo que
 * hay: la nota y si aprobó. Cuando exista el diploma, su botón irá aquí.
 */

const INSIGNIAS = {
  APROBADO: { Icon: CheckCircle, clase: 'rev-ok', texto: 'Aprobado' },
  OBSERVADO: { Icon: AlertTriangle, clase: 'rev-pending', texto: 'Observado' },
  DESAPROBADO: { Icon: XCircle, clase: 'rev-no', texto: 'Desaprobado' },
};

const ResultadoCuestionario = ({ resultado }) => {
  const rendido = resultadoDelCuestionario(resultado);
  const insignia = rendido ? INSIGNIAS[rendido.estado] : null;

  return (
    <div className="review-doc-card">
      <div className="review-doc-header">
        <span className="review-doc-name">Cuestionario de Manejo Defensivo</span>
        {insignia ? (
          <span className={`rev-badge ${insignia.clase}`}><insignia.Icon size={12} /> {insignia.texto}</span>
        ) : (
          <span className="rev-badge rev-missing">Sin rendir</span>
        )}
      </div>
      {rendido ? (
        <p className="cuestionario-nota">
          <strong>{rendido.puntaje}/{rendido.total}</strong>
          {rendido.fecha ? ` · rendido el ${rendido.fecha}` : ''}
        </p>
      ) : (
        <p className="review-doc-missing">
          Aún no lo ha rendido. Se rinde en el alta del conductor en la aplicación.
        </p>
      )}
    </div>
  );
};

export default ResultadoCuestionario;
