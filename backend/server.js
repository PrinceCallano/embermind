require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ===============================
// SUPABASE SETUP
// ===============================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

const supabase =
  supabaseUrl && supabaseSecretKey
    ? createClient(supabaseUrl, supabaseSecretKey)
    : null;

if (!supabase) {
  console.warn("WARNING: Supabase is not configured.");
  console.warn("Telemetry will still work locally, but it will not be saved permanently.");
}

// ===============================
// LOCAL MEMORY CACHE
// ===============================

let hasReceivedTelemetry = false;
let latestTelemetry = null;
let telemetryHistory = [];

// ===============================
// HELPER FUNCTIONS
// ===============================

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function safeBoolean(value, fallback = false) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function normalizeTelemetry(data) {
  const ir1 = safeNumber(data.ir1, 0);
  const ir2 = safeNumber(data.ir2, 0);
  const current = safeNumber(data.current, 0);
  const maxTemp = safeNumber(data.max_temp, Math.max(ir1, ir2));
  const classValue = safeNumber(data.class, 0);

  let status = data.status;

  if (!status) {
    if (classValue === 0) status = "Normal";
    else if (classValue === 1) status = "Predictive";
    else if (classValue === 2) status = "Preventive";
    else if (classValue === 3) status = "Reactive";
    else status = "Unknown";
  }

  return {
    has_data: true,
    device_id: data.device_id ?? "neurobreak_esp32_001",
    ir1,
    ir2,
    max_temp: maxTemp,
    current,
    status,
    class: classValue,
    light: safeNumber(data.light, 0),
    buzzer: safeNumber(data.buzzer, 0),
    relay: safeNumber(data.relay, 1),
    sms_sent: safeBoolean(data.sms_sent, false),
    wifi_status: data.wifi_status ?? "connected",
    cloud_status: "online",
    timestamp: new Date().toISOString(),
  };
}

async function saveTelemetryToSupabase(telemetry, rawPayload) {
  if (!supabase) {
    return {
      saved: false,
      error: "Supabase is not configured",
    };
  }

  const { error } = await supabase.from("neurobreak_telemetry").insert([
    {
      device_id: telemetry.device_id,
      ir1: telemetry.ir1,
      ir2: telemetry.ir2,
      max_temp: telemetry.max_temp,
      current: telemetry.current,
      status: telemetry.status,
      class: telemetry.class,
      light: telemetry.light,
      buzzer: telemetry.buzzer,
      relay: telemetry.relay,
      sms_sent: telemetry.sms_sent,
      wifi_status: telemetry.wifi_status,
      cloud_status: telemetry.cloud_status,
      raw_payload: rawPayload,
    },
  ]);

  if (error) {
    console.error("Supabase insert error:", error.message);
    return {
      saved: false,
      error: error.message,
    };
  }

  return {
    saved: true,
    error: null,
  };
}

// ===============================
// ROUTES
// ===============================

app.get("/", (req, res) => {
  res.json({
    message: "NeuroBreak ALISTOVOLT API is running",
    has_data: hasReceivedTelemetry,
    latest: latestTelemetry,
    supabase_configured: Boolean(supabase),
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "API is healthy",
    has_data: hasReceivedTelemetry,
    supabase_configured: Boolean(supabase),
    timestamp: new Date().toISOString(),
  });
});

// ESP32 sends telemetry here
app.post("/api/telemetry", async (req, res) => {
  try {
    const data = req.body;

    latestTelemetry = normalizeTelemetry(data);
    hasReceivedTelemetry = true;

    telemetryHistory.unshift(latestTelemetry);
    telemetryHistory = telemetryHistory.slice(0, 200);

    const supabaseResult = await saveTelemetryToSupabase(latestTelemetry, data);

    console.log("Received telemetry:", latestTelemetry);

    res.json({
      success: true,
      message: "Telemetry received",
      saved_to_supabase: supabaseResult.saved,
      supabase_error: supabaseResult.error,
      latest: latestTelemetry,
    });
  } catch (error) {
    console.error("Telemetry route error:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to process telemetry",
      error: error.message,
    });
  }
});

// Dashboard gets latest live data here
app.get("/api/latest", (req, res) => {
  if (!hasReceivedTelemetry || !latestTelemetry) {
    return res.json({
      has_data: false,
      device_id: null,
      message: "Waiting for ESP32 telemetry",
    });
  }

  res.json(latestTelemetry);
});

// Local temporary history
app.get("/api/history", async (req, res) => {
  const limit = Math.min(safeNumber(req.query.limit, 200), 1000);

  // If Supabase is configured, return permanent saved history
  if (supabase) {
    const { data, error } = await supabase
      .from("neurobreak_telemetry")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Supabase history fetch error:", error.message);

      return res.json({
        has_data: hasReceivedTelemetry,
        source: "local_cache_fallback",
        error: error.message,
        history: telemetryHistory,
      });
    }

    return res.json({
      has_data: data.length > 0,
      source: "supabase",
      history: data,
    });
  }

  // If no Supabase, return local temporary history only
  res.json({
    has_data: hasReceivedTelemetry,
    source: "local_cache",
    history: telemetryHistory,
  });
});

// Action stream based on class/status changes
app.get("/api/action-stream", async (req, res) => {
  const limit = Math.min(safeNumber(req.query.limit, 500), 2000);

  if (!supabase) {
    const actions = [];

    for (let i = telemetryHistory.length - 1; i >= 0; i--) {
      const item = telemetryHistory[i];
      const previous = telemetryHistory[i + 1];

      if (!previous || item.class !== previous.class || item.status !== previous.status) {
        actions.push({
          timestamp: item.timestamp,
          status: item.status,
          class: item.class,
          max_temp: item.max_temp,
          current: item.current,
          light: item.light,
          buzzer: item.buzzer,
          relay: item.relay,
        });
      }
    }

    return res.json({
      source: "local_cache",
      actions: actions.reverse(),
    });
  }

  const { data, error } = await supabase
    .from("neurobreak_telemetry")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("Supabase action stream fetch error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch action stream",
      error: error.message,
    });
  }

  const actions = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const previous = data[i - 1];

    if (!previous || item.class !== previous.class || item.status !== previous.status) {
      actions.push({
        timestamp: item.created_at,
        status: item.status,
        class: item.class,
        max_temp: item.max_temp,
        current: item.current,
        light: item.light,
        buzzer: item.buzzer,
        relay: item.relay,
      });
    }
  }

  res.json({
    source: "supabase",
    actions,
  });
});

// Clears only local memory, not Supabase database
app.post("/api/reset", (req, res) => {
  hasReceivedTelemetry = false;
  latestTelemetry = null;
  telemetryHistory = [];

  res.json({
    success: true,
    message: "Local telemetry reset. Supabase saved data was not deleted.",
  });
});

// ===============================
// START SERVER
// ===============================

app.listen(PORT, () => {
  console.log(`NeuroBreak API running on port ${PORT}`);

  if (supabase) {
    console.log("Supabase storage: ENABLED");
  } else {
    console.log("Supabase storage: DISABLED");
  }
});