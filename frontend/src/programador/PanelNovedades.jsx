import { useState } from 'react';
import {
  AlertTriangle, ArrowRight, CircleSlash, ClipboardList, MapPin, Minus,
  UserMinus, UserPlus, Users,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { apiRequest } from '../utils/apiClient';
import Indicador from './Indicador';
import ZonaDeCarga from './ZonaDeCarga';
import { fecha } from './fechas';

/**
 * Novedades del cliente: qué cambia para los próximos días.
 *
 * Lo importante de esta pantalla es de dónde saca la respuesta. **No** de la
 * columna «NOVEDAD» del archivo, que está medido que se equivoca: seis filas
 * de la muestra dicen «Asignar Ruta» de gente que ya viajaba desde hacía
 * semanas, y en un caso la etiqueta decía «Asignar» cuando lo que cambiaba era
 * el turno. Cada fila se contrasta con lo que esa persona venía haciendo según
 * el histórico, que es el registro de lo que pasó de verdad.
 *
 * De la etiqueta se lee una sola cosa: si viaja o no. Y no por confianza, sino
 * porque no está en ninguna otra parte —una baja es idéntica al histórico, esa
 * es justamente su naturaleza—.
 *
 * No escribe nada. Enseña el resultado para que una persona lo mire.
 */

const INSTRUCCION = 'El Excel que manda el cliente con las altas, bajas y '
  + 'cambios de los próximos días. Suele llegar el viernes con el sábado y el '
  + 'domingo dentro.';

const ASPECTO = {
  baja: { Icono: UserMinus, tono: 'danger', texto: 'No viaja' },
  alta: { Icono: UserPlus, tono: 'ok', texto: 'Nuevo' },
  cambio: { Icono: ArrowRight, tono: 'warn', texto: 'Cambia' },
  sin_cambio: { Icono: Minus, tono: 'neutral', texto: 'Sigue igual' },
};

const NOMBRE_DEL_CAMBIO = {
  zona: 'Zona', turno: 'Turno', sentido: 'Sentido', direccion: 'Dirección',
};

const Entrada = ({ dato }) => {
  const aspecto = ASPECTO[dato.clasificacion] ?? ASPECTO.sin_cambio;
  const { Icono } = aspecto;
  return (
    <li className="nov-fila" data-tono={aspecto.tono}>
      <span className="nov-estado">
        <Icono size={15} aria-hidden="true" />
        {aspecto.texto}
      </span>
      <div className="nov-cuerpo">
        <p className="nov-persona">
          <strong>{dato.nombre || dato.dni}</strong>
          <span className="nov-datos">
            {[fecha(dato.fecha), dato.turno, dato.cobertura].filter(Boolean).join(' · ')}
          </span>
        </p>

        {dato.cambios.length > 0 && (
          <ul className="nov-cambios">
            {dato.cambios.map((cambio) => (
              <li key={`${dato.dni}-${dato.fecha}-${cambio.tipo}`}>
                <span className="nov-cambio-tipo">
                  {NOMBRE_DEL_CAMBIO[cambio.tipo] ?? cambio.tipo}
                </span>
                <span className="nov-cambio-valores">
                  {cambio.antes} <ArrowRight size={12} aria-hidden="true" /> {cambio.ahora}
                </span>
                <small>{cambio.porque}</small>
              </li>
            ))}
          </ul>
        )}

        {dato.clasificacion === 'sin_cambio' && (
          <p className="nov-sin-senal">
            El histórico no ve ninguna diferencia: {dato.servicios_previos} servicios
            previos con la misma zona, turno y sentido.
          </p>
        )}

        {dato.ubicacion_obsoleta && (
          <p className="nov-aviso">
            <AlertTriangle size={13} aria-hidden="true" />
            Se mudó: la ubicación aprendida de su casa ya no sirve y hay que
            volver a deducirla con los próximos recojos.
          </p>
        )}

        <p className="nov-etiqueta">
          El archivo lo llamaba «{dato.etiqueta || 'sin etiqueta'}»
        </p>
      </div>
    </li>
  );
};

const PanelNovedades = () => {
  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState(null);

  const subir = async (archivo) => {
    setSubiendo(true);
    const aviso = toast.loading('Cruzando con el histórico…');
    try {
      const cuerpo = new FormData();
      cuerpo.append('file', archivo);
      const respuesta = await apiRequest('/api/programador/novedades', {
        method: 'POST', body: cuerpo,
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos?.detail || 'No se pudo leer el archivo.');
      setResultado(datos);
      toast.success(`${datos.filas} novedades analizadas.`, { id: aviso });
    } catch (error) {
      toast.error(error?.message || 'No se pudo leer el archivo.', { id: aviso });
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <>
      <section className="pw-panel">
        <div className="pw-panel-head">
          <h2 className="pw-panel-title">
            <ClipboardList size={16} /> Cargar las novedades del cliente
          </h2>
        </div>
        <ZonaDeCarga ocupada={subiendo} onArchivo={subir}
          titulo="Arrastra el Excel de novedades aquí o selecciónalo"
          instruccion={INSTRUCCION} />
        <p className="historico-nota">
          El cambio se deduce del histórico, no de la columna «Novedad» del
          archivo. De ella solo se lee si la persona viaja o no.
        </p>
      </section>

      {resultado && (
        <>
          <section className="pw-kpis">
            <Indicador Icono={Users} valor={resultado.filas}
              etiqueta="Novedades en el archivo"
              nota={resultado.dias > 1
                ? `del ${fecha(resultado.desde)} al ${fecha(resultado.hasta)}`
                : `del ${fecha(resultado.hasta)}`} />
            <Indicador Icono={CircleSlash} valor={resultado.bajas}
              etiqueta="No viajan" alerta={resultado.bajas > 0} />
            <Indicador Icono={ArrowRight} valor={resultado.cambios}
              etiqueta="Con cambio real"
              nota={[
                resultado.cambio_zona && `${resultado.cambio_zona} de zona`,
                resultado.cambio_turno && `${resultado.cambio_turno} de turno`,
                resultado.cambio_direccion && `${resultado.cambio_direccion} de dirección`,
              ].filter(Boolean).join(', ') || 'ninguno'} />
            <Indicador Icono={MapPin} valor={resultado.ubicacion_obsoleta}
              etiqueta="Ubicación a rehacer" alerta={resultado.ubicacion_obsoleta > 0}
              nota={resultado.ubicacion_obsoleta > 0
                ? 'se mudaron; su casa ya no está donde se aprendió'
                : 'ninguna se quedó obsoleta'} />
          </section>

          <section className="pw-panel">
            <div className="pw-panel-head">
              <h2 className="pw-panel-title">Qué cambia de verdad</h2>
              <span className="pw-panel-count">{resultado.filas}</span>
            </div>
            <ul className="nov-lista">
              {resultado.entradas.map((dato, indice) => (
                <Entrada key={`${dato.dni}-${dato.fecha}-${indice}`} dato={dato} />
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
};

export default PanelNovedades;
