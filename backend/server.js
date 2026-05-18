// v2 - Embermind AI backend with Supabase grounding + free Gemini API fallback
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

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

function getStatusFromClass(classValue) {
  const numericClass = safeNumber(classValue, 0);

  if (numericClass === 0) return "Normal";
  if (numericClass === 1) return "Predictive";
  if (numericClass === 2) return "Preventive";
  if (numericClass === 3) return "Reactive";

  return "Unknown";
}

function isReactiveClass(row) {
  return safeNumber(row?.class, 0) === 3 || String(row?.status || "").toLowerCase() === "reactive";
}

function normalizeTelemetry(data) {
  const ir1 = safeNumber(data.ir1, 0);
  const ir2 = safeNumber(data.ir2, 0);
  const current = safeNumber(data.current, 0);
  const maxTemp = safeNumber(data.max_temp, Math.max(ir1, ir2));
  const classValue = safeNumber(data.class, 0);

  let status = data.status;

  if (!status) {
    status = getStatusFromClass(classValue);
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

async function fetchTelemetryRows(limit = 300) {
  const safeLimit = Math.min(safeNumber(limit, 300), 2000);

  if (supabase) {
    const result = await supabase
      .from("neurobreak_telemetry")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(safeLimit);

    if (result.error) {
      console.error("Supabase telemetry fetch error:", result.error.message);

      return {
        source: "local_cache_fallback",
        data: telemetryHistory,
        error: result.error.message,
      };
    }

    return {
      source: "supabase",
      data: result.data || [],
      error: null,
    };
  }

  return {
    source: "local_cache",
    data: telemetryHistory,
    error: null,
  };
}

function buildTelemetrySummary(data, source = "unknown") {
  if (!Array.isArray(data) || data.length === 0) {
    return {
      hasData: false,
      source,
      text: "No telemetry records are available.",
      summary: null,
    };
  }

  const latest = data[0];
  const oldest = data[data.length - 1];

  const maxTempRow = data.reduce((max, row) => {
    return safeNumber(row.max_temp, 0) > safeNumber(max.max_temp, 0) ? row : max;
  }, data[0]);

  const maxCurrentRow = data.reduce((max, row) => {
    return safeNumber(row.current, 0) > safeNumber(max.current, 0) ? row : max;
  }, data[0]);

  const average = (key) => {
    const total = data.reduce((sum, row) => sum + safeNumber(row[key], 0), 0);
    return Number((total / data.length).toFixed(2));
  };

  const normalRecords = data.filter((row) => safeNumber(row.class, 0) === 0);
  const predictiveRecords = data.filter((row) => safeNumber(row.class, 0) === 1);
  const preventiveRecords = data.filter((row) => safeNumber(row.class, 0) === 2);
  const reactiveRecords = data.filter((row) => safeNumber(row.class, 0) === 3);

  // Important:
  // Do NOT treat raw relay = 0 alone as a trip.
  // The actual shutdown/trip condition is Reactive/Class 3.
  const relayTripRecords = reactiveRecords;

  const buzzerActiveRecords = data.filter((row) => safeNumber(row.buzzer, 0) === 1);
  const lightActiveRecords = data.filter((row) => safeNumber(row.light, 0) === 1);

  let transitions = 0;
  let previousClass = safeNumber(oldest.class, 0);

  for (let i = data.length - 2; i >= 0; i -= 1) {
    const currentClass = safeNumber(data[i].class, 0);

    if (currentClass !== previousClass) {
      transitions += 1;
      previousClass = currentClass;
    }
  }

  const latestIrDifference = Math.abs(safeNumber(latest.ir1, 0) - safeNumber(latest.ir2, 0));

  const latestClass = safeNumber(latest.class, 0);
  const latestStatus = latest.status || getStatusFromClass(latestClass);

  const summary = {
    total_records_analyzed: data.length,
    source,

    time_range: {
      from: oldest.created_at || oldest.timestamp || null,
      to: latest.created_at || latest.timestamp || null,
    },

    latest_reading: {
      device_id: latest.device_id,
      ir1: safeNumber(latest.ir1, 0),
      ir2: safeNumber(latest.ir2, 0),
      max_temp: safeNumber(latest.max_temp, 0),
      current: safeNumber(latest.current, 0),
      status: latestStatus,
      class: latestClass,
      light: safeNumber(latest.light, 0),
      buzzer: safeNumber(latest.buzzer, 0),
      relay_raw: safeNumber(latest.relay, 1),
      relay_interpreted: isReactiveClass(latest) ? "TRIPPED" : "READY",
      sms_sent: safeBoolean(latest.sms_sent, false),
      timestamp: latest.created_at || latest.timestamp || null,
    },

    averages: {
      ir1: average("ir1"),
      ir2: average("ir2"),
      max_temp: average("max_temp"),
      current: average("current"),
    },

    highest_temperature: {
      value: safeNumber(maxTempRow.max_temp, 0),
      ir1: safeNumber(maxTempRow.ir1, 0),
      ir2: safeNumber(maxTempRow.ir2, 0),
      current: safeNumber(maxTempRow.current, 0),
      status: maxTempRow.status || getStatusFromClass(maxTempRow.class),
      class: safeNumber(maxTempRow.class, 0),
      timestamp: maxTempRow.created_at || maxTempRow.timestamp || null,
    },

    highest_current: {
      value: safeNumber(maxCurrentRow.current, 0),
      max_temp: safeNumber(maxCurrentRow.max_temp, 0),
      status: maxCurrentRow.status || getStatusFromClass(maxCurrentRow.class),
      class: safeNumber(maxCurrentRow.class, 0),
      timestamp: maxCurrentRow.created_at || maxCurrentRow.timestamp || null,
    },

    class_counts: {
      normal: normalRecords.length,
      predictive: predictiveRecords.length,
      preventive: preventiveRecords.length,
      reactive: reactiveRecords.length,
    },

    output_counts: {
      relay_trip_records: relayTripRecords.length,
      buzzer_active_records: buzzerActiveRecords.length,
      light_active_records: lightActiveRecords.length,
    },

    diagnostics: {
      class_transitions: transitions,
      latest_ir_sensor_difference: Number(latestIrDifference.toFixed(2)),
      possible_sensor_disagreement: latestIrDifference >= 5,
      relay_note:
        "Relay raw value may be affected by active-low wiring. Embermind treats Reactive/Class 3 as the true shutdown/trip condition.",
    },
  };

  const text = `
Telemetry summary:

Data source: ${source}
Records analyzed: ${summary.total_records_analyzed}

Time range:
- From: ${summary.time_range.from}
- To: ${summary.time_range.to}

Latest reading:
- Device ID: ${summary.latest_reading.device_id}
- IR1: ${summary.latest_reading.ir1} °C
- IR2: ${summary.latest_reading.ir2} °C
- Max temperature: ${summary.latest_reading.max_temp} °C
- Current: ${summary.latest_reading.current} A
- Status: ${summary.latest_reading.status}
- Class: ${summary.latest_reading.class}
- Light: ${summary.latest_reading.light}
- Buzzer: ${summary.latest_reading.buzzer}
- Relay raw value: ${summary.latest_reading.relay_raw}
- Relay interpreted state: ${summary.latest_reading.relay_interpreted}
- SMS sent: ${summary.latest_reading.sms_sent}
- Timestamp: ${summary.latest_reading.timestamp}

Averages:
- Average IR1: ${summary.averages.ir1} °C
- Average IR2: ${summary.averages.ir2} °C
- Average max temperature: ${summary.averages.max_temp} °C
- Average current: ${summary.averages.current} A

Highest temperature:
- Max temperature: ${summary.highest_temperature.value} °C
- IR1: ${summary.highest_temperature.ir1} °C
- IR2: ${summary.highest_temperature.ir2} °C
- Current at that time: ${summary.highest_temperature.current} A
- Status: ${summary.highest_temperature.status}
- Class: ${summary.highest_temperature.class}
- Timestamp: ${summary.highest_temperature.timestamp}

Highest current:
- Current: ${summary.highest_current.value} A
- Max temperature at that time: ${summary.highest_current.max_temp} °C
- Status: ${summary.highest_current.status}
- Class: ${summary.highest_current.class}
- Timestamp: ${summary.highest_current.timestamp}

Class counts:
- Normal: ${summary.class_counts.normal}
- Predictive: ${summary.class_counts.predictive}
- Preventive: ${summary.class_counts.preventive}
- Reactive: ${summary.class_counts.reactive}

Output activity:
- Relay trip records: ${summary.output_counts.relay_trip_records}
- Buzzer active records: ${summary.output_counts.buzzer_active_records}
- Light active records: ${summary.output_counts.light_active_records}

Diagnostics:
- Class transitions: ${summary.diagnostics.class_transitions}
- Latest IR sensor difference: ${summary.diagnostics.latest_ir_sensor_difference} °C
- Possible sensor disagreement: ${summary.diagnostics.possible_sensor_disagreement}
- Relay note: ${summary.diagnostics.relay_note}
`;

  return {
    hasData: true,
    source,
    text,
    summary,
  };
}

function buildSystemPrompt() {
  return `
You are Embermind AI, the dashboard assistant for the NeuroBreak residential circuit breaker thermal hotspot prevention system.

Your job:
- Explain the dashboard's sensor readings, saved telemetry, risk condition, output states, and event history.
- Answer using only the telemetry summary and system rules provided.
- Do not invent sensor readings, timestamps, states, relay trips, or events.
- If the data does not show an event, say it was not recorded in the analyzed data.

System classification rules:
- Class 0 = Normal
- Class 1 = Predictive
- Class 2 = Preventive
- Class 3 = Reactive

System action rules:
- Normal/Class 0 = monitoring only.
- Predictive/Class 1 = early warning or digital notification.
- Preventive/Class 2 = warning light and/or buzzer may be active.
- Reactive/Class 3 = dangerous condition requiring shutdown or relay action.

Critical relay rule:
- Treat Reactive/Class 3 as the true shutdown/trip condition.
- Do NOT treat raw relay = 0 alone as a relay trip.
- The relay raw value may be affected by active-low wiring or how the ESP32 reports the GPIO output.
- If latest status is Normal/Class 0, do not say the relay tripped unless the analyzed history contains Reactive/Class 3 records.

Safety rule:
- If the user asks what to physically do with wiring, breakers, live conductors, or electrical faults, advise them not to touch live electrical parts.
- Recommend turning off power only if safe and contacting a qualified person for inspection.

Response style:
- Answer only what the user asked.
- Do not automatically include latest readings unless the user asks for latest readings, status, summary, sensors, temperature, current, or telemetry.
- Do not mention relay rules unless the user asks about relay, trip, shutdown, output state, or raw relay value.
- Do not include unnecessary notes.
- Do not repeat the full telemetry summary unless the user asks for a summary/report/history.
- Be concise.
- Use actual values only when they directly answer the question.
- Mention whether the answer came from Supabase or fallback local cache only when relevant.
- Use simple language suitable for an electrical engineering thesis dashboard.
`;
}

async function askGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      error: "GEMINI_API_KEY is not configured",
      answer: null,
    };
  }

  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.25,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 700,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data?.error?.message || `Gemini API error: HTTP ${response.status}`,
        answer: null,
      };
    }

    const answer =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .join("\n")
        .trim() || null;

    if (!answer) {
      return {
        success: false,
        error: "Gemini returned no answer",
        answer: null,
      };
    }

    return {
      success: true,
      error: null,
      answer,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "Failed to call Gemini API",
      answer: null,
    };
  }
}

