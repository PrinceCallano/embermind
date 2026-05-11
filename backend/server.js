const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

let hasReceivedTelemetry = false;
let latestTelemetry = null;
let telemetryHistory = [];

app.get("/", (req, res) => {
  res.json({
    message: "NeuroBreak ALISTOVOLT API is running",
    has_data: hasReceivedTelemetry,
    latest: latestTelemetry,
  });
});

app.post("/api/telemetry", (req, res) => {
  const data = req.body;

  const ir1 = Number(data.ir1 ?? 0);
  const ir2 = Number(data.ir2 ?? 0);
  const current = Number(data.current ?? 0);
  const maxTemp = Number(data.max_temp ?? Math.max(ir1, ir2));

  latestTelemetry = {
    has_data: true,
    device_id: data.device_id ?? "neurobreak_esp32_001",
    ir1,
    ir2,
    max_temp: maxTemp,
    current,
    status: data.status ?? "Normal",
    class: Number(data.class ?? 0),
    light: Number(data.light ?? 0),
    buzzer: Number(data.buzzer ?? 0),
    relay: Number(data.relay ?? 1),
    sms_sent: Boolean(data.sms_sent ?? false),
    wifi_status: data.wifi_status ?? "connected",
    cloud_status: "online",
    timestamp: new Date().toISOString(),
  };

  hasReceivedTelemetry = true;
  telemetryHistory.unshift(latestTelemetry);
  telemetryHistory = telemetryHistory.slice(0, 200);

  console.log("Received telemetry:", latestTelemetry);

  res.json({
    success: true,
    message: "Telemetry received",
    latest: latestTelemetry,
  });
});

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

app.get("/api/history", (req, res) => {
  res.json({
    has_data: hasReceivedTelemetry,
    history: telemetryHistory,
  });
});

app.post("/api/reset", (req, res) => {
  hasReceivedTelemetry = false;
  latestTelemetry = null;
  telemetryHistory = [];

  res.json({
    success: true,
    message: "Telemetry reset. Waiting for ESP32 data.",
  });
});

app.listen(PORT, () => {
  console.log(`NeuroBreak API running on port ${PORT}`);
});
