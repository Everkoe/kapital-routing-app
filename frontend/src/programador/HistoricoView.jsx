import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock, MapPinOff, Upload, Users,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { apiFetch, apiRequest } from '../utils/apiClient';
import './programador.css';

/**
 * Carga diaria del reporte de la intranet.
 *
 * Es la puerta por la que entra lo que realmente ocurrió. Cada día el
 * Programador descarga de la intranet el detalle del día anterior y lo sube
 * aquí; de ahí salen las tres cosas que hacían falta y no existían: dónde vive
 * cada pasajero, cuánto tarda de verdad cada ruta, y qué direcciones no se
 * pueden situar y necesitan una persona.
 *
 * No propone rutas ni asigna nada. Solo registra, que es lo que faltaba para
 * que cualquier cosa que se proponga después pueda apoyarse en datos reales y
 * no en el tiempo teórico de un mapa.
 *
 * Subir dos veces el mismo día no duplica nada: el servidor resuelve por la
 * clave natural del servicio.
 */

const ACEPTA = '.xlsx,.xls';

const fecha = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-PE');
};

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

const HistoricoView = () => {
  const [estado, setEstado] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [ultimaCarga, setUltimaCarga] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const selector = useRef(null);

  const leerEstado = useCallback(async () => {
    try {
      setEstado(await apiFetch('/api/programador/estado-historico'));
    } catch (error) {
      toast.error(error?.message || 'No se pudo leer el estado del histórico.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { leerEstado(); }, [leerEstado]);

  const subir = async (archivo) => {
    if (!archivo || subiendo) return;
    setSubiendo(true);
    const aviso = toast.loading('Leyendo el reporte…');
    try {
      const cuerpo = new FormData();
      cuerpo.append('file', archivo);
      const respuesta = await apiRequest('/api/programador/historico', {
        method: 'POST', body: cuerpo,
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos?.detail || 'No se pudo cargar el reporte.');
      setUltimaCarga(datos);
      toast.success(`${datos.servicios.toLocaleString('es-PE')} servicios incorporados.`,
        { id: aviso });
      await leerEstado();
    } catch (error) {
      toast.error(error?.message || 'No se pudo cargar el reporte.', { id: aviso });
    } finally {
      setSubiendo(false);
    }
  };

  const sinUbicar = estado?.sin_ubicar ?? 0;

  return (
    <div className="pw-root">
      <header className="pw-header">
        <div className="pw-header-titles historico-titulos">
          <h1 className="pw-title">Histórico de la operación</h1>
          <p className="pw-meta">
            Sube cada día el reporte «Detalle» de la intranet. De aquí salen las
            duraciones reales y la ubicación de cada pasajero.
          </p>
        </div>
      </header>

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

      <section className="pw-panel">
        <div className="pw-panel-head">
          <h2 className="pw-panel-title"><Upload size={16} /> Cargar el reporte del día</h2>
        </div>

        <div
          className={`historico-zona${arrastrando ? ' arrastrando' : ''}${subiendo ? ' ocupada' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastrando(false);
            subir(e.dataTransfer.files?.[0]);
          }}
        >
          <Upload size={26} aria-hidden="true" />
          <p>{subiendo ? 'Procesando el reporte…' : 'Arrastra el Excel aquí o selecciónalo'}</p>
          <small>
            Intranet → Historial Serv. multiusuarios → Detalle → misma fecha de
            00:00 a 23:59 → Descargar Excel
          </small>
          <button type="button" className="pw-btn pw-btn-primary" disabled={subiendo}
            onClick={() => selector.current?.click()}>
            Seleccionar archivo
          </button>
          <input ref={selector} type="file" accept={ACEPTA} style={{ display: 'none' }}
            aria-hidden="true" tabIndex={-1}
            onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
        </div>

        <p className="historico-nota">
          Subir dos veces el mismo día no duplica nada.
        </p>
      </section>

      {ultimaCarga && (
        <section className="pw-panel">
          <div className="pw-panel-head">
            <h2 className="pw-panel-title">
              <CheckCircle2 size={16} /> Última carga
            </h2>
          </div>
          <ul className="historico-resultado">
            <li>
              <strong>{ultimaCarga.servicios.toLocaleString('es-PE')}</strong> servicios
              {ultimaCarga.dias > 1
                ? ` en ${ultimaCarga.dias} días, del ${fecha(ultimaCarga.desde)} al ${fecha(ultimaCarga.hasta)}`
                : ` del ${fecha(ultimaCarga.hasta)}`}
            </li>
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
    </div>
  );
};

export default HistoricoView;
