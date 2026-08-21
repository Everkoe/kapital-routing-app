import React, { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://kapital-routing-app.vercel.app/api";
const LOCAL_API_BASE = "http://localhost:8000/api";

const CopilotChat = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: '¡Hola! Soy Kapitalito, tu asistente de Inteligencia Artificial 🤖. ¿En qué puedo ayudarte hoy con la logística de tus rutas?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const toggleChat = () => setIsOpen(!isOpen);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user', text: input };
    const currentHistory = [...messages];
    
    setMessages([...messages, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const apiUrl = window.location.hostname === 'localhost' ? LOCAL_API_BASE : '/api';
      
      const response = await fetch(`${apiUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.text,
          history: currentHistory.slice(1) // Omitimos el primer mensaje.
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Error de red en servidor');
      }

      const data = await response.json();
      if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', text: `Debug Info: ${data.detail}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: data.response }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Ups, tuve un problema: ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, initialX: 0, initialY: 0, isDragging: false });
  const [isDismissed, setIsDismissed] = useState(false);

  const handlePointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current.isDragging = true;
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    dragRef.current.initialX = position.x;
    dragRef.current.initialY = position.y;
    setIsDragging(false);
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.isDragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      setIsDragging(true);
    }
    
    setPosition({
      x: dragRef.current.initialX + dx,
      y: dragRef.current.initialY + dy
    });
  };

  const handlePointerUp = (e) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current.isDragging = false;
  };

  const handleToggleClick = () => {
    if (!isDragging) {
      setIsOpen(!isOpen);
    }
  };

  if (isDismissed) return null;

  return (
    <>
      <div style={{
        position: 'fixed', bottom: '30px', right: '30px', zIndex: 9999,
        transform: `translate(${position.x}px, ${position.y}px)`,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end'
      }}>
        {!isOpen && (
          <button 
            onClick={() => setIsDismissed(true)}
            style={{
              position: 'absolute', top: '-6px', right: '-6px',
              width: '22px', height: '22px', borderRadius: '50%',
              backgroundColor: '#ef4444', color: 'white', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', fontSize: '11px', fontWeight: 'bold',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)', zIndex: 10000,
              padding: 0
            }}
            title="Ocultar asistente"
          >
            ✕
          </button>
        )}
        <div 
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={handleToggleClick}
          style={{
            width: '60px', height: '60px', borderRadius: '50%',
            backgroundColor: '#38bdf8', color: 'white', display: 'flex',
            alignItems: 'center', justifyContent: 'center', 
            cursor: isDragging ? 'grabbing' : 'grab',
            boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
            transition: isDragging ? 'none' : 'transform 0.3s ease',
            transform: isOpen ? 'scale(0)' : 'scale(1)',
            touchAction: 'none'
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
      </div>

      <div style={{
        position: 'fixed', bottom: '100px', right: '30px', zIndex: 9999,
        width: '360px', height: '550px', backgroundColor: 'var(--kapital-card-bg, #ffffff)',
        borderRadius: '20px', boxShadow: '0 15px 40px rgba(0,0,0,0.25)',
        display: isOpen ? 'flex' : 'none', flexDirection: 'column',
        overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)',
        fontFamily: 'system-ui, sans-serif'
      }}>
        <div style={{
          padding: '20px', background: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)', color: 'white',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
             <span style={{fontSize: '1.4rem', backgroundColor: 'rgba(255,255,255,0.2)', padding: '8px', borderRadius: '50%'}}>🤖</span>
             <div>
               <h3 style={{margin: 0, fontSize: '1.1rem', fontWeight: '700', letterSpacing: '0.5px'}}>Kapitalito</h3>
               <span style={{fontSize: '0.75rem', opacity: 0.8}}>Asistente Virtual</span>
             </div>
          </div>
          <button onClick={toggleChat} style={{background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s'}} onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'} onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}>✕</button>
        </div>

        <div style={{
          flex: 1, padding: '20px', overflowY: 'auto', display: 'flex',
          flexDirection: 'column', gap: '18px', backgroundColor: 'var(--kapital-bg, #f1f5f9)'
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              backgroundColor: msg.role === 'user' ? 'linear-gradient(135deg, #10B981 0%, #34d399 100%)' : 'var(--kapital-card-bg, #ffffff)',
              background: msg.role === 'user' ? 'linear-gradient(135deg, #10B981 0%, #34d399 100%)' : 'var(--kapital-card-bg, #ffffff)',
              color: msg.role === 'user' ? 'white' : 'var(--kapital-text, inherit)',
              padding: '12px 16px', borderRadius: '16px',
              borderBottomRightRadius: msg.role === 'user' ? '4px' : '16px',
              borderBottomLeftRadius: msg.role === 'assistant' ? '4px' : '16px',
              maxWidth: '85%', fontSize: '0.95rem',
              boxShadow: '0 4px 10px rgba(0,0,0,0.06)',
              border: msg.role === 'assistant' ? '1px solid var(--kapital-border, rgba(0,0,0,0.05))' : 'none',
              lineHeight: '1.5'
            }}>
              {msg.text}
            </div>
          ))}
          
          {isLoading && (
            <div style={{
              alignSelf: 'flex-start', padding: '12px 16px', borderRadius: '16px', borderBottomLeftRadius: '4px',
              backgroundColor: 'var(--kapital-card-bg, #ffffff)', border: '1px solid var(--kapital-border, rgba(0,0,0,0.05))',
              color: 'var(--kapital-text-secondary, #64748b)', fontSize: '0.9rem', display: 'flex', gap: '6px',
              boxShadow: '0 4px 10px rgba(0,0,0,0.06)'
            }}>
              <span className="typing-dot" style={{animation: 'blink 1.4s infinite both', animationDelay: '0s', width: '6px', height: '6px', backgroundColor: '#38bdf8', borderRadius: '50%'}}></span>
              <span className="typing-dot" style={{animation: 'blink 1.4s infinite both', animationDelay: '0.2s', width: '6px', height: '6px', backgroundColor: '#38bdf8', borderRadius: '50%'}}></span>
              <span className="typing-dot" style={{animation: 'blink 1.4s infinite both', animationDelay: '0.4s', width: '6px', height: '6px', backgroundColor: '#38bdf8', borderRadius: '50%'}}></span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={sendMessage} style={{
          display: 'flex', padding: '20px', borderTop: '1px solid var(--kapital-border, rgba(0,0,0,0.05))',
          backgroundColor: 'var(--kapital-card-bg, #ffffff)', gap: '12px', alignItems: 'center'
        }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pregúntale a Kapitalito..."
            disabled={isLoading}
            style={{
              flex: 1, padding: '12px 18px', borderRadius: '24px',
              border: '1px solid var(--kapital-border, rgba(0,0,0,0.1))',
              backgroundColor: 'var(--kapital-bg, #f8fafc)',
              color: 'var(--kapital-text, inherit)', fontSize: '0.95rem',
              outline: 'none', transition: 'border 0.2s, box-shadow 0.2s'
            }}
            onFocus={(e) => {
              e.target.style.border = '1px solid #38bdf8';
              e.target.style.boxShadow = '0 0 0 3px rgba(56, 189, 248, 0.2)';
            }}
            onBlur={(e) => {
              e.target.style.border = '1px solid var(--kapital-border, rgba(0,0,0,0.1))';
              e.target.style.boxShadow = 'none';
            }}
          />
          <button 
            type="submit" 
            disabled={isLoading || !input.trim()}
            style={{
              backgroundColor: input.trim() ? '#38bdf8' : 'var(--kapital-border, #e2e8f0)',
              color: 'white', border: 'none', borderRadius: '50%',
              width: '44px', height: '44px', display: 'flex',
              alignItems: 'center', justifyContent: 'center', cursor: input.trim() ? 'pointer' : 'default',
              transition: 'background-color 0.2s, transform 0.2s',
              transform: input.trim() ? 'scale(1)' : 'scale(0.95)',
              boxShadow: input.trim() ? '0 4px 10px rgba(56, 189, 248, 0.3)' : 'none'
            }}
            onMouseOver={e => input.trim() && (e.currentTarget.style.transform = 'scale(1.05)')}
            onMouseOut={e => input.trim() && (e.currentTarget.style.transform = 'scale(1)')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>
      </div>
      <style>
        {`
          @keyframes blink {
            0% { opacity: 0.2; transform: scale(0.8); }
            20% { opacity: 1; transform: scale(1); }
            100% { opacity: 0.2; transform: scale(0.8); }
          }
        `}
      </style>
    </>
  );
};

export default CopilotChat;
