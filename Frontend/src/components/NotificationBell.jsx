import { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = "http://localhost:8080";

/**
 * NotificationBell component
 * Shows a bell icon with unread count badge. On click, opens a dropdown
 * panel that fetches and displays recent anomaly alerts from the backend.
 * Supports marking individual alerts or all alerts as read.
 * 
 * @param {number} newAlertCount - Incremented by parent when a new AnomalyDetected event arrives
 */
export default function NotificationBell({ newAlertCount = 0 }) {
  const [isOpen, setIsOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef(null);

  // Fetch unread alerts from the backend
  const fetchAlerts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/alerts/recent`);
      if (!res.ok) throw new Error("Failed to fetch alerts");
      const data = await res.json();
      setAlerts(data);
      setUnreadCount(data.length);
    } catch (err) {
      console.error("Error fetching alerts:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Re-fetch when parent signals a new anomaly arrived
  useEffect(() => {
    if (newAlertCount > 0) {
      fetchAlerts();
    }
  }, [newAlertCount, fetchAlerts]);

  // Fetch on first mount to show badge count
  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleToggle = () => {
    if (!isOpen) fetchAlerts(); // refresh list on open
    setIsOpen((prev) => !prev);
  };

  const handleMarkAsRead = async (id) => {
    try {
      await fetch(`${API_BASE}/api/alerts/${id}/read`, { method: "PATCH" });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Error marking alert as read:", err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await fetch(`${API_BASE}/api/alerts/read-all`, { method: "PATCH" });
      setAlerts([]);
      setUnreadCount(0);
    } catch (err) {
      console.error("Error marking all alerts as read:", err);
    }
  };

  const formatTimestamp = (ts) => {
    try {
      return new Date(ts).toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return ts;
    }
  };

  return (
    <div className="notification-bell-wrapper" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        className={`bell-btn ${unreadCount > 0 ? "bell-btn--active" : ""}`}
        onClick={handleToggle}
        aria-label={`Notifications (${unreadCount} unread)`}
        title="Anomaly Alerts"
      >
        <svg
          className={`bell-icon ${unreadCount > 0 ? "bell-shake" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="bell-badge" aria-label={`${unreadCount} unread alerts`}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="notification-dropdown">
          <div className="notification-header">
            <h3 className="notification-title">
              ⚠️ Anomaly Alerts
            </h3>
            {unreadCount > 0 && (
              <button className="mark-all-btn" onClick={handleMarkAllAsRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className="notification-body">
            {isLoading ? (
              <div className="notification-empty">
                <div className="notification-spinner" />
                <span>Loading alerts...</span>
              </div>
            ) : alerts.length === 0 ? (
              <div className="notification-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>All clear! No unread alerts.</span>
              </div>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} className="notification-item">
                  <div className="notification-item-content">
                    <div className="notification-item-header">
                      <span className="notification-device">{alert.deviceCode}</span>
                      <span className="notification-time">{formatTimestamp(alert.timestamp)}</span>
                    </div>
                    <div className="notification-stats">
                      <span className="notification-temp">
                        🌡️ {alert.temperature?.toFixed(2)}°C
                      </span>
                      <span className="notification-zscore">
                        Z-Score: <strong>{alert.zScore?.toFixed(3)}</strong>
                      </span>
                    </div>
                    <p className="notification-message">{alert.message}</p>
                  </div>
                  <button
                    className="dismiss-btn"
                    onClick={() => handleMarkAsRead(alert.id)}
                    title="Dismiss alert"
                    aria-label="Dismiss alert"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
