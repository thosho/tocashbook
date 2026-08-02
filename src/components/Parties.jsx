import { useState, useEffect } from 'react';
import { getTransactions, addTransaction, generateTxId, getBooks } from '../services/localDb';
import { syncOfflineTransactions } from '../services/sheetsApi';
import { useAppContext } from '../context/AppContext';
import { Users, Search, ArrowUpRight, ArrowDownRight, Plus, X, Contact, BookOpen, MessageCircle, FileText, Download, Share2, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { getSettings } from '../services/localDb';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { getAdaptiveFontSize } from '../services/uiUtils';

export default function Parties({ user }) {
  const { activeBookId, setActiveBookId } = useAppContext();
  const { t } = useTranslation();
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
  
  // Party Ledger State
  const [selectedParty, setSelectedParty] = useState(null);
  const [partyTransactions, setPartyTransactions] = useState([]);
  const [appSettings, setAppSettings] = useState({});

  useEffect(() => {
    loadBooks();
    loadParties();
    getSettings().then(s => setAppSettings(s));
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
    
    // ACCOUNTING: Each book is strictly isolated to its own ledger transactions.
    // Entries with no bookId are treated as belonging exclusively to Main Book (backward compatibility).
    const filteredTransactions = (activeBookId === 'all_books')
      ? transactions
      : (!activeBookId || activeBookId === 'book_main')
      ? transactions.filter(t => !t.bookId || String(t.bookId) === 'book_main')
      : transactions.filter(t => String(t.bookId) === String(activeBookId));

    const partyMap = {};

    filteredTransactions.forEach(t => {
      if (!t.partyName || !String(t.partyName).trim()) return;
      const displayName = String(t.partyName).trim();
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
    String(p.name || '').toLowerCase().includes(String(searchTerm || '').toLowerCase()) || 
    String(p.phone || '').includes(String(searchTerm || ''))
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
    setPbBookId(activeBookId === 'all_books' ? 'book_main' : (activeBookId || 'book_main'));
    setShowModal(true);
  };

  const handleSubmitPending = async (e) => {
    e.preventDefault();
    if (!String(pbName || '').trim() || !pbAmount || isNaN(pbAmount) || parseFloat(pbAmount) <= 0) return;
    setIsSubmitting(true);
    try {
      const currentUser = user || { Name: 'Boss', Username: 'boss', Role: 'Admin' };
      const targetBookId = pbBookId || activeBookId || 'book_main';
      const bookName = books.find(b => b.ID === targetBookId)?.Name || 'My Book';

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

      // Note: No duplicate row created; Main Book operates as General Ledger aggregating all sub-books cleanly without duplicate records drifting out of sync.
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

  const handleOpenParty = async (party) => {
    setSelectedParty(party);
    const allTx = await getTransactions();
    const filtered = allTx.filter(t => 
      (activeBookId === 'all_books' ? true : (!activeBookId || activeBookId === 'book_main' ? (!t.bookId || String(t.bookId) === 'book_main') : String(t.bookId) === String(activeBookId))) &&
      String(t.partyName).trim().toLowerCase() === party.name.toLowerCase()
    ).sort((a, b) => new Date(b.date) - new Date(a.date));
    setPartyTransactions(filtered);
  };

  const handleSendReminder = (party) => {
    if (!party.phone) {
      alert("Please set a phone number for this customer first by editing an entry or setting their balance.");
      return;
    }
    const isToGet = party.netBalance > 0;
    const amt = Math.abs(party.netBalance).toLocaleString();
    let message = '';
    if (isToGet) {
      message = `Hello ${party.name}, your pending balance is ₹${amt} at ${appSettings.BrandName || 'our business'}. Please clear it at the earliest. Thank you!`;
    } else {
      message = `Hello ${party.name}, we have a pending balance of ₹${amt} to pay you from ${appSettings.BrandName || 'our business'}. We will clear it soon. Thank you!`;
    }
    const url = `https://wa.me/${party.phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  const handleGeneratePDF = async (party) => {
    try {
      const doc = new jsPDF();
      const brand = appSettings.BrandName || 'Open Cashbook';
      doc.setFontSize(20);
      doc.text(brand, 14, 22);
      doc.setFontSize(11);
      doc.setTextColor(100);
      doc.text(`Statement for: ${party.name}`, 14, 30);
      if (party.phone) doc.text(`Phone: ${party.phone}`, 14, 36);
      doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 42);
      
      const netBal = party.netBalance;
      const balText = netBal === 0 ? 'Settled' : netBal > 0 ? `To Get: Rs.${Math.abs(netBal).toLocaleString()}` : `To Give: Rs.${Math.abs(netBal).toLocaleString()}`;
      doc.setFontSize(14);
      doc.setTextColor(netBal > 0 ? '#16a34a' : netBal < 0 ? '#dc2626' : '#475569');
      doc.text(`Net Balance: ${balText}`, 14, 52);

      const tableColumn = ["Date", "Details", "Cash In (+)", "Cash Out (-)"];
      const tableRows = [];

      // Chronological order for the statement
      [...partyTransactions].reverse().forEach(t => {
        const d = t.date ? (isNaN(new Date(t.date).getTime()) ? String(t.date).split('T')[0] : new Date(t.date).toLocaleDateString()) : '';
        const details = t.category === 'Opening Balance' ? 'Opening Balance' : (t.remarks || t.category || '');
        const cin = t.type === 'Income' ? `Rs.${(t.amount || 0).toLocaleString()}` : '';
        const cout = t.type === 'Expense' ? `Rs.${(t.amount || 0).toLocaleString()}` : '';
        tableRows.push([d, details, cin, cout]);
      });

      doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 60,
        theme: 'grid',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [59, 130, 246] },
        columnStyles: {
          2: { halign: 'right', textColor: [22, 163, 74] },
          3: { halign: 'right', textColor: [220, 38, 38] }
        }
      });

      const pdfOutput = doc.output('datauristring');
      
      if (Capacitor.isNativePlatform()) {
        const fileName = `Statement_${party.name.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
        const savedFile = await Filesystem.writeFile({
          path: fileName,
          data: pdfOutput,
          directory: Directory.Cache
        });
        
        if ((await Share.canShare()).value) {
          await Share.share({
            title: `${party.name} Statement`,
            text: `Here is the ledger statement for ${party.name}`,
            url: savedFile.uri,
            dialogTitle: 'Share Statement'
          });
        }
      } else {
        doc.save(`Statement_${party.name.replace(/\s+/g, '_')}.pdf`);
      }
    } catch (err) {
      alert('Failed to generate PDF: ' + err.message);
    }
  };

  return (
    <div className="container animate-fade-in pb-20">
      <div className="header glass" style={{ padding: '16px 20px', borderRadius: '16px', marginBottom: '20px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div style={{ flex: '1 1 auto' }}>
          <h2 style={{ fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={24} className="text-primary" /> {t('parties.customer_dashboard')}
          </h2>
          {/* Cashbook Selector right below Customer Dashboard heading */}
          {books.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '500' }}>Book:</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <BookOpen size={15} className="text-primary" />
                <select
                  value={activeBookId || 'book_main'}
                  onChange={(e) => setActiveBookId(e.target.value)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--surface-color)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    outline: 'none',
                    minWidth: '130px'
                  }}
                >
                  {/* Show All Books option for Admin or users with ALL access */}
                  {(user?.Role === 'Admin' || String(user?.AllowedBooks || '').toUpperCase() === 'ALL') && (
                    <option value="all_books">All Books (Combined)</option>
                  )}
                  {books.map(b => (
                    <option key={b.ID} value={b.ID}>{b.Name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
        <button onClick={handleOpenModal} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '10px 16px', fontSize: '0.875rem', flexShrink: 0, minHeight: '44px' }}>
          <Plus size={16} /> Set Balance
        </button>
      </div>

      {/* 4 Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '24px' }}>
        <div className="card glass" style={{ borderBottom: '4px solid var(--success)' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ArrowUpRight size={14} /> {t('parties.net_received')}
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--success)' }}>₹{totalCashIn.toFixed(2)}</div>
        </div>
        <div className="card glass" style={{ borderBottom: '4px solid var(--danger)' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ArrowDownRight size={14} /> {t('parties.net_paid')}
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--danger)' }}>₹{totalCashOut.toFixed(2)}</div>
        </div>
        <div className="card glass" style={{ borderBottom: '4px solid var(--primary)' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>📥 {t('parties.you_will_get')}</div>
          <div style={{ fontSize: getAdaptiveFontSize(totalToGet, 1.2), fontWeight: 'bold', color: 'var(--primary)' }}>₹{totalToGet.toFixed(2)}</div>
        </div>
        <div className="card glass" style={{ borderBottom: '4px solid var(--warning)' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>📤 {t('parties.you_will_give')}</div>
          <div style={{ fontSize: getAdaptiveFontSize(totalToGive, 1.2), fontWeight: 'bold', color: 'var(--warning)' }}>₹{totalToGive.toFixed(2)}</div>
        </div>
      </div>

      {/* Search */}
      <div className="card glass mb-4" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Search size={18} className="text-secondary" />
        <input 
          type="text" 
          placeholder={t('parties.search')} 
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
            <div key={p.name} onClick={() => handleOpenParty(p)} className="card glass" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
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
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>View Ledger</span> <ArrowUpRight size={12} />
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

              <div className="input-group" style={{ margin: 0 }}>
                <label>Customer / Party Name *</label>
                <div style={{ display: 'flex', gap: '8px', width: '100%', alignItems: 'center' }}>
                  <input 
                    type="text" 
                    value={pbName} 
                    onChange={(e) => {
                      setPbName(e.target.value);
                      const match = parties.find(p => String(p.name || '').toLowerCase() === String(e.target.value || '').toLowerCase());
                      if (match && match.phone) setPbPhone(String(match.phone));
                    }} 
                    placeholder="Enter name" 
                    list="parties-datalist"
                    required 
                    style={{ flex: '1 1 auto', minWidth: 0, padding: '10px 14px', minHeight: '44px', borderRadius: '8px', fontSize: '0.95rem' }}
                  />
                  <button type="button" className="btn btn-outline" onClick={handlePickContact} title="Pick from Contacts" style={{ flexShrink: 0, minHeight: '44px', minWidth: '48px', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                        {b.Name}{b.ID === 'book_main' ? ' (My Book / General Ledger)' : ''}
                      </option>
                    ))}
                  </select>
                  {pbBookId !== 'book_main' && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--primary)', marginTop: '6px', padding: '8px 10px', background: 'rgba(79,70,229,0.08)', borderRadius: '8px', lineHeight: '1.4' }}>
                      ✅ Entry will be saved in <strong>{books.find(b => b.ID === pbBookId)?.Name}</strong> and automatically included when viewing <strong>My Book (General Ledger)</strong>.
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

      {/* Party Ledger Modal */}
      {selectedParty && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.55)', zIndex: 1000,
          display: 'flex', justifyContent: 'center',
          alignItems: 'flex-start',
          overflowY: 'auto',
          padding: '12px 12px 80px 12px'
        }}>
          <div className="card glass animate-fade-in" style={{ width: '100%', maxWidth: '600px', padding: '20px', borderRadius: '16px', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '1.25rem', color: 'var(--primary)' }}>{selectedParty.name}</h3>
                {selectedParty.phone && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    <Phone size={14} /> {selectedParty.phone}
                  </div>
                )}
              </div>
              <button onClick={() => setSelectedParty(null)} style={{ background: 'var(--bg-color)', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', padding: '6px', borderRadius: '50%' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
              <div style={{ background: 'var(--bg-color)', padding: '12px', borderRadius: '10px', textAlign: 'center', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Net Balance</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: selectedParty.netBalance > 0 ? 'var(--success)' : selectedParty.netBalance < 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                  {selectedParty.netBalance === 0 ? 'Settled' : `₹${Math.abs(selectedParty.netBalance).toLocaleString()}`}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {selectedParty.netBalance > 0 ? 'To Get' : selectedParty.netBalance < 0 ? 'To Give' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button className="btn btn-outline" onClick={() => handleGeneratePDF(selectedParty)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '0 8px' }}>
                  <FileText size={16} /> PDF Statement
                </button>
                <button className="btn btn-outline" onClick={() => handleSendReminder(selectedParty)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '0 8px', color: '#25D366', borderColor: 'rgba(37, 211, 102, 0.3)' }}>
                  <MessageCircle size={16} /> Remind
                </button>
              </div>
            </div>

            <h4 style={{ margin: '0 0 12px 0', fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>Transactions</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '50vh', overflowY: 'auto', paddingRight: '4px' }}>
              {partyTransactions.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '20px 0' }}>No transactions found.</div>
              ) : (
                partyTransactions.map(t => (
                  <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderRadius: '10px', background: 'var(--bg-color)', borderLeft: `4px solid ${t.type === 'Income' ? 'var(--success)' : 'var(--danger)'}` }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{t.category === 'Opening Balance' ? 'Opening Balance' : (t.remarks || t.category)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {t.date ? (isNaN(new Date(t.date).getTime()) ? String(t.date).split('T')[0] : new Date(t.date).toLocaleDateString()) : ''} · by {t.user || 'Boss'}
                      </div>
                    </div>
                    <div style={{ fontWeight: '700', color: t.type === 'Income' ? 'var(--success)' : 'var(--danger)' }}>
                      {t.type === 'Income' ? '+' : '-'}₹{(t.amount || 0).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
