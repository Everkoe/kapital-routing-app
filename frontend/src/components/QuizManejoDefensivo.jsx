import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, AlertTriangle, ChevronRight, RotateCcw, Award } from 'lucide-react';

const PREGUNTAS = [
  {
    id: 1,
    categoria: 'A. NORMAS DE TRÁNSITO Y RESPONSABILIDAD',
    pregunta: 'Según el RNT, ¿cuál es la velocidad máxima en zona urbana para un taxi?',
    opciones: ['40 km/h', '50 km/h', '60 km/h', '80 km/h'],
    correcta: 1,
  },
  {
    id: 2,
    categoria: 'A. NORMAS DE TRÁNSITO Y RESPONSABILIDAD',
    pregunta: '¿A cuántos metros antes de cruzar una intersección debe usar las luces direccionales?',
    opciones: ['10 metros', '15 metros', '30 metros', '50 metros'],
    correcta: 2,
  },
  {
    id: 3,
    categoria: 'A. NORMAS DE TRÁNSITO Y RESPONSABILIDAD',
    pregunta: 'El semáforo está en amarillo intermitente. ¿Qué debe hacer el conductor de taxi?',
    opciones: ['Acelerar para pasar rápido', 'Detenerse obligatoriamente', 'Avanzar con precaución, cediendo el paso', 'Tocar claxon y pasar'],
    correcta: 2,
  },
  {
    id: 4,
    categoria: 'A. NORMAS DE TRÁNSITO Y RESPONSABILIDAD',
    pregunta: '¿Cuál es la distancia mínima de seguimiento o "regla de los 3 segundos" para manejo defensivo?',
    opciones: ['1 segundo', '2 segundos', '3 segundos', '5 segundos'],
    correcta: 2,
  },
  {
    id: 5,
    categoria: 'A. NORMAS DE TRÁNSITO Y RESPONSABILIDAD',
    pregunta: 'Al transportar pasajeros, ¿está permitido el uso de celular mientras conduce?',
    opciones: ['Sí, si es con manos libres', 'Sí, solo para contestar rápido', 'No, está prohibido. Multa M-20', 'Solo si el pasajero autoriza'],
    correcta: 2,
  },
  {
    id: 6,
    categoria: 'B. MANEJO DEFENSIVO Y PREVENCIÓN',
    pregunta: '¿Qué es "conducir a la defensiva"?',
    opciones: ['Manejar rápido para evitar accidentes', 'Prever y evitar accidentes a pesar de errores de otros', 'Solo respetar las señales de tránsito', 'Manejar solo de día'],
    correcta: 1,
  },
  {
    id: 7,
    categoria: 'B. MANEJO DEFENSIVO Y PREVENCIÓN',
    pregunta: 'Si un peatón cruza intempestivamente con luz roja, usted debe:',
    opciones: ['Frenar bruscamente y tocar claxon', 'Seguir porque tiene la preferencia', 'Frenar progresivamente y evitar el atropello', 'Esquivarlo sin reducir velocidad'],
    correcta: 2,
  },
  {
    id: 8,
    categoria: 'B. MANEJO DEFENSIVO Y PREVENCIÓN',
    pregunta: '¿Qué debe hacer ante un conductor agresivo que lo "cierra"?',
    opciones: ['Devolver la maniobra', 'Acelerar y ganarle', 'Ceder el paso, mantener distancia y evitar conflicto', 'Bajar a reclamar'],
    correcta: 2,
  },
  {
    id: 9,
    categoria: 'B. MANEJO DEFENSIVO Y PREVENCIÓN',
    pregunta: 'En lluvia, ¿qué técnica defensiva es correcta?',
    opciones: ['Frenar en seco y fuerte', 'Aumentar velocidad para pasar rápido los charcos', 'Reducir velocidad, aumentar distancia y evitar frenadas bruscas', 'Usar luces altas'],
    correcta: 2,
  },
  {
    id: 10,
    categoria: 'B. MANEJO DEFENSIVO Y PREVENCIÓN',
    pregunta: 'El "punto ciego" de un vehículo se elimina:',
    opciones: ['Solo con los espejos retrovisores', 'Volteando la cabeza para verificar antes de cambiar de carril', 'Tocando claxon', 'No existe en los taxis'],
    correcta: 1,
  },
  {
    id: 11,
    categoria: 'C. SEGURIDAD DEL PASAJERO Y SERVICIO',
    pregunta: 'Al recoger un pasajero, ¿dónde debe detenerse el taxi?',
    opciones: ['En segunda fila si hay tráfico', 'Al borde derecho de la calzada, sin obstruir', 'En medio de la pista', 'En paradero de bus'],
    correcta: 1,
  },
  {
    id: 12,
    categoria: 'C. SEGURIDAD DEL PASAJERO Y SERVICIO',
    pregunta: '¿Es obligatorio el uso de cinturón de seguridad para el pasajero en el asiento posterior?',
    opciones: ['No, solo para el conductor', 'Sí, es obligatorio para todos los ocupantes', 'Solo en carretera', 'Solo si lo pide el conductor'],
    correcta: 1,
  },
  {
    id: 13,
    categoria: 'C. SEGURIDAD DEL PASAJERO Y SERVICIO',
    pregunta: 'Un pasajero le pide ir a exceso de velocidad porque "tiene apuro". Usted:',
    opciones: ['Acelera porque el cliente manda', 'Explica que debe respetar límites por seguridad y norma', 'Cobra más por ir rápido', 'Apaga el taxímetro'],
    correcta: 1,
  },
  {
    id: 14,
    categoria: 'C. SEGURIDAD DEL PASAJERO Y SERVICIO',
    pregunta: 'Ante un accidente con heridos, ¿cuál es el primer paso según norma?',
    opciones: ['Mover a los heridos del lugar', 'Asegurar la zona, llamar a emergencias 105/106 y no mover heridos', 'Irse para evitar problemas', 'Negociar con el otro conductor'],
    correcta: 1,
  },
  {
    id: 15,
    categoria: 'C. SEGURIDAD DEL PASAJERO Y SERVICIO',
    pregunta: '¿Cada cuánto tiempo debe hacerse la Revisión Técnica a un taxi?',
    opciones: ['Cada 6 meses', 'Cada 12 meses', 'Cada 2 años', 'Solo cuando lo pide la ATU'],
    correcta: 1,
  },
  {
    id: 16,
    categoria: 'D. FACTORES DE RIESGO Y SALUD',
    pregunta: '¿Cuál es el límite de alcohol permitido para conducir en Perú?',
    opciones: ['0.3 g/L', '0.5 g/L', '0.8 g/L', '0.0 g/L para servicio público'],
    correcta: 1,
  },
  {
    id: 17,
    categoria: 'D. FACTORES DE RIESGO Y SALUD',
    pregunta: 'Manejar con más de 18 horas sin dormir equivale a:',
    opciones: ['Manejar normal', 'Manejar con 0.5 g/L de alcohol', 'Manejar con más de 0.8 g/L de alcohol', 'No afecta'],
    correcta: 2,
  },
  {
    id: 18,
    categoria: 'D. FACTORES DE RIESGO Y SALUD',
    pregunta: '¿Qué efecto tiene el uso de audífonos mientras conduce?',
    opciones: ['Ninguno', 'Mejora la concentración', 'Reduce capacidad auditiva y de reacción. Prohibido', 'Solo está prohibido con música fuerte'],
    correcta: 2,
  },
  {
    id: 19,
    categoria: 'D. FACTORES DE RIESGO Y SALUD',
    pregunta: 'Ante fatiga o sueño conduciendo, lo correcto es:',
    opciones: ['Tomar café y seguir', 'Bajar las lunas y subir la radio', 'Detenerse en lugar seguro y descansar', 'Acelerar para llegar rápido'],
    correcta: 2,
  },
  {
    id: 20,
    categoria: 'D. FACTORES DE RIESGO Y SALUD',
    pregunta: '¿Qué documentos debe portar obligatoriamente un conductor de taxi en Lima según ATU?',
    opciones: [
      'DNI, Licencia A-I, Tarjeta de Propiedad, SOAT, CITV, Certificado de Operación',
      'Solo DNI y Licencia',
      'DNI, Licencia y SOAT',
      'DNI y Tarjeta de Propiedad',
    ],
    correcta: 0,
  },
];

