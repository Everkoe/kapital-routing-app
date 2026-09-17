import { useState, useEffect } from 'react';
import { Shield, Users, CarFront, FileWarning, Activity, CheckCircle, AlertCircle, Clock, ChevronRight, Bell, UserCircle, Truck, FileText, List, Layers, Bike } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, LabelList } from 'recharts';
import { GlobalLoader } from './components/GlobalLoader';
import { fechaLegible } from './constants/tiposDeActividad';
import { countFleetDocumentStatuses, getDocumentStatus } from './utils/flotaDocumentStatus';
import './App.css';

/** Icono de cada tipo, con el mismo criterio que el historial completo. */
const ICONOS_ACTIVIDAD = {
  'Usuario inició sesión': UserCircle,
  'Usuario desactivado': UserCircle,
  'Usuario reactivado': UserCircle,
  'Unidad creada': Truck,
  'Unidad actualizada': Truck,
  'Documento cargado': FileText,
  'Documento aprobado': FileText,
  'Documento rechazado': FileText,
  'Acceso aprobado': Shield,
  'Acceso denegado': Shield,
};


/**
 * Adaptador sobre la utilidad compartida.
 *
 * Este panel tenía su propia copia del cálculo, con un umbral de 30 días
 * mientras la cabecera de flota usaba 15 y lo anunciaba como «Por Vencer
 * (15d)». Dos pantallas llamaban «por vencer» a cosas distintas. Ahora ambas
 * derivan del mismo sitio y solo se traduce la forma del resultado.
 */
const getDocStatus = (dateStr) => {
  const { key, daysRemaining } = getDocumentStatus(dateStr);
  const status = { valid: 'ok', expiring: 'warning', expired: 'danger', na: 'missing' }[key];
  return { status, days: daysRemaining };
};

const getVehicleCategory = (v) => {
  const statuses = [v.soat, v.revision, v.atu, v.licencia].map(d => getDocStatus(d).status);
  if (statuses.includes('danger')) return 'vencido';
  if (statuses.includes('warning')) return 'por_vencer';
  if (statuses.includes('missing')) return 'sin_documento';
  return 'vigente';
};

const ROLE_DISPLAY = {
  'Conductor': 'Conductores',
  'Administración': 'Administradores',
  'Administrador': 'Administradores',
  'Cliente': 'Clientes',
  'Gerente de Operaciones': 'Gerentes',
  'Programador de rutas': 'Programadores',
};


const DASHBOARD_LOAD_TIMEOUT_MS = 12000;

const fetchJson = async (url, fallbackMessage, signal) => {
  const response = await fetch(url, { cache: 'no-store', signal });
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const detail = payload.detail || payload.message || text || `HTTP ${response.status}`;
    throw new Error(`${fallbackMessage}: ${detail}`);
  }

  return payload;
};

