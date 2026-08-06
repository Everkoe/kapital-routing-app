// GerentePortal.jsx — Panel Ejecutivo para Gerente de Operaciones (Dueño)
import React, { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid
} from "recharts";

const PALETTE = {
  primary: "#6366f1", purple: "#8b5cf6", green: "#10b981",
  amber: "#f59e0b", cyan: "#06b6d4", red: "#ef4444", pink: "#ec4899",
  indigo: "#4f46e5",
};
const PIE_COLORS = [PALETTE.green, PALETTE.primary, PALETTE.amber, PALETTE.cyan, PALETTE.pink, PALETTE.red];

// ─── Animated KPI Card ───────────────────────────────────────────────────────
const StatCard = ({ title, value, subtitle, icon, color, trend, delay = 0 }) => (
  <div style={{
    background: "var(--bg-secondary)", border: `1px solid ${color}33`,
    borderRadius: "16px", padding: "20px 22px", flex: "1 1 180px", minWidth: "170px",
    position: "relative", overflow: "hidden", transition: "transform 0.2s, box-shadow 0.2s",
    animation: `fadeSlideUp 0.5s ease ${delay}s both`,
  }}
    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 16px 40px ${color}22`; }}
    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: `linear-gradient(90deg, ${color}, ${color}55)` }} />
    <div style={{ position: "absolute", top: "-20px", right: "-20px", width: "80px", height: "80px", borderRadius: "50%", background: `${color}12`, filter: "blur(20px)" }} />
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
      <div style={{ width: "40px", height: "40px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", background: `${color}18`, border: `1px solid ${color}33`, fontSize: "1.2rem" }}>{icon}</div>
      {trend !== undefined && <div style={{ fontSize: "0.75rem", fontWeight: 700, color: trend >= 0 ? PALETTE.green : PALETTE.red, background: trend >= 0 ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", padding: "3px 8px", borderRadius: "20px" }}>{trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%</div>}
    </div>
    <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, marginBottom: "5px", letterSpacing: "-1px" }}>{value}</div>
    <div style={{ fontSize: "0.83rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "2px" }}>{title}</div>
    {subtitle && <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>{subtitle}</div>}
  </div>
);

// ─── Section Card ─────────────────────────────────────────────────────────────
const ChartCard = ({ title, subtitle, children, action, style = {} }) => (
  <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "16px", overflow: "hidden", ...style }}>
    <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text-primary)" }}>{title}</div>
        {subtitle && <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)", marginTop: "2px" }}>{subtitle}</div>}
      </div>
      {action}
    </div>
    <div style={{ padding: "18px 20px" }}>{children}</div>
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--bg-primary,#0f1117)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "10px 14px", fontSize: "0.82rem" }}>
      <div style={{ fontWeight: 700, marginBottom: "4px", color: "var(--text-primary)" }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color }}>{p.name}: <strong>{p.value}</strong></div>)}
    </div>
  );
};

const ProgressBar = ({ value, max, color }) => (
  <div style={{ background: `${color}20`, borderRadius: "6px", height: "7px", overflow: "hidden", flex: 1 }}>
    <div style={{ width: `${Math.min((value / Math.max(max, 1)) * 100, 100)}%`, height: "100%", background: color, borderRadius: "6px", transition: "width 0.8s ease" }} />
  </div>
);

const InfoBadge = ({ label, value, color }) => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "5px 12px", borderRadius: "30px", background: `${color}14`, border: `1px solid ${color}33`, marginRight: "8px", marginBottom: "8px" }}>
    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{label}</span>
    <span style={{ fontSize: "0.82rem", fontWeight: 700, color }}>{value}</span>
  </div>
);

// ─── Main Portal ─────────────────────────────────────────────────────────────
const GerentePortal = ({ usuario, onLogout }) => {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [conductorPage, setConductorPage] = useState(0);
  const COND_PER_PAGE = 20;

  const loadRoutes = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/routes");
      if (res.ok) {
        const t = await res.text();
        if (t) {
          const d = JSON.parse(t);
          if (Array.isArray(d)) { setRoutes(d); setLastUpdated(new Date()); }
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadRoutes(); }, []);

  // ── KPIs ──
  const kpis = useMemo(() => {
    const totalAgentes = routes.reduce((s, r) => s + r.agentes.length, 0);
    const conductoresSet = [...new Set(routes.filter(r => r.conductor !== "SIN ASIGNAR").map(r => r.conductor))];
    const flotaActiva = conductoresSet.length;
    const capacidadTotal = flotaActiva * 15;
    const tasaOpt = capacidadTotal > 0 ? ((totalAgentes / capacidadTotal) * 100).toFixed(1) : 0;
    const sinAsignar = routes.filter(r => r.conductor === "SIN ASIGNAR").reduce((s, r) => s + r.agentes.length, 0);
    const zonasUnicas = new Set(routes.map(r => r.micro_zona)).size;
    const turnosUnicos = new Set(routes.map(r => r.horario)).size;
    const promPorRuta = routes.length > 0 ? (totalAgentes / routes.length).toFixed(1) : 0;
    const rutasFull = routes.filter(r => r.agentes.length >= 15).length;
    const rutasVacias = routes.filter(r => r.agentes.length === 0).length;
    return { totalAgentes, flotaActiva, tasaOpt, rutasProg: routes.length, sinAsignar, capacidadTotal, zonasUnicas, turnosUnicos, promPorRuta, rutasFull, rutasVacias, conductoresSet };
  }, [routes]);

  // ── Pasajeros por conductor (paginado) ──
  const conductorData = useMemo(() =>
    routes.filter(r => r.conductor !== "SIN ASIGNAR")
      .reduce((acc, r) => {
        const ex = acc.find(x => x.name === r.conductor);
        if (ex) { ex.Pasajeros += r.agentes.length; ex.Rutas += 1; }
        else acc.push({ name: r.conductor, Pasajeros: r.agentes.length, Rutas: 1, Disponible: Math.max(0, 15 - r.agentes.length) });
        return acc;
      }, [])
      .sort((a, b) => b.Pasajeros - a.Pasajeros),
  [routes]);

  const conductorPageData = conductorData.slice(conductorPage * COND_PER_PAGE, (conductorPage + 1) * COND_PER_PAGE);
  const totalPages = Math.ceil(conductorData.length / COND_PER_PAGE);

  // ── Micro-zona ──
  const zonaData = useMemo(() => {
    const map = {};
    routes.forEach(r => r.agentes.forEach(() => { map[r.micro_zona] = (map[r.micro_zona] || 0) + 1; }));
    return Object.entries(map).map(([zona, count]) => ({ zona, Agentes: count })).sort((a, b) => b.Agentes - a.Agentes);
  }, [routes]);

  // ── Horario ──
  const horarioData = useMemo(() => {
    const map = {};
    routes.forEach(r => { map[r.horario] = (map[r.horario] || 0) + r.agentes.length; });
    return Object.entries(map).map(([h, a]) => ({ horario: h, Agentes: a })).sort((a, b) => a.horario.localeCompare(b.horario));
  }, [routes]);

  // ── Distribución capacidad (pie) ──
  const pieData = [
    { name: "Asignados", value: parseFloat(kpis.tasaOpt) || 0 },
    { name: "Disponible", value: Math.max(0, 100 - parseFloat(kpis.tasaOpt)) },
  ];

  // ── Ranking conductores (top 10) ──
  const topConductores = conductorData.slice(0, 10);
  const maxPax = topConductores[0]?.Pasajeros || 1;

  // ── Distribución por zonas (pie) ──
  const zonaPieData = zonaData.slice(0, 6);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary,#0f1117)" }}>
      <style>{`
        @keyframes fadeSlideUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes pulseGreen { 0%,100%{opacity:1} 50%{opacity:0.55} }
      `}</style>

      {/* ─── Navbar ─── */}
      <nav style={{ position:"sticky", top:0, zIndex:100, background:"var(--bg-secondary)", borderBottom:"1px solid var(--border-color)", padding:"0 28px", display:"flex", alignItems:"center", justifyContent:"space-between", height:"60px", backdropFilter:"blur(10px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
          <img src="/logo.png" alt="Kapital" style={{height:"32px"}} onError={e=>e.target.style.display="none"} />
          <div>
            <div style={{fontWeight:700,fontSize:"0.95rem",color:"var(--text-primary)"}}>Panel Ejecutivo</div>
            <div style={{fontSize:"0.7rem",color:PALETTE.amber,fontWeight:700,letterSpacing:"0.6px"}}>GERENTE DE OPERACIONES</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          {lastUpdated && <span style={{fontSize:"0.73rem",color:"var(--text-secondary)"}}>Actualizado: {lastUpdated.toLocaleTimeString()}</span>}
          <button onClick={loadRoutes} style={{ padding:"7px 14px", borderRadius:"8px", border:"1px solid var(--border-color)", background:"transparent", color:"var(--text-secondary)", cursor:"pointer", fontSize:"0.82rem", fontWeight:600 }}>🔄 Actualizar</button>
          <div style={{ width:"36px", height:"36px", borderRadius:"50%", background:`linear-gradient(135deg, ${PALETTE.amber}, #f97316)`, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:700, fontSize:"0.9rem" }}>{usuario?.nombre?.charAt(0)?.toUpperCase()||"G"}</div>
          <div>
            <div style={{fontSize:"0.85rem",fontWeight:600,color:"var(--text-primary)"}}>{usuario?.nombre}</div>
            <div style={{fontSize:"0.7rem",color:"var(--text-secondary)"}}>{usuario?.email}</div>
          </div>
          <button onClick={onLogout} style={{ marginLeft:"8px", padding:"7px 14px", borderRadius:"8px", border:"1px solid #ef444444", background:"rgba(239,68,68,0.08)", color:"#ef4444", cursor:"pointer", fontSize:"0.82rem", fontWeight:600 }}>Cerrar Sesión</button>
        </div>
      </nav>

      {/* ─── Main ─── */}
      <main style={{ maxWidth:"1440px", margin:"0 auto", padding:"28px 24px" }}>

        {/* Title */}
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:"12px", marginBottom:"28px", animation:"fadeSlideUp 0.4s ease both" }}>
          <div>
            <h1 style={{ margin:"0 0 4px", fontSize:"1.55rem", fontWeight:800, color:"var(--text-primary)" }}>Panel de Operaciones Ejecutivo 📊</h1>
            <p style={{ margin:0, color:"var(--text-secondary)", fontSize:"0.88rem" }}>Vista de alto nivel — Información en tiempo real de todas las operaciones de transporte</p>
          </div>
          {routes.length > 0 && (
            <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
              <InfoBadge label="Zonas" value={kpis.zonasUnicas} color={PALETTE.cyan} />
              <InfoBadge label="Turnos" value={kpis.turnosUnicos} color={PALETTE.amber} />
              <InfoBadge label="Prom/Ruta" value={kpis.promPorRuta} color={PALETTE.purple} />
            </div>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign:"center", padding:"80px 24px" }}>
            <div style={{ fontSize:"2.5rem", animation:"spin 1s linear infinite", display:"inline-block" }}>⚙️</div>
            <p style={{ color:"var(--text-secondary)", marginTop:"16px" }}>Cargando datos de operaciones…</p>
          </div>
        ) : routes.length === 0 ? (
          <div style={{ background:"var(--bg-secondary)", border:"1px solid var(--border-color)", borderRadius:"16px", textAlign:"center", padding:"80px 24px" }}>
            <div style={{ fontSize:"3.5rem", marginBottom:"16px" }}>📊</div>
            <h3 style={{ margin:"0 0 8px", color:"var(--text-primary)", fontWeight:700 }}>Sin datos disponibles</h3>
            <p style={{ margin:"0 auto", fontSize:"0.88rem", color:"var(--text-secondary)", maxWidth:"380px" }}>
              El Administrador debe cargar el Excel con los pasajeros, generar las rutas, y hacer clic en <strong>"🔒 Guardar Sesión"</strong> para que los datos sean visibles aquí.
            </p>
          </div>
        ) : (
          <>
            {/* ── KPI Cards ── */}
            <div style={{ display:"flex", gap:"14px", flexWrap:"wrap", marginBottom:"22px" }}>
              <StatCard title="Total Pasajeros" value={kpis.totalAgentes.toLocaleString()} subtitle="Asignados en todas las rutas" icon="👥" color={PALETTE.cyan} delay={0} />
              <StatCard title="Flota Activa" value={kpis.flotaActiva} subtitle={`Capacidad total: ${kpis.capacidadTotal.toLocaleString()} pax`} icon="🚐" color={PALETTE.green} delay={0.05} />
              <StatCard title="Rutas Programadas" value={kpis.rutasProg} subtitle={`${kpis.turnosUnicos} turno(s) activo(s)`} icon="🗺️" color={PALETTE.amber} delay={0.1} />
              <StatCard title="Optimización" value={`${kpis.tasaOpt}%`} subtitle="Capacidad utilizada" icon="⚡" color={PALETTE.purple} delay={0.15} />
              <StatCard title="Rutas Completas" value={kpis.rutasFull} subtitle="Con 15 pasajeros (máx.)" icon="✅" color={PALETTE.green} delay={0.2} />
              <StatCard title="Zonas Cubiertas" value={kpis.zonasUnicas} subtitle="Micro-zonas operativas" icon="📍" color={PALETTE.pink} delay={0.25} />
              {kpis.sinAsignar > 0 && <StatCard title="Sin Asignar" value={kpis.sinAsignar} subtitle="Requieren atención urgente" icon="⚠️" color={PALETTE.red} delay={0.3} />}
            </div>

            {/* ── Row 1: Pasajeros por Conductor + Eficiencia ── */}
            <div style={{ display:"flex", gap:"18px", flexWrap:"wrap", marginBottom:"18px" }}>
              <ChartCard
                title="Pasajeros por Conductor"
                subtitle={`Mostrando ${conductorPage * COND_PER_PAGE + 1}–${Math.min((conductorPage + 1) * COND_PER_PAGE, conductorData.length)} de ${conductorData.length} conductores`}
                style={{ flex:"2 1 500px", minWidth:"320px" }}
                action={
                  <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                    <button onClick={() => setConductorPage(p => Math.max(0, p - 1))} disabled={conductorPage === 0}
                      style={{ width:"28px", height:"28px", borderRadius:"6px", border:"1px solid var(--border-color)", background:"transparent", color:conductorPage===0?"var(--text-secondary)":"var(--text-primary)", cursor:conductorPage===0?"not-allowed":"pointer", fontSize:"0.9rem" }}>‹</button>
                    <span style={{ fontSize:"0.75rem", color:"var(--text-secondary)" }}>{conductorPage + 1}/{totalPages}</span>
                    <button onClick={() => setConductorPage(p => Math.min(totalPages - 1, p + 1))} disabled={conductorPage >= totalPages - 1}
                      style={{ width:"28px", height:"28px", borderRadius:"6px", border:"1px solid var(--border-color)", background:"transparent", color:conductorPage>=totalPages-1?"var(--text-secondary)":"var(--text-primary)", cursor:conductorPage>=totalPages-1?"not-allowed":"pointer", fontSize:"0.9rem" }}>›</button>
                  </div>
                }>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={conductorPageData} margin={{ top:4, right:16, left:-10, bottom:30 }}>
                    <XAxis dataKey="name" tick={{ fontSize:9, fill:"var(--text-secondary)" }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize:10, fill:"var(--text-secondary)" }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{fontSize:"11px"}} />
                    <Bar dataKey="Pasajeros" fill={PALETTE.primary} radius={[4,4,0,0]} />
                    <Bar dataKey="Disponible" fill="#1e2a3a" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <div style={{ flex:"1 1 240px", minWidth:"220px", display:"flex", flexDirection:"column", gap:"18px" }}>
                <ChartCard title="Eficiencia Global" subtitle="Capacidad total utilizada">
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                    <ResponsiveContainer width="100%" height={160}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={72} dataKey="value" strokeWidth={0}>
                          <Cell fill={PALETTE.green} />
                          <Cell fill="#1e2433" />
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ textAlign:"center", marginTop:"-4px" }}>
                      <div style={{ fontSize:"2rem", fontWeight:800, color:PALETTE.green }}>{kpis.tasaOpt}%</div>
                      <div style={{ fontSize:"0.75rem", color:"var(--text-secondary)" }}>Ocupación</div>
                    </div>
                  </div>
                </ChartCard>

                <ChartCard title="Distribución por Zonas" subtitle="Top 6 micro-zonas">
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={zonaPieData} dataKey="Agentes" nameKey="zona" cx="50%" cy="50%" outerRadius={60} strokeWidth={0}>
                        {zonaPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                      <Legend iconSize={8} wrapperStyle={{fontSize:"10px"}} formatter={v => <span style={{color:"var(--text-secondary)"}}>{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            </div>

            {/* ── Row 2: Micro-Zona + Horario ── */}
            <div style={{ display:"flex", gap:"18px", flexWrap:"wrap", marginBottom:"18px" }}>
              <ChartCard title="Agentes por Micro-Zona" subtitle="Distribución geográfica completa de pasajeros" style={{ flex:"1 1 320px", minWidth:"280px" }}>
                <ResponsiveContainer width="100%" height={Math.max(200, zonaData.length * 28)}>
                  <BarChart data={zonaData} layout="vertical" margin={{ top:0, right:20, left:100, bottom:0 }}>
                    <XAxis type="number" tick={{fontSize:10,fill:"var(--text-secondary)"}} />
                    <YAxis type="category" dataKey="zona" tick={{fontSize:10,fill:"var(--text-secondary)"}} width={100} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="Agentes" fill={PALETTE.cyan} radius={[0,4,4,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Pasajeros por Turno Horario" subtitle="Total de pasajeros asignados por turno" style={{ flex:"1 1 280px", minWidth:"240px" }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={horarioData} margin={{ top:4, right:16, left:-10, bottom:0 }}>
                    <XAxis dataKey="horario" tick={{fontSize:10,fill:"var(--text-secondary)"}} />
                    <YAxis tick={{fontSize:10,fill:"var(--text-secondary)"}} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="Agentes" fill={PALETTE.amber} radius={[4,4,0,0]}>
                      {horarioData.map((_, i) => <Cell key={i} fill={[PALETTE.amber, PALETTE.primary, PALETTE.cyan, PALETTE.pink][i % 4]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {/* Summary badges per turn */}
                <div style={{ marginTop:"12px", display:"flex", flexWrap:"wrap" }}>
                  {horarioData.map((h, i) => (
                    <InfoBadge key={i} label={h.horario} value={`${h.Agentes} pax`} color={[PALETTE.amber, PALETTE.primary, PALETTE.cyan, PALETTE.pink][i % 4]} />
                  ))}
                </div>
              </ChartCard>
            </div>

            {/* ── Row 3: Ranking Top Conductores ── */}
            <ChartCard
              title="🏆 Ranking de Conductores"
              subtitle={`Top 10 por carga asignada de ${conductorData.length} conductores totales`}
              style={{ marginBottom:"18px" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                {topConductores.map((c, i) => (
                  <div key={c.name} style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                    <div style={{
                      width:"30px", height:"30px", borderRadius:"8px", flexShrink:0,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      background: i < 3 ? `${[PALETTE.amber,"#9ca3af","#cd7f32"][i]}20` : "var(--bg-primary)",
                      border: `1px solid ${i < 3 ? [PALETTE.amber,"#9ca3af","#cd7f32"][i] : "var(--border-color)"}44`,
                      color: i < 3 ? [PALETTE.amber,"#9ca3af","#cd7f32"][i] : "var(--text-secondary)",
                      fontSize:"0.72rem", fontWeight:700,
                    }}>#{i+1}</div>
                    <div style={{ width:"130px", flexShrink:0 }}>
                      <div style={{ fontWeight:600, fontSize:"0.85rem", color:"var(--text-primary)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.name}</div>
                      <div style={{ fontSize:"0.7rem", color:"var(--text-secondary)" }}>{c.Rutas} ruta{c.Rutas!==1?"s":""}</div>
                    </div>
                    <ProgressBar value={c.Pasajeros} max={maxPax} color={i<3?[PALETTE.amber,"#9ca3af","#cd7f32"][i]:PALETTE.primary} />
                    <div style={{ width:"56px", flexShrink:0, textAlign:"right" }}>
                      <span style={{ fontWeight:700, fontSize:"0.9rem", color:"var(--text-primary)" }}>{c.Pasajeros}</span>
                      <span style={{ fontSize:"0.67rem", color:"var(--text-secondary)", fontWeight:400 }}> pax</span>
                    </div>
                    <div style={{ width:"46px", flexShrink:0, textAlign:"right" }}>
                      <span style={{ fontSize:"0.72rem", color: c.Disponible > 0 ? PALETTE.amber : PALETTE.green, fontWeight:600 }}>
                        {c.Disponible > 0 ? `+${c.Disponible}` : "✓ Full"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </ChartCard>

            {/* ── Summary table ── */}
            <ChartCard title="📋 Resumen Operativo Completo" subtitle="Todas las rutas y métricas clave" style={{ marginBottom:"18px" }}>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"separate", borderSpacing:"0 4px" }}>
                  <thead>
                    <tr>
                      {["Conductor","Micro-Zona","Horario","Pasajeros","Ocupación","Estado"].map(h => (
                        <th key={h} style={{ padding:"8px 12px", fontSize:"10px", fontWeight:700, letterSpacing:"1px", textTransform:"uppercase", color:"var(--text-secondary)", textAlign:"left", borderBottom:"2px solid var(--border-color)", whiteSpace:"nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {routes.map((r, i) => {
                      const pct = Math.round((r.agentes.length / 15) * 100);
                      const statusColor = r.agentes.length >= 15 ? PALETTE.green : r.agentes.length >= 10 ? PALETTE.amber : PALETTE.red;
                      const statusText = r.agentes.length >= 15 ? "Completo" : r.agentes.length >= 10 ? "Bueno" : "Bajo";
                      return (
                        <tr key={i}
                          style={{ transition:"background 0.15s" }}
                          onMouseEnter={e => e.currentTarget.style.background="var(--bg-primary)"}
                          onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                          <td style={{ padding:"10px 12px", fontSize:"0.83rem", color:"var(--text-primary)", fontWeight:600, whiteSpace:"nowrap", borderRadius:"8px 0 0 8px" }}>{r.conductor}</td>
                          <td style={{ padding:"10px 12px", fontSize:"0.83rem", color:"var(--text-secondary)" }}>{r.micro_zona}</td>
                          <td style={{ padding:"10px 12px", fontSize:"0.83rem" }}><span style={{ padding:"3px 8px", borderRadius:"20px", fontSize:"11px", fontWeight:600, color:PALETTE.amber, background:"rgba(245,158,11,0.12)", border:"1px solid rgba(245,158,11,0.3)" }}>{r.horario}</span></td>
                          <td style={{ padding:"10px 12px", fontSize:"0.88rem", fontWeight:700, color:"var(--text-primary)" }}>{r.agentes.length}<span style={{fontSize:"0.7rem",color:"var(--text-secondary)",fontWeight:400}}>/15</span></td>
                          <td style={{ padding:"10px 12px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                              <ProgressBar value={r.agentes.length} max={15} color={statusColor} />
                              <span style={{ fontSize:"0.75rem", fontWeight:600, color:statusColor, width:"34px" }}>{pct}%</span>
                            </div>
                          </td>
                          <td style={{ padding:"10px 12px", borderRadius:"0 8px 8px 0" }}>
                            <span style={{ padding:"3px 9px", borderRadius:"20px", fontSize:"11px", fontWeight:700, color:statusColor, background:`${statusColor}15`, border:`1px solid ${statusColor}40` }}>{statusText}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop:"12px", fontSize:"0.78rem", color:"var(--text-secondary)", textAlign:"right" }}>
                Total: {routes.length} rutas · {kpis.totalAgentes.toLocaleString()} pasajeros
              </div>
            </ChartCard>

            {/* ── Status Footer ── */}
            <div style={{ padding:"14px 20px", borderRadius:"12px", background:"rgba(16,185,129,0.06)", border:"1px solid rgba(16,185,129,0.2)", display:"flex", alignItems:"center", gap:"10px", fontSize:"0.82rem", color:"var(--text-secondary)" }}>
              <span style={{ width:"8px", height:"8px", borderRadius:"50%", background:PALETTE.green, boxShadow:`0 0 8px ${PALETTE.green}`, flexShrink:0, animation:"pulseGreen 2s infinite" }} />
              <span>Sistema operativo — <strong style={{color:"var(--text-primary)"}}>{kpis.rutasProg}</strong> rutas activas · <strong style={{color:"var(--text-primary)"}}>{kpis.totalAgentes.toLocaleString()}</strong> pasajeros · <strong style={{color:"var(--text-primary)"}}>{kpis.flotaActiva}</strong> vehículos en flota.</span>
              {lastUpdated && <span style={{marginLeft:"auto"}}>{lastUpdated.toLocaleString()}</span>}
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default GerentePortal;
