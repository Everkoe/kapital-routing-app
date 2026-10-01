import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

/**
 * Los dos gráficos del tablero heredado (`DashboardView` en `App.jsx`).
 *
 * Viven aparte para cargarse solo cuando hay rutas que dibujar: la librería de
 * gráficos pesa 250 KB, iba en el paquete que descarga todo el mundo al abrir
 * la aplicación, y este tablero casi nunca tiene rutas (`/api/routes` devuelve
 * una lista vacía desde que las pantallas leen el histórico).
 */

const COLORS = ['#10B981', '#f59e0b', '#334155'];

const ESTILO_TOOLTIP = {
  backgroundColor: 'var(--kapital-card-bg)', border: '1px solid var(--kapital-border)', borderRadius: '8px',
};

const GraficosDelTablero = ({ chartData, pieData }) => (
  <div style={{display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px'}}>
    <div className="card" style={{flex: '2 1 400px', minWidth: '280px', height: '340px'}}>
      <h3 style={{marginTop: 0, padding: '15px 20px', borderBottom: '1px solid var(--kapital-border)'}}>Demanda por Zona</h3>
      <ResponsiveContainer width="100%" height="80%">
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 25 }}>
          <XAxis dataKey="name" stroke="var(--kapital-text-secondary)" tick={{fontSize: 10}} angle={-35} textAnchor="end" interval={0} />
          <YAxis stroke="var(--kapital-text-secondary)" tick={{fontSize: 11}} />
          <Tooltip contentStyle={ESTILO_TOOLTIP} />
          <Bar dataKey="pasajeros" fill="#38bdf8" name="Pasajeros" radius={[4,4,0,0]} barSize={24} animationDuration={1000} animationEasing="ease-out" />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <div className="card" style={{flex: '1 1 280px', minWidth: '280px', height: '340px'}}>
      <h3 style={{marginTop: 0, padding: '15px 20px', borderBottom: '1px solid var(--kapital-border)'}}>Progreso de Asignación</h3>
      <ResponsiveContainer width="100%" height="80%">
        <PieChart>
          <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={85} paddingAngle={5} dataKey="value" animationDuration={1000} animationEasing="ease-out">
            {pieData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={ESTILO_TOOLTIP} />
          <Legend wrapperStyle={{fontSize:"12px"}} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  </div>
);

export default GraficosDelTablero;
