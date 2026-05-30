import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './Dashboard.jsx';
import Campaigns from './Campaigns.jsx';
import CampaignBuilder from './CampaignBuilder.jsx';
import CampaignDetail from './CampaignDetail.jsx';
import ContactsPage from './ContactsPage.jsx';
import ImportWizard from './ImportWizard.jsx';
import AnalyticsPage from './AnalyticsPage.jsx';
import InboxesPage from './InboxesPage.jsx';
import BlacklistPage from './BlacklistPage.jsx';
import QueuePage from './QueuePage.jsx';
import SettingsPage from './SettingsPage.jsx';
import ErrorLogsPage from './ErrorLogsPage.jsx';
import CalculatorLeadsPage from './CalculatorLeadsPage.jsx';

const I = {
  grid: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  mail: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>,
  users: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
  chart: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>,
  queue: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  inbox: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>,
  ban: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>,
  cog: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  logs: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/></svg>,
  calc: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="10" y2="18"/><line x1="14" y1="18" x2="16" y2="18"/></svg>,
};

function Sidebar() {
  const nav = (to, icon, label, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
      {icon}{label}
    </NavLink>
  );
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-icon">B</div>
        <div>
          <div className="logo-name">BotCipher Mail</div>
          <div className="logo-sub">Email Sequencer</div>
        </div>
      </div>
      <nav className="sidebar-nav">
        <div className="nav-label">Main</div>
        {nav('/', I.grid, 'Dashboard', true)}
        {nav('/campaigns', I.mail, 'Campaigns')}
        {nav('/contacts', I.users, 'Contacts')}
        {nav('/analytics', I.chart, 'Analytics')}
        {nav('/queue', I.queue, 'Queue')}
        <div className="nav-label" style={{ marginTop: 16 }}>Config</div>
        {nav('/inboxes', I.inbox, 'Inboxes')}
        {nav('/blacklist', I.ban, 'Blacklist')}
        {nav('/settings', I.cog, 'Settings')}
        <div className="nav-label" style={{ marginTop: 16 }}>Leads</div>
        {nav('/calculator-leads', I.calc, 'Calculator Leads')}
        <div className="nav-label" style={{ marginTop: 16 }}>Debug</div>
        {nav('/logs', I.logs, 'Error Logs')}
      </nav>
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>v3.1 · Production</div>
    </aside>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/campaigns/new" element={<CampaignBuilder />} />
            <Route path="/campaigns/:id/edit" element={<CampaignBuilder />} />
            <Route path="/campaigns/:id" element={<CampaignDetail />} />
            <Route path="/campaigns/:id/import" element={<ImportWizard />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/inboxes" element={<InboxesPage />} />
            <Route path="/blacklist" element={<BlacklistPage />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/logs" element={<ErrorLogsPage />} />
            <Route path="/calculator-leads" element={<CalculatorLeadsPage />} />
            <Route path="*" element={
              <div style={{ padding: 64, textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Page not found</div>
                <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>The page you're looking for doesn't exist</div>
                <a href="/" className="btn btn-primary" style={{ display: 'inline-flex' }}>← Back to Dashboard</a>
              </div>
            } />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
