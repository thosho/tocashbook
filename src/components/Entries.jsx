import { useState, useEffect, useMemo } from 'react';
import { getTransactions, getUsers, getCategories, getSettings } from '../services/localDb';
import { fetchAllData, syncOfflineTransactions, syncPendingEdits } from '../services/sheetsApi';
import { List, RefreshCw, Clock, Edit3, Info, X, Search, Filter, AlertCircle, History, Share2, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { jsPDF } from "jspdf";

export default function Entries() {
  const navigate = useNavigate();
  const { activeBookId } = useAppContext();
  const [transactions, setTransactions] = useState([]);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [settings, setSettings] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date().toLocaleString());

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterMode, setFilterMode] = useState('all');
  const [showRecentOnly, setShowRecentOnly] = useState(false);

  // History Modal State
  const [selectedHistory, setSelectedHistory] = useState(null);

  useEffect(() => {
    // BUG-M3 FIX: Auto-sync on load so boss always sees latest entries
    const autoSync = async () => {
      setSyncing(true);
      try {
        await fetchAllData();
        await syncOfflineTransactions();
        await syncPendingEdits();
      } catch (_) { /* silent fail — show cached data */ }
      await loadData();
      setSyncing(false);
      setLastUpdated(new Date().toLocaleString());
    };
    autoSync();
  }, []);

  const loadData = async () => {
    setTransactions(await getTransactions());
    setUsers(await getUsers());
    setCategories(await getCategories());
    const s = await getSettings();
    setSettings(s || {});
  };

  const getStaffName = (username) => {
    if (!username) return '—';
    if (username.toLowerCase() === 'boss') return '👑 Boss';
    // BUG-C3 FIX: Use Name field first, fall back to Username or the raw value
    const user = users.find(u =>
      u.Name?.toLowerCase() === username.toLowerCase() ||
      u.Username?.toLowerCase() === username.toLowerCase() ||
      u.Phone?.toLowerCase() === username.toLowerCase()
    );
    return user ? (user.Name || user.Username || username) : username;
  };

  const handleRefresh = async () => {
    setSyncing(true);
    try {
      await fetchAllData();
      await syncOfflineTransactions();
      await syncPendingEdits();
      await loadData();
      setLastUpdated(new Date().toLocaleString());
    } catch (error) {
      alert("Refresh Failed: " + error.message);
    }
    setSyncing(false);
  };

  // BUG-C2 FIX: Include entries with no bookId (old entries) + entries matching active book
  const filteredTx = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    let result = [...transactions]
      .filter(t => !t.bookId || t.bookId === activeBookId)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .filter(t => {
        const typeMatch = filterType === 'all' || t.type === filterType;
        const modeMatch = filterMode === 'all' || (t.paymentMode || 'Cash') === filterMode;
        if (!typeMatch || !modeMatch) return false;
        if (!q) return true;
        return (
          t.partyName?.toLowerCase().includes(q) ||
          t.category?.toLowerCase().includes(q) ||
          t.remarks?.toLowerCase().includes(q) ||
          t.reference?.toLowerCase().includes(q) ||
          String(t.amount).includes(q) ||
          t.date?.includes(q) ||
          t.user?.toLowerCase().includes(q)
        );
      });
      
    if (showRecentOnly) {
      result = result.slice(0, 15); // Show last 15 entries
    }
    return result;
  }, [transactions, searchQuery, filterType, filterMode, activeBookId, showRecentOnly]);

  // BUG-H4 FIX: Compute running balance starting from Opening Balance
  const runningBalance = useMemo(() => {
    const chronological = [...filteredTx].reverse();
    let balance = parseFloat(settings.OpeningBalance) || 0;
    const balMap = {};
    chronological.forEach(t => {
      balance += t.type === 'Income' ? (t.amount || 0) : -(t.amount || 0);
      balMap[t.id] = balance;
    });
    return balMap;
  }, [filteredTx, settings]);

  const totalIn = filteredTx.filter(t => t.type === 'Income').reduce((a, b) => a + (b.amount || 0), 0);
  const totalOut = filteredTx.filter(t => t.type === 'Expense').reduce((a, b) => a + (b.amount || 0), 0);

  const handleShareReceipt = async (t, downloadOnly = false) => {
    try {
      const settings = await getSettings();

      const doc = new jsPDF({ format: [100, 180] }); // small receipt format
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(settings.BrandName || "Payment Receipt", 50, 15, { align: "center" });
      
      let headerY = 22;
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      if (settings.Phone) { doc.text(`Phone: ${settings.Phone}`, 50, headerY, { align: "center" }); headerY += 5; }
      if (settings.Address) { doc.text(`${settings.Address.slice(0,45)}`, 50, headerY, { align: "center" }); headerY += 5; }
      
      doc.setDrawColor(200, 200, 200);
      doc.line(10, headerY, 90, headerY);
      headerY += 6;

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.text(`Date: ${t.date}`, 10, headerY);
      // BUG-L1 FIX: Use proper BRAND-YYMMDD-HHMMSS receipt number format
      const parts = t.id.split('_');
      const ts = parseInt(parts[1], 10);
      const d = isNaN(ts) ? new Date() : new Date(ts);
      const brand = (settings.BrandName || 'REC').replace(/[^a-zA-Z0-9]/g, '').substring(0, 3).toUpperCase();
      const receiptNum = `${brand}-${String(d.getFullYear()).slice(-2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
      doc.text(`Receipt #: ${receiptNum}`, 10, headerY + 6);
      
      let amountY = headerY + 12;
      doc.line(10, amountY, 90, amountY);
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Amount:", 10, amountY + 8);
      doc.setFontSize(14);
      doc.setTextColor(t.type === 'Income' ? 0 : 139, t.type === 'Income' ? 100 : 0, 0);
      doc.text(`Rs. ${t.amount.toLocaleString()}`, 90, amountY + 8, { align: "right" });
      
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(`Type: ${t.type}`, 10, amountY + 18);
      doc.text(`Mode: ${t.paymentMode || 'Cash'}`, 10, amountY + 24);
      doc.text(`Category: ${t.category}`, 10, amountY + 30);
      let currentY = amountY + 36;
      if (t.partyName) { doc.text(`Party: ${t.partyName}`, 10, currentY); currentY += 6; }
      if (t.remarks) { doc.text(`Remarks: ${t.remarks.slice(0,25)}`, 10, currentY); currentY += 6; }
      
      doc.line(10, currentY + 2, 90, currentY + 2);
      currentY += 8;
      
      doc.setFontSize(8);
      doc.text(`Collected by: ${t.user || 'Staff'}`, 50, currentY, { align: "center" });
      currentY += 6;
      doc.text("Thank you for your business!", 50, currentY, { align: "center" });

      const pageHeight = doc.internal.pageSize.getHeight();
      let footerY = pageHeight - 14;

      doc.setTextColor(100, 100, 100);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("ToCashBook", 50, footerY, { align: "center" });
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text("Developed by", 50, footerY + 4, { align: "center" });
      
      doc.setTextColor(59, 130, 246);
      doc.setFont("helvetica", "bold");
      const linkText = "Thosho Tech";
      const textWidth = doc.getTextWidth(linkText);
      const linkX = 50 - (textWidth / 2);
      doc.text(linkText, 50, footerY + 8, { align: "center" });
      doc.link(linkX, footerY + 5, textWidth, 5, { url: "https://thoshotech.com" });

      const pdfBlob = doc.output('blob');
      const file = new File([pdfBlob], `Receipt_${t.partyName || t.id}.pdf`, { type: 'application/pdf' });
      
      if (downloadOnly) {
        doc.save(`Receipt_${t.partyName || t.id}.pdf`);
        return;
      }
      
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Payment Receipt',
          text: `Payment Receipt for Rs. ${t.amount}`
        });
      } else {
        doc.save(`Receipt_${t.partyName || t.id}.pdf`);
      }
    } catch (err) {
      alert("Failed to share receipt: " + err.message);
    }
  };

  return (
    <div className="container animate-fade-in pb-20">
      {/* Header */}
      <div className="header glass" style={{ padding: '16px 20px', borderRadius: '16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <List size={24} className="text-primary" />
            <div>
              <h2 style={{ fontSize: '1.25rem', margin: 0 }}>All Entries</h2>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                <Clock size={11} /> {lastUpdated}
              </div>
            </div>
          </div>
          <button onClick={handleRefresh} className="btn btn-outline" style={{ padding: '10px', minWidth: '44px', minHeight: '44px' }} disabled={syncing}>
            <RefreshCw size={18} className={syncing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="card glass mb-3" style={{ padding: '12px 16px' }}>
        <div style={{ position: 'relative', marginBottom: '12px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input
            type="text"
            placeholder="Search by name, category, amount, remark..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px 10px 36px',
              borderRadius: '10px', border: '1px solid var(--border-color)',
              background: 'var(--bg-color)', color: 'var(--text-primary)',
              fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none',
              boxSizing: 'border-box'
            }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', alignSelf: 'center', marginRight: '4px' }}>Type:</span>
          {['all', 'Income', 'Expense'].map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              style={{
                padding: '4px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                fontSize: '0.75rem', fontWeight: '600', fontFamily: 'inherit',
                background: filterType === t ? (t === 'Income' ? 'var(--success)' : t === 'Expense' ? 'var(--danger)' : 'var(--primary)') : 'var(--bg-color)',
                color: filterType === t ? 'white' : 'var(--text-secondary)',
                minHeight: '32px'
              }}>
              {t === 'all' ? 'All' : t}
            </button>
          ))}
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', alignSelf: 'center', marginLeft: '8px', marginRight: '4px' }}>Mode:</span>
          {['all', 'Cash', 'UPI', 'Card', 'Bank Transfer'].map(m => (
            <button key={m} onClick={() => setFilterMode(m)}
              style={{
                padding: '4px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                fontSize: '0.75rem', fontWeight: '600', fontFamily: 'inherit',
                background: filterMode === m ? 'var(--primary)' : 'var(--bg-color)',
                color: filterMode === m ? 'white' : 'var(--text-secondary)',
                minHeight: '32px'
              }}>
              {m === 'all' ? 'All' : m}
            </button>
          ))}
          
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', alignSelf: 'center', marginLeft: '8px', marginRight: '4px' }}>Sort:</span>
          <button onClick={() => setShowRecentOnly(!showRecentOnly)}
            style={{
              padding: '4px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: '600', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '4px',
              background: showRecentOnly ? 'var(--primary)' : 'var(--bg-color)',
              color: showRecentOnly ? 'white' : 'var(--text-secondary)',
              minHeight: '32px'
            }}>
            <History size={14} /> Recent 15
          </button>
        </div>
      </div>

      {/* Summary Row */}
      {filteredTx.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px', marginTop: '16px' }}>
          <div className="card glass" style={{ padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>SHOWN</div>
            <div style={{ fontWeight: '700', fontSize: '1rem' }}>{filteredTx.length}</div>
          </div>
          <div className="card glass" style={{ padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--success)', marginBottom: '4px' }}>CASH IN</div>
            <div style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--success)' }}>₹{totalIn.toLocaleString()}</div>
          </div>
          <div className="card glass" style={{ padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--danger)', marginBottom: '4px' }}>CASH OUT</div>
            <div style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--danger)' }}>₹{totalOut.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Entries List */}
      <div className="card glass">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {filteredTx.length === 0 ? (
            <p className="text-center text-secondary" style={{ padding: '24px 0' }}>
              {searchQuery ? `No results for "${searchQuery}"` : 'No entries found.'}
            </p>
          ) : (
            filteredTx.map((t, idx) => (
              <div key={t.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 0',
                borderBottom: idx < filteredTx.length - 1 ? '1px solid var(--border-color)' : 'none',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
                      {t.partyName || t.category}
                    </span>
                    <span className={`badge ${t.type === 'Income' ? 'badge-income' : 'badge-expense'}`} style={{ fontSize: '0.6rem', padding: '2px 6px' }}>
                      {t.type === 'Income' ? 'IN' : 'OUT'}
                    </span>
                    {!t.synced && (
                      <span style={{ fontSize: '0.6rem', backgroundColor: 'var(--warning)', color: 'white', borderRadius: '4px', padding: '2px 5px' }}>
                        Pending
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                    {t.date} · {t.paymentMode || 'Cash'} · {getStaffName(t.user)}
                    {t.remarks && <span> · {t.remarks.slice(0, 30)}{t.remarks.length > 30 ? '…' : ''}</span>}
                  </div>
                  {t.bossNotes && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--primary)', marginTop: '2px', fontStyle: 'italic' }}>
                      📝 {t.bossNotes}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: '12px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: '700', color: t.type === 'Income' ? 'var(--success)' : 'var(--danger)', fontSize: '0.95rem' }}>
                      {t.type === 'Income' ? '+' : '-'}₹{(t.amount || 0).toLocaleString()}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: (runningBalance[t.id] || 0) >= 0 ? 'var(--text-secondary)' : 'var(--danger)', marginTop: '2px' }}>
                      Bal: ₹{(runningBalance[t.id] || 0).toLocaleString()}
                    </div>
                  </div>
                  <button onClick={() => navigate('/entry', { state: { editTransaction: t } })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', padding: '6px', minWidth: '32px', minHeight: '32px' }} title="Edit">
                    <Edit3 size={15} />
                  </button>
                  <button onClick={() => handleShareReceipt(t)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--success)', padding: '6px', minWidth: '32px', minHeight: '32px' }} title="Share Receipt">
                    <Share2 size={15} />
                  </button>
                  <button onClick={() => handleShareReceipt(t, true)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', padding: '6px', minWidth: '32px', minHeight: '32px' }} title="Download PDF">
                    <Download size={15} />
                  </button>
                  {t.editHistory && t.editHistory.length > 0 && (
                    <button onClick={() => setSelectedHistory(t.editHistory)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '6px', minWidth: '32px', minHeight: '32px' }} title="Edit History">
                      <Info size={15} />
                    </button>
                  )}
                </div>

              </div>
            ))
          )}
        </div>
      </div>

      {/* Edit History Modal */}
      {selectedHistory && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '16px' }}>
          <div className="card glass animate-fade-in" style={{ width: '100%', maxWidth: '400px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>Edit History</h3>
              <button onClick={() => setSelectedHistory(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {selectedHistory.map((h, idx) => (
                <div key={idx} style={{ padding: '12px', background: 'var(--bg-color)', borderRadius: '8px', fontSize: '0.875rem' }}>
                  <div><strong className="text-primary">Edited By:</strong> {getStaffName(h.editedBy)}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{new Date(h.dateEdited).toLocaleString()}</div>
                  <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ textDecoration: 'line-through', color: 'var(--danger)' }}>₹{h.oldAmount}</span>
                    <span>→</span>
                    <span style={{ color: 'var(--success)', fontWeight: 'bold' }}>₹{h.newAmount}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