export default function AdminDashboard({ onNavigate, usuario }) {
  const [flota, setFlota] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [actividad, setActividad] = useState([]);
  const usuarioKey = usuario?.identifier || usuario?.email || '';

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DASHBOARD_LOAD_TIMEOUT_MS);

    const fetchData = async () => {
      if (!usuarioKey) {
        setFlota([]);
        setUsers([]);
      setActividad([]);
        setLoadError('No se pudo validar la identidad de la sesión actual.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError('');
      setFlota([]);
      setUsers([]);

      try {
        const [flotaData, usersData, actividadData] = await Promise.all([
          fetchJson('/api/flota', 'No se pudo cargar la flota', controller.signal),
          fetchJson(`/api/admin/users?email=${encodeURIComponent(usuarioKey)}`, 'No se pudo cargar los usuarios', controller.signal),
          // El historial no es crítico para el panel: si falla, el resto se
          // muestra igual y la tarjeta queda vacía en vez de tumbar la página.
          fetchJson('/api/actividad?limite=5', '', controller.signal).catch(() => null),
        ]);

        const nextFlota = flotaData?.flota || (Array.isArray(flotaData) ? flotaData : null);
        const nextUsers = usersData?.usuarios;

        if (!Array.isArray(nextFlota)) {
          throw new Error('No se pudo cargar la flota: respuesta inválida del servicio.');
        }
        if (!Array.isArray(nextUsers)) {
          throw new Error('No se pudo cargar los usuarios: respuesta inválida del servicio.');
        }

        if (!cancelled) {
          setFlota(nextFlota);
          setUsers(nextUsers);
          setActividad(actividadData?.eventos || []);
          setLoadError('');
        }
      } catch (err) {
        if (!cancelled) {
          const message = err?.name === 'AbortError'
            ? 'El servicio de datos tardó demasiado en responder.'
            : err instanceof Error ? err.message : 'Error desconocido al cargar los datos.';
          setFlota([]);
          setUsers([]);
          setLoadError(message);
          console.error('Error cargando dashboard:', err);
        }
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [usuarioKey, retryCount]);

  // --- Derived values ---
  const totalUsers = users.length;
  const totalFlota = flota.length;
  const pendingUsers = users.filter(u => (u.estado || '').toLowerCase().includes('pendiente')).length;

  // Por documento, igual que la cabecera de Gestión de Flota: contar unidades
  // clasificadas por su peor documento daba 2 «vigentes» donde flota mostraba
  // 12, y las dos cifras parecían la misma sin serlo.
  const docCounts = countFleetDocumentStatuses(flota);
  const totalDocumentos = docCounts.valid + docCounts.expiring + docCounts.expired + docCounts.na;

  // El recuento por unidad no se pierde: sigue siendo la lectura útil de
  // «cuántas unidades tienen algo sin registrar», y va como nota al pie.
  const unidadesSinDocumento = flota.filter(v => getVehicleCategory(v) === 'sin_documento').length;

  let expiredDocs = 0;
  let expiringDocs = 0;
  const alertItems = [];
  flota.forEach(v => {
    [
      { name: 'SOAT', date: v.soat },
      { name: 'Rev. Técnica', date: v.revision },
      { name: 'T.U.C (ATU)', date: v.atu },
      { name: 'Licencia MTC', date: v.licencia },
    ].forEach(doc => {
      const s = getDocStatus(doc.date);
      if (s.status === 'danger') {
        expiredDocs++;
        alertItems.push({ type: 'danger', text: `${doc.name} de ${v.placa} está VENCIDO` });
      }
      if (s.status === 'warning') {
        expiringDocs++;
        alertItems.push({ type: 'warning', text: `${doc.name} de ${v.placa} vence en ${s.days} días` });
      }
    });
  });
  users.filter(u => (u.estado || '').toLowerCase().includes('pendiente')).forEach(u => {
    alertItems.unshift({ type: 'pending', text: `${u.nombre || u.email} tiene acceso pendiente de aprobación` });
  });

  const systemHealthScore = Math.max(0, Math.round(100 - (pendingUsers * 3) - (expiredDocs * 5) - (expiringDocs * 2)));
  const healthColor = systemHealthScore > 80 ? '#10b981' : systemHealthScore > 50 ? '#f59e0b' : '#ef4444';
  const healthLabel = systemHealthScore > 80 ? 'Operativo' : systemHealthScore > 50 ? 'Requiere Atención' : 'Crítico';

  const roleCountMap = {};
  users.forEach(u => {
    const label = ROLE_DISPLAY[u.rol] || u.rol || 'Otros';
    roleCountMap[label] = (roleCountMap[label] || 0) + 1;
  });
  const rolesData = Object.entries(roleCountMap)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total);

  const docStats = [
    { label: 'Vigentes',               count: docCounts.valid,    color: '#10b981' },
    { label: 'Por vencer (≤ 15 días)', count: docCounts.expiring, color: '#f59e0b' },
    { label: 'Vencidos',               count: docCounts.expired,  color: '#ef4444' },
    { label: 'Sin documento',          count: docCounts.na,       color: '#9ca3af' },
  ];

  // Distribución de flota por base (Masivo / Remisse / Motorizado)
  const baseCounts = flota.reduce((acc, v) => {
    const b = (v.base || '').toUpperCase();
    if (b.includes('REMISSE')) acc.remisse++;
    else if (b.includes('SHARF') || b.includes('MOTORIZADO')) acc.motorizado++;
    else if (b.includes('MASIVO')) acc.masivo++;
    else acc.otras++;
    return acc;
  }, { masivo: 0, remisse: 0, motorizado: 0, otras: 0 });
  const baseStats = [
    { key: 'MASIVO',     label: 'Masivo',     count: baseCounts.masivo,     Icon: CarFront, color: '#38bdf8' },
    { key: 'REMISSE',    label: 'Remisse',    count: baseCounts.remisse,    Icon: Layers,   color: '#10b981' },
    { key: 'MOTORIZADO', label: 'Motorizado', count: baseCounts.motorizado, Icon: Bike,     color: '#f59e0b' },
  ];

  // Antes esta lista se inventaba: tomaba dos unidades de la flota y les ponía
  // horas calculadas restando 38 minutos. Ahora sale del historial real.
  const recentActivity = actividad.map((evento) => ({
    Icon: ICONOS_ACTIVIDAD[evento.action_type] || Activity,
    title: evento.action_type,
    subtitle: evento.entity_label || evento.actor_email || evento.actor_name || '',
    time: fechaLegible(evento.created_at),
  }));

  // --- Styles ---
  const card = {
    background: 'var(--bg-secondary, #1e293b)',
    borderRadius: '12px',
    border: '1px solid var(--border-color, #334155)',
    padding: '24px',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)',
  };
  const sectionHeader = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px',
  };
  const linkBtn = {
    background: 'none', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '4px',
    fontSize: '0.8rem', color: '#38bdf8', padding: 0,
  };

  if (loading) {
    return <GlobalLoader text="Cargando datos del sistema..." />;
  }

  if (loadError) {
    return (
      <div
        role="alert"
        aria-live="polite"
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '48px 24px',
          minHeight: '280px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: '12px',
        }}
      >
        <AlertCircle size={42} color="var(--kapital-accent-red)" />
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Datos del sistema no disponibles</h2>
        <p style={{ margin: 0, maxWidth: '620px', color: 'var(--text-secondary)' }}>
          No se pudo validar la información de flota y usuarios. Los indicadores no se mostrarán hasta recuperar el servicio.
        </p>
        <p style={{ margin: 0, maxWidth: '620px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          {loadError}
        </p>
        <button
          type="button"
          onClick={() => setRetryCount(current => current + 1)}
          style={{
            marginTop: '8px',
            border: '1px solid var(--primary-color)',
            borderRadius: '8px',
            padding: '10px 18px',
            background: 'transparent',
            color: 'var(--primary-color)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Reintentar carga
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* HEADER */}
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '1.6rem', fontWeight: 700 }}>Panel de Control</h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Vista general del sistema en tiempo real. Datos actualizados al momento de la carga.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.8rem', whiteSpace: 'nowrap', paddingTop: '4px' }}>
          <Clock size={14} />
          <span>Actualizado ahora</span>
        </div>
      </div>

      {/* KPI ROW */}
      <div className="dashboard-kpi-row">

        <div
          style={{ ...card, cursor: 'pointer', transition: 'border-color 0.2s' }}
          onClick={() => onNavigate('usuarios', { tab: 'Pendientes' })}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#38bdf8'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color, #334155)'}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Usuarios Registrados</span>
            <div style={{ padding: '8px', background: 'rgba(56,189,248,0.1)', color: '#38bdf8', borderRadius: '10px' }}><Users size={20} /></div>
          </div>
          <div style={{ fontSize: '2.2rem', fontWeight: 700, marginBottom: '10px' }}>{totalUsers}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: pendingUsers > 0 ? '#f59e0b' : '#10b981' }}>
            <CheckCircle size={14} />
            <span>{pendingUsers > 0 ? `${pendingUsers} pendiente${pendingUsers > 1 ? 's' : ''}` : 'Sin pendientes'}</span>
          </div>
        </div>

        <div
          style={{ ...card, cursor: 'pointer', transition: 'border-color 0.2s' }}
          onClick={() => onNavigate('flota')}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#10b981'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color, #334155)'}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Unidades en Flota</span>
            <div style={{ padding: '8px', background: 'rgba(16,185,129,0.1)', color: '#10b981', borderRadius: '10px' }}><CarFront size={20} /></div>
          </div>
          <div style={{ fontSize: '2.2rem', fontWeight: 700, marginBottom: '10px' }}>{totalFlota}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <CheckCircle size={14} />
            <span>{totalFlota} unidades activas</span>
          </div>
        </div>

        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Documentos Críticos</span>
            <div style={{ padding: '8px', background: expiredDocs > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(234,179,8,0.1)', color: expiredDocs > 0 ? '#ef4444' : '#f59e0b', borderRadius: '10px' }}>
              <FileWarning size={20} />
            </div>
          </div>
          <div style={{ fontSize: '2.2rem', fontWeight: 700, marginBottom: '10px', color: expiredDocs > 0 ? '#ef4444' : 'inherit' }}>
            {expiredDocs + expiringDocs}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: expiredDocs > 0 ? '#ef4444' : '#f59e0b' }}>
            <AlertCircle size={14} />
            <span>{expiredDocs} vencidos · {expiringDocs} por vencer</span>
          </div>
        </div>

        <div style={{ ...card, borderTop: `3px solid ${healthColor}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Salud del Sistema</span>
            <div style={{ padding: '8px', background: `${healthColor}1a`, color: healthColor, borderRadius: '10px' }}><Activity size={20} /></div>
          </div>
          <div style={{ fontSize: '2.2rem', fontWeight: 700, marginBottom: '10px', color: healthColor }}>{systemHealthScore}%</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: healthColor }}>
            <CheckCircle size={14} />
            <span>{healthLabel}</span>
          </div>
        </div>

      </div>

      {/* MIDDLE ROW — 3 columnas responsivas: Distribución (vertical) | Estado docs | Usuarios por rol */}
      <div className="dashboard-middle-row">

        {/* Distribución por base — VERTICAL (3 tarjetas apiladas) */}
        <div style={card}>
          <div style={sectionHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Layers size={18} color="var(--text-secondary)" />
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Flota por base</h3>
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{totalFlota} total</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {baseStats.map(({ key, label, count, Icon, color }) => {
              // «Flota por base» cuenta unidades, no documentos.
              const pct = totalFlota > 0 ? Math.round((count / totalFlota) * 100) : 0;
              return (
                <div
                  key={key}
                  onClick={() => onNavigate('flota', { base: key })}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.background = `${color}12`; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = `${color}33`; e.currentTarget.style.background = `${color}08`; }}
                  style={{
                    background: `${color}08`,
                    border: `1px solid ${color}33`,
                    borderRadius: '10px',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    cursor: 'pointer',
                    transition: 'background 0.18s, border-color 0.18s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ padding: '7px', background: `${color}22`, color, borderRadius: '9px', display: 'flex' }}>
                        <Icon size={16} />
                      </div>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
                    </div>
                    <span style={{ fontSize: '1.55rem', fontWeight: 700, color, lineHeight: 1 }}>{count}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ flex: 1, height: '5px', background: `${color}22`, borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.6s ease' }} />
                    </div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color, minWidth: '34px', textAlign: 'right' }}>{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
          {baseCounts.otras > 0 && (
            <div style={{ marginTop: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
              + {baseCounts.otras} en otras bases
            </div>
          )}
        </div>

        {/* Estado de documentación — progress bars */}
        <div style={card}>
          <div style={sectionHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <FileText size={18} color="var(--text-secondary)" />
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Estado de documentación</h3>
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Total: {totalDocumentos} documentos
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {docStats.map(({ label, count, color }) => {
              // El porcentaje es sobre documentos, que es lo que cuentan las barras.
              const pct = totalDocumentos > 0 ? Math.round((count / totalDocumentos) * 100) : 0;
              return (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ width: '165px', flexShrink: 0, fontSize: '0.875rem', textAlign: 'left' }}>{label}</span>
                  <span style={{ width: '28px', flexShrink: 0, fontSize: '0.875rem', fontWeight: 600, textAlign: 'right' }}>{count}</span>
                  <div style={{ flex: 1, height: '7px', background: 'var(--border-color, rgba(0,0,0,0.12))', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.6s ease' }} />
                  </div>
                  <span style={{ width: '36px', flexShrink: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'right' }}>{pct}%</span>
                </div>
              );
            })}
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {unidadesSinDocumento} de {totalFlota} unidades tienen algún documento sin registrar.
            </p>
          </div>
        </div>

        {/* Usuarios por rol — horizontal bar chart */}
        <div style={card}>
          <div style={sectionHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Users size={18} color="var(--text-secondary)" />
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Usuarios por rol</h3>
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Total: {totalUsers} usuarios</span>
          </div>
          <div style={{ height: '220px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rolesData} layout="vertical" margin={{ top: 0, right: 36, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={115}
                  tick={{ fill: 'var(--text-secondary)', fontSize: 13 }}
                  axisLine={false}
                  tickLine={false}
                />
                <RechartsTooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                  formatter={(value) => [value, 'Usuarios']}
                />
                <Bar dataKey="total" fill="#38bdf8" radius={[0, 4, 4, 0]} barSize={16}>
                  <LabelList dataKey="total" position="right" style={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* BOTTOM ROW */}
      <div className="dashboard-bottom-row">

        {/* Alertas del sistema */}
        <div style={card}>
          <div style={sectionHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Bell size={18} color="#38bdf8" />
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Alertas del sistema ({alertItems.length})</h3>
            </div>
            <button style={linkBtn} onClick={() => onNavigate('usuarios')}>
              Ver todas <ChevronRight size={14} />
            </button>
          </div>
          {alertItems.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
              {alertItems.slice(0, 10).map((alert, i) => (
                <div key={i} style={{
                  padding: '10px 14px',
                  background: 'var(--bg-primary, rgba(0,0,0,0.15))',
                  borderRadius: '8px',
                  borderLeft: `4px solid ${alert.type === 'danger' ? '#ef4444' : alert.type === 'warning' ? '#f59e0b' : '#38bdf8'}`,
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}>
                  {alert.type === 'danger' && <AlertCircle size={15} color="#ef4444" style={{ flexShrink: 0 }} />}
                  {alert.type === 'warning' && <Clock size={15} color="#f59e0b" style={{ flexShrink: 0 }} />}
                  {alert.type === 'pending' && <Users size={15} color="#38bdf8" style={{ flexShrink: 0 }} />}
                  <span>{alert.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              background: 'rgba(16,185,129,0.06)',
              border: '1px solid rgba(16,185,129,0.2)',
              borderRadius: '10px',
              padding: '28px',
              textAlign: 'center',
            }}>
              <CheckCircle size={32} color="#10b981" style={{ marginBottom: '10px' }} />
              <p style={{ margin: '0 0 4px 0', fontWeight: 600, fontSize: '0.9rem' }}>Sin alertas. Todo el sistema está en orden.</p>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Te notificaremos aquí si hay algún evento importante.</p>
            </div>
          )}
        </div>

        {/* Actividad reciente */}
        <div style={card}>
          <div style={sectionHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <List size={18} color="#38bdf8" />
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Actividad reciente</h3>
            </div>
            <button style={linkBtn} onClick={() => onNavigate('historial')}>
              Ver todas <ChevronRight size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {recentActivity.slice(0, 5).map(({ Icon, title, subtitle, time }, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 0',
                borderBottom: i < Math.min(recentActivity.length, 5) - 1 ? '1px solid var(--border-color, #334155)' : 'none',
              }}>
                <div style={{ padding: '8px', background: 'var(--bg-primary, rgba(0,0,0,0.15))', borderRadius: '8px', flexShrink: 0 }}>
                  <Icon size={16} color="var(--text-secondary)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 2px 0', fontSize: '0.875rem', fontWeight: 500 }}>{title}</p>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</p>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', flexShrink: 0 }}>{time}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
