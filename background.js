let activeTabId = null;
let startTime = null;
let currentUrl = null;

const ignoredSites = ["newtab", "extensions"];

// ✅ Save activity
function saveActivity(url, duration) {
  if (!url || duration <= 0 || ignoredSites.includes(url)) return;

  chrome.storage.local.get(["activities"], (result) => {
    let activities = result.activities || [];

    activities.push({
      url,
      duration,
      timestamp: new Date().toISOString()
    });

    chrome.storage.local.set({ activities });
  });

  console.log("Saved:", url, duration);
}

// ✅ Main tracking logic (FIXED)
async function trackNewTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);

    // 🚫 Ignore invalid URLs
    if (
      !tab.url ||
      !tab.url.startsWith("http") ||
      tab.url.includes("chrome://") ||
      tab.url.includes("edge://")
    ) {
      return;
    }

    const now = Date.now();

    // ✅ Save previous tab time
    if (activeTabId && startTime && currentUrl) {
      const duration = Math.floor((now - startTime) / 1000);
      saveActivity(currentUrl, duration);
    }

    
    activeTabId = tabId;
    startTime = now;

    // ✅ Safe URL parsing
    const urlObj = new URL(tab.url);
    currentUrl = urlObj.hostname;

    console.log("Tracking:", currentUrl);

  } catch (error) {
    console.log("Skipping invalid tab:", error.message);
  }
}

// ✅ Tab switch
chrome.tabs.onActivated.addListener((activeInfo) => {
  trackNewTab(activeInfo.tabId);
});

// ✅ Tab update (URL change)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.status === "complete") {
    trackNewTab(tabId);
  }
});

// ✅ Idle detection (10 min)
chrome.idle.setDetectionInterval(600);

chrome.idle.onStateChanged.addListener((state) => {
  if (state === "idle" || state === "locked") {
    const now = Date.now();

    if (startTime && currentUrl) {
      const duration = Math.floor((now - startTime) / 1000);
      saveActivity(currentUrl, duration);
    }

    activeTabId = null;
    startTime = null;
    currentUrl = null;

    console.log("User idle — tracking stopped");
  }
});

// ============================
// 🤖 AI PART (READY)
// ============================

// ✅ Aggregate data
function getAggregatedData(callback) {
  chrome.storage.local.get(["activities"], (result) => {
    let activities = result.activities || [];
    let summary = {};

    activities.forEach((item) => {
      if (!summary[item.url]) summary[item.url] = 0;
      summary[item.url] += item.duration;
    });

    callback(summary);
  });
}

function isToday(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function getTodayAggregatedData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["activities"], (result) => {
      const activities = result.activities || [];
      const summary = {};

      activities.forEach((item) => {
        if (!isToday(item.timestamp)) return;
        if (!summary[item.url]) summary[item.url] = 0;
        summary[item.url] += item.duration;
      });

      resolve(summary);
    });
  });
}

// ✅ Call backend for AI summary
async function generateSummary() {
  const data = await getTodayAggregatedData();

  if (Object.keys(data).length === 0) {
    const emptyMessage = "No browsing activity tracked yet today.";
    chrome.storage.local.set({ ai_summary: emptyMessage });
    return emptyMessage;
  }

  const response = await fetch("http://localhost:5001/summarize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Summary API failed: ${response.status} ${errorText}`);
  }

  const result = await response.text();
  chrome.storage.local.set({ ai_summary: result });
  return result;
}

// Optional: expose function manually
globalThis.generateSummary = generateSummary;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_DAILY_DATA") {
    getTodayAggregatedData().then((data) => {
      chrome.storage.local.get(["ai_summary"], (result) => {
        sendResponse({
          ok: true,
          data,
          summary: result.ai_summary || ""
        });
      });
    });
    return true;
  }

  if (message?.type === "GENERATE_SUMMARY") {
    generateSummary()
      .then((summary) => {
        getTodayAggregatedData().then((data) => {
          sendResponse({
            ok: true,
            data,
            summary
          });
        });
      })
      .catch((error) => {
        console.error("Error calling AI:", error);
        sendResponse({
          ok: false,
          error: error.message || "Failed to generate summary."
        });
      });
    return true;
  }

  return false;
});
