# Contratos del Programador de Rutas — revisión de la propuesta

> Complementa `route-programmer-workbench.md` (documento de Codex). No lo reemplaza.
> Estado: **propuesta, sin implementar**. Ningún endpoint de este documento existe todavía.
> Fecha: 2026-09-15. Base verificada: `28fb702`.

## 0. Por qué existe este documento

La planificación de Codex está bien construida, pero al contrastar los cinco mockups
contra el código real aparecieron tres defectos que, de no corregirse ahora, quedan
congelados como especificación. Este documento los corrige y reescribe el contrato de
importación.

---

## 1. Defecto: la mesa asigna asientos, no programa recorridos

### El problema

El objetivo declarado es que **el conductor pueda llegar al destino de los agentes**.
Ninguna de las cinco pantallas muestra el orden de recogida, la hora de paso por cada
agente ni la duración del recorrido. La columna `#` del servicio expandido se lee como
número de fila, no como secuencia.

Esto choca con la herramienta elegida. La salida principal de VROOM es `steps[]`: una
secuencia **ordenada** de paradas, cada una con `arrival`. Un diseño que solo muestra
"qué agentes van en qué unidad" usa un solver de ruteo como empaquetador de cajas y
descarta su resultado más valioso.

### La consecuencia sobre el contrato

`PlanningService` necesita paradas ordenadas, y "aprobar un servicio" pasa a significar
*aceptar la lista de agentes y su orden*, no solo la lista.

```jsonc
{
  "servicio_id": "svc_2026-09-15_TP_1630_SU03",
  "orden_version": 3,              // cambia cuando el motor o el humano reordenan
  "duracion_estimada_min": 74,
  "distancia_estimada_km": 23.8,
  "destino": {                     // hoy la sede es solo un filtro del Excel y NO viaja
    "tipo": "sede",                // dentro de la ruta. Sin esto no hay "destino".
    "sede_id": "SEDE_SUR",
    "llegada_estimada": "2026-09-15T17:44:00-05:00"
  },
  "paradas": [
    {
      "orden": 1,                  // secuencia real de recogida, no número de fila
      "asignacion_id": "asg_01JQ8F",
      "agente_ref": "AGT-0173",
      "llegada_estimada": "2026-09-15T16:30:00-05:00",
      "espera_min": 2,
      "origen_orden": "motor",     // motor | manual | original
      "fijada": false              // true = el humano la ancló, el motor no la mueve
    }
  ]
}
```

### Decisión tomada (2026-09-15)

**El Programador reordena paradas a mano.** El motor propone una secuencia y el humano puede
modificarla, no solo aceptarla o rechazarla en bloque.

Consecuencias que esto fija:

- El servicio expandido necesita una interacción de reordenamiento, con alternativa accesible
  por teclado — no solo arrastre.
- `orden_version` y `origen_orden` del contrato de §1 dejan de ser opcionales: hay que
  distinguir una parada movida por el motor de una movida por una persona.
- `fijada` cobra sentido: una parada que el humano colocó no debería moverla un recálculo
  posterior sin avisar (queda abierta la pregunta 21).
- Si los ETAs se recalculan al reordenar, hace falta decidir si los recalcula el servidor
  —llamada por cada cambio— o el cliente con una estimación provisional.

---

## 2. Defecto: la capacidad `/15` contradice el KPI del propio mockup

Las tarjetas muestran `11/15`, `15/15`, `9/15`, `13/15`, `8/15`. El encabezado declara
**24 servicios** y **capacidad libre 18** con 286 agentes asignados.

- Si las 24 unidades fueran de 15 → 360 asientos, 74 libres. El KPI dice 18.
- Los números solo cuadran con **capacidad variable por unidad** (total ≈ 304).

El código confirma la segunda lectura: la capacidad real está en
`conductores_db[id]["capacidad"]`, mientras `frontend/src/App.jsx` tiene **15 hardcodeado**
en el tope del drag & drop y en el cálculo de `tasaOptimizacion`.

