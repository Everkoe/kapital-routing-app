import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { pegadoEnCampoDeTexto } from '../utils/documentoArchivo';
import {
  ESCALA_DOBLE_CLIC, ESCALA_MAXIMA, ESCALA_MINIMA, PASO_DE_ZOOM, VISTA_INICIAL,
  acotarVista, escalaTrasRueda, zoomHacia,
} from '../utils/zoomDeImagen';

/**
 * La imagen de un documento, con zoom.
 *
 * Se acerca con la rueda (hacia donde apunta el cursor), con el pellizco del
 * panel táctil, con los botones de abajo, con doble clic o con las teclas «+»,
 * «−» y «0»; ampliada, se mueve arrastrando. Las cuentas están en
 * `zoomDeImagen.js`. Quien la usa le pasa un `key` por imagen, así que al
 * cambiar de cara vuelve a verse entera.
 */

const CENTRO = { x: 0, y: 0 };

const medidasDe = (marco, imagen) => ({
  marco: { ancho: marco?.clientWidth || 0, alto: marco?.clientHeight || 0 },
  // `offsetWidth` es el tamaño sin la transformación: el de escala 1.
  imagen: { ancho: imagen?.offsetWidth || 0, alto: imagen?.offsetHeight || 0 },
});

/** El punto del evento, relativo al centro del marco. */
const puntoEn = (marco, evento) => {
  const caja = marco.getBoundingClientRect();
  return {
    x: evento.clientX - (caja.left + caja.width / 2),
    y: evento.clientY - (caja.top + caja.height / 2),
  };
};

const ImagenConZoom = ({ src, alt }) => {
  const [vista, setVista] = useState(VISTA_INICIAL);
  const [arrastrando, setArrastrando] = useState(false);
  const marco = useRef(null);
  const imagen = useRef(null);
  const arrastre = useRef(null);

  // La rueda va con un listener propio porque React registra `wheel` como
  // pasivo, y sin `preventDefault` la rueda desplazaría la página de detrás.
  useEffect(() => {
    const elemento = marco.current;
    if (!elemento) return undefined;
    const alGirar = (evento) => {
      evento.preventDefault();
      const medidas = medidasDe(elemento, imagen.current);
      const punto = puntoEn(elemento, evento);
      setVista((actual) => zoomHacia(
        actual, escalaTrasRueda(actual.escala, evento.deltaY, evento.deltaMode), punto, medidas,
      ));
    };
    elemento.addEventListener('wheel', alGirar, { passive: false });
    return () => elemento.removeEventListener('wheel', alGirar);
  }, []);

  useEffect(() => {
    const alPulsarTecla = (evento) => {
      // La fecha de vigencia del pie también es un campo: ahí «0» es un dígito.
      if (pegadoEnCampoDeTexto(evento.target) || evento.ctrlKey || evento.metaKey || evento.altKey) return;
      const medidas = medidasDe(marco.current, imagen.current);
      if (evento.key === '+' || evento.key === '=') {
        setVista((actual) => zoomHacia(actual, actual.escala * PASO_DE_ZOOM, CENTRO, medidas));
      } else if (evento.key === '-') {
        setVista((actual) => zoomHacia(actual, actual.escala / PASO_DE_ZOOM, CENTRO, medidas));
      } else if (evento.key === '0') {
        setVista(VISTA_INICIAL);
      } else {
        return;
      }
      evento.preventDefault();
    };
    window.addEventListener('keydown', alPulsarTecla);
    return () => window.removeEventListener('keydown', alPulsarTecla);
  }, []);

  const ampliar = (factor) => {
    const medidas = medidasDe(marco.current, imagen.current);
    setVista((actual) => zoomHacia(actual, actual.escala * factor, CENTRO, medidas));
  };

  const alDobleClic = (evento) => {
    const medidas = medidasDe(marco.current, imagen.current);
    const punto = puntoEn(marco.current, evento);
    setVista((actual) => (actual.escala > ESCALA_MINIMA
      ? VISTA_INICIAL
      : zoomHacia(actual, ESCALA_DOBLE_CLIC, punto, medidas)));
  };

  const alPresionar = (evento) => {
    if (vista.escala <= ESCALA_MINIMA || evento.button !== 0) return;
    evento.currentTarget.setPointerCapture(evento.pointerId);
    arrastre.current = { x: evento.clientX, y: evento.clientY, vista };
    setArrastrando(true);
  };

  const alMover = (evento) => {
    const inicio = arrastre.current;
    if (!inicio) return;
    setVista(acotarVista({
      ...inicio.vista,
      x: inicio.vista.x + evento.clientX - inicio.x,
      y: inicio.vista.y + evento.clientY - inicio.y,
    }, medidasDe(marco.current, imagen.current)));
  };

  const alSoltar = () => {
    arrastre.current = null;
    setArrastrando(false);
  };

  const ampliada = vista.escala > ESCALA_MINIMA;

  return (
    <div className="doc-zoom">
      <div
        ref={marco}
        className={`doc-zoom-marco${ampliada ? ' ampliada' : ''}${arrastrando ? ' arrastrando' : ''}`}
        onDoubleClick={alDobleClic}
        onPointerDown={alPresionar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
      >
        <img
          ref={imagen}
          src={src}
          alt={alt}
          className="doc-image"
          draggable={false}
          style={{ transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.escala})` }}
        />
      </div>

      <div className="doc-zoom-controles" role="group" aria-label="Zoom de la imagen">
        <button
          type="button"
          onClick={() => ampliar(1 / PASO_DE_ZOOM)}
          disabled={!ampliada}
          title="Alejar (−)"
          aria-label="Alejar"
        >
          <ZoomOut size={16} />
        </button>
        <button
          type="button"
          className="doc-zoom-porcentaje"
          onClick={() => setVista(VISTA_INICIAL)}
          disabled={!ampliada}
          title="Ver entera (0)"
        >
          {Math.round(vista.escala * 100)}%
        </button>
        <button
          type="button"
          onClick={() => ampliar(PASO_DE_ZOOM)}
          disabled={vista.escala >= ESCALA_MAXIMA}
          title="Acercar (+)"
          aria-label="Acercar"
        >
          <ZoomIn size={16} />
        </button>
      </div>
    </div>
  );
};

export default ImagenConZoom;
