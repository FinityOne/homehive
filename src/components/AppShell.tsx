'use client'

import { useState, useEffect, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { usePathname, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'

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

// ─── TYPES ─────────────────────────────────────────────────────────────────────
type NavItem = { href: string; label: string; icon: string; exact?: boolean }

type Notification = {
  id: string
  type: string
  title: string
  body: string | null
  href: string | null
  is_read: boolean
  created_at: string
}

const NAV_ITEMS: Record<'tenant' | 'landlord' | 'admin', NavItem[]> = {
  tenant: [
    { href: '/dashboard',      label: 'Overview',       icon: '⊞', exact: true },
    { href: '/homes',          label: 'Browse Homes',   icon: '▣' },
    { href: '/groups',         label: 'My Groups',      icon: '🐝' },
    { href: '/dashboard/list', label: 'List your place', icon: '⊕' },
  ],
  landlord: [
    { href: '/landlord/dashboard',  label: 'Overview',    icon: '⊞', exact: true },
    { href: '/landlord/listings',   label: 'My Listings', icon: '▣' },
    { href: '/landlord/leads',      label: 'Leads',       icon: '◉' },
    { href: '/landlord/roommates',  label: 'Roommates',   icon: '👥' },
    { href: '/landlord/calendar',   label: 'Calendar',    icon: '📅' },
    { href: '/landlord/tenants',    label: 'Tenants',     icon: '◎' },
    { href: '/landlord/leases',     label: 'Leases',      icon: '📋' },
    { href: '/landlord/payments',     label: 'Payments',     icon: '💳' },
    { href: '/landlord/automations',       label: 'Automations',       icon: '⚡' },
    { href: '/landlord/background-checks', label: 'Background Checks', icon: '🔍' },
    { href: '/landlord/customizations',    label: 'Customizations',    icon: '✦' },
  ],
  admin: [
    { href: '/admin',                    label: 'Overview',         icon: '⊞', exact: true },
    { href: '/admin/users',              label: 'Users',            icon: '◎' },
    { href: '/admin/properties',         label: 'Properties',       icon: '▣' },
    { href: '/admin/leads',              label: 'Leads',            icon: '◉' },
    { href: '/admin/payments',           label: 'Payments',         icon: '💳' },
    { href: '/admin/upgrade-requests',   label: 'Upgrade Requests', icon: '⬆' },
    { href: '/admin/marketing',          label: 'Marketing',        icon: '📣' },
  ],
}

// ─── THEMES ───────────────────────────────────────────────────────────────────
const THEMES = {
  tenant: {
    '--sb-bg':            '#ffffff',
    '--sb-border':        '#e8e4db',
    '--tb-bg':            '#ffffff',
    '--tb-border':        '#e8e4db',
    '--logo-color':       '#1a1a1a',
    '--logo-em':          '#FFC627',
    '--nav-color':        '#6b6b6b',
    '--nav-hover-bg':     '#faf9f6',
    '--nav-hover-color':  '#1a1a1a',
    '--nav-active-bg':    '#fdf2f5',
    '--nav-active-color': '#8C1D40',
    '--avatar-bg':        '#8C1D40',
    '--avatar-color':     '#FFC627',
    '--user-text':        '#1a1a1a',
    '--user-sub':         '#9b9b9b',
    '--divider':          '#e8e4db',
    '--so-color':         '#9b9b9b',
    '--so-hover-bg':      '#fdf2f5',
    '--so-hover-color':   '#8C1D40',
    '--ham-color':        '#6b6b6b',
    '--main-bg':          '#f5f4f0',
    '--psw-hover-bg':     'rgba(0,0,0,0.04)',
    '--dd-bg':            '#ffffff',
    '--dd-shadow':        '0 4px 20px rgba(0,0,0,0.10)',
  },
  landlord: {
    '--sb-bg':            '#0f172a',
    '--sb-border':        '#1e293b',
    '--tb-bg':            '#0f172a',
    '--tb-border':        '#1e293b',
    '--logo-color':       '#f1f5f9',
    '--logo-em':          '#10b981',
    '--nav-color':        'rgba(241,245,249,0.5)',
    '--nav-hover-bg':     'rgba(241,245,249,0.07)',
    '--nav-hover-color':  '#f1f5f9',
    '--nav-active-bg':    'rgba(16,185,129,0.18)',
    '--nav-active-color': '#34d399',
    '--avatar-bg':        'rgba(16,185,129,0.22)',
    '--avatar-color':     '#34d399',
    '--user-text':        '#f1f5f9',
    '--user-sub':         'rgba(241,245,249,0.4)',
    '--divider':          '#1e293b',
    '--so-color':         'rgba(241,245,249,0.4)',
    '--so-hover-bg':      'rgba(241,245,249,0.07)',
    '--so-hover-color':   '#f1f5f9',
    '--ham-color':        'rgba(241,245,249,0.6)',
    '--main-bg':          '#f0f4f8',
    '--psw-hover-bg':     'rgba(241,245,249,0.07)',
    '--dd-bg':            '#1e293b',
    '--dd-shadow':        '0 4px 20px rgba(0,0,0,0.30)',
  },
  admin: {
    '--sb-bg':            '#18181b',
    '--sb-border':        '#27272a',
    '--tb-bg':            '#18181b',
    '--tb-border':        '#27272a',
    '--logo-color':       '#fafafa',
    '--logo-em':          '#a78bfa',
    '--nav-color':        'rgba(250,250,250,0.45)',
    '--nav-hover-bg':     'rgba(250,250,250,0.06)',
    '--nav-hover-color':  '#fafafa',
    '--nav-active-bg':    'rgba(167,139,250,0.18)',
    '--nav-active-color': '#c4b5fd',
    '--avatar-bg':        'rgba(167,139,250,0.22)',
    '--avatar-color':     '#a78bfa',
    '--user-text':        '#fafafa',
    '--user-sub':         'rgba(250,250,250,0.38)',
    '--divider':          '#27272a',
    '--so-color':         'rgba(250,250,250,0.38)',
    '--so-hover-bg':      'rgba(250,250,250,0.06)',
    '--so-hover-color':   '#fafafa',
    '--ham-color':        'rgba(250,250,250,0.6)',
    '--main-bg':          '#f4f4f5',
    '--psw-hover-bg':     'rgba(250,250,250,0.06)',
    '--dd-bg':            '#27272a',
    '--dd-shadow':        '0 4px 20px rgba(0,0,0,0.40)',
  },
}

const PSW_DOT   = { tenant: '#FFC627', landlord: '#10b981', admin: '#a78bfa' }
const PSW_LABEL = { tenant: 'Tenant',  landlord: 'Landlord', admin: 'Admin' }

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const ph       = usePostHog()

  const [user, setUser] = useState<{
    email: string; fullName: string; role: string; avatarUrl: string | null
  } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [pendingUpgradeCount, setPendingUpgradeCount] = useState(0)
  const [overduePaymentsCount, setOverduePaymentsCount] = useState(0)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const profileRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  // ── Auth ──
  useEffect(() => {
    const loadUser = async (userId: string, email: string, fullName: string) => {
      const { data: profile } = await supabase
        .from('profiles').select('role, avatar_url').eq('id', userId).single()
      const role = profile?.role || 'tenant'
      setUser({ email, fullName, role, avatarUrl: profile?.avatar_url || null })
      ph?.identify(userId, { email, name: fullName, role })

      // Fetch pending upgrade request count for admin badge
      if (role === 'admin') {
        fetch('/api/upgrade-requests')
          .then(r => r.json())
          .then((data: Array<{ status: string }>) => {
            setPendingUpgradeCount(data.filter(r => r.status === 'pending').length)
          })
          .catch(() => {})
      }
      // Fetch overdue payment count for landlord badge
      if (role === 'landlord' || role === 'admin') {
        fetch('/api/payments/overdue-count')
          .then(r => r.json())
          .then((data: { count: number }) => setOverduePaymentsCount(data.count))
          .catch(() => {})
      }
      // Fetch notifications for landlord
      if (role === 'landlord') {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) {
          fetch('/api/notifications', { headers: { Authorization: `Bearer ${session.access_token}` } })
            .then(r => r.json())
            .then((data: { notifications?: Notification[] }) => {
              const notifs = data.notifications || []
              setNotifications(notifs)
              setUnreadCount(notifs.filter(n => !n.is_read).length)
            })
            .catch(() => {})
        }
      }
    }
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) loadUser(user.id, user.email || '', user.user_metadata?.full_name || '')
      else router.push('/login')
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) loadUser(session.user.id, session.user.email || '', session.user.user_metadata?.full_name || '')
      else { setUser(null); router.push('/login') }
    })
    return () => subscription.unsubscribe()
  }, [router])

  // Close profile dropdown on outside click
  useEffect(() => {
    if (!profileOpen) return
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [profileOpen])

  // Close notif dropdown on outside click
  useEffect(() => {
    if (!notifOpen) return
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [notifOpen])

  const handleNotifOpen = async () => {
    setNotifOpen(o => !o)
    if (!notifOpen && unreadCount > 0) {
      // Mark all as read
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        fetch('/api/notifications', {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }).then(() => {
          setUnreadCount(0)
          setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
        }).catch(() => {})
      }
    }
  }

  useEffect(() => { setSidebarOpen(false); setProfileOpen(false); setNotifOpen(false) }, [pathname])
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    ph?.reset()
    setUser(null)
    window.location.href = '/'
  }

  // ── Portal / nav ──
  const currentPortal: 'tenant' | 'landlord' | 'admin' =
    pathname.startsWith('/landlord') ? 'landlord' :
    pathname.startsWith('/admin')    ? 'admin'    : 'tenant'

  const role = user?.role || 'tenant'
  const canSeePortals = {
    tenant:   true,
    landlord: role === 'landlord' || role === 'admin',
    admin:    role === 'admin',
  }
  const navItems     = NAV_ITEMS[currentPortal]
  const theme        = THEMES[currentPortal]
  const otherPortals = (['tenant', 'landlord', 'admin'] as const)
    .filter(p => p !== currentPortal && canSeePortals[p])
  const PORTAL_HREF  = { tenant: '/dashboard', landlord: '/landlord/dashboard', admin: '/admin' }

  const isActive = (item: NavItem) =>
    pathname === item.href ||
    (!item.exact && item.href !== '/' && pathname.startsWith(item.href + '/'))

  const avatarEl = user ? (
    user.avatarUrl
      ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
      : getInitials(user.email, user.fullName)
  ) : null

  const portalLabel = { tenant: 'Tenant', landlord: 'Landlord', admin: 'Admin' }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* ── OUTER SHELL ── */
        .app-outer {
          display: flex; flex-direction: column; min-height: 100vh;
        }

        /* ══════════════════════════════════════════
           TOP BAR
        ══════════════════════════════════════════ */
        .app-topbar {
          height: 56px; flex-shrink: 0;
          background: var(--tb-bg);
          border-bottom: 1px solid var(--tb-border);
          display: flex; align-items: center;
          padding: 0 20px;
          position: sticky; top: 0; z-index: 200;
        }

        /* Logo */
        .tb-logo {
          text-decoration: none; flex-shrink: 0; display: inline-flex; align-items: center;
        }
        .tb-logo img { height: 26px; width: auto; display: block; }

        /* Portal badge next to logo */
        .tb-portal-badge {
          margin-left: 10px; flex-shrink: 0;
          font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
          padding: 2px 8px; border-radius: 4px;
          background: var(--nav-active-bg); color: var(--nav-active-color);
        }

        /* Vertical divider */
        .tb-divider {
          width: 1px; height: 20px; background: var(--tb-border);
          margin: 0 16px; flex-shrink: 0;
        }

        /* Spacer pushes profile to the right */
        .tb-spacer { flex: 1; }

        /* Notification bell */
        .tb-notif {
          position: relative; flex-shrink: 0; margin-right: 8px;
        }
        .tb-notif-btn {
          display: flex; align-items: center; justify-content: center;
          width: 36px; height: 36px; border-radius: 8px;
          background: none; border: none; cursor: pointer;
          font-size: 17px; position: relative;
          transition: background 0.15s;
        }
        .tb-notif-btn:hover { background: var(--nav-hover-bg); }
        .tb-notif-badge {
          position: absolute; top: 4px; right: 4px;
          background: #ef4444; color: #fff;
          font-size: 9px; font-weight: 700;
          min-width: 15px; height: 15px; border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          padding: 0 3px; font-family: 'DM Sans', sans-serif;
          border: 2px solid var(--tb-bg);
        }
        .tb-notif-panel {
          position: absolute; top: calc(100% + 8px); right: 0;
          width: 320px; max-height: 400px; overflow-y: auto;
          background: var(--dd-bg); border: 1px solid var(--tb-border);
          border-radius: 12px; box-shadow: var(--dd-shadow); z-index: 300;
        }
        .tb-notif-header {
          padding: 12px 16px 10px; border-bottom: 1px solid var(--divider);
          font-size: 12px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
          color: var(--user-sub); font-family: 'DM Sans', sans-serif;
        }
        .tb-notif-item {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 12px 16px; border-bottom: 1px solid var(--divider);
          text-decoration: none; transition: background 0.15s;
        }
        .tb-notif-item:hover { background: var(--nav-hover-bg); }
        .tb-notif-item:last-child { border-bottom: none; }
        .tb-notif-dot {
          width: 7px; height: 7px; border-radius: 50%; margin-top: 5px; flex-shrink: 0;
        }
        .tb-notif-content { flex: 1; min-width: 0; }
        .tb-notif-title {
          font-size: 13px; font-weight: 600; color: var(--user-text);
          font-family: 'DM Sans', sans-serif; line-height: 1.4;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .tb-notif-body {
          font-size: 12px; color: var(--user-sub); font-family: 'DM Sans', sans-serif;
          margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .tb-notif-time {
          font-size: 11px; color: var(--user-sub); font-family: 'DM Sans', sans-serif;
          margin-top: 3px;
        }
        .tb-notif-empty {
          padding: 24px 16px; text-align: center; font-size: 13px;
          color: var(--user-sub); font-family: 'DM Sans', sans-serif;
        }

        /* Mobile hamburger — hidden on desktop */
        .tb-hamburger {
          display: none;
          background: none; border: none; cursor: pointer; padding: 6px;
          flex-direction: column; gap: 5px; align-items: center;
          width: 36px; height: 36px; justify-content: center; margin-right: 4px;
        }
        .tb-hamburger span {
          display: block; width: 18px; height: 2px;
          background: var(--ham-color); border-radius: 2px;
          transition: all 0.25s; transform-origin: center;
        }
        .tb-hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
        .tb-hamburger.open span:nth-child(2) { opacity: 0; transform: scaleX(0); }
        .tb-hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

        /* ── PROFILE AREA (top-right) ── */
        .tb-profile { position: relative; flex-shrink: 0; }

        .tb-profile-btn {
          display: flex; align-items: center; gap: 8px;
          background: none; border: none; cursor: pointer; padding: 5px 8px;
          border-radius: 8px; transition: background 0.15s;
        }
        .tb-profile-btn:hover { background: var(--nav-hover-bg); }

        .tb-avatar {
          width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
          background: var(--avatar-bg); color: var(--avatar-color);
          font-size: 11px; font-weight: 700; font-family: 'DM Sans', sans-serif;
          display: flex; align-items: center; justify-content: center; overflow: hidden;
        }
        .tb-user-name {
          font-size: 13px; font-weight: 500; color: var(--user-text);
          font-family: 'DM Sans', sans-serif; white-space: nowrap;
          max-width: 140px; overflow: hidden; text-overflow: ellipsis;
        }
        .tb-chevron {
          font-size: 10px; color: var(--user-sub); transition: transform 0.2s; flex-shrink: 0;
        }
        .tb-chevron.open { transform: rotate(180deg); }

        /* Dropdown */
        .tb-dropdown {
          position: absolute; top: calc(100% + 8px); right: 0;
          min-width: 200px;
          background: var(--dd-bg); border: 1px solid var(--tb-border);
          border-radius: 10px; overflow: hidden;
          box-shadow: var(--dd-shadow); z-index: 300;
        }
        .tb-dd-header {
          padding: 12px 14px 10px;
          border-bottom: 1px solid var(--divider);
        }
        .tb-dd-name  { font-size: 13px; font-weight: 600; color: var(--user-text); font-family: 'DM Sans', sans-serif; }
        .tb-dd-email { font-size: 11px; color: var(--user-sub); font-family: 'DM Sans', sans-serif; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .tb-dd-item {
          display: flex; align-items: center; gap: 9px; padding: 10px 14px;
          font-size: 13px; font-family: 'DM Sans', sans-serif;
          color: var(--nav-color); text-decoration: none; width: 100%;
          background: none; border: none; cursor: pointer; text-align: left;
          transition: background 0.15s, color 0.15s;
        }
        .tb-dd-item:hover { background: var(--nav-hover-bg); color: var(--nav-hover-color); }
        .tb-dd-icon { width: 16px; text-align: center; flex-shrink: 0; font-size: 13px; }
        .tb-dd-divider { height: 1px; background: var(--divider); }
        .tb-dd-signout { color: var(--so-color); }
        .tb-dd-signout:hover { background: var(--so-hover-bg); color: var(--so-hover-color); }

        /* ══════════════════════════════════════════
           BODY: SIDEBAR + MAIN
        ══════════════════════════════════════════ */
        .app-body {
          display: flex; flex: 1; min-height: 0;
        }

        /* ── SIDEBAR ── */
        .app-sidebar {
          width: 216px; flex-shrink: 0;
          background: var(--sb-bg); border-right: 1px solid var(--sb-border);
          display: flex; flex-direction: column;
          position: sticky; top: 56px; height: calc(100vh - 56px); overflow-y: auto;
        }

        .sb-section-label {
          font-size: 10px; font-weight: 700; color: var(--user-sub);
          text-transform: uppercase; letter-spacing: 0.8px;
          padding: 16px 18px 6px;
        }

        .sb-nav { padding: 2px 8px 8px; }
        .sb-nav-item {
          display: flex; align-items: center; gap: 9px; padding: 8px 10px;
          border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif;
          color: var(--nav-color); text-decoration: none;
          transition: background 0.15s, color 0.15s; margin-bottom: 1px;
        }
        .sb-nav-item:hover  { background: var(--nav-hover-bg); color: var(--nav-hover-color); }
        .sb-nav-item.active { background: var(--nav-active-bg); color: var(--nav-active-color); font-weight: 600; }
        .sb-nav-icon { width: 20px; text-align: center; font-size: 14px; flex-shrink: 0; }

        .sb-portals {
          margin-top: auto; padding: 12px 8px 16px;
          border-top: 1px solid var(--divider);
        }
        .sb-psw-item {
          display: flex; align-items: center; gap: 8px; padding: 7px 10px;
          border-radius: 8px; font-size: 12px; font-family: 'DM Sans', sans-serif;
          color: var(--nav-color); text-decoration: none;
          transition: background 0.15s, color 0.15s; margin-bottom: 1px;
        }
        .sb-psw-item:hover { background: var(--psw-hover-bg); color: var(--nav-hover-color); }
        .sb-psw-dot   { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .sb-psw-label { flex: 1; }
        .sb-psw-arrow { font-size: 11px; opacity: 0.5; }

        /* ── MAIN CONTENT ── */
        .app-main {
          flex: 1; min-width: 0;
          background: var(--main-bg);
        }

        /* ── OVERLAY (mobile sidebar) ── */
        .sb-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 150; }

        /* ══════════════════════════════════════════
           MOBILE BOTTOM TAB BAR
        ══════════════════════════════════════════ */
        .mob-bottom-nav {
          display: none;
          position: fixed; bottom: 0; left: 0; right: 0;
          background: var(--sb-bg); border-top: 1px solid var(--sb-border);
          z-index: 100;
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        .mob-bottom-inner { display: flex; align-items: stretch; }
        .mob-tab {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 3px; padding: 10px 4px 8px;
          color: var(--nav-color); text-decoration: none; font-family: 'DM Sans', sans-serif;
          transition: color 0.15s; position: relative;
        }
        .mob-tab.active { color: var(--nav-active-color); }
        .mob-tab.active::before {
          content: ''; position: absolute; top: 0; left: 50%; transform: translateX(-50%);
          width: 20px; height: 2px; border-radius: 0 0 2px 2px; background: var(--nav-active-color);
        }
        .mob-tab-icon  { font-size: 17px; line-height: 1; }
        .mob-tab-label { font-size: 10px; font-weight: 600; letter-spacing: 0.2px; }

        /* ══════════════════════════════════════════
           RESPONSIVE
        ══════════════════════════════════════════ */
        @media (max-width: 768px) {
          .tb-hamburger   { display: flex; }
          .tb-user-name   { display: none; }
          .tb-chevron     { display: none; }
          .mob-bottom-nav { display: block; }
          .app-main       { padding-bottom: 64px; }
          .app-sidebar {
            display: none;
            position: fixed; top: 56px; left: 0; bottom: 0;
            z-index: 200; width: 268px; height: auto;
            box-shadow: 4px 0 28px rgba(0,0,0,0.18);
          }
          .app-sidebar.open { display: flex; flex-direction: column; }
          .tb-dd-name, .tb-dd-email { display: none; }
        }
        @media (min-width: 769px) {
          .mob-bottom-nav { display: none !important; }
          .sb-overlay     { display: none; }
        }
      `}</style>

      {sidebarOpen && <div className="sb-overlay" onClick={() => setSidebarOpen(false)} />}

      <div className="app-outer" style={theme as React.CSSProperties}>

        {/* ══ TOP BAR ══ */}
        <header className="app-topbar">

          {/* Mobile hamburger */}
          <button
            className={`tb-hamburger${sidebarOpen ? ' open' : ''}`}
            onClick={() => setSidebarOpen(o => !o)}
            aria-label="Menu"
          >
            <span /><span /><span />
          </button>

          {/* Logo */}
          <a href="/" className="tb-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hh-logo-white.png" alt="HomeHive" />
          </a>

          {/* Portal badge */}
          {currentPortal !== 'tenant' && (
            <span className="tb-portal-badge">{portalLabel[currentPortal]}</span>
          )}

          <div className="tb-spacer" />

          {/* Notification bell — landlord only */}
          {user && currentPortal === 'landlord' && (
            <div className="tb-notif" ref={notifRef}>
              <button className="tb-notif-btn" onClick={handleNotifOpen} aria-label="Notifications">
                🔔
                {unreadCount > 0 && (
                  <span className="tb-notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                )}
              </button>
              {notifOpen && (
                <div className="tb-notif-panel">
                  <div className="tb-notif-header">Notifications</div>
                  {notifications.length === 0 ? (
                    <div className="tb-notif-empty">No notifications yet</div>
                  ) : (
                    notifications.map(n => {
                      const ICON: Record<string, string> = { lead_in: '◉', prescreen_filled: '📋', tour_booked: '📅' }
                      const DOT: Record<string, string> = { lead_in: '#10b981', prescreen_filled: '#3b82f6', tour_booked: '#f59e0b' }
                      const diff = Date.now() - new Date(n.created_at).getTime()
                      const mins = Math.floor(diff / 60000)
                      const timeAgo = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`
                      const inner = (
                        <>
                          <span className="tb-notif-dot" style={{ background: DOT[n.type] || '#6b6b6b' }} />
                          <div className="tb-notif-content">
                            <div className="tb-notif-title">{ICON[n.type] || '•'} {n.title}</div>
                            {n.body && <div className="tb-notif-body">{n.body}</div>}
                            <div className="tb-notif-time">{timeAgo}</div>
                          </div>
                        </>
                      )
                      return n.href ? (
                        <a key={n.id} href={n.href} className="tb-notif-item" style={{ opacity: n.is_read ? 0.65 : 1 }} onClick={() => setNotifOpen(false)}>{inner}</a>
                      ) : (
                        <div key={n.id} className="tb-notif-item" style={{ opacity: n.is_read ? 0.65 : 1 }}>{inner}</div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {/* Profile dropdown */}
          {user && (
            <div className="tb-profile" ref={profileRef}>
              <button
                className="tb-profile-btn"
                onClick={() => setProfileOpen(o => !o)}
              >
                <div className="tb-avatar">{avatarEl}</div>
                <span className="tb-user-name">{user.fullName || user.email.split('@')[0]}</span>
                <span className={`tb-chevron${profileOpen ? ' open' : ''}`}>▾</span>
              </button>

              {profileOpen && (
                <div className="tb-dropdown">
                  <div className="tb-dd-header">
                    <div className="tb-dd-name">{user.fullName || user.email.split('@')[0]}</div>
                    <div className="tb-dd-email">{user.email}</div>
                  </div>
                  <a href="/profile" className="tb-dd-item" onClick={() => setProfileOpen(false)}>
                    <span className="tb-dd-icon">⚙</span> Profile settings
                  </a>
                  <div className="tb-dd-divider" />
                  <button className="tb-dd-item tb-dd-signout" onClick={handleSignOut}>
                    <span className="tb-dd-icon">→</span> Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </header>

        {/* ══ BODY ══ */}
        <div className="app-body">

          {/* Sidebar — nav items only */}
          <aside className={`app-sidebar${sidebarOpen ? ' open' : ''}`}>

            <div className="sb-section-label">
              {currentPortal === 'tenant' ? 'My Portal' : currentPortal === 'landlord' ? 'Landlord' : 'Admin'}
            </div>

            <nav className="sb-nav">
              {navItems.map(item => (
                <a
                  key={item.href}
                  href={item.href}
                  className={`sb-nav-item${isActive(item) ? ' active' : ''}`}
                >
                  <span className="sb-nav-icon">{item.icon}</span>
                  {item.label}
                  {item.href === '/admin/upgrade-requests' && pendingUpgradeCount > 0 && (
                    <span style={{ marginLeft: 'auto', background: '#f59e0b', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px', flexShrink: 0 }}>
                      {pendingUpgradeCount}
                    </span>
                  )}
                  {item.href === '/landlord/payments' && overduePaymentsCount > 0 && (
                    <span style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px', flexShrink: 0 }}>
                      {overduePaymentsCount}
                    </span>
                  )}
                </a>
              ))}
              {/* Landlord portal link for tenants who've been upgraded */}
              {currentPortal === 'tenant' && (role === 'landlord' || role === 'admin') && (
                <a href="/landlord/dashboard" className="sb-nav-item" style={{ borderTop: '1px solid var(--sb-border)', marginTop: '6px', paddingTop: '12px' }}>
                  <span className="sb-nav-icon">→</span>
                  Landlord Portal
                </a>
              )}
            </nav>

            {otherPortals.length > 0 && (
              <div className="sb-portals">
                <div className="sb-section-label" style={{ padding: '0 10px 6px' }}>Switch portal</div>
                {otherPortals.map(p => (
                  <a key={p} href={PORTAL_HREF[p]} className="sb-psw-item">
                    <span className="sb-psw-dot" style={{ background: PSW_DOT[p] }} />
                    <span className="sb-psw-label">{PSW_LABEL[p]}</span>
                    <span className="sb-psw-arrow">{p === 'tenant' ? '←' : '→'}</span>
                  </a>
                ))}
              </div>
            )}
          </aside>

          {/* Main content */}
          <main className="app-main">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <div className="mob-bottom-nav" style={theme as React.CSSProperties}>
        <div className="mob-bottom-inner">
          {navItems.map(item => (
            <a
              key={item.href}
              href={item.href}
              className={`mob-tab${isActive(item) ? ' active' : ''}`}
              style={{ position: 'relative' }}
            >
              <span className="mob-tab-icon">{item.icon}</span>
              <span className="mob-tab-label">{item.label}</span>
              {item.href === '/landlord/payments' && overduePaymentsCount > 0 && (
                <span style={{ position: 'absolute', top: 6, right: '50%', marginRight: -18, background: '#ef4444', color: '#fff', fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '10px', minWidth: 16, textAlign: 'center' }}>
                  {overduePaymentsCount}
                </span>
              )}
            </a>
          ))}
        </div>
      </div>
    </>
  )
}
