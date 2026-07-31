import { useState, useEffect } from 'react';
import { getTransactions, getSettings, getBooks, getUsers, saveBooks, saveUsers, saveTransactions } from '../services/localDb';
import { fetchAllData, syncOfflineTransactions, syncPendingEdits, syncPendingDeletes, pushUsers, pushBooks } from '../services/sheetsApi';
import { hashPIN } from '../services/authUtils';
import { 
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, 
  LineElement, BarElement, Title, Tooltip, Legend, ArcElement 
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { LogOut, RefreshCw, ArrowUpRight, ArrowDownRight, PlusCircle, Users, BookOpen, Share2, Eye, EyeOff, X, Plus, Contact, Trash2, AlertTriangle } from 'lucide-react';
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
  const [showRecentEntries, setShowRecentEntries] = useState(true);
  const [showBooks, setShowBooks] = useState(true);
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

  // Delete Book State
  const [showDeleteBook, setShowDeleteBook] = useState(false);
  const [bookToDelete, setBookToDelete] = useState(null);
  const [deleteMode, setDeleteMode] = useState('move'); // 'move' | 'delete'
  const [deletePin, setDeletePin] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

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
    // ACCOUNTING: Main Book = General Ledger = consolidated view of ALL cashbooks.
    // Entries with no bookId are backward-compatible (treated as Main Book).
    // Individual sub-books show ONLY their own entries.
    // Skip 'Auto-reflected' copies in Main Book to avoid double-counting.
    const filtered = allTrans.filter(t => {
      if (!activeBookId || activeBookId === 'book_main') {
        // Main Book: show all, but skip auto-reflected copies (they are already counted via original)
        return !t.bossNotes?.startsWith('Auto-reflected');
      }
      return t.bookId === activeBookId;
    });
    setTransactions(filtered);
    const s = await getSettings();
    setSettings(s);
    const u = await getUsers();
    setUsersList(u);
    const b = await getBooks();
    // BUG-M10 FIX: Case-insensitive check for 'ALL'
    if (user?.Role === 'Admin' || String(user?.AllowedBooks || '').toUpperCase() === 'ALL') {
      setBooks(b);
    } else {
      const allowed = (user?.AllowedBooks || '').split(',').map(id => id.trim()).filter(Boolean);
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
          // BUG-H4 FIX: Don't overwrite — new inline staff starts with just this book
          AllowedBooks: newBook.ID,
          IsBlocked: 'FALSE'
        };
        updatedUsers.push(newUser);
      } else {
        // Staff already exists — append new book to their AllowedBooks instead of overwriting
        const staffIdx = updatedUsers.findIndex(u => u.Username === inlineStaffPhone || u.Phone === inlineStaffPhone);
        if (staffIdx !== -1) {
          const existing = updatedUsers[staffIdx];
          let allowed = String(existing.AllowedBooks || '');
          if (allowed.toUpperCase() !== 'ALL' && !allowed.split(',').map(x => x.trim()).includes(newBook.ID)) {
            allowed = allowed ? `${allowed}, ${newBook.ID}` : newBook.ID;
            updatedUsers[staffIdx] = { ...existing, AllowedBooks: allowed };
          }
          if (!selectedStaff.includes(inlineStaffPhone)) {
            selectedStaff.push(inlineStaffPhone);
          }
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

    // BUG-H6 FIX: Show user feedback if cloud push fails, don't silently swallow error
    try {
      await pushBooks(updatedBooks);
      await pushUsers(updatedUsers);
    } catch (e) {
      alert(`⚠️ Book "${newBookName}" was created locally but could not be synced to cloud: ${e.message}\n\nPlease press the Sync button when you have internet to push it.`);
    }
  };

  // ─── Delete Book ──────────────────────────────────────────────────────────
  const handleDeleteBook = async () => {
    if (!bookToDelete || !deletePin) return;
    setDeleteError('');
    setDeleting(true);
    try {
      // 1. Verify PIN against the boss user record
      const { verifyPIN } = await import('../services/authUtils');
      const users = await getUsers();
      const bossUser = users.find(u =>
        u.Role === 'Admin' &&
        ((u.Username && String(u.Username).toLowerCase() === String(user?.Username || '').toLowerCase()) ||
         (u.Phone && String(u.Phone) === String(user?.Phone || '')))
      );
      if (!bossUser) { setDeleteError('Boss account not found. Try syncing first.'); setDeleting(false); return; }
      const pinOk = await verifyPIN(deletePin, String(bossUser.PIN));
      if (!pinOk) { setDeleteError('Incorrect PIN. Please try again.'); setDeletePin(''); setDeleting(false); return; }

      // 2. Handle transactions in the book
      const allTx = await getTransactions();
      let updatedTx;
      if (deleteMode === 'move') {
        // Move entries to Main Book
        updatedTx = allTx.map(t =>
          t.bookId === bookToDelete.ID ? { ...t, bookId: 'book_main' } : t
        );
      } else {
        // Permanently erase entries in this book
        updatedTx = allTx.filter(t => t.bookId !== bookToDelete.ID);
      }
      await saveTransactions(updatedTx);

      // 3. Remove the book from books list
      const updatedBooks = books.filter(b => b.ID !== bookToDelete.ID);
      await saveBooks(updatedBooks);

      // 4. Remove book from all staff AllowedBooks
      const allUsers = await getUsers();
      const updatedUsers = allUsers.map(u => {
        if (!u.AllowedBooks || String(u.AllowedBooks).toUpperCase() === 'ALL') return u;
        const allowed = String(u.AllowedBooks).split(',').map(x => x.trim()).filter(id => id !== bookToDelete.ID);
        return { ...u, AllowedBooks: allowed.join(', ') || 'book_main' };
      });
      await saveUsers(updatedUsers);

      // 5. Push to cloud
      try {
        await pushBooks(updatedBooks);
        await pushUsers(updatedUsers);
      } catch (e) {
        console.warn('Cloud sync after delete failed:', e.message);
      }

      // 6. If active book was deleted, switch to Main Book
      if (activeBookId === bookToDelete.ID) setActiveBookId('book_main');

      setShowDeleteBook(false);
      setBookToDelete(null);
      setDeletePin('');
      setDeleteMode('move');
      await loadData();
    } catch (err) {
      setDeleteError('Failed: ' + err.message);
    }
    setDeleting(false);
  };

  const openDeleteModal = (e, book) => {
    e.stopPropagation(); // prevent book from being selected
    setBookToDelete(book);
    setDeletePin('');
    setDeleteMode('move');
    setDeleteError('');
    setShowDeleteBook(true);
  };

  // Calculations (Hoisted above handlers & G1 sub-book fix applied)
  const openingBalance = (!activeBookId || activeBookId === 'book_main') ? (parseFloat(settings.OpeningBalance) || 0) : 0;
  const totalIncome = transactions.filter(t => t.type === 'Income').reduce((acc, curr) => acc + (curr.amount || 0), 0);
  const totalExpense = transactions.filter(t => t.type === 'Expense').reduce((acc, curr) => acc + (curr.amount || 0), 0);
  const balance = openingBalance + totalIncome - totalExpense;

  const handleShareDailySummary = () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;
    const todayTx = transactions.filter(t => t.date === todayStr);
    const todayIncome = todayTx.filter(t => t.type === 'Income').reduce((a, b) => a + (b.amount || 0), 0);
    const todayExpense = todayTx.filter(t => t.type === 'Expense').reduce((a, b) => a + (b.amount || 0), 0);
    const text = `📊 *${settings.BrandName || 'Business'} — Daily Summary*\n📅 Date: ${todayStr}\n\n✅ Cash In Today: ₹${todayIncome.toLocaleString()}\n❌ Cash Out Today: ₹${todayExpense.toLocaleString()}\n💰 Net Today: ₹${(todayIncome - todayExpense).toLocaleString()}\n\n📦 Total Entries Today: ${todayTx.length}\n💰 Balance: ₹${balance.toLocaleString()}\n\n_Powered by Open Cashbook_`;
    if (navigator.share) {
      navigator.share({ title: 'Daily Cash Summary', text });
    } else {
      navigator.clipboard.writeText(text).then(() => alert('Daily summary copied to clipboard!'));
    }
  };

  // Staff-wise summary
  const staffSummary = {};
  transactions.forEach(t => {
    const name = t.user || 'Unknown';
    if (!staffSummary[name]) staffSummary[name] = { income: 0, expense: 0, count: 0 };
    if (t.type === 'Income') staffSummary[name].income += (t.amount || 0);
    else staffSummary[name].expense += (t.amount || 0);
    staffSummary[name].count++;
  });

  return (
    <div className="container animate-fade-in pb-20" style={{ padding: '16px' }}>
      {/* ── Brand row: [Sync] · Pasha · Personal CashBook · [Share] ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0 2px 0' }}>
        {/* Left — Sync */}
        <button onClick={handleSync} className="btn btn-outline" style={{ padding: '7px 10px', flexShrink: 0 }} disabled={syncing}>
          <RefreshCw size={17} className={syncing ? 'animate-spin' : ''} />
        </button>

        {/* Center — Brand */}
        <div style={{ textAlign: 'center', flex: 1 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--primary)', letterSpacing: '-0.5px', margin: 0, lineHeight: 1.2 }}>
            {settings.BrandName || 'Open Cashbook'}
          </h1>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0, fontWeight: '500' }}>
            {settings.Tagline || 'Your financial data stays truly yours.'}
          </p>
        </div>

        {/* Right — Share */}
        <button onClick={handleShareDailySummary} className="btn btn-outline" style={{ padding: '7px 10px', flexShrink: 0 }} title="Share Daily Summary">
          <Share2 size={17} />
        </button>
      </div>

      {/* Welcome & Header Cashbook Selector */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 4px 14px 4px', borderBottom: '1px solid var(--border-color)', marginBottom: '14px' }}>
        <div style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-primary)' }}>
          Welcome, {user?.Name || user?.Username || user?.Phone}
          {/* Desktop-only add entry link */}
          <Link to="/entry" className="btn btn-primary desktop-only" style={{ padding: '5px 12px', textDecoration: 'none', fontSize: '0.8rem', marginLeft: '12px', verticalAlign: 'middle' }}>
            <PlusCircle size={14} /> {t('dashboard.add_transaction')}
          </Link>
        </div>

        {/* Header Cashbook Selector */}
        {books.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <BookOpen size={16} className="text-primary" />
            <select
              value={activeBookId}
              onChange={(e) => setActiveBookId(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--surface-color)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                fontWeight: '600',
                cursor: 'pointer',
                outline: 'none',
                minWidth: '140px'
              }}
            >
              {books.map(b => (
                <option key={b.ID} value={b.ID}>{b.Name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ── Balance Cards — always visible, responsive font ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '20px' }}>
        <div className="card glass" style={{ borderBottom: '4px solid var(--primary)', padding: '10px 8px', minWidth: 0 }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('dashboard.net_balance')}</div>
          <div style={{ fontSize: 'clamp(0.85rem, 3.5vw, 1.4rem)', fontWeight: 'bold', color: 'var(--primary)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>₹{balance.toFixed(0)}</div>
        </div>
        <div className="card glass" style={{ borderBottom: '4px solid var(--success)', padding: '10px 8px', minWidth: 0 }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '2px', whiteSpace: 'nowrap' }}>
            <ArrowUpRight size={12} className="text-success" /> {t('dashboard.cash_in')}
          </div>
          <div style={{ fontSize: 'clamp(0.85rem, 3.5vw, 1.4rem)', fontWeight: 'bold', color: 'var(--success)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>₹{totalIncome.toFixed(0)}</div>
        </div>
        <div className="card glass" style={{ borderBottom: '4px solid var(--danger)', padding: '10px 8px', minWidth: 0 }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '2px', whiteSpace: 'nowrap' }}>
            <ArrowDownRight size={12} className="text-danger" /> {t('dashboard.cash_out')}
          </div>
          <div style={{ fontSize: 'clamp(0.85rem, 3.5vw, 1.4rem)', fontWeight: 'bold', color: 'var(--danger)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>₹{totalExpense.toFixed(0)}</div>
        </div>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: '700', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
          <BookOpen size={18} className="text-primary" /> Your Cashbooks
        </h3>

        {/* Cashbooks Strips — horizontal strip padding layout */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {books.map(b => {
            const isSelected = activeBookId === b.ID;
            return (
              <div 
                key={b.ID} 
                onClick={() => setActiveBookId(b.ID)}
                className="card glass" 
                style={{ 
                  cursor: 'pointer', 
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                  background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--surface-color)',
                  borderRadius: '12px',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                  <span style={{ 
                    width: '36px', height: '36px', borderRadius: '8px', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center', 
                    background: isSelected ? 'var(--primary)' : 'rgba(150, 150, 150, 0.12)', 
                    color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                    flexShrink: 0
                  }}>
                    <BookOpen size={17} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ 
                      fontSize: '0.95rem', 
                      fontWeight: '600', 
                      color: isSelected ? 'var(--primary)' : 'var(--text-primary)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                    }}>
                      {b.Name} {isSelected && <span style={{ fontSize: '0.7rem', background: 'var(--primary)', color: 'white', padding: '2px 6px', borderRadius: '10px', marginLeft: '6px', fontWeight: '700' }}>Active</span>}
                    </div>
                    {b.Description && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {b.Description}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: '12px' }}>
                  {/* Delete button — only on sub-books, not Main Book */}
                  {b.ID !== 'book_main' && (
                    <button
                      onClick={(e) => openDeleteModal(e, b)}
                      title={`Delete "${b.Name}"`}
                      style={{
                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: '6px', padding: '6px 8px', cursor: 'pointer',
                        color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {books.length === 0 && <p className="text-secondary">No books assigned to you.</p>}
          <div 
            onClick={() => setShowCreateBook(true)}
            className="card glass" 
            style={{ 
              cursor: 'pointer', 
              padding: '10px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              border: '2px dashed var(--border-color)',
              borderRadius: '12px',
              color: 'var(--primary)',
              fontWeight: '600',
              fontSize: '0.88rem',
              transition: 'all 0.2s',
              background: 'transparent',
              minHeight: '46px'
            }}
          >
            <Plus size={18} /> Create New Cashbook
          </div>
        </div>
      </div>

      {/* Staff Summary Card */}
      <div className="card glass" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showStaffSummary ? '14px' : '0' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
            <Users size={18} className="text-primary" /> Staff Summary
          </h3>
          <button className="btn btn-outline" style={{ padding: '5px 12px', fontSize: '0.78rem' }} onClick={() => setShowStaffSummary(!showStaffSummary)}>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: showRecentEntries ? '14px' : '0' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
            📋 Recent Entries
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
            <button className="btn btn-outline" style={{ padding: '4px 12px', fontSize: '0.78rem', minWidth: '78px', textAlign: 'center' }} onClick={() => setShowRecentEntries(!showRecentEntries)}>
              {showRecentEntries ? 'Hide' : 'View All'}
            </button>
            <Link to="/entries" style={{ fontSize: '0.75rem', color: 'var(--primary)', textDecoration: 'none', fontWeight: '700', letterSpacing: '0.2px' }}>Full List →</Link>
          </div>
        </div>
        {showRecentEntries && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            {transactions.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px 0' }}>No entries yet. Staff entries will appear here after sync.</p>
            ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[...transactions].sort((a, b) => {
              const diff = new Date(b.date) - new Date(a.date);
              if (diff !== 0) return diff;
              return String(b.id).localeCompare(String(a.id));
            }).slice(0, 10).map(t => (
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
        )}
      </div>

      {/* Create Book Modal */}
      {showCreateBook && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          background: 'rgba(0,0,0,0.5)', zIndex: 100,
          display: 'flex', justifyContent: 'center',
          alignItems: 'flex-start', overflowY: 'auto',
          padding: '12px 12px 80px 12px'
        }}>
          <div className="card glass animate-fade-in" style={{ width: '100%', maxWidth: '400px', position: 'relative', flexShrink: 0 }}>
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
                    style={{ padding: '6px 12px', fontSize: '0.8rem', gap: '6px', color: '#3b82f6', fontWeight: '600' }}
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
      {/* ─── Delete Book Modal ─────────────────────────────────────── */}
      {showDeleteBook && bookToDelete && (() => {
        const allTx = transactions; // current loaded transactions
        const bookEntryCount = allTx.filter(t => t.bookId === bookToDelete.ID).length;
        return (
          <div style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.65)', zIndex: 2000,
            display: 'flex', justifyContent: 'center',
            alignItems: 'flex-start', overflowY: 'auto',
            padding: '12px 12px 80px 12px'
          }}>
            <div className="card glass animate-fade-in" style={{
              width: '100%', maxWidth: '420px', padding: '24px',
              borderRadius: '16px', border: '2px solid var(--danger)'
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <AlertTriangle size={24} color="var(--danger)" />
                <h3 style={{ margin: 0, color: 'var(--danger)' }}>Delete Cashbook</h3>
              </div>

              {/* Warning */}
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px', fontSize: '0.88rem', lineHeight: '1.5' }}>
                ⚠️ You are about to delete <strong>"{bookToDelete.Name}"</strong>.<br />
                This book has <strong>{bookEntryCount} entries</strong>.<br />
                <span style={{ color: 'var(--danger)', fontWeight: 600 }}>This action cannot be undone.</span>
              </div>

              {/* What to do with entries */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                  What should happen to the {bookEntryCount} entries?
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', border: `2px solid ${deleteMode === 'move' ? 'var(--primary)' : 'var(--border-color)'}`, cursor: 'pointer', background: deleteMode === 'move' ? 'rgba(79,70,229,0.06)' : 'transparent' }}>
                    <input type="radio" value="move" checked={deleteMode === 'move'} onChange={() => setDeleteMode('move')} style={{ accentColor: 'var(--primary)' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>✅ Move to Main Book (Recommended)</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>All entries are preserved in Main Book. No data lost.</div>
                    </div>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', border: `2px solid ${deleteMode === 'erase' ? 'var(--danger)' : 'var(--border-color)'}`, cursor: 'pointer', background: deleteMode === 'erase' ? 'rgba(239,68,68,0.06)' : 'transparent' }}>
                    <input type="radio" value="erase" checked={deleteMode === 'erase'} onChange={() => setDeleteMode('erase')} style={{ accentColor: 'var(--danger)' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--danger)' }}>🗑️ Delete entries permanently</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>All {bookEntryCount} entries will be erased forever. Cannot recover.</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* PIN confirmation */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  🔐 Enter your Boss PIN to confirm
                </label>
                <input
                  type="password"
                  value={deletePin}
                  onChange={e => { setDeletePin(e.target.value); setDeleteError(''); }}
                  placeholder="Enter your PIN"
                  maxLength={10}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1.5px solid ${deleteError ? 'var(--danger)' : 'var(--border-color)'}`, background: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '1.1rem', letterSpacing: '4px', fontFamily: 'monospace' }}
                  autoFocus
                />
                {deleteError && (
                  <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '6px' }}>❌ {deleteError}</div>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => { setShowDeleteBook(false); setDeletePin(''); setDeleteError(''); }}
                  className="btn btn-outline"
                  style={{ flex: 1, padding: '12px' }}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteBook}
                  className="btn"
                  style={{ flex: 1, padding: '12px', background: 'var(--danger)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: deleting || !deletePin ? 'not-allowed' : 'pointer', opacity: deleting || !deletePin ? 0.6 : 1 }}
                  disabled={deleting || !deletePin}
                >
                  {deleting ? '⏳ Deleting...' : '🗑️ Delete Book'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
