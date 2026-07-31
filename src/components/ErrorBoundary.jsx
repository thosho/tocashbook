import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showLogs: false,
      logs: []
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    
    // Create detailed error log
    const errObj = {
      timestamp: new Date().toLocaleString(),
      message: error ? error.toString() : 'Unknown Error',
      stack: error && error.stack ? error.stack : 'No stack trace available',
      componentStack: errorInfo && errorInfo.componentStack ? errorInfo.componentStack : ''
    };

    console.error("ErrorBoundary caught an error:", errObj);

    try {
      const existingLogs = JSON.parse(localStorage.getItem('opencashbook_error_logs') || '[]');
      existingLogs.unshift(errObj);
      // keep latest 20 logs
      const trimmedLogs = existingLogs.slice(0, 20);
      localStorage.setItem('opencashbook_error_logs', JSON.stringify(trimmedLogs));
      this.setState({ logs: trimmedLogs });
    } catch (e) {
      console.error("Could not write error log to storage", e);
    }
  }

  componentDidMount() {
    try {
      const existingLogs = JSON.parse(localStorage.getItem('opencashbook_error_logs') || '[]');
      this.setState({ logs: existingLogs });
    } catch (_) {}
  }

  handleCopyLog = () => {
    const { error, errorInfo } = this.state;
    const text = `🚨 Open Cashbook Crash Log\nTime: ${new Date().toLocaleString()}\nError: ${error ? error.toString() : ''}\n\nStack:\n${error && error.stack ? error.stack : ''}\n\nComponent Stack:\n${errorInfo && errorInfo.componentStack ? errorInfo.componentStack : ''}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        alert("✅ Error log copied to clipboard! Please paste this in our discussion or support.");
      });
    } else {
      alert("Clipboard API not available in this WebView. Please take a screenshot of the errors below.");
    }
  };

  handleClearLogs = () => {
    localStorage.removeItem('opencashbook_error_logs');
    this.setState({ logs: [], showLogs: false });
    alert("Error logs cleared.");
  };

  handleResetStorage = async () => {
    if (window.confirm("⚠️ This will clear local cache and reload the app safely. Your cloud transactions in Google Sheets remain intact. Proceed?")) {
      try {
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = "/";
      } catch (e) {
        window.location.reload();
      }
    }
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo, showLogs, logs } = this.state;
      return (
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#0f172a',
          color: '#f8fafc',
          padding: '24px 16px',
          fontFamily: "'Outfit', -apple-system, sans-serif",
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '520px',
            backgroundColor: 'rgba(30, 41, 59, 0.95)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '16px',
            padding: '24px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '28px' }}>⚠️</span>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: '#ef4444' }}>App Encountered an Issue</h2>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>Crash Guardian intercepted a runtime error</div>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: '0.9rem', color: '#cbd5e1', lineHeight: 1.5 }}>
              Instead of showing a blank screen, our diagnostic tool caught this problem. Please copy the log below to identify the exact cause.
            </p>

            {/* Current Error Diagnostic Box */}
            <div style={{
              backgroundColor: '#020617',
              border: '1px solid #334155',
              borderRadius: '10px',
              padding: '12px',
              maxHeight: '180px',
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              color: '#fca5a5',
              lineHeight: 1.4,
              wordBreak: 'break-all'
            }}>
              <strong style={{ color: '#ef4444', display: 'block', marginBottom: '6px' }}>
                {error ? error.toString() : 'Unknown JavaScript Exception'}
              </strong>
              {error && error.stack ? error.stack : (errorInfo && errorInfo.componentStack ? errorInfo.componentStack : 'No trace details present.')}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button onClick={this.handleCopyLog} style={{
                padding: '12px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: '#3b82f6',
                color: 'white',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}>
                📋 Copy Error Log
              </button>

              <button onClick={() => window.location.reload()} style={{
                padding: '12px',
                borderRadius: '10px',
                border: '1px solid #475569',
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                fontWeight: '600',
                cursor: 'pointer',
                fontSize: '0.85rem'
              }}>
                🔄 Reload App
              </button>
            </div>

            {/* Support Share Section */}
            <div style={{
              marginTop: '8px',
              padding: '14px',
              backgroundColor: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <div style={{ fontSize: '0.85rem', fontWeight: '700', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>💬 Report Bug to @Thosho Tech</span>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 'normal' }}>Fast support</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#cbd5e1', lineHeight: '1.4' }}>
                Tap below to send this crash log directly to our dev team via your favorite app:
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    this.handleCopyLog();
                    window.open('https://t.me/thosho', '_blank');
                  }}
                  style={{
                    padding: '8px 6px',
                    borderRadius: '8px',
                    border: '1px solid #0288d1',
                    backgroundColor: '#039be5',
                    color: 'white',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    textAlign: 'center'
                  }}
                >
                  ✈️ Telegram<br/><span style={{ fontSize: '0.68rem', opacity: 0.9 }}>@thosho</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const errText = `⚠️ Open Cashbook Bug Log for @thosho:\nTime: ${new Date().toLocaleString()}\nError: ${error ? error.toString() : 'Unknown Exception'}\n\nTrace:\n${error?.stack || errorInfo?.componentStack || 'N/A'}`;
                    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(errText)}`, '_blank');
                  }}
                  style={{
                    padding: '8px 6px',
                    borderRadius: '8px',
                    border: '1px solid #15803d',
                    backgroundColor: '#16a34a',
                    color: 'white',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    textAlign: 'center'
                  }}
                >
                  🟢 WhatsApp<br/><span style={{ fontSize: '0.68rem', opacity: 0.9 }}>@thosho</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const errText = `Hello Thosho Tech Support,\n\nI experienced an issue in Open Cashbook. Here is my bug report log:\n\nTime: ${new Date().toLocaleString()}\nError: ${error ? error.toString() : 'Unknown Exception'}\n\nTrace:\n${error?.stack || errorInfo?.componentStack || 'N/A'}`;
                    window.open(`mailto:contact@thoshotech.com?subject=${encodeURIComponent('Open Cashbook Crash Report')}&body=${encodeURIComponent(errText)}`, '_blank');
                  }}
                  style={{
                    padding: '8px 6px',
                    borderRadius: '8px',
                    border: '1px solid #475569',
                    backgroundColor: '#334155',
                    color: 'white',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    textAlign: 'center'
                  }}
                >
                  ✉️ Email<br/><span style={{ fontSize: '0.65rem', opacity: 0.9 }}>Thoshotech</span>
                </button>
              </div>
            </div>

            <button onClick={() => this.setState({ showLogs: !showLogs })} style={{
              padding: '10px',
              borderRadius: '10px',
              border: 'none',
              backgroundColor: 'transparent',
              color: '#94a3b8',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: '0.8rem',
              marginTop: '4px'
            }}>
              {showLogs ? '▲ Hide History Logs' : `▼ View Error History (${logs.length} stored logs)`}
            </button>

            {/* Error History Section */}
            {showLogs && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                borderTop: '1px solid #334155',
                paddingTop: '12px',
                maxHeight: '220px',
                overflowY: 'auto'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#cbd5e1' }}>Past Crash Logs:</span>
                  {logs.length > 0 && (
                    <button onClick={this.handleClearLogs} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}>
                      Clear History
                    </button>
                  )}
                </div>
                {logs.length === 0 ? (
                  <div style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>No past crash logs recorded.</div>
                ) : (
                  logs.map((item, idx) => (
                    <div key={idx} style={{ padding: '8px', background: '#020617', borderRadius: '6px', borderLeft: '3px solid #ef4444', fontSize: '0.7rem', color: '#cbd5e1', fontFamily: 'monospace' }}>
                      <div style={{ color: '#94a3b8', marginBottom: '2px' }}>⏱ {item.timestamp}</div>
                      <div style={{ color: '#fca5a5', wordBreak: 'break-all', fontWeight: 'bold' }}>{item.message}</div>
                      {item.componentStack && <div style={{ color: '#64748b', marginTop: '4px', fontSize: '0.65rem' }}>{item.componentStack.slice(0, 150)}...</div>}
                    </div>
                  ))
                )}
              </div>
            )}

            <button onClick={this.handleResetStorage} style={{
              padding: '8px',
              border: 'none',
              backgroundColor: 'transparent',
              color: '#ef4444',
              cursor: 'pointer',
              fontSize: '0.75rem',
              opacity: 0.85,
              marginTop: '4px'
            }}>
              🚨 Emergency: Clear Local Storage & Force Safest Start
            </button>

          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
