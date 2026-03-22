'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { usePathname, useRouter } from 'next/navigation'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function getInitials(email: string, fullName?: string): string {
  if (fullName) {
    const parts = fullName.trim().split(' ')
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    return parts[0][0].toUpperCase()
  }
  return email[0].toUpperCase()
}

const NAV_ITEMS = {
  tenant: [
    { href: '/dashboard',   label: 'Overview',      icon: '⊞' },
    { href: '/homes',       label: 'Browse Homes',  icon: '▣' },
    { href: '/roommates',   label: 'Roommates',     icon: '⊕' },
  ],
  landlord: [
    { href: '/landlord/dashboard',     label: 'Overview',      icon: '⊞' },
    { href: '/landlord/listings',      label: 'My Listings',   icon: '▣' },
    { href: '/landlord/applications',  label: 'Applications',  icon: '▤' },
    { href: '/landlord/maintenance',   label: 'Maintenance',   icon: '◇' },
  ],
  admin: [
    { href: '/admin',              label: 'Leads',          icon: '◈' },
    { href: '/landlord/dashboard', label: 'Landlord View',  icon: '⊞' },
  ],
}

const ROLE_LABEL: Record<string, string> = {
  landlord: 'Landlord',
  admin:    'Admin',
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [user, setUser]           = useState<{ email: string; fullName: string; role: string } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    const loadUser = async (userId: string, email: string, fullName: string) => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single()
      setUser({ email, fullName, role: profile?.role || 'tenant' })
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        loadUser(session.user.id, session.user.email || '', session.user.user_metadata?.full_name || '')
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

  // Close sidebar on route change
  useEffect(() => { setSidebarOpen(false) }, [pathname])

  // Lock body scroll when mobile sidebar open
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    window.location.href = '/'
  }

  const role     = user?.role || 'tenant'
  const navItems = NAV_ITEMS[role as keyof typeof NAV_ITEMS] || NAV_ITEMS.tenant

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className="sidebar-logo-row">
        <a href="/" className="sidebar-logo">Home<em>Hive</em></a>
        {ROLE_LABEL[role] && <span className="role-badge">{ROLE_LABEL[role]}</span>}
      </div>

      {/* Nav items */}
      <nav className="sidebar-nav">
        {navItems.map(item => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'))
          return (
            <a
              key={item.href}
              href={item.href}
              className={`sidebar-nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-item-icon">{item.icon}</span>
              {item.label}
            </a>
          )
        })}
      </nav>

      {/* User + sign out */}
      <div className="sidebar-bottom">
        {user && (
          <>
            <div className="user-row">
              <div className="user-avatar">{getInitials(user.email, user.fullName)}</div>
              <div className="user-info">
                <div className="user-name">{user.fullName || user.email.split('@')[0]}</div>
                <div className="user-email">{user.email}</div>
              </div>
            </div>
            <button className="signout-btn" onClick={handleSignOut}>
              <span style={{ fontSize: '12px' }}>→</span> Sign out
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

        /* ── LAYOUT ── */
        .app-layout { display: flex; min-height: 100vh; }

        /* ── SIDEBAR ── */
        .app-sidebar {
          width: 220px; background: #fff; border-right: 1px solid #e8e4db;
          display: flex; flex-direction: column; flex-shrink: 0;
          position: sticky; top: 0; height: 100vh; overflow-y: auto;
        }

        /* ── LOGO ROW ── */
        .sidebar-logo-row {
          padding: 0 16px; height: 60px; display: flex; align-items: center;
          justify-content: space-between; border-bottom: 1px solid #e8e4db; flex-shrink: 0;
        }
        .sidebar-logo {
          font-family: 'DM Sans', sans-serif; font-size: 18px; font-weight: 600;
          color: #1a1a1a; text-decoration: none; letter-spacing: -0.3px;
        }
        .sidebar-logo em { font-family: 'Fraunces', serif; font-style: italic; color: #FFC627; }
        .role-badge {
          background: #fdf2f5; color: #8C1D40; font-size: 10px; font-weight: 700;
          letter-spacing: 0.5px; text-transform: uppercase; padding: 2px 7px;
          border-radius: 4px; border: 1px solid #f5c6d4;
        }

        /* ── NAV ── */
        .sidebar-nav { flex: 1; padding: 12px 8px; overflow-y: auto; }
        .sidebar-nav-item {
          display: flex; align-items: center; gap: 9px; padding: 9px 10px;
          border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif;
          color: #6b6b6b; text-decoration: none; transition: all 0.15s; margin-bottom: 2px;
        }
        .sidebar-nav-item:hover { background: #faf9f6; color: #1a1a1a; }
        .sidebar-nav-item.active { background: #fdf2f5; color: #8C1D40; font-weight: 600; }
        .nav-item-icon { width: 20px; text-align: center; font-size: 15px; flex-shrink: 0; }

        /* ── BOTTOM ── */
        .sidebar-bottom { padding: 12px 8px 20px; border-top: 1px solid #e8e4db; flex-shrink: 0; }
        .user-row {
          display: flex; align-items: center; gap: 9px; padding: 8px 10px;
          border-radius: 8px; margin-bottom: 4px;
        }
        .user-avatar {
          width: 30px; height: 30px; border-radius: 50%; background: #8C1D40; color: #FFC627;
          font-size: 11px; font-weight: 700; display: flex; align-items: center;
          justify-content: center; flex-shrink: 0; font-family: 'DM Sans', sans-serif;
        }
        .user-info { min-width: 0; }
        .user-name { font-size: 12px; font-weight: 600; color: #1a1a1a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .user-email { font-size: 11px; color: #9b9b9b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .signout-btn {
          display: flex; align-items: center; gap: 7px; padding: 8px 10px; border-radius: 8px;
          font-size: 13px; color: #9b9b9b; background: none; border: none; cursor: pointer;
          width: 100%; font-family: 'DM Sans', sans-serif; transition: all 0.15s; text-align: left;
        }
        .signout-btn:hover { background: #fdf2f5; color: #8C1D40; }

        /* ── MAIN ── */
        .app-main { flex: 1; min-width: 0; display: flex; flex-direction: column; background: #f5f4f0; }

        /* ── MOBILE TOP BAR ── */
        .mob-topbar {
          display: none; align-items: center; justify-content: space-between;
          padding: 0 16px; height: 56px; background: #fff; border-bottom: 1px solid #e8e4db;
          position: sticky; top: 0; z-index: 100; flex-shrink: 0;
        }
        .mob-topbar-right { display: flex; align-items: center; gap: 10px; }
        .mob-avatar {
          width: 30px; height: 30px; border-radius: 50%; background: #8C1D40; color: #FFC627;
          font-size: 11px; font-weight: 700; display: flex; align-items: center;
          justify-content: center; font-family: 'DM Sans', sans-serif;
        }
        .hamburger {
          background: none; border: none; cursor: pointer; padding: 6px;
          display: flex; flex-direction: column; gap: 5px; align-items: center;
          width: 36px; height: 36px; justify-content: center;
        }
        .hamburger span {
          display: block; width: 20px; height: 2px; background: #1a1a1a;
          border-radius: 2px; transition: all 0.25s; transform-origin: center;
        }
        .hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
        .hamburger.open span:nth-child(2) { opacity: 0; transform: scaleX(0); }
        .hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

        /* ── MOBILE SIDEBAR OVERLAY ── */
        .sidebar-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 150; }

        @media (max-width: 768px) {
          .mob-topbar { display: flex; }
          .app-sidebar {
            display: none; position: fixed; top: 0; left: 0; bottom: 0;
            z-index: 200; width: 260px; box-shadow: 4px 0 24px rgba(0,0,0,0.14);
          }
          .app-sidebar.open { display: flex; }
        }
        @media (min-width: 769px) {
          .mob-topbar { display: none !important; }
          .sidebar-overlay { display: none; }
        }
      `}</style>

      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <div className="app-layout">

        {/* ── SIDEBAR ── */}
        <aside className={`app-sidebar${sidebarOpen ? ' open' : ''}`}>
          <SidebarContent />
        </aside>

        {/* ── MAIN ── */}
        <div className="app-main">

          {/* Mobile top bar */}
          <div className="mob-topbar">
            <a href="/" className="sidebar-logo">Home<em>Hive</em></a>
            <div className="mob-topbar-right">
              {user && <div className="mob-avatar">{getInitials(user.email, user.fullName)}</div>}
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
