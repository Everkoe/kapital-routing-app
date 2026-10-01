import { AlertTriangle, Sparkles } from 'lucide-react';

/**
 * La estimación de la IA de un servicio, como una sección más de la ficha.
 *
 * Dos cifras grandes —cuánto dura y a qué hora salir (o hacia cuándo termina)—
 * con lo medido debajo de cada una, y el aviso de pocos datos aparte. Antes
 * iba todo como una línea más de la ficha, en letra pequeña, y se leía
 * amontonado. Lleva el mismo título que «Dónde viven» y ningún fondo propio:
 * como tarjeta aparte desentonaba. «Medido en días que el modelo no vio» va en
 * el título y no en cada frase: es verdad de todas.
 */
const EstimacionIA = ({ estimacion }) => {
  if (!estimacion) return null;
  const titulo = estimacion.entrenadoEl
    ? `Modelo entrenado el ${estimacion.entrenadoEl} con el histórico de servicios. Los porcentajes son lo medido en días que el modelo no vio.`
    : 'Los porcentajes son lo medido en días que el modelo no vio.';

  return (
    <section className="pw-estimacion" aria-label="Estimación de la IA">
      <h4 className="pw-detail-heading pw-estimacion-titulo" title={titulo}>
        <Sparkles size={14} aria-hidden="true" />
        Estimación de la IA
      </h4>
      <div className="pw-estimacion-cifras">
        <div className="pw-estimacion-cifra">
          <span className="pw-estimacion-etiqueta">Duración estimada</span>
          <strong className="pw-estimacion-valor">{estimacion.duracion}</strong>
          <span className="pw-estimacion-detalle">{estimacion.rango}</span>
        </div>
        {estimacion.hora && (
          <div className="pw-estimacion-cifra">
            <span className="pw-estimacion-etiqueta">{estimacion.hora.etiqueta}</span>
            <strong className="pw-estimacion-valor">{estimacion.hora.hora}</strong>
            <span className="pw-estimacion-detalle">{estimacion.hora.detalle}</span>
          </div>
        )}
      </div>
      {estimacion.aviso && (
        <p className="pw-estimacion-aviso">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{estimacion.aviso}</span>
        </p>
      )}
    </section>
  );
};

export default EstimacionIA;
