const todayTotalEl = document.getElementById("today-total");
const weeklyTotalEl = document.getElementById("weekly-total");
const topSiteEl = document.getElementById("top-site");
const weeklySiteListEl = document.getElementById("weekly-site-list");
const summaryEl = document.getElementById("summary");
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh-btn");
const generateBtn = document.getElementById("generate-btn");

const todaySitesBarsEl = document.getElementById("today-sites-bars");
const weeklyTrendBarsEl = document.getElementById("weekly-trend-bars");
const focusProductiveEl = document.getElementById("focus-productive");
const focusDistractiveEl = document.getElementById("focus-distractive");
const focusProductiveLabelEl = document.getElementById("focus-productive-label");
const focusDistractiveLabelEl = document.getElementById("focus-distractive-label");

const PRODUCTIVE_HINTS = [
  "github.com",
  "stackoverflow.com",
  "chatgpt.com",
  "notion.so",
  "docs.google.com",
  "leetcode.com"
];

function formatTime(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

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
  String(text || "No summary yet. Click Generate Summary.")
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

function getDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getLast7DaysKeys() {
  const keys = [];
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    keys.push(getDayKey(d));
  }
  return keys;
}

function aggregateDashboardData(activities, summary) {
  const days = getLast7DaysKeys();
  const keySet = new Set(days);
  const todayKey = days[days.length - 1];

  const weeklyByDay = {};
  const weeklyBySite = {};
  const todayBySite = {};

  days.forEach((day) => {
    weeklyByDay[day] = 0;
  });

  activities.forEach((item) => {
    const duration = Number(item.duration) || 0;
    if (!item.url || duration <= 0) return;

    let dayKey = todayKey;
    if (item.timestamp) {
      const d = new Date(item.timestamp);
      if (!Number.isNaN(d.getTime())) {
        dayKey = getDayKey(d);
      }
    }

    if (!keySet.has(dayKey)) return;

    weeklyByDay[dayKey] += duration;
    if (!weeklyBySite[item.url]) weeklyBySite[item.url] = 0;
    weeklyBySite[item.url] += duration;

    if (dayKey === todayKey) {
      if (!todayBySite[item.url]) todayBySite[item.url] = 0;
      todayBySite[item.url] += duration;
    }
  });

  const weeklyTotal = Object.values(weeklyByDay).reduce((sum, value) => sum + value, 0);

  return {
    ok: true,
    summary: summary || "",
    todayBySite,
    weeklyByDay,
    weeklyBySite,
    weeklyTotal,
    days
  };
}

function readDashboardFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["activities", "ai_summary"], (result) => {
      const activities = Array.isArray(result.activities) ? result.activities : [];
      resolve(aggregateDashboardData(activities, result.ai_summary || ""));
    });
  });
}

function renderKpis(data) {
  const todayEntries = Object.entries(data.todayBySite).sort((a, b) => b[1] - a[1]);
  const weeklyEntries = Object.entries(data.weeklyBySite).sort((a, b) => b[1] - a[1]);
  const todayTotal = todayEntries.reduce((sum, [, sec]) => sum + sec, 0);

  todayTotalEl.textContent = formatTime(todayTotal);
  weeklyTotalEl.textContent = formatTime(data.weeklyTotal || 0);
  topSiteEl.textContent = weeklyEntries[0] ? weeklyEntries[0][0] : "No activity";
}

function renderWeeklyList(data) {
  const entries = Object.entries(data.weeklyBySite)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (entries.length === 0) {
    weeklySiteListEl.innerHTML = "<li><span class='site-name'>No activity in last 7 days.</span></li>";
    return;
  }

  const max = entries[0][1] || 1;

  weeklySiteListEl.innerHTML = entries
    .map(([site, sec]) => {
      const percent = Math.max(4, Math.round((sec / max) * 100));
      return `
        <li>
          <div class="site-row">
            <span class="site-name">${site}</span>
            <span class="site-time">${formatTime(sec)}</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${percent}%"></div></div>
        </li>
      `;
    })
    .join("");
}

function renderTodayBars(data) {
  const entries = Object.entries(data.todayBySite)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  if (entries.length === 0) {
    todaySitesBarsEl.innerHTML = "<li class='metric-row'><span class='site-name'>No activity tracked today.</span></li>";
    return;
  }

  const max = entries[0][1] || 1;

  todaySitesBarsEl.innerHTML = entries
    .map(([site, sec]) => {
      const percent = Math.max(5, Math.round((sec / max) * 100));
      return `
        <li class="metric-row">
          <div class="metric-head">
            <span class="metric-site">${site}</span>
            <span class="metric-time">${formatTime(sec)}</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${percent}%"></div>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderWeeklyTrend(data) {
  const values = data.days.map((day) => data.weeklyByDay[day] || 0);
  const max = Math.max(...values, 1);

  weeklyTrendBarsEl.innerHTML = data.days
    .map((day) => {
      const value = data.weeklyByDay[day] || 0;
      const percent = Math.max(2, Math.round((value / max) * 100));
      const label = day.slice(5);
      return `
        <div class="week-col">
          <span class="week-value">${Math.round(value / 60)}m</span>
          <div class="week-bar-wrap">
            <div class="week-bar" style="height:${percent}%"></div>
          </div>
          <span class="week-day">${label}</span>
        </div>
      `;
    })
    .join("");
}

function renderFocusSplit(data) {
  let productive = 0;
  let distractive = 0;

  Object.entries(data.weeklyBySite).forEach(([site, sec]) => {
    const lower = site.toLowerCase();
    const isProductive = PRODUCTIVE_HINTS.some((hint) => lower.includes(hint));
    if (isProductive) productive += sec;
    else distractive += sec;
  });

  const total = productive + distractive;
  const productivePercent = total > 0 ? Math.round((productive / total) * 100) : 0;
  const distractivePercent = total > 0 ? 100 - productivePercent : 0;

  focusProductiveEl.style.width = `${productivePercent}%`;
  focusDistractiveEl.style.width = `${distractivePercent}%`;

  focusProductiveLabelEl.textContent = `Productive: ${productivePercent}% (${formatTime(productive)})`;
  focusDistractiveLabelEl.textContent = `Distractive: ${distractivePercent}% (${formatTime(distractive)})`;
}

function renderAll(data) {
  renderKpis(data);
  renderWeeklyList(data);
  renderTodayBars(data);
  renderWeeklyTrend(data);
  renderFocusSplit(data);
  renderSummary(data.summary);
}

async function loadDashboard() {
  try {
    setStatus("Loading dashboard data...");
    const response = await readDashboardFromStorage();
    renderAll(response);
    setStatus("");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function generateSummary() {
  try {
    generateBtn.disabled = true;
    setStatus("Generating summary...");

    const response = await sendMessage("GENERATE_SUMMARY");
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to generate summary.");
    }

    await loadDashboard();
    setStatus("Summary updated.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    generateBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", loadDashboard);
generateBtn.addEventListener("click", generateSummary);

loadDashboard();