**Corrección:** la tarjeta muestra la capacidad real de la unidad. El `15` desaparece del
frontend y no se sustituye por otra constante. La compatibilidad del drag & drop se calcula
contra la capacidad de la unidad destino, nunca contra un literal.

---

## 3. Defecto: la tabla de observaciones no puede existir tal como se dibujó

El mockup declara que novedades tiene **18 registros, 12 válidos, 6 observados**, y luego
lista observaciones en las filas **12, 27, 104, 188, 221, 276**. Cuatro están fuera del
rango de un archivo de 18 filas.

Con **dos** archivos de entrada, `fila` no identifica nada por sí sola. Toda observación
necesita `archivo` + `fila`.

---

## 4. Contrato de validación de importación (reemplaza el borrador)

### Principios

1. **Validar no muta.** La programación vigente no se toca hasta que el usuario confirme.
2. **Nada se pierde.** Un registro observado se conserva y se enruta, nunca se descarta.
3. **La respuesta no transporta el dataset.** Solo agregados y la lista de observaciones.
   Con `app_state` en una sola fila de ~3,95 MB, devolver las filas leídas multiplicaría
   el egress por cada reintento de importación.
4. **Los códigos son estables; los mensajes son texto.** El frontend decide color, icono
   y traducción a partir del código, nunca parseando la prosa.
5. **Advertencia y error no son lo mismo.** Una advertencia enruta al panel de novedades;
   un error estructural bloquea la generación.

### Respuesta

```jsonc
{
  "batch_id": "imp_2026-09-15_TP_01JQ8F3K2M",  // estable, idempotente
  "operacion": "TP",
  "fecha_planificacion": "2026-09-15",
  "ventana_operativa": {
    "inicio": "2026-09-14T11:00:00-05:00",
    "fin":    "2026-09-15T07:00:00-05:00"
  },
  "creado_por": "<resuelto en servidor desde la sesión, nunca enviado por el cliente>",
  "creado_en": "2026-09-15T10:38:12-05:00",
  "expira_en": "2026-09-15T22:38:12-05:00",     // el lote es transitorio: no vive
                                                // indefinidamente en app_state

  "archivos": {
    "ultima_programacion": {
      "nombre_original": "programacion_14_sep.xlsx",
      "bytes": 1258291,
      "sha256": "9f2c...",                       // detecta la resubida del mismo
      "hoja": "Programación",                    // archivo sin reprocesarlo
      "filas_leidas": 286,
      "filas_validas": 286,
      "estado": "valido"                         // valido | requiere_revision | invalido
    },
    "novedades": {
      "nombre_original": "novedades_15_sep.xlsx",
      "bytes": 876544,
      "sha256": "4ab1...",
      "hoja": "Novedades",
      "filas_leidas": 18,
      "filas_validas": 12,
      "estado": "requiere_revision"
    }
  },

  "resumen": {
    "filas_leidas": 304,
    "filas_validas": 298,
    "observadas": 6,
    "por_categoria": {
      "DNI_DUPLICADO": 2,
      "DIRECCION_INCOMPLETA": 3,
      "SIN_COORDENADAS": 1
    }
  },

  "observaciones": [
    {
      "id": "obs_01JQ8F3K2M_0001",
      "archivo": "novedades",                    // corrige el defecto de §3
      "fila": 12,                                // fila dentro de ESE archivo
      "agente_ref": "AGT-0173",                  // provisional: la identidad del agente
                                                 // sigue sin decidir (workbench §13 Q2)
      "codigo": "DIRECCION_INCOMPLETA",          // enum estable
      "severidad": "advertencia",                // advertencia | error
      "campos": ["direccion"],
      "mensaje": "Falta el número en la dirección.",
      "destino": "panel_novedades",              // panel_novedades | corregir_archivo
      "bloquea_generacion": false
    }
  ],

  "puede_generar": true,
  "bloqueos": []        // si puede_generar es false, aquí va el porqué, con códigos:
                        // [{ "codigo": "COLUMNA_FALTANTE", "archivo": "novedades",
                        //    "mensaje": "Falta la columna SEDE.", "campos": ["SEDE"] }]
}
```

