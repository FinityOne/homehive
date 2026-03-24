'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { usePathname, useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getInitials(email: string, fullName?: string): string {
  if (fullName) {
    const parts = fullName.trim().split(' ')
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    return parts[0][0].toUpperCase()
  }
  return email[0].toUpperCase()
}

// ─── NAV ITEMS PER PORTAL ─────────────────────────────────────────────────────
const NAV_ITEMS = {
  tenant: [
    { href: '/dashboard',  label: 'Overview',     icon: '⊞' },
    { href: '/homes',      label: 'Browse Homes', icon: '▣' },
  ],
  landlord: [
    { href: '/landlord/dashboard',    label: 'Overview',     icon: '⊞' },
    { href: '/landlord/listings',     label: 'My Listings',  icon: '▣' },
    { href: '/landlord/leads', label: 'Leads', icon: '◉' },
  ],
  admin: [
    { href: '/admin', label: 'Leads', icon: '◈' },
  ],
}

// ─── PORTAL THEMES (CSS custom properties) ────────────────────────────────────
// Applied as inline style on the wrapper so all children inherit via var()
const THEMES = {
  tenant: {
    '--sb-bg':           '#ffffff',
    '--sb-border':       '#e8e4db',
    '--logo-color':      '#1a1a1a',
    '--logo-em':         '#FFC627',
    '--nav-color':       '#6b6b6b',
    '--nav-hover-bg':    '#faf9f6',
    '--nav-hover-color': '#1a1a1a',
    '--nav-active-bg':   '#fdf2f5',
    '--nav-active-color':'#8C1D40',
    '--avatar-bg':       '#8C1D40',
    '--avatar-color':    '#FFC627',
    '--user-text':       '#1a1a1a',
    '--user-sub':        '#9b9b9b',
    '--divider':         '#e8e4db',
    '--so-color':        '#9b9b9b',
    '--so-hover-bg':     '#fdf2f5',
    '--so-hover-color':  '#8C1D40',
    '--ham-color':       '#1a1a1a',
    '--main-bg':         '#f5f4f0',
    '--psw-hover-bg':    'rgba(0,0,0,0.04)',
  },
  landlord: {
    '--sb-bg':           '#0f172a',
    '--sb-border':       '#1e293b',
    '--logo-color':      '#f1f5f9',
    '--logo-em':         '#10b981',
    '--nav-color':       'rgba(241,245,249,0.5)',
    '--nav-hover-bg':    'rgba(241,245,249,0.07)',
    '--nav-hover-color': '#f1f5f9',
    '--nav-active-bg':   'rgba(16,185,129,0.18)',
    '--nav-active-color':'#34d399',
    '--avatar-bg':       'rgba(16,185,129,0.22)',
    '--avatar-color':    '#34d399',
    '--user-text':       '#f1f5f9',
    '--user-sub':        'rgba(241,245,249,0.4)',
    '--divider':         '#1e293b',
    '--so-color':        'rgba(241,245,249,0.4)',
    '--so-hover-bg':     'rgba(241,245,249,0.07)',
    '--so-hover-color':  '#f1f5f9',
    '--ham-color':       '#f1f5f9',
    '--main-bg':         '#f0f4f8',
    '--psw-hover-bg':    'rgba(241,245,249,0.07)',
  },
  admin: {
    '--sb-bg':           '#18181b',
    '--sb-border':       '#27272a',
    '--logo-color':      '#fafafa',
    '--logo-em':         '#a78bfa',
    '--nav-color':       'rgba(250,250,250,0.45)',
    '--nav-hover-bg':    'rgba(250,250,250,0.06)',
    '--nav-hover-color': '#fafafa',
    '--nav-active-bg':   'rgba(167,139,250,0.18)',
    '--nav-active-color':'#c4b5fd',
    '--avatar-bg':       'rgba(167,139,250,0.2)',
    '--avatar-color':    '#a78bfa',
    '--user-text':       '#fafafa',
    '--user-sub':        'rgba(250,250,250,0.38)',
    '--divider':         '#27272a',
    '--so-color':        'rgba(250,250,250,0.38)',
    '--so-hover-bg':     'rgba(250,250,250,0.06)',
    '--so-hover-color':  '#fafafa',
    '--ham-color':       '#fafafa',
    '--main-bg':         '#f4f4f5',
    '--psw-hover-bg':    'rgba(250,250,250,0.06)',
  },
}

