import { useState } from 'react';
import { ClipboardList, UploadCloud } from 'lucide-react';
import PanelHistorico from './PanelHistorico';
import PanelNovedades from './PanelNovedades';
import './programador.css';

/**
 * Las dos cargas del Programador, en un sitio.
 *
 * Son dos archivos distintos y se confunden con facilidad, así que están
 * separados y nombrados: el **histórico** es lo que ya pasó y sale de la
 * intranet; las **novedades** son lo que el cliente pide para los próximos
 * días y llegan por su cuenta. Subir uno donde va el otro no rompe nada —el
 * servidor los distingue y lo dice—, pero tenerlos con su nombre evita el
 * viaje.
 */

const PESTANAS = [
  {
    id: 'historico',
    titulo: 'Histórico de la operación',
    Icono: UploadCloud,
    descripcion: 'Sube el reporte «Detalle» de la intranet. De aquí salen las '
      + 'duraciones reales y la ubicación de cada pasajero.',
    Panel: PanelHistorico,
  },
  {
    id: 'novedades',
    titulo: 'Novedades del cliente',
    Icono: ClipboardList,
    descripcion: 'Sube el Excel de novedades. Cada fila se contrasta con el '
      + 'histórico para ver qué cambia de verdad.',
    Panel: PanelNovedades,
  },
];

const HistoricoView = () => {
  const [activa, setActiva] = useState(PESTANAS[0].id);
  const pestana = PESTANAS.find((p) => p.id === activa) ?? PESTANAS[0];
  const { Panel } = pestana;

  return (
    <div className="pw-root">
      <header className="pw-header">
        <div className="pw-header-titles historico-titulos">
          <h1 className="pw-title">{pestana.titulo}</h1>
          <p className="pw-meta">{pestana.descripcion}</p>
        </div>
      </header>

      <div className="nov-pestanas" role="tablist" aria-label="Qué se va a cargar">
        {PESTANAS.map(({ id, titulo, Icono }) => (
          <button key={id} type="button" role="tab" aria-selected={activa === id}
            className={`nov-pestana${activa === id ? ' activa' : ''}`}
            onClick={() => setActiva(id)}>
            <Icono size={15} aria-hidden="true" />
            {titulo}
          </button>
        ))}
      </div>

      <Panel />
    </div>
  );
};

export default HistoricoView;