### Qué mejora respecto del borrador

| Borrador | Esta versión | Motivo |
|---|---|---|
| JSON mal formado (falta `ultima_programacion`) | Estructura cerrada | El original no parsea |
| `errores: []` sin forma | `observaciones[]` tipadas | Testeable y traducible |
| Sin `archivo` en el error | `archivo` + `fila` | Con dos Excel, `fila` sola es ambigua |
| Mensaje en prosa | `codigo` + `mensaje` | El frontend no debe parsear texto |
| Sin severidad | `severidad` + `bloquea_generacion` | Advertencia enruta, error bloquea |
| `puede_generar` booleano | `+ bloqueos[]` | Un "no" sin causa no es accionable |
| Sin caducidad | `expira_en` | El lote no debe residir para siempre |
| Sin huella | `sha256` | Idempotencia ante resubidas |

---

## 5. Riesgo de persistencia que la propuesta no dimensiona

El documento de Codex marca el egress de **lectura**. El problema más agudo es la
**escritura**.

Todo el estado vive en `public.app_state`, **una sola fila** de ~3,95 MB, y cada
persistencia reescribe la fila completa. El diseño añade encima:

- borradores versionados (el mockup muestra `Borrador v3`),
- historial de cambios por agente,
- estado del panel de novedades,
- eventos de revisión (`ReviewEvent`).

Con guardados frecuentes —el mockup muestra `Última guardada 16:42`— cada uno reescribe
todo el snapshot. Y el **OCC sobre `app_state` sigue pendiente** (Lote 7 del relevo), así
que dos guardados concurrentes se pisan en silencio.

**Esto debe resolverse antes de PR B, no después.** Una mesa de planificación diaria con
historial no cabe en el modelo de una fila. Opciones a evaluar: tabla propia para las
sesiones de planificación, o `app_state` reducido al puntero de la sesión vigente.

---

## 6. Orden de implementación recomendado

| # | Lote | Por qué en esta posición |
|---|---|---|
| 0 | **Decidir persistencia de la sesión de planificación** | Bloquea todo lo demás (§5) |
| 1 | **PR A — Shell visual sobre el contrato actual** | Sin backend nuevo; valida el layout con datos reales |
| 2 | **Quitar el `15` hardcodeado** | Pequeño, aislado, corrige un bug vivo (§2) |
| 3 | **PR B — Importación y validación** | Ya con el contrato de §4 y la persistencia resuelta |
| 4 | **Secuenciación de paradas + VROOM** | Requiere §1 decidido; es el núcleo del producto |
| 5 | **Revisión, aprobación y auditoría** | Depende de que exista la propuesta que se revisa |
| 6 | **Guardar, versionar, exportar** | Cierra el ciclo diario |

---

## 7. Decisiones pendientes que añade este documento

Se suman a las 16 de `route-programmer-workbench.md` §13.

17. ~~¿El Programador puede reordenar paradas a mano?~~ **Resuelta el 2026-09-15: sí, manual.** Ver §1.
18. ¿"Aprobar un servicio" incluye aprobar el orden de recogida, o solo la lista de agentes?
19. ¿Cuál es la capacidad real por unidad y de dónde se lee como fuente única de verdad?
20. ¿Dónde vive la sesión de planificación: `app_state`, tabla nueva, o híbrido? (§5)
21. ¿Un recálculo del motor puede mover una parada que el humano ya aprobó? ¿Existe "fijar parada"?
22. ¿La ventana operativa 11:00–07:00 es fija o configurable por operación?
