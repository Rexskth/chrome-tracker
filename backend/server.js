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
  const totalSeconds = Number(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  if (mins > 0 && remainingSeconds > 0) {
    return `${mins} minute${mins === 1 ? "" : "s"} ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`;
  }

  if (mins > 0) {
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }

  return `${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`;
}

function formatActivity(data) {
  return Object.entries(data)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([site, seconds]) => `- ${site}: ${formatTime(Number(seconds))}`)
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

app.post("/summarize", (req, res) => {
  try {
    const validationError = validateInput(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const bulletSummary = formatActivity(req.body.data);
    return res.type("text/plain").status(200).send(bulletSummary);
  } catch (error) {
    console.error("Summarize request failed:", error);
    return res.status(500).json({ error: "Internal server error while formatting summary." });
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
