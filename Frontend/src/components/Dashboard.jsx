import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useSignalR } from "../hooks/useSignalR";
import {
  Activity,
  Cpu,
  Database,
  Plus,
  RefreshCw,
  Sliders,
  Thermometer,
  Droplet,
  Wifi,
  WifiOff,
  AlertTriangle,
  Play,
  Square,
  X,
  Server
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from "recharts";

const API_BASE = "http://localhost:8080/api";
const SIGNALR_HUB_URL = "http://localhost:8080/hubs/sensor";

export default function Dashboard() {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);

  // Use a ref to prevent stale closures in SignalR callbacks
  const selectedDeviceRef = useRef(null);
  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);
  
  // Real-time states for the selected device
  const [currentMetrics, setCurrentMetrics] = useState({
    temperature: null,
    humidity: null,
    timestamp: null,
    isOnline: false
  });
  const [chartData, setChartData] = useState([]);
  
  // UI states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newDeviceCode, setNewDeviceCode] = useState("");
  const [newDeviceName, setNewDeviceName] = useState("");
  const [isVirtual, setIsVirtual] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [apiConnected, setApiConnected] = useState(true);

  // Simulation states
  const [isSimulating, setIsSimulating] = useState(false);
  const simIntervalRef = useRef(null);
  const [simConsole, setSimConsole] = useState([]);

  // Fetch device list from API
  const fetchDevices = async () => {
    try {
      const response = await axios.get(`${API_BASE}/metrics/devices`);
      setDevices(response.data);
      setApiConnected(true);
      setErrorMsg("");
    } catch (err) {
      console.error("Error fetching devices:", err);
      setApiConnected(false);
      setErrorMsg("Failed to connect to the backend API.");
    }
  };

  // Fetch latest status of selected device
  const fetchLatestStatus = async (deviceCode) => {
    try {
      const response = await axios.get(`${API_BASE}/metrics/${deviceCode}/latest`);
      const data = response.data;
      setCurrentMetrics({
        temperature: data.temperature,
        humidity: data.humidity,
        timestamp: data.timestamp,
        isOnline: data.isOnline
      });
    } catch (err) {
      console.error("Error fetching latest status:", err);
    }
  };

  // Fetch history for selected device
  const fetchHistory = async (deviceCode) => {
    try {
      const response = await axios.get(`${API_BASE}/metrics/${deviceCode}/history`);
      const metrics = response.data.metrics || [];
      // Recharts expects oldest data first, the API returns newest first
      const formatted = metrics
        .map(m => ({
          time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          temperature: m.temperature,
          humidity: m.humidity,
          rawTimestamp: m.timestamp
        }))
        .reverse();
      
      setChartData(formatted);
    } catch (err) {
      console.error("Error fetching history:", err);
    }
  };

  // Initial load
  useEffect(() => {
    fetchDevices();
  }, []);

  // Handle device selection
  const handleSelectDevice = (device) => {
    // Clean up simulation if switching devices
    if (isSimulating) {
      stopSimulation();
    }
    
    setSelectedDevice(device);
    fetchLatestStatus(device.deviceCode);
    fetchHistory(device.deviceCode);
  };

  // Define live updates callbacks
  const handleSensorUpdate = (deviceCode, metric) => {
    // 1. Update online state in sidebar list
    setDevices(prevDevices => 
      prevDevices.map(d => 
        d.deviceCode === deviceCode ? { ...d, isOnline: true } : d
      )
    );

    const currentSelected = selectedDeviceRef.current;
    // 2. If it's the currently selected device, update metrics & chart
    if (currentSelected && currentSelected.deviceCode === deviceCode) {
      setCurrentMetrics(prev => ({
        ...prev,
        temperature: metric.temperature,
        humidity: metric.humidity,
        timestamp: metric.timestamp,
        isOnline: true
      }));

      setChartData(prevData => {
        const newPoint = {
          time: new Date(metric.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          temperature: metric.temperature,
          humidity: metric.humidity,
          rawTimestamp: metric.timestamp
        };
        const updated = [...prevData, newPoint];
        // Cap chart data to 50 points
        if (updated.length > 50) {
          return updated.slice(updated.length - 50);
        }
        return updated;
      });
    }
  };

  const handleDeviceOffline = (deviceCode) => {
    // Update online state in sidebar list
    setDevices(prevDevices => 
      prevDevices.map(d => 
        d.deviceCode === deviceCode ? { ...d, isOnline: false } : d
      )
    );

    const currentSelected = selectedDeviceRef.current;
    // If it's the currently selected device, mark offline
    if (currentSelected && currentSelected.deviceCode === deviceCode) {
      setCurrentMetrics(prev => ({
        ...prev,
        isOnline: false
      }));
    }
  };

  // SignalR connection hook
  const { isConnected: signalRConnected, connectionError: signalRError } = useSignalR(
    SIGNALR_HUB_URL,
    handleSensorUpdate,
    handleDeviceOffline
  );

  // Handle virtual device creation
  const handleCreateDevice = async (e) => {
    e.preventDefault();
    if (!newDeviceCode || !newDeviceName) return;

    try {
      await axios.post(`${API_BASE}/Devices/create`, {
        deviceCode: newDeviceCode,
        name: newDeviceName,
        isVirtual: isVirtual
      });

      setIsModalOpen(false);
      setNewDeviceCode("");
      setNewDeviceName("");
      fetchDevices(); // Reload list
    } catch (err) {
      console.error("Error creating device:", err);
      alert(err.response?.data?.message || "Failed to create device.");
    }
  };

  // Local Simulation logic for Virtual Devices
  const startSimulation = () => {
    if (!selectedDevice || !selectedDevice.isVirtual) return;
    setIsSimulating(true);
    setSimConsole([`[Simulation] Started telemetry for ${selectedDevice.deviceCode}`]);

    let baseTemp = 25;
    let baseHumid = 60;

    simIntervalRef.current = setInterval(() => {
      // Simulate random walking values, occasionally exceeding 35C to test alert
      const tempDelta = (Math.random() - 0.45) * 4; // slight upward drift
      const humidDelta = (Math.random() - 0.5) * 5;

      baseTemp = Math.min(Math.max(baseTemp + tempDelta, 18), 45);
      baseHumid = Math.min(Math.max(baseHumid + humidDelta, 30), 95);

      const fakeMetric = {
        temperature: parseFloat(baseTemp.toFixed(1)),
        humidity: parseFloat(baseHumid.toFixed(1)),
        timestamp: new Date().toISOString()
      };

      // Call our update handler directly to simulate received network packet
      handleSensorUpdate(selectedDevice.deviceCode, fakeMetric);
      
      setSimConsole(prev => [
        `[${new Date().toLocaleTimeString()}] Sent metrics: Temp ${fakeMetric.temperature}°C, Humid ${fakeMetric.humidity}%`,
        ...prev.slice(0, 4)
      ]);
    }, 2000);
  };

  const stopSimulation = () => {
    setIsSimulating(false);
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    setSimConsole(prev => [`[Simulation] Stopped telemetry`, ...prev]);
  };

  // Clean up simulation on unmount
  useEffect(() => {
    return () => {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    };
  }, []);

  return (
    <div className="flex h-screen bg-[#0d1117] text-[#c9d1d9] font-sans">
      
      {/* Sidebar */}
      <aside className="w-80 bg-[#161b22] border-r border-[#30363d] flex flex-col justify-between">
        <div>
          {/* Header */}
          <div className="p-6 border-b border-[#30363d] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="text-neonCyan w-6 h-6 animate-pulse" />
              <span className="font-bold text-lg tracking-wider text-white">IOT CORE</span>
            </div>
            <button
              onClick={() => setIsModalOpen(true)}
              className="p-1.5 rounded-md bg-[#21262d] border border-[#30363d] hover:bg-[#30363d] text-neonCyan hover:text-white transition-all duration-200"
              title="Add Device"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* Connection Status Panel */}
          <div className="p-4 bg-[#0d1117] border-b border-[#30363d] text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-gray-400">
                <Server className="w-3.5 h-3.5" />
                <span>API Status:</span>
              </div>
              <span className={`font-semibold ${apiConnected ? "text-green-400" : "text-neonRed"}`}>
                {apiConnected ? "CONNECTED" : "OFFLINE"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-gray-400">
                <Wifi className="w-3.5 h-3.5" />
                <span>SignalR:</span>
              </div>
              <span className={`font-semibold ${signalRConnected ? "text-green-400" : signalRError ? "text-yellow-400 animate-pulse" : "text-neonRed"}`}>
                {signalRConnected ? "CONNECTED" : signalRError ? "CONNECTING..." : "OFFLINE"}
              </span>
            </div>
          </div>

          {/* Device list */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-gray-400 tracking-wider">DEVICES ({devices.length})</span>
              <button 
                onClick={fetchDevices} 
                className="text-gray-400 hover:text-white transition"
                title="Reload devices"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1 overflow-y-auto max-h-[60vh] pr-1">
              {devices.map((device) => {
                const isSelected = selectedDevice && selectedDevice.id === device.id;
                return (
                  <button
                    key={device.id}
                    onClick={() => handleSelectDevice(device)}
                    className={`w-full text-left p-3 rounded-lg border transition-all duration-200 flex items-center justify-between ${
                      isSelected
                        ? "bg-[#21262d] border-neonCyan text-white shadow-[0_0_8px_rgba(0,255,213,0.15)]"
                        : "bg-[#161b22] border-transparent hover:bg-[#21262d] hover:border-[#30363d]"
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm truncate max-w-[180px]">{device.name}</span>
                      <span className="text-xs text-gray-400 font-mono mt-0.5">{device.deviceCode}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {device.isVirtual && (
                        <span className="text-[9px] font-bold bg-[#30363d] text-neonCyan px-1.5 py-0.5 rounded uppercase tracking-wider">
                          VIRTUAL
                        </span>
                      )}
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          device.isOnline
                            ? "bg-green-400 shadow-[0_0_6px_#4ade80]"
                            : "bg-neonRed shadow-[0_0_6px_#ff4d4d]"
                        }`}
                      />
                    </div>
                  </button>
                );
              })}
              {devices.length === 0 && (
                <div className="text-center py-8 text-sm text-gray-500">No devices found.</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#30363d] text-[10px] text-gray-500 flex justify-between">
          <span>v1.0.0</span>
          <span>© 2026 IoT Dashboard</span>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 overflow-y-auto p-8 flex flex-col justify-start">
        {errorMsg && (
          <div className="mb-6 bg-red-950/40 border border-red-500/50 p-4 rounded-lg flex items-center gap-3 text-red-300">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-500" />
            <span className="text-sm">{errorMsg}</span>
          </div>
        )}

        {selectedDevice ? (
          <div className="space-y-6">
            
            {/* Selected Device Title */}
            <div className="flex items-center justify-between border-b border-[#30363d] pb-4">
              <div>
                <h1 className="text-2xl font-bold text-white tracking-wide">{selectedDevice.name}</h1>
                <p className="text-xs text-gray-400 font-mono mt-1">
                  Device Code: {selectedDevice.deviceCode} | Type: {selectedDevice.isVirtual ? "Virtual" : "Physical"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${
                  currentMetrics.isOnline 
                    ? "bg-green-950/40 border border-green-500/30 text-green-400" 
                    : "bg-red-950/40 border border-red-500/30 text-neonRed"
                }`}>
                  <span className={`w-2 h-2 rounded-full ${currentMetrics.isOnline ? "bg-green-400" : "bg-neonRed"}`} />
                  {currentMetrics.isOnline ? "ONLINE" : "OFFLINE"}
                </span>
              </div>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Temperature Card */}
              <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-xl flex items-center justify-between shadow-lg relative overflow-hidden group">
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-gray-400 tracking-wider">TEMPERATURE</span>
                  <div className={`text-4xl font-bold font-mono transition-colors duration-300 ${
                    currentMetrics.temperature > 35 ? "text-neonRed" : "text-neonCyan"
                  }`}>
                    {currentMetrics.temperature !== null ? `${currentMetrics.temperature.toFixed(1)} °C` : "--"}
                  </div>
                  <p className="text-[10px] text-gray-500">
                    {currentMetrics.temperature > 35 ? "⚠️ Temperature limit exceeded" : "Normal operating range"}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-[#0d1117] border border-[#30363d] text-[#30363d] group-hover:text-neonCyan transition">
                  <Thermometer className="w-8 h-8" />
                </div>
                {/* Visual indicator bar at the bottom */}
                <div className={`absolute bottom-0 left-0 right-0 h-1 transition-all ${
                  currentMetrics.temperature > 35 ? "bg-neonRed" : "bg-neonCyan"
                }`} />
              </div>

              {/* Humidity Card */}
              <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-xl flex items-center justify-between shadow-lg relative overflow-hidden group">
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-gray-400 tracking-wider">HUMIDITY</span>
                  <div className="text-4xl font-bold font-mono text-neonCyan">
                    {currentMetrics.humidity !== null ? `${currentMetrics.humidity.toFixed(1)} %` : "--"}
                  </div>
                  <p className="text-[10px] text-gray-500">Normal operating range</p>
                </div>
                <div className="p-4 rounded-lg bg-[#0d1117] border border-[#30363d] text-[#30363d] group-hover:text-neonCyan transition">
                  <Droplet className="w-8 h-8" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-neonCyan" />
              </div>

            </div>

            {/* Live Chart Section */}
            <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-xl shadow-lg">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Activity className="text-neonCyan w-4.5 h-4.5" />
                  <h3 className="font-semibold text-white tracking-wide">Real-time Telemetry (Last 50 points)</h3>
                </div>
                <span className="text-[10px] text-gray-400 bg-[#0d1117] border border-[#30363d] px-2 py-0.5 rounded font-mono">
                  AUTO REFRESHING
                </span>
              </div>
              <div className="h-80 w-full relative min-w-0">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                    <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                      <XAxis dataKey="time" stroke="#8b949e" style={{ fontSize: 10 }} />
                      <YAxis stroke="#8b949e" style={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#161b22", borderColor: "#30363d", borderRadius: 8 }}
                        labelStyle={{ color: "#fff", fontWeight: "bold" }}
                      />
                      <Legend style={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="temperature"
                        name="Temp (°C)"
                        stroke="#00ffd5"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="humidity"
                        name="Humidity (%)"
                        stroke="#58a6ff"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-gray-500">
                    Waiting for telemetry data...
                  </div>
                )}
              </div>
            </div>

            {/* Virtual Device Simulation Controls */}
            {selectedDevice.isVirtual && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Simulator Toggle Panel */}
                <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-xl shadow-lg flex flex-col justify-between lg:col-span-1">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-white">
                      <Sliders className="text-neonCyan w-4.5 h-4.5" />
                      <h3 className="font-semibold">Device Simulator</h3>
                    </div>
                    <p className="text-xs text-gray-400">
                      Simulate real-time temperature and humidity data for this virtual device directly in the web browser.
                    </p>
                  </div>

                  <div className="mt-6">
                    {isSimulating ? (
                      <button
                        onClick={stopSimulation}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-red-500/50 bg-red-950/20 hover:bg-red-950/40 text-red-400 hover:text-white transition duration-200 text-sm font-semibold"
                      >
                        <Square className="w-4 h-4 fill-red-400" />
                        Stop Simulation
                      </button>
                    ) : (
                      <button
                        onClick={startSimulation}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-neonCyan/50 bg-cyan-950/20 hover:bg-cyan-950/40 text-neonCyan hover:text-white transition duration-200 text-sm font-semibold shadow-[0_0_10px_rgba(0,255,213,0.05)]"
                      >
                        <Play className="w-4 h-4 fill-neonCyan" />
                        Start Simulation
                      </button>
                    )}
                  </div>
                </div>

                {/* Console Log Panel */}
                <div className="bg-[#161b22] border border-[#30363d] p-6 rounded-xl shadow-lg lg:col-span-2 flex flex-col">
                  <span className="text-xs font-semibold text-gray-400 tracking-wider mb-3">SIMULATOR TELEMETRY CONSOLE</span>
                  <div className="flex-1 bg-[#0d1117] border border-[#30363d] p-4 rounded-lg font-mono text-[11px] text-green-400 min-h-[120px] max-h-[140px] overflow-y-auto space-y-1">
                    {simConsole.map((log, index) => (
                      <div key={index} className="truncate">
                        {log}
                      </div>
                    ))}
                    {simConsole.length === 0 && (
                      <div className="text-gray-500 italic">Simulator offline. Toggle simulation ON to inspect packets...</div>
                    )}
                  </div>
                </div>

              </div>
            )}

          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
            <Database className="w-16 h-16 text-[#30363d] animate-pulse" />
            <div>
              <h2 className="text-xl font-bold text-white tracking-wide">Select a Device</h2>
              <p className="text-sm text-gray-500 max-w-sm mt-1">
                Choose a device from the left sidebar to inspect real-time sensor metrics and charting.
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Add Device Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#161b22] border border-[#30363d] w-full max-w-md rounded-xl shadow-2xl p-6 relative animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-bold text-white mb-4 tracking-wide">Register New Device</h2>
            <form onSubmit={handleCreateDevice} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">DEVICE CODE (MQTT TOPIC ID)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. esp32-room-4"
                  value={newDeviceCode}
                  onChange={(e) => setNewDeviceCode(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2.5 text-white placeholder-gray-600 focus:border-neonCyan focus:ring-1 focus:ring-neonCyan outline-none text-sm font-mono transition"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 mb-1">DEVICE DISPLAY NAME</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ESP32 Room 4 Temp Sensor"
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-4 py-2.5 text-white placeholder-gray-600 focus:border-neonCyan focus:ring-1 focus:ring-neonCyan outline-none text-sm transition"
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-white">Virtual Device</span>
                  <span className="text-[10px] text-gray-400">Enable local software simulation for this node</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isVirtual}
                    onChange={(e) => setIsVirtual(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#30363d] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-neonCyan"></div>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[#30363d]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-[#30363d] hover:bg-[#30363d] text-sm text-gray-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-neonCyan hover:bg-cyan-400 text-black font-semibold text-sm transition shadow-[0_0_12px_rgba(0,255,213,0.2)]"
                >
                  Create Device
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
