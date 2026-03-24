'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Loader from '@/components/Loader'

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

export default function Nav() {
  const [showLoader, setShowLoader] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [user, setUser] = useState<{ email: string; fullName: string; role: string } | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)

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
        loadUser(
          user.id,
          user.email || '',
          user.user_metadata?.full_name || '',
        )
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadUser(
          session.user.id,
          session.user.email || '',
          session.user.user_metadata?.full_name || '',
        )
      } else {
        setUser(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!profileOpen) return
    const handler = () => setProfileOpen(false)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [profileOpen])

  const replayLoader = () => {
    sessionStorage.removeItem('hh_loader_seen')
    setShowLoader(true)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfileOpen(false)
    window.location.href = '/'
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,600&family=DM+Sans:wght@300;400;500;600&display=swap');

        .asu-ribbon { background:#8C1D40; border-bottom:3px solid #FFC627; padding:0 32px; font-family:'DM Sans',sans-serif; }
        .asu-ribbon-inner { max-width:1200px; margin:0 auto; height:36px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
        .asu-left { display:flex; align-items:center; gap:10px; flex-shrink:0; }
        .asu-fork { color:#FFC627; font-size:13px; }
        .asu-title { font-size:11px; font-weight:700; letter-spacing:.9px; text-transform:uppercase; color:#fff; }
        .asu-div { width:1px; height:13px; background:rgba(255,255,255,.25); }
        .asu-sub { font-size:11px; color:rgba(255,255,255,.65); white-space:nowrap; }
        .asu-right { display:flex; align-items:center; gap:12px; }
        .asu-pill { background:#FFC627; color:#8C1D40; font-size:10px; font-weight:700; letter-spacing:.4px; padding:2px 9px; border-radius:20px; white-space:nowrap; }
        .asu-rlink { font-size:11px; color:rgba(255,255,255,.75); text-decoration:none; font-weight:500; }
        .asu-rlink:hover { color:#FFC627; }
        .play-btn { width:24px; height:24px; border-radius:50%; border:1.5px solid rgba(255,255,255,.3); background:rgba(255,255,255,.08); display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0; }
        .play-btn:hover { background:rgba(255,198,39,.2); border-color:#FFC627; }
        .play-tri { width:0; height:0; border-top:5px solid transparent; border-bottom:5px solid transparent; border-left:8px solid rgba(255,255,255,.8); margin-left:2px; }
        .play-btn:hover .play-tri { border-left-color:#FFC627; }
        .play-tip { font-size:10px; color:rgba(255,255,255,.5); white-space:nowrap; }

        .nav { background:#fff; border-bottom:1px solid #e8e4db; padding:0 32px; height:58px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:200; font-family:'DM Sans',sans-serif; transition:box-shadow .2s; }
        .nav.scrolled { box-shadow:0 2px 20px rgba(0,0,0,.07); }
        .nav-logo { font-family:'DM Sans',sans-serif; font-size:19px; font-weight:600; color:#1a1a1a; text-decoration:none; letter-spacing:-.3px; }
        .nav-logo em { font-family:'Fraunces',serif; font-style:italic; color:#FFC627; }
        .nav-center { display:flex; align-items:center; gap:4px; }
        .nav-link { font-size:13px; color:#6b6b6b; text-decoration:none; padding:6px 12px; border-radius:6px; transition:color .15s,background .15s; white-space:nowrap; display:flex; align-items:center; gap:6px; }
        .nav-link:hover { color:#1a1a1a; background:#f5f4f0; }
        .pill-hot { background:#FFC627; color:#8C1D40; font-size:9px; font-weight:700; letter-spacing:.5px; padding:1px 5px; border-radius:4px; text-transform:uppercase; }
        .pill-new { background:#8C1D40; color:#fff; font-size:9px; font-weight:700; letter-spacing:.5px; padding:1px 5px; border-radius:4px; text-transform:uppercase; }
        .nav-sep { width:1px; height:20px; background:#e8e4db; margin:0 6px; }
        .nav-right { display:flex; align-items:center; gap:8px; }
        .nav-signin { font-size:13px; color:#6b6b6b; text-decoration:none; padding:6px 14px; border-radius:6px; transition:color .15s,background .15s; }
        .nav-signin:hover { color:#1a1a1a; background:#f5f4f0; }
        .nav-cta { background:#8C1D40; color:#fff; font-size:13px; font-weight:600; padding:8px 18px; border-radius:7px; border:none; cursor:pointer; font-family:'DM Sans',sans-serif; text-decoration:none; white-space:nowrap; transition:background .2s; display:flex; align-items:center; gap:6px; }
        .nav-cta:hover { background:#7a1835; }
        .cta-dot { width:6px; height:6px; border-radius:50%; background:#FFC627; animation:blink 2s infinite; }
        @keyframes blink { 0%,100%{opacity:1}50%{opacity:.4} }

        /* PROFILE AVATAR + DROPDOWN */
        .profile-wrap { position:relative; }
        .profile-avatar { width:34px; height:34px; border-radius:50%; background:#8C1D40; color:#FFC627; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; cursor:pointer; border:2px solid #e8e4db; transition:border-color .15s,transform .15s; font-family:'DM Sans',sans-serif; letter-spacing:0.3px; flex-shrink:0; user-select:none; }
        .profile-avatar:hover { border-color:#8C1D40; transform:scale(1.05); }
        .profile-avatar.open { border-color:#8C1D40; }
        .profile-dropdown { position:absolute; top:calc(100% + 10px); right:0; background:#fff; border:1px solid #e8e4db; border-radius:14px; box-shadow:0 12px 40px rgba(0,0,0,0.13); min-width:240px; overflow:hidden; animation:dropIn .15s ease; z-index:300; }
        @keyframes dropIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        .dropdown-header { padding:14px 16px 12px; border-bottom:1px solid #f0ede6; }
        .dropdown-name { font-size:13px; font-weight:600; color:#1a1a1a; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .dropdown-email { font-size:11px; color:#9b9b9b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:6px; }
        .dropdown-role-badge { display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:700; letter-spacing:.4px; text-transform:uppercase; padding:2px 8px; border-radius:20px; }
        .dropdown-section-label { font-size:10px; font-weight:600; letter-spacing:.7px; text-transform:uppercase; color:#c5c1b8; padding:8px 16px 4px; }
        .dropdown-item { display:flex; align-items:center; gap:10px; padding:10px 16px; font-size:13px; color:#3a3a3a; text-decoration:none; cursor:pointer; transition:background .15s; border:none; background:none; width:100%; font-family:'DM Sans',sans-serif; text-align:left; }
        .dropdown-item:hover { background:#faf9f6; color:#1a1a1a; }
        .dropdown-item .di-icon { width:26px; height:26px; border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:13px; flex-shrink:0; }
        .dropdown-item.danger { color:#8C1D40; }
        .dropdown-item.danger:hover { background:#fdf2f5; }
        .dropdown-divider { height:1px; background:#f0ede6; margin:4px 0; }

        .mob-cta { display:none; background:#8C1D40; color:#fff; font-size:13px; font-weight:600; padding:8px 16px; border-radius:7px; text-decoration:none; font-family:'DM Sans',sans-serif; }
        .ham { display:none; background:none; border:none; cursor:pointer; padding:6px; flex-direction:column; gap:5px; align-items:center; width:36px; height:36px; justify-content:center; }
        .ham-bar { width:20px; height:2px; background:#1a1a1a; border-radius:2px; transition:all .25s; transform-origin:center; }
        .ham.open .ham-bar:nth-child(1) { transform:translateY(7px) rotate(45deg); }
        .ham.open .ham-bar:nth-child(2) { opacity:0; transform:scaleX(0); }
        .ham.open .ham-bar:nth-child(3) { transform:translateY(-7px) rotate(-45deg); }

        .mob-drawer { position:fixed; top:58px; left:0; right:0; bottom:0; background:#fff; z-index:190; display:flex; flex-direction:column; transform:translateX(100%); transition:transform .3s cubic-bezier(.22,1,.36,1); overflow-y:auto; font-family:'DM Sans',sans-serif; }
        .mob-drawer.open { transform:translateX(0); }
        .mob-asu { background:#8C1D40; border-bottom:2px solid #FFC627; padding:10px 20px; display:flex; align-items:center; justify-content:space-between; }
        .mob-asu-label { font-size:11px; font-weight:700; letter-spacing:.8px; text-transform:uppercase; color:#fff; }
        .mob-asu-pill { background:#FFC627; color:#8C1D40; font-size:10px; font-weight:700; padding:2px 8px; border-radius:20px; }
        .mob-links { padding:8px 0; flex:1; }
        .mob-link { display:flex; align-items:center; justify-content:space-between; padding:15px 20px; font-size:16px; color:#1a1a1a; text-decoration:none; border-bottom:1px solid #f5f4f0; transition:background .15s; }
        .mob-link:hover { background:#faf9f6; }
        .mob-link-inner { display:flex; align-items:center; gap:10px; }
        .mob-bottom { padding:16px 20px 40px; border-top:1px solid #f0ede6; display:flex; flex-direction:column; gap:10px; }
        .mob-replay { display:flex; align-items:center; gap:10px; padding:12px 14px; border-radius:9px; border:1px solid #e8e4db; cursor:pointer; background:#faf9f6; }
        .mob-replay-circle { width:30px; height:30px; border-radius:50%; background:#8C1D40; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .mob-replay-tri { width:0; height:0; border-top:5px solid transparent; border-bottom:5px solid transparent; border-left:8px solid #fff; margin-left:2px; }
        .mob-replay-title { font-size:13px; font-weight:500; color:#1a1a1a; }
        .mob-replay-sub { font-size:11px; color:#9b9b9b; }
        .mob-main-cta { background:#8C1D40; color:#fff; padding:15px; border-radius:9px; text-align:center; font-size:15px; font-weight:600; text-decoration:none; font-family:'DM Sans',sans-serif; }
        .mob-user-row { display:flex; align-items:center; gap:10px; padding:14px; background:#faf9f6; border-radius:9px; border:1px solid #e8e4db; }
        .mob-user-avatar { width:36px; height:36px; border-radius:50%; background:#8C1D40; color:#FFC627; font-size:13px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .mob-user-name { font-size:13px; font-weight:500; color:#1a1a1a; }
        .mob-user-email { font-size:11px; color:#9b9b9b; }
        .mob-signout { background:none; border:1px solid #e8e4db; border-radius:8px; padding:12px; font-size:14px; font-weight:500; color:#8C1D40; cursor:pointer; font-family:'DM Sans',sans-serif; text-align:center; width:100%; }
        .mob-signin-link { text-align:center; font-size:14px; color:#9b9b9b; text-decoration:none; padding:10px; }

        @media (max-width:860px) {
          .asu-ribbon { display:none; }
          .nav { padding:0 16px; }
          .nav-center,.nav-right { display:none; }
          .mob-cta { display:block; }
          .ham { display:flex; }
        }
        @media (min-width:861px) {
          .mob-drawer,.mob-cta,.ham { display:none !important; }
        }
      `}</style>

      {showLoader && <Loader onComplete={() => setShowLoader(false)} />}

      {/* ASU RIBBON */}
      <div className="asu-ribbon">
        <div className="asu-ribbon-inner">
          <div className="asu-left">
            <span className="asu-fork">⚡</span>
            <span className="asu-title">ASU Off-Campus Housing</span>
            <span className="asu-div" />
            <span className="asu-sub">Verified homes for Sun Devils in Tempe</span>
          </div>
          <div className="asu-right">
            <a href="/student-guide" className="asu-rlink">Student Guide</a>
            <span className="asu-pill">Fall 2026 open</span>
            <button className="play-btn" onClick={replayLoader} title="Replay intro">
              <span className="play-tri" />
            </button>
            <span className="play-tip">replay</span>
          </div>
        </div>
      </div>

      {/* PRIMARY NAV */}
      <nav className={`nav${scrolled ? ' scrolled' : ''}`}>
        <a href="/" className="nav-logo">Home<em>Hive</em></a>

        <div className="nav-center">
          <a href="/homes" className="nav-link">Homes <span className="pill-hot">2 open</span></a>
          <a href="/roommates" className="nav-link">Roommates <span className="pill-new">new</span></a>
          <a href="/how-it-works" className="nav-link">How it works</a>
          <div className="nav-sep" />
          <a href="/pricing" className="nav-link">Pricing</a>
          <a href="/student-guide" className="nav-link">Student Guide</a>
        </div>

        <div className="nav-right">
          {user ? (
            <div className="profile-wrap" onClick={e => { e.stopPropagation(); setProfileOpen(o => !o) }}>
              <div className={`profile-avatar${profileOpen ? ' open' : ''}`}>
                {getInitials(user.email, user.fullName)}
              </div>
              {profileOpen && (
                <div className="profile-dropdown" onClick={e => e.stopPropagation()}>
                  {/* Header */}
                  <div className="dropdown-header">
                    <div className="dropdown-name">{user.fullName || user.email}</div>
                    <div className="dropdown-email">{user.email}</div>
                    <span className="dropdown-role-badge" style={
                      user.role === 'admin'    ? { background:'#f3f0ff', color:'#6d28d9' } :
                      user.role === 'landlord' ? { background:'#f0fdf4', color:'#065f46' } :
                                                 { background:'#fdf2f5', color:'#8C1D40' }
                    }>
                      { user.role === 'admin' ? '◈ Admin' : user.role === 'landlord' ? '⊞ Landlord' : '🎓 Student' }
                    </span>
                  </div>

                  {/* Tenant links — every role gets these */}
                  <div className="dropdown-section-label">For you</div>
                  <a href="/dashboard" className="dropdown-item">
                    <span className="di-icon" style={{ background:'#fdf2f5' }}>🏠</span> My Dashboard
                  </a>
                  <a href="/homes" className="dropdown-item">
                    <span className="di-icon" style={{ background:'#faf9f6' }}>🔍</span> Browse Homes
                  </a>

                  {/* Landlord links */}
                  {(user.role === 'landlord' || user.role === 'admin') && (
                    <>
                      <div className="dropdown-divider" />
                      <div className="dropdown-section-label">Landlord</div>
                      <a href="/landlord/dashboard" className="dropdown-item">
                        <span className="di-icon" style={{ background:'#f0fdf4' }}>⊞</span> Landlord Portal
                      </a>
                      <a href="/landlord/listings" className="dropdown-item">
                        <span className="di-icon" style={{ background:'#f0fdf4' }}>▣</span> My Listings
                      </a>
                      <a href="/landlord/leads" className="dropdown-item">
                        <span className="di-icon" style={{ background:'#f0fdf4' }}>◉</span> Leads
                      </a>
                    </>
                  )}

                  {/* Admin links */}
                  {user.role === 'admin' && (
                    <>
                      <div className="dropdown-divider" />
                      <div className="dropdown-section-label">Admin</div>
                      <a href="/admin" className="dropdown-item">
                        <span className="di-icon" style={{ background:'#f3f0ff' }}>◈</span> All Leads
                      </a>
                    </>
                  )}

                  {/* Account */}
                  <div className="dropdown-divider" />
                  <a href="/profile" className="dropdown-item">
                    <span className="di-icon" style={{ background:'#f5f4f0' }}>👤</span> My Profile
                  </a>
                  <button className="dropdown-item danger" onClick={handleSignOut}>
                    <span className="di-icon" style={{ background:'#fdf2f5' }}>→</span> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <a href="/login" className="nav-signin">Sign in</a>
          )}
          <a href="/homes" className="nav-cta"><span className="cta-dot" />View homes</a>
        </div>

        <a href="/homes" className="mob-cta">View homes</a>
        <button className={`ham${mobileOpen ? ' open' : ''}`} onClick={() => setMobileOpen(o => !o)} aria-label="Menu">
          <span className="ham-bar" /><span className="ham-bar" /><span className="ham-bar" />
        </button>
      </nav>

      {/* MOBILE DRAWER */}
      <div className={`mob-drawer${mobileOpen ? ' open' : ''}`}>
        <div className="mob-asu">
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span style={{ color: '#FFC627', fontSize: '12px' }}>⚡</span>
            <span className="mob-asu-label">ASU Off-Campus Housing</span>
          </div>
          <span className="mob-asu-pill">Fall 2026 open</span>
        </div>

        <div className="mob-links">
          {[
            { href: '/homes',         label: 'Homes',         pill: '2 open', pt: 'hot' },
            { href: '/roommates',     label: 'Roommates',     pill: 'new',    pt: 'new' },
            { href: '/how-it-works',  label: 'How it works',  pill: null,     pt: null  },
            { href: '/pricing',       label: 'Pricing',       pill: null,     pt: null  },
            { href: '/student-guide', label: 'Student Guide', pill: null,     pt: null  },
          ].map(({ href, label, pill, pt }) => (
            <a key={href} href={href} className="mob-link" onClick={() => setMobileOpen(false)}>
              <span className="mob-link-inner">
                {label}
                {pill && <span className={pt === 'hot' ? 'pill-hot' : 'pill-new'}>{pill}</span>}
              </span>
              <span style={{ color: '#ccc', fontSize: '18px' }}>›</span>
            </a>
          ))}
        </div>

        <div className="mob-bottom">
          <div className="mob-replay" role="button" tabIndex={0}
            onClick={() => { setMobileOpen(false); replayLoader() }}
            onKeyDown={e => e.key === 'Enter' && replayLoader()}>
            <div className="mob-replay-circle"><span className="mob-replay-tri" /></div>
            <div>
              <div className="mob-replay-title">Watch the intro</div>
              <div className="mob-replay-sub">See what HomeHive is all about</div>
            </div>
          </div>

          <a href="/homes" className="mob-main-cta" onClick={() => setMobileOpen(false)}>
            View available homes →
          </a>

          {user ? (
            <>
              <div className="mob-user-row">
                <div className="mob-user-avatar">{getInitials(user.email, user.fullName)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mob-user-name">{user.fullName || user.email}</div>
                  <div className="mob-user-email">{user.email}</div>
                </div>
                <span style={{
                  fontSize: '10px', fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase',
                  padding: '2px 8px', borderRadius: '20px', flexShrink: 0,
                  ...(user.role === 'admin'    ? { background:'#f3f0ff', color:'#6d28d9' } :
                      user.role === 'landlord' ? { background:'#f0fdf4', color:'#065f46' } :
                                                 { background:'#fdf2f5', color:'#8C1D40' })
                }}>
                  {user.role === 'admin' ? 'Admin' : user.role === 'landlord' ? 'Landlord' : 'Student'}
                </span>
              </div>

              {/* Tenant — always shown */}
              <a href="/dashboard"  className="mob-signin-link" onClick={() => setMobileOpen(false)}>🏠 My Dashboard →</a>

              {/* Landlord */}
              {(user.role === 'landlord' || user.role === 'admin') && (
                <>
                  <a href="/landlord/dashboard" className="mob-signin-link" onClick={() => setMobileOpen(false)}>⊞ Landlord Portal →</a>
                  <a href="/landlord/leads"     className="mob-signin-link" onClick={() => setMobileOpen(false)}>◉ Leads →</a>
                </>
              )}

              {/* Admin */}
              {user.role === 'admin' && (
                <a href="/admin" className="mob-signin-link" onClick={() => setMobileOpen(false)}>◈ All Leads →</a>
              )}

              <a href="/profile" className="mob-signin-link" onClick={() => setMobileOpen(false)}>👤 My Profile →</a>
              <button className="mob-signout" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <a href="/login" className="mob-signin-link" onClick={() => setMobileOpen(false)}>
              Already have an account? Sign in
            </a>
          )}
        </div>
      </div>
    </>
  )
}
