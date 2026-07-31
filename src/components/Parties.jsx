import { useState, useEffect } from 'react';
import { getTransactions, addTransaction, generateTxId, getBooks } from '../services/localDb';
import { syncOfflineTransactions } from '../services/sheetsApi';
import { useAppContext } from '../context/AppContext';
import { Users, Search, ArrowUpRight, ArrowDownRight, Plus, X, Contact, BookOpen } from 'lucide-react';

export default function Parties({ user }) {
  const { activeBookId } = useAppContext();
  const [parties, setParties] = useState([]);
  const [books, setBooks] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Pending Balance Modal State
  const [showModal, setShowModal] = useState(false);
  const [pbName, setPbName] = useState('');
  const [pbPhone, setPbPhone] = useState('');
  const [pbType, setPbType] = useState('To Get');
  const [pbAmount, setPbAmount] = useState('');
  const [pbRemarks, setPbRemarks] = useState('');
  const [pbBookId, setPbBookId] = useState('book_main');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadBooks();
    loadParties();
  }, [activeBookId]);

  const loadBooks = async () => {
    const allBooks = await getBooks();
    setBooks(allBooks);
  };

  const handlePickContact = async () => {
    if ('contacts' in navigator && 'ContactsManager' in window) {
      try {
        const props = ['name', 'tel'];
        const contacts = await navigator.contacts.select(props, { multiple: false });
        if (contacts.length > 0) {
          const c = contacts[0];
          if (c.name && c.name[0]) setPbName(c.name[0]);
          if (c.tel && c.tel[0]) setPbPhone(c.tel[0].replace(/\D/g, ''));
        }
      } catch (ex) {
        // user cancelled or error
      }
    } else {
      alert('Contact picker is not supported on this browser. Please enter manually.');
    }
  };

  const loadParties = async () => {
    const transactions = await getTransactions();
    
    // ACCOUNTING: Main Book = General Ledger = consolidated view of ALL cashbooks.
    // Sub-books show only their own transactions.
    // Entries with no bookId are treated as Main Book (backward compatibility).
    const filteredTransactions = (!activeBookId || activeBookId === 'book_main')
      ? transactions  // Main Book = ALL transactions across all books
      : transactions.filter(t => String(t.bookId) === String(activeBookId) || !t.bookId);

    const partyMap = {};

    filteredTransactions.forEach(t => {
      if (!t.partyName || !t.partyName.trim()) return;
      const displayName = t.partyName.trim();
      const key = displayName.toLowerCase();
      
      if (!partyMap[key]) {
        partyMap[key] = { 
          name: displayName, 
          phone: t.partyPhone || '', 
          cashIn: 0, 
          cashOut: 0, 
          openingBalance: 0,
          lastActivity: t.date 
        };
      }
      
      if (!partyMap[key].phone && t.partyPhone) {
        partyMap[key].phone = t.partyPhone;
      }
      
      if (new Date(t.date) > new Date(partyMap[key].lastActivity)) {
        partyMap[key].lastActivity = t.date;
      }

      const amt = parseFloat(t.amount) || 0;
      if (t.category === 'Opening Balance') {
        // Avoid double-counting: if viewing Main Book, skip the auto-reflected copy
        // The auto-reflected copy has bossNotes starting with 'Auto-reflected'
        if (activeBookId === 'book_main' && t.bossNotes?.startsWith('Auto-reflected')) return;
        if (t.type === 'Income') {
          partyMap[key].openingBalance += amt;
        } else {
          partyMap[key].openingBalance -= amt;
        }
      } else {
        if (t.type === 'Income') {
          partyMap[key].cashIn += amt;
        } else {
          partyMap[key].cashOut += amt;
        }
      }
    });

    const partyArray = Object.values(partyMap).map(p => ({
      ...p,
      netBalance: p.openingBalance - p.cashIn + p.cashOut
    })).sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    setParties(partyArray);
  };

  const filteredParties = parties.filter(p => 
    String(p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    String(p.phone || '').includes(searchTerm)
  );

  const totalCashIn = filteredParties.reduce((sum, p) => sum + p.cashIn, 0);
  const totalCashOut = filteredParties.reduce((sum, p) => sum + p.cashOut, 0);
  const totalToGet = filteredParties.filter(p => p.netBalance > 0).reduce((sum, p) => sum + p.netBalance, 0);
  const totalToGive = filteredParties.filter(p => p.netBalance < 0).reduce((sum, p) => sum + Math.abs(p.netBalance), 0);

  const handleOpenModal = () => {
    setPbName('');
    setPbPhone('');
    setPbAmount('');
    setPbType('To Get');
    setPbRemarks('');
    setPbBookId(activeBookId || 'book_main');
    setShowModal(true);
  };

  const handleSubmitPending = async (e) => {
    e.preventDefault();
    if (!String(pbName || '').trim() || !pbAmount || isNaN(pbAmount) || parseFloat(pbAmount) <= 0) return;
    setIsSubmitting(true);
    try {
      const currentUser = user || { Name: 'Boss', Username: 'boss', Role: 'Admin' };
      const targetBookId = pbBookId || activeBookId || 'book_main';
      const bookName = books.find(b => b.ID === targetBookId)?.Name || 'Main Book';

      const newTx = {
        id: generateTxId(),
        date: new Date().toISOString().split('T')[0],
        type: pbType === 'To Get' ? 'Income' : 'Expense',
        category: 'Opening Balance',
        partyName: String(pbName || '').trim(),
        partyPhone: String(pbPhone || '').trim(),
        amount: parseFloat(pbAmount),
        paymentMode: 'Cash',
        upiApp: '',
        reference: '',
        remarks: pbRemarks.trim() || `Opening Balance — ${pbType}`,
        user: currentUser.Name || currentUser.Username || 'Boss',
        imageFile: null,
        imageFilename: '',
        bossNotes: `Set via Customer Dashboard for ${bookName}`,
        recurring: 'none',
        bookId: targetBookId,
        synced: false
      };
      
      await addTransaction(newTx);

      // ACCOUNTING RULE: If the selected book is NOT Main Book,
      // also auto-record it in Main Book so the General Ledger always has a complete picture.
      // The copy is tagged so we can skip double-counting when viewing Main Book.
      if (targetBookId !== 'book_main') {
        const mainBookCopy = {
          ...newTx,
          id: generateTxId(),
          bookId: 'book_main',
          bossNotes: `Auto-reflected from ${bookName} — Opening Balance for ${String(pbName || '').trim()}`,
          remarks: (String(pbRemarks || '').trim() || `Opening Balance — ${pbType}`) + ` [from ${bookName}]`,
          synced: false
        };
        await addTransaction(mainBookCopy);
      }

      if (navigator.onLine) {
        await syncOfflineTransactions();
      }
      setShowModal(false);
      loadParties(); 
    } catch (err) {
      alert("Failed to save pending balance: " + err.message);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="container animate-fade-in pb-20">
      <div className="header glass" style={{ padding: '16px 20px', borderRadius: '16px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={24} /> Customer Dashboard
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
            {!activeBookId || activeBookId === 'book_main'
              ? '📚 Consolidated — All cashbooks'
              : `📖 ${books.find(b => b.ID === activeBookId)?.Name || 'Current Book'} only`}
          </p>
        </div>
        <button onClick={handleOpenModal} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 14px', fontSize: '0.875rem' }}>
          <Plus size={16} /> Set Balance
        </button>
      </div>

      {/* 4 Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '24px' }}>
        <div className="card glass" style={{ borderBottom: '4px solid var(--success)' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ArrowUpRight size={14} /> Total Received
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--success)' }}>₹{totalCashIn.toFixed(2)}</div>
        </div>
        <div className="card glass" style={{ borderBottom: '4px solid var(--danger)' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ArrowDownRight size={14} /> Total Paid Out
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--danger)' }}>₹{totalCashOut.toFixed(2)}</div>
        </div>
        <div className="card glass" style={{ borderBottom: '4px solid var(--primary)' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>📥 Pending To Get</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary)' }}>₹{totalToGet.toFixed(2)}</div>
        </div>
        <div className="card glass" style={{ borderBottom: '4px solid var(--warning)' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>📤 Pending To Give</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--warning)' }}>₹{totalToGive.toFixed(2)}</div>
        </div>
      </div>

      {/* Search */}
      <div className="card glass mb-4" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Search size={18} className="text-secondary" />
        <input 
          type="text" 
          placeholder="Search customer by name or phone..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '1rem', color: 'var(--text-primary)' }}
        />
      </div>

      {/* Party List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filteredParties.length === 0 ? (
          <div className="card glass text-center text-secondary" style={{ padding: '32px' }}>
            No parties found. Use "Set Balance" to add a customer's opening balance.
          </div>
        ) : (
          filteredParties.map(p => (
            <div key={p.name} className="card glass" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '1.05rem' }}>{p.name}</h3>
                {p.phone && <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{p.phone}</p>}
                <p style={{ margin: '4px 0 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Last: {p.lastActivity}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ 
                  fontSize: '1rem', fontWeight: 'bold', 
                  color: p.netBalance > 0 ? 'var(--success)' : p.netBalance < 0 ? 'var(--danger)' : 'var(--text-secondary)' 
                }}>
                  {p.netBalance > 0 ? '📥' : p.netBalance < 0 ? '📤' : '✅'}{' '}
                  {p.netBalance === 0 ? 'Settled' : `₹${Math.abs(p.netBalance).toFixed(2)}`}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  <span className="text-success">Got: ₹{p.cashIn.toFixed(2)}</span>
                  {' · '}
                  <span className="text-danger">Gave: ₹{p.cashOut.toFixed(2)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Set Balance Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.55)', zIndex: 1000,
          display: 'flex', justifyContent: 'center',
          alignItems: 'flex-start',        // anchor to top so content is scrollable
          overflowY: 'auto',               // overlay itself scrolls if needed
          padding: '12px 12px 80px 12px'   // 80px bottom = nav bar clearance
        }}>
          <div className="card glass animate-fade-in" style={{ width: '100%', maxWidth: '420px', padding: '20px', borderRadius: '16px', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>Set Pending Balance</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' }}>
                <X size={22} />
              </button>
            </div>
            
            <form onSubmit={handleSubmitPending} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* Name */}
              <div className="input-group" style={{ margin: 0 }}>
                <label>Customer / Party Name *</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    value={pbName} 
                    onChange={(e) => {
                      setPbName(e.target.value);
                      const match = parties.find(p => p.name.toLowerCase() === e.target.value.toLowerCase());
                      if (match && match.phone) setPbPhone(String(match.phone));
                    }} 
                    placeholder="Enter name" 
                    list="parties-datalist"
                    required 
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="btn btn-outline" onClick={handlePickContact} title="Pick from Contacts" style={{ padding: '8px 12px' }}>
                    <Contact size={20} />
                  </button>
                </div>
                <datalist id="parties-datalist">
                  {parties.map((p, i) => <option key={i} value={p.name} />)}
                </datalist>
              </div>

              {/* Phone */}
              <div className="input-group" style={{ margin: 0 }}>
                <label>Phone Number (Optional)</label>
                <input type="tel" value={pbPhone} onChange={(e) => setPbPhone(e.target.value)} placeholder="Enter phone" />
              </div>

              {/* Balance Type */}
              <div className="input-group" style={{ margin: 0 }}>
                <label>Balance Type *</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" className={`btn ${pbType === 'To Get' ? 'btn-success' : 'btn-outline'}`} onClick={() => setPbType('To Get')} style={{ flex: 1, padding: '10px', fontSize: '0.875rem' }}>
                    📥 I have to Get
                  </button>
                  <button type="button" className={`btn ${pbType === 'To Give' ? 'btn-danger' : 'btn-outline'}`} onClick={() => setPbType('To Give')} style={{ flex: 1, padding: '10px', fontSize: '0.875rem' }}>
                    📤 I have to Give
                  </button>
                </div>
              </div>

              {/* Amount */}
              <div className="input-group" style={{ margin: 0 }}>
                <label>Amount (₹) *</label>
                <input 
                  type="number" 
                  value={pbAmount} 
                  onChange={(e) => setPbAmount(e.target.value)} 
                  placeholder="0.00" 
                  required 
                  min="0.01"
                  step="0.01"
                  style={{ fontSize: '1.5rem', fontWeight: 'bold' }}
                />
              </div>

              {/* Cashbook Selector — only when multiple books */}
              {books.length > 1 && (
                <div className="input-group" style={{ margin: 0 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <BookOpen size={14} /> Cashbook *
                  </label>
                  <select
                    value={pbBookId}
                    onChange={(e) => setPbBookId(e.target.value)}
                    style={{ padding: '10px 12px', borderRadius: '10px', background: 'var(--bg-color)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', fontFamily: 'inherit', fontSize: '0.95rem', width: '100%' }}
                  >
                    {books.map(b => (
                      <option key={b.ID} value={b.ID}>
                        {b.Name}{b.ID === 'book_main' ? ' (Main / General Ledger)' : ''}
                      </option>
                    ))}
                  </select>
                  {pbBookId !== 'book_main' && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--primary)', marginTop: '6px', padding: '8px 10px', background: 'rgba(79,70,229,0.08)', borderRadius: '8px', lineHeight: '1.4' }}>
                      ✅ Entry will be saved in <strong>{books.find(b => b.ID === pbBookId)?.Name}</strong> AND automatically reflected in <strong>Main Book</strong> for full visibility.
                    </div>
                  )}
                </div>
              )}

              {/* Remarks */}
              <div className="input-group" style={{ margin: 0 }}>
                <label>Remarks (Optional)</label>
                <input 
                  type="text" 
                  value={pbRemarks} 
                  onChange={(e) => setPbRemarks(e.target.value)} 
                  placeholder="e.g. Loan given on 01 Jan, old invoice due..." 
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '14px', marginTop: '4px', fontSize: '1rem' }} disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : '💾 Save Balance'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
