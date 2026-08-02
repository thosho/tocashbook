import { Link, useLocation, Outlet } from 'react-router-dom';
import { LayoutDashboard, PlusCircle, List, BarChart3, Settings, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import OfflineBanner from './OfflineBanner';
import { APP_NAME, APP_VERSION } from '../services/authUtils';

export default function SidebarLayout() {
  const location = useLocation();
  const currentPath = location.pathname;
  const { t } = useTranslation();

  return (
    <div className="app-layout">
      {/* Desktop Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2 style={{ fontSize: '1.25rem', margin: 0, color: 'var(--primary)' }}>{APP_NAME}</h2>
        </div>
        <div className="sidebar-nav">
          <Link to="/dashboard" className={`sidebar-item ${currentPath === '/dashboard' ? 'active' : ''}`}>
            <LayoutDashboard size={20} /> {t('nav.dashboard')}
          </Link>
          <Link to="/entry" className={`sidebar-item ${currentPath === '/entry' ? 'active' : ''}`}>
            <PlusCircle size={20} /> {t('dashboard.add_transaction')}
          </Link>
          <Link to="/entries" className={`sidebar-item ${currentPath === '/entries' ? 'active' : ''}`}>
            <List size={20} /> Entries
          </Link>
          <Link to="/reports" className={`sidebar-item ${currentPath === '/reports' ? 'active' : ''}`}>
            <BarChart3 size={20} /> {t('nav.reports')}
          </Link>
          <Link to="/parties" className={`sidebar-item ${currentPath === '/parties' ? 'active' : ''}`}>
            <Users size={20} /> {t('nav.parties')}
          </Link>
          <Link to="/settings" className={`sidebar-item ${currentPath === '/settings' ? 'active' : ''}`}>
            <Settings size={20} /> {t('nav.settings')}
          </Link>
        </div>
        <div className="sidebar-footer">
          <div style={{ fontWeight: 'bold' }}>{APP_NAME} {APP_VERSION}</div>
          <div>Developed by</div>
          <div>
            <a href="https://thoshotech.com" target="_blank" rel="noopener noreferrer">
              Thosho Tech
            </a>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main-content">
        <OfflineBanner />
        <Outlet />
      </div>

      {/* Mobile Bottom Nav */}
      <div className="bottom-nav mobile-only" style={{ position: 'relative' }}>
        <Link to="/dashboard" className={`bottom-nav-item ${currentPath === '/dashboard' ? 'active' : ''}`}>
          <LayoutDashboard size={22} />
          <span>{t('nav.dashboard')}</span>
        </Link>
        <Link to="/entries" className={`bottom-nav-item ${currentPath === '/entries' ? 'active' : ''}`}>
          <List size={22} />
          <span>Entries</span>
        </Link>
        
        {/* FAB Spacer & Button */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <div className="fab-container">
            <Link to="/entry" className="fab-button">
              <PlusCircle size={28} />
            </Link>
          </div>
        </div>

        <Link to="/reports" className={`bottom-nav-item ${currentPath === '/reports' ? 'active' : ''}`}>
          <BarChart3 size={22} />
          <span>{t('nav.reports')}</span>
        </Link>
        <Link to="/parties" className={`bottom-nav-item ${currentPath === '/parties' ? 'active' : ''}`}>
          <Users size={22} />
          <span>{t('nav.parties')}</span>
        </Link>
        {/* Settings is moved to a sidebar or inside dashboard on mobile, but if kept, we limit it to 4 visible items + FAB.
            Let's keep settings as it's small enough now with reduced font-size and FAB spacing. */}
        <Link to="/settings" className={`bottom-nav-item ${currentPath === '/settings' ? 'active' : ''}`}>
          <Settings size={22} />
          <span>{t('nav.settings')}</span>
        </Link>
      </div>
    </div>
  );
}
