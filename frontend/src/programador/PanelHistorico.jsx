import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock, MapPinOff, RefreshCw, Upload, Users, X,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { apiFetch, apiRequest } from '../utils/apiClient';
import Indicador from './Indicador';
import ZonaDeCarga from './ZonaDeCarga';
import { fecha } from './fechas';
import {
  diaEsperado, fueraDeLoEsperado, huecosAnteriores, tiraDeDias, yaCargadosDelError,
} from './model/cargaHistorico.js';

/**
 * Carga del reporte de la intranet: lo que realmente ocurrió.
 *
 * De aquí salen las tres cosas que hacían falta y no existían: dónde vive cada
 * pasajero, cuánto tarda de verdad cada ruta, y qué direcciones no se pueden
 * situar y necesitan una persona.
 *
 * No propone rutas ni asigna nada. Solo registra, que es lo que faltaba para
 * que cualquier cosa que se proponga después pueda apoyarse en datos reales y
 * no en el tiempo teórico de un mapa.
 *
 * **Dice si falta algo antes de pedir nada.** El reporte que toca es el del día
 * que ya terminó; si ya está, la caja para subir se pliega detrás de un enlace
 * y, si se sube un día que ya estaba, el servidor para antes de escribir y se
 * pregunta. Subirlo otra vez no duplica nada, pero casi siempre es un despiste
 * —el archivo de ayer otra vez, o dos personas con el mismo— y rehacía el
 * trabajo sin decirlo. La tira de días enseña los huecos: el 28/9 faltaban del
 * 23 al 27, y del 1 al 21 de septiembre, sin que la pantalla lo dijera.
 */

const INSTRUCCION = 'Intranet → Historial Serv. multiusuarios → Detalle → '
  + 'misma fecha de 00:00 a 23:59 → Descargar. Súbelo tal cual, sin abrirlo en '
  + 'Excel: al reabrirlo se rompen las eñes y los acentos.';

/** «dom., 27 sept.» */
const diaLargo = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-PE',
  { weekday: 'long', day: 'numeric', month: 'long' });

/** «dom 27» para la tira. */
const diaCorto = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return {
    semana: d.toLocaleDateString('es-PE', { weekday: 'short' }).replace('.', ''),
    numero: d.getDate(),
  };
};

