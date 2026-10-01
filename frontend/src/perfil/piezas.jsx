/**
 * Las piezas con las que se arma «Mi perfil»: una tarjeta con su cabecera y una
 * fila de dato (etiqueta, valor y, si la hay, una acción a la derecha).
 *
 * Los datos que no se editan van como texto, no como cajas de formulario
 * apagadas: una caja gris parece un campo roto, y era lo que hacía que la
 * página pareciera un formulario a medio hacer.
 */

export const Tarjeta = ({ Icono, titulo, subtitulo, children, className = '' }) => (
  <section className={`pf-tarjeta ${className}`.trim()}>
    <header className="pf-tarjeta-cabecera">
      {Icono && (
        <span className="pf-tarjeta-icono" aria-hidden="true"><Icono size={18} /></span>
      )}
      <span>
        <h2 className="pf-tarjeta-titulo">{titulo}</h2>
        {subtitulo && <p className="pf-tarjeta-subtitulo">{subtitulo}</p>}
      </span>
    </header>
    {children}
  </section>
);

export const Fila = ({ etiqueta, children, accion, nota }) => (
  <div className="pf-fila">
    <dt className="pf-fila-etiqueta">{etiqueta}</dt>
    <dd className="pf-fila-valor">
      {children}
      {nota && <small className="pf-fila-nota">{nota}</small>}
    </dd>
    {accion && <div className="pf-fila-accion">{accion}</div>}
  </div>
);

/** Un dato que no hay, dicho como tal y no como una raya suelta. */
export const SinDato = () => <span className="pf-sin-dato">Sin dato</span>;
