import type { JSX, ReactNode } from 'react'
export type IconName =
  | 'projects'
  | 'catalog'
  | 'providers'
  | 'plus'
  | 'arrow'
  | 'send'
  | 'stop'
  | 'sparkles'
  | 'chat'
  | 'close'
export function Icon({ name, size = 20 }: { name: IconName; size?: number }): JSX.Element {
  const paths: Record<IconName, ReactNode> = {
    projects: <path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 6h18" />,
    catalog: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <path d="M14 17.5h7m-3.5-3.5v7" />
      </>
    ),
    providers: <path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v4" />,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    send: <path d="m4 4 17 8-17 8 4-8-4-8Zm4 8h13" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    sparkles: <path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z" />,
    chat: <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  }
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
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
export function Brand(): JSX.Element {
  return (
    <div className="brand">
      <div className="brand-heading">
        <div className="brand-mark" aria-hidden="true">
          M
        </div>
        <span className="brand-name">MWIDE</span>
      </div>
      <p className="brand-tagline">Easy MCP and Skill Management</p>
    </div>
  )
}
export function EmptyState({
  icon = 'projects',
  title,
  children,
}: {
  icon?: IconName
  title: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="empty-state">
      <span className="empty-illustration">
        <Icon name={icon} size={34} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  )
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children?: ReactNode
}): JSX.Element {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {children}
    </header>
  )
}
