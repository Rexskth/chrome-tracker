require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const app = express();
const PORT = 5001;
const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || "Asia/Kolkata";
const REPORT_CRON = process.env.REPORT_CRON || "59 23 * * *";
const STORE_PATH = path.join(__dirname, "data", "daily-store.json");

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.send("🚀 Server is running");
});

function formatTime(seconds) {
  const totalSeconds = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatActivity(data) {
  return Object.entries(data)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([site, seconds]) => `- ${site}: ${formatTime(Number(seconds))}`)
    .join("\n");
}

function guessCategory(site) {
  const s = String(site || "").toLowerCase();
  if (/(youtube|netflix|hotstar|primevideo|spotify|twitch)/.test(s)) return "Entertainment";
  if (/(linkedin|facebook|instagram|twitter|x\.com|reddit|snapchat)/.test(s)) return "Social Media";
  if (/(github|gitlab|n8n|notion|docs\.google|stackoverflow|chatgpt|openai|leetcode|coursera|udemy)/.test(s)) return "Productive";
  if (/(gmail|outlook|mail|calendar)/.test(s)) return "Communication";
  if (/(amazon|flipkart|myntra|ebay)/.test(s)) return "Shopping";
  return "Other";
}

function formatCategorizedFallback(data) {
  const grouped = {};
  Object.entries(data).forEach(([site, seconds]) => {
    const category = guessCategory(site);
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push([site, Number(seconds)]);
  });

  const ordered = Object.entries(grouped).sort((a, b) => {
    const sumA = a[1].reduce((sum, [, sec]) => sum + sec, 0);
    const sumB = b[1].reduce((sum, [, sec]) => sum + sec, 0);
    return sumB - sumA;
  });

  return ordered
    .map(([category, sites]) => {
      const total = sites.reduce((sum, [, sec]) => sum + sec, 0);
      const siteLines = sites
        .sort((a, b) => b[1] - a[1])
        .map(([site, sec]) => `- ${site}: ${formatTime(sec)}`)
        .join("\n");
      return `**${category} (${formatTime(total)})**\n${siteLines}`;
    })
    .join("\n\n") + "\n\nInsight: Categorized fallback summary generated from exact tracked durations.";
}

function formatDateInTimezone(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function sanitizeDataObject(data) {
  const clean = {};
  Object.entries(data || {}).forEach(([site, seconds]) => {
    if (typeof site !== "string" || site.trim() === "") return;
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) return;
    clean[site] = value;
  });
  return clean;
}

async function loadStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      daily: parsed.daily || {},
      lastTelegramReportDate: parsed.lastTelegramReportDate || null
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { daily: {}, lastTelegramReportDate: null };
    }
    throw error;
  }
}

async function saveStore(store) {
  const dir = path.dirname(STORE_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

function toTelegramHtml(summaryText) {
  const escapeHtml = (str) =>
    String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const lines = String(summaryText || "").split("\n");
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "";
      const heading = trimmed.match(/^\*\*(.+)\*\*$/);
      if (heading) return `<b>${escapeHtml(heading[1])}</b>`;
      if (trimmed.startsWith("- ")) return `• ${escapeHtml(trimmed.slice(2))}`;
      return escapeHtml(trimmed);
    })
    .join("\n");
}

function toGroqInputLines(data) {
  return Object.entries(data)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([site, seconds]) => `${site}|${Number(seconds)}`)
    .join("\n");
}

function validateInput(body) {
  if (!body || typeof body !== "object") {
    return "Request body must be a JSON object.";
  }

  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    return "Invalid input: 'data' must be an object of { site: seconds }.";
  }

  const entries = Object.entries(body.data);
  if (entries.length === 0) {
    return "Invalid input: 'data' cannot be empty.";
  }

  for (const [site, value] of entries) {
    if (typeof site !== "string" || site.trim() === "") {
      return "Invalid input: site names must be non-empty strings.";
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return `Invalid input: seconds for '${site}' must be a non-negative number.`;
    }
  }

  return null;
}

