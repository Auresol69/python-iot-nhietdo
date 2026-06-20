import React, { useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { LayoutGrid, Activity } from 'lucide-react';
import Dashboard from './components/Dashboard';
import Overview from './components/Overview';

const TABS = [
  { id: 'overview', label: 'Overview', Icon: LayoutGrid },
  { id: 'dashboard', label: 'Device Detail', Icon: Activity },
];

function App() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <>
      {/* Global toast notification container */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 6000,
          style: {
            background: '#1e1b2e',
            color: '#f1f0fb',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '12px',
            fontSize: '0.875rem',
            boxShadow: '0 4px 24px rgba(239, 68, 68, 0.2)',
            maxWidth: '380px',
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: '#1e1b2e',
            },
          },
        }}
      />

      {/* ── Global Nav Bar ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center gap-1 px-4 py-2 bg-[#161b22] border-b border-[#30363d]">
        <span className="text-xs font-bold text-[#00ffd5] tracking-widest mr-4 font-mono">
          IOT CORE
        </span>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150',
              activeTab === id
                ? 'bg-[#21262d] text-white border border-[#30363d]'
                : 'text-[#6e7681] hover:text-[#c9d1d9] hover:bg-[#21262d]/50',
            ].join(' ')}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </nav>

      {/* ── Page content, offset below fixed nav (40px) ── */}
      <div className="pt-10">
        {activeTab === 'overview' ? <Overview /> : <Dashboard />}
      </div>
    </>
  );
}

export default App;