function buildLocalFallbackAnswer(message, telemetry, source) {
  if (!telemetry.hasData || !telemetry.summary) {
    return "I could not find stored telemetry data yet. Please send ESP32 data first, then ask again.";
  }

  const lower = String(message || "").toLowerCase();
  const summary = telemetry.summary;
  const latest = summary.latest_reading;

  if (
    lower.includes("relay") ||
    lower.includes("trip") ||
    lower.includes("shutdown")
  ) {
    return `Based on the analyzed ${source} telemetry, the relay should be interpreted using the system class, not raw relay value alone.

Latest state:
- Status: ${latest.status}
- Class: ${latest.class}
- Relay raw value: ${latest.relay_raw}
- Relay interpreted state: ${latest.relay_interpreted}

Relay trip records:
- ${summary.output_counts.relay_trip_records}

Important: Reactive/Class 3 is treated as the true shutdown or trip condition. Raw relay = 0 alone is not counted as a trip because your relay logic may be active-low.`;
  }

  if (
    lower.includes("highest") ||
    lower.includes("maximum") ||
    lower.includes("hottest") ||
    lower.includes("max temp")
  ) {
    return `Based on the analyzed ${source} telemetry:

Highest temperature:
- ${summary.highest_temperature.value} °C
- IR1: ${summary.highest_temperature.ir1} °C
- IR2: ${summary.highest_temperature.ir2} °C
- Current at that time: ${summary.highest_temperature.current} A
- Status: ${summary.highest_temperature.status}
- Class: ${summary.highest_temperature.class}
- Timestamp: ${summary.highest_temperature.timestamp}

Highest current:
- ${summary.highest_current.value} A
- Max temperature at that time: ${summary.highest_current.max_temp} °C
- Status: ${summary.highest_current.status}
- Class: ${summary.highest_current.class}
- Timestamp: ${summary.highest_current.timestamp}`;
  }

  if (
    lower.includes("summary") ||
    lower.includes("history") ||
    lower.includes("database") ||
    lower.includes("saved")
  ) {
    return `Saved telemetry summary from ${source}:
- Records analyzed: ${summary.total_records_analyzed}
- Time range: ${summary.time_range.from} to ${summary.time_range.to}
- Normal records: ${summary.class_counts.normal}
- Predictive records: ${summary.class_counts.predictive}
- Preventive records: ${summary.class_counts.preventive}
- Reactive records: ${summary.class_counts.reactive}
- Highest temperature: ${summary.highest_temperature.value} °C
- Highest current: ${summary.highest_current.value} A
- Relay trip records: ${summary.output_counts.relay_trip_records}

Latest reading:
- Status: ${latest.status}
- Class: ${latest.class}
- Max temperature: ${latest.max_temp} °C
- Current: ${latest.current} A`;
  }

  return `Latest telemetry from ${source}:
- Status: ${latest.status}
- Class: ${latest.class}
- IR1: ${latest.ir1} °C
- IR2: ${latest.ir2} °C
- Max temperature: ${latest.max_temp} °C
- Current: ${latest.current} A
- Relay interpreted state: ${latest.relay_interpreted}
- Timestamp: ${latest.timestamp}

Analyzed records:
- Total: ${summary.total_records_analyzed}
- Normal: ${summary.class_counts.normal}
- Predictive: ${summary.class_counts.predictive}
- Preventive: ${summary.class_counts.preventive}
- Reactive: ${summary.class_counts.reactive}

Note: Reactive/Class 3 is treated as the true trip condition, not raw relay = 0 alone.`;
}

