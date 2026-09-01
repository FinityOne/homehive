'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase, getCurrentUser } from '@/lib/supabase'
import { usePathname, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import Icon, { type IconName } from '@/components/NavIcons'

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
type NavItem = {
  href: string
  label: string
  icon: IconName
  exact?: boolean
  /** Shown in the mobile bottom bar. Everything else lives behind the menu. */
  primary?: boolean
  /** Shorter label for the bottom bar, where space is tight. */
  short?: string
}
/** A labelled run of nav items. An unlabelled group renders with no heading. */
type NavGroup = { label?: string; items: NavItem[] }

type Notification = {
  id: string
  type: string
  title: string
  body: string | null
  href: string | null
  is_read: boolean
  created_at: string
}

/**
 * Nav is grouped by where the landlord is in the tenancy lifecycle, in the order
 * the work actually happens: fill the property → run the tenancy → close it out.
 * That's the same spine Buildium/AppFolio/DoorLoop use (leasing → residents →
 * accounting → settings), and it means a landlord looking for "who applied" or
 * "who still owes me" only has to scan one short group rather than 13 flat links.
 */
const NAV_GROUPS: Record<'tenant' | 'landlord' | 'admin', NavGroup[]> = {
  tenant: [
    {
      items: [
        { href: '/dashboard',       label: 'Overview',        icon: 'grid',       exact: true, primary: true },
        { href: '/dashboard/lease', label: 'My Lease & Rent', icon: 'home',       primary: true, short: 'Lease' },
        { href: '/homes',           label: 'Browse Homes',    icon: 'search',     primary: true, short: 'Browse' },
        { href: '/groups',          label: 'My Groups',       icon: 'users',      primary: true, short: 'Groups' },
        { href: '/dashboard/list',  label: 'List your place', icon: 'plusCircle', primary: true, short: 'List' },
      ],
    },
  ],
  landlord: [
    {
      items: [
        { href: '/landlord/dashboard', label: 'Overview', icon: 'grid', exact: true, primary: true },
      ],
    },
    {
      // Filling the property — ordered as the funnel runs.
      label: 'Leasing',
      items: [
        { href: '/landlord/listings',          label: 'Listings',         icon: 'building',    primary: true },
        { href: '/landlord/leads',             label: 'Leads',            icon: 'target',      primary: true },
        { href: '/landlord/comments',          label: 'Comments',         icon: 'message' },
        { href: '/landlord/calendar',          label: 'Tours & Calendar', icon: 'calendar',    short: 'Tours' },
        { href: '/landlord/roommates',         label: 'Roommates',        icon: 'users' },
        { href: '/landlord/background-checks', label: 'Screening',        icon: 'shieldCheck' },
      ],
    },
    {
      // Everyone already in place, through to move-out. Leases is the hub —
      // each one owns its own tenants, rent ledger, documents and move-out.
      label: 'Residents',
      items: [
        { href: '/landlord/leases',      label: 'Leases',      icon: 'fileText',       primary: true },
        { href: '/landlord/tenants',     label: 'Tenants',     icon: 'userCheck' },
        { href: '/landlord/financials',  label: 'Financials',  icon: 'creditCard',     primary: true },
        { href: '/landlord/maintenance', label: 'Maintenance', icon: 'wrench' },
        { href: '/landlord/inspections', label: 'Move-out',    icon: 'clipboardCheck' },
      ],
    },
    {
      label: 'Account',
      items: [
        { href: '/landlord/automations',    label: 'Automations',    icon: 'zap' },
        { href: '/landlord/customizations', label: 'Customizations', icon: 'sparkles' },
        { href: '/landlord/billing',        label: 'Plan & Billing', icon: 'receipt' },
      ],
    },
  ],
  admin: [
    {
      items: [
        { href: '/admin', label: 'Overview', icon: 'grid', exact: true, primary: true },
      ],
    },
    {
      label: 'People',
      items: [
        { href: '/admin/users/tenants',   label: 'Tenants',    icon: 'user',   primary: true },
        { href: '/admin/users/landlords', label: 'Landlords',  icon: 'home',   primary: true },
        { href: '/admin/users/admins',    label: 'Admin Team', icon: 'shield' },
      ],
    },
    {
      label: 'Operations',
      items: [
        { href: '/admin/properties',       label: 'Properties',       icon: 'building',      primary: true, short: 'Props' },
        { href: '/admin/leads',            label: 'Leads',            icon: 'target' },
        { href: '/admin/payments',         label: 'Payments',         icon: 'creditCard',    primary: true, short: 'Money' },
        { href: '/admin/upgrade-requests', label: 'Upgrade Requests', icon: 'arrowUpCircle', short: 'Upgrades' },
      ],
    },
    {
      label: 'Growth',
      items: [
        { href: '/admin/marketing', label: 'Marketing', icon: 'megaphone' },
        { href: '/admin/visitors',  label: 'Visitors',  icon: 'eye' },
      ],
    },
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
  /** Desktop: sidebar collapsed to an icon-only rail. Persisted per browser. */
  const [railed, setRailed] = useState(false)
  /** Collapsed nav groups, keyed as `${portal}:${groupLabel}`. Persisted too. */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [pendingUpgradeCount, setPendingUpgradeCount] = useState(0)
  const [overduePaymentsCount, setOverduePaymentsCount] = useState(0)
  const [newUserCounts, setNewUserCounts] = useState<Record<string, number>>({ tenant: 0, landlord: 0, admin: 0 })
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const profileRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  // ── Restore sidebar shape (rail + collapsed groups) ──
  useEffect(() => {
    try {
      setRailed(localStorage.getItem('hh.nav.railed') === '1')
      const raw = localStorage.getItem('hh.nav.collapsedGroups')
      if (raw) setCollapsedGroups(JSON.parse(raw) as Record<string, boolean>)
    } catch { /* private mode / storage disabled — defaults are fine */ }
  }, [])

  const toggleRail = () => {
    setRailed(r => {
      const next = !r
      try { localStorage.setItem('hh.nav.railed', next ? '1' : '0') } catch {}
      return next
    })
  }

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem('hh.nav.collapsedGroups', JSON.stringify(next)) } catch {}
      return next
    })
  }

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
        fetch('/api/admin/users/new-counts')
          .then(r => r.json())
          .then((data: Record<string, number>) => setNewUserCounts(data))
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
    getCurrentUser().then(user => {
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
  const navGroups    = NAV_GROUPS[currentPortal]
  // The bottom bar only fits a handful of tabs; the rest stay in the menu.
  const mobileTabs   = navGroups.flatMap(g => g.items).filter(i => i.primary).slice(0, 5)
  const theme        = THEMES[currentPortal]
  const otherPortals = (['tenant', 'landlord', 'admin'] as const)
    .filter(p => p !== currentPortal && canSeePortals[p])
  const PORTAL_HREF  = { tenant: '/dashboard', landlord: '/landlord/dashboard', admin: '/admin' }

  const isActive = (item: NavItem) =>
    pathname === item.href ||
    (!item.exact && item.href !== '/' && pathname.startsWith(item.href + '/'))

  // Count badges, keyed by the nav item they belong to.
  const badgeFor = (href: string): { count: number; color: string; prefix?: string } | null => {
    if (href === '/admin/upgrade-requests' && pendingUpgradeCount > 0)
      return { count: pendingUpgradeCount, color: '#f59e0b' }
    if (href === '/admin/users/tenants' && newUserCounts['tenant'] > 0)
      return { count: newUserCounts['tenant'], color: '#0f766e', prefix: '+' }
    if (href === '/admin/users/landlords' && newUserCounts['landlord'] > 0)
      return { count: newUserCounts['landlord'], color: '#6b21a8', prefix: '+' }
    if (href === '/admin/users/admins' && newUserCounts['admin'] > 0)
      return { count: newUserCounts['admin'], color: '#1e3a8a', prefix: '+' }
    if (href === '/landlord/financials' && overduePaymentsCount > 0)
      return { count: overduePaymentsCount, color: '#ef4444' }
    return null
  }

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
          position: relative; color: var(--nav-color);
          transition: background 0.15s, color 0.15s;
        }
        .tb-notif-btn:hover { background: var(--nav-hover-bg); color: var(--nav-hover-color); }
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

        /* Desktop sidebar collapse toggle — hidden on mobile, where the
           hamburger already owns this job. */
        .tb-rail-btn {
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 8px; margin-right: 10px;
          background: none; border: none; cursor: pointer;
          color: var(--ham-color); flex-shrink: 0;
          transition: background 0.15s, color 0.15s;
        }
        .tb-rail-btn:hover { background: var(--nav-hover-bg); color: var(--nav-hover-color); }

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
          color: var(--user-sub); transition: transform 0.2s; flex-shrink: 0;
          display: flex; align-items: center;
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
        .tb-dd-icon { display: flex; align-items: center; justify-content: center; width: 16px; flex-shrink: 0; }
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
          width: 232px; flex-shrink: 0;
          background: var(--sb-bg); border-right: 1px solid var(--sb-border);
          display: flex; flex-direction: column;
          position: sticky; top: 56px; height: calc(100vh - 56px); overflow-y: auto;
          overflow-x: hidden;
          transition: width 0.18s ease;
        }
        /* Icon-only rail. Width is the only thing that animates; labels are
           swapped out entirely so they never wrap mid-transition. */
        .app-sidebar.railed { width: 64px; }
        .app-sidebar::-webkit-scrollbar { width: 6px; }
        .app-sidebar::-webkit-scrollbar-thumb { background: var(--divider); border-radius: 3px; }
        .app-sidebar::-webkit-scrollbar-track { background: transparent; }

        .sb-nav { padding: 10px 10px 8px; }

        /* Stage groupings. The heading is the collapse control — a whole-width
           button so the hit target matches what the eye reads as one row. */
        .sb-group { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--divider); }
        .sb-group:first-child { margin-top: 0; padding-top: 0; border-top: none; }
        .sb-group-btn {
          display: flex; align-items: center; gap: 6px; width: 100%;
          background: none; border: none; cursor: pointer;
          padding: 9px 8px 6px; border-radius: 7px;
          font-size: 10px; font-weight: 700; color: var(--user-sub);
          text-transform: uppercase; letter-spacing: 0.9px;
          font-family: 'DM Sans', sans-serif; text-align: left;
          transition: color 0.15s;
        }
        .sb-group-btn:hover { color: var(--nav-hover-color); }
        .sb-group-btn .sb-group-chevron {
          margin-left: auto; opacity: 0.65;
          transition: transform 0.18s ease;
        }
        .sb-group-btn.collapsed .sb-group-chevron { transform: rotate(-90deg); }

        /* Collapsing uses a grid-rows trick so it animates to the content's
           real height without us having to measure anything in JS. */
        .sb-group-items {
          display: grid; grid-template-rows: 1fr;
          transition: grid-template-rows 0.18s ease, opacity 0.18s ease;
        }
        .sb-group-items > div { overflow: hidden; min-height: 0; }
        .sb-group-items.collapsed { grid-template-rows: 0fr; opacity: 0; }

        .sb-nav-item {
          display: flex; align-items: center; gap: 10px; padding: 8px 9px;
          border-radius: 8px; font-size: 13px; font-family: 'DM Sans', sans-serif;
          color: var(--nav-color); text-decoration: none;
          transition: background 0.15s, color 0.15s; margin-bottom: 1px;
          position: relative; white-space: nowrap;
        }
        .sb-nav-item:hover  { background: var(--nav-hover-bg); color: var(--nav-hover-color); }
        .sb-nav-item.active { background: var(--nav-active-bg); color: var(--nav-active-color); font-weight: 600; }
        /* A short bar on the active row — reads as "you are here" at a glance,
           even in the rail where the label is gone. */
        .sb-nav-item.active::before {
          content: ''; position: absolute; left: -10px; top: 50%;
          transform: translateY(-50%);
          width: 3px; height: 18px; border-radius: 0 3px 3px 0;
          background: var(--nav-active-color);
        }
        .sb-nav-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
        .sb-nav-badge {
          margin-left: auto; color: #fff; font-size: 10px; font-weight: 700;
          padding: 1px 6px; border-radius: 10px; flex-shrink: 0;
          font-family: 'DM Sans', sans-serif; line-height: 1.5;
        }

        /* ── RAIL MODE ── */
        .app-sidebar.railed .sb-nav { padding: 10px 8px 8px; }
        .app-sidebar.railed .sb-nav-item { justify-content: center; padding: 9px 0; gap: 0; }
        .app-sidebar.railed .sb-nav-item.active::before { left: -8px; }
        .app-sidebar.railed .sb-nav-label { display: none; }
        .app-sidebar.railed .sb-group-btn { display: none; }
        .app-sidebar.railed .sb-group-items { grid-template-rows: 1fr; opacity: 1; }
        .app-sidebar.railed .sb-group { margin-top: 8px; padding-top: 8px; }
        .app-sidebar.railed .sb-psw-label,
        .app-sidebar.railed .sb-psw-arrow { display: none; }
        .app-sidebar.railed .sb-psw-item { justify-content: center; }
        .app-sidebar.railed .sb-portals-label { display: none; }
        /* Count badges shrink to a dot in the rail — the number has nowhere to go. */
        .app-sidebar.railed .sb-nav-badge {
          position: absolute; top: 5px; right: 9px;
          min-width: 8px; height: 8px; padding: 0; border-radius: 50%;
          font-size: 0; border: 2px solid var(--sb-bg);
        }

        /* Tooltip for rail mode, so an icon is never an unlabelled guess. */
        .sb-tip {
          position: absolute; left: calc(100% + 10px); top: 50%;
          transform: translateY(-50%) translateX(-4px);
          background: var(--dd-bg); color: var(--user-text);
          border: 1px solid var(--tb-border); box-shadow: var(--dd-shadow);
          padding: 5px 9px; border-radius: 6px; font-size: 12px; font-weight: 500;
          font-family: 'DM Sans', sans-serif; white-space: nowrap;
          opacity: 0; pointer-events: none; z-index: 260;
          transition: opacity 0.14s ease, transform 0.14s ease;
        }
        .app-sidebar.railed .sb-nav-item:hover .sb-tip,
        .app-sidebar.railed .sb-psw-item:hover .sb-tip {
          opacity: 1; transform: translateY(-50%) translateX(0);
        }

        .sb-portals {
          margin-top: auto; padding: 10px 10px 16px;
          border-top: 1px solid var(--divider);
        }
        .sb-portals-label {
          font-size: 10px; font-weight: 700; color: var(--user-sub);
          text-transform: uppercase; letter-spacing: 0.9px;
          padding: 2px 8px 6px; font-family: 'DM Sans', sans-serif;
        }
        .sb-psw-item {
          display: flex; align-items: center; gap: 10px; padding: 7px 9px;
          border-radius: 8px; font-size: 12.5px; font-family: 'DM Sans', sans-serif;
          color: var(--nav-color); text-decoration: none;
          transition: background 0.15s, color 0.15s; margin-bottom: 1px;
          position: relative; white-space: nowrap;
        }
        .sb-psw-item:hover { background: var(--psw-hover-bg); color: var(--nav-hover-color); }
        .sb-psw-dot   { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .sb-psw-label { flex: 1; }
        .sb-psw-arrow { opacity: 0.45; display: flex; }

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
        .mob-tab-icon  { display: flex; align-items: center; justify-content: center; height: 19px; }
        .mob-tab-label { font-size: 10px; font-weight: 600; letter-spacing: 0.2px; }

        /* ══════════════════════════════════════════
           RESPONSIVE
        ══════════════════════════════════════════ */
        @media (max-width: 768px) {
          .tb-hamburger   { display: flex; }
          .tb-rail-btn    { display: none; }
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
          /* The mobile drawer is always full-width — the rail is desktop-only. */
          .app-sidebar.open { display: flex; flex-direction: column; }
          .app-sidebar.railed { width: 268px; }
          .app-sidebar.railed .sb-nav-label,
          .app-sidebar.railed .sb-psw-label,
          .app-sidebar.railed .sb-portals-label { display: block; }
          .app-sidebar.railed .sb-group-btn,
          .app-sidebar.railed .sb-psw-arrow { display: flex; }
          .app-sidebar.railed .sb-nav { padding: 10px 10px 8px; }
          .app-sidebar.railed .sb-nav-item { justify-content: flex-start; padding: 8px 9px; gap: 10px; }
          .app-sidebar.railed .sb-nav-item.active::before { left: -10px; }
          .app-sidebar.railed .sb-psw-item { justify-content: flex-start; }
          /* Groups stay collapsible in the drawer, so undo the rail's force-open. */
          .app-sidebar.railed .sb-group-items { grid-template-rows: 1fr; opacity: 1; }
          .app-sidebar.railed .sb-group-items.collapsed { grid-template-rows: 0fr; opacity: 0; }
          .app-sidebar.railed .sb-nav-badge {
            position: static; min-width: 0; height: auto;
            padding: 1px 6px; border-radius: 10px; font-size: 10px; border: none;
          }
          .sb-tip { display: none; }
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

          {/* Desktop: collapse the sidebar to an icon rail */}
          <button
            className="tb-rail-btn"
            onClick={toggleRail}
            aria-label={railed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={railed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Icon name="panelLeft" size={17} />
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
                <Icon name="bell" size={18} />
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
                      const ICON: Record<string, IconName> = { lead_in: 'target', prescreen_filled: 'clipboardCheck', tour_booked: 'calendar' }
                      const DOT: Record<string, string> = { lead_in: '#10b981', prescreen_filled: '#3b82f6', tour_booked: '#f59e0b' }
                      const diff = Date.now() - new Date(n.created_at).getTime()
                      const mins = Math.floor(diff / 60000)
                      const timeAgo = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`
                      const inner = (
                        <>
                          <span className="tb-notif-dot" style={{ background: DOT[n.type] || '#6b6b6b' }} />
                          <div className="tb-notif-content">
                            <div className="tb-notif-title">
                              <Icon name={ICON[n.type] ?? 'dot'} size={13} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 5 }} />
                              {n.title}
                            </div>
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
                <span className={`tb-chevron${profileOpen ? ' open' : ''}`}><Icon name="chevronDown" size={14} strokeWidth={2} /></span>
              </button>

              {profileOpen && (
                <div className="tb-dropdown">
                  <div className="tb-dd-header">
                    <div className="tb-dd-name">{user.fullName || user.email.split('@')[0]}</div>
                    <div className="tb-dd-email">{user.email}</div>
                  </div>
                  <a href="/profile" className="tb-dd-item" onClick={() => setProfileOpen(false)}>
                    <span className="tb-dd-icon"><Icon name="settings" size={15} /></span> Profile settings
                  </a>
                  <div className="tb-dd-divider" />
                  <button className="tb-dd-item tb-dd-signout" onClick={handleSignOut}>
                    <span className="tb-dd-icon"><Icon name="logOut" size={15} /></span> Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </header>

        {/* ══ BODY ══ */}
        <div className="app-body">

          {/* Sidebar — nav items only */}
          <aside className={`app-sidebar${sidebarOpen ? ' open' : ''}${railed ? ' railed' : ''}`}>

            <nav className="sb-nav">
              {navGroups.map((group, gi) => {
                const key = `${currentPortal}:${group.label ?? gi}`
                const collapsed = !!group.label && !!collapsedGroups[key]
                return (
                  <div key={key} className="sb-group">
                    {group.label && (
                      <button
                        type="button"
                        className={`sb-group-btn${collapsed ? ' collapsed' : ''}`}
                        onClick={() => toggleGroup(key)}
                        aria-expanded={!collapsed}
                      >
                        {group.label}
                        <Icon name="chevronDown" size={13} strokeWidth={2.25} className="sb-group-chevron" />
                      </button>
                    )}
                    <div className={`sb-group-items${collapsed ? ' collapsed' : ''}`}>
                      <div>
                        {group.items.map(item => {
                          const badge = badgeFor(item.href)
                          return (
                            <a
                              key={item.href}
                              href={item.href}
                              className={`sb-nav-item${isActive(item) ? ' active' : ''}`}
                              aria-label={item.label}
                              aria-current={isActive(item) ? 'page' : undefined}
                            >
                              <Icon name={item.icon} size={17} />
                              <span className="sb-nav-label">{item.label}</span>
                              {badge && (
                                <span className="sb-nav-badge" style={{ background: badge.color }}>
                                  {badge.prefix ?? ''}{badge.count}
                                </span>
                              )}
                              <span className="sb-tip" aria-hidden="true">{item.label}</span>
                            </a>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
              {/* Landlord portal link for tenants who've been upgraded */}
              {currentPortal === 'tenant' && (role === 'landlord' || role === 'admin') && (
                <a href="/landlord/dashboard" className="sb-nav-item" style={{ borderTop: '1px solid var(--sb-border)', marginTop: '6px', paddingTop: '12px' }}>
                  <Icon name="arrowRight" size={17} />
                  <span className="sb-nav-label">Landlord Portal</span>
                  <span className="sb-tip" aria-hidden="true">Landlord Portal</span>
                </a>
              )}
            </nav>

            {otherPortals.length > 0 && (
              <div className="sb-portals">
                <div className="sb-portals-label">Switch portal</div>
                {otherPortals.map(p => (
                  <a key={p} href={PORTAL_HREF[p]} className="sb-psw-item" aria-label={`${PSW_LABEL[p]} portal`}>
                    <span className="sb-psw-dot" style={{ background: PSW_DOT[p] }} />
                    <span className="sb-psw-label">{PSW_LABEL[p]}</span>
                    <span className="sb-psw-arrow">
                      <Icon name={p === 'tenant' ? 'arrowLeft' : 'arrowRight'} size={13} />
                    </span>
                    <span className="sb-tip" aria-hidden="true">{PSW_LABEL[p]} portal</span>
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

      {/* Mobile bottom tab bar — the few destinations worth a permanent tab.
          Everything else stays one tap away behind the menu button. */}
      <div className="mob-bottom-nav" style={theme as React.CSSProperties}>
        <div className="mob-bottom-inner">
          {mobileTabs.map(item => {
            const badge = badgeFor(item.href)
            return (
              <a
                key={item.href}
                href={item.href}
                className={`mob-tab${isActive(item) ? ' active' : ''}`}
                style={{ position: 'relative' }}
              >
                <span className="mob-tab-icon"><Icon name={item.icon} size={19} /></span>
                <span className="mob-tab-label">{item.short ?? item.label}</span>
                {badge && (
                  <span style={{ position: 'absolute', top: 6, right: '50%', marginRight: -18, background: badge.color, color: '#fff', fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '10px', minWidth: 16, textAlign: 'center' }}>
                    {badge.prefix ?? ''}{badge.count}
                  </span>
                )}
              </a>
            )
          })}
          <button
            className={`mob-tab${sidebarOpen ? ' active' : ''}`}
            onClick={() => setSidebarOpen(o => !o)}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <span className="mob-tab-icon"><Icon name="menu" size={19} /></span>
            <span className="mob-tab-label">More</span>
          </button>
        </div>
      </div>
    </>
  )
}
