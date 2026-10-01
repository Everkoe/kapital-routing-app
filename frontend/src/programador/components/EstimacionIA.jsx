import { Sparkles } from 'lucide-react';

/**
 * La estimación de la IA de un servicio, como una sección más de la ficha.
 *
 * Tres columnas iguales a todo el ancho, con la misma forma que la fila de
 * datos de arriba —etiqueta, valor, una línea debajo—: cuánto dura, a qué hora
 * salir y cuánto fiarse. Es una pantalla en la que alguien pasa horas: nada de
 * cifras gigantes, colores propios ni avisos sueltos. El de pocos datos es la
 * columna «Fiabilidad», con un punto de color que nunca va sin su palabra.
 * «Medido en días que el modelo no vio» va en el título: es verdad de todo.
 */
const Columna = ({ etiqueta, valor, detalle, nivel }) => (
  <div className="pw-estimacion-cifra">
    <span className="pw-estimacion-etiqueta">{etiqueta}</span>
    <strong className="pw-estimacion-valor" data-nivel={nivel}>{valor}</strong>
    {detalle && <span className="pw-estimacion-detalle">{detalle}</span>}
  </div>
);

const EstimacionIA = ({ estimacion }) => {
  if (!estimacion) return null;
  const titulo = estimacion.entrenadoEl
    ? `Modelo entrenado el ${estimacion.entrenadoEl} con el histórico de servicios. Los porcentajes son lo medido en días que el modelo no vio.`
    : 'Los porcentajes son lo medido en días que el modelo no vio.';
  const { duracion, hora, fiabilidad } = estimacion;

  return (
    <section className="pw-estimacion" aria-label="Estimación de la IA">
      <h4 className="pw-detail-heading pw-estimacion-titulo" title={titulo}>
        <Sparkles size={14} aria-hidden="true" />
        Estimación de la IA
      </h4>
      <div className="pw-estimacion-cifras">
        <Columna {...duracion} />
        {hora && <Columna {...hora} />}
        <Columna etiqueta="Fiabilidad" valor={fiabilidad.valor}
          detalle={fiabilidad.detalle} nivel={fiabilidad.nivel} />
      </div>
    </section>
  );
};

export default EstimacionIA;
