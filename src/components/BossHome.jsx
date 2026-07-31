import { useState, useEffect } from 'react';
import { getTransactions, getSettings, getBooks, getUsers, saveBooks, saveUsers } from '../services/localDb';
import { fetchAllData, syncOfflineTransactions, syncPendingEdits, syncPendingDeletes, pushUsers, pushBooks } from '../services/sheetsApi';
import { hashPIN } from '../services/authUtils';
import { 
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, 
  LineElement, BarElement, Title, Tooltip, Legend, ArcElement 
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { LogOut, RefreshCw, ArrowUpRight, ArrowDownRight, PlusCircle, Users, BarChart3, Settings, BookOpen, Share2, Eye, EyeOff, X, Plus, Contact } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../context/AppContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend);

export default function BossHome({ user, setAuthUser }) {
  const { t } = useTranslation();
  const { activeBookId, setActiveBookId } = useAppContext();
  const [transactions, setTransactions] = useState([]);
  const [books, setBooks] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [showStaffSummary, setShowStaffSummary] = useState(false);
  const [showBalance, setShowBalance] = useState(false);
  const [showBooks, setShowBooks] = useState(false);
  const [settings, setSettings] = useState({});
  const navigate = useNavigate();

  // Create Book State
  const [showCreateBook, setShowCreateBook] = useState(false);
  const [newBookName, setNewBookName] = useState('');
  const [newBookDesc, setNewBookDesc] = useState('');
  const [selectedStaff, setSelectedStaff] = useState([]);
  
  // Inline Staff Creation State
  const [inlineStaffName, setInlineStaffName] = useState('');
  const [inlineStaffPhone, setInlineStaffPhone] = useState('');
  const [inlineStaffPin, setInlineStaffPin] = useState('');
  const [showInlineStaffForm, setShowInlineStaffForm] = useState(false);

  useEffect(() => {
    // Auto-sync on first load so boss always sees latest staff entries from Google Sheet
    const autoSync = async () => {
      setSyncing(true);
      try {
        await fetchAllData();
        await syncOfflineTransactions();
        await syncPendingEdits();
        await syncPendingDeletes();
        await loadData();
      } catch (e) {
        // Silent fail — just load local data if network unavailable
        await loadData();
      }
      setSyncing(false);
    };
    autoSync();
  }, []);

  const loadData = async () => {
    const allTrans = await getTransactions();
    // Boss sees ALL transactions across all books; filter only if a specific book is selected
    const filtered = activeBookId ? allTrans.filter(t => !t.bookId || t.bookId === activeBookId || activeBookId === 'ALL') : allTrans;
    setTransactions(filtered);
    const s = await getSettings();
    setSettings(s);
    const u = await getUsers();
    setUsersList(u);
    const b = await getBooks();
    // Filter books by what user is allowed to see
    if (user?.Role === 'Admin' || user?.AllowedBooks === 'ALL') {
      setBooks(b);
    } else {
      const allowed = (user?.AllowedBooks || '').split(',').map(id => id.trim());
      setBooks(b.filter(book => allowed.includes(book.ID)));
    }
  };

  useEffect(() => {
    loadData();
  }, [activeBookId, user]); // Reload if activeBookId changes

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetchAllData();
      await syncOfflineTransactions();
      await syncPendingEdits();
      await syncPendingDeletes(); // H6 FIX: flush queued offline deletes
      await loadData();
    } catch (e) {
      alert("Sync failed: " + e.message);
    }
    setSyncing(false);
  };

  const handlePickContact = async () => {
    try {
      const props = ['name', 'tel'];
      const contacts = await navigator.contacts.select(props, { multiple: false });
      if (contacts.length > 0) {
        const c = contacts[0];
        setInlineStaffName(c.name ? c.name[0] : '');
        setInlineStaffPhone(c.tel && c.tel.length > 0 ? c.tel[0].replace(/\s+/g, '') : ''); 
        setShowInlineStaffForm(true); 
      }
    } catch (ex) {
      alert("Contact selection failed or not supported on this device. Opening manual form.");
      setShowInlineStaffForm(true);
    }
  };

  const handleCreateBook = async (e) => {
    e.preventDefault();
    if (!newBookName.trim()) return;

    const newBook = {
      ID: `book_${Date.now()}`,
      Name: newBookName,
      Description: newBookDesc,
      CreatedAt: new Date().toISOString()
    };

    const updatedBooks = [...books, newBook];
    await saveBooks(updatedBooks);

    let updatedUsers = [...usersList];

    // Handle inline new user creation
    if (showInlineStaffForm && inlineStaffPhone && inlineStaffPin) {
      // BUG-M5 FIX: Check by Phone OR Username to avoid duplicate staff
      const exists = updatedUsers.find(u => u.Username === inlineStaffPhone || u.Phone === inlineStaffPhone);
      if (!exists) {
        const hashedPin = await hashPIN(inlineStaffPin);
        const newUser = {
          Username: inlineStaffPhone,
          Name: inlineStaffName || inlineStaffPhone,
          PIN: hashedPin,
          Role: 'Staff',
          AllowedBooks: newBook.ID,
          IsBlocked: 'FALSE'
        };
        updatedUsers.push(newUser);
      } else {
         if (!selectedStaff.includes(inlineStaffPhone)) {
            selectedStaff.push(inlineStaffPhone);
         }
      }
    }

    // Assign to selected staff (append to AllowedBooks)
    updatedUsers = updatedUsers.map(u => {
      if (selectedStaff.includes(u.Username)) {
        let allowed = u.AllowedBooks || '';
        if (allowed === 'ALL') return u; // Admin already has all
        if (allowed) allowed += `, ${newBook.ID}`;
        else allowed = newBook.ID;
        return { ...u, AllowedBooks: allowed };
      }
      return u;
    });
    
    await saveUsers(updatedUsers);

    setBooks(updatedBooks);
    setUsersList(updatedUsers);
    
    setShowCreateBook(false);
    setNewBookName('');
    setNewBookDesc('');
    setSelectedStaff([]);
    setInlineStaffName('');
    setInlineStaffPhone('');
    setInlineStaffPin('');
    setShowInlineStaffForm(false);

    // BUG-M7 FIX: Push books and users to Google Sheet so they persist across devices
    try {
      await pushBooks(updatedBooks);
      await pushUsers(updatedUsers);
    } catch (e) {
      console.warn('Could not sync new book to cloud:', e.message);
    }
  };

  const handleShareDailySummary = () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;
    const todayTx = transactions.filter(t => t.date === todayStr);
    const todayIncome = todayTx.filter(t => t.type === 'Income').reduce((a, b) => a + (b.amount || 0), 0);
    const todayExpense = todayTx.filter(t => t.type === 'Expense').reduce((a, b) => a + (b.amount || 0), 0);
    // M1 FIX: Renamed to avoid duplicate 'const balance' with line 186
    const currentBalance = (parseFloat(settings.OpeningBalance) || 0) + totalIncome - totalExpense;
    const text = `📊 *${settings.BrandName || 'Business'} — Daily Summary*\n📅 Date: ${todayStr}\n\n✅ Cash In Today: ₹${todayIncome.toLocaleString()}\n❌ Cash Out Today: ₹${todayExpense.toLocaleString()}\n💰 Net Today: ₹${(todayIncome - todayExpense).toLocaleString()}\n\n📦 Total Entries Today: ${todayTx.length}\n💰 Balance: ₹${currentBalance.toLocaleString()}\n\n_Powered by ToCashBook_`;
    if (navigator.share) {
      navigator.share({ title: 'Daily Cash Summary', text });
    } else {
      navigator.clipboard.writeText(text).then(() => alert('Daily summary copied to clipboard!'));
    }
  };

  // Calculations
  const openingBalance = parseFloat(settings.OpeningBalance) || 0;
  const totalIncome = transactions.filter(t => t.type === 'Income').reduce((acc, curr) => acc + (curr.amount || 0), 0);
  const totalExpense = transactions.filter(t => t.type === 'Expense').reduce((acc, curr) => acc + (curr.amount || 0), 0);
  const balance = openingBalance + totalIncome - totalExpense;

  // Staff-wise summary
  const staffSummary = {};
  transactions.forEach(t => {
    const name = t.user || 'Unknown';
    if (!staffSummary[name]) staffSummary[name] = { income: 0, expense: 0, count: 0 };
    if (t.type === 'Income') staffSummary[name].income += (t.amount || 0);
    else staffSummary[name].expense += (t.amount || 0);
    staffSummary[name].count++;
  });

  // Removed chart processing logic to simplify Dashboard

  return (
    <div className="container animate-fade-in pb-20" style={{ padding: '20px' }}>
      <div style={{ textAlign: 'center', margin: '16px 0 24px 0' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--primary)', letterSpacing: '-0.5px', margin: '0 0 4px 0' }}>{settings.BrandName || 'ToCashBook'}</h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0', fontWeight: '500' }}>{settings.Tagline || 'Developed by Thosho Tech'}</p>
      </div>

      <div className="header glass" style={{ padding: '10px 16px', borderRadius: '12px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>Welcome, {user?.Name || user?.Username || user?.Phone}</span>
        
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Link to="/entry" className="btn btn-primary desktop-only" style={{ padding: '6px 12px', textDecoration: 'none', fontSize: '0.85rem' }}>
            <PlusCircle size={16} /> {t('dashboard.add_transaction')}
          </Link>
          <button onClick={handleShareDailySummary} className="btn btn-outline" style={{ padding: '6px 10px' }} title="Share Daily Summary">
            <Share2 size={16} /> <span className="desktop-only" style={{ marginLeft: '4px', fontSize: '0.85rem' }}>Share</span>
          </button>
          <button onClick={handleSync} className="btn btn-outline" style={{ padding: '6px 10px' }} disabled={syncing}>
            <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* View Balance Toggle (Mobile/Tablet Only) */}
      <div className="mobile-only" style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
        <button 
          onClick={() => setShowBalance(!showBalance)} 
          className={`btn ${showBalance ? 'btn-outline' : 'btn-primary'}`} 
          style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem' }}
        >
          {showBalance ? <><EyeOff size={16} /> Hide Balance</> : <><Eye size={16} /> View Balance</>}
        </button>
      </div>

      {/* Balance Cards - Hidden on mobile unless showBalance is true. Always shown on desktop via .desktop-only fallback if showBalance is false */}
      <div className={`animate-fade-in ${showBalance ? '' : 'desktop-only'}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div className="card glass" style={{ borderBottom: '4px solid var(--primary)' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{t('dashboard.net_balance')}</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary)' }}>₹{balance.toFixed(2)}</div>
          </div>
          <div className="card glass" style={{ borderBottom: '4px solid var(--success)' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <ArrowUpRight size={16} className="text-success" /> {t('dashboard.cash_in')}
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--success)' }}>₹{totalIncome.toFixed(2)}</div>
          </div>
          <div className="card glass" style={{ borderBottom: '4px solid var(--danger)' }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <ArrowDownRight size={16} className="text-danger" /> {t('dashboard.cash_out')}
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--danger)' }}>₹{totalExpense.toFixed(2)}</div>
          </div>
        </div>
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BookOpen size={20} /> Your Cashbooks
        </h3>

        {/* View Cashbooks Toggle (Mobile/Tablet Only) */}
        <div className="mobile-only" style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
          <button 
            onClick={() => setShowBooks(!showBooks)} 
            className={`btn ${showBooks ? 'btn-outline' : 'btn-primary'}`} 
            style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem' }}
          >
            {showBooks ? <><EyeOff size={16} /> Hide Cashbooks</> : <><Eye size={16} /> View Cashbooks</>}
          </button>
        </div>

        {/* Cashbooks Grid - Hidden on mobile unless showBooks is true. Always shown on desktop */}
        <div className={`animate-fade-in ${showBooks ? '' : 'desktop-only'}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
          {books.map(b => (
            <div 
              key={b.ID} 
              onClick={() => setActiveBookId(b.ID)}
              className="card glass" 
              style={{ 
                cursor: 'pointer', 
                border: activeBookId === b.ID ? '2px solid var(--primary)' : '2px solid transparent',
                transform: activeBookId === b.ID ? 'scale(1.02)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              <h4 style={{ margin: '0 0 8px 0', color: activeBookId === b.ID ? 'var(--primary)' : 'inherit' }}>{b.Name}</h4>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{b.Description}</p>
            </div>
          ))}
          {books.length === 0 && <p className="text-secondary">No books assigned to you.</p>}
          <div 
            onClick={() => setShowCreateBook(true)}
            className="card glass" 
            style={{ 
              cursor: 'pointer', 
              display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
              border: '2px dashed var(--border-color)',
              minHeight: '80px',
              color: 'var(--text-secondary)'
            }}
          >
            <Plus size={24} style={{ marginBottom: '4px' }} />
            <div style={{ fontSize: '0.85rem' }}>Create Book</div>
          </div>
        </div>
      </div>

      {/* Removed Advanced Analytics card */}
      
      {/* Staff Summary Card */}
      <div className="card glass" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showStaffSummary ? '16px' : '0' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={18} /> Staff Summary
          </h3>
          <button className="btn btn-outline" style={{ padding: '6px 14px', fontSize: '0.8rem' }} onClick={() => setShowStaffSummary(!showStaffSummary)}>
            {showStaffSummary ? 'Hide' : 'View All'}
          </button>
        </div>
        {showStaffSummary && (
          <div style={{ overflowX: 'auto', animation: 'fadeIn 0.3s ease' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Staff</th>
                  <th style={{ padding: '10px', textAlign: 'right', color: 'var(--success)' }}>Cash In</th>
                  <th style={{ padding: '10px', textAlign: 'right', color: 'var(--danger)' }}>Cash Out</th>
                  <th style={{ padding: '10px', textAlign: 'right' }}>Entries</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(staffSummary).sort((a, b) => (b[1].income + b[1].expense) - (a[1].income + a[1].expense)).map(([name, data]) => (
                  <tr key={name} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '10px', fontWeight: '600' }}>{name === 'boss' ? '👑 Boss' : name}</td>
                    <td style={{ padding: '10px', textAlign: 'right', color: 'var(--success)', fontWeight: '600' }}>₹{data.income.toLocaleString()}</td>
                    <td style={{ padding: '10px', textAlign: 'right', color: 'var(--danger)', fontWeight: '600' }}>₹{data.expense.toLocaleString()}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{data.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Entries */}
      <div className="card glass" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0 }}>📋 Recent Entries</h3>
          <Link to="/entries" style={{ fontSize: '0.82rem', color: 'var(--primary)', textDecoration: 'none', fontWeight: '600' }}>View All →</Link>
        </div>
        {transactions.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px 0' }}>No entries yet. Staff entries will appear here after sync.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[...transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10).map(t => (
              <div key={t.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 12px', borderRadius: '10px',
                background: t.type === 'Income' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${t.type === 'Income' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`
              }}>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{t.category} {t.partyName ? `· ${t.partyName}` : ''}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t.date} · by {t.user || '👤 Staff'}</div>
                </div>
                <div style={{ fontWeight: '700', color: t.type === 'Income' ? 'var(--success)' : 'var(--danger)', fontSize: '1rem' }}>
                  {t.type === 'Income' ? '+' : '-'}₹{(t.amount || 0).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Book Modal */}
      {showCreateBook && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', 
          justifyContent: 'center', alignItems: 'center', padding: '20px'
        }}>
          <div className="card glass animate-fade-in" style={{ width: '100%', maxWidth: '400px', position: 'relative' }}>
            <button 
              onClick={() => setShowCreateBook(false)}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'var(--bg-color)', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', padding: '4px', borderRadius: '50%' }}
            >
              <X size={24} />
            </button>
            <h2 style={{ marginBottom: '24px' }}>Create Cashbook</h2>

            <form onSubmit={handleCreateBook}>
              <div className="input-group">
                <label>Book Name</label>
                <input 
                  type="text" 
                  value={newBookName} 
                  onChange={e => setNewBookName(e.target.value)} 
                  placeholder="e.g. Shop, Personal" 
                  required 
                />
              </div>
              
              <div className="input-group">
                <label>Description (Optional)</label>
                <input 
                  type="text" 
                  value={newBookDesc} 
                  onChange={e => setNewBookDesc(e.target.value)} 
                  placeholder="Brief description" 
                />
              </div>

              <div className="input-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ margin: 0 }}>Assign to Staff</label>
                  
                  {/* Desktop manual toggle */}
                  <button 
                    type="button" 
                    onClick={() => setShowInlineStaffForm(!showInlineStaffForm)}
                    className="btn btn-outline desktop-only" 
                    style={{ padding: '4px 8px', fontSize: '0.75rem', gap: '4px' }}
                  >
                    <Plus size={14}/> Add Manually
                  </button>
                  
                  {/* Mobile Contact Picker */}
                  <button 
                    type="button" 
                    onClick={handlePickContact}
                    className="btn btn-outline mobile-only" 
                    style={{ padding: '4px 8px', fontSize: '0.75rem', gap: '4px' }}
                  >
                    <Contact size={14}/> Pick Contact
                  </button>
                </div>

                {showInlineStaffForm && (
                  <div style={{ padding: '12px', background: 'var(--surface-color)', borderRadius: '8px', marginBottom: '12px', border: '1px solid var(--border-color)' }}>
                     <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <input type="text" placeholder="Name" value={inlineStaffName} onChange={e => setInlineStaffName(e.target.value)} style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', width: '100%', background: 'transparent', color: 'var(--text-primary)' }} />
                        <input type="tel" placeholder="Phone Number" value={inlineStaffPhone} onChange={e => setInlineStaffPhone(e.target.value)} required style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', width: '100%', background: 'transparent', color: 'var(--text-primary)' }} />
                        <input type="password" placeholder="Set PIN for Staff" value={inlineStaffPin} onChange={e => setInlineStaffPin(e.target.value)} required style={{ padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', width: '100%', background: 'transparent', color: 'var(--text-primary)' }} />
                     </div>
                  </div>
                )}

                {usersList.filter(u => u.Role !== 'Admin').length > 0 && (
                  <div style={{ maxHeight: '150px', overflowY: 'auto', background: 'var(--bg-color)', padding: '8px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    {usersList.filter(u => u.Role !== 'Admin').map(u => (
                      <label key={u.Username} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', cursor: 'pointer', fontWeight: 'normal' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedStaff.includes(u.Username)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedStaff([...selectedStaff, u.Username]);
                            else setSelectedStaff(selectedStaff.filter(name => name !== u.Username));
                          }}
                        />
                        {u.Name || u.Username}
                      </label>
                    ))}
                  </div>
                )}
                {usersList.filter(u => u.Role !== 'Admin').length === 0 && !showInlineStaffForm && (
                  <div className="text-secondary" style={{ fontSize: '0.85rem' }}>No existing staff. Add one above.</div>
                )}
              </div>

              <button type="submit" className="btn btn-primary w-full" style={{ marginTop: '16px' }}>
                Save Book
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
