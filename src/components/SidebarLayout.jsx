import { Link, useLocation, Outlet } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, List, BarChart3, Settings, Users } from 'lucide-react';
import OfflineBanner from './OfflineBanner';
import { useState, useEffect } from 'react';
import { getSettings } from '../services/localDb';

export default function SidebarLayout() {
  const location = useLocation();
  const currentPath = location.pathname;
  const [settings, setSettings] = useState({});

  useEffect(() => {
    getSettings().then(s => setSettings(s || {}));
  }, []);

  return (
    <div className="app-layout">
      {/* Desktop Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2 style={{ fontSize: '1.25rem', margin: 0, color: 'var(--primary)' }}>{settings.BrandName || 'ToCashBook'}</h2>
        </div>
        <div className="sidebar-nav">
          <Link to="/dashboard" className={`sidebar-item ${currentPath === '/dashboard' ? 'active' : ''}`}>
            <LayoutDashboard size={20} /> Dashboard
          </Link>
          <Link to="/entry" className={`sidebar-item ${currentPath === '/entry' ? 'active' : ''}`}>
            <PlusCircle size={20} /> Add Entry
          </Link>
          <Link to="/entries" className={`sidebar-item ${currentPath === '/entries' ? 'active' : ''}`}>
            <List size={20} /> Entries
          </Link>
          <Link to="/reports" className={`sidebar-item ${currentPath === '/reports' ? 'active' : ''}`}>
            <BarChart3 size={20} /> Reports
          </Link>
          <Link to="/parties" className={`sidebar-item ${currentPath === '/parties' ? 'active' : ''}`}>
            <Users size={20} /> Parties
          </Link>
          <Link to="/settings" className={`sidebar-item ${currentPath === '/settings' ? 'active' : ''}`}>
            <Settings size={20} /> Settings
          </Link>
        </div>
        <div className="sidebar-footer">
          <div style={{ fontWeight: 'bold' }}>{settings.BrandName || 'ToCashBook'}</div>
          <div>{settings.Tagline || 'Developed by Thosho Tech'}</div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main-content">
        <OfflineBanner />
        <Outlet />
      </div>

      {/* Mobile Bottom Nav */}
      <div className="bottom-nav mobile-only">
        <Link to="/dashboard" className={`bottom-nav-item ${currentPath === '/dashboard' ? 'active' : ''}`}>
          <LayoutDashboard size={22} />
          <span>Home</span>
        </Link>
        <Link to="/entry" className={`bottom-nav-item ${currentPath === '/entry' ? 'active' : ''}`}>
          <PlusCircle size={22} />
          <span>Add Entry</span>
        </Link>
        <Link to="/entries" className={`bottom-nav-item ${currentPath === '/entries' ? 'active' : ''}`}>
          <List size={22} />
          <span>Entries</span>
        </Link>
        <Link to="/reports" className={`bottom-nav-item ${currentPath === '/reports' ? 'active' : ''}`}>
          <BarChart3 size={22} />
          <span>Reports</span>
        </Link>
        <Link to="/parties" className={`bottom-nav-item ${currentPath === '/parties' ? 'active' : ''}`}>
          <Users size={22} />
          <span>Parties</span>
        </Link>
        <Link to="/settings" className={`bottom-nav-item ${currentPath === '/settings' ? 'active' : ''}`}>
          <Settings size={22} />
          <span>Settings</span>
        </Link>
      </div>
    </div>
  );
}