// Portal switcher dot colors (fixed, not CSS var based)
const PSW_DOT = { tenant: '#FFC627', landlord: '#10b981', admin: '#a78bfa' }
const PSW_LABEL = { tenant: 'Tenant', landlord: 'Landlord', admin: 'Admin' }

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [user, setUser]             = useState<{ email: string; fullName: string; role: string } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // ── Auth ──
  useEffect(() => {
    const loadUser = async (userId: string, email: string, fullName: string) => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single()
      setUser({ email, fullName, role: profile?.role || 'tenant' })
    }

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        loadUser(user.id, user.email || '', user.user_metadata?.full_name || '')
      } else {
        router.push('/login')
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadUser(session.user.id, session.user.email || '', session.user.user_metadata?.full_name || '')
      } else {
        setUser(null)
        router.push('/login')
      }
    })

    return () => subscription.unsubscribe()
  }, [router])

  useEffect(() => { setSidebarOpen(false) }, [pathname])
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    window.location.href = '/'
  }

  // ── Derive active portal from pathname ──
  const currentPortal: 'tenant' | 'landlord' | 'admin' =
    pathname.startsWith('/landlord') ? 'landlord' :
    pathname.startsWith('/admin')    ? 'admin'    : 'tenant'

  const role             = user?.role || 'tenant'
  const canSeePortals    = {
    tenant:   true,
    landlord: role === 'landlord' || role === 'admin',
    admin:    role === 'admin',
  }
  const navItems         = NAV_ITEMS[currentPortal]
  const theme            = THEMES[currentPortal]
  const otherPortals     = (['tenant', 'landlord', 'admin'] as const)
    .filter(p => p !== currentPortal && canSeePortals[p])

  const PORTAL_HREF = { tenant: '/dashboard', landlord: '/landlord/dashboard', admin: '/admin' }

  // ── Sidebar JSX (shared between desktop + mobile) ──
  const sidebar = (
    <>
      {/* Logo row */}
      <div className="sb-logo-row">
        <a href="/" className="sb-logo">Home<em>Hive</em></a>
        {currentPortal !== 'tenant' && (
          <span className="sb-portal-badge">
            {currentPortal === 'landlord' ? 'Landlord' : 'Admin'}
          </span>
        )}
      </div>

      {/* Nav section label */}
      <div className="sb-section-label" style={{ marginTop: '16px' }}>
        {currentPortal === 'tenant' ? 'My Portal' : currentPortal === 'landlord' ? 'Landlord' : 'Admin'}
      </div>

      {/* Nav items */}
      <nav className="sb-nav">
        {navItems.map(item => {
          const isActive = pathname === item.href ||
            (item.href !== '/' && pathname.startsWith(item.href + '/'))
          return (
            <a
              key={item.href}
              href={item.href}
              className={`sb-nav-item${isActive ? ' active' : ''}`}
            >
              <span className="sb-nav-icon">{item.icon}</span>
              {item.label}
            </a>
          )
        })}
      </nav>

      {/* Portal switcher */}
      {otherPortals.length > 0 && (
        <div className="sb-portals">
          <div className="sb-section-label">Switch portal</div>
          {otherPortals.map(p => (
            <a key={p} href={PORTAL_HREF[p]} className="sb-psw-item">
              <span className="sb-psw-dot" style={{ background: PSW_DOT[p] }} />
              <span className="sb-psw-label">{PSW_LABEL[p]}</span>
              <span className="sb-psw-arrow">
                {p === 'tenant' ? '←' : '→'}
              </span>
            </a>
          ))}
        </div>
      )}

      {/* User + sign out */}
      <div className="sb-bottom">
        {user && (
          <>
            {/* Clicking the user row goes to profile */}
            <a href="/profile" className={`sb-user-row${pathname === '/profile' ? ' active' : ''}`}>
              <div className="sb-avatar">{getInitials(user.email, user.fullName)}</div>
              <div className="sb-user-info">
                <div className="sb-user-name">{user.fullName || user.email.split('@')[0]}</div>
                <div className="sb-user-email">{user.email}</div>
              </div>
              <span className="sb-user-chevron">›</span>
            </a>
            <button className="sb-signout" onClick={handleSignOut}>
              <span>→</span> Sign out
            </button>
          </>
        )}
      </div>
    </>
  )

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* ── OUTER WRAPPER ── holds CSS vars so all children inherit them */
        .app-wrap { display: flex; min-height: 100vh; }

        /* ── SIDEBAR ── */
        .app-sidebar {
          width: 224px; flex-shrink: 0;
          background: var(--sb-bg);
          border-right: 1px solid var(--sb-border);
          display: flex; flex-direction: column;
          position: sticky; top: 0; height: 100vh; overflow-y: auto;
          transition: background 0.25s, border-color 0.25s;
        }

        /* Logo row */
        .sb-logo-row {
          padding: 0 16px; height: 60px; display: flex; align-items: center;
          justify-content: space-between; border-bottom: 1px solid var(--sb-border);
          flex-shrink: 0;
        }
        .sb-logo {
          font-family: 'DM Sans', sans-serif; font-size: 18px; font-weight: 600;
          color: var(--logo-color); text-decoration: none; letter-spacing: -0.3px;
          transition: color 0.25s;
        }
        .sb-logo em { font-family: 'Fraunces', serif; font-style: italic; color: var(--logo-em); transition: color 0.25s; }
        .sb-portal-badge {
          font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
          padding: 2px 7px; border-radius: 4px;
          background: var(--nav-active-bg); color: var(--nav-active-color);
          border: 1px solid var(--nav-active-bg);
        }

        /* Section labels */
        .sb-section-label {
          font-size: 10px; font-weight: 700; color: var(--user-sub);
          text-transform: uppercase; letter-spacing: 0.8px;
          padding: 0 18px 6px; transition: color 0.25s;
        }

        /* Nav */
        .sb-nav { padding: 4px 8px 8px; }
        .sb-nav-item {
          display: flex; align-items: center; gap: 9px; padding: 8px 10px;
          border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif;
          color: var(--nav-color); text-decoration: none;
          transition: background 0.15s, color 0.15s; margin-bottom: 1px;
        }
        .sb-nav-item:hover { background: var(--nav-hover-bg); color: var(--nav-hover-color); }
        .sb-nav-item.active { background: var(--nav-active-bg); color: var(--nav-active-color); font-weight: 600; }
        .sb-nav-icon { width: 20px; text-align: center; font-size: 14px; flex-shrink: 0; }

        /* Portal switcher */
        .sb-portals {
          padding: 12px 8px 8px;
          border-top: 1px solid var(--divider);
          margin: 0 0 0 0;
        }
        .sb-psw-item {
          display: flex; align-items: center; gap: 8px; padding: 7px 10px;
          border-radius: 8px; font-size: 12px; font-family: 'DM Sans', sans-serif;
          color: var(--nav-color); text-decoration: none;
          transition: background 0.15s, color 0.15s; margin-bottom: 1px;
        }
        .sb-psw-item:hover { background: var(--psw-hover-bg); color: var(--nav-hover-color); }
        .sb-psw-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .sb-psw-label { flex: 1; }
        .sb-psw-arrow { font-size: 11px; opacity: 0.5; }

        /* Bottom: user + sign out */
        .sb-bottom {
          margin-top: auto; padding: 10px 8px 18px;
          border-top: 1px solid var(--divider); flex-shrink: 0;
        }
        .sb-user-row {
          display: flex; align-items: center; gap: 9px; padding: 8px 10px;
          border-radius: 8px; margin-bottom: 1px; text-decoration: none;
          transition: background 0.15s; cursor: pointer;
        }
        .sb-user-row:hover { background: var(--nav-hover-bg); }
        .sb-user-row.active { background: var(--nav-active-bg); }
        .sb-avatar {
          width: 30px; height: 30px; border-radius: 50%;
          background: var(--avatar-bg); color: var(--avatar-color);
          font-size: 11px; font-weight: 700; display: flex; align-items: center;
          justify-content: center; flex-shrink: 0; font-family: 'DM Sans', sans-serif;
          transition: background 0.25s, color 0.25s;
        }
        .sb-user-info { min-width: 0; flex: 1; }
        .sb-user-name {
          font-size: 12px; font-weight: 600; color: var(--user-text);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          transition: color 0.25s;
        }
        .sb-user-email {
          font-size: 11px; color: var(--user-sub);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          transition: color 0.25s;
        }
        .sb-user-chevron {
          font-size: 10px; color: var(--user-sub); flex-shrink: 0;
          opacity: 0; transition: opacity 0.15s;
        }
        .sb-user-row:hover .sb-user-chevron { opacity: 1; }
        .sb-signout {
          display: flex; align-items: center; gap: 7px; padding: 7px 10px;
          border-radius: 8px; font-size: 13px; color: var(--so-color);
          background: none; border: none; cursor: pointer; width: 100%;
          font-family: 'DM Sans', sans-serif; transition: background 0.15s, color 0.15s;
          text-align: left; margin-top: 1px;
        }
        .sb-signout:hover { background: var(--so-hover-bg); color: var(--so-hover-color); }

        /* ── MAIN CONTENT AREA ── */
        .app-main {
          flex: 1; min-width: 0; display: flex; flex-direction: column;
          background: var(--main-bg); transition: background 0.25s;
        }

        /* ── MOBILE TOP BAR ── */
        .mob-topbar {
          display: none; align-items: center; justify-content: space-between;
          padding: 0 16px; height: 56px;
          background: var(--sb-bg); border-bottom: 1px solid var(--sb-border);
          position: sticky; top: 0; z-index: 100; flex-shrink: 0;
          transition: background 0.25s, border-color 0.25s;
        }
        .mob-topbar-right { display: flex; align-items: center; gap: 10px; }
        .mob-avatar {
          width: 30px; height: 30px; border-radius: 50%;
          background: var(--avatar-bg); color: var(--avatar-color);
          font-size: 11px; font-weight: 700; display: flex; align-items: center;
          justify-content: center; font-family: 'DM Sans', sans-serif;
        }
        .hamburger {
          background: none; border: none; cursor: pointer; padding: 6px;
          display: flex; flex-direction: column; gap: 5px; align-items: center;
          width: 36px; height: 36px; justify-content: center;
        }
        .hamburger span {
          display: block; width: 20px; height: 2px;
          background: var(--ham-color); border-radius: 2px;
          transition: all 0.25s, background 0.25s; transform-origin: center;
        }
        .hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
        .hamburger.open span:nth-child(2) { opacity: 0; transform: scaleX(0); }
        .hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

        /* ── OVERLAY ── */
        .sb-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 150; }

        @media (max-width: 768px) {
          .mob-topbar { display: flex; }
          .app-sidebar {
            display: none; position: fixed; top: 0; left: 0; bottom: 0;
            z-index: 200; width: 268px; box-shadow: 4px 0 28px rgba(0,0,0,0.18);
          }
          .app-sidebar.open { display: flex; }
        }
        @media (min-width: 769px) {
          .mob-topbar { display: none !important; }
          .sb-overlay  { display: none; }
        }
      `}</style>

      {sidebarOpen && <div className="sb-overlay" onClick={() => setSidebarOpen(false)} />}

      <div className="app-wrap" style={theme as React.CSSProperties}>

        {/* ── SIDEBAR ── */}
        <aside className={`app-sidebar${sidebarOpen ? ' open' : ''}`}>
          {sidebar}
        </aside>

        {/* ── MAIN ── */}
        <div className="app-main">

          {/* Mobile top bar */}
          <div className="mob-topbar">
            <a href="/" className="sb-logo">Home<em>Hive</em></a>
            <div className="mob-topbar-right">
              {user && <a href="/profile" className="mob-avatar" style={{ textDecoration: 'none' }}>{getInitials(user.email, user.fullName)}</a>}
              <button
                className={`hamburger${sidebarOpen ? ' open' : ''}`}
                onClick={() => setSidebarOpen(o => !o)}
                aria-label="Menu"
              >
                <span /><span /><span />
              </button>
            </div>
          </div>

          {children}
        </div>
      </div>
    </>
  )
}