// ===============================
// ROUTES
// ===============================

app.get("/", (req, res) => {
  res.json({
    message: "NeuroBreak EMBERMIND API is running",
    has_data: hasReceivedTelemetry,
    latest: latestTelemetry,
    supabase_configured: Boolean(supabase),
    gemini_configured: Boolean(process.env.GEMINI_API_KEY),
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "API is healthy",
    has_data: hasReceivedTelemetry,
    supabase_configured: Boolean(supabase),
    gemini_configured: Boolean(process.env.GEMINI_API_KEY),
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

// Local temporary history or Supabase permanent history
app.get("/api/history", async (req, res) => {
  const limit = Math.min(safeNumber(req.query.limit, 200), 1000);

  const result = await fetchTelemetryRows(limit);

  res.json({
    has_data: result.data.length > 0,
    source: result.source,
    error: result.error,
    history: result.data,
  });
});

// Embermind AI context based on stored Supabase telemetry
app.get("/api/ai-context", async (req, res) => {
  try {
    const limit = Math.min(safeNumber(req.query.limit, 300), 2000);
    const result = await fetchTelemetryRows(limit);

    const telemetry = buildTelemetrySummary(result.data, result.source);

    if (!telemetry.hasData) {
      return res.json({
        success: true,
        source: result.source,
        has_data: false,
        context: "No stored telemetry data is available yet. Embermind AI is waiting for ESP32 sensor data.",
        latest: null,
        summary: null,
        error: result.error,
      });
    }

    const context = `
Embermind AI telemetry context:

${telemetry.text}

System interpretation rules:
- Class 0 means Normal.
- Class 1 means Predictive.
- Class 2 means Preventive.
- Class 3 means Reactive.
- Predictive means early warning.
- Preventive means warning plus local alert.
- Reactive means dangerous condition requiring shutdown or relay action.
- Reactive/Class 3 is the true shutdown/trip condition.
- Raw relay value must not be treated as a relay trip by itself.
- Relay raw value may be affected by active-low wiring or ESP32 GPIO reporting.
`;

    res.json({
      success: true,
      source: result.source,
      has_data: true,
      context,
      latest: telemetry.summary.latest_reading,
      summary: telemetry.summary,
      error: result.error,
    });
  } catch (error) {
    console.error("AI context route error:", error.message);

    res.status(500).json({
      success: false,
      message: "Failed to generate Embermind AI context",
      error: error.message,
    });
  }
});

// Stronger Embermind AI endpoint using free Gemini API with local fallback
app.post("/api/embermind-ai", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const limit = Math.min(safeNumber(req.body?.limit, 300), 1000);

    if (!message) {
      return res.status(400).json({
        success: false,
        answer: "Please enter a question for Embermind AI.",
      });
    }

    const result = await fetchTelemetryRows(limit);
    const telemetry = buildTelemetrySummary(result.data, result.source);

    const prompt = `
${buildSystemPrompt()}

Data source: ${result.source}

${telemetry.text}

User question:
${message}
`;

    const aiResult = await askGemini(prompt);

    let answer;
    let aiProvider;

    if (aiResult.success) {
      answer = aiResult.answer;
      aiProvider = "gemini-free-api";
    } else {
      console.error("Gemini fallback used:", aiResult.error);
      answer = buildLocalFallbackAnswer(message, telemetry, result.source);
      aiProvider = "local-fallback";
    }

    res.json({
      success: true,
      source: result.source,
      ai_provider: aiProvider,
      answer,
      summary: telemetry.summary,
      supabase_error: result.error,
      ai_error: aiResult.success ? null : aiResult.error,
    });
  } catch (error) {
    console.error("Embermind AI route error:", error.message);

    res.status(500).json({
      success: false,
      answer: "Embermind AI failed to process the request.",
      error: error.message,
    });
  }
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
          relay_interpreted: isReactiveClass(item) ? "TRIPPED" : "READY",
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
        relay_interpreted: isReactiveClass(item) ? "TRIPPED" : "READY",
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
  console.log(`NeuroBreak EMBERMIND API running on port ${PORT}`);

  if (supabase) {
    console.log("Supabase storage: ENABLED");
  } else {
    console.log("Supabase storage: DISABLED");
  }

  if (process.env.GEMINI_API_KEY) {
    console.log("Gemini AI: ENABLED");
  } else {
    console.log("Gemini AI: DISABLED - local fallback will be used");
  }
});