async function generateSummaryText(data, { strict = true } = {}) {
  const deterministicSummary = formatActivity(data);
  const categorizedFallback = formatCategorizedFallback(data);
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    if (strict) {
      throw new Error("Missing GROQ_API_KEY in environment variables.");
    }
    return categorizedFallback || deterministicSummary;
  }

  const configuredModel = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const fallbackModels = [
    configuredModel,
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "mixtral-8x7b-32768"
  ].filter((model, index, arr) => model && arr.indexOf(model) === index);
  const activityLines = toGroqInputLines(data);

  const systemPrompt = [
    "You create concise categorized browsing summaries.",
    "Return plain text only.",
    "Use ONLY website names and seconds from input.",
    "Do not invent websites or durations.",
    "Category names should be short and meaningful, e.g. Productive, Social Media, Entertainment, Communication, Shopping, Other.",
    "Output format:",
    "**<Category> (<HH:MM:SS>)**",
    "- <site>: <HH:MM:SS>",
    "- <site>: <HH:MM:SS>",
    "",
    "Then next category block.",
    "At end add exactly one final line:",
    "Insight: <one short sentence>",
    "Keep response compact."
  ].join(" ");

  const userPrompt = [
    "Group this site|seconds input by category and format exactly as instructed.",
    activityLines
  ].join("\n");

  let summary = "";
  let lastError = "";

  for (const model of fallbackModels) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      lastError = `Model ${model}: ${response.status} ${errorText}`;
      console.error("Groq API error:", lastError);
      if (response.status === 404) continue;
      if (strict) {
        throw new Error("Failed to generate summary from Groq.");
      }
      continue;
    }

    const result = await response.json();
    summary = result?.choices?.[0]?.message?.content?.trim() || "";
    if (summary) break;
  }

  if (!summary) {
    console.error("All Groq model attempts failed.", lastError);
    return categorizedFallback || deterministicSummary;
  }

  return summary;
}

async function sendDailyTelegramReport() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("Telegram config missing. Skipping scheduled report.");
    return;
  }

  const dateKey = formatDateInTimezone(REPORT_TIMEZONE);
  const store = await loadStore();
  if (store.lastTelegramReportDate === dateKey) {
    console.log(`Telegram report already sent for ${dateKey}.`);
    return;
  }

  const todayData = sanitizeDataObject(store.daily[dateKey] || {});
  let summaryText = "";
  if (Object.keys(todayData).length === 0) {
    summaryText = "No browsing activity tracked today.";
  } else {
    summaryText = await generateSummaryText(todayData, { strict: false });
  }

  const telegramText = `<b>Daily Summary (${dateKey})</b>\n\n${toTelegramHtml(summaryText)}`.slice(0, 4000);
  const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: telegramText,
      parse_mode: "HTML"
    })
  });

  if (!telegramResponse.ok) {
    const errorText = await telegramResponse.text();
    throw new Error(`Telegram send failed: ${telegramResponse.status} ${errorText}`);
  }

  store.lastTelegramReportDate = dateKey;
  await saveStore(store);
  console.log(`Telegram daily report sent for ${dateKey}`);
}

app.post("/activity/sync", async (req, res) => {
  try {
    const validationError = validateInput(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const date = req.body.date || formatDateInTimezone(REPORT_TIMEZONE);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
    }

    const cleanData = sanitizeDataObject(req.body.data);
    const store = await loadStore();
    store.daily[date] = cleanData;
    await saveStore(store);

    return res.status(200).json({ ok: true, date, sites: Object.keys(cleanData).length });
  } catch (error) {
    console.error("Activity sync failed:", error);
    return res.status(500).json({ error: "Internal server error while syncing activity." });
  }
});

app.post("/report/send-now", async (_req, res) => {
  try {
    await sendDailyTelegramReport();
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Manual report send failed:", error);
    return res.status(500).json({ error: error.message || "Failed to send report." });
  }
});

app.post("/summarize", async (req, res) => {
  try {
    const validationError = validateInput(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const summary = await generateSummaryText(req.body.data, { strict: true });
    return res.type("text/plain").status(200).send(summary);
  } catch (error) {
    console.error("Summarize request failed:", error);
    if (error.message === "Missing GROQ_API_KEY in environment variables.") {
      return res.status(500).json({ error: error.message });
    }
    if (error.message === "Failed to generate summary from Groq.") {
      return res.status(502).json({ error: error.message });
    }
    return res.status(500).json({ error: "Internal server error while generating summary." });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).send("Route not found");
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`⏰ Telegram report schedule: '${REPORT_CRON}' (${REPORT_TIMEZONE})`);
});

cron.schedule(
  REPORT_CRON,
  async () => {
    try {
      await sendDailyTelegramReport();
    } catch (error) {
      console.error("Scheduled report failed:", error);
    }
  },
  { timezone: REPORT_TIMEZONE }
);
