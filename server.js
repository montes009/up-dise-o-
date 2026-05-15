const fetch   = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const express = require("express");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;
const KEY  = process.env.ANTHROPIC_KEY || "";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Proxy seguro hacia Anthropic — la key nunca sale al navegador
app.post("/api/chat", async (req, res) => {
  console.log("[proxy] body:", JSON.stringify(req.body));
  if(!KEY){
    return res.status(500).json({ error: "ANTHROPIC_KEY no configurada en Render." });
  }
  try{
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "x-api-key":       KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    console.log("[proxy] status:", response.status, JSON.stringify(data));
    res.status(response.status).json(data);
  }catch(e){
    console.error("[proxy]", e.message);
    res.status(500).json({ error: "Error conectando con Anthropic." });
  }
});

app.listen(PORT, () => console.log("ALCON OPS corriendo en puerto " + PORT));
