'use client'

/** Print affordance for the report sheet — hidden by the report's print CSS. */
export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      style={{
        background: '#0f172a', color: '#34d399', border: 'none', borderRadius: '8px',
        padding: '9px 18px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      Print / Save as PDF
    </button>
  )
}