/** Cuándo se cargó, en hora de Lima: «28/09 08:15». */
const momento = (iso) => (iso
  ? new Date(iso).toLocaleString('es-PE', {
    timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  : '');

const EstadoDelDia = ({ estado }) => {
  const esperado = diaEsperado(estado);
  if (!esperado) return null;
  const huecos = huecosAnteriores(estado);
  const tira = tiraDeDias(estado);

  return (
    <section className="historico-estado" data-tono={esperado.cargado ? 'ok' : 'falta'}>
      <div className="historico-estado-linea">
        {esperado.cargado
          ? <CheckCircle2 size={20} aria-hidden="true" />
          : <AlertTriangle size={20} aria-hidden="true" />}
        <div>
          {esperado.cargado ? (
            <p>
              <strong>Al día.</strong> El reporte del {diaLargo(esperado.fecha)} ya está cargado:
              {' '}{esperado.servicios.toLocaleString('es-PE')} servicios
              {/* Entre paréntesis: la hora acaba en «p. m.» y un punto detrás quedaba doble. */}
              {esperado.cargadoEn && <> (subido el {momento(esperado.cargadoEn)})</>}
            </p>
          ) : (
            <p><strong>Falta el reporte del {diaLargo(esperado.fecha)}.</strong></p>
          )}
          {huecos.length > 0 && (
            <small>
              {huecos.length === 1 ? 'También falta el ' : 'También faltan los días '}
              {huecos.map((d) => diaCorto(d).numero).join(', ')}.
              Se pueden subir cuando quieras: cada uno en su archivo.
            </small>
          )}
        </div>
      </div>
      <ol className="historico-dias" aria-label="Los últimos días">
        {tira.map((dia) => {
          const { semana, numero } = diaCorto(dia.fecha);
          return (
            <li key={dia.fecha} data-cargado={dia.cargado || undefined}
              title={dia.cargado
                ? `${fecha(dia.fecha)}: ${dia.servicios} servicios${dia.cargadoEn ? `, subido el ${momento(dia.cargadoEn)}` : ''}`
                : `${fecha(dia.fecha)}: sin cargar`}>
              <span className="historico-dia-semana">{semana}</span>
              <span className="historico-dia-numero">{numero}</span>
              {dia.cargado
                ? <CheckCircle2 size={14} aria-label="cargado" />
                : <X size={14} aria-label="sin cargar" />}
            </li>
          );
        })}
      </ol>
    </section>
  );
};

/** Pregunta antes de volver a cargar un día que ya estaba. */
const ConfirmarRecarga = ({ pendiente, ocupado, onConfirmar, onCancelar }) => {
  if (!pendiente) return null;
  const { yaCargados } = pendiente;
  const uno = yaCargados.length === 1;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="historico-recarga-titulo">
      <div className="modal-content pw-confirmar">
        <button type="button" className="pw-confirmar-cerrar" onClick={onCancelar}
          aria-label="Cancelar" disabled={ocupado}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="pw-confirmar-icono historico-recarga-icono">
          <RefreshCw size={22} aria-hidden="true" />
        </div>
        <h3 id="historico-recarga-titulo">
          {uno ? 'Ese día ya estaba cargado' : 'Esos días ya estaban cargados'}
        </h3>
        <ul className="historico-resultado">
          {yaCargados.map((dia) => (
            <li key={dia.fecha}>
              <strong>{fecha(dia.fecha)}</strong>: {Number(dia.servicios).toLocaleString('es-PE')} servicios
              {dia.cargado_en && <>, subido el {momento(dia.cargado_en)}</>}
            </li>
          ))}
        </ul>
        <p>
          Volver a cargarlo actualiza esos servicios con lo que trae el archivo; no
          se duplica nada. Si no esperabas esto, quizá sea el archivo de otro día.
        </p>
        <div className="pw-confirmar-botones">
          <button type="button" className="pw-btn" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </button>
          <button type="button" className="pw-btn pw-btn-primary" onClick={onConfirmar}
            disabled={ocupado} autoFocus>
            <RefreshCw size={16} aria-hidden="true" />
            Volver a cargar
          </button>
        </div>
      </div>
    </div>
  );
};

const PanelHistorico = () => {
  const [estado, setEstado] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [ultimaCarga, setUltimaCarga] = useState(null);
  // La caja para subir, abierta a mano cuando el día ya está cargado.
  const [mostrarZona, setMostrarZona] = useState(false);
  // El archivo que se subió sobre un día ya cargado, a la espera de confirmar.
  const [pendiente, setPendiente] = useState(null);

  const leerEstado = useCallback(async (vivo = { current: true }) => {
    try {
      const respuesta = await apiFetch('/api/programador/estado-historico');
      if (vivo.current) setEstado(respuesta);
    } catch (error) {
      toast.error(error?.message || 'No se pudo leer el estado del histórico.');
    } finally {
      if (vivo.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    const vivo = { current: true };
    leerEstado(vivo);
    return () => { vivo.current = false; };
  }, [leerEstado]);

  const subir = async (archivo, reemplazar = false) => {
    setSubiendo(true);
    const aviso = toast.loading(reemplazar ? 'Volviendo a cargar el reporte…' : 'Leyendo el reporte…');
    try {
      const cuerpo = new FormData();
      cuerpo.append('file', archivo);
      if (reemplazar) cuerpo.append('reemplazar', 'true');
      const respuesta = await apiRequest('/api/programador/historico', {
        method: 'POST', body: cuerpo,
      });
      const datos = await respuesta.json();
      setUltimaCarga(datos);
      setPendiente(null);
      setMostrarZona(false);
      toast.success(`${datos.servicios.toLocaleString('es-PE')} servicios incorporados.`,
        { id: aviso });
      await leerEstado();
    } catch (error) {
      const yaCargados = error?.status === 409 ? yaCargadosDelError(error?.payload?.detail) : null;
      if (yaCargados) {
        // No es un fallo: el servidor paró antes de escribir y hay que preguntar.
        toast.dismiss(aviso);
        setPendiente({ archivo, yaCargados });
      } else {
        toast.error(error?.message || 'No se pudo cargar el reporte.', { id: aviso });
      }
    } finally {
      setSubiendo(false);
    }
  };

  const sinUbicar = estado?.sin_ubicar ?? 0;
  const esperado = diaEsperado(estado);
  const alDia = Boolean(esperado?.cargado);
  const zonaVisible = !alDia || mostrarZona;
  const avisoDeFecha = ultimaCarga && esperado && fueraDeLoEsperado(ultimaCarga, esperado.fecha);

  return (
    <>
      {!cargando && estado && (
        <section className="pw-kpis">
          <Indicador Icono={Clock} valor={estado.servicios.toLocaleString('es-PE')}
            etiqueta="Servicios registrados"
            nota={estado.ultimo_dia ? `hasta el ${fecha(estado.ultimo_dia)}` : 'sin datos'} />
          <Indicador Icono={Users} valor={estado.pasajeros.toLocaleString('es-PE')}
            etiqueta="Pasajeros en el padrón" />
          <Indicador Icono={MapPinOff} valor={sinUbicar} alerta={sinUbicar > 0}
            etiqueta="Sin ubicación"
            nota={sinUbicar > 0 ? 'necesitan revisión humana' : 'todos ubicados'} />
          <Indicador Icono={CalendarClock} valor={estado.duraciones}
            etiqueta="Rutas con duración medida" />
        </section>
      )}

      {!cargando && estado && <EstadoDelDia estado={estado} />}

      <section className="pw-panel">
        <div className="pw-panel-head">
          <h2 className="pw-panel-title"><Upload size={16} /> Cargar el reporte del día</h2>
          {alDia && mostrarZona && (
            <button type="button" className="pw-btn pw-btn-sm" onClick={() => setMostrarZona(false)}>
              Cerrar
            </button>
          )}
        </div>
        {zonaVisible ? (
          <>
            <ZonaDeCarga ocupada={subiendo} onArchivo={(archivo) => subir(archivo)}
              titulo="Arrastra el reporte aquí o selecciónalo"
              instruccion={INSTRUCCION} />
            <p className="historico-nota">
              Si subes un día que ya estaba cargado, te lo preguntará antes de volver a cargarlo.
            </p>
          </>
        ) : (
          <div className="historico-plegado">
            <p>El reporte de ayer ya está cargado. No hace falta subir nada más.</p>
            <button type="button" className="pw-btn pw-btn-sm" onClick={() => setMostrarZona(true)}>
              <Upload size={14} aria-hidden="true" />
              Subir otro reporte (un día atrasado o corregir uno)
            </button>
          </div>
        )}
      </section>

      {ultimaCarga && (
        <section className="pw-panel">
          <div className="pw-panel-head">
            <h2 className="pw-panel-title"><CheckCircle2 size={16} /> Última carga</h2>
          </div>
          <ul className="historico-resultado">
            <li>
              <strong>{ultimaCarga.servicios.toLocaleString('es-PE')}</strong> servicios
              {ultimaCarga.dias > 1
                ? ` en ${ultimaCarga.dias} días, del ${fecha(ultimaCarga.desde)} al ${fecha(ultimaCarga.hasta)}`
                : ` del ${fecha(ultimaCarga.hasta)}`}
            </li>
            {avisoDeFecha && (
              <li className="historico-pendiente">
                <AlertTriangle size={14} aria-hidden="true" />
                Este reporte no es del día que tocaba ({fecha(esperado.fecha)}). Si no lo
                buscabas, revisa la fecha que descargaste en la intranet.
              </li>
            )}
            <li><strong>{ultimaCarga.pasajeros}</strong> pasajeros en el archivo</li>
            <li><strong>{ultimaCarga.ubicacion_resuelta}</strong> con ubicación fiable</li>
            {ultimaCarga.ubicacion_dudosa > 0 && (
              <li><strong>{ultimaCarga.ubicacion_dudosa}</strong> con ubicación aproximada</li>
            )}
            {ultimaCarga.ubicacion_pendiente > 0 && (
              <li className="historico-pendiente">
                <AlertTriangle size={14} aria-hidden="true" />
                <strong>{ultimaCarga.ubicacion_pendiente}</strong> sin ubicar: no tienen
                coordenada declarada ni rastro suficiente para deducirla
              </li>
            )}
          </ul>
        </section>
      )}

      <ConfirmarRecarga
        pendiente={pendiente}
        ocupado={subiendo}
        onConfirmar={() => subir(pendiente.archivo, true)}
        onCancelar={() => setPendiente(null)}
      />
    </>
  );
};

export default PanelHistorico;
