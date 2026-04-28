'use client'

import { useState } from 'react'

interface PhoneInputProps {
  value: string
  onChange: (e164: string) => void
  placeholder?: string
  required?: boolean
  borderRadius?: string
  style?: React.CSSProperties
}

/** Strip any formatting and return exactly the 10 local digits (no country code). */
function toDigits(val: string): string {
  const stripped = val.replace(/\D/g, '')
  // Drop leading "1" if 11 digits (E.164 country code)
  const digits = stripped.length === 11 && stripped[0] === '1' ? stripped.slice(1) : stripped
  return digits.slice(0, 10)
}

function formatDisplay(digits: string): string {
  if (!digits) return ''
  if (digits.length <= 3) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

/** Convert raw 10-digit string to E.164 (+1XXXXXXXXXX). */
export function toE164(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 10)
  if (!d) return ''
  const tenDigit = d.length === 11 && d[0] === '1' ? d.slice(1) : d
  return `+1${tenDigit}`
}

/** Format any stored phone value (E.164, formatted, or raw) to (XXX) XXX-XXXX. */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = toDigits(phone)
  if (digits.length !== 10) return phone
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

export default function PhoneInput({
  value,
  onChange,
  placeholder = '(555) 000-0000',
  required,
  borderRadius = '8px',
  style,
}: PhoneInputProps) {
  const [focused, setFocused] = useState(false)
  const displayVal = formatDisplay(toDigits(value))

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 10)
    onChange(raw ? `+1${raw}` : '')
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      border: `1.5px solid ${focused ? '#8C1D40' : '#e8e5de'}`,
      borderRadius,
      overflow: 'hidden',
      background: '#fff',
      transition: 'border-color 0.15s',
      width: '100%',
      ...style,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '0 10px 0 12px',
        height: '44px',
        background: '#f8f7f4',
        borderRight: `1px solid ${focused ? 'rgba(140,29,64,0.3)' : '#e8e5de'}`,
        flexShrink: 0,
        fontSize: '13px',
        fontWeight: 600,
        color: '#4a4a4a',
        userSelect: 'none',
        transition: 'border-color 0.15s',
        whiteSpace: 'nowrap',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        🇺🇸 +1
      </div>
      <input
        type="tel"
        required={required}
        placeholder={placeholder}
        value={displayVal}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          padding: '11px 14px',
          border: 'none',
          outline: 'none',
          fontSize: '14px',
          fontFamily: "'DM Sans', sans-serif",
          background: 'transparent',
          color: '#1a1a1a',
          minWidth: 0,
        }}
      />
    </div>
  )
}
