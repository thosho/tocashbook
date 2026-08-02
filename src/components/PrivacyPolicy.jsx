import { ArrowLeft, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { APP_NAME } from '../services/authUtils';

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="container animate-fade-in pb-20">
      <div className="header glass" style={{ padding: '16px 20px', borderRadius: '16px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button onClick={() => navigate(-1)} className="btn btn-outline" style={{ padding: '8px', border: 'none' }}>
          <ArrowLeft size={20} />
        </button>
        <h2 style={{ fontSize: '1.25rem', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={22} className="text-primary" /> Privacy Policy
        </h2>
      </div>

      <div className="card glass">
        <h3 style={{ marginBottom: '16px', color: 'var(--primary)' }}>Privacy Policy for {APP_NAME}</h3>
        <div style={{ fontSize: '0.9rem', lineHeight: '1.6', color: 'var(--text-primary)' }}>
          <p><strong>Effective Date:</strong> August 1, 2026<br/>
          <strong>Developer / Publisher:</strong> Thosho Tech (thoshotech.com)</p>

          <hr style={{ margin: '20px 0', borderColor: 'var(--border-color)' }} />

          <h4>1. Introduction & Core Privacy Guarantee</h4>
          <p>Welcome to <strong>{APP_NAME}</strong> ("we," "our," "us," or the "App"), developed and published by <strong>Thosho Tech</strong>. We believe that financial accounting tools should empower users without compromising their privacy or data ownership. Our core guiding philosophy is simple:</p>
          <blockquote style={{ borderLeft: '4px solid var(--primary)', paddingLeft: '12px', margin: '16px 0', fontStyle: 'italic', color: 'var(--text-secondary)' }}>
            "Your financial data stays truly yours."
          </blockquote>
          <p>Unlike conventional accounting applications that upload, store, and process your confidential business transactions on centralized third-party servers, <strong>Open Cashbook operates on a user-owned, decentralized data architecture</strong>. We do <strong>not</strong> collect, harvest, analyze, sell, or monetize your financial transactions, ledger accounts, balances, or customer lists.</p>
          <p>This Privacy Policy explains how information is handled when you access or use the Open Cashbook web application, progressive web app (PWA), or native Android application (APK / Google Play distribution).</p>

          <hr style={{ margin: '20px 0', borderColor: 'var(--border-color)' }} />

          <h4>2. Architecture & Data Storage (Google Sheets Integration)</h4>
          <p><strong>A. Your Private Cloud Vault (Google Sheets)</strong></p>
          <p>When you set up Open Cashbook, your transaction records, staff entries, customer ledgers, and opening balances are synchronized directly to a <strong>private Google Spreadsheet owned exclusively by your Google account</strong> via Google Apps Script (<code>Code.gs</code>).</p>
          <ul style={{ paddingLeft: '20px', marginBottom: '16px' }}>
            <li><strong>Zero Vendor Exposure:</strong> Thosho Tech has <strong>no access</strong> to your connected Google Spreadsheet, encryption keys, or historical transaction ledgers. All read and write requests travel securely directly between your device and Google's servers over SSL/TLS encryption.</li>
            <li><strong>Google Terms of Service:</strong> Because your primary data vault resides in Google Sheets, your data's cloud persistence is governed by <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>Google’s Privacy Policy</a> and security standards.</li>
          </ul>

          <p><strong>B. Offline & Local Device Cache (IndexedDB / Local Storage)</strong></p>
          <p>To enable offline accounting and lightning-fast responsiveness, Open Cashbook temporarily caches your active ledger database locally on your device using browser/native device storage.</p>
          <ul style={{ paddingLeft: '20px', marginBottom: '16px' }}>
            <li>This offline cache remains physically on your device and is never transmitted to any third-party servers outside your designated Google Sheet synchronization flow.</li>
            <li>Clearing your browser cache or uninstalling the Android application removes this local storage without deleting the definitive records in your Google Sheet.</li>
          </ul>

          <hr style={{ margin: '20px 0', borderColor: 'var(--border-color)' }} />

          <h4>3. Information We Collect and How It Is Used</h4>
          <p>Because of our decentralized design, Open Cashbook minimizes data collection to only what is required for device-level application utility:</p>

          <p><strong>A. Customer Contacts & Phone Numbers</strong></p>
          <ul style={{ paddingLeft: '20px', marginBottom: '16px' }}>
            <li><strong>Why We Request Access:</strong> Our app includes a <strong>"Pick Contact"</strong> feature allowing you to select phone numbers directly from your address book to create party accounts or send automated WhatsApp payment reminders.</li>
            <li><strong>How It Is Handled:</strong> When you select a contact, the name and phone number are populated solely into your local transaction form and saved within your personal Google Sheet ledger. We <strong>do not</strong> upload, harvest, background-sync, or transmit your contact list to Thosho Tech or any external third parties.</li>
          </ul>

          <p><strong>B. Camera, Images, and File Storage</strong></p>
          <ul style={{ paddingLeft: '20px', marginBottom: '16px' }}>
            <li><strong>Why We Request Access:</strong> You may choose to attach receipt photos to transaction entries, import company logos for digital business cards, or export PDF accounting reports.</li>
            <li><strong>How It Is Handled:</strong> Image files and exported PDFs are processed locally on your device. Receipt photos and backup files remain stored within your designated personal storage or Google architecture.</li>
          </ul>

          <p><strong>C. Authentication PINs & Admin Security</strong></p>
          <ul style={{ paddingLeft: '20px', marginBottom: '16px' }}>
            <li><strong>Why We Request Access:</strong> Open Cashbook utilizes an Admin/Staff PIN authentication system to lock settings, protect ledger modifications, and segregate branch access.</li>
            <li><strong>How It Is Handled:</strong> PIN credentials and branch roles are verified against your local encrypted storage and personal Google Sheet. We do not store or transmit your security passwords or PINs on any external server.</li>
          </ul>

          <hr style={{ margin: '20px 0', borderColor: 'var(--border-color)' }} />

          <h4>4. Device Permissions (Android / Google Play Disclosure)</h4>
          <p>When running Open Cashbook as an Android application, the following system permissions may be requested:</p>
          <ol style={{ paddingLeft: '20px', marginBottom: '16px' }}>
            <li><code>INTERNET</code> & <code>ACCESS_NETWORK_STATE</code>: Required to securely synchronize financial entries between your local cache and your personal Google Spreadsheet.</li>
            <li><code>READ_CONTACTS</code>: Requested <em>only</em> when you tap the "Pick Contact" button to autofill customer ledger details.</li>
            <li><code>CAMERA</code> & <code>READ_EXTERNAL_STORAGE</code> / <code>WRITE_EXTERNAL_STORAGE</code> (or Photo Library): Requested when capturing receipt photographs, selecting business brand logos, or saving generated PDF ledger reports.</li>
            <li><code>POST_NOTIFICATIONS</code>: Requested to deliver daily accounting reminders, backup prompts, or push updates.</li>
          </ol>
          <p>You can modify or revoke these permissions at any time via your Android Device Settings without disabling basic manual bookkeeping features.</p>

          <hr style={{ margin: '20px 0', borderColor: 'var(--border-color)' }} />

          <h4>5. Third-Party Services & Analytics</h4>
          <p>Open Cashbook is engineered to function independently without invasive third-party ad networks or user-tracking analytics modules.</p>
          <ul style={{ paddingLeft: '20px', marginBottom: '16px' }}>
            <li><strong>No Advertisements:</strong> We do not serve targeted advertisements or share your behavioral usage with advertising networks.</li>
            <li><strong>WhatsApp Reminders:</strong> When you trigger a "Send WhatsApp Reminder," Open Cashbook generates a localized URI scheme directing your device's native WhatsApp client to open a pre-filled chat box. We do not intercept or track your private WhatsApp communications.</li>
          </ul>

          <hr style={{ margin: '20px 0', borderColor: 'var(--border-color)' }} />

          <h4>6. Data Retention & Deletion Rights</h4>
          <p>Because <strong>you</strong> retain full administrative custody of your accounting databases and Google Spreadsheets:</p>
          <ul style={{ paddingLeft: '20px', marginBottom: '16px' }}>
            <li><strong>Data Deletion:</strong> You can permanently delete any transaction, customer record, or historical branch ledger directly within the app UI or by editing your underlying Google Sheet.</li>
            <li><strong>Account Terminations / Wipe:</strong> You can revoke Open Cashbook's access or eradicate all operational records instantly by deleting your backend Google Apps Script deployment or clearing the <code>tocashbook_db</code> / local database cache in your app settings. We retain no redundant or archived copies of your financial logs.</li>
          </ul>

          <hr style={{ margin: '20px 0', borderColor: 'var(--border-color)' }} />

          <h4>7. Children’s Privacy</h4>
          <p>Open Cashbook is a professional business and financial bookkeeping application. It is not designed for, marketed to, or intended for use by individuals under the age of 13. We do not knowingly collect personal information from children.</p>

          <hr style={{ margin: '20px 0', borderColor: 'var(--border-color)' }} />

          <h4>8. International Users</h4>
          <p>Regardless of whether you reside in Europe (GDPR), California (CCPA/CPRA), India (DPDP Act), or elsewhere, Open Cashbook adheres to strict principles of privacy-by-design and data minimization:</p>
          <ul style={{ paddingLeft: '20px', marginBottom: '16px' }}>
            <li><strong>Right to Access & Portability:</strong> You have instant access and complete portability of your data at all times via Excel/CSV export from your Google Sheet or database JSON backups in Settings.</li>
            <li><strong>Right to Erasure:</strong> You retain exclusive autonomous ability to wipe all traces of your data without requiring intervention from Thosho Tech support.</li>
          </ul>

          <hr style={{ margin: '20px 0', borderColor: 'var(--border-color)' }} />

          <h4>9. Changes to This Privacy Policy</h4>
          <p>We may update this Privacy Policy periodically to reflect technological enhancements or legal compliance requirements. Any significant modifications will be communicated through an updated version number and release date within the application's <strong>Settings &gt; About</strong> screen.</p>

          <hr style={{ margin: '20px 0', borderColor: 'var(--border-color)' }} />

          <h4>10. Contact Us</h4>
          <p>If you have questions, privacy inquiries, or require technical support regarding Open Cashbook or our data practices, please reach out to our official development channels:</p>
          <ul style={{ paddingLeft: '20px', marginBottom: '16px' }}>
            <li><strong>Publisher / Studio:</strong> Thosho Tech</li>
            <li><strong>Website:</strong> <a href="https://thoshotech.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>thoshotech.com</a></li>
            <li><strong>Support Email:</strong> contact@thoshotech.com</li>
          </ul>

          <p style={{ textAlign: 'center', marginTop: '30px', fontStyle: 'italic', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            Open Cashbook — Proudly engineered by Thosho Tech to give you complete mastery and privacy over your financial ledger.
          </p>
        </div>
      </div>
    </div>
  );
}
