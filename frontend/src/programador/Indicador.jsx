/**
 * Un indicador con la forma que espera `.pw-kpi`: el icono y **un solo**
 * bloque al lado. Con el valor, la etiqueta y la nota sueltos, la tarjeta los
 * repartía en horizontal —es una fila— y el texto se salía por la derecha.
 */
const Indicador = ({ Icono, valor, etiqueta, nota, alerta }) => (
  <div className={`pw-kpi${alerta ? ' pw-kpi-alerta' : ''}`}>
    <span className="pw-kpi-icon"><Icono size={19} aria-hidden="true" /></span>
    <span className="pw-kpi-texto">
      <strong className="pw-kpi-value">{valor}</strong>
      <span className="pw-kpi-label">{etiqueta}</span>
      {nota && <span className="pw-kpi-note">{nota}</span>}
    </span>
  </div>
);

export default Indicador;
