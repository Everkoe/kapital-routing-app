import React, { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://kapital-routing-app.vercel.app/api";
const LOCAL_API_BASE = "http://localhost:8000/api";

const CopilotChat = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: '¡Hola! Soy Kapital Copilot, tu asistente de Inteligencia Artificial 🤖. ¿En qué puedo ayudarte hoy con la logística de tus rutas?' }
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

  return (
    <>
      <div 
        onClick={toggleChat}
        style={{
          position: 'fixed', bottom: '30px', right: '30px', zIndex: 9999,
          width: '60px', height: '60px', borderRadius: '50%',
          backgroundColor: '#38bdf8', color: 'white', display: 'flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
          transition: 'transform 0.3s ease',
          transform: isOpen ? 'scale(0)' : 'scale(1)'
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </div>

      <div style={{
        position: 'fixed', bottom: '100px', right: '30px', zIndex: 9999,
        width: '350px', height: '500px', backgroundColor: 'var(--kapital-card-bg, #ffffff)',
        borderRadius: '16px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
        display: isOpen ? 'flex' : 'none', flexDirection: 'column',
        overflow: 'hidden', border: '1px solid var(--kapital-border, #e2e8f0)',
        fontFamily: 'system-ui, sans-serif'
      }}>
        <div style={{
          padding: '15px 20px', backgroundColor: '#38bdf8', color: 'white',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
             <span style={{fontSize: '1.2rem'}}>🤖</span>
             <h3 style={{margin: 0, fontSize: '1.1rem', fontWeight: '600'}}>Kapital Copilot</h3>
          </div>
          <button onClick={toggleChat} style={{background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem'}}>✕</button>
        </div>

        <div style={{
          flex: 1, padding: '20px', overflowY: 'auto', display: 'flex',
          flexDirection: 'column', gap: '15px', backgroundColor: 'var(--kapital-bg, #f8fafc)'
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              backgroundColor: msg.role === 'user' ? '#10B981' : 'var(--kapital-card-bg, #ffffff)',
              color: msg.role === 'user' ? 'white' : 'var(--kapital-text, #1e293b)',
              padding: '10px 15px', borderRadius: '12px',
              borderBottomRightRadius: msg.role === 'user' ? '2px' : '12px',
              borderBottomLeftRadius: msg.role === 'assistant' ? '2px' : '12px',
              maxWidth: '85%', fontSize: '0.9rem',
              boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
              border: msg.role === 'assistant' ? '1px solid var(--kapital-border, #e2e8f0)' : 'none',
              lineHeight: '1.4'
            }}>
              {msg.text}
            </div>
          ))}
          
          {isLoading && (
            <div style={{
              alignSelf: 'flex-start', padding: '10px 15px', borderRadius: '12px',
              backgroundColor: 'var(--kapital-card-bg, #ffffff)', border: '1px solid var(--kapital-border, #e2e8f0)',
              color: 'var(--kapital-text-secondary, #64748b)', fontSize: '0.9rem', display: 'flex', gap: '5px'
            }}>
              <span className="typing-dot" style={{animation: 'blink 1.4s infinite both', animationDelay: '0s'}}>.</span>
              <span className="typing-dot" style={{animation: 'blink 1.4s infinite both', animationDelay: '0.2s'}}>.</span>
              <span className="typing-dot" style={{animation: 'blink 1.4s infinite both', animationDelay: '0.4s'}}>.</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={sendMessage} style={{
          display: 'flex', padding: '15px', borderTop: '1px solid var(--kapital-border, #e2e8f0)',
          backgroundColor: 'var(--kapital-card-bg, #ffffff)', gap: '10px'
        }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pregúntale a Copilot..."
            disabled={isLoading}
            style={{
              flex: 1, padding: '10px 15px', borderRadius: '20px',
              border: '1px solid var(--kapital-border, #e2e8f0)',
              outline: 'none', backgroundColor: 'var(--kapital-bg, #f8fafc)',
              color: 'var(--kapital-text, #1e293b)'
            }}
          />
          <button 
            type="submit" 
            disabled={isLoading || !input.trim()}
            style={{
              backgroundColor: '#38bdf8', color: 'white', border: 'none',
              borderRadius: '50%', width: '40px', height: '40px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: (isLoading || !input.trim()) ? 'not-allowed' : 'pointer',
              opacity: (isLoading || !input.trim()) ? 0.6 : 1
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>
        <style>{`
          @keyframes blink { 0% { opacity: 0.2; } 20% { opacity: 1; } 100% { opacity: 0.2; } }
        `}</style>
      </div>
    </>
  );
};

export default CopilotChat;
