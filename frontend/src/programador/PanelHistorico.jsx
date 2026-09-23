import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock, MapPinOff, Upload, Users,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { apiFetch, apiRequest } from '../utils/apiClient';
import Indicador from './Indicador';
import ZonaDeCarga from './ZonaDeCarga';
import { fecha } from './fechas';

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
 * Subir dos veces el mismo día no duplica nada: el servidor resuelve por la
 * clave natural del servicio.
 */

const INSTRUCCION = 'Intranet → Historial Serv. multiusuarios → Detalle → '
  + 'misma fecha de 00:00 a 23:59 → Descargar. Súbelo tal cual, sin abrirlo en '
  + 'Excel: al reabrirlo se rompen las eñes y los acentos.';

const PanelHistorico = () => {
  const [estado, setEstado] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [ultimaCarga, setUltimaCarga] = useState(null);

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

      <section className="pw-panel">
        <div className="pw-panel-head">
          <h2 className="pw-panel-title"><Upload size={16} /> Cargar el reporte del día</h2>
        </div>
        <ZonaDeCarga ocupada={subiendo} onArchivo={subir}
          titulo="Arrastra el reporte aquí o selecciónalo"
          instruccion={INSTRUCCION} />
        <p className="historico-nota">Subir dos veces el mismo día no duplica nada.</p>
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
    </>
  );
};

export default PanelHistorico;
