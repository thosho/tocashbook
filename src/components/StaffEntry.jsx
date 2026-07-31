import { useState, useEffect, useRef } from 'react';
import { getCategories, addTransaction, getTransactions, updateTransactionLocally, addPendingEdit, addPendingDelete, getPendingCount, deleteTransaction, getBooks, addCategory, getSettings, generateTxId } from '../services/localDb';
import { syncOfflineTransactions, syncPendingEdits, syncPendingDeletes, editTransactionAPI, deleteTransactionAPI } from '../services/sheetsApi';
import { Camera, Plus, Minus, Send, RefreshCw, LogOut, Edit3, AlertCircle, Repeat, FileText, Trash2, CalendarDays, BookOpen, Share2, Download, CheckCircle, X } from 'lucide-react';
import { jsPDF } from "jspdf";
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';

// BUG FIX #10: Get today's date in LOCAL timezone (not UTC)
const getLocalDateString = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function StaffEntry({ user, setAuthUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const editTransaction = location.state?.editTransaction || null;
  const { activeBookId, setActiveBookId } = useAppContext();

  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [books, setBooks] = useState([]);
  
  // Form State
  const [type, setType] = useState('Income');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partyPhone, setPartyPhone] = useState('');
  const [uniqueParties, setUniqueParties] = useState([]);
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [upiApp, setUpiApp] = useState('');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [bossNotes, setBossNotes] = useState('');       // Boss-only private notes
  const [recurring, setRecurring] = useState('none'); // 'none' | 'daily' | 'weekly' | 'monthly'
  const [txDate, setTxDate] = useState(getLocalDateString()); // Custom date picker
  const [image, setImage] = useState(null);
  const [imageFilename, setImageFilename] = useState('');
  const [savedEntry, setSavedEntry] = useState(null);
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [deleting, setDeleting] = useState(false);
  
  const [syncing, setSyncing] = useState(false);
  const fileInputRef = useRef(null);
  // Ref to always hold the currently active/resolved bookId for transactions
  // (avoids stale closure issue where activeBookId from context hasn't updated yet)
  const resolvedBookIdRef = useRef(activeBookId);

  useEffect(() => {
    loadData();
    if (editTransaction) {
      setType(editTransaction.type);
      setAmount(editTransaction.amount.toString());
      setCategory(editTransaction.category);
      setPartyName(editTransaction.partyName || '');
      setPartyPhone(editTransaction.partyPhone || '');
      setPaymentMode(editTransaction.paymentMode || 'Cash');
      setUpiApp(editTransaction.upiApp || '');
      setReference(editTransaction.reference || '');
      setRemarks(editTransaction.remarks || '');
      setBossNotes(editTransaction.bossNotes || '');
      setRecurring(editTransaction.recurring || 'none');
      setTxDate(editTransaction.date || getLocalDateString());
    }
  }, [editTransaction]);

  const loadData = async () => {
    const cats = await getCategories();
    setCategories(cats);
    if (!editTransaction && cats.length > 0) {
      setCategory(cats.filter(c => c.Type === 'Income')[0]?.Name || '');
    }
    
    const trans = await getTransactions();
    
    // Extract unique parties for autocomplete
    const partiesMap = new Map();
    trans.forEach(t => {
      if (t.partyName && !partiesMap.has(t.partyName)) {
        partiesMap.set(t.partyName, t.partyPhone || '');
      }
    });
    setUniqueParties(Array.from(partiesMap.entries()).map(([name, phone]) => ({ name, phone })));

    // Load Books for Staff
    const allBooks = await getBooks();
    let allowedBooks = allBooks;
    if (user?.Role !== 'Admin' && user?.AllowedBooks !== 'ALL') {
      const allowedIds = (user?.AllowedBooks || '').split(',').map(id => id.trim());
      allowedBooks = allBooks.filter(b => allowedIds.includes(b.ID));
    }
    setBooks(allowedBooks);
    
    // Auto-select first book if activeBookId is invalid or not set
    let currentBookId = activeBookId;
    if (allowedBooks.length > 0 && !allowedBooks.find(b => b.ID === activeBookId)) {
      currentBookId = allowedBooks[0].ID;
      setActiveBookId(currentBookId);
    }
    // Always keep the ref in sync so handleSubmit uses correct bookId immediately
    resolvedBookIdRef.current = currentBookId;

    // BUG FIX #11: Case-insensitive filter for staff's own transactions
    setTransactions(
      trans
        .filter(t => t.user?.toLowerCase() === (user.Name || user.Username || user.Phone)?.toLowerCase() && t.bookId === currentBookId)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 10)
    );

    // Load pending count for badge
    const count = await getPendingCount();
    setPendingCount(count);
  };

  useEffect(() => {
    if (!editTransaction) {
      const filteredCats = categories.filter(c => c.Type === type);
      // Only reset category if the current selection is invalid for this type
      // This prevents overwriting a newly created category after adding it
      const currentStillValid = filteredCats.some(c => c.Name === category);
      if (!currentStillValid) {
        setCategory(filteredCats.length > 0 ? filteredCats[0].Name : '');
      }
    }
  }, [type, categories, editTransaction]);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFilename(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        if (file.type === 'application/pdf') {
          // Do not compress PDFs, just save the raw dataURL
          setImage(reader.result);
          return;
        }

        // Compress image before storing to avoid large payloads
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          const scale = Math.min(1, MAX_WIDTH / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          setImage(canvas.toDataURL('image/jpeg', 0.75)); // 75% quality JPEG
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount greater than 0.');
      return;
    }

    // Duplicate Detection: same amount + party + today's date within last 5 mins
    if (!editTransaction) {
      const now = Date.now();
      const todayStr = getLocalDateString();
      const duplicate = transactions.find(t =>
        t.bookId === activeBookId &&
        t.date === todayStr &&
        Math.abs(t.amount - parseFloat(amount)) < 0.01 &&
        (t.partyName || '') === partyName &&
        (now - new Date(t.id.replace('tx_', ''))) < 5 * 60 * 1000
      );
      if (duplicate && !duplicateWarning) {
        setDuplicateWarning(`A similar entry (₹${duplicate.amount}${partyName ? ' for ' + partyName : ''}) was just added. Submit again to confirm.`);
        return;
      }
    }
    setDuplicateWarning(null);

    if (editTransaction) {
      const editMetadata = {
        dateEdited: new Date().toISOString(),
        editedBy: user.Name || user.Username || user.Phone,
        oldAmount: editTransaction.amount,
        newAmount: parseFloat(amount)
      };

      const updatedTx = {
        ...editTransaction,
        type,
        category,
        partyName: (partyName || '').trim(),
        partyPhone: (partyPhone || '').trim(),
        amount: parseFloat(amount),
        paymentMode,
        upiApp: paymentMode === 'UPI' ? upiApp : '',
        reference,
        remarks,
        bossNotes: user.Role === 'Admin' ? bossNotes : editTransaction.bossNotes,
        recurring,
        imageFile: image,
        imageFilename: imageFilename
      };

      setSyncing(true);
      try {
        if (navigator.onLine) {
          await editTransactionAPI(updatedTx, editMetadata);
          await updateTransactionLocally(updatedTx, editMetadata);
          alert("Transaction updated successfully!");
        } else {
          // BUG FIX #3: Queue edit for later sync when offline
          await updateTransactionLocally(updatedTx, editMetadata);
          await addPendingEdit(updatedTx, editMetadata);
          alert("Saved offline! Edit will sync to Google Sheet when internet is restored.");
        }
        navigate(user.Role === 'Admin' ? '/reports' : '/staff-entry');
      } catch (e) {
        alert("Failed to update: " + e.message);
      }
      setSyncing(false);
      
    } else {
      const newTx = {
        id: generateTxId(), // H1 FIX: collision-safe ID
        date: txDate, // Use custom date (defaults to today)
        type,
        category,
        partyName: (partyName || '').trim(),
        partyPhone: (partyPhone || '').trim(),
        amount: parseFloat(amount),
        paymentMode,
        upiApp: paymentMode === 'UPI' ? upiApp : '',
        reference,
        remarks,
        bossNotes: user.Role === 'Admin' ? bossNotes : '',
        recurring,
        user: user.Name || user.Username || user.Phone,
        imageFile: image,
        imageFilename: imageFilename,
        synced: false,
        bookId: resolvedBookIdRef.current || activeBookId  // Use resolved ref to avoid stale state
      };

      await addTransaction(newTx);
      setSavedEntry(newTx);
      
      // Reset form
      setAmount('');
      setPartyName('');
      setPartyPhone('');
      setReference('');
      setRemarks('');
      setImage(null);
      setImageFilename('');
      setTxDate(getLocalDateString()); // reset to today
      if (fileInputRef.current) fileInputRef.current.value = '';
      
      loadData();
      await handleSync(); // Attempt to sync immediately; will call loadData() after to clear Pending badges
    }
  };

  const handleDelete = async () => {
    if (!editTransaction) return;
    const reason = window.prompt('Enter reason for deletion (required):');
    if (!reason || !reason.trim()) return;
    if (!window.confirm(`Are you sure you want to DELETE this transaction of ₹${editTransaction.amount}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      if (navigator.onLine) {
        await deleteTransactionAPI(editTransaction.id, user.Name || user.Username || user.Phone, reason);
        await deleteTransaction(editTransaction.id);
      } else {
        // H6 FIX: Queue delete for when connection is restored
        await deleteTransaction(editTransaction.id); // remove locally
        await addPendingDelete(editTransaction.id, user.Name || user.Username || user.Phone, reason);
        alert('Deleted locally. Will sync to server when internet is restored.');
        navigate(user.Role === 'Admin' ? '/entries' : '/staff-entry');
        setDeleting(false);
        return;
      }
      alert('Transaction deleted successfully.');
      navigate(user.Role === 'Admin' ? '/entries' : '/staff-entry');
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
    setDeleting(false);
  };

  const handleSync = async () => {
    setSyncing(true);
    await syncOfflineTransactions();
    await syncPendingEdits();
    await syncPendingDeletes(); // H6 FIX: flush queued offline deletes
    const count = await getPendingCount();
    setPendingCount(count);
    setSyncing(false);
    // Refresh transaction list so "Pending" badges update to "Synced"
    loadData();
  };

  const handleContactPicker = async () => {
    if ('contacts' in navigator && 'ContactsManager' in window) {
      try {
        const props = ['name', 'tel'];
        const opts = { multiple: false };
        const contacts = await navigator.contacts.select(props, opts);
        if (contacts && contacts.length > 0) {
          const contact = contacts[0];
          setPartyName(contact.name ? contact.name[0] : '');
          setPartyPhone(contact.tel ? contact.tel[0].replace(/[^0-9+]/g, '') : '');
        }
      } catch (ex) {
        console.error('Contact picker failed', ex);
        alert('Could not access contacts. You can type the name manually.');
      }
    } else {
      alert('Contact Picker API is not supported on this device/browser.');
    }
  };

  const handlePartySelect = (e) => {
    const selectedName = e.target.value;
    setPartyName(selectedName);
    const match = uniqueParties.find(p => p.name.trim().toLowerCase() === selectedName.trim().toLowerCase());
    if (match && match.phone && !partyPhone) {
      setPartyPhone(match.phone);
    }
  };

  const handleAddNewCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    const newCat = {
      ID: Date.now().toString(),
      Name: newCategoryName.trim(),
      Type: type
    };
    await addCategory(newCat);
    setCategories(prev => [...prev, newCat]);
    setCategory(newCat.Name);
    setNewCategoryName('');
  };

  const handleLogout = () => {
    // BUG-L3 FIX: Warn if there are pending unsynced entries before logout
    if (pendingCount > 0) {
      if (!window.confirm(`You have ${pendingCount} unsynced entr${pendingCount > 1 ? 'ies' : 'y'} pending. They are saved on this device but not yet uploaded. Logout anyway?`)) return;
    } else {
      if (!window.confirm('Are you sure you want to logout?')) return;
    }
    setAuthUser(null);
    navigate('/');
  };

  const handleShareReceipt = async (t, downloadOnly = false) => {
    try {
      const settings = await getSettings();

      const generateLogicalReceiptNumber = (txId, brandName) => {
        const parts = txId.split('_');
        const timestamp = parseInt(parts[1], 10);
        
        if (isNaN(timestamp)) {
          return (brandName ? brandName.substring(0,3).toUpperCase() + '-' : '') + txId.replace('tx_', '').slice(-6).toUpperCase();
        }
        
        const d = new Date(timestamp);
        const yy = String(d.getFullYear()).slice(-2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        
        const prefix = brandName ? brandName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 3).toUpperCase() : 'REC';
        return `${prefix}-${yy}${mm}${dd}-${hh}${min}${ss}`;
      };

      const receiptNumber = generateLogicalReceiptNumber(t.id, settings.BrandName);

      const doc = new jsPDF({ format: [100, 180] });
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
      doc.text(`Receipt #: ${receiptNumber}`, 10, headerY + 6);
      
      let amountY = headerY + 12;
      doc.line(10, amountY, 90, amountY);
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Amount:", 10, amountY + 8);
      doc.setFontSize(14);
      doc.setTextColor(t.type === 'Income' ? 0 : 139, t.type === 'Income' ? 100 : 0, 0);
      doc.text(`Rs. ${parseFloat(t.amount).toLocaleString()}`, 90, amountY + 8, { align: "right" });
      
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
      doc.text(`Collected by: ${t.user || user?.Name || user?.Username || 'Staff'}`, 50, currentY, { align: "center" });
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
      <div className="header glass" style={{ padding: '16px 20px', borderRadius: '16px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '1.25rem', margin: 0 }}>
          {editTransaction ? 'Edit Transaction' : `Hello, ${user?.Name || user?.Username || user?.Phone}`}
        </h2>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          {books.length > 1 ? (
            <select 
              value={activeBookId} 
              onChange={(e) => {
                const newId = e.target.value;
                resolvedBookIdRef.current = newId;
                setActiveBookId(newId);
                setTimeout(() => loadData(), 0);
              }}
              style={{ padding: '6px 10px', fontSize: '0.875rem', borderRadius: '8px', background: 'var(--bg-color)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', outline: 'none' }}
            >
              {books.map(b => (
                <option key={b.ID} value={b.ID}>{b.Name}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: '0.875rem', color: 'var(--primary)', fontWeight: '500' }}>
              {books.find(b => b.ID === activeBookId)?.Name || (editTransaction ? `Editing ID: ${editTransaction.id}` : 'Staff Dashboard')}
            </span>
          )}

          {/* Pending Sync Badge */}
          {!editTransaction && pendingCount > 0 && (
            <div style={{ 
              display: 'flex', alignItems: 'center', gap: '6px', 
              backgroundColor: 'var(--warning)', color: 'white',
              borderRadius: '20px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: '600'
            }}>
              <AlertCircle size={14} />
              {pendingCount} pending
            </div>
          )}
          {!editTransaction && (
            <button onClick={handleSync} className="btn btn-outline" style={{ padding: '8px' }} disabled={syncing}>
              <RefreshCw size={18} className={syncing ? "animate-spin" : ""} />
            </button>
          )}
        </div>
      </div>

      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '16px' }}>{editTransaction ? 'Update Entry' : 'Add Entry'}</h3>
        
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button 
            type="button"
            className={`btn w-full ${type === 'Income' ? 'btn-success' : 'btn-outline'}`}
            onClick={() => setType('Income')}
          >
            <Plus size={18} /> Cash In
          </button>
          <button 
            type="button"
            className={`btn w-full ${type === 'Expense' ? 'btn-danger' : 'btn-outline'}`}
            onClick={() => setType('Expense')}
          >
            <Minus size={18} /> Cash Out
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Amount (₹)</label>
            <input 
              type="number" 
              step="0.01"
              min="0.01"
              value={amount} 
              onChange={(e) => setAmount(e.target.value)} 
              placeholder="0.00" 
              required 
              style={{ fontSize: '1.5rem', fontWeight: 'bold' }}
            />
          </div>

          <div className="input-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CalendarDays size={14} /> Date
              {txDate !== getLocalDateString() && <span style={{ fontSize: '0.7rem', color: 'var(--warning)', fontWeight: 600 }}>← Custom date</span>}
            </label>
            <input
              type="date"
              value={txDate}
              max={getLocalDateString()}
              onChange={(e) => setTxDate(e.target.value)}
            />
          </div>
          
          <div className="input-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <label style={{ marginBottom: 0 }}>Party / Contact Name (Optional)</label>
              {('contacts' in navigator) && (
                <button type="button" onClick={handleContactPicker} className="text-primary" style={{ background: 'none', border: 'none', fontSize: '0.875rem', cursor: 'pointer' }}>
                  📞 Pick Contact
                </button>
              )}
            </div>
            <input 
              type="text" 
              list="party-list"
              value={partyName} 
              onChange={handlePartySelect} 
              placeholder="Who did you pay / receive from?" 
            />
            <datalist id="party-list">
              {uniqueParties.map((p, i) => (
                <option key={i} value={p.name} />
              ))}
            </datalist>
          </div>

          <div className="input-group">
            <label>Party Phone (Optional)</label>
            <input 
              type="tel" 
              value={partyPhone} 
              onChange={(e) => setPartyPhone(e.target.value)} 
              placeholder="Phone Number" 
            />
          </div>

          {/* Category + Payment Mode — always 2 columns, fits mobile */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="input-group">
              <label>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} required>
                <option value="" disabled>Select Category</option>
                {categories.filter(c => c.Type === type).map(c => (
                  <option key={c.ID} value={c.Name}>{c.Name}</option>
                ))}
                <option value="CREATE_NEW" style={{ fontWeight: 'bold', color: 'var(--primary)' }}>+ Add New Category</option>
              </select>
            </div>
            
            <div className="input-group">
              <label>Payment Mode</label>
              <select value={paymentMode} onChange={(e) => {
                setPaymentMode(e.target.value);
                if (e.target.value !== 'UPI') setUpiApp('');
              }} required>
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Card">Card</option>
                <option value="Bank Transfer">Bank Transfer</option>
              </select>
            </div>
          </div>

          {/* Cashbook selector — full width on its own row, only when multiple books */}
          {books.length > 1 && (
            <div className="input-group" style={{ marginTop: '4px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <BookOpen size={13} /> Cashbook
              </label>
              <select
                value={resolvedBookIdRef.current || activeBookId}
                onChange={(e) => {
                  const newId = e.target.value;
                  resolvedBookIdRef.current = newId;
                  setActiveBookId(newId);
                  setTimeout(() => loadData(), 0);
                }}
              >
                {books.map(b => (
                  <option key={b.ID} value={b.ID}>{b.Name}</option>
                ))}
              </select>
            </div>
          )}

          {category === 'CREATE_NEW' && (
            <div className="input-group animate-fade-in" style={{ padding: '12px', background: 'var(--bg-color)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <label>New Category Name</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  value={newCategoryName} 
                  onChange={(e) => setNewCategoryName(e.target.value)} 
                  placeholder="Enter category name"
                  style={{ flex: 1, marginBottom: 0 }}
                />
                <button type="button" onClick={handleAddNewCategory} className="btn btn-primary" style={{ padding: '0 16px' }}>Add</button>
              </div>
            </div>
          )}

          {paymentMode === 'UPI' && (
            <div className="input-group animate-fade-in">
              <label>UPI App (Optional)</label>
              <select value={upiApp} onChange={(e) => setUpiApp(e.target.value)}>
                <option value="">Select App</option>
                <option value="GPay">GPay</option>
                <option value="PhonePe">PhonePe</option>
                <option value="Paytm">Paytm</option>
                <option value="WhatsApp">WhatsApp</option>
                <option value="Amazon Pay">Amazon Pay</option>
                <option value="Other">Other</option>
              </select>
            </div>
          )}

          {paymentMode !== 'Cash' && (
            <div className="input-group animate-fade-in">
              <label>Transaction ID / Reference (Optional)</label>
              <input 
                type="text" 
                value={reference} 
                onChange={(e) => setReference(e.target.value)} 
                placeholder="e.g. UTR or Ref number" 
              />
            </div>
          )}

          <div className="input-group">
            <label>Remarks</label>
            <textarea 
              value={remarks} 
              onChange={(e) => setRemarks(e.target.value)} 
              placeholder="Add details about this entry..."
              rows="2"
            />
          </div>

          {/* Recurring Expense Selector */}
          <div className="input-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Repeat size={14} /> Recurring
            </label>
            <select value={recurring} onChange={e => setRecurring(e.target.value)}>
              <option value="none">Not Recurring</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          {/* Boss-only Notes (only visible when Boss is entering) */}
          {user?.Role === 'Admin' && (
            <div className="input-group animate-fade-in">
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--primary)' }}>
                <FileText size={14} /> Boss Notes (Private — Staff cannot see this)
              </label>
              <textarea
                value={bossNotes}
                onChange={e => setBossNotes(e.target.value)}
                placeholder="Internal notes, flags, or reminders..."
                rows="2"
                style={{ borderColor: 'rgba(79,70,229,0.3)' }}
              />
            </div>
          )}

          <div className="input-group">
            <label>Receipt / Bill (Image / PDF)</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button 
                type="button" 
                className="btn btn-outline"
                onClick={() => fileInputRef.current.click()}
              >
                <Camera size={18} /> {imageFilename ? 'Change File' : 'Attach File'}
              </button>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                {imageFilename || 'No file selected'}
              </span>
            </div>
            <input 
              type="file" 
              accept="image/*,application/pdf" 
              ref={fileInputRef} 
              onChange={handleImageChange} 
              style={{ display: 'none' }} 
            />
          </div>

          {/* Duplicate Warning Banner */}
          {duplicateWarning && (
            <div style={{
              backgroundColor: 'rgba(245,158,11,0.15)', border: '1px solid var(--warning)',
              borderRadius: '10px', padding: '12px 16px', marginTop: '12px',
              display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '0.85rem'
            }}>
              <AlertCircle size={18} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '1px' }} />
              <div>
                <strong style={{ color: 'var(--warning)' }}>Possible Duplicate!</strong>
                <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)' }}>{duplicateWarning}</p>
                <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Press <strong>Save Entry</strong> again to confirm this is intentional.
                </p>
              </div>
            </div>
          )}

          <button type="submit" className="btn btn-primary w-full" style={{ marginTop: '16px', minHeight: '48px' }} disabled={syncing}>
            {syncing ? (
              <RefreshCw size={18} className="animate-spin" />
            ) : editTransaction ? (
              <Edit3 size={18} />
            ) : (
              <Send size={18} />
            )}
            {editTransaction ? 'Update Entry' : 'Save Entry'}
          </button>
          
          {editTransaction && (
            <button type="button" className="btn btn-outline w-full" style={{ marginTop: '12px', minHeight: '48px' }} onClick={() => navigate(-1)}>
              Cancel Edit
            </button>
          )}
          {/* Boss-only delete button */}
          {editTransaction && user?.Role === 'Admin' && (
            <button
              type="button"
              className="btn w-full"
              style={{ marginTop: '8px', minHeight: '48px', background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid var(--danger)', gap: '8px' }}
              onClick={handleDelete}
              disabled={deleting}
            >
              <Trash2 size={18} />
              {deleting ? 'Deleting...' : 'Delete Transaction (Boss Only)'}
            </button>
          )}
        </form>
      </div>

      {!editTransaction && (
        <div className="card glass">
          <h3 style={{ marginBottom: '16px' }}>Recent Entries</h3>
          {transactions.length === 0 ? (
            <p className="text-center text-secondary">No recent transactions.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {transactions.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                  <div>
                    <div style={{ fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {t.category}
                      {!t.synced && (
                        <span style={{ fontSize: '0.65rem', backgroundColor: 'var(--warning)', color: 'white', borderRadius: '4px', padding: '2px 5px' }}>
                          Pending
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{t.date} {t.remarks && `- ${t.remarks}`}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ fontWeight: 'bold', color: t.type === 'Income' ? 'var(--success)' : 'var(--danger)' }}>
                      {t.type === 'Income' ? '+' : '-'} ₹{t.amount}
                    </div>
                    <button onClick={() => navigate(user.Role === 'Admin' ? '/entry' : '/staff-entry', { state: { editTransaction: t } })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', padding: '4px' }} title="Edit">
                      <Edit3 size={16} />
                    </button>
                    <button onClick={() => handleShareReceipt(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--success)', padding: '4px' }} title="Share Receipt">
                      <Share2 size={16} />
                    </button>
                    <button onClick={() => handleShareReceipt(t, true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', padding: '4px' }} title="Download PDF">
                      <Download size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Saved Entry Success Modal */}
      {savedEntry && (
        <div className="modal-overlay animate-fade-in" style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex',
          justifyContent: 'center', alignItems: 'center', padding: '16px'
        }}>
          <div className="card glass animate-fade-in" style={{ width: '100%', maxWidth: '320px', padding: '24px', borderRadius: '20px', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '-16px' }}>
              <button onClick={() => setSavedEntry(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)' }}>
                <X size={24} />
              </button>
            </div>
            
            <CheckCircle size={48} className="text-success" style={{ margin: '0 auto 16px auto' }} />
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.25rem' }}>Entry Saved!</h3>
            
            <div style={{ background: 'var(--bg-color)', borderRadius: '12px', padding: '16px', margin: '16px 0', textAlign: 'left' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: savedEntry.type === 'Income' ? 'var(--success)' : 'var(--danger)', marginBottom: '8px', textAlign: 'center' }}>
                ₹{savedEntry.amount}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Party:</span>
                <span style={{ fontWeight: '500' }}>{savedEntry.partyName || 'N/A'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Date:</span>
                <span style={{ fontWeight: '500' }}>{savedEntry.date}</span>
              </div>
              
              {savedEntry.imageFile && (
                <div style={{ marginTop: '12px', textAlign: 'center' }}>
                  {savedEntry.imageFile.startsWith('data:image/') ? (
                    <img src={savedEntry.imageFile} alt="Receipt" style={{ maxWidth: '100%', maxHeight: '100px', borderRadius: '8px', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', background: 'rgba(0,0,0,0.05)', borderRadius: '8px' }}>
                      <FileText size={20} className="text-primary" />
                      <span style={{ fontSize: '0.85rem' }}>PDF Attached</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button onClick={() => handleShareReceipt(savedEntry)} className="btn btn-primary" style={{ width: '100%', padding: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
              <Share2 size={18} /> Share Receipt
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
