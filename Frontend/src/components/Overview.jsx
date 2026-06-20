import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useSignalR } from "../hooks/useSignalR";
import {
  Thermometer,
  Droplets,
  Wifi,
  WifiOff,
  AlertTriangle,
  LayoutGrid,
  RefreshCw,
} from "lucide-react";

const API_BASE = "http://localhost:8080/api";
const SIGNALR_HUB_URL = "http://localhost:8080/hubs/sensor";
const ANOMALY_CLEAR_DELAY_MS = 15_000;

// ─────────────────────────────────────────────────────────────────────────────
// DeviceCard — pure presentational, re-renders only when its own slice changes
// ─────────────────────────────────────────────────────────────────────────────
const DeviceCard = React.memo(function DeviceCard({ device }) {
  const {
    name,
    deviceCode,
    isOnline,
    temperature,
    humidity,
    timestamp,
    isAnomalous,
  } = device;

  const hasData = temperature !== null && temperature !== undefined;

  const tempColor =
    isAnomalous
      ? "text-red-400"
      : temperature > 35
      ? "text-orange-400"
      : "text-neonCyan";

  const formattedTime = timestamp
    ? new Date(timestamp).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";

  return (
    <div
      className={[
        // Base card style
        "relative flex flex-col bg-darkPanel rounded-2xl p-5 overflow-hidden",
        "transition-all duration-500 group",
        // Anomaly glow / normal border
        isAnomalous
          ? "border-2 border-red-500 shadow-[0_0_24px_rgba(239,68,68,0.75)] animate-pulse"
          : "border border-darkBorder hover:border-[#58a6ff]/40 shadow-lg hover:shadow-[0_4px_24px_rgba(0,0,0,0.4)]",
      ].join(" ")}
    >
      {/* ── Anomaly Badge ── */}
      {isAnomalous && (
        <div className="absolute top-3 right-3 flex items-center gap-1 bg-red-500/20 border border-red-500/60 text-red-400 text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider animate-pulse">
          <AlertTriangle className="w-3 h-3" />
          ANOMALY
        </div>
      )}

      {/* ── Subtle top accent bar ── */}
      <div
        className={`absolute top-0 left-0 right-0 h-[2px] transition-colors duration-500 ${
          isAnomalous
            ? "bg-red-500"
            : isOnline
            ? "bg-neonCyan"
            : "bg-[#30363d]"
        }`}
      />

      {/* ── Header: name + status dot ── */}
      <div className="flex items-start justify-between mb-4">
        <div className="min-w-0 pr-2">
          <h3 className="font-bold text-white text-sm leading-tight truncate">
            {name}
          </h3>
          <span className="font-mono text-[11px] text-[#6e7681] mt-0.5 block truncate">
            {deviceCode}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {isOnline ? (
            <>
              <span className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_6px_#4ade80]" />
              <span className="text-[10px] font-semibold text-green-400 tracking-wider">
                ONLINE
              </span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-[#6e7681]" />
              <span className="text-[10px] font-semibold text-[#6e7681] tracking-wider">
                OFFLINE
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Temperature (large) ── */}
      <div className="flex items-end justify-between mb-3">
        <div>
          <span className="text-[10px] font-semibold text-[#6e7681] tracking-widest block mb-1">
            TEMPERATURE
          </span>
          <span
            className={`font-mono font-bold text-4xl leading-none transition-colors duration-300 ${tempColor}`}
          >
            {hasData ? `${temperature.toFixed(1)}°` : "—"}
          </span>
          <span className={`font-mono text-base font-semibold ml-0.5 ${tempColor}`}>
            C
          </span>
        </div>
        <div
          className={`p-3 rounded-xl bg-[#0d1117] border border-darkBorder transition-colors duration-300 ${
            isAnomalous ? "text-red-400" : "text-neonCyan"
          } group-hover:border-[#58a6ff]/30`}
        >
          <Thermometer className="w-6 h-6" />
        </div>
      </div>

      {/* ── Divider ── */}
      <div className="border-t border-darkBorder mb-3" />

      {/* ── Humidity + timestamp row ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplets className="w-4 h-4 text-[#58a6ff]" />
          <span className="font-mono text-sm font-semibold text-[#58a6ff]">
            {hasData && humidity !== undefined && humidity !== null
              ? `${humidity.toFixed(1)}%`
              : "—"}
          </span>
          <span className="text-[10px] text-[#6e7681]">RH</span>
        </div>
        <span className="font-mono text-[10px] text-[#6e7681] tabular-nums">
          {formattedTime}
        </span>
      </div>

      {/* ── Wi-Fi icon (bottom-right watermark) ── */}
      <div className="absolute bottom-3 right-3 opacity-5 group-hover:opacity-10 transition-opacity">
        {isOnline ? (
          <Wifi className="w-8 h-8 text-white" />
        ) : (
          <WifiOff className="w-8 h-8 text-white" />
        )}
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Overview — main page component
// ─────────────────────────────────────────────────────────────────────────────
export default function Overview() {
  // deviceMap: { [deviceCode]: { name, deviceCode, isOnline, temperature, humidity, timestamp, isAnomalous } }
  // Using an object (Record) keyed by deviceCode for O(1) lookup on SignalR updates.
  const [deviceMap, setDeviceMap] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Track active anomaly timeouts so we can clear them on unmount (no memory leaks)
  const anomalyTimeoutsRef = useRef({});

  // ── Initial data fetch ──────────────────────────────────────────────────
  const fetchAllDevices = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/metrics/devices`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const devices = await res.json();

      // Build the initial map synchronously with info we already have
      const initialMap = {};
      for (const d of devices) {
        initialMap[d.deviceCode] = {
          name: d.name,
          deviceCode: d.deviceCode,
          isOnline: d.isOnline,
          temperature: null,
          humidity: null,
          timestamp: null,
          isAnomalous: false,
        };
      }
      setDeviceMap(initialMap);

      // Fetch latest status for each device in parallel
      const latestFetches = devices.map(async (d) => {
        try {
          const r = await fetch(`${API_BASE}/metrics/${d.deviceCode}/latest`);
          if (!r.ok) return null;
          const data = await r.json();
          return { deviceCode: d.deviceCode, data };
        } catch {
          return null;
        }
      });

      const results = await Promise.all(latestFetches);

      setDeviceMap((prev) => {
        const next = { ...prev };
        for (const result of results) {
          if (!result) continue;
          const { deviceCode, data } = result;
          if (next[deviceCode]) {
            next[deviceCode] = {
              ...next[deviceCode],
              temperature: data.temperature ?? null,
              humidity: data.humidity ?? null,
              timestamp: data.timestamp ?? null,
              isOnline: data.isOnline ?? next[deviceCode].isOnline,
            };
          }
        }
        return next;
      });
    } catch (err) {
      console.error("Overview: failed to load devices:", err);
      setLoadError("Failed to connect to the backend API.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllDevices();
  }, [fetchAllDevices]);

  // Cleanup all pending anomaly timeouts on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      Object.values(anomalyTimeoutsRef.current).forEach(clearTimeout);
    };
  }, []);

  // ── SignalR callbacks ───────────────────────────────────────────────────

  // "ReceiveSensorUpdate" — O(1) update of a single card
  const handleSensorUpdate = useCallback((deviceCode, metric) => {
    setDeviceMap((prev) => {
      if (!prev[deviceCode]) return prev; // unknown device, ignore
      return {
        ...prev,
        [deviceCode]: {
          ...prev[deviceCode],
          temperature: metric.temperature,
          humidity: metric.humidity,
          timestamp: metric.timestamp,
          isOnline: true,
        },
      };
    });
  }, []);

  // "DeviceOffline" — mark a single card offline
  const handleDeviceOffline = useCallback((deviceCode) => {
    setDeviceMap((prev) => {
      if (!prev[deviceCode]) return prev;
      return {
        ...prev,
        [deviceCode]: { ...prev[deviceCode], isOnline: false },
      };
    });
  }, []);

  // "AnomalyDetected" — glow card red for 15 seconds, then auto-clear
  const handleAnomalyDetected = useCallback((alertPayload) => {
    const deviceCode = alertPayload?.deviceCode;
    if (!deviceCode) return;

    // Set isAnomalous = true for that card
    setDeviceMap((prev) => {
      if (!prev[deviceCode]) return prev;
      return {
        ...prev,
        [deviceCode]: { ...prev[deviceCode], isAnomalous: true },
      };
    });

    // Cancel any existing timeout for this device (fresh anomaly resets the timer)
    if (anomalyTimeoutsRef.current[deviceCode]) {
      clearTimeout(anomalyTimeoutsRef.current[deviceCode]);
    }

    // Auto-clear after 15 seconds
    anomalyTimeoutsRef.current[deviceCode] = setTimeout(() => {
      setDeviceMap((prev) => {
        if (!prev[deviceCode]) return prev;
        return {
          ...prev,
          [deviceCode]: { ...prev[deviceCode], isAnomalous: false },
        };
      });
      delete anomalyTimeoutsRef.current[deviceCode];
    }, ANOMALY_CLEAR_DELAY_MS);
  }, []);

  // ── Wire up SignalR ─────────────────────────────────────────────────────
  const { isConnected, connectionError } = useSignalR(
    SIGNALR_HUB_URL,
    handleSensorUpdate,
    handleDeviceOffline,
    handleAnomalyDetected
  );

  // ── Derived values ──────────────────────────────────────────────────────
  const deviceList = Object.values(deviceMap);
  const onlineCount = deviceList.filter((d) => d.isOnline).length;
  const anomalyCount = deviceList.filter((d) => d.isAnomalous).length;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-darkBg text-[#c9d1d9] font-sans">
      {/* ── Page Header ── */}
      <div className="border-b border-darkBorder bg-[#161b22]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LayoutGrid className="text-neonCyan w-5 h-5" />
            <div>
              <h1 className="text-lg font-bold text-white tracking-wide leading-none">
                Multi-Device Overview
              </h1>
              <p className="text-[11px] text-[#6e7681] mt-0.5">
                Real-time monitoring across all connected nodes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Stat pills */}
            <div className="hidden sm:flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 bg-[#0d1117] border border-darkBorder px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-[#6e7681]" />
                <span className="text-[#8b949e]">Total:</span>
                <span className="font-bold text-white">{deviceList.length}</span>
              </span>
              <span className="flex items-center gap-1.5 bg-[#0d1117] border border-darkBorder px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-green-400 shadow-[0_0_4px_#4ade80]" />
                <span className="text-[#8b949e]">Online:</span>
                <span className="font-bold text-green-400">{onlineCount}</span>
              </span>
              {anomalyCount > 0 && (
                <span className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/40 px-3 py-1.5 rounded-full animate-pulse">
                  <AlertTriangle className="w-3 h-3 text-red-400" />
                  <span className="font-bold text-red-400">
                    {anomalyCount} Anomaly{anomalyCount > 1 ? "s" : ""}
                  </span>
                </span>
              )}
            </div>

            {/* SignalR status */}
            <div
              className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full border ${
                isConnected
                  ? "bg-green-500/10 border-green-500/30 text-green-400"
                  : connectionError
                  ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400 animate-pulse"
                  : "bg-red-500/10 border-red-500/30 text-red-400"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isConnected ? "bg-green-400" : "bg-red-400"
                }`}
              />
              {isConnected ? "LIVE" : connectionError ? "CONNECTING" : "OFFLINE"}
            </div>

            {/* Refresh button */}
            <button
              onClick={fetchAllDevices}
              disabled={isLoading}
              className="p-2 rounded-lg bg-[#21262d] border border-darkBorder hover:bg-[#30363d] text-[#8b949e] hover:text-white transition disabled:opacity-40"
              title="Refresh all devices"
            >
              <RefreshCw
                className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-screen-2xl mx-auto px-6 py-8">
        {/* Error banner */}
        {loadError && (
          <div className="mb-6 flex items-center gap-3 bg-red-950/40 border border-red-500/40 text-red-300 px-5 py-4 rounded-xl text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-500" />
            {loadError}
            <button
              onClick={fetchAllDevices}
              className="ml-auto text-xs underline underline-offset-2 hover:text-white transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && deviceList.length === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-48 bg-darkPanel border border-darkBorder rounded-2xl animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !loadError && deviceList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 gap-4 text-center">
            <LayoutGrid className="w-16 h-16 text-darkBorder" />
            <p className="text-lg font-bold text-white">No devices found</p>
            <p className="text-sm text-[#6e7681] max-w-xs">
              No devices are registered yet. Connect a physical device via MQTT
              or create a virtual device from the Dashboard.
            </p>
          </div>
        )}

        {/* Device grid */}
        {deviceList.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {deviceList.map((device) => (
              <DeviceCard key={device.deviceCode} device={device} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
