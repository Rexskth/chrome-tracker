const summaryEl = document.getElementById("summary");
const sitesListEl = document.getElementById("sites-list");
const totalTimeEl = document.getElementById("total-time");
const statusEl = document.getElementById("status");
const generateBtn = document.getElementById("generate-btn");
const openDashboardBtn = document.getElementById("open-dashboard-btn");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSummary(text) {
  const normalizedLines = [];
  String(text || "No summary yet. Click Generate.")
    .split("\n")
    .forEach((raw) => {
      const line = raw.trim();
      if (!line) {
        normalizedLines.push("");
        return;
      }

      // Handle: **Category** - site: x - site: y
      const headingInline = line.match(/^\*\*(.+?)\*\*(.*)$/);
      if (headingInline) {
        normalizedLines.push(`**${headingInline[1]}**`);
        const tail = headingInline[2].trim();
        if (tail) {
          tail
            .replace(/^\-\s*/, "")
            .split(/\s+-\s+/)
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((item) => normalizedLines.push(`- ${item}`));
        }
        return;
      }

      normalizedLines.push(line);
    });

  const lines = normalizedLines;
  const parts = [];
  let listOpen = false;

  const closeList = () => {
    if (listOpen) {
      parts.push("</ul>");
      listOpen = false;
    }
  };

  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) {
      closeList();
      return;
    }

    const heading = line.match(/^\*\*(.+)\*\*$/);
    if (heading) {
      closeList();
      parts.push(`<div class="summary-heading">${escapeHtml(heading[1])}</div>`);
      return;
    }

    if (line.startsWith("- ")) {
      if (!listOpen) {
        parts.push('<ul class="summary-list">');
        listOpen = true;
      }
      parts.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      return;
    }

    closeList();
    if (line.toLowerCase().startsWith("insight:")) {
      parts.push(`<p class="summary-insight">${escapeHtml(line)}</p>`);
      return;
    }
    parts.push(`<p class="summary-line">${escapeHtml(line)}</p>`);
  });

  closeList();
  summaryEl.innerHTML = parts.join("");
}

function formatTime(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderSites(data) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const totalSeconds = entries.reduce((sum, [, value]) => sum + value, 0);

  totalTimeEl.textContent = `Total: ${formatTime(totalSeconds)}`;

  if (entries.length === 0) {
    sitesListEl.innerHTML = "<li><span class='site'>No activity yet today.</span></li>";
    return;
  }

  sitesListEl.innerHTML = entries
    .map(
      ([site, seconds]) =>
        `<li><span class="site">${site}</span><span class="time">${formatTime(seconds)}</span></li>`
    )
    .join("");
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function sendMessage(type) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

async function loadInitialState() {
  try {
    setStatus("Loading data...");
    const response = await sendMessage("GET_DAILY_DATA");

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load activity data.");
    }

    renderSites(response.data || {});
    renderSummary(response.summary);
    setStatus("");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function generateSummary() {
  generateBtn.disabled = true;
  setStatus("Generating summary...");

  try {
    const response = await sendMessage("GENERATE_SUMMARY");

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to generate summary.");
    }

    renderSites(response.data || {});
    renderSummary(response.summary || "No summary generated.");
    setStatus("Summary updated.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    generateBtn.disabled = false;
  }
}

generateBtn.addEventListener("click", generateSummary);
openDashboardBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});
loadInitialState();
