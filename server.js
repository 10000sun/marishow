require("dotenv").config();
const path = require("path");
const express = require("express");
const { getReply } = require("./bot/marie");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => {
  res.json({ mode: process.env.ANTHROPIC_API_KEY ? "live" : "demo" });
});

app.post("/api/chat", async (req, res) => {
  const { message, history } = req.body || {};

  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }
  if (message.length > 1000) {
    return res.status(400).json({ error: "message too long" });
  }

  try {
    const result = await getReply({ message, history: Array.isArray(history) ? history.slice(-10) : [] });
    res.json(result);
  } catch (err) {
    console.error("chat error:", err);
    res.status(500).json({ error: "마리가 지금 답을 못하고 있어. 잠시 후 다시 시도해줘." });
  }
});

app.listen(PORT, () => {
  console.log(`마리봇 체험 플랫폼이 http://localhost:${PORT} 에서 실행 중이야`);
});
