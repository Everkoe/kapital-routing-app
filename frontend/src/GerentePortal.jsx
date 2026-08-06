// GerentePortal.jsx — Panel de Analítica para Gerente de Operaciones
import React, { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from "recharts";

const PALETTE = {
  primary: "#6366f1", purple: "#8b5cf6", green: "#10b981",
  amber: "#f59e0b", cyan: "#06b6d4", red: "#ef4444",
};

const StatCard = ({ title, value, subtitle, icon, color, delay = 0 }) => (
  <div style={{
    background: "var(--bg-secondary)", border: `1px solid ${color}33`,
    borderRadius: "16px", padding: "22px 24px", flex: "1 1 200px", minWidth: "180px",
    position: "relative", overflow: "hidden", transition: "transform 0.2s, box-shadow 0.2s",
    animation: `fadeSlideUp 0.5s ease ${delay}s both`,
  }}
    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 16px 40px ${color}22`; }}
    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: `linear-gradient(90deg, ${color}, ${color}44)`, borderRadius: "16px 16px 0 0" }} />
    <div style={{ position: "absolute", top: "-20px", right: "-20px", width: "80px", height: "80px", borderRadius: "50%", background: `${color}14`, filter: "blur(20px)" }} />
    <div style={{ width: "42px", height: "42px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", background: `${color}18`, border: `1px solid ${color}33`, fontSize: "1.3rem", marginBottom: "14px" }}>{icon}</div>
    <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, marginBottom: "6px", letterSpacing: "-1px" }}>{value}</div>
    <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "2px" }}>{title}</div>
    {subtitle && <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{subtitle}</div>}
  </div>
);

const ChartCard = ({ title, subtitle, children, style = {} }) => (
  <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "16px", overflow: "hidden", ...style }}>
    <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border-color)" }}>
      <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-primary)" }}>{title}</div>
      {subtitle && <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: "2px" }}>{subtitle}</div>}
    </div>
    <div style={{ padding: "20px 22px" }}>{children}</div>
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--bg-primary, #0f1117)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "10px 14px", fontSize: "0.82rem" }}>
      <div style={{ fontWeight: 700, marginBottom: "4px", color: "var(--text-primary)" }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color }}>{p.name}: <strong>{p.value}</strong></div>)}
    </div>
  );
};

const ProgressBar = ({ value, max, color }) => (
  <div style={{ background: `${color}22`, borderRadius: "6px", height: "8px", overflow: "hidden", flex: 1 }}>
    <div style={{ width: `${Math.min((value / Math.max(max, 1)) * 100, 100)}%`, height: "100%", background: color, borderRadius: "6px", transition: "width 0.8s ease" }} />
  </div>
);

const GerentePortal = ({ usuario, onLogout }) => {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadRoutes = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/routes");
      if (res.ok) { const t = await res.text(); if (t) { const d = JSON.parse(t); if (Array.isArray(d)) { setRoutes(d); setLastUpdated(new Date()); } } }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadRoutes(); }, []);

  const kpis = useMemo(() => {
    const totalAgentes = routes.reduce((s, r) => s + r.agentes.length, 0);
    const conductores = [...new Set(routes.filter(r => r.conductor !== "SIN ASIGNAR").map(r => r.conductor))];
    const flotaActiva = conductores.length;
    const capacidadTotal = flotaActiva * 15;
    const tasaOpt = capacidadTotal > 0 ? ((totalAgentes / capacidadTotal) * 100).toFixed(1) : 0;
    const sinAsignar = routes.filter(r => r.conductor === "SIN ASIGNAR").reduce((s, r) => s + r.agentes.length, 0);
    return { totalAgentes, flotaActiva, tasaOpt, rutasProg: routes.length, sinAsignar, capacidadTotal };
  }, [routes]);

  const cargaData = useMemo(() =>
    routes.filter(r => r.conductor !== "SIN ASIGNAR")
      .map(r => ({ name: r.conductor, Pasajeros: r.agentes.length, Disponible: Math.max(0, 15 - r.agentes.length) }))
      .sort((a, b) => b.Pasajeros - a.Pasajeros).slice(0, 15), [routes]);

  const zonaData = useMemo(() => {
    const map = {};
    routes.forEach(r => r.agentes.forEach(() => { map[r.micro_zona] = (map[r.micro_zona] || 0) + 1; }));
    return Object.entries(map).map(([zona, count]) => ({ zona, Agentes: count })).sort((a, b) => b.Agentes - a.Agentes);
  }, [routes]);

  const horarioData = useMemo(() => {
    const map = {};
    routes.forEach(r => { map[r.horario] = (map[r.horario] || 0) + r.agentes.length; });
    return Object.entries(map).map(([horario, agentes]) => ({ horario, Agentes: agentes })).sort((a, b) => a.horario.localeCompare(b.horario));
  }, [routes]);

  const pieData = [
    { name: "Ocupado", value: parseFloat(kpis.tasaOpt) || 0 },
    { name: "Libre", value: Math.max(0, 100 - parseFloat(kpis.tasaOpt)) },
  ];
  const PIE_COLORS = [PALETTE.green, "#1e2433"];

  const topConductores = useMemo(() => {
    const map = {};
    routes.forEach(r => { if (r.conductor !== "SIN ASIGNAR") { if (!map[r.conductor]) map[r.conductor] = { conductor: r.conductor, agentes: 0, rutas: 0 }; map[r.conductor].agentes += r.agentes.length; map[r.conductor].rutas += 1; } });
    return Object.values(map).sort((a, b) => b.agentes - a.agentes).slice(0, 8);
  }, [routes]);

  const maxAgentes = topConductores[0]?.agentes || 1;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary, #0f1117)" }}>
      <style>{`
        @keyframes fadeSlideUp { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>

      {/* Navbar */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-color)", padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", height: "60px", backdropFilter: "blur(10px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img src="/logo.png" alt="Kapital" style={{ height: "32px" }} onError={e => e.target.style.display = "none"} />
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text-primary)" }}>Panel de Analítica</div>
            <div style={{ fontSize: "0.72rem", color: PALETTE.amber, fontWeight: 600, letterSpacing: "0.5px" }}>GERENTE DE OPERACIONES</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {lastUpdated && <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Actualizado: {lastUpdated.toLocaleTimeString()}</span>}
          <button onClick={loadRoutes} style={{ padding: "7px 14px", borderRadius: "8px", border: "1px solid var(--border-color)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 }}>🔄 Actualizar</button>
          <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: `linear-gradient(135deg, ${PALETTE.amber}, #f97316)`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "0.9rem" }}>{usuario?.nombre?.charAt(0)?.toUpperCase() || "G"}</div>
          <div>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>{usuario?.nombre}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>{usuario?.email}</div>
          </div>
          <button onClick={onLogout} style={{ marginLeft: "8px", padding: "7px 14px", borderRadius: "8px", border: "1px solid #ef444444", background: "rgba(239,68,68,0.08)", color: "#ef4444", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 }}>Cerrar Sesión</button>
        </div>
      </nav>

      {/* Main */}
      <main style={{ maxWidth: "1400px", margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ marginBottom: "28px", animation: "fadeSlideUp 0.4s ease both" }}>
          <h1 style={{ margin: "0 0 4px", fontSize: "1.6rem", fontWeight: 800, color: "var(--text-primary)" }}>Panel de Operaciones 📊</h1>
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.9rem" }}>Resumen ejecutivo en tiempo real — Solo visualización</p>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 24px" }}>
            <div style={{ fontSize: "2.5rem", animation: "spin 1s linear infinite", display: "inline-block" }}>⚙️</div>
            <p style={{ color: "var(--text-secondary)", marginTop: "16px" }}>Cargando datos de operaciones…</p>
          </div>
        ) : routes.length === 0 ? (
          <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "16px", textAlign: "center", padding: "80px 24px" }}>
            <div style={{ fontSize: "3.5rem", marginBottom: "16px" }}>📊</div>
            <h3 style={{ margin: "0 0 8px", color: "var(--text-primary)", fontWeight: 700 }}>Sin datos disponibles</h3>
            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", maxWidth: "320px", marginLeft: "auto", marginRight: "auto" }}>Un Administrador debe cargar el Excel y generar las rutas para ver las estadísticas aquí.</p>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "24px" }}>
              <StatCard title="Total Pasajeros" value={kpis.totalAgentes.toLocaleString()} subtitle="En todas las rutas asignadas" icon="👥" color={PALETTE.cyan} delay={0} />
              <StatCard title="Flota Activa" value={`${kpis.flotaActiva} veh.`} subtitle={`Capacidad: ${kpis.capacidadTotal} pax`} icon="🚐" color={PALETTE.green} delay={0.05} />
              <StatCard title="Rutas Programadas" value={kpis.rutasProg} subtitle="Turnos totales asignados" icon="🗺️" color={PALETTE.amber} delay={0.1} />
              <StatCard title="Optimización" value={`${kpis.tasaOpt}%`} subtitle="Capacidad utilizada" icon="⚡" color={PALETTE.purple} delay={0.15} />
              {kpis.sinAsignar > 0 && <StatCard title="Sin Asignar" value={kpis.sinAsignar} subtitle="Requieren atención" icon="⚠️" color={PALETTE.red} delay={0.2} />}
            </div>

            {/* Row 1 */}
            <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "20px" }}>
              <ChartCard title="Carga por Unidad" subtitle="Pasajeros asignados vs disponibles por vehículo" style={{ flex: "2 1 480px", minWidth: "300px" }}>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={cargaData} margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--text-secondary)" }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar dataKey="Pasajeros" stackId="a" fill={PALETTE.primary} />
                    <Bar dataKey="Disponible" stackId="a" fill="#1e2a3a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Eficiencia Global" subtitle="% de capacidad utilizada" style={{ flex: "1 1 220px", minWidth: "200px" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "280px" }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={85} dataKey="value" strokeWidth={0}>
                        {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ textAlign: "center", marginTop: "4px" }}>
                    <div style={{ fontSize: "2.2rem", fontWeight: 800, color: PALETTE.green }}>{kpis.tasaOpt}%</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Ocupación</div>
                  </div>
                </div>
              </ChartCard>
            </div>

            {/* Row 2 */}
            <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginBottom: "20px" }}>
              <ChartCard title="Agentes por Micro-Zona" subtitle="Distribución geográfica de pasajeros" style={{ flex: "1 1 300px", minWidth: "260px" }}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={zonaData} layout="vertical" margin={{ top: 0, right: 16, left: 80, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} />
                    <YAxis type="category" dataKey="zona" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} width={80} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="Agentes" fill={PALETTE.cyan} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Distribución Horaria" subtitle="Total de pasajeros por turno" style={{ flex: "1 1 300px", minWidth: "260px" }}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={horarioData} margin={{ top: 4, right: 16, left: -10, bottom: 0 }}>
                    <XAxis dataKey="horario" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--text-secondary)" }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="Agentes" fill={PALETTE.amber} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Top Conductores */}
            <ChartCard title="Ranking de Conductores por Carga" subtitle="Ordenado por total de pasajeros asignados">
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {topConductores.map((c, i) => (
                  <div key={c.conductor} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{ width: "28px", height: "28px", borderRadius: "8px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: i < 3 ? `${[PALETTE.amber, "#9ca3af", "#cd7f32"][i]}22` : "var(--bg-primary)", border: `1px solid ${i < 3 ? [PALETTE.amber, "#9ca3af", "#cd7f32"][i] : "var(--border-color)"}44`, color: i < 3 ? [PALETTE.amber, "#9ca3af", "#cd7f32"][i] : "var(--text-secondary)", fontSize: "0.75rem", fontWeight: 700 }}>#{i + 1}</div>
                    <div style={{ width: "110px", flexShrink: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" }}>{c.conductor}</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>{c.rutas} ruta{c.rutas !== 1 ? "s" : ""}</div>
                    </div>
                    <ProgressBar value={c.agentes} max={maxAgentes} color={PALETTE.primary} />
                    <div style={{ width: "52px", flexShrink: 0, textAlign: "right", fontWeight: 700, fontSize: "0.9rem", color: "var(--text-primary)" }}>{c.agentes} <span style={{ fontSize: "0.68rem", color: "var(--text-secondary)", fontWeight: 400 }}>pax</span></div>
                  </div>
                ))}
              </div>
            </ChartCard>

            {/* Status footer */}
            <div style={{ marginTop: "20px", padding: "14px 20px", borderRadius: "12px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", display: "flex", alignItems: "center", gap: "10px", fontSize: "0.83rem", color: "var(--text-secondary)" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: PALETTE.green, boxShadow: `0 0 8px ${PALETTE.green}`, flexShrink: 0 }} />
              Sistema operativo — {kpis.rutasProg} rutas activas con {kpis.totalAgentes.toLocaleString()} pasajeros asignados.
              {lastUpdated && ` Última sincronización: ${lastUpdated.toLocaleTimeString()}.`}
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default GerentePortal;
