import React from 'react';

export const GlobalLoader = ({ text = "Cargando..." }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px', width: '100%', height: '100%', minHeight: '300px', boxSizing: 'border-box' }}>
    <svg width="48" height="48" viewBox="0 0 48 48" style={{ margin: '0 auto', display: 'block' }}>
      <circle cx="24" cy="24" r="20" fill="none" strokeWidth="4" stroke="var(--kapital-nav-link-active)" strokeLinecap="round" strokeDasharray="90 35.66">
        <animate attributeName="stroke-dashoffset" from="0" to="-125.66" dur="1.2s" repeatCount="indefinite" />
      </circle>
      <circle cx="24" cy="24" r="12" fill="none" strokeWidth="4" stroke="var(--kapital-accent-green)" strokeLinecap="round" strokeDasharray="40 35.40">
        <animate attributeName="stroke-dashoffset" from="0" to="75.40" dur="0.8s" repeatCount="indefinite" />
      </circle>
    </svg>
    <p style={{ marginTop: '20px', color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: 500, animation: 'pulseText 1.5s infinite' }}>{text}</p>
  </div>
);

export default GlobalLoader;
