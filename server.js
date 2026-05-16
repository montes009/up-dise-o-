const fetch   = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const express = require("express");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;
const KEY  = process.env.ANTHROPIC_KEY || "";

// ============================================================
// LIAN — CONFIGURACIÓN CENTRAL
// ============================================================
const LIAN_PROMPT_VERSION = "v1.0.0";
const LIAN_MODEL          = "claude-sonnet-4-5";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// LIAN — CONSTRUCTOR DE SYSTEM PROMPT (backend only)
// El prompt nunca sale al navegador.
// ============================================================
function buildSystemPrompt({ empresa_nombre, usuario_email, rol_usuario, contextoDB }) {
  const fecha = new Date().toLocaleDateString("es-CO", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  return `Eres LIAN, el asistente operativo inteligente de ALCON OPS — sistema de gestión de alquileres de maquinaria pesada (plataformas elevadoras articuladas, tijeras, telescópicas, etc.).

SESIÓN ACTIVA:
- Empresa: ${empresa_nombre}
- Usuario: ${usuario_email}
- Rol: ${rol_usuario}
- Fecha: ${fecha}

DATOS EN TIEMPO REAL DE LA BASE DE DATOS:
${JSON.stringify(contextoDB)}

PERSONALIDAD Y COMPORTAMIENTO:
- Eres profesional, directo y con criterio operativo real
- Hablas en español colombiano natural — no robótico, no excesivamente formal
- Entiendes lenguaje informal: "qué hay de nuevo", "cómo vamos hoy", "muéstrame lo de las máquinas"
- Puedes razonar sobre los datos: si hay 5 máquinas varadas eso es una alerta real, dilo
- Eres proactivo: si ves algo importante en los datos (vencimientos, máquinas sin usar, etc.), lo mencionas
- Si no entiendes algo, preguntas de forma natural sin pedir que reformulen con palabras clave
- Respondes con contexto: si te piden el resumen, das análisis, no solo números
- NUNCA inventas datos que no estén en el contexto — si no tienes info, lo dices

REGLAS DE NEGOCIO CRÍTICAS:
- maquinas.estado válidos SOLO: disponible, trabajando, varada, alistamiento, devolucion (NUNCA 'reservado')
- cotizaciones NO tiene columna transporte
- empresa_id es obligatorio en todos los registros
- Los flujos de creación (cliente, cotización, alquiler) los maneja la interfaz paso a paso — tú los disparas

FORMATO DE RESPUESTA — OBLIGATORIO:
Responde ÚNICAMENTE con JSON válido. Sin texto fuera del JSON. Sin markdown. Sin backticks.

Si solo respondes texto:
{"reply":"tu respuesta natural aquí","action":null,"params":{}}

Si debes ejecutar una acción:
{"reply":"texto natural explicando lo que harás o complementando la acción","action":"nombre_accion","params":{}}

ACCIONES DISPONIBLES (verifica permisos del rol antes de usar):
- "crear_cliente"          → params: {}
- "crear_cotizacion"       → params: {}
- "crear_alquiler"         → params: {}
- "consultar_alquileres"   → params: {"filtro":"activo|finalizado|por_vencer|pendiente_recogida"}
- "consultar_cotizaciones" → params: {"filtro":"borrador|en_revision|enviada|aprobada|negociacion|rechazada|perdida|vencida|cancelada"}
- "consultar_maquinas"     → params: {"filtro":"disponible|trabajando|varada|alistamiento|devolucion"}
- "consultar_clientes"     → params: {"busqueda":"texto o vacío"}
- "consultar_finanzas"     → params: {}
- "consultar_resumen"      → params: {}
- "asignar_maquina"        → params: {}
- "cambiar_estado_maquina" → params: {}

Si el usuario saluda, pregunta algo general, o quiere análisis → responde con reply y action:null.
Si el usuario pide datos que YA tienes en el contexto → respóndelos directamente con reply (sin action) para ser más rápido.
Si el usuario pide datos detallados o listas → usa la acción para traer desde la BD.`;
}

// ============================================================
// POST /api/chat — Gateway de IA de LIAN
// TODO Sprint 3: agregar validación de sesión Supabase aquí.
// ============================================================
app.post("/api/chat", async (req, res) => {
  const {
    message,
    conversationHistory,
    empresa_nombre,
    usuario_email,
    rol_usuario,
    contextoDB
  } = req.body;

  // — Validaciones básicas —
  if (!KEY) {
    console.error(`[LIAN ${LIAN_PROMPT_VERSION}] ERROR: ANTHROPIC_KEY no configurada.`);
    return res.status(500).json({ error: "ANTHROPIC_KEY no configurada en el servidor." });
  }
  if (!message) {
    return res.status(400).json({ error: "Falta el campo 'message'." });
  }

  // — Log de entrada —
  console.log(`[LIAN ${LIAN_PROMPT_VERSION}] model=${LIAN_MODEL} empresa="${empresa_nombre}" rol=${rol_usuario}`);
  console.log(`[LIAN] message: ${message}`);

  // — Construir prompt (nunca sale al cliente) —
  const systemPrompt = buildSystemPrompt({
    empresa_nombre: empresa_nombre || "ALCON OPS",
    usuario_email:  usuario_email  || "",
    rol_usuario:    rol_usuario    || "operaciones",
    contextoDB:     contextoDB     || {}
  });

  // — Armar mensajes para Anthropic —
  const messages = [
    ...(Array.isArray(conversationHistory) ? conversationHistory : []),
    { role: "user", content: message }
  ];

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model:      LIAN_MODEL,
        max_tokens: 1024,
        system:     systemPrompt,
        messages
      })
    });

    const data = await response.json();

    // — Log de respuesta —
    console.log(`[LIAN] Anthropic status: ${response.status}`);

    // — Manejo de errores específicos de Anthropic —
    if (response.status === 404) {
      console.error(`[LIAN] ERROR 404 — modelo no encontrado: "${LIAN_MODEL}". Revisa LIAN_MODEL en server.js.`);
      return res.status(502).json({
        error: `Modelo '${LIAN_MODEL}' no existe en Anthropic. Actualiza LIAN_MODEL en server.js.`
      });
    }

    if (response.status === 401) {
      console.error("[LIAN] ERROR 401 — ANTHROPIC_KEY inválida o sin permisos.");
      return res.status(502).json({ error: "API key de Anthropic inválida. Revisa ANTHROPIC_KEY en Render." });
    }

    if (!response.ok) {
      console.error(`[LIAN] ERROR ${response.status} Anthropic:`, JSON.stringify(data));
      return res.status(response.status).json(data);
    }

    // — Respuesta exitosa —
    const inputTokens  = data.usage?.input_tokens  || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    console.log(`[LIAN] OK — input_tokens=${inputTokens} output_tokens=${outputTokens}`);

    return res.status(200).json(data);

  } catch (e) {
    console.error("[LIAN] ERROR de red hacia Anthropic:", e.message);
    return res.status(500).json({ error: "Error conectando con Anthropic." });
  }
});

// ============================================================
// ARRANQUE
// ============================================================
app.listen(PORT, () => {
  console.log(`[LIAN ${LIAN_PROMPT_VERSION}] ALCON OPS corriendo en puerto ${PORT} · modelo: ${LIAN_MODEL}`);
});
