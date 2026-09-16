import { Lock } from 'lucide-react';

/**
 * Control presente pero todavía no operativo.
 *
 * La mesa muestra la forma completa del producto para que se pueda revisar y
 * criticar el diseño, incluidos los controles cuyo backend no existe aún. Este
 * componente es el único sitio donde se decide cómo se ven: siempre
 * deshabilitados, siempre con el motivo a mano en el `title`, y marcados con
 * `aria-disabled` para que un lector de pantalla lo anuncie igual que la vista.
 *
 * La regla que impone: un control en esta pantalla o hace su trabajo, o dice
 * con claridad que todavía no puede hacerlo. Nunca finge.
 */

const PreviewAction = ({
  children,
  Icon,
  entrega,
  variant = 'default',
  size = 'md',
  className = '',
}) => (
  <button
    type="button"
    className={`pw-btn pw-preview ${variant === 'primary' ? 'pw-btn-primary' : ''} ${size === 'sm' ? 'pw-btn-sm' : ''} ${className}`.trim()}
    disabled
    aria-disabled="true"
    title={`Disponible en la entrega «${entrega}». Todavía no existe el contrato de backend que lo sostenga.`}
  >
    {Icon && <Icon size={size === 'sm' ? 13 : 16} aria-hidden="true" />}
    {children}
    <Lock size={size === 'sm' ? 11 : 13} aria-hidden="true" className="pw-preview-lock" />
  </button>
);

export default PreviewAction;
