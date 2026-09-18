import { useEffect, useRef, useState } from 'react';
import { Loader, X } from 'lucide-react';
import toast from 'react-hot-toast';
import TarjetaDocumentoUnidad from './TarjetaDocumentoUnidad';
import { apiFetch } from '../utils/apiClient';
import { subirDocumento } from '../utils/documentoStorage';
import {
  CAPACIDAD_SUGERIDA,
  DOCUMENTOS_DE_UNIDAD,
  TIPOS_DE_UNIDAD,
  erroresDeUnidad,
  normalizarCodigo,
  tieneCambios,
} from '../constants/unidadNueva';

/**
 * Alta de una unidad.
 *
 * Padrón y placa son dos cosas distintas y aquí se piden por separado: el
 * formulario anterior tenía un solo campo «Placa / ID» que viajaba como padrón,
 * así que las unidades creadas a mano se quedaban sin matrícula.
 *
 * Los documentos se suben **después** de crear la unidad, porque su sitio en el
 * bucket se deriva del padrón. Si alguno falla, la unidad ya creada no se
 * vuelve a crear: se dice cuál falló y se puede reintentar desde su ficha.
 */

const DATOS_VACIOS = {
  padron: '', placa: '', chofer: '', telefono: '', tipo: TIPOS_DE_UNIDAD[0], capacidad: '',
};

