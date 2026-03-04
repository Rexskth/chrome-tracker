require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 5001;

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

app.post("/summarize", async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GROQ_API_KEY in environment variables." });
    }

    const validationError = validateInput(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const deterministicSummary = formatActivity(req.body.data);
    const categorizedFallback = formatCategorizedFallback(req.body.data);
    const configuredModel = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
    const fallbackModels = [
      configuredModel,
      "llama-3.1-8b-instant",
      "llama-3.3-70b-versatile",
      "mixtral-8x7b-32768"
    ].filter((model, index, arr) => model && arr.indexOf(model) === index);
    const activityLines = toGroqInputLines(req.body.data);

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
        return res.status(502).json({ error: "Failed to generate summary from Groq." });
      }

      const result = await response.json();
      summary = result?.choices?.[0]?.message?.content?.trim() || "";
      if (summary) break;
    }

    if (!summary) {
      console.error("All Groq model attempts failed.", lastError);
      return res.type("text/plain").status(200).send(categorizedFallback || deterministicSummary);
    }

    return res.type("text/plain").status(200).send(summary);
  } catch (error) {
    console.error("Summarize request failed:", error);
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
});
