import { useState, useEffect } from 'react';
import { getTransactions, addTransaction, generateTxId } from '../services/localDb';
import { syncOfflineTransactions } from '../services/sheetsApi';
import { useAppContext } from '../context/AppContext';
import { Users, Search, ArrowUpRight, ArrowDownRight, Plus, X, Contact } from 'lucide-react';

export default function Parties({ user }) {
  const { activeBookId } = useAppContext();
  const [parties, setParties] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Pending Balance Modal State
  const [showModal, setShowModal] = useState(false);
  const [pbName, setPbName] = useState('');
  const [pbPhone, setPbPhone] = useState('');
  const [pbType, setPbType] = useState('To Get');
  const [pbAmount, setPbAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadParties();
  }, [activeBookId]);

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
    const filteredTransactions = transactions.filter(t => String(t.bookId) === String(activeBookId));
    const partyMap = {};

    filteredTransactions.forEach(t => {
      if (!t.partyName || !t.partyName.trim()) return;
      const displayName = t.partyName.trim();
      const key = displayName.toLowerCase(); // Normalize for deduplication
      
      if (!partyMap[key]) {
        partyMap[key] = { 
          name: displayName, 
          phone: t.partyPhone || '', 
          cashIn: 0, 
          cashOut: 0, 
          openingBalance: 0, // Positive = We have to Get (from customer), Negative = We have to Give (to customer)
          lastActivity: t.date 
        };
      }
      
      // Update phone if missing
      if (!partyMap[key].phone && t.partyPhone) {
        partyMap[key].phone = t.partyPhone;
      }
      
      // Update last activity if newer
      if (new Date(t.date) > new Date(partyMap[key].lastActivity)) {
        partyMap[key].lastActivity = t.date;
      }

      const amt = parseFloat(t.amount) || 0;
      if (t.category === 'Opening Balance') {
        if (t.type === 'Income') { // 'To Get'
          partyMap[key].openingBalance += amt;
        } else { // 'To Give'
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
      // netBalance: Opening Balance (what they owe initially) - Amount they paid us + Amount we paid them
      netBalance: p.openingBalance - p.cashIn + p.cashOut
    })).sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    setParties(partyArray);
  };

  const filteredParties = parties.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.phone.includes(searchTerm)
  );

  const totalCashIn = filteredParties.reduce((sum, p) => sum + p.cashIn, 0);
  const totalCashOut = filteredParties.reduce((sum, p) => sum + p.cashOut, 0);

  const handleSubmitPending = async (e) => {
    e.preventDefault();
    if (!pbName.trim() || !pbAmount || isNaN(pbAmount)) return;
    setIsSubmitting(true);
    try {
      const currentUser = user || { Username: 'Boss', Role: 'Admin' };
      const newTx = {
        id: generateTxId(), // H1 FIX: collision-safe ID
        date: new Date().toISOString().split('T')[0],
        type: pbType === 'To Get' ? 'Income' : 'Expense',
        category: 'Opening Balance',
        partyName: pbName.trim(),
        partyPhone: pbPhone.trim(),
        amount: parseFloat(pbAmount),
        paymentMode: 'Cash',
        upiApp: '',
        reference: '',
        remarks: 'Initial Pending Balance',
        user: currentUser.Username,
        imageFile: null,
        imageFilename: '',
        bossNotes: '',
        recurring: 'none',
        bookId: activeBookId
      };
      
      await addTransaction(newTx);
      if (navigator.onLine) {
        await syncOfflineTransactions();
      }
      setShowModal(false);
      setPbName('');
      setPbPhone('');
      setPbAmount('');
      setPbType('To Get');
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
          <p style={{ fontSize: '0.875rem', margin: 0 }}>Party-wise running balances</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px', fontSize: '0.875rem' }}>
          <Plus size={16} /> Set Balance
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div className="card glass" style={{ borderBottom: '4px solid var(--success)' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ArrowUpRight size={16} className="text-success" /> Total Received
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--success)' }}>₹{totalCashIn.toFixed(2)}</div>
        </div>
        <div className="card glass" style={{ borderBottom: '4px solid var(--danger)' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ArrowDownRight size={16} className="text-danger" /> Total Paid
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--danger)' }}>₹{totalCashOut.toFixed(2)}</div>
        </div>
      </div>

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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filteredParties.length === 0 ? (
          <div className="card glass text-center text-secondary">
            No parties found.
          </div>
        ) : (
          filteredParties.map(p => (
            <div key={p.name} className="card glass" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem' }}>{p.name}</h3>
                {p.phone && <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{p.phone}</p>}
                <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Last entry: {p.lastActivity}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: p.netBalance >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {p.netBalance >= 0 ? 'Pending (To Get)' : 'Pending (To Give)'}: ₹{Math.abs(p.netBalance).toFixed(2)}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  <span className="text-success">Received: ₹{p.cashIn.toFixed(2)}</span> | <span className="text-danger">Given: ₹{p.cashOut.toFixed(2)}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="modal-overlay animate-fade-in" style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex',
          justifyContent: 'center', alignItems: 'center', padding: '16px'
        }}>
          <div className="card glass" style={{ width: '100%', maxWidth: '400px', padding: '20px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>Set Pending Balance</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)' }}>
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSubmitPending} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group" style={{ margin: 0 }}>
                <label>Customer / Party Name</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    value={pbName} 
                    onChange={(e) => {
                      setPbName(e.target.value);
                      const match = parties.find(p => p.name.toLowerCase() === e.target.value.toLowerCase());
                      if (match && match.phone) setPbPhone(match.phone);
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

              <div className="input-group" style={{ margin: 0 }}>
                <label>Phone Number (Optional)</label>
                <input 
                  type="tel" 
                  value={pbPhone} 
                  onChange={(e) => setPbPhone(e.target.value)} 
                  placeholder="Enter phone" 
                />
              </div>

              <div className="input-group" style={{ margin: 0 }}>
                <label>Balance Type</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" className={`btn ${pbType === 'To Get' ? 'btn-success' : 'btn-outline'}`} onClick={() => setPbType('To Get')} style={{ flex: 1, padding: '8px', fontSize: '0.9rem' }}>
                    I have to Get
                  </button>
                  <button type="button" className={`btn ${pbType === 'To Give' ? 'btn-danger' : 'btn-outline'}`} onClick={() => setPbType('To Give')} style={{ flex: 1, padding: '8px', fontSize: '0.9rem' }}>
                    I have to Give
                  </button>
                </div>
              </div>

              <div className="input-group" style={{ margin: 0 }}>
                <label>Pending Amount (₹)</label>
                <input 
                  type="number" 
                  value={pbAmount} 
                  onChange={(e) => setPbAmount(e.target.value)} 
                  placeholder="0.00" 
                  required 
                  min="0.01"
                  step="0.01"
                />
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px', marginTop: '8px' }} disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save Balance'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
