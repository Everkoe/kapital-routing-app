import React, { useState, useEffect } from 'react';
import { Users, CarFront, FileWarning, Activity, CheckCircle, AlertCircle, Clock, ChevronRight } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';

const getDocStatus = (dateStr) => {
  if (!dateStr || dateStr === 'N/A') return { status: 'neutral', text: 'N/A', days: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(dateStr + 'T00:00:00');
  if (isNaN(targetDate.getTime())) return { status: 'neutral', text: dateStr, days: null };
  
  const diffTime = targetDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return { status: 'danger', text: 'VENCIDO', days: diffDays };
  if (diffDays <= 15) return { status: 'warning', text: `VENCE EN ${diffDays} D`, days: diffDays };
  return { status: 'success', text: 'VIGENTE', days: diffDays };
};

export default function AdminDashboard({ onNavigate, usuario }) {
  const [flota, setFlota] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch flota
        const flotaRes = await fetch('/api/flota');
        if (flotaRes.ok) {
          const flotaData = await flotaRes.json();
          setFlota(flotaData.flota || (Array.isArray(flotaData) ? flotaData : []));
        }

        // Fetch users (same endpoint as UsersManagementTab)
        if (usuario?.email) {
          const usersRes = await fetch(`/api/admin/users?email=${encodeURIComponent(usuario.email)}`);
          if (usersRes.ok) {
            const text = await usersRes.text();
            const data = text ? JSON.parse(text) : {};
            setUsers(data.usuarios || []);
          }
        }
      } catch (err) {
        console.error("Error cargando dashboard:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [usuario]);

  if (loading) {
    return (
      <div className="card" style={{ padding: '60px', textAlign: 'center' }}>
        <div style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>Cargando datos del sistema...</div>
      </div>
    );
  }

  // --- KPIs ---
  const totalUsers = users.length;
  const pendingUsers = users.filter(u => (u.estado || '').toLowerCase().includes('pendiente')).length;
  const activeUsers = users.filter(u => {
    const estado = (u.estado || '').toLowerCase();
    return estado === 'activo' || estado === 'aprobado';
  }).length;

  const totalFlota = flota.length;
  let expiringDocs = 0;
  let expiredDocs = 0;
  const alertItems = [];
  
  flota.forEach(v => {
    const docChecks = [
      { name: 'SOAT', date: v.soat, placa: v.placa },
      { name: 'Rev. Técnica', date: v.revision, placa: v.placa },
      { name: 'T.U.C (ATU)', date: v.atu, placa: v.placa },
      { name: 'Licencia MTC', date: v.licencia, placa: v.placa },
    ];
    docChecks.forEach(doc => {
      const s = getDocStatus(doc.date);
      if (s.status === 'danger') {
        expiredDocs++;
        alertItems.push({ type: 'danger', text: `${doc.name} de ${doc.placa} está VENCIDO`, placa: doc.placa });
      }
      if (s.status === 'warning') {
        expiringDocs++;
        alertItems.push({ type: 'warning', text: `${doc.name} de ${doc.placa} vence en ${s.days} días`, placa: doc.placa });
      }
    });
  });

  // Add pending user alerts
  users.filter(u => (u.estado || '').toLowerCase().includes('pendiente')).forEach(u => {
    alertItems.unshift({ type: 'pending', text: `${u.nombre || u.email} tiene acceso pendiente de aprobación` });
  });

  const totalDocsChecked = totalFlota * 4;
  const vigentes = totalDocsChecked - expiredDocs - expiringDocs;

  // Health score
  const systemHealthScore = totalDocsChecked > 0 || totalUsers > 0
    ? Math.max(0, Math.round(100 - (pendingUsers * 3) - (expiredDocs * 5) - (expiringDocs * 2)))
    : 100;
  const healthColor = systemHealthScore > 80 ? '#10b981' : (systemHealthScore > 50 ? '#f59e0b' : '#ef4444');
  const healthLabel = systemHealthScore > 80 ? 'Operativo' : (systemHealthScore > 50 ? 'Requiere Atención' : 'Crítico');

  // Chart data
  const flotaDocsData = [
    { name: 'Vigentes', value: vigentes, color: '#10b981' },
    { name: 'Por Vencer', value: expiringDocs, color: '#f59e0b' },
    { name: 'Vencidos', value: expiredDocs, color: '#ef4444' }
  ].filter(d => d.value > 0);

  const rolesSet = new Set(users.map(u => u.rol || 'Sin Rol'));
  const rolesData = Array.from(rolesSet).map(rol => {
    return {
      name: rol,
      activos: users.filter(u => (u.rol || 'Sin Rol') === rol && !(u.estado || '').toLowerCase().includes('pendiente')).length,
      pendientes: users.filter(u => (u.rol || 'Sin Rol') === rol && (u.estado || '').toLowerCase().includes('pendiente')).length
    };
  });

  const cardStyle = {
    background: 'var(--bg-secondary, #1e293b)',
    borderRadius: '12px',
    border: '1px solid var(--border-color, #334155)',
    padding: '22px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* HEADER */}
      <div style={{ ...cardStyle, padding: '24px 28px' }}>
        <h2 style={{ margin: '0 0 6px 0', fontSize: '1.5rem', fontWeight: 700 }}>Panel de Control</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Vista general del sistema en tiempo real. Datos actualizados al momento de carga.
        </p>
      </div>

      {/* KPI ROW - 4 cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        
        {/* KPI: Total Usuarios */}
        <div 
          style={{ ...cardStyle, cursor: 'pointer', transition: 'border-color 0.2s' }} 
          onClick={() => onNavigate('usuarios')}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#38bdf8'}
          onMouseLeave={e => e.currentTarget.style.borderColor = ''}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Usuarios Registrados</span>
            <div style={{ padding: '8px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', borderRadius: '10px' }}><Users size={20} /></div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '8px' }}>{totalUsers}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: pendingUsers > 0 ? '#f59e0b' : '#10b981' }}>
            {pendingUsers > 0 ? <Clock size={14} /> : <CheckCircle size={14} />}
            <span>{pendingUsers > 0 ? `${pendingUsers} pendiente${pendingUsers > 1 ? 's' : ''}` : 'Sin pendientes'}</span>
          </div>
        </div>

        {/* KPI: Flota */}
        <div 
          style={{ ...cardStyle, cursor: 'pointer', transition: 'border-color 0.2s' }} 
          onClick={() => onNavigate('flota')}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#10b981'}
          onMouseLeave={e => e.currentTarget.style.borderColor = ''}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Unidades en Flota</span>
            <div style={{ padding: '8px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: '10px' }}><CarFront size={20} /></div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '8px' }}>{totalFlota}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            <CheckCircle size={14} />
            <span>{totalFlota} unidades activas</span>
          </div>
        </div>

        {/* KPI: Documentos críticos */}
        <div style={{ ...cardStyle }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Documentos Críticos</span>
            <div style={{ padding: '8px', background: expiredDocs > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(234, 179, 8, 0.1)', color: expiredDocs > 0 ? '#ef4444' : '#f59e0b', borderRadius: '10px' }}><FileWarning size={20} /></div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '8px', color: expiredDocs > 0 ? '#ef4444' : 'inherit' }}>{expiredDocs + expiringDocs}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: expiredDocs > 0 ? '#ef4444' : '#f59e0b' }}>
            <AlertCircle size={14} />
            <span>{expiredDocs} vencidos · {expiringDocs} por vencer</span>
          </div>
        </div>

        {/* KPI: Health */}
        <div style={{ ...cardStyle, borderTop: `3px solid ${healthColor}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Salud del Sistema</span>
            <div style={{ padding: '8px', background: `${healthColor}1a`, color: healthColor, borderRadius: '10px' }}><Activity size={20} /></div>
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '8px', color: healthColor }}>{systemHealthScore}%</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: healthColor }}>
            <span>{healthLabel}</span>
          </div>
        </div>

      </div>

      {/* CHARTS ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        
        {/* Donut: Documentación */}
        <div style={{ ...cardStyle }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '1.05rem', fontWeight: 600 }}>Estado de Documentación</h3>
          {flotaDocsData.length > 0 ? (
            <div style={{ height: '280px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={flotaDocsData} cx="50%" cy="50%" innerRadius={65} outerRadius={95} paddingAngle={4} dataKey="value">
                    {flotaDocsData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '0.85rem' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              No hay datos de flota disponibles
            </div>
          )}
        </div>

        {/* Bar: Usuarios por rol */}
        <div style={{ ...cardStyle }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '1.05rem', fontWeight: 600 }}>Usuarios por Rol</h3>
          <div style={{ height: '280px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rolesData} margin={{ top: 10, right: 20, left: -10, bottom: 5 }}>
                <XAxis dataKey="name" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)', fontSize: 13 }} />
                <YAxis stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} allowDecimals={false} />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)' }}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                />
                <Legend wrapperStyle={{ fontSize: '0.85rem' }} />
                <Bar dataKey="activos" name="Aprobados/Activos" stackId="a" fill="#38bdf8" radius={[0, 0, 4, 4]} />
                <Bar dataKey="pendientes" name="Pendientes" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* ALERTS FEED */}
      <div style={{ ...cardStyle }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1.05rem', fontWeight: 600 }}>
          Alertas del Sistema ({alertItems.length})
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
          {alertItems.length > 0 ? alertItems.slice(0, 20).map((alert, i) => (
            <div key={i} style={{ 
              padding: '10px 14px', 
              background: 'var(--bg-primary, #0f172a)', 
              borderRadius: '8px', 
              borderLeft: `4px solid ${alert.type === 'danger' ? '#ef4444' : alert.type === 'warning' ? '#f59e0b' : '#38bdf8'}`,
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              {alert.type === 'danger' && <AlertCircle size={16} color="#ef4444" style={{ flexShrink: 0 }} />}
              {alert.type === 'warning' && <Clock size={16} color="#f59e0b" style={{ flexShrink: 0 }} />}
              {alert.type === 'pending' && <Users size={16} color="#38bdf8" style={{ flexShrink: 0 }} />}
              <span>{alert.text}</span>
            </div>
          )) : (
            <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              <CheckCircle size={28} style={{ marginBottom: '8px', opacity: 0.5 }} /><br/>
              Sin alertas. Todo el sistema está en orden.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
