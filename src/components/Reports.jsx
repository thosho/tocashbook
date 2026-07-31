import { useState, useEffect, useMemo } from 'react';
import { getTransactions, getSettings, getCategories, getUsers, getBooks } from '../services/localDb';
import { FileText, Download, FileType, Filter, Edit3, Info, X, Image, MessageCircle, Share2, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ImageViewer from './ImageViewer';
import { useAppContext } from '../context/AppContext';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { 
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, 
  LineElement, BarElement, Title, Tooltip, Legend, ArcElement 
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend);

export default function Reports() {
  const navigate = useNavigate();
  const { activeBookId } = useAppContext();
  const [allTransactions, setAllTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [books, setBooks] = useState([]);
  const [uniqueParties, setUniqueParties] = useState([]);
  const [settings, setLocalSettings] = useState({ BrandName: 'My Business', Address: '', Phone: '' });
  const [viewImageSrc, setViewImageSrc] = useState(null);
  
  // History Modal State
  const [selectedHistory, setSelectedHistory] = useState(null);

  // Filters
  const [dateFilter, setDateFilter] = useState('daily');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [partyFilter, setPartyFilter] = useState('all');
  const [staffFilter, setStaffFilter] = useState('all');
  const [bookFilter, setBookFilter] = useState('all'); // BUG-R1 FIX: always default all, not active book
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [upiAppFilter, setUpiAppFilter] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Analytics State
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [chartMode, setChartMode] = useState('Expense');

  useEffect(() => {
    // BUG-M6 FIX: Auto-sync on load so reports always have latest data
    const autoSync = async () => {
      try {
        const { fetchAllData } = await import('../services/sheetsApi');
        await fetchAllData();
      } catch (_) { /* silent fail */ }
      await loadData();
    };
    autoSync();
  }, []);

  // NOTE: bookFilter intentionally NOT synced from activeBookId.
  // Reports always starts with 'All Cashbooks' so boss sees complete data.
  // Boss can manually filter by cashbook using the dropdown if needed.

  const loadData = async () => {
    const allTrans = await getTransactions();
    setAllTransactions(allTrans);
    setCategories(await getCategories());
    setLocalSettings(await getSettings());
    setUsers(await getUsers());
    setBooks(await getBooks());
  };

  // BUG-R2 FIX: uniqueParties derived from book-filtered transactions (useMemo below)
  const transactions = useMemo(() => {
    if (bookFilter === 'all') return allTransactions;
    return allTransactions.filter(t => String(t.bookId) === String(bookFilter));
  }, [allTransactions, bookFilter]);

  // BUG-R2 FIX: parties derived from book-filtered transactions
  useEffect(() => {
    const parties = new Set();
    transactions.forEach(t => { if (t.partyName) parties.add(t.partyName); });
    setUniqueParties(Array.from(parties).sort());
  }, [transactions]);

  const getStaffName = (username) => {
    if (!username) return '—';
    if (username.toLowerCase() === 'boss') return '👑 Boss';
    // BUG-C3 FIX: Use Name field first, fall back to Username or raw value
    const user = users.find(u =>
      u.Name?.toLowerCase() === username.toLowerCase() ||
      u.Username?.toLowerCase() === username.toLowerCase() ||
      u.Phone?.toLowerCase() === username.toLowerCase()
    );
    return user ? (user.Name || user.Username || username) : username;
  };

  // WhatsApp pre-fill: sends payment reminder for a transaction
  const handleWhatsApp = (t) => {
    const phone = (t.partyPhone || '').replace(/\D/g, ''); // digits only
    const amount = `₹${t.amount}`;
    const type = t.type === 'Income' ? 'received' : 'paid';
    const date = t.date;
    const category = t.category;
    const brand = settings.BrandName || 'Us';
    let msgText = `Hello${t.partyName ? ' ' + t.partyName : ''},\n\n` +
      `This is a reminder regarding the ${amount} ${type} on ${date} (${category}) from ${brand}.\n\n`;
      
    if (settings.UpiId) {
      msgText += `You can pay us directly via UPI link below:\n` +
                 `upi://pay?pa=${settings.UpiId}&pn=${encodeURIComponent(brand)}&cu=INR\n\n`;
    }
    
    msgText += `Please contact us if you have any questions.\n\nThank you! 🙏`;
    
    const msg = encodeURIComponent(msgText);
    let url = phone
      ? `https://wa.me/${phone}?text=${msg}`
      : `https://wa.me/?text=${msg}`;
    if (Capacitor.isNativePlatform() && phone) {
      url = `whatsapp://send?phone=${phone}&text=${msg}`;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const dateObj = new Date(dateStr);
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const y = dateObj.getFullYear();
    const shortY = String(y).slice(-2);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mon = months[dateObj.getMonth()];

    if (settings.DateFormat === 'DD/MM/YYYY') return `${d}/${m}/${y}`;
    if (settings.DateFormat === 'DD MMM YY') return `${d} ${mon} ${shortY}`;
    return `${m}/${d}/${y}`; // Default MM/DD/YYYY
  };

  const filteredTransactions = useMemo(() => {
    const now = new Date();
    return transactions.filter(t => {
      // Date Filter
      const txDate = new Date(t.date + 'T00:00:00'); // force local timezone parse
      let dateMatch = true;
      if (dateFilter === 'daily') {
        dateMatch = txDate.toDateString() === now.toDateString();
      } else if (dateFilter === 'weekly') {
        const startOfWeek = new Date(now);
        const day = now.getDay();
        startOfWeek.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
        startOfWeek.setHours(0, 0, 0, 0);
        dateMatch = txDate >= startOfWeek && txDate <= now;
      } else if (dateFilter === 'monthly') {
        dateMatch = txDate.getMonth() === now.getMonth() && txDate.getFullYear() === now.getFullYear();
      } else if (dateFilter === 'yearly') {
        dateMatch = txDate.getFullYear() === now.getFullYear();
      } else if (dateFilter === 'custom') {
        // BUG-R4 FIX: if dates not set, show nothing rather than everything
        if (!customFrom || !customTo) return false;
        dateMatch = t.date >= customFrom && t.date <= customTo;
      }
      // dateFilter === 'all': dateMatch stays true = show all

      // Category Filter
      let catMatch = true;
      if (categoryFilter !== 'all') {
        catMatch = t.category === categoryFilter;
      }

      // Party Filter
      let partyMatch = true;
      if (partyFilter !== 'all') {
        partyMatch = t.partyName === partyFilter;
      }

      // Staff Filter
      let staffMatch = true;
      if (staffFilter !== 'all') {
        staffMatch = (t.user || '') === staffFilter;
      }

      // Payment Mode Filter
      let paymentMatch = true;
      if (paymentFilter !== 'all') {
        paymentMatch = (t.paymentMode || 'Cash') === paymentFilter;
      }

      // UPI App Filter
      let upiAppMatch = true;
      if (paymentFilter === 'UPI' && upiAppFilter !== 'all') {
        upiAppMatch = (t.upiApp || '') === upiAppFilter;
      }

      return dateMatch && catMatch && partyMatch && staffMatch && paymentMatch && upiAppMatch;
    });
  }, [transactions, dateFilter, categoryFilter, partyFilter, staffFilter, paymentFilter, upiAppFilter, customFrom, customTo]);

  const totalIncome = filteredTransactions.filter(t => t.type === 'Income').reduce((a, b) => a + (b.amount || 0), 0);
  const totalExpense = filteredTransactions.filter(t => t.type === 'Expense').reduce((a, b) => a + (b.amount || 0), 0);

  // Staff-wise summary for filtered transactions
  const staffSummary = {};
  filteredTransactions.forEach(t => {
    const name = t.user || 'Unknown';
    if (!staffSummary[name]) staffSummary[name] = { income: 0, expense: 0, count: 0 };
    if (t.type === 'Income') staffSummary[name].income += (t.amount || 0);
    else staffSummary[name].expense += (t.amount || 0);
    staffSummary[name].count++;
  });

  // BUG-R3 FIX: uniqueStaff from book-filtered transactions
  const uniqueStaff = Array.from(new Set(transactions.map(t => t.user).filter(Boolean)));

  // Doughnut Chart Data (by Category) based on FILTERED transactions
  const chartCategoryTotals = {};
  filteredTransactions.filter(t => t.type === chartMode).forEach(t => {
    chartCategoryTotals[t.category] = (chartCategoryTotals[t.category] || 0) + (t.amount || 0);
  });

  const doughnutData = {
    labels: Object.keys(chartCategoryTotals),
    datasets: [{
      data: Object.values(chartCategoryTotals),
      backgroundColor: chartMode === 'Income' 
        ? ['#22c55e', '#16a34a', '#15803d', '#14532d', '#4ade80', '#86efac']
        : ['#ef4444', '#f97316', '#eab308', '#f87171', '#3b82f6', '#8b5cf6'],
      borderWidth: 0,
    }]
  };

  // Monthly Bar Chart based on FILTERED transactions
  const monthlyData = {};
  filteredTransactions.forEach(t => {
    if (!t.date) return;
    const d = new Date(t.date + 'T00:00:00'); // force local parse
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // sortable key
    const label = d.toLocaleString('default', { month: 'short', year: '2-digit' }); // display label
    if (!monthlyData[key]) monthlyData[key] = { label, income: 0, expense: 0 };
    if (t.type === 'Income') monthlyData[key].income += (t.amount || 0);
    else monthlyData[key].expense += (t.amount || 0);
  });

  const sortedKeys = Object.keys(monthlyData).sort();
  const barLabels = sortedKeys.map(k => monthlyData[k].label);
  const barData = {
    labels: barLabels,
    datasets: [
      {
        label: 'Income',
        data: sortedKeys.map(k => monthlyData[k].income),
        backgroundColor: '#22c55e',
      },
      {
        label: 'Expense',
        data: sortedKeys.map(k => monthlyData[k].expense),
        backgroundColor: '#ef4444',
      }
    ]
  };

  const exportCSV = () => {
    let csv = "Date,Type,Category,Party Name,Payment Mode,Collected By,Reference,Amount,Remarks\n";
    filteredTransactions.forEach(t => {
      csv += `${formatDate(t.date)},${t.type},${t.category},${t.partyName || ''},${t.paymentMode || 'Cash'},${getStaffName(t.user)},${t.reference || ''},${t.amount},"${t.remarks || ''}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `tocashbook_${dateFilter}_report.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportPDF = async () => {
    try {
      const doc = new jsPDF();
      
      let headerBgHeight = 44; // base height for logo, brand name, title, filters
      if (settings.Tagline) headerBgHeight += 6;
      if (settings.Address || settings.Phone) headerBgHeight += 6;

      // Letterhead Header Background
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFillColor(248, 249, 250); // Light grey background
      doc.rect(0, 0, pageWidth, headerBgHeight, 'F'); // Fill header background

      let currentY = 12;

      // Logo
      if (settings.Logo) {
        try {
          doc.addImage(settings.Logo, 'JPEG', 14, currentY, 20, 20);
        } catch(e) {
          try { doc.addImage(settings.Logo, 'PNG', 14, currentY, 20, 20); } catch(err) {}
        }
      }

      // Brand Name
      doc.setFontSize(22);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42); // Very dark slate
      doc.text(settings.BrandName || 'My Business', pageWidth / 2, currentY + 6, { align: 'center' });
      
      // Tagline
      let detailsY = currentY + 14;
      if (settings.Tagline) {
        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(71, 85, 105);
        doc.text(settings.Tagline, pageWidth / 2, detailsY, { align: 'center' });
        detailsY += 6;
      }

      // Address & Phone
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 100, 100);
      if (settings.Address || settings.Phone) {
        let contactDetails = [];
        if (settings.Address) contactDetails.push(settings.Address);
        if (settings.Phone) contactDetails.push(`Phone: ${settings.Phone}`);
        doc.text(contactDetails.join(' | '), pageWidth / 2, detailsY, { align: 'center' });
        detailsY += 6;
      }
      
      currentY = detailsY + 6;

      // Title
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(33, 37, 41);
      doc.text("Cashbook Report", pageWidth / 2, currentY, { align: 'center' });
      currentY += 6;
      
      // Dynamic Date Formatting
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      
      const now = new Date();
      let titleStr = '';
      if (dateFilter === 'daily') {
        titleStr = formatDate(now.toISOString().split('T')[0]); 
      } else if (dateFilter === 'weekly') {
        const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        titleStr = `${formatDate(lastWeek.toISOString().split('T')[0])} to ${formatDate(now.toISOString().split('T')[0])}`;
      } else if (dateFilter === 'monthly') {
        titleStr = now.toLocaleString('default', { month: 'long', year: 'numeric' });
      } else if (dateFilter === 'yearly') {
        titleStr = now.getFullYear().toString();
      } else if (dateFilter === 'custom' && customFrom && customTo) {
        // BUG-R7 FIX: show actual custom date range in PDF
        titleStr = `${formatDate(customFrom)} to ${formatDate(customTo)}`;
      } else {
        titleStr = 'All Time';
      }

      let filterStr = `Duration: ${titleStr}`;
      if (categoryFilter !== 'all') filterStr += ` | Category: ${categoryFilter}`;
      if (partyFilter !== 'all') filterStr += ` | Customer: ${partyFilter}`;
      doc.text(filterStr, pageWidth / 2, currentY, { align: 'center' });
      
      currentY = headerBgHeight + 2; // Exact spacing to line separator based on background height

      // Horizontal Line Separator
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.line(14, currentY, pageWidth - 14, currentY);
      currentY += 6;


      // Summary boxes
      doc.setDrawColor(220, 220, 220);
      doc.setFillColor(250, 250, 250);
      doc.rect(14, currentY, 182, 20, 'F');
      doc.rect(14, currentY, 182, 20, 'S');

      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text("Total Cash in", 20, currentY + 7);
      doc.text("Total Cash out", 80, currentY + 7);
      doc.setTextColor(0, 102, 204); // Blue
      doc.text("Final Balance", 140, currentY + 7);

      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0, 100, 0); // Dark Green
      doc.text(`+ Rs. ${totalIncome.toLocaleString()}`, 20, currentY + 15);
      
      doc.setTextColor(139, 0, 0); // Dark Red
      doc.text(`- Rs. ${totalExpense.toLocaleString()}`, 80, currentY + 15);
      
      doc.setTextColor(0, 102, 204); // Blue
      doc.text(`Rs. ${(totalIncome - totalExpense).toLocaleString()}`, 140, currentY + 15);

      currentY += 28;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Total No. of entries: ${filteredTransactions.length}`, 14, currentY);

      // Table Data preparation
      // BUG-R5 & G1 FIX: Start running balance from Opening Balance only for Main Book / All
      let runningBalance = (bookFilter === 'all' || bookFilter === 'book_main') ? (parseFloat(settings?.OpeningBalance) || 0) : 0;
      const sortedTx = [...filteredTransactions].sort((a,b) => {
        const diff = new Date(a.date) - new Date(b.date);
        if (diff !== 0) return diff;
        return String(a.id).localeCompare(String(b.id)); // G2 tie-breaker
      });

      const tableData = sortedTx.map(t => {
        if (t.type === 'Income') runningBalance += t.amount;
        else runningBalance -= t.amount;

        return [
          formatDate(t.date),
          t.remarks || t.category,
          t.partyName || '',
          t.paymentMode || 'Cash',
          getStaffName(t.user), // Collected By
          t.type === 'Income' ? t.amount.toLocaleString() : '', // Cash in
          t.type === 'Expense' ? t.amount.toLocaleString() : '', // Cash out
          runningBalance.toLocaleString() // Balance
        ];
      });

      autoTable(doc, {
        startY: currentY + 5,
        head: [['Date', 'Remark', 'Party', 'Mode', 'Collected By', 'Cash in', 'Cash out', 'Balance']],
        body: tableData,
        theme: 'grid',
        headStyles: {
          fillColor: [245, 245, 245],
          textColor: [50, 50, 50],
          fontStyle: 'bold'
        },
        styles: {
          fontSize: 8,
          cellPadding: 3,
          textColor: [50, 50, 50]
        },
        didParseCell: function (data) {
          if (data.section === 'body') {
            if (data.column.index === 5 && data.cell.raw !== '') {
              data.cell.styles.textColor = [0, 100, 0]; // Dark green
              data.cell.styles.halign = 'right';
            }
            if (data.column.index === 6 && data.cell.raw !== '') {
              data.cell.styles.textColor = [139, 0, 0]; // Dark red
              data.cell.styles.halign = 'right';
            }
            if (data.column.index === 7) {
              data.cell.styles.textColor = [0, 102, 204]; // Blue
              data.cell.styles.halign = 'right';
            }
          }
        },
        margin: { top: 10, left: 14, right: 14, bottom: 20 },
      });

      // Footer
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        let footerY = doc.internal.pageSize.getHeight() - 16;
        
        doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.getWidth() - 20, footerY + 8, { align: 'right' });
        
        // Link to Thosho Tech
        doc.setTextColor(150, 150, 150);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("ToCashBook", 14, footerY);
        
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.text("Developed by", 14, footerY + 4);
        
        doc.setTextColor(59, 130, 246);
        doc.setFont("helvetica", "bold");
        const linkText = "Thosho Tech";
        doc.text(linkText, 14, footerY + 8);
        const linkWidth = doc.getTextWidth(linkText);
        doc.link(14, footerY + 5, linkWidth, 5, { url: 'https://thoshotech.com' });
      }

      const pdfFilename = `tocashbook_${dateFilter}_report.pdf`;
      if (Capacitor.isNativePlatform()) {
        try {
          const pdfBase64 = doc.output('datauristring').split(',')[1];
          const result = await Filesystem.writeFile({
            path: pdfFilename,
            data: pdfBase64,
            directory: Directory.Cache
          });
          await Share.share({
            title: 'Cashbook Report',
            text: 'Here is the cashbook report.',
            url: result.uri,
            dialogTitle: 'Share Report'
          });
        } catch (err) {
          console.error("Native Share Error:", err);
          alert("Failed to share PDF: " + err.message);
        }
      } else {
        doc.save(pdfFilename);
      }
    } catch (e) {
      console.error("PDF Export Error:", e);
      alert("Failed to export PDF. Check console for details.");
    }
  };

  return (
    <div className="container animate-fade-in pb-20">
      <div className="header glass" style={{ padding: '16px 20px', borderRadius: '16px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <FileText size={24} className="text-primary" />
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Reports</h2>
        </div>
      </div>

      <div className="card glass mb-4">
        <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Filter size={18} /> Filters
        </h3>
        
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {['daily','weekly','monthly','yearly','all','custom'].map(f => (
            <button key={f} className={`btn ${dateFilter === f ? 'btn-primary' : 'btn-outline'}`}
              style={{ flex: '1 0 auto', minWidth: '60px', padding: '8px 10px', fontSize: '0.8rem' }}
              onClick={() => setDateFilter(f)}>
              {f === 'daily' ? 'Today' : f === 'weekly' ? 'This Week' : f === 'monthly' ? 'Month' : f === 'yearly' ? 'Year' : f === 'all' ? 'All Time' : '📅 Custom'}
            </button>
          ))}
        </div>

        {/* Custom Date Range pickers */}
        {dateFilter === 'custom' && (
          <div className="animate-fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px', padding: '12px', background: 'var(--bg-color)', borderRadius: '10px' }}>
            <div className="input-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.78rem' }}>From Date</label>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ padding: '8px', fontSize: '0.875rem' }} />
            </div>
            <div className="input-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.78rem' }}>To Date</label>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ padding: '8px', fontSize: '0.875rem' }} />
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div className="input-group">
            <label>Filter by Customer</label>
            <select value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)}>
              <option value="all">All Customers</option>
              {uniqueParties.map((p, i) => <option key={i} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label>Filter by Category</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All Categories</option>
              {Array.from(new Set([...categories.map(c => c.Name), ...transactions.map(t => t.category)])).filter(Boolean).map((c, i) => (
                <option key={i} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label>Filter by Staff</label>
            <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
              <option value="all">All Staff</option>
              {/* BUG-R3 FIX: show display name in dropdown */}
              {uniqueStaff.map((s, i) => <option key={i} value={s}>{getStaffName(s)}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label>Filter by Cashbook</label>
            <select value={bookFilter} onChange={(e) => setBookFilter(e.target.value)}>
              <option value="all">All Cashbooks</option>
              {books.map(b => <option key={b.ID} value={b.ID}>{b.Name}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label>Filter by Payment</label>
            <select value={paymentFilter} onChange={(e) => {
              setPaymentFilter(e.target.value);
              if (e.target.value !== 'UPI') setUpiAppFilter('all');
            }}>
              <option value="all">All Modes</option>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Card">Card</option>
              <option value="Bank Transfer">Bank Transfer</option>
            </select>
          </div>
          {paymentFilter === 'UPI' && (
            <div className="input-group">
              <label>Filter by UPI App</label>
              <select value={upiAppFilter} onChange={(e) => setUpiAppFilter(e.target.value)}>
                <option value="all">All Apps</option>
                <option value="GPay">GPay</option>
                <option value="PhonePe">PhonePe</option>
                <option value="Paytm">Paytm</option>
                <option value="WhatsApp">WhatsApp</option>
                <option value="Amazon Pay">Amazon Pay</option>
                <option value="Other">Other</option>
              </select>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px', backgroundColor: 'var(--bg-color)', borderRadius: '12px', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Filtered Income</div>
            <div className="text-success" style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>₹{totalIncome.toFixed(2)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Filtered Expense</div>
            <div className="text-danger" style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>₹{totalExpense.toFixed(2)}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-primary w-full justify-center" onClick={exportPDF}>
            <Share2 size={18} /> {Capacitor.isNativePlatform() ? 'Share PDF' : 'Export PDF'}
          </button>
          <button className="btn btn-outline w-full justify-center" onClick={exportCSV}>
            <Download size={18} /> Export CSV
          </button>
        </div>
      </div>

      {/* Staff-wise Breakdown Card */}
      {Object.keys(staffSummary).length > 0 && (
        <div className="card glass mb-4">
          <h3 style={{ marginBottom: '12px' }}>Staff-wise Breakdown</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Staff</th>
                  <th style={{ padding: '8px', textAlign: 'right', color: 'var(--success)' }}>Cash In</th>
                  <th style={{ padding: '8px', textAlign: 'right', color: 'var(--danger)' }}>Cash Out</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Entries</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(staffSummary)
                  .sort((a, b) => (b[1].income + b[1].expense) - (a[1].income + a[1].expense))
                  .map(([name, data]) => (
                    <tr key={name} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '8px', fontWeight: '600' }}>{getStaffName(name)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: 'var(--success)', fontWeight: '600' }}>₹{data.income.toLocaleString()}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: 'var(--danger)', fontWeight: '600' }}>₹{data.expense.toLocaleString()}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{data.count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Analytics Toggle Button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        <button 
          className={`btn ${showAnalytics ? 'btn-primary' : 'btn-outline'}`} 
          onClick={() => setShowAnalytics(!showAnalytics)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <BarChart3 size={18} /> {showAnalytics ? 'Hide Analytics' : 'Show Analytics'}
        </button>
      </div>

      {/* Analytics Section */}
      {showAnalytics && (
        <div className="card glass animate-fade-in" style={{ marginBottom: '24px' }}>
          <h3 style={{ marginBottom: '20px' }}>Advanced Analytics</h3>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h4 style={{ margin: 0, fontSize: '1rem' }}>Category Breakdown</h4>
                <div style={{ display: 'flex', background: 'var(--bg-color)', borderRadius: '8px', padding: '4px' }}>
                  <button 
                    onClick={() => setChartMode('Income')}
                    style={{
                      padding: '4px 12px', fontSize: '0.75rem', border: 'none', borderRadius: '4px', cursor: 'pointer',
                      background: chartMode === 'Income' ? 'var(--success)' : 'transparent',
                      color: chartMode === 'Income' ? 'white' : 'var(--text-secondary)'
                    }}>Income</button>
                  <button 
                    onClick={() => setChartMode('Expense')}
                    style={{
                      padding: '4px 12px', fontSize: '0.75rem', border: 'none', borderRadius: '4px', cursor: 'pointer',
                      background: chartMode === 'Expense' ? 'var(--danger)' : 'transparent',
                      color: chartMode === 'Expense' ? 'white' : 'var(--text-secondary)'
                    }}>Expense</button>
                </div>
              </div>
              {Object.keys(chartCategoryTotals).length > 0 ? (
                <div style={{ height: '250px', display: 'flex', justifyContent: 'center' }}>
                    <Doughnut data={doughnutData} options={{ maintainAspectRatio: false }} />
                </div>
              ) : (
                <p className="text-secondary text-center">No {chartMode.toLowerCase()}s recorded.</p>
              )}
            </div>
            
            <div>
              <h4 style={{ margin: 0, marginBottom: '16px', fontSize: '1rem' }}>Monthly Trend</h4>
              {barLabels.length > 0 ? (
                <div style={{ height: '250px' }}>
                  <Bar 
                    data={barData} 
                    options={{
                      maintainAspectRatio: false,
                      responsive: true,
                      scales: { y: { beginAtZero: true } }
                    }} 
                  />
                </div>
              ) : (
                <p className="text-secondary text-center">Not enough data to generate charts.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card glass">
        <h3 style={{ marginBottom: '16px' }}>Transaction List</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredTransactions.length === 0 ? (
            <p className="text-center text-secondary">No entries found for this period.</p>
          ) : (
            filteredTransactions.map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.partyName || t.category}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    {t.date} · {t.paymentMode || 'Cash'} {t.reference && `· Ref: ${t.reference}`}
                    <br />Collected By: <span style={{ fontWeight: 'bold' }}>{getStaffName(t.user)}</span>
                    {t.bossNotes && <span style={{ color: 'var(--primary)', fontStyle: 'italic' }}> · 📝 {t.bossNotes}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginLeft: '10px' }}>
                  <div style={{ fontWeight: 'bold', color: t.type === 'Income' ? 'var(--success)' : 'var(--danger)', textAlign: 'right', fontSize: '0.9rem', minWidth: '60px' }}>
                    {t.type === 'Income' ? '+' : '-'} ₹{t.amount}
                  </div>
                  {/* Receipt image */}
                  {t.imageUrl && (
                    <button onClick={() => setViewImageSrc(t.imageUrl)} title="View Receipt"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', padding: '4px', minWidth: '28px', minHeight: '28px' }}>
                      <Image size={15} />
                    </button>
                  )}
                  {/* WhatsApp reminder */}
                  {(t.partyName || t.partyPhone) && (
                    <button onClick={() => handleWhatsApp(t)} title="Send WhatsApp Reminder"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#25D366', padding: '4px', minWidth: '28px', minHeight: '28px' }}>
                      <MessageCircle size={15} />
                    </button>
                  )}
                  <button onClick={() => navigate('/entry', { state: { editTransaction: t } })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', padding: '4px', minWidth: '28px', minHeight: '28px' }} title="Edit">
                    <Edit3 size={15} />
                  </button>
                  {t.editHistory && t.editHistory.length > 0 && (
                    <button onClick={() => setSelectedHistory(t.editHistory)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px', minWidth: '28px', minHeight: '28px' }} title="View Edit History">
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
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
          <div className="card glass animate-fade-in" style={{ width: '90%', maxWidth: '400px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>Edit History</h3>
              <button onClick={() => setSelectedHistory(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            
            <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {selectedHistory.map((h, idx) => (
                <div key={idx} style={{ padding: '12px', background: 'var(--bg-color)', borderRadius: '8px', fontSize: '0.875rem' }}>
                  <div><strong className="text-primary">Edited By:</strong> {getStaffName(h.editedBy)}</div>
                  <div style={{ color: 'var(--text-secondary)' }}>{new Date(h.dateEdited).toLocaleString()}</div>
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

      {/* Image Viewer */}
      {viewImageSrc && (
        <ImageViewer src={viewImageSrc} alt="Receipt" onClose={() => setViewImageSrc(null)} />
      )}
    </div>
  );
}