const LETRAS = ['a', 'b', 'c', 'd'];

const getCategoriaColor = (cat) => {
  if (cat.startsWith('A')) return '#f59e0b';
  if (cat.startsWith('B')) return '#38bdf8';
  if (cat.startsWith('C')) return '#a78bfa';
  return '#34d399';
};

const QuizManejoDefensivo = ({ onComplete, initialData }) => {
  const [respuestas, setRespuestas] = useState(initialData?.respuestas || {});
  const [submitted, setSubmitted] = useState(initialData ? true : false);
  const [currentCat, setCurrentCat] = useState(null);

  useEffect(() => {
    if (initialData) {
      setRespuestas(initialData.respuestas || {});
      setSubmitted(true);
    }
  }, [initialData]);

  const categorias = [...new Set(PREGUNTAS.map((p) => p.categoria))];

  const calcularPuntaje = () => {
    let correctas = 0;
    PREGUNTAS.forEach((p) => {
      if (respuestas[p.id] === p.correcta) correctas++;
    });
    return correctas;
  };

  const getEstado = (puntaje) => {
    if (puntaje >= 18) return { label: 'APROBADO', color: '#22c55e', icon: CheckCircle };
    if (puntaje >= 15) return { label: 'OBSERVADO', color: '#f59e0b', icon: AlertTriangle };
    return { label: 'DESAPROBADO', color: '#ef4444', icon: XCircle };
  };

  const handleSelect = (preguntaId, opcionIdx) => {
    if (submitted) return;
    setRespuestas((prev) => ({ ...prev, [preguntaId]: opcionIdx }));
  };

  const handleSubmit = () => {
    const noRespondidas = PREGUNTAS.filter((p) => respuestas[p.id] === undefined);
    if (noRespondidas.length > 0) {
      alert(`Faltan ${noRespondidas.length} preguntas por responder.`);
      return;
    }
    setSubmitted(true);
    const puntaje = calcularPuntaje();
    const estado = getEstado(puntaje);
    if (onComplete) {
      onComplete({
        puntaje,
        total: 20,
        estado: estado.label,
        respuestas,
        fechaEvaluacion: new Date().toISOString(),
      });
    }
  };

  const handleReset = () => {
    setRespuestas({});
    setSubmitted(false);
  };

  const puntaje = calcularPuntaje();
  const estado = getEstado(puntaje);
  const respondidas = Object.keys(respuestas).length;

  const preguntasPorCategoria = (cat) => PREGUNTAS.filter((p) => p.categoria === cat);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Header informativo */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(14,165,233,0.08), rgba(56,189,248,0.04))',
        border: '1px solid rgba(56,189,248,0.2)',
        borderRadius: '12px',
        padding: '16px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <Award size={20} color="#38bdf8" />
          <span style={{ fontWeight: 700, color: 'var(--kapital-text-primary)', fontSize: '1rem' }}>
            Evaluación: Manejo Defensivo – MTC Perú
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
          20 preguntas basadas en el <strong>D.S. N° 016-2009-MTC</strong> y <strong>Ley 27181</strong>. 
          Solo una respuesta correcta. &nbsp;|&nbsp; Aprobado: 18–20 &nbsp;·&nbsp; Observado: 15–17 &nbsp;·&nbsp; Desaprobado: &lt;15
        </p>
        {!submitted && (
          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ flex: 1, height: '6px', borderRadius: '4px', background: 'rgba(255,255,255,0.08)' }}>
              <motion.div
                animate={{ width: `${(respondidas / 20) * 100}%` }}
                style={{ height: '100%', borderRadius: '4px', background: 'linear-gradient(90deg, #0ea5e9, #38bdf8)' }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <span style={{ fontSize: '0.78rem', color: '#38bdf8', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {respondidas}/20
            </span>
          </div>
        )}
      </div>

      {/* Resultado final */}
      <AnimatePresence>
        {submitted && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              background: `linear-gradient(135deg, ${estado.color}18, ${estado.color}08)`,
              border: `1px solid ${estado.color}40`,
              borderRadius: '16px',
              padding: '24px',
              textAlign: 'center',
            }}
          >
            <estado.icon size={48} color={estado.color} style={{ marginBottom: '12px' }} />
            <div style={{ fontSize: '2.2rem', fontWeight: 800, color: estado.color }}>{puntaje}/20</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: estado.color, marginBottom: '4px' }}>{estado.label}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {puntaje >= 18 ? '¡Excelente dominio del Reglamento Nacional de Tránsito!' :
               puntaje >= 15 ? 'Aprobado con observaciones. Se recomienda reforzar.' :
               'No alcanzó el puntaje mínimo. Requiere capacitación adicional.'}
            </div>
            <button
              onClick={handleReset}
              style={{
                marginTop: '16px', padding: '8px 20px', borderRadius: '8px',
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                color: 'var(--text)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
                fontSize: '0.85rem', fontWeight: 600
              }}
            >
              <RotateCcw size={14} /> Volver a intentar
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preguntas por categoría */}
      {categorias.map((cat, ci) => (
        <div key={ci}>
          {/* Separador de categoría */}
          <button
            onClick={() => setCurrentCat(currentCat === cat ? null : cat)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: `${getCategoriaColor(cat)}12`, border: `1px solid ${getCategoriaColor(cat)}30`,
              borderRadius: '10px', padding: '10px 16px', cursor: 'pointer', marginBottom: '12px',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: '0.88rem', color: getCategoriaColor(cat) }}>{cat}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                {preguntasPorCategoria(cat).filter(p => respuestas[p.id] !== undefined).length}/{preguntasPorCategoria(cat).length} respondidas
              </span>
              <motion.div animate={{ rotate: currentCat === cat ? 90 : 0 }}>
                <ChevronRight size={16} color={getCategoriaColor(cat)} />
              </motion.div>
            </div>
          </button>

          <AnimatePresence>
            {(currentCat === cat || currentCat === null) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
              >
                {preguntasPorCategoria(cat).map((preg) => {
                  const seleccionada = respuestas[preg.id];
                  return (
                    <div key={preg.id} style={{
                      background: 'var(--kapital-card-bg)',
                      border: '1px solid var(--kapital-border)',
                      borderRadius: '12px', padding: '16px',
                    }}>
                      {/* Número + Pregunta */}
                      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                        <span style={{
                          minWidth: '28px', height: '28px', borderRadius: '8px',
                          background: `${getCategoriaColor(cat)}20`, color: getCategoriaColor(cat),
                          fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {preg.id}
                        </span>
                        <span style={{ fontSize: '0.9rem', color: 'var(--kapital-text-primary)', lineHeight: '1.5', fontWeight: 500 }}>
                          {preg.pregunta}
                        </span>
                      </div>

                      {/* Opciones */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {preg.opciones.map((op, idx) => {
                          const esSeleccionada = seleccionada === idx;
                          const esCorrecta = submitted && idx === preg.correcta;
                          const esIncorrecta = submitted && esSeleccionada && idx !== preg.correcta;

                          let bgColor = 'rgba(255,255,255,0.03)';
                          let borderColor = 'rgba(255,255,255,0.08)';
                          let textColor = 'var(--text-secondary)';
                          let icon = null;

                          if (!submitted && esSeleccionada) {
                            bgColor = 'rgba(14,165,233,0.12)';
                            borderColor = '#0ea5e9';
                            textColor = '#38bdf8';
                          }
                          if (esCorrecta) {
                            bgColor = 'rgba(34,197,94,0.1)';
                            borderColor = '#22c55e';
                            textColor = '#22c55e';
                            icon = <CheckCircle size={14} color="#22c55e" />;
                          }
                          if (esIncorrecta) {
                            bgColor = 'rgba(239,68,68,0.1)';
                            borderColor = '#ef4444';
                            textColor = '#ef4444';
                            icon = <XCircle size={14} color="#ef4444" />;
                          }

                          return (
                            <motion.button
                              key={idx}
                              whileHover={!submitted ? { scale: 1.01 } : {}}
                              whileTap={!submitted ? { scale: 0.99 } : {}}
                              onClick={() => handleSelect(preg.id, idx)}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '10px',
                                padding: '10px 14px', borderRadius: '8px',
                                background: bgColor, border: `1px solid ${borderColor}`,
                                cursor: submitted ? 'default' : 'pointer',
                                textAlign: 'left', transition: 'all 0.2s ease',
                              }}
                            >
                              <span style={{
                                minWidth: '22px', height: '22px', borderRadius: '6px',
                                background: borderColor + '30', color: textColor,
                                fontSize: '0.75rem', fontWeight: 700, display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                              }}>
                                {LETRAS[idx]}
                              </span>
                              <span style={{ fontSize: '0.85rem', color: textColor, flex: 1, lineHeight: '1.4' }}>{op}</span>
                              {icon}
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}

      {/* Botón enviar */}
      {!submitted && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleSubmit}
          disabled={respondidas < 20}
          style={{
            padding: '14px', borderRadius: '10px', fontWeight: 700, fontSize: '1rem',
            background: respondidas < 20
              ? 'rgba(255,255,255,0.05)'
              : 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
            border: respondidas < 20 ? '1px solid rgba(255,255,255,0.1)' : 'none',
            color: respondidas < 20 ? 'var(--text-secondary)' : '#fff',
            cursor: respondidas < 20 ? 'not-allowed' : 'pointer',
            boxShadow: respondidas < 20 ? 'none' : '0 6px 20px rgba(14,165,233,0.3)',
            transition: 'all 0.2s ease',
          }}
        >
          {respondidas < 20 ? `Responde ${20 - respondidas} pregunta(s) más para continuar` : '✓ Enviar Evaluación'}
        </motion.button>
      )}
    </div>
  );
};

export default QuizManejoDefensivo;
