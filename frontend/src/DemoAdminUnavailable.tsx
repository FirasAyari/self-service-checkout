export function DemoAdminUnavailable() {
  return <div className="app-shell demo-admin-unavailable">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Good Table checkout"><img className="brand-mark" src="/goodtable-mark.png" alt="" /><span className="brand-wordmark">good table</span></a>
      <a className="text-button" href="/">Back to checkout</a>
    </header>
    <main className="demo-admin-main" id="main-content">
      <section className="demo-admin-heading">
        <p className="eyebrow"><span className="eyebrow-line" /> Development tool</p>
        <h1 tabIndex={-1}>Admin controls are unavailable</h1>
        <p>This page is available only in the Development build. Demo administration endpoints are disabled by default and cannot be enabled in Production.</p>
        <a className="primary-button demo-admin-link" href="/">Return to checkout</a>
      </section>
    </main>
  </div>
}
