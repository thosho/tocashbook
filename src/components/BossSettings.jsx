import { useState, useEffect } from 'react';
import { getUsers, saveUsers, getCategories, saveCategories, exportDatabase, importDatabase, getSettings, setSettings, getApiSecret, setApiSecret, getApiLink, setApiLink } from '../services/localDb';
import { pushUsers, pushCategories, pushSettings } from '../services/sheetsApi';
import { hashPIN, verifyPIN, getLockoutStatus, recordFailedAttempt, resetFailedAttempts, APP_NAME, APP_VERSION } from '../services/authUtils';
import { subscribePush, getNotificationPermission, requestNotificationPermission, showInstantNotification, syncAllNotificationSchedules } from '../services/notificationService';
import { Plus, Trash2, Download, Upload, Save, Sun, Moon, Monitor, Bell, BellRing, Contact, Shield, Share2, Mail, Globe, Link2, LogOut, Edit2, Check, X, AlertTriangle, Clock, DollarSign, Calendar } from 'lucide-react';
import html2canvas from 'html2canvas';
import { useTranslation } from 'react-i18next';
import LanguageSelector from './LanguageSelector';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import localforage from 'localforage';
import { deleteAppCloudData } from '../services/googleDriveApi';

export default function BossSettings({ setSessionTimeout, setAuthUser }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [settings, setLocalSettings] = useState({ BrandName: '', Address: '', Phone: '', UpiId: '', DateFormat: 'MM/DD/YYYY', DarkMode: 'auto', OpeningBalance: '0', SessionTimeout: '30', NtfyTopic: '', StaffCanSeeAllEntries: 'false', AppLockEnabled: 'false', DailyNudgeEnabled: 'false', DailyNudgeTime: '20:30', WeeklyDueAlertsEnabled: 'false', LiveStaffAlertsEnabled: 'false', LowBalanceAlertEnabled: 'false', LowBalanceThreshold: '500' });
  const [adminUser, setAdminUser] = useState({ phone: 'boss', pin: '' });
  const [apiLink, setApiLinkState] = useState('');
  const [apiSecret, setApiSecretState] = useState('');
  const [newUser, setNewUser] = useState({ name: '', phone: '', pin: '' });
  const [newCategory, setNewCategory] = useState({ name: '', type: 'Income' });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null); // { type: 'success'|'warning'|'error', text: string }
  const [notifPermission, setNotifPermission] = useState('default');
  const [notifLoading, setNotifLoading] = useState(false);
  const [editingUserId, setEditingUserId] = useState(null);
  const [editUserData, setEditUserData] = useState({ name: '', phone: '', pin: '' });
  
  // Wipe Data State
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wipePin, setWipePin] = useState('');
  const [wipeError, setWipeError] = useState('');
  const [wiping, setWiping] = useState(false);
  const [lockoutTimer, setLockoutTimer] = useState(0);

  useEffect(() => {
    loadData();
    setNotifPermission(getNotificationPermission());
    
    const checkLockout = () => {
      const status = getLockoutStatus();
      setLockoutTimer(status.remainingSeconds);
    };
    checkLockout();
    const interval = setInterval(checkLockout, 1000);
    return () => clearInterval(interval);
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
    await setSettings(updated);
    applyDarkMode(mode);
  };

  const handleWipeData = async () => {
    if (!wipePin || lockoutTimer > 0) return;
    setWiping(true);
    setWipeError('');

    try {
      const bossRecord = (await getUsers()).find(u => u.Role === 'Admin');
      if (!bossRecord) throw new Error('Admin record not found.');

      const pinOk = await verifyPIN(wipePin, String(bossRecord.PIN));
      if (!pinOk) {
        const status = recordFailedAttempt();
        if (status.locked) {
          setWipeError(`Locked for ${status.remainingSeconds}s due to failed attempts.`);
        } else {
          setWipeError('Incorrect PIN. Please try again.');
        }
        setWipePin('');
        setWiping(false);
        return;
      }

      resetFailedAttempts();

      const token = await localforage.getItem('googleAccessToken');
      const spreadsheetId = await localforage.getItem('spreadsheetId');
      
      if (token && spreadsheetId) {
        await deleteAppCloudData(token, spreadsheetId);
      }

      await localforage.clear();
      
      if(setAuthUser) setAuthUser(null);
      window.location.href = '/';
    } catch (e) {
      console.error('Wipe data failed:', e);
      setWipeError(e.message || 'Failed to wipe data.');
      setWiping(false);
    }
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
            phone: c.tel ? c.tel[0].replace(/\D/g, '') : ''
          }));
        }
      } catch (ex) {
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
      
      if (Capacitor.isNativePlatform()) {
        try {
          const savedFile = await Filesystem.writeFile({
            path: `business_card_${Date.now()}.png`,
            data: dataUrl,
            directory: Directory.Cache
          });
          if ((await Share.canShare()).value) {
            await Share.share({
              title: settings.BrandName || 'Business Card',
              text: `Here is our business card for ${settings.BrandName || 'Open Cashbook'}!`,
              url: savedFile.uri
            });
          }
          return;
        } catch (e) {
          console.error('Capacitor card share error, falling back:', e);
        }
      }

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], 'card.png', { type: 'image/png' })] })) {
        await navigator.share({
          title: settings.BrandName,
          text: `Here is our business card for ${settings.BrandName}!`,
          files: [new File([blob], 'card.png', { type: 'image/png' })]
        });
      } else {
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
    if (!navigator.onLine) {
      alert("⚠️ You must be online to add new staff members so accounts sync with Google Sheets!");
      return;
    }
    if (!newUser.phone || !newUser.pin) return;
    if (users.some(u => String(u.Phone || '').trim() === String(newUser.phone).trim())) {
      alert("⚠️ An account with this phone number already exists!");
      return;
    }
    const hashedPIN = await hashPIN(newUser.pin);
    const newEntry = { ID: 'u_' + Date.now(), Name: newUser.name, Phone: newUser.phone, Username: newUser.phone, PIN: hashedPIN, Role: 'Staff', IsActive: 'TRUE' };
    const updated = [...users, newEntry];
    setUsers(updated);
    setNewUser({ name: '', phone: '', pin: '' });
    const adminRecord = (await getUsers()).find(u => u.Role === 'Admin') || { ID: 'boss_1', Name: 'Admin', Role: 'Admin', IsActive: 'TRUE' };
    const allUsers = [...updated, adminRecord];
    await saveUsers(allUsers);
    try { await pushUsers(allUsers); } catch (e) { console.warn('Could not sync new staff to cloud:', e.message); }
  };

  const handleDeleteUser = async (id) => {
    if (!navigator.onLine) {
      alert("⚠️ You must be online to manage user accounts!");
      return;
    }
    const updated = users.filter(u => u.ID !== id);
    setUsers(updated);
    const adminRecord = (await getUsers()).find(u => u.Role === 'Admin') || { ID: 'boss_1', Name: 'Admin', Phone: 'boss', PIN: '1234', Role: 'Admin', IsActive: 'TRUE' };
    const allUsers = [...updated, adminRecord];
    await saveUsers(allUsers);
    try { await pushUsers(allUsers); } catch (e) { console.warn('Could not sync staff deletion to cloud:', e.message); }
  };

  const handleSaveEditUser = async () => {
    if (!navigator.onLine) {
      alert("⚠️ You must be online to edit staff members so accounts sync with Google Sheets!");
      return;
    }
    if (!editUserData.phone || !editUserData.name) return;
    
    if (users.some(u => u.ID !== editingUserId && String(u.Phone || '').trim() === String(editUserData.phone).trim())) {
      alert("⚠️ Another account with this phone number already exists!");
      return;
    }
    
    const updatedUsers = [...users];
    const idx = updatedUsers.findIndex(u => u.ID === editingUserId);
    if (idx !== -1) {
      updatedUsers[idx].Name = editUserData.name;
      updatedUsers[idx].Phone = editUserData.phone;
      updatedUsers[idx].Username = editUserData.phone;
      
      if (editUserData.pin) {
        updatedUsers[idx].PIN = await hashPIN(editUserData.pin);
      }
      
      setUsers(updatedUsers);
      const adminRecord = (await getUsers()).find(u => u.Role === 'Admin') || { ID: 'boss_1', Name: 'Admin', Role: 'Admin', IsActive: 'TRUE' };
      const allUsers = [...updatedUsers, adminRecord];
      await saveUsers(allUsers);
      
      try { await pushUsers(allUsers); } catch (e) { console.warn('Could not sync staff edit to cloud:', e.message); }
    }
    setEditingUserId(null);
  };

  const handleAddCategory = async () => {
    if (!navigator.onLine) {
      alert("⚠️ You must be online to add categories so they sync with Google Sheets!");
      return;
    }
    if (!newCategory.name) return;
    const updated = [...categories, { ID: 'c_' + Date.now(), Name: newCategory.name, Type: newCategory.type }];
    setCategories(updated);
    setNewCategory({ name: '', type: 'Income' });
    await saveCategories(updated);
    try { await pushCategories(updated); } catch (e) { console.warn('Could not sync new category to cloud:', e.message); }
  };

  const handleDeleteCategory = async (id) => {
    const updated = categories.filter(c => String(c.ID || c.id) !== String(id));
    setCategories(updated);
    await saveCategories(updated);
    try {
      await pushCategories(updated);
    } catch (err) {
      console.warn("Could not sync category deletion to cloud immediately", err);
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const adminRecord = (await getUsers()).find(u => u.Role === 'Admin') || { ID: 'boss_1', Name: 'Admin', Role: 'Admin', IsActive: 'TRUE' };
      const finalAdminPIN = adminUser.pin ? await hashPIN(adminUser.pin) : (adminRecord.PIN || '1234');
      const allUsers = [...users, { ...adminRecord, Phone: adminUser.phone, PIN: finalAdminPIN }];
      await saveUsers(allUsers);
      await saveCategories(categories);
      await setSettings(settings);
      await setApiLink(apiLink);
      await setApiSecret(apiSecret);
      await syncAllNotificationSchedules(settings);

      if (setSessionTimeout) setSessionTimeout(parseInt(settings.SessionTimeout || '30', 10));
      
      setSaveMsg({ type: 'success', text: '✅ Settings saved locally.' });

      try {
        await pushUsers(allUsers);
        await pushCategories(categories);
        const settingsArr = [
          { Key: 'BrandName', Value: settings.BrandName || '' },
          { Key: 'Address', Value: settings.Address || '' },
          { Key: 'Phone', Value: settings.Phone || '' },
          { Key: 'Email', Value: settings.Email || '' },
          { Key: 'Website', Value: settings.Website || '' },
          { Key: 'SocialMedia', Value: settings.SocialMedia || '' },
          { Key: 'Tagline', Value: settings.Tagline || '' },
          { Key: 'UpiId', Value: settings.UpiId || '' },
          { Key: 'DateFormat', Value: settings.DateFormat || 'DD/MM/YYYY' },
          { Key: 'OpeningBalance', Value: settings.OpeningBalance || '0' },
          { Key: 'SessionTimeout', Value: settings.SessionTimeout || '30' },
          { Key: 'NtfyTopic', Value: settings.NtfyTopic || '' },
          { Key: 'StaffCanSeeAllEntries', Value: settings.StaffCanSeeAllEntries || 'false' },
          { Key: 'AppLockEnabled', Value: settings.AppLockEnabled || 'false' },
          { Key: 'DailyNudgeEnabled', Value: settings.DailyNudgeEnabled || 'false' },
          { Key: 'DailyNudgeTime', Value: settings.DailyNudgeTime || '20:30' },
          { Key: 'WeeklyDueAlertsEnabled', Value: settings.WeeklyDueAlertsEnabled || 'false' },
          { Key: 'LiveStaffAlertsEnabled', Value: settings.LiveStaffAlertsEnabled || 'false' },
          { Key: 'LowBalanceAlertEnabled', Value: settings.LowBalanceAlertEnabled || 'false' },
          { Key: 'LowBalanceThreshold', Value: settings.LowBalanceThreshold || '500' },
        ];
        await pushSettings(settingsArr);
        setSaveMsg({ type: 'success', text: '✅ Settings saved & synced to cloud!' });
      } catch (syncErr) {
        setSaveMsg({ type: 'warning', text: '⚠️ Saved locally. Cloud sync failed — will retry when online.' });
      }
    } catch (e) {
      setSaveMsg({ type: 'error', text: '❌ Save failed: ' + e.message });
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(null), 4000);
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
      alert(`✅ Notifications enabled!\n\nYou'll receive alerts on this device when staff add entries.\n\nMake sure the same topic ("${settings.NtfyTopic}") is saved in your Apps Script settings.`);
    } else {
      alert('Notifications blocked. Please allow notifications in your browser/device settings.');
    }
    setNotifLoading(false);
  };

  const handleTestNotification = async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      await showInstantNotification({
        title: "📓 Open Cashbook Alert",
        body: "Your local Android APK notifications & reminders are active and functioning perfectly!"
      });
      setNotifPermission('granted');
    } else {
      alert('Please grant Notification permissions in your Android or Browser settings.');
    }
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

  return (
    <div className="container animate-fade-in pb-20">
      <div style={{ textAlign: 'center', margin: '16px 0 24px 0' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--primary)', letterSpacing: '-0.5px', margin: '0 0 4px 0' }}>{APP_NAME}</h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0', fontWeight: '500' }}>Developed by Thosho Tech</p>
      </div>

      <div className="header glass" style={{ padding: '16px 20px', borderRadius: '16px', marginBottom: '20px', marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '1.25rem', margin: 0, fontWeight: '700' }}>{t('settings.title')}</h2>
        <button className="btn btn-primary" onClick={handleSaveAll} disabled={saving} style={{ padding: '10px 18px', fontSize: '0.9rem', minHeight: '42px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {saving ? 'Syncing...' : 'Save & Sync Settings'} <Save size={18} />
        </button>
        {saveMsg && (
          <div style={{
            width: '100%', padding: '10px 14px', borderRadius: '10px', fontSize: '0.875rem', fontWeight: '500',
            background: saveMsg.type === 'success' ? 'rgba(34,197,94,0.15)' : saveMsg.type === 'warning' ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
            color: saveMsg.type === 'success' ? 'var(--success)' : saveMsg.type === 'warning' ? '#ca8a04' : 'var(--danger)',
            border: `1px solid ${saveMsg.type === 'success' ? 'rgba(34,197,94,0.3)' : saveMsg.type === 'warning' ? 'rgba(234,179,8,0.3)' : 'rgba(239,68,68,0.3)'}`,
            marginTop: '8px'
          }}>
            {saveMsg.text}
          </div>
        )}
      </div>

      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {t('common.language')}
          <LanguageSelector />
        </h3>
      </div>

      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '16px' }}>{t('settings.appearance')}</h3>
        <div 
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '4px 0', userSelect: 'none' }}
          onClick={() => {
            const nextMode = settings.DarkMode === 'dark' ? 'light' : 'dark';
            handleDarkModeChange(nextMode);
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
            {settings.DarkMode === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
            <span style={{ fontWeight: '500' }}>Dark Mode</span>
          </div>
          <div className="switch" style={{ pointerEvents: 'none' }}>
            <input 
              type="checkbox" 
              checked={settings.DarkMode === 'dark'}
              readOnly
            />
            <span className="slider round"></span>
          </div>
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
          <div className="input-group filter-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: 0 }}>
            <div>
              <label>Business Phone</label>
              <input type="text" value={settings.Phone || ''} onChange={e => setLocalSettings({...settings, Phone: e.target.value})} />
            </div>
            <div>
              <label>Email (Optional)</label>
              <input type="email" placeholder="contact@example.com" value={settings.Email || ''} onChange={e => setLocalSettings({...settings, Email: e.target.value})} />
            </div>
          </div>
          <div className="input-group filter-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: 0 }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
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

        <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h4 style={{ margin: 0 }}>Digital Business Card</h4>
            <button className="btn btn-outline" onClick={handleShareCard} style={{ padding: '6px 12px', fontSize: '0.875rem' }}>
              <Share2 size={16} /> Share Card
            </button>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div 
              id="business-card" 
              style={{ 
                width: '100%', 
                maxWidth: '400px', 
                minHeight: '235px', 
                height: 'auto',
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
              <div style={{ position: 'absolute', top: '-20%', right: '-10%', width: '60%', height: '140%', background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.1))', transform: 'rotate(25deg)' }}></div>
              <div style={{ position: 'absolute', bottom: '-50px', left: '-50px', width: '150px', height: '150px', background: 'radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)', borderRadius: '50%' }}></div>
              
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
              
              <div className="filter-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', zIndex: 1, marginTop: '20px', columnGap: '16px' }}>
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
        <div className="filter-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label>Admin Phone / Username</label>
            <input type="text" value={adminUser.phone} onChange={e => setAdminUser({...adminUser, phone: e.target.value})} style={{ width: '100%' }} />
          </div>
          <div className="input-group" style={{ marginBottom: 0 }}>
            <label>Admin PIN</label>
            <input type="password" placeholder="Leave empty to keep current PIN" value={adminUser.pin} onChange={e => setAdminUser({...adminUser, pin: e.target.value})} style={{ width: '100%' }} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '12px', background: 'var(--bg-color)', borderRadius: '8px', marginTop: '16px', userSelect: 'none', border: '1px solid var(--border-color)' }} onClick={() => setLocalSettings({...settings, AppLockEnabled: settings.AppLockEnabled === 'true' ? 'false' : 'true'})}>
          <div>
            <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>App Lock (Require PIN to open app)</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>If enabled, you must enter your PIN every time you reopen the app.</div>
          </div>
          <div className="switch" style={{ pointerEvents: 'none' }}>
            <input type="checkbox" checked={settings.AppLockEnabled === 'true'} readOnly />
            <span className="slider round"></span>
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
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '12px', background: 'var(--bg-color)', borderRadius: '8px', marginBottom: '16px', userSelect: 'none', border: '1px solid var(--border-color)' }} onClick={() => setLocalSettings({...settings, StaffCanSeeAllEntries: settings.StaffCanSeeAllEntries === 'true' ? 'false' : 'true'})}>
          <div>
            <div style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Staff Can View All Entries</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>If off, staff only see entries they added themselves.</div>
          </div>
          <div className="switch" style={{ pointerEvents: 'none' }}>
            <input type="checkbox" checked={settings.StaffCanSeeAllEntries === 'true'} readOnly />
            <span className="slider round"></span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            <input type="text" placeholder="Staff Name" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} style={{ padding: '10px 14px', minHeight: '44px', borderRadius: '8px', width: '100%', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
            <input type="tel" placeholder="Phone Number" value={newUser.phone} onChange={e => setNewUser({...newUser, phone: e.target.value})} style={{ padding: '10px 14px', minHeight: '44px', borderRadius: '8px', width: '100%', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
            <input type="text" placeholder="PIN Code" value={newUser.pin} onChange={e => setNewUser({...newUser, pin: e.target.value})} style={{ padding: '10px 14px', minHeight: '44px', borderRadius: '8px', width: '100%', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', width: '100%' }}>
            <button className="btn btn-outline" onClick={handlePickContact} title="Pick from Contacts" style={{ minHeight: '44px', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6', fontWeight: '600', gap: '6px', width: '100%', boxSizing: 'border-box' }}><Contact size={18} /> Contact</button>
            <button className="btn btn-primary" onClick={handleAddUser} title="Add Staff" style={{ minHeight: '44px', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%', boxSizing: 'border-box' }}><Plus size={18} /> Add Staff</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {users.map(u => (
            <div key={u.ID} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', padding: '12px', background: 'var(--bg-color)', borderRadius: '8px' }}>
              {editingUserId === u.ID ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', width: '100%', alignItems: 'center' }}>
                  <input type="text" value={editUserData.name} onChange={e => setEditUserData({...editUserData, name: e.target.value})} style={{ flex: 1, minWidth: '120px', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-primary)' }} placeholder="Name" />
                  <input type="tel" value={editUserData.phone} onChange={e => setEditUserData({...editUserData, phone: e.target.value})} style={{ flex: 1, minWidth: '120px', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-primary)' }} placeholder="Phone" />
                  <input type="text" value={editUserData.pin} onChange={e => setEditUserData({...editUserData, pin: e.target.value})} style={{ flex: 1, minWidth: '100px', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-primary)' }} placeholder="New PIN (optional)" />
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={handleSaveEditUser} className="text-success" style={{ background: 'rgba(34,197,94,0.1)', border: 'none', cursor: 'pointer', padding: '8px', borderRadius: '6px' }} title="Save">
                      <Check size={18} />
                    </button>
                    <button onClick={() => setEditingUserId(null)} className="text-secondary" style={{ background: 'rgba(150,150,150,0.1)', border: 'none', cursor: 'pointer', padding: '8px', borderRadius: '6px' }} title="Cancel">
                      <X size={18} />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                    <strong>{u.Name || u.Username}</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'inline-block' }}>(Phone: {u.Phone || u.Username})</span>
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => {
                      setEditingUserId(u.ID);
                      setEditUserData({ name: u.Name || u.Username, phone: u.Phone || u.Username, pin: '' });
                    }} className="text-primary" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px' }} title="Edit">
                      <Edit2 size={18} />
                    </button>
                    <button onClick={() => handleDeleteUser(u.ID)} className="text-danger" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px' }} title="Delete">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '16px' }}>Manage Categories</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <input type="text" placeholder="Category Name" value={newCategory.name} onChange={e => setNewCategory({...newCategory, name: e.target.value})} style={{ padding: '10px 14px', minHeight: '44px', borderRadius: '8px', width: '100%', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-primary)', boxSizing: 'border-box' }} />
            <select value={newCategory.type} onChange={e => setNewCategory({...newCategory, type: e.target.value})} style={{ padding: '10px 14px', minHeight: '44px', borderRadius: '8px', width: '100%', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-primary)', boxSizing: 'border-box' }}>
              <option value="Income">Income (+)</option>
              <option value="Expense">Expense (-)</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={handleAddCategory} style={{ width: '100%', minHeight: '44px', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', boxSizing: 'border-box' }}><Plus size={18} /> Add Category</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {categories.map(c => (
            <div key={c.ID || c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', padding: '12px', background: 'var(--bg-color)', borderRadius: '8px' }}>
              <div style={{ flex: 1, minWidth: 0, wordBreak: 'break-word', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <strong>{c.Name || c.name}</strong> <span className={`badge ${c.Type === 'Income' ? 'badge-income' : 'badge-expense'}`}>{c.Type || c.type}</span>
              </div>
              <button onClick={() => handleDeleteCategory(c.ID || c.id)} className="text-danger" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px' }}>
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      </div>
      {/* Notifications & Reminders Card */}
      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)', fontSize: '1.1rem', fontWeight: '700' }}>
          <Bell size={20} /> Notifications & Reminders (Android & Web)
        </h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '18px', lineHeight: 1.4 }}>
          Automate daily bookkeeping habits and customer collection nudges. These local alarms run silently in the background without altering any accounting logic or requiring internet.
        </p>

        {/* Test Notification Button */}
        <div style={{ marginBottom: '20px', padding: '12px', backgroundColor: 'rgba(79, 70, 229, 0.08)', borderRadius: '10px', border: '1px dashed var(--primary)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <div>
            <div style={{ fontWeight: '600', fontSize: '0.88rem' }}>Verify Android Alarms</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Tap to test local system notifications on this device</div>
          </div>
          <button
            className="btn btn-outline"
            onClick={handleTestNotification}
            style={{ padding: '6px 14px', fontSize: '0.82rem', borderColor: 'var(--primary)', color: 'var(--primary)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <BellRing size={16} /> Test Nudge Now
          </button>
        </div>

        {/* 1. Daily Evening Nudge */}
        <div style={{ paddingBottom: '14px', borderBottom: '1px solid var(--border-color)', marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '8px' }}>
            <div>
              <span style={{ fontWeight: '600', fontSize: '0.92rem', display: 'block' }}>🌙 Daily "Close the Day" Nudge</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Evening reminder to record petty cash & reconcile your register</span>
            </div>
            <label className="switch" style={{ flexShrink: 0, marginTop: '2px' }}>
              <input 
                type="checkbox" 
                checked={settings.DailyNudgeEnabled === 'true'} 
                onChange={e => {
                  const updated = { ...settings, DailyNudgeEnabled: e.target.checked ? 'true' : 'false' };
                  setLocalSettings(updated);
                  syncAllNotificationSchedules(updated);
                }} 
              />
              <span className="slider round"></span>
            </label>
          </div>
          {settings.DailyNudgeEnabled === 'true' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', paddingLeft: '8px' }}>
              <Clock size={16} color="var(--text-secondary)" />
              <span style={{ fontSize: '0.82rem', fontWeight: '500' }}>Reminder Time:</span>
              <input
                type="time"
                value={settings.DailyNudgeTime || '20:30'}
                onChange={e => {
                  const updated = { ...settings, DailyNudgeTime: e.target.value };
                  setLocalSettings(updated);
                  syncAllNotificationSchedules(updated);
                }}
                className="form-control"
                style={{ padding: '4px 8px', fontSize: '0.85rem', width: 'auto', borderRadius: '6px' }}
              />
            </div>
          )}
        </div>

        {/* 2. Weekly Debt & Collection Reminders */}
        <div style={{ paddingBottom: '14px', borderBottom: '1px solid var(--border-color)', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <span style={{ fontWeight: '600', fontSize: '0.92rem', display: 'block' }}>⏳ Weekly Debt Recovery Reminders</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Weekly Monday morning nudge to check pending customer receivables and send WhatsApp reminders</span>
          </div>
          <label className="switch" style={{ flexShrink: 0, marginTop: '2px' }}>
            <input 
              type="checkbox" 
              checked={settings.WeeklyDueAlertsEnabled === 'true'} 
              onChange={e => {
                const updated = { ...settings, WeeklyDueAlertsEnabled: e.target.checked ? 'true' : 'false' };
                setLocalSettings(updated);
                syncAllNotificationSchedules(updated);
              }} 
            />
            <span className="slider round"></span>
          </label>
        </div>

        {/* 3. Low Cash Balance Warning */}
        <div style={{ paddingBottom: '14px', borderBottom: '1px solid var(--border-color)', marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '8px' }}>
            <div>
              <span style={{ fontWeight: '600', fontSize: '0.92rem', display: 'block' }}>⚠️ Low Cash Balance Alarm</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Instant alert when adding an expense drops running cash below your chosen limit</span>
            </div>
            <label className="switch" style={{ flexShrink: 0, marginTop: '2px' }}>
              <input 
                type="checkbox" 
                checked={settings.LowBalanceAlertEnabled === 'true'} 
                onChange={e => {
                  const updated = { ...settings, LowBalanceAlertEnabled: e.target.checked ? 'true' : 'false' };
                  setLocalSettings(updated);
                }} 
              />
              <span className="slider round"></span>
            </label>
          </div>
          {settings.LowBalanceAlertEnabled === 'true' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', paddingLeft: '8px' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: '500' }}>Alert Threshold (₹):</span>
              <input
                type="number"
                value={settings.LowBalanceThreshold || '500'}
                onChange={e => setLocalSettings({ ...settings, LowBalanceThreshold: e.target.value })}
                className="form-control"
                placeholder="e.g. 500"
                style={{ padding: '4px 8px', fontSize: '0.85rem', width: '120px', borderRadius: '6px' }}
              />
            </div>
          )}
        </div>

        {/* 4. Live Staff Activity Alerts (Ntfy integration) */}
        <div>
          <div style={{ fontWeight: '600', fontSize: '0.92rem', marginBottom: '4px' }}>💼 Real-Time Staff Activity Push Alerts</div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            Get push alerts on this device whenever a staff member adds an entry online. Uses free ntfy.sh messaging.
          </p>

          <div className="input-group" style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: '600' }}>Notification Topic Name</label>
            <input
              type="text"
              value={settings.NtfyTopic || ''}
              onChange={e => setLocalSettings({ ...settings, NtfyTopic: e.target.value.replace(/\s/g, '-') })}
              placeholder="e.g. boss-shop-alerts-2024"
              className="form-control"
              style={{ borderRadius: '8px', padding: '8px 12px' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
            <button
              className={`btn ${notifPermission === 'granted' ? 'btn-success' : 'btn-primary'}`}
              onClick={handleEnableNotifications}
              disabled={notifLoading || notifPermission === 'granted'}
              style={{ padding: '6px 14px', fontSize: '0.82rem' }}
            >
              {notifLoading ? 'Requesting...' : (notifPermission === 'granted' ? 'Topic Registered' : 'Register Topic')}
            </button>
            
            {notifPermission === 'granted' && (
              <span style={{ fontSize: '0.78rem', color: 'var(--success)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <BellRing size={14} /> Listening
              </span>
            )}
          </div>

          <div style={{ padding: '8px 12px', background: 'var(--bg-color)', borderRadius: '8px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            <strong>📋 Apps Script setup:</strong> In your Google Apps Script backend, assure your topic match:<br />
            <code style={{ display: 'block', marginTop: '2px', color: 'var(--primary)', wordBreak: 'break-all' }}>
              {'const NTFY_TOPIC = "' + (settings.NtfyTopic || 'your-topic-here') + '";'}
            </code>
          </div>
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

      {/* Danger Zone: Account & Data Deletion */}
      <div className="card mb-4" style={{ border: '1px solid #ef4444', backgroundColor: 'rgba(239, 68, 68, 0.05)', padding: '16px', borderRadius: '12px' }}>
        <h3 style={{ color: '#ef4444', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.05rem', fontWeight: '700' }}>
          <AlertTriangle size={20} /> Danger Zone: Delete Account & Data
        </h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.4 }}>
          Permanently delete your Google Drive cloud sync spreadsheet and erase all local database entries on this device. This action cannot be undone.
        </p>
        <button 
          onClick={() => { setWipePin(''); setWipeError(''); setShowWipeModal(true); }} 
          className="btn text-white w-full"
          style={{ background: '#ef4444', border: 'none', fontWeight: '600', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', borderRadius: '8px', cursor: 'pointer' }}
        >
          <Trash2 size={18} /> Delete Account & All Data
        </button>
      </div>

      {/* Wipe Confirmation Modal */}
      {showWipeModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
          <div className="card animate-fade-in" style={{ maxWidth: '400px', width: '100%', padding: '24px', backgroundColor: 'var(--surface-color)', borderRadius: '16px', border: '1px solid #ef4444', boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)' }}>
            <h3 style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '10px', marginTop: 0, marginBottom: '12px', fontSize: '1.2rem', fontWeight: '700' }}>
              <AlertTriangle size={24} color="#ef4444" /> Confirm Complete Erasure
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '16px', lineHeight: 1.5 }}>
              You are about to totally erase all operational transaction data, party balances, and cloud spreadsheet linkages. To authorize this irrevocable destruction, please input your <strong>Boss PIN</strong>:
            </p>

            {wipeError && (
              <div style={{ color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '16px', fontWeight: '600' }}>
                {wipeError}
              </div>
            )}

            <div className="form-group mb-4">
              <label style={{ fontSize: '0.85rem', fontWeight: '600', display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>Boss PIN Required:</label>
              <input
                type="password"
                className="form-control w-full"
                value={wipePin}
                onChange={(e) => setWipePin(e.target.value)}
                placeholder="Enter 4-digit PIN"
                disabled={wiping || lockoutTimer > 0}
                style={{ padding: '12px', fontSize: '1rem', borderRadius: '8px', textAlign: 'center', letterSpacing: '4px' }}
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className="btn btn-outline flex-1"
                onClick={() => setShowWipeModal(false)}
                disabled={wiping}
                style={{ padding: '12px', fontWeight: '600', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                className="btn text-white flex-1"
                onClick={handleWipeData}
                disabled={!wipePin || wiping || lockoutTimer > 0}
                style={{ backgroundColor: '#ef4444', padding: '12px', fontWeight: '700', border: 'none', cursor: 'pointer' }}
              >
                {wiping ? 'Wiping Data...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <button 
        onClick={() => { if(setAuthUser) setAuthUser(null); window.location.href = '/'; }} 
        className="btn btn-outline text-danger w-full" 
        style={{ marginBottom: '24px', minHeight: '46px', borderColor: 'var(--danger-bg)', fontSize: '0.95rem', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
      >
        <LogOut size={18} /> Log Out from {APP_NAME}
      </button>

      {/* About Thosho Tech Section */}
      <div className="animate-fade-in" style={{ padding: '24px', textAlign: 'center', border: '1px solid rgba(59, 130, 246, 0.35)', backgroundColor: '#1e293b', color: '#f8fafc', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)', borderRadius: '16px', marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 6px 0', fontSize: '1.2rem', fontWeight: '800', color: '#3b82f6', letterSpacing: '0.5px' }}>
          Thosho Tech
        </h3>
        <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5 }}>
          Engineering reliable, state-of-the-art fintech & retail software solutions for modern businesses.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', fontSize: '0.88rem' }}>
          <a href="https://thoshotech.com/" target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3b82f6', textDecoration: 'none', fontWeight: '600' }}>
            <Globe size={16} /> https://thoshotech.com/
          </a>
          <a href="mailto:contact@thoshotech.com" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3b82f6', textDecoration: 'none', fontWeight: '600' }}>
            <Mail size={16} /> contact@thoshotech.com
          </a>
        </div>
        <div style={{ marginTop: '16px', fontSize: '0.75rem', color: '#94a3b8', opacity: 0.9 }}>
          {APP_NAME} {APP_VERSION} · All Rights Reserved © {new Date().getFullYear()} Thosho Tech
        </div>
      </div>
    </div>
  );
}
