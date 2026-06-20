import { useEffect, useRef, useState } from "react";
import * as signalR from "@microsoft/signalr";

/**
 * Custom hook to manage the SignalR connection lifecycle.
 * Handles automatic reconnects, logging, and callbacks for sensor updates,
 * device offline events, and anomaly detection alerts.
 * 
 * @param {string} hubUrl The URL of the SignalR hub.
 * @param {function} onSensorUpdate Callback for 'ReceiveSensorUpdate' event.
 * @param {function} onDeviceOffline Callback for 'DeviceOffline' event.
 * @param {function} onAnomalyDetected Callback for 'AnomalyDetected' event.
 */
export const useSignalR = (hubUrl, onSensorUpdate, onDeviceOffline, onAnomalyDetected) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const connectionRef = useRef(null);

  // Use refs to prevent recreating the SignalR event listeners when callbacks change.
  const onSensorUpdateRef = useRef(onSensorUpdate);
  const onDeviceOfflineRef = useRef(onDeviceOffline);
  const onAnomalyDetectedRef = useRef(onAnomalyDetected);

  useEffect(() => {
    onSensorUpdateRef.current = onSensorUpdate;
    onDeviceOfflineRef.current = onDeviceOffline;
    onAnomalyDetectedRef.current = onAnomalyDetected;
  }, [onSensorUpdate, onDeviceOffline, onAnomalyDetected]);

  useEffect(() => {
    if (!hubUrl) return;

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl)
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000]) // retry intervals
      .configureLogging(signalR.LogLevel.Information)
      .build();

    connectionRef.current = connection;

    let isMounted = true;

    // Register event listeners
    connection.on("ReceiveSensorUpdate", (deviceCode, metric) => {
      if (onSensorUpdateRef.current) {
        onSensorUpdateRef.current(deviceCode, metric);
      }
    });

    connection.on("DeviceOffline", (deviceCode) => {
      if (onDeviceOfflineRef.current) {
        onDeviceOfflineRef.current(deviceCode);
      }
    });

    // New: Listen for anomaly detection alerts from the backend
    connection.on("AnomalyDetected", (alertPayload) => {
      if (onAnomalyDetectedRef.current) {
        onAnomalyDetectedRef.current(alertPayload);
      }
    });

    // Register user connected/disconnected event listeners to silence warnings
    connection.on("UserConnected", () => {});
    connection.on("UserDisconnected", () => {});

    // Reconnecting handlers
    connection.onreconnecting((error) => {
      if (isMounted) {
        setIsConnected(false);
        setConnectionError("Reconnecting to WebSocket...");
      }
    });

    connection.onreconnected(() => {
      if (isMounted) {
        setIsConnected(true);
        setConnectionError(null);
      }
    });

    connection.onclose((error) => {
      if (isMounted) {
        setIsConnected(false);
        setConnectionError(error ? `Connection closed: ${error.message}` : "Connection closed");
      }
    });

    const start = async () => {
      try {
        await connection.start();
        if (isMounted) {
          setIsConnected(true);
          setConnectionError(null);
        }
      } catch (err) {
        // If unmounted, this was a planned stop during negotiation (React 18 StrictMode double mount)
        if (isMounted) {
          setIsConnected(false);
          setConnectionError("Failed to connect to SignalR hub");
          console.error("SignalR connection start failed:", err);
        }
      }
    };

    start();

    return () => {
      isMounted = false;
      if (connectionRef.current) {
        connectionRef.current.stop()
          .catch((err) => console.error("Error stopping SignalR connection:", err));
      }
    };
  }, [hubUrl]);

  return { isConnected, connectionError };
};
