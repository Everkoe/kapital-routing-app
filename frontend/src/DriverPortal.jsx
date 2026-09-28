import React, { useState, useEffect, useRef, useCallback } from 'react';
import DriverOnboardingWizard from './components/DriverOnboardingWizard';
import DocumentResubmission from './components/DocumentResubmission';
import { documentoEntregado, documentosRequeridos } from './constants/camposOnboarding';
import ServiciosConductor from './conductor/ServiciosConductor';
import { Bell, ChevronLeft, FileText, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { apiFetch } from './utils/apiClient';
import './App.css';

const DRIVER_POLL_INTERVAL_MS = 90_000;
const DRIVER_POLL_BACKOFF_BASE_MS = 60_000;
const DRIVER_POLL_BACKOFF_MAX_MS = 10 * 60_000;
const DRIVER_REQUEST_TIMEOUT_MS = 12_000;
const DRIVER_POLL_ACTIVITY_COOLDOWN_MS = 15_000;
const RETRYABLE_POLL_STATUS_CODES = new Set([402, 408, 429, 500, 502, 503, 504]);
// En Vercel el WebSocket no llega a abrirse nunca: una función serverless no
// mantiene conexiones y `/ws/…` devuelve la página. Reintentarlo cada 30 s
// solo gastaba peticiones, así que tras unos intentos sin abrir ni una vez se
// deja de probar y los avisos llegan por el sondeo. Donde sí abre (en local),
// una vez abierto se reintenta siempre, como antes.
const WS_MAX_INTENTOS_SIN_ABRIR = 3;

const fetchWithTimeout = async (url, options = {}, timeoutMs = DRIVER_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

// Los avisos de Administración, con la misma forma que el resto de la pantalla.
// Se ven los más recientes; el resto, a un toque.
const AVISOS_VISIBLES = 3;

const AvisosDelConductor = ({ notificaciones, onLeida }) => {
  const [todos, setTodos] = useState(false);
  if (!notificaciones.length) return null;
  const visibles = todos ? notificaciones : notificaciones.slice(0, AVISOS_VISIBLES);
  return (
    <section aria-label="Avisos de la central">
      {visibles.map((aviso) => (
        <div key={aviso.id} className="cd-aviso">
          <Bell size={18} />
          <span>
            <strong>{aviso.titulo || 'Aviso de la central'}</strong>
            {aviso.mensaje}
          </span>
          <button type="button" className="cd-aviso-cerrar" onClick={() => onLeida(aviso.id)}
                  aria-label="Marcar como leído">
            <X size={18} />
          </button>
        </div>
      ))}
      {notificaciones.length > AVISOS_VISIBLES && (
        <button type="button" className="cd-deshacer" onClick={() => setTodos(!todos)}>
          {todos ? 'Ver menos' : `Ver los ${notificaciones.length} avisos`}
        </button>
      )}
    </section>
  );
};

// Los documentos pendientes, sin cerrarle el paso: un conductor con unidad
// asignada ya trabaja para la empresa (los importados de las bases entran sin
// ningún documento subido), así que ve sus servicios y aquí se le recuerda qué
// le falta. Los sube él o Administración en su nombre.
const AvisoDeDocumentos = ({ faltan, observados, enRevision, onAbrir }) => {
  if (!faltan && !observados && !enRevision) return null;
  let titulo = 'Tus documentos están en revisión';
  if (observados) titulo = 'Tienes documentos observados';
  else if (faltan) titulo = faltan === 1 ? 'Te falta 1 documento' : `Te faltan ${faltan} documentos`;
  const detalle = observados || faltan
    ? 'Súbelos para completar tu registro. Mientras tanto puedes trabajar con normalidad.'
    : 'Administración los está revisando.';
  return (
    <div className="cd-aviso cd-aviso--ambar">
      <FileText size={18} />
      <span>
        <strong>{titulo}</strong>
        {detalle}
      </span>
      <button type="button" className="cd-boton cd-boton--ambar" onClick={onAbrir}>
        {observados || faltan ? 'Subir' : 'Ver'}
      </button>
    </div>
  );
};

const DriverPortal = ({ usuario, setUsuarioActual }) => {
  const [notificaciones, setNotificaciones] = useState(() => {
    try {
      const stored = localStorage.getItem(`kapital_notifs_${usuario?.identifier || usuario?.email}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  
  useEffect(() => {
    if (usuario) {
      localStorage.setItem(`kapital_notifs_${usuario.identifier || usuario.email}`, JSON.stringify(notificaciones));
    }
  }, [notificaciones, usuario]);

  // Si el usuario ya está en revisión, su perfil está completo
  const [profileComplete, setProfileComplete] = useState(usuario.profileComplete || usuario.estado === 'Pendiente Revisión' || false);
  // Solo cuenta para quien tiene unidad: sin ella, los documentos son su pantalla.
  const [verDocumentos, setVerDocumentos] = useState(false);

  // --- WebSocket en tiempo real (reemplaza el polling) ---
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const wsHeartbeatRef = useRef(null);
  const wsIntentionalCloseRef = useRef(false);
  const connectWebSocketRef = useRef(null);
  const lastKnownNotifCountRef = useRef(-1); // -1 = not initialized yet
  const wsConnectedRef = useRef(false);
  const wsAbiertoAlgunaVezRef = useRef(false);
  const wsDescartadoRef = useRef(false);
  const pollTimerRef = useRef(null);
  const pollAbortRef = useRef(null);
  const [webSocketConnected, setWebSocketConnected] = useState(false);

  const usuarioRef = useRef(usuario);
  useEffect(() => {
    usuarioRef.current = usuario;
  }, [usuario]);

  const closeWebSocket = useCallback(() => {
    wsIntentionalCloseRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsHeartbeatRef.current) {
      clearInterval(wsHeartbeatRef.current);
      wsHeartbeatRef.current = null;
    }
    const currentSocket = wsRef.current;
    wsRef.current = null;
    wsConnectedRef.current = false;
    if (currentSocket) {
      currentSocket.onclose = null;
      currentSocket.onerror = null;
      currentSocket.close();
    }
    setWebSocketConnected(false);
  }, []);

  const connectWebSocket = useCallback(() => {
    const userKey = usuarioRef.current?.identifier || usuarioRef.current?.email;
    if (!userKey || typeof window === 'undefined' || typeof WebSocket === 'undefined' || document.hidden) return;
    if (wsDescartadoRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    // Usar ws:// o wss:// según el protocolo de la página
    wsIntentionalCloseRef.current = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${encodeURIComponent(userKey)}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (ws !== wsRef.current || wsIntentionalCloseRef.current || document.hidden) {
        ws.close();
        return;
      }
      console.log('[WS] Conectado al servidor en tiempo real');
      wsAbiertoAlgunaVezRef.current = true;
      reconnectAttemptsRef.current = 0;
      // Heartbeat ping cada 30s para mantener la conexión viva
      if (wsHeartbeatRef.current) clearInterval(wsHeartbeatRef.current);
      wsHeartbeatRef.current = setInterval(() => {
        if (!document.hidden && ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 30000);
      wsConnectedRef.current = true;
      setWebSocketConnected(true);
    };

    ws.onmessage = (event) => {
      if (event.data === 'pong') return;
      try {
        const msg = JSON.parse(event.data);

        if (msg.tipo === 'notificacion') {
          // Aviso del admin (mensaje libre)
          toast(msg.mensaje, { icon: '🔔', duration: 6000 });
          setNotificaciones(prev => [{ ...msg, leido: false }, ...prev]);
        }

        else if (msg.tipo === 'documento_revisado') {
          // Un documento fue aprobado o rechazado
          if (msg.estado === 'aprobado') {
            toast.success(`✅ ${msg.campo}: Documento aprobado`, { duration: 5000 });
          } else {
            toast.error(`❌ ${msg.campo}: Documento rechazado${msg.nota ? ' — ' + msg.nota : ''}`, { duration: 7000 });
          }
          setNotificaciones(prev => [{
            id: Date.now(),
            tipo: 'documento_revisado',
            titulo: msg.titulo,
            mensaje: msg.mensaje,
            campo: msg.campo,
            estado: msg.estado,
            fecha: msg.fecha,
            leido: false
          }, ...prev]);
          // Recargar perfil para obtener el estado actualizado
          const userKeyProfile = usuarioRef.current?.identifier || usuarioRef.current?.email;
          if (userKeyProfile) {
            fetchWithTimeout(`/api/user/profile?email=${encodeURIComponent(userKeyProfile)}`)
              .then(r => r.ok ? r.json() : null)
              .then(data => {
                if (data) {
                  const currentUser = usuarioRef.current;
                  if (data.estado === 'Documentos Observados' && currentUser.estado !== 'Documentos Observados') {
                    toast.error('⚠️ Tienes documentos observados. Por favor, revísalos.', { duration: 8000 });
                  }
                  if (data.estado === 'Activo' && currentUser.estado === 'Pendiente Revisión') {
                    toast.success('🎉 ¡Tu perfil ha sido aprobado!', { duration: 6000 });
                  }
                  const updatedUser = { ...currentUser, ...data };
                  localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
                  if (setUsuarioActual) setUsuarioActual(updatedUser);
                }
              })
              .catch(() => {});
          }
        }

        else if (msg.tipo === 'estado_actualizado') {
          // Estado general del usuario cambió
          const currentUser = usuarioRef.current;
          const updatedUser = { ...currentUser, estado: msg.estado };
          localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
          if (setUsuarioActual) setUsuarioActual(updatedUser);
          toast(msg.mensaje || `Tu estado cambió a: ${msg.estado}`, { icon: 'ℹ️' });
        }

      } catch (e) {
        console.warn('[WS] Error parseando mensaje:', e);
      }
    };

    ws.onclose = () => {
      if (ws !== wsRef.current) return;
      wsRef.current = null;
      if (wsHeartbeatRef.current) {
        clearInterval(wsHeartbeatRef.current);
        wsHeartbeatRef.current = null;
      }
      wsConnectedRef.current = false;
      setWebSocketConnected(false);
      console.log('[WS] Conexión cerrada, reintentando...');
      if (wsIntentionalCloseRef.current || document.hidden) return;
      if (!wsAbiertoAlgunaVezRef.current && reconnectAttemptsRef.current + 1 >= WS_MAX_INTENTOS_SIN_ABRIR) {
        wsDescartadoRef.current = true;
        return;
      }
      // Reconexión con backoff exponencial (máx 30s)
      const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 30000);
      reconnectAttemptsRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connectWebSocketRef.current?.();
      }, delay);
    };

    ws.onerror = (err) => {
      console.warn('[WS] Error de conexión:', err);
      ws.close();
    };
  }, [setUsuarioActual]);

  useEffect(() => {
    connectWebSocketRef.current = connectWebSocket;
    return () => {
      if (connectWebSocketRef.current === connectWebSocket) connectWebSocketRef.current = null;
    };
  }, [connectWebSocket]);

  useEffect(() => {
    const syncWebSocket = () => {
      if (document.hidden) {
        closeWebSocket();
      } else {
        connectWebSocket();
      }
    };

    syncWebSocket();
    document.addEventListener('visibilitychange', syncWebSocket);
    window.addEventListener('focus', syncWebSocket);
    return () => {
      document.removeEventListener('visibilitychange', syncWebSocket);
      window.removeEventListener('focus', syncWebSocket);
      closeWebSocket();
    };
  }, [closeWebSocket, connectWebSocket]);

  // --- Polling de respaldo para Vercel (solo cuando WebSocket no está conectado) ---
  useEffect(() => {
    const userKey = usuario?.identifier || usuario?.email;
    if (!userKey) return undefined;

    let disposed = false;
    let timerId = null;
    let inFlight = false;
    let backoffMs = 0;
    let lastRunAt = 0;
    lastKnownNotifCountRef.current = -1;

    const clearTimer = () => {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      pollTimerRef.current = null;
    };

    const schedule = (delay) => {
      if (disposed || document.hidden || webSocketConnected || wsConnectedRef.current) return;
      clearTimer();
      timerId = setTimeout(() => {
        timerId = null;
        pollTimerRef.current = null;
        runPoll();
      }, Math.max(0, delay));
      pollTimerRef.current = timerId;
    };

    const runPoll = async (force = false) => {
      if (disposed || document.hidden || webSocketConnected || wsConnectedRef.current || inFlight) return;
      if (!force && Date.now() - lastRunAt < DRIVER_POLL_ACTIVITY_COOLDOWN_MS) {
        schedule(DRIVER_POLL_INTERVAL_MS);
        return;
      }

      lastRunAt = Date.now();
      inFlight = true;
      const controller = new AbortController();
      pollAbortRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), DRIVER_REQUEST_TIMEOUT_MS);
      let nextDelay = DRIVER_POLL_INTERVAL_MS;

      try {
        const payload = await apiFetch(`/api/conductor/notifications?email=${encodeURIComponent(userKey)}`, {
          signal: controller.signal,
        });
        const allNotifs = Array.isArray(payload) ? payload : [];
        const unread = allNotifs.filter(notification => !notification.leido);

        if (lastKnownNotifCountRef.current === -1) {
          lastKnownNotifCountRef.current = allNotifs.length;
          if (unread.length > 0) setNotificaciones(unread);
        } else if (allNotifs.length > lastKnownNotifCountRef.current) {
          const newOnes = allNotifs.slice(0, allNotifs.length - lastKnownNotifCountRef.current);
          newOnes.forEach(notification => {
            toast(notification.mensaje || notification.titulo || 'Nueva notificación del administrador', { icon: '🔔', duration: 6000 });
          });
          lastKnownNotifCountRef.current = allNotifs.length;
          setNotificaciones(unread);
        } else if (allNotifs.length < lastKnownNotifCountRef.current) {
          // The server may have marked messages as read or compacted history.
          lastKnownNotifCountRef.current = allNotifs.length;
          setNotificaciones(unread);
        }
        backoffMs = 0;
      } catch (error) {
        // Un problema de sesión no es transitorio: reintentarlo solo repetiría
        // el 401 que el cliente HTTP ya convirtió en cierre de sesión.
        const isAuthError = error?.status === 401 || error?.status === 403;
        const isRetryable = error?.status === undefined
          || RETRYABLE_POLL_STATUS_CODES.has(error.status);
        if (!isAuthError && isRetryable && (error?.name !== 'AbortError' || !disposed)) {
          backoffMs = backoffMs > 0
            ? Math.min(backoffMs * 2, DRIVER_POLL_BACKOFF_MAX_MS)
            : DRIVER_POLL_BACKOFF_BASE_MS;
          nextDelay = backoffMs;
        }
      } finally {
        clearTimeout(timeoutId);
        if (pollAbortRef.current === controller) pollAbortRef.current = null;
        inFlight = false;
        if (!disposed && !document.hidden && !webSocketConnected && !wsConnectedRef.current) {
          schedule(nextDelay);
        }
      }
    };

    const wakePolling = () => {
      if (disposed || document.hidden || webSocketConnected || wsConnectedRef.current) return;
      if (Date.now() - lastRunAt < DRIVER_POLL_ACTIVITY_COOLDOWN_MS) {
        schedule(DRIVER_POLL_INTERVAL_MS);
        return;
      }
      clearTimer();
      runPoll(true);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
        pollAbortRef.current?.abort();
      } else {
        wakePolling();
      }
    };

    schedule(0);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', wakePolling);

    return () => {
      disposed = true;
      clearTimer();
      pollAbortRef.current?.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', wakePolling);
    };
  }, [usuario?.identifier, usuario?.email, webSocketConnected]);

  const markNotificationRead = async (id) => {
    try {
      await fetch('/api/conductor/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: usuario.email || usuario.identifier, notif_id: id })
      });
      setNotificaciones(prev => prev.filter(n => n.id !== id));
    } catch(e) {}
  };

  const handleProfileComplete = async (data) => {
    try {
      const response = await fetch('/api/driver/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: usuario.email || usuario.identifier, perfilData: data })
      });
      if (!response.ok) throw new Error('Error al enviar perfil');
      
      // Sin el perfil recién guardado, la pantalla siguiente lee el anterior y
      // da por faltante todo lo que el conductor acaba de subir.
      const updatedUser = { ...usuario, estado: 'Pendiente Revisión', perfil_conductor: data };
      localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
      if (setUsuarioActual) {
        setUsuarioActual(updatedUser);
      }
      setProfileComplete(true);
      toast.success("Perfil enviado para revisión.");
    } catch (error) {
      console.error(error);
      toast.error("Hubo un error al enviar tu perfil.");
    }
  };

  const handleResubmissionComplete = (data) => {
    const updatedUser = data.user || { ...usuario, estado: data.estado || 'Pendiente Revisión' };
    localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
    if (setUsuarioActual) {
      setUsuarioActual(updatedUser);
    }
    setVerDocumentos(false);
    toast.success("Documentos enviados para revisión.");
  };

  if (!profileComplete) {
    return (
      <main style={{ padding: '20px' }}>
        <DriverOnboardingWizard usuario={usuario} onComplete={handleProfileComplete} />
      </main>
    );
  }

  const REQUIRED_DOCS = documentosRequeridos();

  const docsQueFaltan = REQUIRED_DOCS.filter(key => {
    const hasDoc = documentoEntregado(key, usuario?.perfil_conductor);
    const isPendingOrRejected = usuario?.perfil_conductor?.revision_docs?.[key]?.estado;
    return !hasDoc && !isPendingOrRejected;
  }).length;
  const hasMissingDocs = docsQueFaltan > 0;

  const hasRejectedDocs = Object.values(usuario?.perfil_conductor?.revision_docs || {})
    .some(rev => rev.estado?.toLowerCase() === 'rechazado');

  const isPending = usuario?.estado === 'Pendiente Revisión' || usuario?.estado === 'Documentos Observados';

  const needsDocumentAction = hasMissingDocs || hasRejectedDocs || isPending;
  // La unidad la asigna Administración (al aprobar, o la importación): tenerla
  // es lo que dice que ya trabaja para la empresa.
  const tieneUnidad = Boolean(String(usuario?.unidad_id || '').trim());

  if (needsDocumentAction && (!tieneUnidad || verDocumentos)) {
    return (
      <main style={{ padding: '20px', minHeight: '100vh', background: 'var(--bg)' }}>
        {tieneUnidad && (
          <button type="button" className="cd-volver" onClick={() => setVerDocumentos(false)}>
            <ChevronLeft size={20} /> Mis servicios
          </button>
        )}
        <DocumentResubmission
          usuario={usuario}
          // With a live WebSocket, let the resubmission view perform only its
          // one-time notification hydration; recurring fallback polling stays
          // disabled. When the socket is unavailable, DriverPortal owns the
          // shared fallback result and passes it down.
          notifications={webSocketConnected ? undefined : notificaciones}
          onComplete={handleResubmissionComplete}
        />
      </main>
    );
  }

  // El plan del Programador: qué servicios tiene hoy y mañana, a quién recoge y
  // en qué orden, y dónde marca quién subió (ver `conductor/`).
  return (
    <ServiciosConductor
      usuario={usuario}
      avisos={(
        <>
          {needsDocumentAction && (
            <AvisoDeDocumentos
              faltan={docsQueFaltan}
              observados={hasRejectedDocs || usuario?.estado === 'Documentos Observados'}
              enRevision={usuario?.estado === 'Pendiente Revisión'}
              onAbrir={() => setVerDocumentos(true)}
            />
          )}
          <AvisosDelConductor notificaciones={notificaciones} onLeida={markNotificationRead} />
        </>
      )}
    />
  );
};

export default DriverPortal;
