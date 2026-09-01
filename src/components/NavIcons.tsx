/**
 * A small, dependency-free icon set for the app shell.
 *
 * Every glyph is a 24×24 stroked path drawn on the same grid with the same
 * 1.75 stroke weight and round caps, so a row of them reads as one family —
 * which is the thing emoji could never do, since each one carried its own
 * colour, weight and vertical rhythm.
 *
 * Icons inherit `currentColor` and size from the `size` prop, so nav states
 * (idle / hover / active) are driven entirely by the parent's colour.
 */
export type IconName =
  | 'grid' | 'home' | 'building' | 'search' | 'users' | 'user' | 'userCheck'
  | 'plusCircle' | 'message' | 'target' | 'calendar' | 'shieldCheck' | 'shield'
  | 'fileText' | 'creditCard' | 'wrench' | 'clipboardCheck' | 'zap' | 'sparkles'
  | 'receipt' | 'arrowUpCircle' | 'megaphone' | 'eye' | 'bell' | 'settings'
  | 'logOut' | 'menu' | 'chevronDown' | 'chevronRight' | 'arrowRight'
  | 'arrowLeft' | 'panelLeft' | 'swap' | 'dot'

const PATHS: Record<IconName, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>,
  home: <><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9.5V20h13V9.5" /><path d="M9.75 20v-5.5h4.5V20" /></>,
  building: <><rect x="4" y="3.5" width="16" height="17" rx="2" /><path d="M8.5 8h2M13.5 8h2M8.5 12h2M13.5 12h2" /><path d="M10 20.5v-4h4v4" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 20.5 20.5" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16.5 4.8a3.5 3.5 0 0 1 0 6.4" /><path d="M18 14.4c2.1.7 3.5 2.5 3.5 5.6" /></>,
  user: <><circle cx="12" cy="8" r="3.75" /><path d="M4.5 20c0-3.7 3.2-6.25 7.5-6.25S19.5 16.3 19.5 20" /></>,
  userCheck: <><circle cx="10" cy="8" r="3.75" /><path d="M3 20c0-3.7 3.1-6.25 7-6.25 1.2 0 2.3.2 3.3.6" /><path d="m15.5 17.5 2 2 4-4.5" /></>,
  plusCircle: <><circle cx="12" cy="12" r="8.5" /><path d="M12 8.5v7M8.5 12h7" /></>,
  message: <><path d="M20.5 12.5a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.4-5.4A7.5 7.5 0 1 1 20.5 12.5Z" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.75h17" /><path d="M8 3.5v3M16 3.5v3" /></>,
  shieldCheck: <><path d="M12 3.25 19 6v6c0 4.2-2.9 7.3-7 8.75-4.1-1.45-7-4.55-7-8.75V6Z" /><path d="m9 12 2.25 2.25L15.25 10" /></>,
  shield: <><path d="M12 3.25 19 6v6c0 4.2-2.9 7.3-7 8.75-4.1-1.45-7-4.55-7-8.75V6Z" /></>,
  fileText: <><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z" /><path d="M14 3.5v5h5" /><path d="M8.75 13h6.5M8.75 16.5h4.5" /></>,
  creditCard: <><rect x="2.75" y="5" width="18.5" height="14" rx="2.25" /><path d="M2.75 9.75h18.5" /><path d="M6.5 15h3" /></>,
  wrench: <><path d="M15.2 3.6a5.5 5.5 0 0 0-6.6 7.1L3.6 15.7a2 2 0 0 0 2.8 2.8l5-5a5.5 5.5 0 0 0 7.1-6.6l-3 3-2.4-2.4Z" /></>,
  clipboardCheck: <><rect x="5" y="4.75" width="14" height="15.75" rx="2" /><path d="M9 4.75a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.75v1.5H9Z" /><path d="m9.25 13.5 2 2 3.5-4" /></>,
  zap: <><path d="M13.5 2.5 5 13.5h6l-.5 8 8.5-11h-6Z" /></>,
  sparkles: <><path d="m12 3.5 1.9 4.85L18.75 10.25 13.9 12.15 12 17l-1.9-4.85L5.25 10.25 10.1 8.35Z" /><path d="m18.5 15.5.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z" /></>,
  receipt: <><path d="M5.5 3.5h13v17l-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5-2.3-1.5Z" /><path d="M9 8h6M9 11.75h6M9 15.5h3.5" /></>,
  arrowUpCircle: <><circle cx="12" cy="12" r="8.5" /><path d="M12 15.75v-7.5" /><path d="m8.75 11.5 3.25-3.25 3.25 3.25" /></>,
  megaphone: <><path d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H8l8 4.5V5.5L8 10H5.5A1.5 1.5 0 0 0 4 11.5Z" /><path d="M19 9.75a3.5 3.5 0 0 1 0 4.5" /><path d="M8 15.5v4.25" /></>,
  eye: <><path d="M2.5 12S6 5.75 12 5.75 21.5 12 21.5 12 18 18.25 12 18.25 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></>,
  bell: <><path d="M18 9.5a6 6 0 1 0-12 0c0 4-1.5 5.5-1.5 5.5h15S18 13.5 18 9.5Z" /><path d="M10.25 18.5a2 2 0 0 0 3.5 0" /></>,
  settings: <><circle cx="12" cy="12" r="3.25" /><path d="M12 2.75h0a1.6 1.6 0 0 1 1.6 1.6v.5a1.6 1.6 0 0 0 2.42 1.4l.43-.25a1.6 1.6 0 0 1 2.19.59l.35.6a1.6 1.6 0 0 1-.59 2.19l-.43.25a1.6 1.6 0 0 0 0 2.77l.43.25a1.6 1.6 0 0 1 .59 2.19l-.35.6a1.6 1.6 0 0 1-2.19.59l-.43-.25a1.6 1.6 0 0 0-2.42 1.4v.5a1.6 1.6 0 0 1-1.6 1.6h-.7a1.6 1.6 0 0 1-1.6-1.6v-.5a1.6 1.6 0 0 0-2.42-1.4l-.43.25a1.6 1.6 0 0 1-2.19-.59l-.35-.6a1.6 1.6 0 0 1 .59-2.19l.43-.25a1.6 1.6 0 0 0 0-2.77l-.43-.25a1.6 1.6 0 0 1-.59-2.19l.35-.6a1.6 1.6 0 0 1 2.19-.59l.43.25a1.6 1.6 0 0 0 2.42-1.4v-.5a1.6 1.6 0 0 1 1.6-1.6Z" /></>,
  logOut: <><path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5" /><path d="m15.5 16.5 4.5-4.5-4.5-4.5" /><path d="M20 12H9" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  chevronDown: <><path d="m6.5 9.5 5.5 5.5 5.5-5.5" /></>,
  chevronRight: <><path d="m9.5 6.5 5.5 5.5-5.5 5.5" /></>,
  arrowRight: <><path d="M4.5 12h15" /><path d="m14 6.5 5.5 5.5-5.5 5.5" /></>,
  arrowLeft: <><path d="M19.5 12h-15" /><path d="m10 6.5-5.5 5.5 5.5 5.5" /></>,
  panelLeft: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M9.75 4v16" /></>,
  swap: <><path d="M4.5 8.5h12M13 5l3.5 3.5L13 12" /><path d="M19.5 15.5h-12M11 12l-3.5 3.5L11 19" /></>,
  dot: <><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></>,
}

export default function Icon({
  name, size = 18, strokeWidth = 1.75, style, className,
}: {
  name: IconName
  size?: number
  strokeWidth?: number
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} className={className}
      fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      {PATHS[name]}
    </svg>
  )
}
