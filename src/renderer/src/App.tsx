import type { JSX } from 'react'

type IconName = 'projects' | 'mcp' | 'skills' | 'providers'

function Icon({ name }: { readonly name: IconName }): JSX.Element {
  const paths: Record<IconName, JSX.Element> = {
    projects: <path d="M3.5 6.5h6l2 2h9v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-12Zm0 5h17" />,
    mcp: (
      <>
        <path d="m8 5 8 7-8 7M4 9l4 3-4 3m12-6 4 3-4 3" />
      </>
    ),
    skills: <path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z" />,
    providers: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="14" width="6" height="6" rx="1.5" />
        <path d="M14 7h3v3M7 14v3h3" />
      </>
    ),
  }

  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function BrandMark(): JSX.Element {
  return (
    <svg
      className="brand-mark"
      aria-hidden="true"
      width="34"
      height="34"
      viewBox="0 0 34 34"
      fill="none"
    >
      <rect x="0.5" y="0.5" width="33" height="33" rx="10" />
      <path d="M8 23V11l9 8 9-8v12" />
      <path d="m8 17 9 8 9-8" />
    </svg>
  )
}

function EmptyProjects(): JSX.Element {
  return (
    <section className="empty-state" aria-labelledby="empty-projects-title">
      <div className="project-illustration" aria-hidden="true">
        <span className="illustration-orbit orbit-outer" />
        <span className="illustration-orbit orbit-inner" />
        <div className="folder-tile">
          <svg width="54" height="54" viewBox="0 0 54 54" fill="none">
            <path
              d="M9 16a3 3 0 0 1 3-3h10l5 5h15a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3V16Z"
              fill="currentColor"
              fillOpacity="0.07"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M10 24h34" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M23 32h8m-8 5h5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.55"
            />
          </svg>
        </div>
        <span className="orbit-dot dot-one" />
        <span className="orbit-dot dot-two" />
      </div>

      <p className="eyebrow">HER PROJEYE KENDİ ALANI</p>
      <h2 id="empty-projects-title">Her şey bir projeyle başlar.</h2>
      <p className="empty-description">
        Henüz bir proje eklenmedi.
        <br />
        Projeleriniz eklendiğinde burada yer alacak.
      </p>
      <span className="empty-divider" aria-hidden="true" />
      <p className="empty-note">Düşünmek ve üretmek için sade bir başlangıç.</p>
    </section>
  )
}

export default function App(): JSX.Element {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Ana içeriğe geç
      </a>
      <div className="app-shell">
        <aside className="sidebar" aria-label="Çalışma alanı bölümleri">
          <div className="brand">
            <div className="brand-heading">
              <BrandMark />
              <span className="brand-name">MWIDE</span>
            </div>
            <p className="brand-tagline">Easy MCP and Skill Management</p>
          </div>

          <div className="workspace-sections">
            <p className="sidebar-label">ÇALIŞMA ALANI</p>
            <ul className="section-list">
              <li className="section-item section-current" aria-current="page">
                <Icon name="projects" />
                <span>Projeler</span>
                <span className="current-marker" aria-hidden="true" />
              </li>
            </ul>

            <p className="sidebar-label upcoming-label">YAKINDA</p>
            <ul className="section-list upcoming-sections">
              <li className="section-item">
                <Icon name="mcp" />
                <span>MCP</span>
              </li>
              <li className="section-item">
                <Icon name="skills" />
                <span>Skills</span>
              </li>
              <li className="section-item">
                <Icon name="providers" />
                <span>Sağlayıcılar</span>
              </li>
            </ul>
          </div>

          <div className="sidebar-footer">
            <span className="footer-line" aria-hidden="true" />
            <p>Fikirden projeye.</p>
            <span>Kendi çalışma alanınız.</span>
          </div>
        </aside>

        <main className="main-panel" id="main-content" tabIndex={-1}>
          <header className="page-header">
            <div>
              <p className="page-overline">ÇALIŞMA ALANINIZ</p>
              <h1>Projeler</h1>
            </div>
            <span className="header-monogram" aria-hidden="true">
              M<span>W</span>
            </span>
          </header>

          <div className="workspace-canvas">
            <EmptyProjects />
            <span className="canvas-caption" aria-hidden="true">
              MWIDE
            </span>
          </div>
        </main>
      </div>
    </>
  )
}
