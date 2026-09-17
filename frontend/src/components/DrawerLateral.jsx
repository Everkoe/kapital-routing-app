import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Panel que entra por la derecha, sobre la pantalla que lo abrió.
 *
 * Es un panel y no un modal centrado porque su contenido es el detalle de algo
 * que se sigue viendo detrás: la fila del historial queda a la vista mientras
 * se lee su ficha, y cerrar devuelve exactamente al sitio donde se estaba.
 *
 * Se encarga de lo que un panel así tiene que hacer y siempre se olvida: cerrar
 * con Escape, no dejar que la página de detrás siga desplazándose, llevar el
 * foco dentro al abrir y devolverlo al botón que lo abrió al cerrar.
 */

const DrawerLateral = ({ abierto, titulo, onCerrar, children, pie = null }) => {
  const panel = useRef(null);
  const focoPrevio = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;

    focoPrevio.current = document.activeElement;
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();

    const alPulsar = (evento) => {
      if (evento.key === 'Escape') onCerrar();
    };
    document.addEventListener('keydown', alPulsar);

    return () => {
      document.removeEventListener('keydown', alPulsar);
      document.body.style.overflow = overflowPrevio;
      // Devolver el foco donde estaba: quien abrió con el teclado sigue en su
      // sitio de la tabla y no al principio de la página.
      if (focoPrevio.current instanceof HTMLElement) focoPrevio.current.focus();
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div className="drawer-fondo" onClick={onCerrar}>
      <aside
        ref={panel}
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-cabecera">
          <h3>{titulo}</h3>
          <button type="button" className="btn-icon-sutil" onClick={onCerrar} aria-label="Cerrar el panel">
            <X size={18} />
          </button>
        </header>
        <div className="drawer-cuerpo">{children}</div>
        {pie && <footer className="drawer-pie">{pie}</footer>}
      </aside>
    </div>
  );
};

export default DrawerLateral;
