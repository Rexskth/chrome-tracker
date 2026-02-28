const summaryEl = document.getElementById("summary");
const sitesListEl = document.getElementById("sites-list");
const totalTimeEl = document.getElementById("total-time");
const statusEl = document.getElementById("status");
const generateBtn = document.getElementById("generate-btn");

function formatTime(seconds) {
  const total = Number(seconds) || 0;
  const mins = Math.floor(total / 60);
  const secs = total % 60;

  if (mins > 0 && secs > 0) return `${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m`;
  return `${secs}s`;
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
    summaryEl.textContent = response.summary || "No summary yet. Click Generate.";
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
    summaryEl.textContent = response.summary || "No summary generated.";
    setStatus("Summary updated.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    generateBtn.disabled = false;
  }
}

generateBtn.addEventListener("click", generateSummary);
loadInitialState();
