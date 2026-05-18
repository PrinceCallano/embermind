import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  Cpu,
  Flame,
  Gauge,
  MessageCircle,
  Power,
  Radio,
  Send,
  ShieldAlert,
  Thermometer,
  TimerReset,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";

const USE_DEMO_DATA = false;
const API_URL = "https://neurobreak-api.onrender.com/api/latest";
const MAX_HISTORY_POINTS = 36;

const COLORS = {
  ir1: "#ffffff",
  ir2: "#fb923c",
  maxTemp: "#f43f5e",
  current: "#7dd3fc",
  risk: "#f43f5e",
};

const STATE_META = {
  0: {
    label: "Normal",
    accent: "bg-emerald-400",
    text: "text-emerald-300",
    border: "border-emerald-400/30",
    glow: "shadow-[0_0_30px_rgba(74,222,128,0.25)]",
  },
  1: {
    label: "Predictive",
    accent: "bg-sky-400",
    text: "text-sky-300",
    border: "border-sky-400/30",
    glow: "shadow-[0_0_30px_rgba(56,189,248,0.25)]",
  },
  2: {
    label: "Preventive",
    accent: "bg-amber-400",
    text: "text-amber-300",
    border: "border-amber-400/30",
    glow: "shadow-[0_0_30px_rgba(251,191,36,0.28)]",
  },
  3: {
    label: "Reactive",
    accent: "bg-rose-500",
    text: "text-rose-300",
    border: "border-rose-500/30",
    glow: "shadow-[0_0_30px_rgba(244,63,94,0.30)]",
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatClock(date) {
  return new Intl.DateTimeFormat("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function getStateFromSignals(maxTemp, current) {
  if (maxTemp >= 90 || current >= 31) return 3;
  if (maxTemp >= 75 || current >= 26) return 2;
  if (maxTemp >= 60 || current >= 21) return 1;
  return 0;
}

function getActionLabel(state) {
  if (state === 3) return "Relay trip + SMS alert";
  if (state === 2) return "Warning light + buzzer";
  if (state === 1) return "Predictive notification";
  return "Monitor";
}

function scoreRisk(maxTemp, current) {
  const tempScore = clamp(((maxTemp - 35) / (95 - 35)) * 100, 0, 100);
  const currentScore = clamp(((current - 1) / (35 - 1)) * 100, 0, 100);
  return Math.round(tempScore * 0.68 + currentScore * 0.32);
}

function relayLabel(relayRaw) {
  return Number(relayRaw) === 0 ? "TRIPPED" : "READY";
}

function outputLabel(value) {
  return Number(value) === 1 ? "ON" : "OFF";
}

function normalizeTelemetry(data) {
  if (!data || data.has_data === false || data.device_id === null) {
    return {
      hasData: false,
      t: "--:--:--",
      timestamp: null,
      displayTimestamp: "Waiting for ESP32",
      deviceId: "No device yet",
      ir1: null,
      ir2: null,
      maxTemp: null,
      current: null,
      state: 0,
      status: "Waiting",
      risk: 0,
      light: 0,
      buzzer: 0,
      relay: 1,
      smsSent: false,
      wifiStatus: "waiting",
      cloudStatus: "waiting",
    };
  }

  const now = new Date();
  const ir1 = Number(data?.ir1 ?? data?.IR1 ?? 0);
  const ir2 = Number(data?.ir2 ?? data?.IR2 ?? 0);
  const maxTemp = Number(data?.max_temp ?? data?.maxTemp ?? Math.max(ir1, ir2));
  const current = Number(data?.current ?? data?.Current_A ?? 0);
  const state = Number(data?.class ?? data?.state ?? getStateFromSignals(maxTemp, current));
  const timestamp = data?.timestamp ? new Date(data.timestamp) : now;

return {
  hasData: true,
  t: formatClock(timestamp),
  timestamp: data?.timestamp ?? now.toISOString(),
    displayTimestamp: formatDateTime(timestamp),
    deviceId: data?.device_id ?? data?.deviceId ?? "neurobreak_esp32_001",
    ir1: Number(ir1.toFixed(2)),
    ir2: Number(ir2.toFixed(2)),
    maxTemp: Number(maxTemp.toFixed(2)),
    current: Number(current.toFixed(2)),
    state,
    status: data?.status ?? STATE_META[state]?.label ?? "Normal",
    risk: Number(data?.risk ?? scoreRisk(maxTemp, current)),
    light: Number(data?.light ?? 0),
    buzzer: Number(data?.buzzer ?? 0),
    relay: Number(data?.relay ?? 1),
    smsSent: Boolean(data?.sms_sent ?? data?.smsSent ?? false),
    wifiStatus: data?.wifi_status ?? data?.wifiStatus ?? "connected",
    cloudStatus: data?.cloud_status ?? data?.cloudStatus ?? "demo",
  };
}

function createDemoPoint(previous) {
  const last = previous ?? {
    ir1: 31.25,
    ir2: 30.91,
    current: 2.1,
  };

  const drift = Math.sin(Date.now() / 6000) * 0.55;
  const ir1 = clamp(last.ir1 + (Math.random() - 0.46) * 1.4 + drift, 26, 95);
  const ir2 = clamp(last.ir2 + (Math.random() - 0.47) * 1.5 + drift * 0.8, 26, 95);
  const current = clamp(last.current + (Math.random() - 0.5) * 1.1 + drift * 0.25, 0, 34);
  const maxTemp = Math.max(ir1, ir2);
  const state = getStateFromSignals(maxTemp, current);

  return normalizeTelemetry({
    device_id: "neurobreak_esp32_001",
    ir1,
    ir2,
    max_temp: maxTemp,
    current,
    class: state,
    status: STATE_META[state].label,
    light: state >= 2 ? 1 : 0,
    buzzer: state >= 2 ? 1 : 0,
    relay: state >= 3 ? 0 : 1,
    sms_sent: state >= 2,
    wifi_status: "connected",
    cloud_status: USE_DEMO_DATA ? "demo" : "online",
    timestamp: new Date().toISOString(),
  });
}

function seedDemoHistory() {
  const seed = [];
  let point = createDemoPoint();

  for (let i = MAX_HISTORY_POINTS - 1; i >= 0; i -= 1) {
    const timestamp = new Date(Date.now() - i * 1000);
    point = createDemoPoint(point);
    seed.push({
      ...point,
      t: formatClock(timestamp),
      timestamp: timestamp.toISOString(),
      displayTimestamp: formatDateTime(timestamp),
    });
  }

  return seed;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return isMobile;
}

function StatCard({ icon: Icon, label, value, subvalue, className = "" }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`rounded-[26px] border border-white/10 bg-white/5 p-5 backdrop-blur-xl ${className}`}
    >
      <div className="flex min-h-[165px] flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0 text-[11px] uppercase leading-5 tracking-[0.24em] text-white/45">
            {label}
          </div>
          <div className="flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/30 text-white/80">
            <Icon className="h-7 w-7" />
          </div>
        </div>

        <div>
          <div className="whitespace-nowrap text-[clamp(2rem,2.35vw,2.75rem)] font-black leading-none tracking-[-0.04em] text-white">
            {value}
          </div>
          <div className="mt-3 min-h-[42px] text-sm leading-6 text-white/55">
            {subvalue}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function SystemLinkPanel({ latest, currentState, connectionError, summary }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08, duration: 0.45 }}
      className="mt-4 sm:mt-6 rounded-[28px] sm:rounded-[34px] border border-white/10 bg-white/5 p-4 sm:p-6 lg:p-7 backdrop-blur-2xl"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">
            System link
          </div>
          <div className="mt-2 text-xl sm:text-2xl font-black tracking-tight">
            ESP32 → Cloud Dashboard
          </div>
        </div>

        <div
          className={`h-[28px] min-w-[96px] self-start sm:self-auto flex items-center justify-center rounded-full px-3 text-xs font-semibold whitespace-nowrap ${
            connectionError
              ? "bg-amber-500/15 text-amber-200"
              : latest.cloudStatus === "demo"
                ? "bg-sky-500/15 text-sky-200"
                : "bg-emerald-500/15 text-emerald-200"
          }`}
        >
          {connectionError ? "Offline" : latest.cloudStatus === "demo" ? "Demo Mode" : "Online"}
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
          <div className="flex items-center justify-between gap-3 text-sm text-white/55">
            <span>Hotspot Risk</span>
            <span
              className={`font-bold whitespace-nowrap ${
                latest.risk >= 80
                  ? "text-rose-300"
                  : latest.risk >= 60
                    ? "text-amber-200"
                    : "text-emerald-300"
              }`}
            >
              {latest.risk}%
            </span>
          </div>

          <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className={`h-full rounded-full ${
                currentState === 3
                  ? "bg-rose-500"
                  : currentState === 2
                    ? "bg-amber-400"
                    : currentState === 1
                      ? "bg-sky-400"
                      : "bg-emerald-400"
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(8, latest.risk)}%` }}
            />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-sm text-white/55">
                <Wifi className="h-4 w-4" />
                WiFi / Transport
              </div>
              <div className="mt-3 text-xl font-black capitalize">{latest.wifiStatus}</div>
              <div className="mt-1 text-sm text-white/45">ESP32 Telemetry Link</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-sm text-white/55">
                <Power className="h-4 w-4" />
                Control response
              </div>
              <div className="mt-3 text-lg font-black leading-tight">
                {getActionLabel(currentState)}
              </div>
              <div className="mt-1 text-sm text-white/45">Threshold Logic Active</div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm text-white/55">
            <Gauge className="h-4 w-4" />
            State Distribution
          </div>

          <div className="grid grid-cols-2 gap-2 text-center">
            {[0, 1, 2, 3].map((state) => (
              <div key={state} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className={`mx-auto h-2.5 w-10 rounded-full ${STATE_META[state].accent}`} />
                <div className="mt-3 text-2xl font-black">{summary.stateCounts[state]}</div>
                <div className="mt-1 text-[10px] uppercase tracking-[0.25em] text-white/45">
                  C{state}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function EventPill({ time, title, detail, severity }) {
  const tone = {
    low: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    mid: "border-sky-400/25 bg-sky-400/10 text-sky-200",
    high: "border-amber-400/25 bg-amber-400/10 text-amber-100",
    critical: "border-rose-400/25 bg-rose-400/10 text-rose-100",
  }[severity];

  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="text-sm font-semibold leading-5">{title}</div>
        <div className="text-[10px] uppercase tracking-[0.25em] opacity-70 whitespace-nowrap">
          {time}
        </div>
      </div>
      <div className="mt-2 text-sm opacity-80 leading-5">{detail}</div>
    </div>
  );
}

function ChartLegendItem({ color, label, unit }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-white/70">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-semibold text-white/85">{label}</span>
      <span className="text-white/40">{unit}</span>
    </div>
  );
}

function ThresholdLabel({ viewBox, value, stroke, isMobile }) {
  const fontSize = isMobile ? 10 : 11;
  const baseX = (viewBox?.x ?? 0) + 12;
  const baseY = viewBox?.y ?? 0;

  return (
    <text
      x={baseX}
      y={baseY}
      fill={stroke}
      fontSize={fontSize}
      fontWeight={700}
      opacity={1}
      textAnchor="start"
      dominantBaseline="middle"
    >
      {value}
    </text>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/90 p-3 text-xs text-white shadow-2xl backdrop-blur-xl">
      <div className="mb-2 font-bold text-white/80">{label}</div>
      <div className="space-y-1.5">
        {payload.map((item) => (
          <div key={item.dataKey} className="flex items-center justify-between gap-5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.stroke || item.color }} />
              <span className="text-white/70">{item.name}</span>
            </div>
            <span className="font-bold text-white">
              {item.value}
              {item.dataKey === "current" ? " A" : item.dataKey === "risk" ? "%" : " °C"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildAssistantReply(input, context) {
  const text = input.toLowerCase().trim();
  const { latest, stateMeta, events } = context;
  const recentEvent = events?.[0];

  if (!text) return "I can help with status, risk, sensor readings, output states, cloud link, and recent events.";

  if (text.includes("status") || text.includes("current state") || text === "state") {
    return `State: ${stateMeta.label}
IR1: ${latest.ir1}°C
IR2: ${latest.ir2}°C
Max temperature: ${latest.maxTemp}°C
Current: ${latest.current}A
Risk: ${latest.risk}%
Action: ${getActionLabel(latest.state)}.`;
  }

  if (text.includes("sensor") || text.includes("temperature") || text.includes("temp")) {
    return `Sensor readings:
IR1: ${latest.ir1}°C
IR2: ${latest.ir2}°C
Max temperature: ${latest.maxTemp}°C
Current: ${latest.current}A.`;
  }

  if (text.includes("relay") || text.includes("buzzer") || text.includes("light") || text.includes("sms")) {
    return `Output states:
Light: ${outputLabel(latest.light)}
Buzzer: ${outputLabel(latest.buzzer)}
Relay: ${relayLabel(latest.relay)}
SMS: ${latest.smsSent ? "SENT" : "READY"}.`;
  }

  if (text.includes("risk") || text.includes("safe") || text.includes("danger") || text.includes("stable")) {
    return `Risk: ${latest.risk}%
State: ${stateMeta.label}`;
  }

  if (text.includes("cloud") || text.includes("wifi") || text.includes("connection")) {
    return `Connection status:
WiFi: ${latest.wifiStatus}
Cloud: ${latest.cloudStatus}
Device ID: ${latest.deviceId}
Last update: ${latest.displayTimestamp}.`;
  }

  if (text.includes("event") || text.includes("recent") || text.includes("last")) {
    if (!recentEvent) return "No recent events available.";
    return `Latest event: ${recentEvent.title}
Time: ${recentEvent.time}
Detail: ${recentEvent.detail}`;
  }

  return "Try asking about sensor readings, current status, output states, relay, SMS, risk, WiFi/cloud connection, or recent events.";
}

function AssistantPanel({ isOpen, setIsOpen, messages, input, setInput, onSend, quickPrompts, isMobile }) {
  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-white/10 bg-black/80 px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:bg-black/90 ${
          isOpen ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <MessageCircle className="h-4 w-4" />
        <span className="hidden sm:inline">EMBERMIND AI</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" onClick={() => setIsOpen(false)}>
          <div
            className={`absolute ${isMobile ? "inset-x-3 bottom-3 top-20" : "bottom-4 right-4 top-4 w-[380px]"} rounded-[28px] border border-white/10 bg-[#0b0b0b]/95 shadow-[0_20px_70px_rgba(0,0,0,0.45)] backdrop-blur-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-full flex-col overflow-hidden rounded-[28px]">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Bot className="h-4 w-4" />
                    EMBERMIND AI
                  </div>
                  <div className="mt-1 text-xs text-white/45">Local dashboard assistant</div>
                </div>
                <button onClick={() => setIsOpen(false)} className="rounded-full border border-white/10 p-2 text-white/70 hover:bg-white/5">
                  {isMobile ? <ChevronDown className="h-4 w-4" /> : <X className="h-4 w-4" />}
                </button>
              </div>

              <div className="border-b border-white/10 px-5 py-3">
                <div className="flex flex-wrap gap-2">
                  {quickPrompts.map((prompt) => (
                    <button key={prompt} onClick={() => onSend(prompt)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10">
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {messages.map((message) => (
                  <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[88%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-white text-black" : "border border-white/10 bg-white/5 text-white/85"}`}>
                      {message.text}
                    </div>
                  </div>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onSend(input);
                }}
                className="border-t border-white/10 px-5 py-4"
              >
                <div className="flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    rows={1}
                    placeholder="Ask about status, sensors, outputs, relay, SMS, or cloud link..."
                    className="max-h-28 min-h-[46px] flex-1 resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/35 outline-none"
                  />
                  <button type="submit" className="flex h-[46px] w-[46px] items-center justify-center rounded-2xl bg-white text-black transition hover:scale-[1.02]">
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function EMBERMINDLiveDashboard() {
  const isMobile = useIsMobile();
  const [now, setNow] = useState(new Date());
  const [tick, setTick] = useState(0);
  const [events, setEvents] = useState([]);
  const [connectionError, setConnectionError] = useState(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      text: "EMBERMIND AI online. Ask about sensor readings, output states, status, risk, or cloud connection.",
    },
  ]);

  const [history, setHistory] = useState(() => (USE_DEMO_DATA ? seedDemoHistory() : []));

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    async function fetchLiveTelemetry() {
      try {
        if (USE_DEMO_DATA) {
          setHistory((prev) => {
            const next = createDemoPoint(prev[prev.length - 1]);
            return [...prev.slice(-(MAX_HISTORY_POINTS - 1)), next];
          });
          setConnectionError(null);
          setTick((value) => value + 1);
          return;
        }

        const response = await fetch(API_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const point = normalizeTelemetry(data);

        if (!point.hasData) {
          setHistory([]);
        } else {
          setHistory((prev) => [...prev.slice(-(MAX_HISTORY_POINTS - 1)), point]);
        }
        setConnectionError(null);
        setTick((value) => value + 1);
      } catch (error) {
        setConnectionError(error.message || "Connection failed");
        setTick((value) => value + 1);
      }
    }

    fetchLiveTelemetry();
    const interval = setInterval(fetchLiveTelemetry, 500);
    return () => clearInterval(interval);
  }, []);

  const latest = history[history.length - 1] ?? normalizeTelemetry(null);
  const hasData = latest.hasData !== false;
  const currentState = latest.state;
  const stateMeta = STATE_META[currentState] ?? STATE_META[0];
  const relayStatus = relayLabel(latest.relay);

  useEffect(() => {
    if (!latest || !hasData) return;

    const nowText = formatClock(new Date());
    const eventKey = connectionError ? "connection-error" : `state-${currentState}`;
    const severity = connectionError
      ? "high"
      : currentState === 3
        ? "critical"
        : currentState === 2
          ? "high"
          : currentState === 1
            ? "mid"
            : "low";

    const title = connectionError
      ? "Cloud connection warning"
      : currentState === 3
        ? "⚠️ Reactive condition active"
        : currentState === 2
          ? "⚠️ Preventive condition active"
          : currentState === 1
            ? "⚠️ Predictive condition active"
            : "Normal monitoring";

    const detail = connectionError
      ? `Dashboard could not fetch live telemetry: ${connectionError}`
      : currentState === 0
        ? `ESP32 stream stable. IR1 ${latest.ir1}°C / IR2 ${latest.ir2}°C / ${latest.current}A sampled.`
        : `${stateMeta.label} state from max temp ${latest.maxTemp}°C and current ${latest.current}A. Action: ${getActionLabel(currentState)}.`;

    setEvents((prev) => {
      const first = prev[0];

      if (first?.eventKey === eventKey) {
        const startTime = first.startTime ?? first.time ?? nowText;

        return [
          {
            ...first,
            time: startTime === nowText ? nowText : `${startTime}–${nowText}`,
            endTime: nowText,
            detail,
            severity,
          },
          ...prev.slice(1),
        ];
      }

      const nextEvent = {
        id: `${Date.now()}-${Math.random()}`,
        eventKey,
        startTime: nowText,
        endTime: nowText,
        time: nowText,
        title,
        detail,
        severity,
      };

      return [nextEvent, ...prev].slice(0, 6);
    });
  }, [currentState, latest, stateMeta, tick, connectionError, hasData]);

  const summary = useMemo(() => {
    if (history.length === 0) {
      return {
        avgIR1: "--",
        avgIR2: "--",
        avgCurrent: "--",
        stateCounts: { 0: 0, 1: 0, 2: 0, 3: 0 },
      };
    }

    const avgIR1 = history.reduce((sum, item) => sum + item.ir1, 0) / history.length;
    const avgIR2 = history.reduce((sum, item) => sum + item.ir2, 0) / history.length;
    const avgCurrent = history.reduce((sum, item) => sum + item.current, 0) / history.length;
    const stateCounts = history.reduce(
      (acc, item) => {
        acc[item.state] += 1;
        return acc;
      },
      { 0: 0, 1: 0, 2: 0, 3: 0 }
    );

    return {
      avgIR1: avgIR1.toFixed(1),
      avgIR2: avgIR2.toFixed(1),
      avgCurrent: avgCurrent.toFixed(2),
      stateCounts,
    };
  }, [history]);

  const quickPrompts = [
    "Explain current state",
    "Show sensor readings",
    "Show output states",
    "Is the system stable?",
    "Check cloud connection",
  ];

  function handleAssistantSend(rawText) {
    const text = rawText.trim();
    if (!text) return;

    const userMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      text,
    };

    setAssistantMessages((prev) => [...prev, userMessage]);
    setAssistantInput("");
    setAssistantOpen(true);

    const context = { latest, stateMeta, relayStatus, events };

    setAssistantMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-assistant`,
        role: "assistant",
        text: buildAssistantReply(text, context),
      },
    ]);
  }

  return (
    <div className="min-h-screen w-full overflow-hidden bg-[#050505] text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-0 h-[280px] w-[280px] sm:h-[440px] sm:w-[440px] rounded-full bg-fuchsia-600/20 blur-3xl" />
        <div className="absolute right-[-80px] top-[120px] h-[240px] w-[240px] sm:h-[420px] sm:w-[420px] rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="absolute bottom-[-100px] left-[28%] h-[240px] w-[240px] sm:h-[380px] sm:w-[380px] rounded-full bg-rose-500/15 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_30%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent_40%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:48px_48px] sm:bg-[size:64px_64px] opacity-[0.08]" />
      </div>

      <div className="relative w-full px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-6 2xl:px-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="rounded-[28px] sm:rounded-[34px] border border-white/10 bg-white/5 p-4 sm:p-6 lg:p-7 backdrop-blur-2xl"
        >
          <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
            <div className="min-w-0">
              <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] sm:text-[11px] uppercase tracking-[0.2em] sm:tracking-[0.28em] text-white/60">
                <Radio className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">EMBERMIND Live Monitoring Console</span>
              </div>
              <h1 className="max-w-[8ch] text-[2.4rem] font-black uppercase leading-[0.88] tracking-[-0.05em] text-white sm:text-4xl lg:text-5xl xl:text-[3.8rem] 2xl:text-[4.4rem]">
                EMBERMIND Dashboard
              </h1>
              <p className="mt-3 sm:mt-4 text-sm sm:text-base leading-6 text-white/65">
                IR1 · IR2 · Current · Outputs · Cloud Telemetry
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 xl:w-[360px] xl:justify-self-end xl:pl-6">
              <div className="rounded-3xl border border-white/10 bg-black/30 px-4 py-4 overflow-hidden min-h-[112px] flex flex-col justify-center">
                <div className="text-[10px] uppercase tracking-[0.28em] text-white/45">Local time</div>
                <div className="mt-2 h-[32px] flex items-center text-2xl font-semibold tracking-tight leading-none whitespace-nowrap">
                  {formatClock(now)}
                </div>
                <div className="mt-2 text-xs text-white/45">Manila</div>
              </div>

              <div className={`rounded-3xl border bg-black/30 px-4 py-4 overflow-hidden min-h-[112px] flex flex-col justify-center ${stateMeta.border} ${stateMeta.glow}`}>
                <div className="text-[10px] uppercase tracking-[0.28em] text-white/45">Current state</div>
                <div className={`mt-2 h-[32px] flex items-center text-2xl font-semibold tracking-tight leading-none whitespace-nowrap ${stateMeta.text}`}>
                  {stateMeta.label}
                </div>
                <div className="mt-2 text-xs text-white/55">Class {currentState}</div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Thermometer} label="IR1 Temp" value={hasData ? `${latest.ir1}°C` : "--"} subvalue={hasData ? "MLX90614 Sensor 1" : "Waiting for ESP32"} />
            <StatCard icon={Thermometer} label="IR2 Temp" value={hasData ? `${latest.ir2}°C` : "--"} subvalue={hasData ? "MLX90614 Sensor 2" : "Waiting for ESP32"} />
            <StatCard icon={Flame} label="Max Temp" value={hasData ? `${latest.maxTemp}°C` : "--"} subvalue={hasData ? "Highest Hotspot Value" : "Waiting for ESP32"} />
            <StatCard icon={Zap} label="Current" value={hasData ? `${latest.current}A` : "--"} subvalue={hasData ? "SCT-013 Current Sensor" : "Waiting for ESP32"} />
          </div>
        </motion.div>

        <SystemLinkPanel
          latest={latest}
          currentState={currentState}
          connectionError={connectionError}
          summary={summary}
        />

        <div className="mt-4 sm:mt-6 grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.45 }}
            className="rounded-[28px] sm:rounded-[34px] border border-white/10 bg-white/5 p-4 sm:p-6 lg:p-7 backdrop-blur-2xl"
          >
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">Live telemetry</div>
                <div className="mt-2 text-2xl sm:text-3xl font-black tracking-tight">IR Temperature + Current</div>
              </div>
              <div className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-white/55 self-start sm:self-auto">1-second refresh</div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              <ChartLegendItem color={COLORS.ir1} label="IR1" unit="Temperature" />
              <ChartLegendItem color={COLORS.ir2} label="IR2" unit="Temperature" />
              <ChartLegendItem color={COLORS.maxTemp} label="Max Temp" unit="Highest °C" />
              <ChartLegendItem color={COLORS.current} label="Current" unit="Amperes" />
            </div>

            <div className="h-[300px] sm:h-[350px] w-full rounded-[24px] sm:rounded-[28px] border border-white/10 bg-black/25 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 20, right: isMobile ? 10 : 14, left: isMobile ? 4 : 10, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="t"
                    stroke="rgba(255,255,255,0.28)"
                    tick={{ fill: "rgba(255,255,255,0.42)", fontSize: isMobile ? 9 : 11 }}
                    minTickGap={isMobile ? 60 : 28}
                    interval="preserveStartEnd"
                    axisLine={{ stroke: "rgba(255,255,255,0.22)" }}
                    tickLine={{ stroke: "rgba(255,255,255,0.18)" }}
                  />
                  <YAxis
                    yAxisId="left"
                    width={isMobile ? 30 : 42}
                    stroke="rgba(255,255,255,0.28)"
                    tick={{ fill: "rgba(255,255,255,0.42)", fontSize: isMobile ? 9 : 11 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.22)" }}
                    tickLine={{ stroke: "rgba(255,255,255,0.18)" }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    width={isMobile ? 30 : 42}
                    stroke="rgba(255,255,255,0.28)"
                    tick={{ fill: "rgba(255,255,255,0.42)", fontSize: isMobile ? 9 : 11 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.22)" }}
                    tickLine={{ stroke: "rgba(255,255,255,0.18)" }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine yAxisId="left" y={60} stroke="rgba(56,189,248,0.38)" strokeDasharray="6 6" ifOverflow="extendDomain" />
                  <ReferenceLine yAxisId="left" y={75} stroke="rgba(251,191,36,0.38)" strokeDasharray="6 6" ifOverflow="extendDomain" />
                  <ReferenceLine yAxisId="left" y={90} stroke="rgba(244,63,94,0.42)" strokeDasharray="6 6" ifOverflow="extendDomain" />
                  <Line yAxisId="left" type="monotone" dataKey="ir1" name="IR1 temperature" stroke={COLORS.ir1} strokeWidth={isMobile ? 2.2 : 3} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey="ir2" name="IR2 temperature" stroke={COLORS.ir2} strokeWidth={isMobile ? 2.2 : 3} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey="maxTemp" name="Max temperature" stroke={COLORS.maxTemp} strokeWidth={isMobile ? 2.2 : 3} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="current" name="Load current" stroke={COLORS.current} strokeWidth={isMobile ? 2 : 2.4} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.45 }}
            className="rounded-[28px] sm:rounded-[34px] border border-white/10 bg-white/5 p-4 sm:p-6 lg:p-7 backdrop-blur-2xl"
          >
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">Risk intensity</div>
                <div className="mt-2 text-2xl sm:text-3xl font-black tracking-tight">Risk Trend</div>
              </div>
              <div className={`h-[28px] min-w-[92px] self-start sm:self-auto flex items-center justify-center rounded-full px-3 text-xs font-semibold whitespace-nowrap ${latest.risk >= 70 ? "bg-rose-500/15 text-rose-200" : "bg-white/10 text-white/70"}`}>
                {latest.risk >= 70 ? "Escalated" : "Contained"}
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              <ChartLegendItem color={COLORS.risk} label="Risk" unit="Computed %" />
            </div>

            <div className="h-[300px] sm:h-[350px] w-full rounded-[24px] sm:rounded-[28px] border border-white/10 bg-black/25 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 20, right: isMobile ? 10 : 14, left: isMobile ? 6 : 14, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
                  <XAxis dataKey="t" stroke="rgba(255,255,255,0.28)" tick={{ fill: "rgba(255,255,255,0.42)", fontSize: isMobile ? 9 : 11 }} minTickGap={isMobile ? 60 : 28} interval="preserveStartEnd" />
                  <YAxis width={isMobile ? 30 : 42} stroke="rgba(255,255,255,0.28)" tick={{ fill: "rgba(255,255,255,0.42)", fontSize: isMobile ? 9 : 11 }} domain={[0, 100]} />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={35} stroke="rgba(56,189,248,0.38)" strokeDasharray="6 6" ifOverflow="extendDomain" />
                  <ReferenceLine y={60} stroke="rgba(251,191,36,0.38)" strokeDasharray="6 6" ifOverflow="extendDomain" />
                  <ReferenceLine y={80} stroke="rgba(244,63,94,0.42)" strokeDasharray="6 6" ifOverflow="extendDomain" />
                  <Area type="monotone" dataKey="risk" name="Risk" stroke={COLORS.risk} fill="url(#riskFill)" strokeWidth={isMobile ? 2 : 2.5} />
                  <defs>
                    <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.65} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>

        <div className="mt-4 sm:mt-6 grid gap-4 sm:gap-6 xl:grid-cols-4">
          <StatCard icon={AlertTriangle} label="Light" value={hasData ? outputLabel(latest.light) : "--"} subvalue="Warning Light" />
          <StatCard icon={Radio} label="Buzzer" value={hasData ? outputLabel(latest.buzzer) : "--"} subvalue="Audible Alert" />
          <StatCard icon={Power} label="Relay" value={hasData ? relayStatus : "--"} subvalue="Active-low Relay" />
          <StatCard icon={Send} label="SMS" value={hasData ? (latest.smsSent ? "SENT" : "READY") : "--"} subvalue="SIM800L Alert State" />
        </div>

        <div className="mt-4 sm:mt-6 grid gap-4 sm:gap-6 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.45 }} className="rounded-[28px] sm:rounded-[34px] border border-white/10 bg-white/5 p-4 sm:p-6 lg:p-7 backdrop-blur-2xl">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">Action stream</div>
                <div className="mt-2 text-2xl sm:text-3xl font-black tracking-tight">Recent Events</div>
              </div>
              <Activity className="h-5 w-5 text-white/45 shrink-0" />
            </div>
            <div className="space-y-3">
              {events.map((event) => (
                <EventPill key={event.id} {...event} />
              ))}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.45 }} className="rounded-[28px] sm:rounded-[34px] border border-white/10 bg-white/5 p-4 sm:p-6 lg:p-7 backdrop-blur-2xl">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">Architecture snapshot</div>
                <div className="mt-2 text-2xl sm:text-3xl font-black tracking-tight">System Overview</div>
              </div>
              <div className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-white/55 self-start sm:self-auto">Interim Cloud Architecture</div>
            </div>

            <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
              <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
                <div className="flex items-center gap-2 text-sm text-white/50"><Thermometer className="h-4 w-4" /> Sensor Edge Node</div>
                <div className="mt-3 text-2xl font-black">ESP32</div>
                <div className="mt-2 text-sm leading-6 text-white/60">Reads IR1, IR2, current, controls outputs, and sends telemetry to the cloud.</div>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
                <div className="flex items-center gap-2 text-sm text-white/50"><Cpu className="h-4 w-4" /> Cloud Dashboard</div>
                <div className="mt-3 text-2xl font-black">Web Monitor</div>
                <div className="mt-2 text-sm leading-6 text-white/60">Displays live telemetry, risk, system state, events, and output conditions.</div>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-black/30 p-5">
                <div className="flex items-center gap-2 text-sm text-white/50"><ShieldAlert className="h-4 w-4" /> Protection Layer</div>
                <div className="mt-3 text-2xl font-black">Outputs</div>
                <div className="mt-2 text-sm leading-6 text-white/60">Warning light, buzzer, active-low relay, and SIM800L SMS alert handling.</div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 grid-cols-1 md:grid-cols-4">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center gap-2 text-sm text-white/50"><TimerReset className="h-4 w-4" /> Avg IR1</div><div className="mt-3 text-3xl font-black">{summary.avgIR1}°C</div><div className="text-sm text-white/45">Rolling average</div></div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center gap-2 text-sm text-white/50"><TimerReset className="h-4 w-4" /> Avg IR2</div><div className="mt-3 text-3xl font-black">{summary.avgIR2}°C</div><div className="text-sm text-white/45">Rolling average</div></div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center gap-2 text-sm text-white/50"><Zap className="h-4 w-4" /> Avg Current</div><div className="mt-3 text-3xl font-black">{summary.avgCurrent}A</div><div className="text-sm text-white/45">Rolling current</div></div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center gap-2 text-sm text-white/50"><Gauge className="h-4 w-4" /> Device ID</div><div className="mt-3 text-lg font-black truncate">{latest.deviceId}</div><div className="text-sm text-white/45">Last: {latest.displayTimestamp}</div></div>
            </div>
          </motion.div>
        </div>
      </div>

      <AssistantPanel
        isOpen={assistantOpen}
        setIsOpen={setAssistantOpen}
        messages={assistantMessages}
        input={assistantInput}
        setInput={setAssistantInput}
        onSend={handleAssistantSend}
        quickPrompts={quickPrompts}
        isMobile={isMobile}
      />
    </div>
  );
}
