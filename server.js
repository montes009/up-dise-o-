const fetch   = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const express = require("express");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;
const KEY  = process.env.ANTHROPIC_KEY || "";

// ============================================================
// LIAN — CONFIGURACIÓN CENTRAL
// Cambia ANTHROPIC_MODEL aquí si necesitas otro modelo.
// ============================================================
const LIAN_PROMPT_VERSION = "v1.2.0";
const ANTHROPIC_MODEL     = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// LIAN — SYSTEM PROMPT (backend only, nunca sale al browser)
// Sprint 3 inyectará aquí: sesión Supabase + contexto de BD.
// ============================================================
function buildSystemPrompt() {
  const fecha = new Date().toLocaleDateString("es-CO", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  return `Eres LIAN, el asistente operativo inteligente de ALCON OPS — sistema de gestión de alquileres de maquinaria pesada (plataformas elevadoras articuladas, tijeras, telescópicas, etc.).

FECHA ACTUAL: ${fecha}

PERSONALIDAD Y COMPORTAMIENTO:
- Eres profesional, directo y con criterio operativo real
- Hablas en español colombiano natural — no robótico, no excesivamente formal
- Entiendes lenguaje informal: "qué hay de nuevo", "cómo vamos hoy", "muéstrame lo de las máquinas"
- Eres proactivo: si ves algo importante, lo mencionas
- Si no entiendes algo, preguntas de forma natural
- NUNCA inventas datos que no tengas — si no sabes algo, lo dices y ofreces consultar la BD
- Si el usuario escribe datos de un cliente en texto libre (nombre, nit, contacto, tel, correo, ciudad), extrae todos los campos disponibles y usa "crear_cliente_directo". NO uses "crear_cliente" ni abras flujo de modal.
- Si el usuario escribe datos de una cotización en texto libre (cliente, equipo, días, precio), extrae todos los campos y usa "crear_cotizacion_directa". NO uses "crear_cotizacion" ni abras flujo de modal.
- El único campo obligatorio para "crear_cliente_directo" es "nombre_empresa". Si no está claro, pregunta solo ese campo antes de ejecutar.
- Los campos obligatorios para "crear_cotizacion_directa" son "cliente", "tipo" y "precio". Si falta alguno, pregunta solo los que faltan, uno por uno.
- Si el usuario escribe "cliente: X / empresa: Y / nit: Z" o cualquier variación con saltos de línea, dos puntos, guiones o comas — interpreta correctamente todos los campos.
- Confirma SIEMPRE lo que vas a crear antes de ejecutar la acción. Ejemplo: "Voy a crear el cliente Antropi con NIT 00234155 y contacto Andrés — ¿correcto?" Espera confirmación ("sí", "correcto", "dale", "ok") antes de devolver la acción.

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
{"reply":"texto natural explicando lo que harás","action":"nombre_accion","params":{}}

ACCIONES DISPONIBLES:
- "crear_cliente"             → params: {} (abre flujo modal paso a paso — solo si el usuario pide crear sin dar datos)
- "crear_cotizacion"          → params: {} (abre flujo modal paso a paso — solo si el usuario pide crear sin dar datos)
- "crear_alquiler"            → params: {}
- "crear_cliente_directo"     → params: {"nombre_empresa":"texto obligatorio","nit":"texto o vacío","contacto":"texto o vacío","telefono":"texto o vacío","correo":"texto o vacío","ciudad":"texto o vacío","direccion":"texto o vacío"}
- "crear_cotizacion_directa"  → params: {"cliente":"nombre de empresa obligatorio","tipo":"tipo de equipo obligatorio","altura":"texto o vacío","dias":1,"precio":0,"modalidad":"alquiler_dia","obs":"texto o vacío"}
- "consultar_alquileres"      → params: {"filtro":"activo|finalizado|por_vencer|pendiente_recogida"}
- "consultar_cotizaciones"    → params: {"filtro":"borrador|en_revision|enviada|aprobada|negociacion|rechazada|perdida|vencida|cancelada"}
- "consultar_maquinas"        → params: {"filtro":"disponible|trabajando|varada|alistamiento|devolucion"}
- "consultar_clientes"        → params: {"busqueda":"texto o vacío"}
- "consultar_finanzas"        → params: {}
- "consultar_resumen"         → params: {}
- "asignar_maquina"           → params: {}
- "cambiar_estado_maquina"    → params: {}

Si el usuario saluda o hace pregunta general → responde con reply y action:null.
Si el usuario pide datos → usa la acción correspondiente para traer desde la BD.`;
}

// ============================================================
// POST /api/chat — Gateway de IA de LIAN
// Recibe: { message, conversationHistory }
// Envía a Anthropic: { model, max_tokens, system, messages }
// TODO Sprint 3: validar sesión Supabase + inyectar contexto BD.
// ============================================================
app.post("/api/chat", async (req, res) => {
  const { message, conversationHistory } = req.body;

  // ── Validar API key ──────────────────────────────────────
  if (!KEY) {
    console.error(`[LIAN ${LIAN_PROMPT_VERSION}] ERROR: ANTHROPIC_KEY no configurada en Render.`);
    return res.status(500).json({ error: "ANTHROPIC_KEY no configurada en el servidor." });
  }

  // ── Validar payload de entrada ───────────────────────────
  if (!message || typeof message !== "string" || !message.trim()) {
    console.error(`[LIAN ${LIAN_PROMPT_VERSION}] ERROR: campo 'message' ausente o vacío.`);
    return res.status(400).json({ error: "Falta el campo 'message'." });
  }

  // ── Construir messages[] para Anthropic ──────────────────
  const history  = Array.isArray(conversationHistory) ? conversationHistory : [];
  const messages = [
    ...history,
    { role: "user", content: message.trim() }
  ];

  // ── Log de entrada ───────────────────────────────────────
  console.log(`[LIAN ${LIAN_PROMPT_VERSION}] model=${ANTHROPIC_MODEL}`);
  console.log(`[LIAN] historial=${history.length} mensajes | message="${message.slice(0, 80)}"`);
  console.log(`[LIAN] total messages enviados a Anthropic: ${messages.length}`);

  // ── Payload exacto para Anthropic ────────────────────────
  const anthropicPayload = {
    model:      ANTHROPIC_MODEL,
    max_tokens: 1024,
    system:     buildSystemPrompt(),
    messages                           // ← siempre tiene al menos 1 elemento
  };

  // ── Llamada a Anthropic ──────────────────────────────────
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(anthropicPayload)
    });

    const data = await response.json();
    console.log(`[LIAN] Anthropic status: ${response.status}`);

    // ── Errores específicos ──────────────────────────────
    if (response.status === 404) {
      console.error(`[LIAN] ERROR 404 — modelo inválido: "${ANTHROPIC_MODEL}". Actualiza ANTHROPIC_MODEL en server.js.`);
      return res.status(502).json({
        error: `Modelo '${ANTHROPIC_MODEL}' no encontrado en Anthropic. Revisa ANTHROPIC_MODEL en server.js.`
      });
    }

    if (response.status === 401) {
      console.error("[LIAN] ERROR 401 — ANTHROPIC_KEY inválida o expirada.");
      return res.status(502).json({ error: "API key de Anthropic inválida. Revisa ANTHROPIC_KEY en Render." });
    }

    if (response.status === 400) {
      console.error("[LIAN] ERROR 400 Anthropic — payload rechazado:", JSON.stringify(data));
      console.error("[LIAN] Payload enviado:", JSON.stringify(anthropicPayload).slice(0, 500));
      return res.status(400).json({ error: "Payload rechazado por Anthropic.", detail: data });
    }

    if (!response.ok) {
      console.error(`[LIAN] ERROR ${response.status} Anthropic:`, JSON.stringify(data));
      return res.status(response.status).json(data);
    }

    // ── Éxito ────────────────────────────────────────────
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
  console.log(`[LIAN ${LIAN_PROMPT_VERSION}] ALCON OPS en puerto ${PORT} · modelo: ${ANTHROPIC_MODEL}`);
});
