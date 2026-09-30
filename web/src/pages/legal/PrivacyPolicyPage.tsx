import { LegalLayout } from './LegalLayout';

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy" updated="September 28, 2026">
      <p>This Privacy Policy explains what data FinTrack collects, why, and how you can access, export or delete it. A live, personalised version of this information is always available in-app under Privacy Center.</p>

      <h3>1. What we store</h3>
      <p>Account data: email, username, a securely hashed password (never the password itself), and language/currency/timezone preferences. Financial data you enter: accounts, transactions, categories, budgets, goals, subscriptions, debts, recurring rules, journal entries and any receipts you upload. Security data: session and device metadata, approximate country derived from IP address (never a precise location), and a log of security-relevant events (logins, password changes, etc.).</p>
      <p><strong>We never ask for or store your online banking password, card PIN, or any credentials to a third-party financial institution.</strong> FinTrack does not connect directly to your bank; you enter your own transactions or import them from a file you export yourself.</p>

      <h3>2. Why we store it</h3>
      <p>To provide the core service (tracking your finances, computing budgets/goals/forecasts), to secure your account (sessions, security alerts, 2FA), to communicate with you (verification, password reset, optional notifications), and to improve reliability (error and security logging, never including your financial values).</p>

      <h3>3. AI features</h3>
      <p>If you opt in, AI Insights and the AI Assistant may send a summary of your own financial data (such as category totals or account balances — never raw credentials) to our AI provider to generate a response. This is used only to answer your request and is not used to train models on your data by default. You can turn this off at any time in Settings.</p>

      <h3>4. Who can see your data</h3>
      <p>Only you. Every financial record is tied to your account and is checked against your identity on every request. Administrators can see account-level information (email, status, security events) to operate the service and respond to abuse or support requests, but do not have standing access to your financial records, and any privileged access is logged.</p>

      <h3>5. Data retention and deletion</h3>
      <p>You can delete your account at any time from Security Center. By default, deletion has a grace period (shown at the time of deletion) during which you can cancel; after that period, or immediately if you choose immediate deletion, your account and financial data are permanently removed. Some records, like security and audit logs, may be retained in a de-identified form for a limited time as required for security and legal compliance.</p>

      <h3>6. Exporting your data</h3>
      <p>You can download a complete copy of your data at any time from Privacy Center, in a structured JSON format, or export your transactions as CSV/Excel and reports as PDF from the relevant pages.</p>

      <h3>7. Cookies and sessions</h3>
      <p>FinTrack uses strictly necessary cookies to keep you signed in and to protect your account (session and CSRF protection). We do not use third-party advertising or tracking cookies.</p>

      <h3>8. Security</h3>
      <p>Passwords are hashed with a modern, memory-hard algorithm (Argon2id) and never stored in plain text. Sensitive fields such as two-factor secrets and journal entries are encrypted at rest. See Security Center for the controls available to you, including active sessions, login history and two-factor authentication.</p>

      <h3>9. Changes to this policy</h3>
      <p>We'll update this page if what we collect or why materially changes, and reflect the update date above.</p>
    </LegalLayout>
  );
}