const RegistroDeUnidad = ({ abierto, onCerrar, onRegistrada }) => {
  const [datos, setDatos] = useState(DATOS_VACIOS);
  const [archivos, setArchivos] = useState({});
  const [fechas, setFechas] = useState({});
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [confirmandoSalida, setConfirmandoSalida] = useState(false);

  const panel = useRef(null);
  const primerCampo = useRef(null);
  const focoPrevio = useRef(null);

  // Cada apertura empieza de cero: sin esto, los datos de la unidad anterior
  // seguían en el formulario al volver a abrirlo.
  useEffect(() => {
    if (!abierto) return undefined;

    setDatos({ ...DATOS_VACIOS, capacidad: String(CAPACIDAD_SUGERIDA[TIPOS_DE_UNIDAD[0]] ?? '') });
    setArchivos({});
    setFechas({});
    setErrores({});
    setConfirmandoSalida(false);

    focoPrevio.current = document.activeElement;
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const foco = setTimeout(() => primerCampo.current?.focus(), 60);

    return () => {
      clearTimeout(foco);
      document.body.style.overflow = overflowPrevio;
      if (focoPrevio.current instanceof HTMLElement) focoPrevio.current.focus();
    };
  }, [abierto]);

  const hayCambios = tieneCambios(datos, archivos)
    || Object.values(fechas).some(Boolean);

  const intentarCerrar = () => {
    if (guardando) return;
    if (hayCambios) {
      setConfirmandoSalida(true);
      return;
    }
    onCerrar();
  };

  useEffect(() => {
    if (!abierto) return undefined;
    const alPulsar = (evento) => {
      if (evento.key === 'Escape') intentarCerrar();
      // El foco no sale del modal mientras está abierto.
      if (evento.key === 'Tab' && panel.current) {
        const focos = panel.current.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focos.length === 0) return;
        const primero = focos[0];
        const ultimo = focos[focos.length - 1];
        if (evento.shiftKey && document.activeElement === primero) {
          evento.preventDefault();
          ultimo.focus();
        } else if (!evento.shiftKey && document.activeElement === ultimo) {
          evento.preventDefault();
          primero.focus();
        }
      }
    };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  });

  const cambia = (campo) => (evento) => {
    const valor = evento.target.value;
    setDatos(previo => {
      if (campo !== 'tipo') return { ...previo, [campo]: valor };
      // Cambiar de tipo propone su capacidad habitual, pero no pisa la que ya
      // haya escrito el administrador.
      const sugerida = CAPACIDAD_SUGERIDA[valor];
      const capacidadPrevia = previo.capacidad;
      const eraSugerencia = String(CAPACIDAD_SUGERIDA[previo.tipo] ?? '') === capacidadPrevia;
      return {
        ...previo,
        tipo: valor,
        capacidad: (!capacidadPrevia || eraSugerencia) ? String(sugerida ?? '') : capacidadPrevia,
      };
    });
    setErrores(previo => ({ ...previo, [campo]: undefined }));
  };

  const registrar = async () => {
    if (guardando) return;

    const fallos = erroresDeUnidad(datos);
    // Una fecha sin su archivo no dice nada, y al revés tampoco.
    DOCUMENTOS_DE_UNIDAD.forEach(({ campo }) => {
      if (fechas[campo] && !archivos[campo]) fallos[campo] = 'Adjunta el documento o quita la fecha.';
      if (archivos[campo] && !fechas[campo]) fallos[campo] = 'Indica hasta cuándo es válido.';
    });

    if (Object.keys(fallos).length > 0) {
      setErrores(fallos);
      toast.error('Revisa los campos marcados.');
      return;
    }

    setGuardando(true);
    const padron = normalizarCodigo(datos.padron);
    try {
      const creada = await apiFetch('/api/flota', {
        method: 'POST',
        json: {
          padron,
          placa: normalizarCodigo(datos.placa),
          chofer: datos.chofer.trim(),
          telefono: datos.telefono.trim(),
          tipo: datos.tipo,
          capacidad: Number.parseInt(datos.capacidad, 10),
          ...Object.fromEntries(DOCUMENTOS_DE_UNIDAD.map(({ campo }) => [campo, fechas[campo] || ''])),
        },
      });

      // La unidad ya existe: a partir de aquí, un fallo no debe repetir el alta.
      const fallidos = [];
      for (const { campo, etiqueta, archivo } of DOCUMENTOS_DE_UNIDAD) {
        if (!archivos[campo]) continue;
        try {
          const documento = await subirDocumento(archivos[campo], { unidadId: padron, campo: archivo });
          await apiFetch(`/api/flota/${encodeURIComponent(padron)}`, {
            method: 'PUT',
            json: { [archivo]: documento },
          });
        } catch {
          fallidos.push(etiqueta);
        }
      }

      onRegistrada?.(creada?.unidad?.unidad_id || padron);
      if (fallidos.length > 0) {
        toast.error(`Unidad ${padron} registrada, pero no se pudo subir: ${fallidos.join(', ')}. Súbelo desde su ficha.`);
      } else {
        toast.success('Unidad registrada correctamente.');
      }
      onCerrar();
    } catch (error) {
      toast.error(error?.message || 'No se pudo registrar la unidad.');
    } finally {
      setGuardando(false);
    }
  };

  if (!abierto) return null;

  const campo = (nombre, etiqueta, extra = {}) => {
    const id = `unidad-${nombre}`;
    const idError = errores[nombre] ? `${id}-error` : undefined;
    return (
      <div className="unidad-campo-alta">
        <label htmlFor={id}>
          {etiqueta}
          {extra.obligatorio && <span className="unidad-obligatorio"> (obligatorio)</span>}
          {extra.opcional && <span className="unidad-opcional"> (opcional)</span>}
        </label>
        <input
          id={id}
          ref={nombre === 'padron' ? primerCampo : undefined}
          value={datos[nombre]}
          onChange={cambia(nombre)}
          placeholder={extra.placeholder}
          type={extra.type || 'text'}
          inputMode={extra.inputMode}
          min={extra.min}
          disabled={guardando}
          aria-invalid={Boolean(errores[nombre])}
          aria-describedby={idError}
          className={errores[nombre] ? 'campo-pendiente' : undefined}
        />
        {errores[nombre] && <small className="campo-aviso" id={idError} role="alert">{errores[nombre]}</small>}
      </div>
    );
  };

  return (
    <div className="unidad-alta-fondo" onClick={intentarCerrar}>
      <div
        ref={panel}
        className="unidad-alta"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unidad-alta-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="unidad-alta-cabecera">
          <h3 id="unidad-alta-titulo">Registrar nueva unidad</h3>
          <button type="button" className="btn-icon-sutil" onClick={intentarCerrar} aria-label="Cerrar el formulario">
            <X size={18} />
          </button>
        </header>

        <div className="unidad-alta-cuerpo">
          <section>
            <h4 className="unidad-alta-seccion">Datos del conductor y la unidad</h4>
            <div className="unidad-alta-campos">
              {campo('padron', 'Padrón', { placeholder: 'Ej. K-027', obligatorio: true })}
              {campo('placa', 'Placa del vehículo', { placeholder: 'Ej. BUR-628', obligatorio: true })}
              {campo('chofer', 'Nombre del conductor', { placeholder: 'Nombre completo', obligatorio: true })}

              <div className="unidad-campo-alta">
                <label htmlFor="unidad-tipo">Tipo de vehículo</label>
                <select id="unidad-tipo" value={datos.tipo} onChange={cambia('tipo')} disabled={guardando}>
                  {TIPOS_DE_UNIDAD.map(tipo => <option key={tipo}>{tipo}</option>)}
                </select>
              </div>

              {campo('telefono', 'Teléfono WhatsApp', { placeholder: 'Ej. 987654321', opcional: true, inputMode: 'tel' })}
              {campo('capacidad', 'Capacidad (pasajeros)', { placeholder: 'Ej. 4', obligatorio: true, type: 'number', min: '1' })}
            </div>
          </section>

          <section>
            <h4 className="unidad-alta-seccion">
              Documentación de la unidad
              <span className="unidad-opcional"> (opcional, se puede completar después)</span>
            </h4>
            <div className="unidad-alta-docs">
              {DOCUMENTOS_DE_UNIDAD.map(({ campo: clave, etiqueta }) => (
                <TarjetaDocumentoUnidad
                  key={clave}
                  etiqueta={etiqueta}
                  idFecha={`unidad-doc-${clave}`}
                  archivo={archivos[clave] || null}
                  fecha={fechas[clave] || ''}
                  error={errores[clave] || ''}
                  onArchivo={(file) => {
                    setArchivos(previo => ({ ...previo, [clave]: file }));
                    setErrores(previo => ({ ...previo, [clave]: undefined }));
                  }}
                  onFecha={(valor) => {
                    setFechas(previo => ({ ...previo, [clave]: valor }));
                    setErrores(previo => ({ ...previo, [clave]: undefined }));
                  }}
                />
              ))}
            </div>
          </section>
        </div>

        <footer className="unidad-alta-pie">
          <button type="button" className="btn-view-doc" onClick={intentarCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button type="button" className="unidad-alta-registrar" onClick={registrar} disabled={guardando}>
            {guardando ? <><Loader size={15} className="animate-spin" /> Registrando…</> : 'Registrar unidad'}
          </button>
        </footer>

        {confirmandoSalida && (
          <div className="unidad-alta-confirmar" role="alertdialog" aria-label="Confirmar salida">
            <div>
              <h4>Hay cambios sin guardar</h4>
              <p>Si sales ahora se perderá lo que has escrito y los archivos seleccionados.</p>
              <div>
                <button type="button" className="btn-view-doc" onClick={() => setConfirmandoSalida(false)}>
                  Seguir editando
                </button>
                <button type="button" className="btn-reject-doc" onClick={onCerrar}>
                  Salir sin guardar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RegistroDeUnidad;
