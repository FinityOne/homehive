'use client'

import '@/styles/brand-tokens.css'
import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

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

const NAV_LINKS = [
  { href: '/homes',         label: 'Browse',      live: true  },
  { href: '/roommates',     label: 'Roommates',   live: false },
  { href: '/how-it-works',  label: 'How it works', live: false },
]

const HOST_LINKS = [
  { href: '/for-landlords', label: 'For hosts',     live: false },
  { href: '/student-guide', label: 'Guides',        live: false },
  { href: '/blog',          label: 'Blog',          live: false },
]

export default function Nav() {
  const [scrolled,     setScrolled]     = useState(false)
  const [mobileOpen,   setMobileOpen]   = useState(false)
  const [profileOpen,  setProfileOpen]  = useState(false)
  const [user, setUser] = useState<{
    email: string; fullName: string; role: string; avatarUrl: string | null
  } | null>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  useEffect(() => {
    const load = async (id: string, email: string, fullName: string) => {
      const { data: p } = await supabase.from('profiles').select('role, avatar_url').eq('id', id).single()
      setUser({ email, fullName, role: p?.role || 'tenant', avatarUrl: p?.avatar_url || null })
    }
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) load(user.id, user.email || '', user.user_metadata?.full_name || '')
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s?.user) load(s.user.id, s.user.email || '', s.user.user_metadata?.full_name || '')
      else setUser(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!profileOpen) return
    const h = () => setProfileOpen(false)
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  }, [profileOpen])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfileOpen(false)
    window.location.href = '/'
  }

  const roleMeta = (role: string) =>
    role === 'admin'    ? { bg: '#f3f0ff', color: '#6d28d9', label: '◈ Admin'    } :
    role === 'landlord' ? { bg: 'rgba(47,74,72,0.08)', color: 'var(--hh-hive-800)', label: '⊞ Host' } :
                          { bg: 'rgba(217,161,74,0.1)', color: 'var(--hh-honey-600)', label: '🎓 Student' }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap');

        /* ─── SHELL ─────────────────────────────────────────────── */
        .nav {
          background: var(--hh-bg);
          border-bottom: 1px solid transparent;
          padding: 0 32px;
          height: 62px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 200;
          font-family: var(--hh-font-ui, 'Geist', sans-serif);
          transition: border-color 0.25s, box-shadow 0.25s;
          gap: 16px;
        }
        .nav.scrolled {
          border-color: var(--hh-border);
          box-shadow: 0 1px 24px rgba(34,40,16,0.07);
        }

        /* ─── LOGO ───────────────────────────────────────────────── */
        .nav-logo {
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
          opacity: 1;
          transition: opacity 0.15s;
        }
        .nav-logo:hover { opacity: 0.75; }
        .nav-logo img { height: 26px; width: auto; display: block; }

        /* ─── CENTER LINKS ───────────────────────────────────────── */
        .nav-center {
          display: flex;
          align-items: center;
          gap: 1px;
          flex: 1;
          padding: 0 4px;
        }
        .nav-link {
          font-size: 14px;
          font-weight: 400;
          color: var(--hh-ink-500);
          text-decoration: none;
          padding: 6px 11px;
          border-radius: 7px;
          transition: color 0.15s, background 0.15s;
          white-space: nowrap;
          letter-spacing: -0.01em;
          display: flex;
          align-items: center;
          gap: 6px;
          line-height: 1;
        }
        .nav-link:hover { color: var(--hh-text); background: var(--hh-bg-alt); }

        .nav-sep {
          width: 1px;
          height: 18px;
          background: var(--hh-border);
          margin: 0 8px;
          flex-shrink: 0;
        }

        /* Live dot on Browse */
        .nav-live-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #22c55e;
          flex-shrink: 0;
          animation: livePulse 2.4s ease-in-out infinite;
        }
        @keyframes livePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.45); opacity: 1; }
          50%       { box-shadow: 0 0 0 4px rgba(34,197,94,0); opacity: 0.65; }
        }

        /* ─── RIGHT ──────────────────────────────────────────────── */
        .nav-right {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }

        /* Season status pill */
        .nav-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: rgba(34,197,94,0.06);
          border: 1px solid rgba(34,197,94,0.16);
          border-radius: 100px;
          padding: 5px 12px;
          font-size: 11px;
          font-weight: 500;
          color: #1a6b3a;
          letter-spacing: 0.01em;
          white-space: nowrap;
          margin-right: 4px;
        }
        .nav-status-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #22c55e;
          flex-shrink: 0;
        }

        /* Sign in */
        .nav-signin {
          font-size: 13px;
          font-weight: 400;
          color: var(--hh-ink-500);
          text-decoration: none;
          padding: 7px 12px;
          border-radius: 7px;
          transition: color 0.15s, background 0.15s;
          white-space: nowrap;
          letter-spacing: -0.01em;
        }
        .nav-signin:hover { color: var(--hh-text); background: var(--hh-bg-alt); }

        /* Primary CTA — fully rounded pill */
        .nav-cta {
          background: var(--hh-ink-900);
          color: #fff;
          font-size: 13px;
          font-weight: 600;
          padding: 9px 20px;
          border-radius: 100px;
          border: none;
          cursor: pointer;
          font-family: var(--hh-font-ui, 'Geist', sans-serif);
          text-decoration: none;
          white-space: nowrap;
          letter-spacing: -0.01em;
          transition: background 0.2s, transform 0.15s;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          line-height: 1;
        }
        .nav-cta:hover  { background: var(--hh-hive-800); transform: translateY(-1px); }
        .nav-cta:active { transform: translateY(0); }

        /* ─── PROFILE AVATAR ─────────────────────────────────────── */
        .profile-wrap { position: relative; margin-right: 2px; }
        .profile-avatar {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: var(--hh-hive-800);
          color: var(--hh-accent);
          font-size: 12px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border: 2px solid var(--hh-border);
          transition: border-color 0.15s, transform 0.15s;
          font-family: var(--hh-font-ui, 'Geist', sans-serif);
          letter-spacing: 0.4px;
          flex-shrink: 0;
          user-select: none;
        }
        .profile-avatar:hover { border-color: var(--hh-primary); transform: scale(1.06); }
        .profile-avatar.open  { border-color: var(--hh-primary); }

        /* ─── DROPDOWN ───────────────────────────────────────────── */
        .profile-dropdown {
          position: absolute;
          top: calc(100% + 10px);
          right: 0;
          background: #fff;
          border: 1px solid var(--hh-border);
          border-radius: 14px;
          box-shadow: 0 16px 48px rgba(34,40,16,0.12), 0 2px 8px rgba(34,40,16,0.06);
          min-width: 246px;
          overflow: hidden;
          animation: dropIn 0.15s ease;
          z-index: 300;
        }
        @keyframes dropIn {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .dropdown-header {
          padding: 14px 16px 13px;
          border-bottom: 1px solid var(--hh-bg-alt);
          background: var(--hh-bg);
        }
        .dropdown-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--hh-text);
          margin-bottom: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: -0.01em;
        }
        .dropdown-email {
          font-size: 11px;
          color: var(--hh-text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 8px;
        }
        .dropdown-role-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          padding: 3px 9px;
          border-radius: 100px;
        }
        .dropdown-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 16px;
          font-size: 13px;
          color: var(--hh-text-2);
          text-decoration: none;
          cursor: pointer;
          transition: background 0.12s;
          border: none;
          background: none;
          width: 100%;
          font-family: var(--hh-font-ui, 'Geist', sans-serif);
          text-align: left;
          letter-spacing: -0.01em;
        }
        .dropdown-item:hover { background: var(--hh-bg); color: var(--hh-text); }
        .dropdown-item .di-icon {
          width: 26px;
          height: 26px;
          border-radius: 7px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          flex-shrink: 0;
        }
        .dropdown-item.danger { color: #c0392b; }
        .dropdown-item.danger:hover { background: rgba(192,57,43,0.05); }
        .dropdown-divider { height: 1px; background: var(--hh-bg-alt); margin: 4px 0; }

        /* ─── MOBILE HAMBURGER ───────────────────────────────────── */
        .ham {
          display: none;
          background: none;
          border: none;
          cursor: pointer;
          padding: 6px;
          flex-direction: column;
          gap: 5px;
          align-items: center;
          width: 36px;
          height: 36px;
          justify-content: center;
        }
        .ham-bar {
          width: 18px;
          height: 1.5px;
          background: var(--hh-text);
          border-radius: 2px;
          transition: all 0.25s;
          transform-origin: center;
        }
        .ham.open .ham-bar:nth-child(1) { transform: translateY(6.5px) rotate(45deg); }
        .ham.open .ham-bar:nth-child(2) { opacity: 0; transform: scaleX(0); }
        .ham.open .ham-bar:nth-child(3) { transform: translateY(-6.5px) rotate(-45deg); }

        /* Mobile CTA in nav bar */
        .mob-cta {
          display: none;
          background: var(--hh-ink-900);
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          padding: 7px 15px;
          border-radius: 100px;
          text-decoration: none;
          font-family: var(--hh-font-ui, 'Geist', sans-serif);
          letter-spacing: -0.01em;
        }

        /* ─── MOBILE DRAWER ──────────────────────────────────────── */
        .mob-drawer {
          position: fixed;
          top: 58px;
          left: 0;
          right: 0;
          bottom: 0;
          background: var(--hh-bg);
          z-index: 190;
          display: flex;
          flex-direction: column;
          transform: translateX(100%);
          transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
          overflow-y: auto;
          font-family: var(--hh-font-ui, 'Geist', sans-serif);
        }
        .mob-drawer.open { transform: translateX(0); }

        /* Status banner inside drawer */
        .mob-status-bar {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 10px 20px;
          font-size: 12px;
          font-weight: 500;
          color: #1a6b3a;
          background: rgba(34,197,94,0.05);
          border-bottom: 1px solid rgba(34,197,94,0.1);
          letter-spacing: 0.01em;
        }
        .mob-status-bar-dot {
          width: 6px; height: 6px; border-radius: 50%; background: #22c55e; flex-shrink: 0;
        }

        .mob-links { flex: 1; }
        .mob-link {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 15px 20px;
          font-size: 16px;
          font-weight: 400;
          color: var(--hh-text);
          text-decoration: none;
          border-bottom: 1px solid var(--hh-border-faint);
          transition: background 0.12s;
          letter-spacing: -0.01em;
        }
        .mob-link:hover { background: var(--hh-bg-alt); }
        .mob-link-inner { display: flex; align-items: center; gap: 10px; }
        .mob-link-chevron { color: var(--hh-ink-300); font-size: 16px; font-weight: 300; }

        .mob-link-label { color: var(--hh-text-muted); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 500; padding: 14px 20px 6px; }

        .mob-bottom {
          padding: 16px 20px 40px;
          border-top: 1px solid var(--hh-border);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .mob-main-cta {
          background: var(--hh-ink-900);
          color: #fff;
          padding: 15px;
          border-radius: 100px;
          text-align: center;
          font-size: 15px;
          font-weight: 600;
          text-decoration: none;
          font-family: var(--hh-font-ui, 'Geist', sans-serif);
          letter-spacing: -0.01em;
        }
        .mob-browse-cta {
          border: 1.5px solid var(--hh-border);
          color: var(--hh-text);
          padding: 14px;
          border-radius: 100px;
          text-align: center;
          font-size: 15px;
          font-weight: 500;
          text-decoration: none;
          font-family: var(--hh-font-ui, 'Geist', sans-serif);
          letter-spacing: -0.01em;
        }
        .mob-user-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px;
          background: var(--hh-bg-alt);
          border-radius: 10px;
          border: 1px solid var(--hh-border);
        }
        .mob-user-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--hh-hive-800);
          color: var(--hh-accent);
          font-size: 13px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .mob-user-name { font-size: 13px; font-weight: 500; color: var(--hh-text); letter-spacing: -0.01em; }
        .mob-user-email { font-size: 11px; color: var(--hh-text-muted); }
        .mob-signout {
          background: none;
          border: 1px solid var(--hh-border);
          border-radius: 100px;
          padding: 12px;
          font-size: 14px;
          font-weight: 500;
          color: var(--hh-text-2);
          cursor: pointer;
          font-family: var(--hh-font-ui, 'Geist', sans-serif);
          text-align: center;
          width: 100%;
          transition: background 0.15s;
        }
        .mob-signout:hover { background: var(--hh-bg-alt); }
        .mob-portal-link {
          display: flex;
          align-items: center;
          gap: 8px;
          text-align: left;
          font-size: 13px;
          color: var(--hh-text-muted);
          text-decoration: none;
          padding: 6px 4px;
          letter-spacing: -0.01em;
        }
        .mob-portal-link:hover { color: var(--hh-text); }
        .mob-signin-link {
          text-align: center;
          font-size: 14px;
          color: var(--hh-text-muted);
          text-decoration: none;
          padding: 10px;
          letter-spacing: -0.01em;
        }

        /* ─── RESPONSIVE ─────────────────────────────────────────── */
        @media (max-width: 860px) {
          .nav { padding: 0 16px; height: 58px; }
          .nav-center, .nav-right { display: none; }
          .mob-cta { display: block; }
          .ham { display: flex; }
        }
        @media (min-width: 861px) {
          .mob-drawer, .mob-cta, .ham { display: none !important; }
        }
      `}</style>

      {/* ── DESKTOP NAV ─────────────────────────────────────────── */}
      <nav className={`nav${scrolled ? ' scrolled' : ''}`}>

        {/* Logo */}
        <a href="/" className="nav-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hh-logo.png" alt="HomeHive" />
        </a>

        {/* Center links */}
        <div className="nav-center">
          {NAV_LINKS.map(({ href, label, live }) => (
            <a key={href} href={href} className="nav-link">
              {label}
              {live && <span className="nav-live-dot" title="New listings" />}
            </a>
          ))}
          <div className="nav-sep" />
          {HOST_LINKS.map(({ href, label }) => (
            <a key={href} href={href} className="nav-link">{label}</a>
          ))}
        </div>

        {/* Right */}
        <div className="nav-right">
          {/* Season status */}
          <div className="nav-status">
            <span className="nav-status-dot" />
            Fall 2026 open
          </div>

          <div className="nav-sep" />

          {/* Auth */}
          {user ? (
            <div className="profile-wrap" onClick={e => { e.stopPropagation(); setProfileOpen(o => !o) }}>
              <div className={`profile-avatar${profileOpen ? ' open' : ''}`} style={{ overflow: 'hidden', padding: 0 }}>
                {user.avatarUrl
                  ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: '50%' }} />
                  : getInitials(user.email, user.fullName)
                }
              </div>

              {profileOpen && (
                <div className="profile-dropdown" onClick={e => e.stopPropagation()}>
                  <div className="dropdown-header">
                    <div className="dropdown-name">{user.fullName || user.email}</div>
                    <div className="dropdown-email">{user.email}</div>
                    {(() => {
                      const m = roleMeta(user.role)
                      return (
                        <span className="dropdown-role-badge" style={{ background: m.bg, color: m.color }}>
                          {m.label}
                        </span>
                      )
                    })()}
                  </div>

                  <a href="/dashboard" className="dropdown-item" target="_blank" rel="noopener noreferrer">
                    <span className="di-icon" style={{ background: 'var(--hh-bg-alt)' }}>🏠</span>
                    My Dashboard
                  </a>
                  {(user.role === 'landlord' || user.role === 'admin') && (
                    <a href="/landlord/dashboard" className="dropdown-item" target="_blank" rel="noopener noreferrer">
                      <span className="di-icon" style={{ background: 'rgba(47,74,72,0.08)' }}>⊞</span>
                      Host Portal
                    </a>
                  )}
                  {user.role === 'admin' && (
                    <a href="/admin" className="dropdown-item" target="_blank" rel="noopener noreferrer">
                      <span className="di-icon" style={{ background: '#f3f0ff' }}>◈</span>
                      Admin Portal
                    </a>
                  )}

                  <div className="dropdown-divider" />

                  <a href="/profile" className="dropdown-item">
                    <span className="di-icon" style={{ background: 'var(--hh-bg-alt)' }}>👤</span>
                    My Profile
                  </a>
                  <button className="dropdown-item danger" onClick={handleSignOut}>
                    <span className="di-icon" style={{ background: 'rgba(192,57,43,0.06)' }}>→</span>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <a href="/login" className="nav-signin">Sign in</a>
          )}

          {/* Primary CTA */}
          <a href="/for-landlords" className="nav-cta">List your place</a>
        </div>

        {/* Mobile: minimal CTA + hamburger */}
        <a href="/homes" className="mob-cta">Browse</a>
        <button
          className={`ham${mobileOpen ? ' open' : ''}`}
          onClick={() => setMobileOpen(o => !o)}
          aria-label="Open menu"
        >
          <span className="ham-bar" />
          <span className="ham-bar" />
          <span className="ham-bar" />
        </button>
      </nav>

      {/* ── MOBILE DRAWER ───────────────────────────────────────── */}
      <div className={`mob-drawer${mobileOpen ? ' open' : ''}`}>

        {/* Status bar */}
        <div className="mob-status-bar">
          <span className="mob-status-bar-dot" />
          Fall 2026 — accepting new listings
        </div>

        {/* Student links */}
        <div className="mob-links">
          <div className="mob-link-label">Explore</div>
          {NAV_LINKS.map(({ href, label, live }) => (
            <a key={href} href={href} className="mob-link" onClick={() => setMobileOpen(false)}>
              <span className="mob-link-inner">
                {label}
                {live && <span className="nav-live-dot" />}
              </span>
              <span className="mob-link-chevron">›</span>
            </a>
          ))}

          <div className="mob-link-label" style={{ marginTop: 8 }}>Hosts & Info</div>
          {HOST_LINKS.map(({ href, label }) => (
            <a key={href} href={href} className="mob-link" onClick={() => setMobileOpen(false)}>
              <span className="mob-link-inner">{label}</span>
              <span className="mob-link-chevron">›</span>
            </a>
          ))}
        </div>

        {/* Bottom actions */}
        <div className="mob-bottom">
          <a href="/for-landlords" className="mob-main-cta" onClick={() => setMobileOpen(false)}>
            List your place →
          </a>
          <a href="/homes" className="mob-browse-cta" onClick={() => setMobileOpen(false)}>
            Browse homes
          </a>

          {user ? (
            <>
              <div className="mob-user-row">
                <div className="mob-user-avatar" style={{ overflow: 'hidden', padding: 0 }}>
                  {user.avatarUrl
                    ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : getInitials(user.email, user.fullName)
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mob-user-name">{user.fullName || user.email}</div>
                  <div className="mob-user-email">{user.email}</div>
                </div>
                {(() => {
                  const m = roleMeta(user.role)
                  return (
                    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.4px', textTransform: 'uppercase', padding: '2px 8px', borderRadius: '100px', flexShrink: 0, background: m.bg, color: m.color }}>
                      {user.role === 'admin' ? 'Admin' : user.role === 'landlord' ? 'Host' : 'Student'}
                    </span>
                  )
                })()}
              </div>

              <a href="/dashboard" className="mob-portal-link" target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)}>🏠 My Dashboard →</a>
              {(user.role === 'landlord' || user.role === 'admin') && (
                <a href="/landlord/dashboard" className="mob-portal-link" target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)}>⊞ Host Portal →</a>
              )}
              {user.role === 'admin' && (
                <a href="/admin" className="mob-portal-link" target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)}>◈ Admin Portal →</a>
              )}
              <a href="/profile" className="mob-portal-link" onClick={() => setMobileOpen(false)}>👤 My Profile →</a>
              <button className="mob-signout" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <a href="/login" className="mob-signin-link" onClick={() => setMobileOpen(false)}>
              Already have an account? Sign in →
            </a>
          )}
        </div>
      </div>
    </>
  )
}
