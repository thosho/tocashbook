import { useState, useEffect } from 'react';
import { getUsers, saveUsers, getCategories, saveCategories, exportDatabase, importDatabase, getSettings, setSettings, getApiSecret, setApiSecret, getApiLink, setApiLink } from '../services/localDb';
import { pushUsers, pushCategories, pushSettings } from '../services/sheetsApi';
import { hashPIN } from '../services/authUtils';
import { subscribePush, getNotificationPermission } from '../services/notificationService';
import { Plus, Trash2, Download, Upload, Save, Sun, Moon, Monitor, Bell, BellOff, BellRing, Contact, Shield, Share2, Mail, Globe, Link2, LogOut } from 'lucide-react';
import html2canvas from 'html2canvas';
import { useTranslation } from 'react-i18next';
import LanguageSelector from './LanguageSelector';

export default function BossSettings({ setSessionTimeout, setAuthUser }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [settings, setLocalSettings] = useState({ BrandName: '', Address: '', Phone: '', UpiId: '', DateFormat: 'MM/DD/YYYY', DarkMode: 'auto', OpeningBalance: '0', SessionTimeout: '30', NtfyTopic: '' });
  const [adminUser, setAdminUser] = useState({ phone: 'boss', pin: '' });
  const [apiLink, setApiLinkState] = useState('');
  const [apiSecret, setApiSecretState] = useState('');
  const [newUser, setNewUser] = useState({ name: '', phone: '', pin: '' });
  const [newCategory, setNewCategory] = useState({ name: '', type: 'Income' });
  const [saving, setSaving] = useState(false);
  const [notifPermission, setNotifPermission] = useState('default');
  const [notifLoading, setNotifLoading] = useState(false);

  useEffect(() => {
    loadData();
    setNotifPermission(getNotificationPermission());
  }, []);

  const loadData = async () => {
    const allUsers = await getUsers();
    const staff = allUsers.filter(u => u.Role !== 'Admin');
    const admin = allUsers.find(u => u.Role === 'Admin') || { Phone: 'boss', PIN: '1234' };
    setUsers(staff);
    setAdminUser({ phone: admin.Phone || admin.Username || 'boss', pin: '' }); // keep pin empty unless changed
    setCategories(await getCategories());
    setLocalSettings(await getSettings());
    setApiLinkState((await getApiLink()) || '');
    setApiSecretState((await getApiSecret()) || '');
  };

  // BUG FIX #12: Apply dark mode to document when setting changes
  const applyDarkMode = (mode) => {
    if (mode === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (mode === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  };

  const handleDarkModeChange = async (mode) => {
    const updated = { ...settings, DarkMode: mode };
    setLocalSettings(updated);
    await setSettings(updated); // Persist immediately locally
    applyDarkMode(mode);
  };

  const handlePickContact = async () => {
    if ('contacts' in navigator && 'ContactsManager' in window) {
      try {
        const props = ['name', 'tel'];
        const contacts = await navigator.contacts.select(props, { multiple: false });
        if (contacts.length > 0) {
          const c = contacts[0];
          setNewUser(prev => ({
            ...prev,
            name: c.name ? c.name[0] : '',
            phone: c.tel ? c.tel[0].replace(/\\D/g, '') : ''
          }));
        }
      } catch (ex) {
        // user cancelled or error
      }
    } else {
      alert('Contact picker is not supported on this browser. Please enter manually.');
    }
  };

  const handleShareCard = async () => {
    const cardElement = document.getElementById('business-card');
    if (!cardElement) return;
    
    try {
      const canvas = await html2canvas(cardElement, { scale: 2, useCORS: true, backgroundColor: null });
      const dataUrl = canvas.toDataURL('image/png');
      const blob = await (await fetch(dataUrl)).blob();
      
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], 'card.png', { type: 'image/png' })] })) {
        await navigator.share({
          title: settings.BrandName,
          text: `Here is our business card for ${settings.BrandName}!`,
          files: [new File([blob], 'card.png', { type: 'image/png' })]
        });
      } else {
        // Fallback to download
        const link = document.createElement('a');
        link.download = `${settings.BrandName || 'Business'}_Card.png`;
        link.href = dataUrl;
        link.click();
      }
    } catch (err) {
      alert('Failed to generate card: ' + err.message);
    }
  };

  const handleAddUser = async () => {
    if (!newUser.phone || !newUser.pin) return;
    const hashedPIN = await hashPIN(newUser.pin);
    const newEntry = { ID: 'u_' + Date.now(), Name: newUser.name, Phone: newUser.phone, Username: newUser.phone, PIN: hashedPIN, Role: 'Staff', IsActive: 'TRUE' };
    const updated = [...users, newEntry];
    setUsers(updated);
    setNewUser({ name: '', phone: '', pin: '' });
    // BUG-02 FIX: Immediately save to localforage so staff can login right away
    const adminRecord = (await getUsers()).find(u => u.Role === 'Admin') || { ID: 'boss_1', Name: 'Admin', Role: 'Admin', IsActive: 'TRUE' };
    await saveUsers([...updated, adminRecord]);
  };

  const handleDeleteUser = async (id) => {
    const updated = users.filter(u => u.ID !== id);
    setUsers(updated);
    const adminRecord = (await getUsers()).find(u => u.Role === 'Admin') || { ID: 'boss_1', Name: 'Admin', Phone: 'boss', PIN: '1234', Role: 'Admin', IsActive: 'TRUE' };
    const allUsers = [...updated, adminRecord];
    await saveUsers(allUsers);
  };

  const handleAddCategory = async () => {
    if (!newCategory.name) return;
    const updated = [...categories, { ID: 'c_' + Date.now(), Name: newCategory.name, Type: newCategory.type }];
    setCategories(updated);
    setNewCategory({ name: '', type: 'Income' });
    // BUG-03 FIX: Immediately save to localforage so category appears in entry form
    await saveCategories(updated);
  };

  // BUG FIX #12: Save categories to localforage immediately on delete
  const handleDeleteCategory = async (id) => {
    // Robust delete (handles cases where ID might be string or number, or missing)
    const updated = categories.filter(c => String(c.ID || c.id) !== String(id));
    setCategories(updated);
    await saveCategories(updated); // Auto-save locally immediately
    // FIX: Also auto-sync to Sheets immediately so it doesn't reappear on refresh
    try {
      await pushCategories(updated);
    } catch (err) {
      console.warn("Could not sync category deletion to cloud immediately", err);
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      // 1. Users
      const adminRecord = (await getUsers()).find(u => u.Role === 'Admin') || { ID: 'boss_1', Name: 'Admin', Role: 'Admin', IsActive: 'TRUE' };
      const finalAdminPIN = adminUser.pin ? await hashPIN(adminUser.pin) : (adminRecord.PIN || '1234');
      const allUsers = [...users, { ...adminRecord, Phone: adminUser.phone, PIN: finalAdminPIN }];
      await saveUsers(allUsers);
      await pushUsers(allUsers);
      
      // 2. Categories
      await saveCategories(categories);
      await pushCategories(categories);
      
      // 3. Settings
      await setSettings(settings);
      
      // 4. API config (local only)
      await setApiLink(apiLink);
      await setApiSecret(apiSecret);

      // Apply session timeout live
      if (setSessionTimeout) setSessionTimeout(parseInt(settings.SessionTimeout || '30', 10));
      
      const settingsArr = [
        { Key: 'BrandName', Value: settings.BrandName || '' },
        { Key: 'Address', Value: settings.Address || '' },
        { Key: 'Phone', Value: settings.Phone || '' },
        { Key: 'Email', Value: settings.Email || '' },
        { Key: 'Website', Value: settings.Website || '' },
        { Key: 'SocialMedia', Value: settings.SocialMedia || '' },
        { Key: 'Tagline', Value: settings.Tagline || '' },
        { Key: 'UpiId', Value: settings.UpiId || '' },
        { Key: 'DateFormat', Value: settings.DateFormat || 'MM/DD/YYYY' },
        { Key: 'OpeningBalance', Value: settings.OpeningBalance || '0' },
        { Key: 'SessionTimeout', Value: settings.SessionTimeout || '30' },
        { Key: 'NtfyTopic', Value: settings.NtfyTopic || '' }
        // DarkMode is device-specific, not synced to Sheet
      ];
      await pushSettings(settingsArr);
      alert('Settings and Data saved & synced successfully!');
    } catch (e) {
      alert('Failed to sync: ' + e.message);
    }
    setSaving(false);
  };

  const handleEnableNotifications = async () => {
    if (!settings.NtfyTopic) {
      alert('Please enter a Topic Name in Notifications first.');
      return;
    }
    setNotifLoading(true);
    const granted = await subscribePush(settings.NtfyTopic);
    setNotifPermission(getNotificationPermission());
    if (granted) {
      alert(`✅ Notifications enabled!\n\nYou\'ll receive alerts on this device when staff add entries.\n\nMake sure the same topic ("${settings.NtfyTopic}") is saved in your Apps Script settings.`);
    } else {
      alert('Notifications blocked. Please allow notifications in your browser/device settings.');
    }
    setNotifLoading(false);
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (window.confirm("WARNING: Importing a backup will overwrite your local database. Proceed?")) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          await importDatabase(event.target.result);
          alert("Database imported successfully! Please refresh.");
          loadData();
        } catch (err) {
          alert("Import failed: " + err.message);
        }
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  const darkModeOptions = [
    { value: 'auto', icon: Monitor, label: t('settings.auto') },
    { value: 'light', icon: Sun, label: t('settings.light') },
    { value: 'dark', icon: Moon, label: t('settings.dark') }
  ];

  return (
    <div className="container animate-fade-in pb-20">
      <div style={{ textAlign: 'center', margin: '16px 0 24px 0' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--primary)', letterSpacing: '-0.5px', margin: '0 0 4px 0' }}>ToCashBook</h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0', fontWeight: '500' }}>Developed by Thosho Tech</p>
      </div>

      <div className="header glass" style={{ padding: '16px 20px', borderRadius: '16px', marginBottom: '20px', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.25rem', margin: 0 }}>{t('settings.title')}</h2>
        <button 
          onClick={() => { if(setAuthUser) setAuthUser(null); window.location.href = '/'; }} 
          className="btn btn-outline text-danger" 
          style={{ padding: '8px', borderColor: 'var(--danger-bg)' }}
        >
          <LogOut size={18} />
        </button>
      </div>

      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {t('common.language')}
          <LanguageSelector />
        </h3>
      </div>

      {/* Appearance Settings */}
      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '16px' }}>{t('settings.appearance')}</h3>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
            {settings.DarkMode === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
            <span style={{ fontWeight: '500' }}>Dark Mode</span>
          </div>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={settings.DarkMode === 'dark'}
              onChange={(e) => handleDarkModeChange(e.target.checked ? 'dark' : 'light')}
            />
            <span className="slider round"></span>
          </label>
        </div>
      </div>

      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '16px' }}>{t('settings.brand_info')}</h3>
        <p className="text-secondary" style={{ fontSize: '0.875rem', marginBottom: '16px' }}>This info will be printed on your PDF reports.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="input-group">
            <label>Brand Name</label>
            <input type="text" value={settings.BrandName || ''} onChange={e => setLocalSettings({...settings, BrandName: e.target.value})} />
          </div>
          <div className="input-group">
            <label>Tagline / Short Info (Optional)</label>
            <input type="text" placeholder="e.g. Premium Auto Services" value={settings.Tagline || ''} onChange={e => setLocalSettings({...settings, Tagline: e.target.value})} />
          </div>
          <div className="input-group">
            <label>Address</label>
            <input type="text" value={settings.Address || ''} onChange={e => setLocalSettings({...settings, Address: e.target.value})} />
          </div>
          <div className="input-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: 0 }}>
            <div>
              <label>Business Phone</label>
              <input type="text" value={settings.Phone || ''} onChange={e => setLocalSettings({...settings, Phone: e.target.value})} />
            </div>
            <div>
              <label>Email (Optional)</label>
              <input type="email" placeholder="contact@example.com" value={settings.Email || ''} onChange={e => setLocalSettings({...settings, Email: e.target.value})} />
            </div>
          </div>
          <div className="input-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: 0 }}>
            <div>
              <label>Website (Optional)</label>
              <input type="text" placeholder="www.example.com" value={settings.Website || ''} onChange={e => setLocalSettings({...settings, Website: e.target.value})} />
            </div>
            <div>
              <label>Social Media (Optional)</label>
              <input type="text" placeholder="e.g. @yourbrand" value={settings.SocialMedia || ''} onChange={e => setLocalSettings({...settings, SocialMedia: e.target.value})} />
            </div>
          </div>
          <div className="input-group">
            <label>Business UPI ID (for payment links)</label>
            <input type="text" placeholder="e.g. yourname@okicici" value={settings.UpiId || ''} onChange={e => setLocalSettings({...settings, UpiId: e.target.value})} />
          </div>
          <div className="input-group">
            <label>Company Logo (Optional)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {settings.Logo && <img src={settings.Logo} alt="Logo" style={{ height: '40px', width: 'auto', borderRadius: '4px' }} />}
              <input 
                type="file" 
                accept="image/*" 
                onChange={e => {
                  const file = e.target.files[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setLocalSettings({...settings, Logo: reader.result});
                    };
                    reader.readAsDataURL(file);
                  }
                }} 
              />
              {settings.Logo && (
                <button 
                  className="btn btn-outline text-danger" 
                  onClick={() => setLocalSettings({...settings, Logo: ''})}
                  style={{ padding: '4px 8px' }}
                >
                  Clear Logo
                </button>
              )}
            </div>
          </div>
          <div className="input-group">
            <label>PDF Date Format</label>
            <select value={settings.DateFormat || 'MM/DD/YYYY'} onChange={e => setLocalSettings({...settings, DateFormat: e.target.value})}>
              <option value="MM/DD/YYYY">MM/DD/YYYY (e.g. 07/06/2026)</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY (e.g. 06/07/2026)</option>
              <option value="DD MMM YY">DD MMM YY (e.g. 06 Jan 26)</option>
            </select>
          </div>
          <div className="input-group">
            <label>Opening Balance (₹)</label>
            <input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={settings.OpeningBalance || '0'}
              onChange={e => setLocalSettings({...settings, OpeningBalance: e.target.value})}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Starting cash balance — added to your total balance in the dashboard
            </p>
          </div>
          <div className="input-group">
            <label>Session Timeout (minutes)</label>
            <select value={settings.SessionTimeout || '30'} onChange={e => setLocalSettings({...settings, SessionTimeout: e.target.value})}>
              <option value="5">5 minutes</option>
              <option value="10">10 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="120">2 hours</option>
              <option value="480">Never (8 hours)</option>
            </select>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Auto-logout staff after this period of inactivity
            </p>
          </div>
        </div>

        {/* Digital Business Card Section */}
        <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h4 style={{ margin: 0 }}>Digital Business Card</h4>
            <button className="btn btn-outline" onClick={handleShareCard} style={{ padding: '6px 12px', fontSize: '0.875rem' }}>
              <Share2 size={16} /> Share Card
            </button>
          </div>
          
          {/* Card Preview Container */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div 
              id="business-card" 
              style={{ 
                width: '100%', 
                maxWidth: '400px', 
                aspectRatio: '1.7 / 1', 
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', 
                borderRadius: '16px', 
                padding: '24px', 
                color: 'white',
                boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.4)',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: '1px solid rgba(255,255,255,0.05)'
              }}
            >
              {/* Modern Fintech Background Accents */}
              <div style={{ position: 'absolute', top: '-20%', right: '-10%', width: '60%', height: '140%', background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.1))', transform: 'rotate(25deg)' }}></div>
              <div style={{ position: 'absolute', bottom: '-50px', left: '-50px', width: '150px', height: '150px', background: 'radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)', borderRadius: '50%' }}></div>
              
              {/* Top Section: Logo & Brand Name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', zIndex: 1 }}>
                {settings.Logo ? (
                  <img src={settings.Logo} alt="Logo" style={{ width: '56px', height: '56px', objectFit: 'contain', borderRadius: '12px', background: 'white', padding: '4px', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }} />
                ) : (
                  <div style={{ width: '56px', height: '56px', borderRadius: '12px', background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', fontWeight: 'bold', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
                    {(settings.BrandName || 'B').charAt(0).toUpperCase()}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: '800', letterSpacing: '0.5px', color: '#f8fafc' }}>
                    {settings.BrandName || 'Your Business Name'}
                  </h2>
                  {settings.Tagline && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px', fontWeight: '500', letterSpacing: '0.5px' }}>
                      {settings.Tagline}
                    </div>
                  )}
                  <div style={{ width: '30px', height: '3px', background: '#3b82f6', borderRadius: '2px', marginTop: '6px' }}></div>
                </div>
              </div>
              
              {/* Bottom Section: Details Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', zIndex: 1, marginTop: 'auto', columnGap: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {settings.Phone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', color: '#cbd5e1' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)' }}>
                        <Contact size={14} color="#94a3b8" />
                      </div>
                      {settings.Phone}
                    </div>
                  )}
                  {settings.Email && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', flexShrink: 0 }}>
                        <Mail size={14} color="#94a3b8" />
                      </div>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{settings.Email}</span>
                    </div>
                  )}
                  {settings.Address && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '0.85rem', color: '#cbd5e1' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', flexShrink: 0 }}>
                        <span style={{ fontSize: '12px' }}>📍</span>
                      </div>
                      <div style={{ lineHeight: '1.4', paddingTop: '2px' }}>{settings.Address}</div>
                    </div>
                  )}
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {settings.Website && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', flexShrink: 0 }}>
                        <Globe size={14} color="#94a3b8" />
                      </div>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{settings.Website}</span>
                    </div>
                  )}
                  {settings.SocialMedia && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', flexShrink: 0 }}>
                        <Link2 size={14} color="#94a3b8" />
                      </div>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{settings.SocialMedia}</span>
                    </div>
                  )}
                  {settings.UpiId && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', color: '#cbd5e1' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)' }}>
                        <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#94a3b8' }}>UPI</span>
                      </div>
                      <span style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}>{settings.UpiId}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={18} /> Admin Security
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Change your default boss login credentials. If you ever forget your new PIN, open your Google Sheet's "Users" tab and manually change it back to 1234 to regain access.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label>Admin Phone / Username</label>
            <input type="text" value={adminUser.phone} onChange={e => setAdminUser({...adminUser, phone: e.target.value})} />
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label>Admin PIN</label>
            <input type="password" placeholder="Leave empty to keep current PIN" value={adminUser.pin} onChange={e => setAdminUser({...adminUser, pin: e.target.value})} />
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '16px', paddingTop: '16px' }}>
          <h4 style={{ marginBottom: '12px' }}>Database Connection Settings</h4>
          <div className="input-group">
            <label>Google Apps Script API Link</label>
            <input type="text" placeholder="https://script.google.com/macros/s/..." value={apiLink} onChange={e => setApiLinkState(e.target.value.trim())} />
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label>API Secret Key</label>
            <input type="password" placeholder="e.g. myshop2024" value={apiSecret} onChange={e => setApiSecretState(e.target.value)} />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Must match the APP_SECRET in your Google Apps Script Properties.
            </p>
          </div>
        </div>
      </div>

      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '16px' }}>Manage Staff</h3>
        <div className="settings-grid-staff">
          <input type="text" placeholder="Name" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} className="input-group" style={{ marginBottom: 0, width: '100%' }} />
          <input type="tel" placeholder="Phone Number" value={newUser.phone} onChange={e => setNewUser({...newUser, phone: e.target.value})} className="input-group" style={{ marginBottom: 0, width: '100%' }} />
          <input type="text" placeholder="PIN" value={newUser.pin} onChange={e => setNewUser({...newUser, pin: e.target.value})} className="input-group" style={{ marginBottom: 0, width: '100%' }} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-outline" onClick={handlePickContact} title="Pick from Contacts" style={{ flex: 1, padding: '8px' }}><Contact size={20} /></button>
            <button className="btn btn-primary" onClick={handleAddUser} style={{ flex: 1, padding: '8px' }}><Plus size={20} /></button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {users.map(u => (
            <div key={u.ID} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-color)', borderRadius: '8px' }}>
              <div>
                <strong>{u.Name || u.Username}</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>(Phone: {u.Phone || u.Username})</span>
              </div>
              <button onClick={() => handleDeleteUser(u.ID)} className="text-danger" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '16px' }}>Manage Categories</h3>
        <div className="settings-grid-cat">
          <input type="text" placeholder="Category Name" value={newCategory.name} onChange={e => setNewCategory({...newCategory, name: e.target.value})} className="input-group" style={{ marginBottom: 0, width: '100%' }} />
          <select value={newCategory.type} onChange={e => setNewCategory({...newCategory, type: e.target.value})} className="input-group" style={{ marginBottom: 0, width: '100%' }}>
            <option value="Income">Income</option>
            <option value="Expense">Expense</option>
          </select>
          <button className="btn btn-primary" onClick={handleAddCategory} style={{ width: '100%', padding: '8px' }}><Plus size={20} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {categories.map(c => (
            <div key={c.ID || c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-color)', borderRadius: '8px' }}>
              <div>
                <strong>{c.Name || c.name}</strong> <span className={`badge ${c.Type === 'Income' ? 'badge-income' : 'badge-expense'}`}>{c.Type || c.type}</span>
              </div>
              <button onClick={() => handleDeleteCategory(c.ID || c.id)} className="text-danger" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>
      {/* Push Notifications Card (Moved just above Data Management) */}
      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bell size={18} /> Push Notifications
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Get alerted on your phone/browser whenever staff adds a new entry — even when the app is closed.
          Uses <strong>ntfy.sh</strong> (free, no account needed).
        </p>

        <div className="input-group" style={{ marginBottom: '12px' }}>
          <label>Notification Topic Name</label>
          <input
            type="text"
            value={settings.NtfyTopic || ''}
            onChange={e => setLocalSettings({ ...settings, NtfyTopic: e.target.value.replace(/\s/g, '-') })}
            placeholder="e.g. my-shop-alerts-2024"
          />
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Pick a unique name (no spaces). Share this same name in your Apps Script (Code.gs) as <code>NTFY_TOPIC</code>.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className={`btn ${notifPermission === 'granted' ? 'btn-success' : 'btn-primary'}`}
            onClick={handleEnableNotifications}
            disabled={notifLoading || notifPermission === 'granted'}
            style={{ padding: '8px 16px', fontSize: '0.875rem' }}
          >
            {notifLoading ? 'Requesting...' : (notifPermission === 'granted' ? 'Enabled' : 'Enable on This Device')}
          </button>
          
          {notifPermission === 'granted' && (
            <p style={{ fontSize: '0.75rem', color: 'var(--success)', margin: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <BellRing size={14} /> Active
            </p>
          )}
          {notifPermission === 'denied' && (
            <p style={{ fontSize: '0.75rem', color: 'var(--danger)', margin: 0 }}>
              Blocked in browser settings. Go to browser → Site Settings → Notifications → Allow.
            </p>
          )}
        </div>

        <div style={{ marginTop: '12px', padding: '10px 12px', background: 'var(--bg-color)', borderRadius: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <strong>📋 Apps Script setup:</strong> In your Code.gs, add at the top:<br />
          <code style={{ display: 'block', marginTop: '4px', color: 'var(--primary)', wordBreak: 'break-all' }}>
            {'const NTFY_TOPIC = "' + (settings.NtfyTopic || 'your-topic-here') + '";'}
          </code>
        </div>
      </div>
      
      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '16px' }}>Data Management</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button className="btn btn-outline justify-between" onClick={exportDatabase}>
            <span>Export Database Backup</span> <Download size={18} />
          </button>
          <div style={{ position: 'relative' }}>
            <button className="btn btn-outline justify-between w-full" onClick={() => document.getElementById('import-db').click()}>
              <span>Import Backup</span> <Upload size={18} />
            </button>
            <input 
              id="import-db" 
              type="file" 
              accept=".json" 
              style={{ display: 'none' }} 
              onChange={handleImport} 
            />
          </div>
        </div>
      </div>

      <button className="btn btn-primary w-full" onClick={handleSaveAll} disabled={saving} style={{ marginBottom: '24px' }}>
        {saving ? 'Syncing...' : 'Save & Sync Settings'} <Save size={18} />
      </button>
    </div>
  );
}
