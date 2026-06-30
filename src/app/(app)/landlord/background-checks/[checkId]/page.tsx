'use client'
import { getSiteUrl } from '@/lib/siteUrl'

import { useState, useEffect, use, Fragment } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import { formatPhoneDisplay } from '@/components/ui/PhoneInput'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type Lead = {
  id: string; first_name: string | null; last_name: string | null
  email: string; phone: string | null; property: string | null
  status: string | null; move_in_date: string | null; created_at: string | null
}

type RefResponse = {
  question: string
  answer: string
  detail?: string
}

type Reference = {
  id: string; bg_check_id: string; type: 'employer' | 'residence'
  name: string | null; manager_name: string | null
  phone: string | null; email: string | null
  address: string | null; contact_date: string | null
  status: 'pending' | 'contacted' | 'verified' | 'unverified'
  notes: string | null; income_monthly: number | null
  public_token: string; responses: RefResponse[] | null; created_at: string
}

type EmailLog = {
  id: string; bg_check_id: string; ref_id: string | null
  ref_type: 'employer' | 'residence' | 'applicant' | 'cosigner' | null
  recipient: string; recipient_name: string | null; subject: string | null
  status: 'sent' | 'failed'; error: string | null
  sent_by: string | null; sent_at: string
}

type BgStatus = 'initiated' | 'pending_verification' | 'conditionally_approved' | 'approved' | 'declined'

// Ordered happy-path used by the flow graphic. `declined` is an off-path
// terminal state, and the final "Tenant Created" node is derived from tenant_id.
const STATUS_FLOW: { key: BgStatus; label: string; short: string }[] = [
  { key: 'initiated',              label: 'Initiated',              short: 'Started' },
  { key: 'pending_verification',   label: 'Pending Verification',   short: 'Verifying' },
  { key: 'conditionally_approved', label: 'Conditionally Approved', short: 'Conditional' },
  { key: 'approved',               label: 'Approved',               short: 'Approved' },
]

const STATUS_INDEX: Record<BgStatus, number> = {
  initiated: 0, pending_verification: 1, conditionally_approved: 2, approved: 3, declined: -1,
}

type CosignerSummary = {
  id: string
  subject_first_name: string | null; subject_last_name: string | null
  subject_email: string | null; subject_phone: string | null
  cosigner_relationship: string | null
  status: BgStatus; decision: 'passed' | 'failed' | null; tenant_id: string | null
  credit: 'great' | 'average' | 'poor' | null; credit_score: number | null
  criminal_check: 'clear' | 'not_clear' | null; eviction_check: 'clear' | 'not_clear' | null
  employment_check: 'clear' | 'not_clear' | null; current_residence_check: 'clear' | 'not_clear' | null
  income_monthly: number | null; welcome_email_sent_at: string | null; created_at: string
}

type CosignerContext = {
  primary_check_id: string
  primary_lead_id: string | null
  primary_name: string
  primary_tenant_id: string | null
  relationship: string | null
}

type BgCheck = {
  id: string; lead_id: string | null; landlord_id: string
  is_student: boolean | null
  cosigner: 'yes' | 'no' | 'pending' | 'need_cosigner' | null
  credit: 'great' | 'average' | 'poor' | null
  credit_score: number | null
  employment_check: 'clear' | 'not_clear' | null
  current_residence_check: 'clear' | 'not_clear' | null
  criminal_check: 'clear' | 'not_clear' | null
  eviction_check: 'clear' | 'not_clear' | null
  notes: string | null
  decision: 'passed' | 'failed' | null
  status: BgStatus
  tenant_id: string | null
  // co-signer + income
  is_cosigner: boolean
  cosigner_for_check_id: string | null
  cosigner_relationship: string | null
  income_monthly: number | null
  property_rent: number | null
  cosigner_context: CosignerContext | null
  cosigners: CosignerSummary[] | null
  created_at: string; updated_at: string
  leads: Lead | null
  bg_check_references: Reference[]
  bg_check_emails: EmailLog[]
}

// ── Scoring ───────────────────────────────────────────────────────────────────
function computeScore(f: {
  criminal_check: string | null; eviction_check: string | null
  employment_check: string | null; current_residence_check: string | null
  credit: string | null; credit_score: number | null
}): { score: number; tier: 'good' | 'medium' | 'high'; label: string; color: string; bg: string } {
  const pts = (val: string | null, full: number) =>
    val === 'clear' ? full : val === 'not_clear' ? 0 : 0

  let creditPts = 0
  if (f.credit_score) {
    creditPts = f.credit_score >= 750 ? 10 : f.credit_score >= 700 ? 8 : f.credit_score >= 650 ? 6 : f.credit_score >= 600 ? 4 : 2
  } else if (f.credit === 'great') creditPts = 10
  else if (f.credit === 'average') creditPts = 6
  else if (f.credit === 'poor') creditPts = 2

  const score = pts(f.criminal_check, 30) + pts(f.eviction_check, 25) + pts(f.employment_check, 20) + pts(f.current_residence_check, 15) + creditPts

  if (score >= 80) return { score, tier: 'good',   label: 'Good to Go',   color: '#10b981', bg: 'rgba(16,185,129,0.08)' }
  if (score >= 60) return { score, tier: 'medium', label: 'Medium Risk',  color: '#f97316', bg: 'rgba(249,115,22,0.08)' }
  return               { score, tier: 'high',   label: 'High Risk',    color: '#ef4444', bg: 'rgba(239,68,68,0.07)' }
}

// Co-signer scoring weights what matters most for a guarantor: credit and
// income carry the most weight, then criminal + eviction history. Employment is
// a minor factor and residence history is not scored (they won't live there).
// Total = 100: Credit 30 · Income 30 · Criminal 20 · Eviction 15 · Employment 5.
function computeCosignerScore(f: {
  criminal_check: string | null; eviction_check: string | null
  employment_check: string | null
  credit: string | null; credit_score: number | null
  income_monthly: number | null
}, rent: number | null): { score: number; tier: 'good' | 'medium' | 'high'; label: string; color: string; bg: string; incomePts: number; creditPts: number } {
  const clearPts = (val: string | null, full: number) => (val === 'clear' ? full : 0)

  let creditPts = 0
  if (f.credit_score) {
    creditPts = f.credit_score >= 750 ? 30 : f.credit_score >= 700 ? 26 : f.credit_score >= 680 ? 22 : f.credit_score >= 650 ? 16 : f.credit_score >= 600 ? 10 : 5
  } else if (f.credit === 'great') creditPts = 30
  else if (f.credit === 'average') creditPts = 18
  else if (f.credit === 'poor') creditPts = 6

  // Income scored against the 3× monthly-rent guarantor standard.
  let incomePts = 0
  if (f.income_monthly && rent && rent > 0) {
    const m = f.income_monthly / rent
    incomePts = m >= 3 ? 30 : m >= 2.5 ? 24 : m >= 2 ? 18 : m >= 1.5 ? 10 : 4
  }

  const score = creditPts + incomePts + clearPts(f.criminal_check, 20) + clearPts(f.eviction_check, 15) + clearPts(f.employment_check, 5)

  if (score >= 80) return { score, tier: 'good',   label: 'Strong Co-signer', color: '#10b981', bg: 'rgba(16,185,129,0.08)', incomePts, creditPts }
  if (score >= 60) return { score, tier: 'medium', label: 'Adequate',         color: '#f97316', bg: 'rgba(249,115,22,0.08)', incomePts, creditPts }
  return               { score, tier: 'high',   label: 'Weak Co-signer',   color: '#ef4444', bg: 'rgba(239,68,68,0.07)', incomePts, creditPts }
}

// Income-to-rent multiple indicator. Guarantor target is 3× the monthly rent.
function incomeMultiple(income: number | null, rent: number | null): {
  state: 'none' | 'no_rent' | 'pass' | 'near' | 'low'
  multiple: number | null
  label: string; color: string; bg: string; border: string
} {
  if (!income) return { state: 'none', multiple: null, label: 'No income recorded', color: '#9b9b9b', bg: '#f5f4f0', border: '#e8e5de' }
  if (!rent || rent <= 0) return { state: 'no_rent', multiple: null, label: 'Rent unknown — can’t compute multiple', color: '#9b9b9b', bg: '#f5f4f0', border: '#e8e5de' }
  const m = income / rent
  const mx = Math.round(m * 10) / 10
  if (m >= 3) return { state: 'pass', multiple: mx, label: `${mx}× rent · meets 3× requirement`, color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.35)' }
  if (m >= 2) return { state: 'near', multiple: mx, label: `${mx}× rent · below 3× target`, color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.35)' }
  return { state: 'low', multiple: mx, label: `${mx}× rent · well below 3×`, color: '#ef4444', bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.3)' }
}

// ── Template questions ────────────────────────────────────────────────────────
const EMPLOYER_QUESTIONS = [
  'Can you confirm [Name] is currently employed at your company?',
  'What is their job title and employment start date?',
  'Is their employment full-time, part-time, or contract?',
  'What is their approximate gross monthly income?',
  'Is their employment in good standing with no pending termination?',
  'Are there any garnishments or liens on their wages?',
]

const RESIDENCE_QUESTIONS = [
  'Can you confirm [Name] resided at [Address] from [Start] to [End]?',
  'Did they pay rent on time consistently?',
  'Were there any noise complaints, violations, or lease infractions?',
  'Did they leave the unit in good condition upon move-out?',
  'Would you rent to this tenant again?',
  'Was the security deposit returned in full? If not, why?',
]

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function ToggleGroup({ label, value, options, onChange }: {
  label: string
  value: string | null | boolean
  options: { value: string | boolean; label: string; color?: string; bg?: string; border?: string }[]
  onChange: (v: any) => void
}) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
        {options.map(opt => {
          const isSelected = value === opt.value
          return (
            <button
              key={String(opt.value)}
              onClick={() => onChange(isSelected ? null : opt.value)}
              style={{
                padding: '7px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: isSelected ? 700 : 500,
                border: `2px solid ${isSelected ? (opt.border || '#8C1D40') : '#e8e5de'}`,
                background: isSelected ? (opt.bg || '#fdf2f5') : '#fff',
                color: isSelected ? (opt.color || '#8C1D40') : '#6b6b6b',
                cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s',
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ClearToggle({ label, value, onChange }: { label: string; value: 'clear' | 'not_clear' | null; onChange: (v: any) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: '#fff', border: '1px solid #f0ede6', borderRadius: '9px', marginBottom: '8px' }}>
      <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{label}</span>
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          onClick={() => onChange(value === 'clear' ? null : 'clear')}
          style={{
            padding: '5px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: 600,
            border: `1.5px solid ${value === 'clear' ? 'rgba(16,185,129,0.4)' : '#e8e5de'}`,
            background: value === 'clear' ? 'rgba(16,185,129,0.08)' : '#faf9f6',
            color: value === 'clear' ? '#10b981' : '#9b9b9b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s',
          }}
        >✓ Clear</button>
        <button
          onClick={() => onChange(value === 'not_clear' ? null : 'not_clear')}
          style={{
            padding: '5px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: 600,
            border: `1.5px solid ${value === 'not_clear' ? 'rgba(239,68,68,0.4)' : '#e8e5de'}`,
            background: value === 'not_clear' ? 'rgba(239,68,68,0.06)' : '#faf9f6',
            color: value === 'not_clear' ? '#ef4444' : '#9b9b9b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'all 0.15s',
          }}
        >✕ Not Clear</button>
      </div>
    </div>
  )
}

export default function BgCheckDetailPage({ params }: { params: Promise<{ checkId: string }> }) {
  const { checkId } = use(params)
  const router = useRouter()

  const [check, setCheck] = useState<BgCheck | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // Local form state (mirrors check fields)
  const [form, setForm] = useState({
    is_student: null as boolean | null,
    cosigner: null as string | null,
    credit: null as string | null,
    credit_score: null as number | null,
    employment_check: null as string | null,
    current_residence_check: null as string | null,
    criminal_check: null as string | null,
    eviction_check: null as string | null,
    income_monthly: null as number | null,
    notes: '',
  })

  // References state
  const [refs, setRefs] = useState<Reference[]>([])
  const [addingRef, setAddingRef] = useState(false)
  const [refType, setRefType] = useState<'employer' | 'residence'>('employer')
  const [refForm, setRefForm] = useState({ name: '', manager_name: '', phone: '', email: '', address: '', contact_date: '', notes: '', income_monthly: '' })
  const [savingRef, setSavingRef] = useState(false)
  const [expandedRef, setExpandedRef] = useState<string | null>(null)
  const [editingRef, setEditingRef] = useState<string | null>(null)
  const [editRefForm, setEditRefForm] = useState<Partial<Reference & { income_monthly_str: string }>>({})
  const [templateModal, setTemplateModal] = useState<{ type: 'employer' | 'residence'; refName?: string } | null>(null)
  const [cosignerModal, setCosignerModal] = useState(false)
  const [copiedCosigner, setCopiedCosigner] = useState<string | null>(null)
  const [conditionalModal, setConditionalModal] = useState(false)
  const [pendingItems, setPendingItems] = useState('')
  const [copiedConditional, setCopiedConditional] = useState<string | null>(null)
  const [propertyAddress, setPropertyAddress] = useState<string | null>(null)
  const [copiedQ, setCopiedQ] = useState<number | null>(null)
  const [sendingEmail, setSendingEmail] = useState<string | null>(null)
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null)
  const [copiedText, setCopiedText] = useState<string | null>(null)

  // Email history + preview-before-send
  const [emails, setEmails] = useState<EmailLog[]>([])
  const [previewRefId, setPreviewRefId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string; recipient: string; recipientName: string | null; refType: 'employer' | 'residence' } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Final decision state
  const [status, setStatus] = useState<BgStatus>('initiated')
  const [statusSaving, setStatusSaving] = useState<BgStatus | null>(null)
  const [notifying, setNotifying] = useState(false)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [decisionSaving, setDecisionSaving] = useState(false)
  const [showConvertModal, setShowConvertModal] = useState(false)
  const [convertForm, setConvertForm] = useState({ first_name: '', last_name: '', email: '', phone: '', notes: '' })

  // Co-signers (only relevant on a primary applicant's check)
  const [cosigners, setCosigners] = useState<CosignerSummary[]>([])
  const [addingCosigner, setAddingCosigner] = useState(false)
  const [cosignerForm, setCosignerForm] = useState({ first_name: '', last_name: '', email: '', phone: '', relationship: '' })
  const [savingCosigner, setSavingCosigner] = useState(false)
  const [linking, setLinking] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => { document.title = 'Background Check — Landlord | HomeHive' }, [])

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }

      const res = await fetch(`/api/background-checks/${checkId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) { setNotFound(true); setLoading(false); return }

      const { check: c } = await res.json()
      setCheck(c)
      setRefs(c.bg_check_references || [])
      setEmails(c.bg_check_emails || [])
      setCosigners(c.cosigners || [])
      setForm({
        is_student: c.is_student,
        cosigner: c.cosigner,
        credit: c.credit,
        credit_score: c.credit_score ?? null,
        employment_check: c.employment_check,
        current_residence_check: c.current_residence_check,
        criminal_check: c.criminal_check,
        eviction_check: c.eviction_check,
        income_monthly: c.income_monthly ?? null,
        notes: c.notes || '',
      })
      setStatus((c.status as BgStatus) ?? 'initiated')
      setTenantId(c.tenant_id ?? null)
      setPropertyAddress(c.property_address ?? null)
      // Pre-fill convert form from lead
      const l = c.leads
      if (l) {
        setConvertForm({
          first_name: l.first_name || '',
          last_name: l.last_name || '',
          email: l.email || '',
          phone: l.phone || '',
          notes: '',
        })
      }
      setLoading(false)
    }
    load()
  }, [checkId, router])

  const handleSave = async () => {
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      const { check: c } = await res.json()
      setCheck(prev => prev ? { ...prev, ...c } : prev)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      showToast('Saved')
    } else {
      showToast('Failed to save', 'error')
    }
    setSaving(false)
  }

  const handleAddRef = async () => {
    setSavingRef(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/references`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ type: refType, ...refForm, manager_name: refForm.manager_name || null, contact_date: refForm.contact_date || null, income_monthly: refForm.income_monthly ? parseInt(refForm.income_monthly) : null }),
    })
    if (res.ok) {
      const { reference } = await res.json()
      setRefs(prev => [...prev, reference])
      setAddingRef(false)
      setRefForm({ name: '', manager_name: '', phone: '', email: '', address: '', contact_date: '', notes: '', income_monthly: '' })
      showToast(`${refType === 'employer' ? 'Employer' : 'Residence'} reference added`)
    } else {
      showToast('Failed to add reference', 'error')
    }
    setSavingRef(false)
  }

  const handleUpdateRef = async (refId: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/references`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ refId, ...editRefForm }),
    })
    if (res.ok) {
      const { reference } = await res.json()
      setRefs(prev => prev.map(r => r.id === refId ? reference : r))
      setEditingRef(null)
      showToast('Reference updated')
    } else {
      showToast('Failed to update', 'error')
    }
  }

  const handleDeleteRef = async (refId: string) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/references?refId=${refId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    if (res.ok) {
      setRefs(prev => prev.filter(r => r.id !== refId))
      showToast('Removed')
    }
  }

  const handleRefStatusUpdate = async (refId: string, status: Reference['status']) => {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/references`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ refId, status }),
    })
    if (res.ok) {
      const { reference } = await res.json()
      setRefs(prev => prev.map(r => r.id === refId ? reference : r))
    }
  }

  // Open the preview modal (fetches the exact rendered email; sends nothing)
  const handleOpenPreview = async (refId: string) => {
    setPreviewRefId(refId)
    setPreview(null)
    setPreviewLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/references/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ refId }),
    })
    if (res.ok) {
      setPreview(await res.json())
    } else {
      const body = await res.json().catch(() => ({}))
      showToast(body.error || 'Could not load preview', 'error')
      setPreviewRefId(null)
    }
    setPreviewLoading(false)
  }

  const handleSendEmail = async (refId: string) => {
    setSendingEmail(refId)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/references/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ refId }),
    })
    if (res.ok) {
      const body = await res.json().catch(() => ({}))
      setRefs(prev => prev.map(r => {
        if (r.id !== refId) return r
        return r.type === 'residence'
          ? { ...r, status: 'contacted' as Reference['status'], contact_date: new Date().toISOString().split('T')[0] }
          : r
      }))
      if (body.log) setEmails(prev => [body.log as EmailLog, ...prev])
      setPreviewRefId(null)
      setPreview(null)
      showToast('Verification email sent!')
    } else {
      const body = await res.json()
      showToast(body.error || 'Failed to send email', 'error')
    }
    setSendingEmail(null)
  }

  const buildPlainTextEmail = (ref: Reference, lead: Lead | null, type: 'employer' | 'residence'): string => {
    const leadName = lead?.first_name && lead?.last_name
      ? `${lead.first_name} ${lead.last_name}`
      : lead?.first_name || lead?.email || 'the applicant'
    const greeting = ref.name ? `Hi ${ref.name},` : 'To Whom It May Concern,'

    if (type === 'employer') {
      const employerGreeting = ref.manager_name ? `Hi ${ref.manager_name},` : ref.name ? `To the team at ${ref.name},` : 'To Whom It May Concern,'
      return `${employerGreeting}

My name is [Your Name] and I'm a property manager. ${leadName} has applied to rent one of our managed properties and has listed your organization as their current employer.

As part of a standard screening process, I'd appreciate if you could confirm the following:

1. Is ${leadName} currently employed at your organization?
2. What is their job title and approximate start date?
3. Is their position full-time, part-time, or contract?
4. Can you confirm their approximate gross monthly income?
5. Is their employment in good standing with no pending termination?
6. Are there any active wage garnishments or liens?

Please reply to this email. Your response will be kept strictly confidential.

Thank you,
[Your Name]`
    } else {
      const addrLine = ref.address ? ` at ${ref.address}` : ''
      return `${greeting}

My name is [Your Name] and I'm an independent property owner. ${leadName} has applied to rent one of my properties and has listed your property${addrLine} as a previous residence.

I'd appreciate if you could answer a few quick questions:

1. Can you confirm ${leadName} resided at your property, and for how long?
2. Did they consistently pay rent on time?
3. Were there any noise complaints, lease violations, or damage?
4. Did they leave the unit in good condition upon move-out?
5. Was the security deposit returned in full? If not, why?
6. Would you rent to this tenant again?

Please reply to this email. Everything you share will be kept strictly confidential.

Thank you,
[Your Name]`
    }
  }

  const buildTextMessage = (ref: Reference, lead: Lead | null, type: 'employer' | 'residence'): string => {
    const leadName = lead?.first_name && lead?.last_name
      ? `${lead.first_name} ${lead.last_name}`
      : lead?.first_name || 'our applicant'
    const greeting = ref.name ? `Hi ${ref.name}` : 'Hi'
    const baseUrl = getSiteUrl()
    const formUrl = `${baseUrl}/ref/${ref.public_token}`

    if (type === 'employer') {
      const textGreeting = ref.manager_name ? `Hi ${ref.manager_name}` : ref.name ? `Hi, team at ${ref.name}` : 'Hi'
      return `${textGreeting} — quick note from our property management team. ${leadName} has applied to rent one of our units and listed you as their employer. Whenever you have a moment, could you confirm:

1. Are they currently employed with you?
2. Job title & approx. start date?
3. Full-time, part-time, or contract?
4. Approx. gross monthly income?
5. Employment in good standing?
6. Any wage garnishments or liens?

Feel free to reply here or email hello@homehive.live. Really appreciate it!`
    } else {
      const addrLine = ref.address ? ` at ${ref.address}` : ''
      return `${greeting} — quick note from our property management team. ${leadName} has applied to rent one of our units and listed your property${addrLine} as a previous residence, with you as their reference.

Would you mind taking 3 minutes to fill out a short form? Just tap the link whenever you're free:
${formUrl}

Really appreciate your time — thank you!`
    }
  }

  // Advance / change the background check lifecycle status
  const handleStatusChange = async (newStatus: BgStatus) => {
    setStatusSaving(newStatus)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ status: newStatus }),
    })
    if (res.ok) {
      setStatus(newStatus)
      const labels: Record<BgStatus, string> = {
        initiated: 'Reopened — back to Initiated',
        pending_verification: 'Moved to Pending Verification',
        conditionally_approved: 'Marked Conditionally Approved',
        approved: 'Approved',
        declined: 'Application declined',
      }
      showToast(labels[newStatus])
    } else {
      showToast('Failed to update status', 'error')
    }
    setStatusSaving(null)
  }

  // Engagement email: tell the applicant their check is under review
  const handleNotifyReview = async () => {
    setNotifying(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/notify-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    })
    if (res.ok) {
      const body = await res.json().catch(() => ({}))
      if (body.log) setEmails(prev => [body.log as EmailLog, ...prev])
      showToast('Applicant notified — review update sent!')
    } else {
      const body = await res.json().catch(() => ({}))
      showToast(body.error || 'Failed to send notification', 'error')
    }
    setNotifying(false)
  }

  const handleConvertToTenant = async () => {
    if (!convertForm.first_name || !convertForm.email) return
    setDecisionSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(convertForm),
    })
    const json = await res.json()
    if (res.ok) {
      setStatus('approved')
      setTenantId(json.tenantId)
      setShowConvertModal(false)
      showToast(json.already_exists ? (json.message || 'Linked to existing tenant') : 'Tenant created successfully!')
    } else {
      showToast(json.error || 'Failed to create tenant', 'error')
    }
    setDecisionSaving(false)
  }

  // Add a co-signer to this (primary) applicant's screening
  const handleAddCosigner = async () => {
    if (!cosignerForm.first_name || !cosignerForm.email) return
    setSavingCosigner(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/cosigners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(cosignerForm),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      const c = json.check
      const summary: CosignerSummary = {
        id: c.id,
        subject_first_name: c.subject_first_name, subject_last_name: c.subject_last_name,
        subject_email: c.subject_email, subject_phone: c.subject_phone,
        cosigner_relationship: c.cosigner_relationship,
        status: c.status, decision: c.decision, tenant_id: c.tenant_id,
        credit: c.credit, credit_score: c.credit_score,
        criminal_check: c.criminal_check, eviction_check: c.eviction_check,
        employment_check: c.employment_check, current_residence_check: c.current_residence_check,
        income_monthly: c.income_monthly, welcome_email_sent_at: c.welcome_email_sent_at, created_at: c.created_at,
      }
      setCosigners(prev => [...prev, summary])
      setCheck(prev => prev ? { ...prev, cosigner: 'yes' } : prev)
      setForm(f => ({ ...f, cosigner: 'yes' }))
      setAddingCosigner(false)
      setCosignerForm({ first_name: '', last_name: '', email: '', phone: '', relationship: '' })
      showToast(json.email_sent === false ? 'Co-signer added (welcome email failed to send)' : 'Co-signer added & welcomed by email!')
    } else {
      showToast(json.error || 'Failed to add co-signer', 'error')
    }
    setSavingCosigner(false)
  }

  // Link an approved co-signer to the primary applicant's tenant (as guarantor)
  const handleLinkTenant = async () => {
    setLinking(true)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/background-checks/${checkId}/link-tenant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      setStatus('approved')
      setTenantId(json.tenantId)
      showToast(json.already_exists ? 'Already linked to the tenant' : 'Co-signer linked to tenant as guarantor!')
    } else {
      showToast(json.error || 'Failed to link co-signer', 'error')
    }
    setLinking(false)
  }

  if (loading) return (
    <div style={{ padding: '32px', fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap'); @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
      {[1,2,3,4].map(i => <div key={i} style={{ height: '72px', borderRadius: '10px', marginBottom: '10px', background: 'linear-gradient(90deg,#f0ede6 25%,#faf9f6 50%,#f0ede6 75%)', backgroundSize: '400% 100%', animation: 'shimmer 1.4s infinite' }} />)}
    </div>
  )

  if (notFound || !check) return (
    <div style={{ padding: '60px 32px', textAlign: 'center', fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ fontSize: '18px', fontWeight: 600, color: '#1a1a1a', marginBottom: '8px' }}>Check not found</div>
      <button onClick={() => router.push('/landlord/background-checks')} style={{ color: '#8C1D40', background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>← Back</button>
    </div>
  )

  const lead = check.leads
  const initials = ((lead?.first_name?.[0] || '') + (lead?.last_name?.[0] || '')).toUpperCase() || lead?.email?.[0]?.toUpperCase() || '?'
  const employers = refs.filter(r => r.type === 'employer')
  const residences = refs.filter(r => r.type === 'residence')
  const isCosigner = check.is_cosigner
  const ctx = check.cosigner_context
  const rent = check.property_rent

  const STATUS_COLORS: Record<Reference['status'], { color: string; bg: string; border: string; label: string }> = {
    pending:    { color: '#9b9b9b', bg: '#f5f4f0',                  border: '#e8e5de',              label: 'Pending' },
    contacted:  { color: '#f97316', bg: 'rgba(249,115,22,0.08)',    border: 'rgba(249,115,22,0.3)', label: 'Contacted' },
    verified:   { color: '#10b981', bg: 'rgba(16,185,129,0.08)',    border: 'rgba(16,185,129,0.3)', label: 'Verified' },
    unverified: { color: '#ef4444', bg: 'rgba(239,68,68,0.06)',     border: 'rgba(239,68,68,0.25)', label: 'Unverified' },
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .bgd-page { background: #f5f4f0; min-height: 100vh; font-family: 'DM Sans', sans-serif; }

        .bgd-hdr { background: #fff; border-bottom: 1px solid #e8e5de; padding: 12px 24px; display: flex; align-items: center; gap: 12px; }
        .bgd-back { font-size: 12px; color: #9b9b9b; background: none; border: none; cursor: pointer; font-family: 'DM Sans', sans-serif; padding: 0; display: flex; align-items: center; gap: 4px; }
        .bgd-back:hover { color: #1a1a1a; }
        .bgd-hdr-title { font-size: 16px; font-weight: 700; color: #1a1a1a; }
        .bgd-hdr-sub { font-size: 11px; color: #9b9b9b; }

        .bgd-body { padding: 20px 24px 60px; display: grid; grid-template-columns: 1fr 400px; gap: 16px; align-items: start; }
        @media(max-width:900px) { .bgd-body { grid-template-columns: 1fr; } }

        .bgd-card { background: #fff; border-radius: 12px; border: 1px solid #e8e5de; margin-bottom: 14px; overflow: hidden; }
        .bgd-card-hd { padding: 11px 16px; border-bottom: 1px solid #f0ede6; display: flex; align-items: center; justify-content: space-between; }
        .bgd-card-ttl { font-size: 10px; font-weight: 700; color: #9b9b9b; text-transform: uppercase; letter-spacing: 0.7px; }
        .bgd-card-bd { padding: 14px 16px; }

        .lead-banner { background: #1a1a1a; border-radius: 12px; padding: 16px 20px; margin-bottom: 14px; display: flex; align-items: center; gap: 14px; }
        .lead-av { width: 44px; height: 44px; border-radius: 50%; background: #8C1D40; color: #FFC627; font-size: 15px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .lead-name { font-size: 16px; font-weight: 700; color: #fff; }
        .lead-sub { font-size: 12px; color: rgba(255,255,255,0.55); margin-top: 2px; }
        .lead-prop { font-size: 11px; color: #FFC627; margin-top: 3px; font-weight: 600; }

        .kv-row { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; border-bottom: 1px solid #f5f4f0; gap: 8px; }
        .kv-row:last-child { border-bottom: none; }
        .kv-l { font-size: 11px; color: #9b9b9b; flex-shrink: 0; }
        .kv-r { font-size: 12px; color: #1a1a1a; font-weight: 500; text-align: right; }

        .ref-item { border: 1px solid #f0ede6; border-radius: 10px; margin-bottom: 8px; overflow: hidden; }
        .ref-item-hd { padding: 10px 14px; display: flex; align-items: center; gap: 10px; cursor: pointer; background: #faf9f6; }
        .ref-item-hd:hover { background: #f5f3f0; }
        .ref-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
        .ref-name { font-size: 13px; font-weight: 600; color: #1a1a1a; }
        .ref-sub { font-size: 11px; color: #9b9b9b; margin-top: 1px; }
        .ref-status-badge { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 10px; font-weight: 700; border: 1px solid; margin-left: auto; flex-shrink: 0; }
        .ref-bd { padding: 12px 14px; border-top: 1px solid #f0ede6; background: #fff; }

        .status-cycle { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 10px; }
        .status-opt { padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1.5px solid; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; background: #fff; }

        .template-q { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border: 1px solid #f0ede6; border-radius: 8px; margin-bottom: 7px; background: #faf9f6; cursor: pointer; transition: all 0.15s; }
        .template-q:hover { border-color: #8C1D40; background: #fdf2f5; }
        .template-q-text { font-size: 13px; color: #1a1a1a; line-height: 1.5; flex: 1; }

        .notes-area { width: 100%; border: 1.5px solid #e8e5de; border-radius: 10px; padding: 11px 13px; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; resize: vertical; outline: none; min-height: 100px; background: #faf9f6; line-height: 1.6; transition: border-color 0.15s; }
        .notes-area:focus { border-color: #8C1D40; background: #fff; }

        .edit-input { width: 100%; border: 1.5px solid #e8e5de; border-radius: 9px; padding: 9px 12px; font-size: 13px; font-family: 'DM Sans', sans-serif; color: #1a1a1a; background: #faf9f6; outline: none; transition: border-color 0.15s; margin-bottom: 8px; }
        .edit-input:focus { border-color: #8C1D40; background: #fff; }
        .edit-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

        .btn-save { background: #8C1D40; color: #fff; border: none; border-radius: 9px; padding: 10px 22px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-save:hover:not(:disabled) { opacity: 0.88; }
        .btn-ghost-sm { background: transparent; color: #6b6b6b; border: 1.5px solid #e8e5de; border-radius: 8px; padding: 8px 14px; font-size: 12px; cursor: pointer; font-family: 'DM Sans', sans-serif; }
        .btn-add-ref { width: 100%; padding: 9px; background: #faf9f6; border: 1.5px dashed #d0cdc5; border-radius: 9px; font-size: 13px; font-weight: 600; color: #6b6b6b; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; margin-top: 6px; }
        .btn-add-ref:hover { border-color: #8C1D40; color: #8C1D40; background: #fdf2f5; }

        .add-ref-form { background: #faf9f6; border: 1.5px solid #e8e5de; border-radius: 11px; padding: 14px; margin-bottom: 10px; }
        .add-ref-type-row { display: flex; gap: 8px; margin-bottom: 12px; }
        .type-btn { flex: 1; padding: 8px; border: 2px solid #e8e5de; border-radius: 8px; background: #fff; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .type-btn.active { border-color: #8C1D40; background: #fdf2f5; color: #8C1D40; }

        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 600; display: flex; align-items: center; justify-content: center; padding: 24px; backdrop-filter: blur(4px); }
        .modal-box { background: #fff; border-radius: 16px; width: 100%; max-width: 520px; max-height: 88vh; overflow-y: auto; padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,0.25); }
        .modal-ttl { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-bottom: 4px; }
        .modal-sub { font-size: 13px; color: #9b9b9b; margin-bottom: 18px; }

        .toast { position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%); padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 500; z-index: 999; white-space: nowrap; box-shadow: 0 4px 20px rgba(0,0,0,0.2); animation: toastIn 0.2s ease; }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }

        .progress-bar-wrap { height: 5px; background: #f0ede6; border-radius: 3px; overflow: hidden; margin-top: 10px; }
        .progress-bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }

        .decision-card-undecided { border: 1.5px solid #e8e5de; border-radius: 14px; padding: 18px 20px; margin-bottom: 14px; background: #fff; }
        .decision-card-passed { border: 1.5px solid rgba(16,185,129,0.4); border-radius: 14px; padding: 18px 20px; margin-bottom: 14px; background: rgba(16,185,129,0.05); }
        .decision-card-failed { border: 1.5px solid rgba(239,68,68,0.4); border-radius: 14px; padding: 18px 20px; margin-bottom: 14px; background: rgba(239,68,68,0.04); }
        .btn-approve { flex: 1; background: #0f172a; color: #34d399; border: none; border-radius: 9px; padding: 11px 16px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: opacity 0.15s; }
        .btn-approve:hover:not(:disabled) { opacity: 0.88; }
        .btn-decline { flex: 1; background: rgba(239,68,68,0.06); color: #dc2626; border: 1.5px solid rgba(239,68,68,0.3); border-radius: 9px; padding: 11px 16px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all 0.15s; }
        .btn-decline:hover:not(:disabled) { background: rgba(239,68,68,0.1); }
        .btn-approve:disabled, .btn-decline:disabled { opacity: 0.5; cursor: not-allowed; }
        .decision-badge-pass { display: inline-flex; align-items: center; gap: 6px; background: rgba(16,185,129,0.12); color: #059669; font-size: 13px; font-weight: 700; padding: 5px 12px; border-radius: 20px; }
        .decision-badge-fail { display: inline-flex; align-items: center; gap: 6px; background: rgba(239,68,68,0.1); color: #dc2626; font-size: 13px; font-weight: 700; padding: 5px 12px; border-radius: 20px; }
        .tenant-link-btn { display: inline-block; margin-top: 10px; background: #0f172a; color: #34d399; border: none; border-radius: 8px; padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'DM Sans', sans-serif; text-decoration: none; }
        .tenant-link-btn:hover { opacity: 0.88; }
        .undo-link { background: none; border: none; font-size: 11px; color: #9b9b9b; text-decoration: underline; cursor: pointer; font-family: 'DM Sans', sans-serif; margin-top: 8px; display: block; }

        .convert-modal-input { width: 100%; border: 1.5px solid #e8e5de; border-radius: 9px; padding: 9px 12px; font-size: 14px; color: #1a1a1a; font-family: 'DM Sans', sans-serif; background: #faf9f6; outline: none; margin-bottom: 10px; box-sizing: border-box; }
        .convert-modal-input:focus { border-color: #10b981; background: #fff; }
      `}</style>

      <div className="bgd-page">

        {toast && (
          <div className="toast" style={{ background: toast.type === 'success' ? '#1a1a1a' : '#8C1D40', color: '#fff' }}>
            {toast.type === 'success' ? '✓ ' : '✕ '}{toast.msg}
          </div>
        )}

        {/* Header */}
        <div className="bgd-hdr">
          <button className="bgd-back" onClick={() => router.push('/landlord/background-checks')}>← Background Checks</button>
          <div style={{ flex: 1 }}>
            <div className="bgd-hdr-title">
              {lead?.first_name || lead?.last_name
                ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim()
                : lead?.email} — {isCosigner ? 'Co-signer Check' : 'Background Check'}
            </div>
            <div className="bgd-hdr-sub">Started {timeAgo(check.created_at)}{check.updated_at !== check.created_at ? ` · Updated ${timeAgo(check.updated_at)}` : ''}</div>
          </div>
          <button
            className="btn-save"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>

        {/* Status flow graphic */}
        <div style={{ padding: '18px 24px 4px' }}>
          <div className="bgd-card" style={{ marginBottom: 0 }}>
            <div className="bgd-card-hd">
              <span className="bgd-card-ttl">Background Check Progress</span>
            </div>
            <div className="bgd-card-bd" style={{ padding: '20px 24px' }}>
              <StatusFlow status={status} tenantCreated={!!tenantId} />
            </div>
          </div>
        </div>

        <div className="bgd-body">

          {/* LEFT COLUMN */}
          <div>

            {/* Lead banner */}
            <div className="lead-banner">
              <div className="lead-av">{initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isCosigner && (
                  <span style={{ display: 'inline-block', fontSize: '9px', fontWeight: 800, letterSpacing: '0.7px', textTransform: 'uppercase', color: '#1a1a1a', background: '#FFC627', borderRadius: '5px', padding: '2px 7px', marginBottom: '5px' }}>
                    👥 Co-signer{ctx?.relationship ? ` · ${ctx.relationship}` : ''}
                  </span>
                )}
                <div className="lead-name">
                  {lead?.first_name || lead?.last_name
                    ? `${lead?.first_name || ''} ${lead?.last_name || ''}`.trim()
                    : lead?.email}
                </div>
                <div className="lead-sub">
                  {lead?.email}
                  {lead?.phone ? ` · +1 ${formatPhoneDisplay(lead.phone)}` : ''}
                </div>
                {isCosigner && ctx
                  ? <div className="lead-prop">🔗 Co-signing for {ctx.primary_name}{lead?.property ? ` · 📍 ${lead.property}` : ''}</div>
                  : lead?.property && <div className="lead-prop">📍 {lead.property}</div>}
              </div>
              {isCosigner && ctx
                ? <button
                    onClick={() => window.open(`/landlord/background-checks/${ctx.primary_check_id}`, '_blank')}
                    style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', padding: '7px 13px', fontSize: '12px', fontWeight: 600, color: '#fff', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    View Applicant →
                  </button>
                : <button
                    onClick={() => lead?.id && window.open(`/landlord/leads/${lead.id}`, '_blank')}
                    style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', padding: '7px 13px', fontSize: '12px', fontWeight: 600, color: '#fff', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    View Lead →
                  </button>}
            </div>

            {/* ── Co-signers (primary applicants only) ── */}
            {!isCosigner && (
              <div className="bgd-card">
                <div className="bgd-card-hd">
                  <span className="bgd-card-ttl">Co-signers / Guarantors</span>
                  <button
                    onClick={() => setAddingCosigner(true)}
                    style={{ fontSize: '11px', color: '#8C1D40', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                  >
                    + Add Co-signer
                  </button>
                </div>
                <div className="bgd-card-bd">
                  {cosigners.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '14px 8px', fontSize: '12px', color: '#9b9b9b', lineHeight: 1.6 }}>
                      No co-signers yet. Add one if the applicant’s income is below <strong>3× rent</strong> or they need a guarantor — the co-signer gets their own screening &amp; a welcome email.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {cosigners.map(cs => {
                        const csName = [cs.subject_first_name, cs.subject_last_name].filter(Boolean).join(' ').trim() || cs.subject_email || 'Co-signer'
                        const csInitials = ((cs.subject_first_name?.[0] || '') + (cs.subject_last_name?.[0] || '')).toUpperCase() || cs.subject_email?.[0]?.toUpperCase() || '?'
                        const cscore = computeCosignerScore(cs, rent)
                        const im = incomeMultiple(cs.income_monthly, rent)
                        const sp = {
                          initiated:              { label: 'Initiated',   color: '#6b6b6b', bg: '#f5f4f0' },
                          pending_verification:   { label: 'Verifying',   color: '#f97316', bg: 'rgba(249,115,22,0.1)' },
                          conditionally_approved: { label: 'Conditional', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
                          approved:               { label: cs.tenant_id ? 'Linked' : 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
                          declined:               { label: 'Declined',    color: '#dc2626', bg: 'rgba(239,68,68,0.08)' },
                        }[cs.status] || { label: cs.status, color: '#6b6b6b', bg: '#f5f4f0' }
                        return (
                          <a
                            key={cs.id}
                            href={`/landlord/background-checks/${cs.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '11px 12px', border: '1px solid #f0ede6', borderRadius: '10px', textDecoration: 'none', color: 'inherit', background: '#faf9f6' }}
                          >
                            <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#8C1D40', color: '#FFC627', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{csInitials}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {csName}
                                {cs.cosigner_relationship && <span style={{ fontSize: '10px', fontWeight: 600, color: '#9b9b9b' }}>· {cs.cosigner_relationship}</span>}
                              </div>
                              <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ color: cscore.color, fontWeight: 700 }}>{cscore.score}/100 · {cscore.label}</span>
                                {im.multiple != null && <span style={{ color: im.color, fontWeight: 600 }}>{im.multiple}× rent</span>}
                                {!cs.welcome_email_sent_at && <span style={{ color: '#b0a898' }}>✉ welcome not sent</span>}
                              </div>
                            </div>
                            <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '20px', color: sp.color, background: sp.bg }}>{sp.label}</span>
                            <span style={{ color: '#d0cdc5', fontSize: '14px', flexShrink: 0 }}>›</span>
                          </a>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Checklist ── */}
            <div className="bgd-card">
              <div className="bgd-card-hd">
                <span className="bgd-card-ttl">Screening Checklist</span>
                {(() => {
                  const fields = [
                    check.employment_check, check.current_residence_check,
                    check.criminal_check, check.eviction_check,
                  ]
                  const done = fields.filter(Boolean).length
                  const allClear = fields.every(f => f === 'clear')
                  return (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: allClear ? '#10b981' : done > 0 ? '#f97316' : '#9b9b9b' }}>
                      {done}/{fields.length} reviewed
                    </span>
                  )
                })()}
              </div>
              <div className="bgd-card-bd">

                <ToggleGroup
                  label="Student"
                  value={form.is_student}
                  options={[
                    { value: true,  label: '✓ Yes — Student',     color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.4)' },
                    { value: false, label: '✕ No — Not a Student', color: '#6b6b6b', bg: '#f5f4f0',              border: '#d0cdc5' },
                  ]}
                  onChange={v => setForm(f => ({ ...f, is_student: v }))}
                />

                {!isCosigner && (
                  <ToggleGroup
                    label="Cosigner"
                    value={form.cosigner}
                    options={[
                      { value: 'yes',          label: '✓ Has Cosigner',   color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.4)' },
                      { value: 'no',           label: '✕ No Cosigner',    color: '#6b6b6b', bg: '#f5f4f0',               border: '#d0cdc5' },
                      { value: 'pending',      label: '⏳ Pending',        color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.4)' },
                      { value: 'need_cosigner',label: '⚠ Need Cosigner',  color: '#dc2626', bg: 'rgba(220,38,38,0.06)', border: 'rgba(220,38,38,0.35)' },
                    ]}
                    onChange={v => setForm(f => ({ ...f, cosigner: v }))}
                  />
                )}

                <ToggleGroup
                  label="Credit"
                  value={form.credit}
                  options={[
                    { value: 'great',   label: '★ Great',   color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.4)' },
                    { value: 'average', label: '◑ Average', color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.4)' },
                    { value: 'poor',    label: '▽ Poor',    color: '#ef4444', bg: 'rgba(239,68,68,0.06)',  border: 'rgba(239,68,68,0.35)' },
                  ]}
                  onChange={v => setForm(f => ({ ...f, credit: v }))}
                />

                <div style={{ marginBottom: '18px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>Credit Score (optional)</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="number"
                      min={300}
                      max={850}
                      placeholder="e.g. 720"
                      value={form.credit_score ?? ''}
                      onChange={e => setForm(f => ({ ...f, credit_score: e.target.value ? parseInt(e.target.value) : null }))}
                      style={{ width: '120px', border: '1.5px solid #e8e5de', borderRadius: '9px', padding: '8px 12px', fontSize: '14px', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: '#1a1a1a', background: '#faf9f6', outline: 'none' }}
                    />
                    {form.credit_score != null && (
                      <span style={{
                        fontSize: '11px', fontWeight: 700, padding: '4px 10px', borderRadius: '20px',
                        ...(form.credit_score >= 750 ? { color: '#10b981', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)' }
                          : form.credit_score >= 700 ? { color: '#3b82f6', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)' }
                          : form.credit_score >= 650 ? { color: '#f97316', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.3)' }
                          : { color: '#ef4444', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }),
                      }}>
                        {form.credit_score >= 750 ? 'Excellent' : form.credit_score >= 700 ? 'Good' : form.credit_score >= 650 ? 'Fair' : form.credit_score >= 600 ? 'Poor' : 'Very Poor'}
                      </span>
                    )}
                    {form.credit_score != null && (
                      <span style={{ fontSize: '10px', color: '#9b9b9b' }}>overrides toggle above</span>
                    )}
                  </div>
                </div>

                {/* Monthly income — a tracked line item with a live rent-multiple
                    indicator (3× rent is the guarantor target). */}
                {(() => {
                  const im = incomeMultiple(form.income_monthly, rent)
                  return (
                    <div style={{ marginBottom: '18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                          Monthly Income{isCosigner ? '' : ' (optional)'}
                        </span>
                        {rent ? <span style={{ fontSize: '10px', color: '#b0a898' }}>Rent: ${rent.toLocaleString()}/mo</span> : null}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', border: '1.5px solid #e8e5de', borderRadius: '9px', padding: '0 12px', background: '#faf9f6' }}>
                          <span style={{ fontSize: '14px', fontWeight: 700, color: '#9b9b9b' }}>$</span>
                          <input
                            type="number"
                            min={0}
                            step={100}
                            placeholder="e.g. 6000"
                            value={form.income_monthly ?? ''}
                            onChange={e => setForm(f => ({ ...f, income_monthly: e.target.value ? parseInt(e.target.value) : null }))}
                            style={{ width: '110px', border: 'none', padding: '8px 0', fontSize: '14px', fontWeight: 700, fontFamily: "'DM Sans', sans-serif", color: '#1a1a1a', background: 'transparent', outline: 'none' }}
                          />
                          <span style={{ fontSize: '11px', color: '#9b9b9b' }}>/mo</span>
                        </div>
                        <span style={{
                          fontSize: '11px', fontWeight: 700, padding: '5px 11px', borderRadius: '20px',
                          color: im.color, background: im.bg, border: `1px solid ${im.border}`,
                        }}>
                          {im.state === 'pass' ? '✓ ' : im.state === 'near' ? '◑ ' : im.state === 'low' ? '⚠ ' : ''}{im.label}
                        </span>
                      </div>
                      {im.state === 'low' && (
                        <div style={{ fontSize: '10.5px', color: '#dc2626', marginTop: '6px' }}>
                          Income falls short of the 3× monthly rent standard{isCosigner ? '' : ' — consider requesting a co-signer'}.
                        </div>
                      )}
                    </div>
                  )
                })()}

                <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px' }}>Verification Checks</div>

                <ClearToggle
                  label="Employment"
                  value={form.employment_check as any}
                  onChange={v => setForm(f => ({ ...f, employment_check: v }))}
                />
                <ClearToggle
                  label="Current Residence"
                  value={form.current_residence_check as any}
                  onChange={v => setForm(f => ({ ...f, current_residence_check: v }))}
                />
                <ClearToggle
                  label="Criminal"
                  value={form.criminal_check as any}
                  onChange={v => setForm(f => ({ ...f, criminal_check: v }))}
                />
                <ClearToggle
                  label="Eviction"
                  value={form.eviction_check as any}
                  onChange={v => setForm(f => ({ ...f, eviction_check: v }))}
                />

                {/* Progress bar */}
                {(() => {
                  const fields = [form.employment_check, form.current_residence_check, form.criminal_check, form.eviction_check]
                  const cleared = fields.filter(f => f === 'clear').length
                  const flagged = fields.filter(f => f === 'not_clear').length
                  const pct = (fields.filter(Boolean).length / fields.length) * 100
                  return (
                    <div style={{ marginTop: '14px' }}>
                      <div className="progress-bar-wrap">
                        <div className="progress-bar-fill" style={{
                          width: `${pct}%`,
                          background: flagged > 0 ? '#ef4444' : cleared === fields.length ? '#10b981' : '#f97316',
                        }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px', fontSize: '10px', color: '#9b9b9b' }}>
                        <span>{cleared} clear · {flagged} flagged · {fields.length - fields.filter(Boolean).length} pending</span>
                        <span style={{ fontWeight: 600, color: flagged > 0 ? '#ef4444' : cleared === fields.length ? '#10b981' : '#f97316' }}>
                          {flagged > 0 ? '⚠ Review Required' : cleared === fields.length ? '✓ All Clear' : `${Math.round(pct)}% complete`}
                        </span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* ── Notes ── */}
            <div className="bgd-card">
              <div className="bgd-card-hd">
                <span className="bgd-card-ttl">Notes</span>
              </div>
              <div className="bgd-card-bd">
                <textarea
                  className="notes-area"
                  placeholder="Add internal notes — SSN verified, ID reviewed, red flags, follow-up items…"
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <button className="btn-save" disabled={saving} onClick={handleSave}>
                    {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            {/* ── Email History ── */}
            <div className="bgd-card">
              <div className="bgd-card-hd">
                <span className="bgd-card-ttl">Email History</span>
                <span style={{ fontSize: '11px', color: '#9b9b9b', fontWeight: 600 }}>
                  {emails.filter(e => e.status === 'sent').length} sent
                </span>
              </div>
              <div className="bgd-card-bd">
                {emails.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '16px 0', fontSize: '12px', color: '#9b9b9b' }}>
                    No verification emails sent yet. Use <strong>Preview &amp; Send</strong> on an employer or residence contact to get started.
                  </div>
                ) : (
                  [...emails]
                    .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())
                    .map(e => {
                      const failed = e.status === 'failed'
                      return (
                        <div key={e.id} style={{ display: 'flex', gap: '10px', padding: '10px 0', borderBottom: '1px solid #f5f4f0' }}>
                          <div style={{ width: '30px', height: '30px', borderRadius: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', background: e.ref_type === 'employer' ? 'rgba(59,130,246,0.1)' : e.ref_type === 'applicant' ? 'rgba(255,198,39,0.18)' : e.ref_type === 'cosigner' ? 'rgba(140,29,64,0.1)' : 'rgba(16,185,129,0.1)' }}>
                            {e.ref_type === 'employer' ? '💼' : e.ref_type === 'applicant' ? '👤' : e.ref_type === 'cosigner' ? '👥' : '🏠'}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {e.subject || (e.ref_type === 'employer' ? 'Employment verification' : e.ref_type === 'applicant' ? 'Application update' : e.ref_type === 'cosigner' ? 'Co-signer welcome' : 'Rental reference')}
                            </div>
                            <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '2px' }}>
                              To {e.recipient_name ? `${e.recipient_name} · ` : ''}{e.recipient}
                            </div>
                            {failed && e.error && (
                              <div style={{ fontSize: '10px', color: '#dc2626', marginTop: '3px' }}>⚠ {e.error}</div>
                            )}
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <span style={{
                              display: 'inline-block', fontSize: '9px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', textTransform: 'uppercase', letterSpacing: '0.4px',
                              ...(failed
                                ? { color: '#dc2626', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }
                                : { color: '#10b981', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)' }),
                            }}>
                              {failed ? 'Failed' : 'Sent'}
                            </span>
                            <div style={{ fontSize: '10px', color: '#9b9b9b', marginTop: '4px', whiteSpace: 'nowrap' }} title={new Date(e.sent_at).toLocaleString()}>
                              {timeAgo(e.sent_at)}
                            </div>
                          </div>
                        </div>
                      )
                    })
                )}
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN */}
          <div>

            {/* ── Actions ── */}
            {(() => {
              const STATUS_PILL: Record<BgStatus, { label: string; color: string; bg: string; border: string }> = {
                initiated:              { label: 'Initiated',              color: '#6b6b6b', bg: '#f5f4f0',               border: '#e8e5de' },
                pending_verification:   { label: 'Pending Verification',   color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.3)' },
                conditionally_approved: { label: 'Conditionally Approved', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.3)' },
                approved:               { label: 'Approved',               color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.3)' },
                declined:               { label: 'Declined',               color: '#dc2626', bg: 'rgba(239,68,68,0.06)',  border: 'rgba(239,68,68,0.25)' },
              }
              const pill = STATUS_PILL[status]
              const hint: Record<BgStatus, string> = {
                initiated:              'Kick off the screening — begin verification when you’re ready to start checking references.',
                pending_verification:   'Verification in progress. Approve outright, or mark conditionally approved if you need a cosigner or extra documents.',
                conditionally_approved: 'Conditionally approved — finalize the approval once your conditions are met.',
                approved:               isCosigner
                  ? (tenantId ? 'Approved and linked to the tenant as guarantor.' : 'Approved! Link this co-signer to the applicant’s tenant as their guarantor.')
                  : (tenantId ? 'Approved and converted to a tenant.' : 'Approved! Create their tenant profile to move them onto a lease.'),
                declined:               'This application was declined. You can reopen it to continue the review.',
              }
              const busy = statusSaving !== null || decisionSaving || linking
              const primaryBtn: React.CSSProperties = { width: '100%', background: '#8C1D40', color: '#fff', border: 'none', borderRadius: '9px', padding: '11px 16px', fontSize: '13px', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: busy ? 0.6 : 1 }
              const ghostBtn: React.CSSProperties = { flex: 1, background: '#fff', color: '#6b6b6b', border: '1.5px solid #e8e5de', borderRadius: '9px', padding: '10px 14px', fontSize: '12px', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }
              return (
                <div className="bgd-card">
                  <div className="bgd-card-hd">
                    <span className="bgd-card-ttl">Actions</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', color: pill.color, background: pill.bg, border: `1px solid ${pill.border}`, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      {pill.label}
                    </span>
                  </div>
                  <div className="bgd-card-bd">
                    <div style={{ fontSize: '12.5px', color: '#6b6b6b', lineHeight: 1.5, marginBottom: '14px' }}>
                      {hint[status]}
                    </div>

                    {/* Primary forward actions */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {status === 'initiated' && (
                        <button style={primaryBtn} disabled={busy} onClick={() => handleStatusChange('pending_verification')}>
                          {statusSaving === 'pending_verification' ? 'Starting…' : '▶ Begin Verification'}
                        </button>
                      )}

                      {status === 'pending_verification' && (
                        <>
                          <button style={{ ...primaryBtn, background: '#fff', color: '#8b5cf6', border: '1.5px solid rgba(139,92,246,0.4)' }} disabled={busy} onClick={() => handleStatusChange('conditionally_approved')}>
                            {statusSaving === 'conditionally_approved' ? 'Saving…' : '◑ Mark Conditionally Approved'}
                          </button>
                          <button className="btn-approve" style={{ width: '100%' }} disabled={busy} onClick={() => handleStatusChange('approved')}>
                            {statusSaving === 'approved' ? 'Approving…' : '✓ Approve'}
                          </button>
                        </>
                      )}

                      {status === 'conditionally_approved' && (
                        <button className="btn-approve" style={{ width: '100%' }} disabled={busy} onClick={() => handleStatusChange('approved')}>
                          {statusSaving === 'approved' ? 'Approving…' : '✓ Approve'}
                        </button>
                      )}

                      {status === 'approved' && !tenantId && !isCosigner && (
                        <button className="btn-approve" style={{ width: '100%' }} disabled={busy} onClick={() => setShowConvertModal(true)}>
                          ＋ Create Tenant
                        </button>
                      )}

                      {status === 'approved' && !tenantId && isCosigner && (
                        ctx?.primary_tenant_id ? (
                          <button className="btn-approve" style={{ width: '100%' }} disabled={busy} onClick={handleLinkTenant}>
                            {linking ? 'Linking…' : `🔗 Link to ${ctx.primary_name}'s Tenant`}
                          </button>
                        ) : (
                          <div style={{ background: '#faf9f6', border: '1px solid #e8e5de', borderRadius: '10px', padding: '11px 13px', fontSize: '12px', color: '#6b6b6b', lineHeight: 1.5 }}>
                            Approve and convert {ctx?.primary_name || 'the primary applicant'} to a tenant first — then you can link this co-signer as their guarantor.
                          </div>
                        )
                      )}

                      {tenantId && (
                        <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '10px', padding: '12px 14px' }}>
                          <div style={{ fontSize: '13px', fontWeight: 700, color: '#059669', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {isCosigner ? '🔗 Linked as guarantor' : '👤 Tenant created'}
                          </div>
                          <a href="/landlord/tenants" className="tenant-link-btn" style={{ marginTop: '8px' }}>View in Tenants →</a>
                        </div>
                      )}
                    </div>

                    {/* Secondary actions */}
                    {status !== 'declined' && (
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0ede6' }}>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button style={ghostBtn} disabled={notifying || busy} onClick={handleNotifyReview}>
                            {notifying ? 'Sending…' : '✉ Notify “Under Review”'}
                          </button>
                          <button style={ghostBtn} disabled={busy} onClick={() => setCosignerModal(true)}>
                            👥 Request Co-signer
                          </button>
                          <button style={ghostBtn} disabled={busy} onClick={() => setConditionalModal(true)}>
                            📝 Conditional Approval Email
                          </button>
                        </div>
                        {!tenantId && (
                          <button style={{ ...ghostBtn, width: '100%', marginTop: '8px', color: '#dc2626', border: '1.5px solid rgba(239,68,68,0.3)' }} disabled={busy} onClick={() => handleStatusChange('declined')}>
                            {statusSaving === 'declined' ? '…' : '✕ Decline Application'}
                          </button>
                        )}
                      </div>
                    )}

                    {status === 'declined' && (
                      <button style={{ ...primaryBtn, background: '#fff', color: '#8C1D40', border: '1.5px solid rgba(140,29,64,0.4)' }} disabled={busy} onClick={() => handleStatusChange('initiated')}>
                        {statusSaving === 'initiated' ? 'Reopening…' : '↺ Reopen Check'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* ── Score Widget ── */}
            {(() => {
              const s = isCosigner ? computeCosignerScore(form, rent) : computeScore(form)
              const pct = (s.score / 100) * 100
              return (
                <div style={{ background: s.bg, border: `1.5px solid ${s.color}30`, borderRadius: '14px', padding: '18px 20px', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: s.color, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>Risk Score</div>
                      <div style={{ fontSize: '22px', fontWeight: 800, color: '#1a1a1a', lineHeight: 1, fontFamily: "'DM Sans', sans-serif" }}>
                        {s.score}<span style={{ fontSize: '13px', color: '#9b9b9b', fontWeight: 500 }}>/100</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: s.color, fontFamily: "'DM Sans', sans-serif" }}>{s.label}</div>
                      <div style={{ fontSize: '11px', color: '#9b9b9b', marginTop: '2px' }}>
                        {s.tier === 'good' ? 'Strong application' : s.tier === 'medium' ? 'Review recommended' : 'Proceed with caution'}
                      </div>
                    </div>
                  </div>
                  <div style={{ height: '6px', background: 'rgba(0,0,0,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: s.color, borderRadius: '3px', transition: 'width 0.4s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '10px', color: '#9b9b9b' }}>
                    <span>{isCosigner
                      ? 'Credit 30 · Income 30 · Criminal 20 · Eviction 15 · Employment 5'
                      : 'Criminal 30 · Eviction 25 · Employment 20 · Residence 15 · Credit 10'}</span>
                  </div>
                </div>
              )
            })()}

            {/* Lead quick info */}
            <div className="bgd-card">
              <div className="bgd-card-hd"><span className="bgd-card-ttl">Lead Details</span></div>
              <div className="bgd-card-bd">
                <div className="kv-row"><span className="kv-l">Name</span><span className="kv-r">{lead?.first_name || '—'}{lead?.last_name ? ` ${lead.last_name}` : ''}</span></div>
                <div className="kv-row"><span className="kv-l">Email</span><span className="kv-r"><a href={`mailto:${lead?.email}`} style={{ color: '#8C1D40', textDecoration: 'none' }}>{lead?.email}</a></span></div>
                {lead?.phone && <div className="kv-row"><span className="kv-l">Phone</span><span className="kv-r">+1 {formatPhoneDisplay(lead.phone)}</span></div>}
                {lead?.property && <div className="kv-row"><span className="kv-l">Property</span><span className="kv-r">{lead.property}</span></div>}
                {lead?.move_in_date && <div className="kv-row"><span className="kv-l">Move-in</span><span className="kv-r">{new Date(lead.move_in_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>}
                {lead?.status && <div className="kv-row"><span className="kv-l">Status</span><span className="kv-r" style={{ textTransform: 'capitalize' }}>{lead.status.replace(/_/g, ' ')}</span></div>}
              </div>
            </div>

            {/* ── Employer References ── */}
            <div className="bgd-card">
              <div className="bgd-card-hd">
                <span className="bgd-card-ttl">Employer Verification</span>
                <button
                  onClick={() => setTemplateModal({ type: 'employer' })}
                  style={{ fontSize: '11px', color: '#8C1D40', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                >
                  📋 Templates
                </button>
              </div>
              <div className="bgd-card-bd">
                {employers.length === 0 && !addingRef && (
                  <div style={{ textAlign: 'center', padding: '12px 0', fontSize: '12px', color: '#9b9b9b' }}>No employer contacts yet</div>
                )}
                {employers.map(ref => (
                  <RefCard
                    key={ref.id}
                    ref_={ref}
                    expanded={expandedRef === ref.id}
                    editing={editingRef === ref.id}
                    editForm={editRefForm}
                    statusColors={STATUS_COLORS}
                    onToggle={() => setExpandedRef(expandedRef === ref.id ? null : ref.id)}
                    onStatusChange={s => handleRefStatusUpdate(ref.id, s)}
                    onEdit={() => { setEditingRef(ref.id); setEditRefForm({ name: ref.name, manager_name: ref.manager_name, phone: ref.phone, email: ref.email, address: ref.address, contact_date: ref.contact_date, notes: ref.notes, income_monthly: ref.income_monthly, income_monthly_str: ref.income_monthly != null ? String(ref.income_monthly) : '' }) }}
                    onEditChange={patch => setEditRefForm(prev => ({ ...prev, ...patch }))}
                    onEditSave={() => handleUpdateRef(ref.id)}
                    onEditCancel={() => setEditingRef(null)}
                    onDelete={() => handleDeleteRef(ref.id)}
                    onTemplate={() => setTemplateModal({ type: 'employer', refName: ref.name || undefined })}
                    onSendEmail={ref.email ? () => handleOpenPreview(ref.id) : undefined}
                    lastSentAt={emails.find(e => e.ref_id === ref.id && e.status === 'sent')?.sent_at || null}
                    sentCount={emails.filter(e => e.ref_id === ref.id && e.status === 'sent').length}
                    onCopyEmail={ref.email ? () => {
                      navigator.clipboard.writeText(buildPlainTextEmail(ref, lead, 'employer'))
                      setCopiedEmail(ref.id)
                      setTimeout(() => setCopiedEmail(null), 2000)
                    } : undefined}
                    onCopyText={ref.phone ? () => {
                      navigator.clipboard.writeText(buildTextMessage(ref, lead, 'employer'))
                      setCopiedText(ref.id)
                      setTimeout(() => setCopiedText(null), 2000)
                    } : undefined}
                    isSending={sendingEmail === ref.id}
                    isCopied={copiedEmail === ref.id}
                    isCopiedText={copiedText === ref.id}
                  />
                ))}

                {addingRef && refType === 'employer' && (
                  <AddRefForm
                    type="employer"
                    form={refForm}
                    saving={savingRef}
                    onChange={patch => setRefForm(f => ({ ...f, ...patch }))}
                    onSave={handleAddRef}
                    onCancel={() => { setAddingRef(false); setRefForm({ name: '', manager_name: '', phone: '', email: '', address: '', contact_date: '', notes: '', income_monthly: '' }) }}
                  />
                )}

                <button
                  className="btn-add-ref"
                  onClick={() => { setRefType('employer'); setAddingRef(true) }}
                >
                  + Add Employer Contact
                </button>
              </div>
            </div>

            {/* ── Previous Residences ── */}
            <div className="bgd-card">
              <div className="bgd-card-hd">
                <span className="bgd-card-ttl">Previous Residences</span>
                <button
                  onClick={() => setTemplateModal({ type: 'residence' })}
                  style={{ fontSize: '11px', color: '#8C1D40', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                >
                  📋 Templates
                </button>
              </div>
              <div className="bgd-card-bd">
                {residences.length === 0 && !(addingRef && refType === 'residence') && (
                  <div style={{ textAlign: 'center', padding: '12px 0', fontSize: '12px', color: '#9b9b9b' }}>No previous residences added</div>
                )}
                {residences.map(ref => (
                  <RefCard
                    key={ref.id}
                    ref_={ref}
                    expanded={expandedRef === ref.id}
                    editing={editingRef === ref.id}
                    editForm={editRefForm}
                    statusColors={STATUS_COLORS}
                    onToggle={() => setExpandedRef(expandedRef === ref.id ? null : ref.id)}
                    onStatusChange={s => handleRefStatusUpdate(ref.id, s)}
                    onEdit={() => { setEditingRef(ref.id); setEditRefForm({ name: ref.name, manager_name: ref.manager_name, phone: ref.phone, email: ref.email, address: ref.address, contact_date: ref.contact_date, notes: ref.notes, income_monthly: ref.income_monthly, income_monthly_str: '' }) }}
                    onEditChange={patch => setEditRefForm(prev => ({ ...prev, ...patch }))}
                    onEditSave={() => handleUpdateRef(ref.id)}
                    onEditCancel={() => setEditingRef(null)}
                    onDelete={() => handleDeleteRef(ref.id)}
                    onTemplate={() => setTemplateModal({ type: 'residence', refName: ref.name || undefined })}
                    onSendEmail={ref.email ? () => handleOpenPreview(ref.id) : undefined}
                    lastSentAt={emails.find(e => e.ref_id === ref.id && e.status === 'sent')?.sent_at || null}
                    sentCount={emails.filter(e => e.ref_id === ref.id && e.status === 'sent').length}
                    onCopyEmail={ref.email ? () => {
                      navigator.clipboard.writeText(buildPlainTextEmail(ref, lead, 'residence'))
                      setCopiedEmail(ref.id)
                      setTimeout(() => setCopiedEmail(null), 2000)
                    } : undefined}
                    onCopyText={ref.phone ? () => {
                      navigator.clipboard.writeText(buildTextMessage(ref, lead, 'residence'))
                      setCopiedText(ref.id)
                      setTimeout(() => setCopiedText(null), 2000)
                    } : undefined}
                    isSending={sendingEmail === ref.id}
                    isCopied={copiedEmail === ref.id}
                    isCopiedText={copiedText === ref.id}
                  />
                ))}

                {addingRef && refType === 'residence' && (
                  <AddRefForm
                    type="residence"
                    form={refForm}
                    saving={savingRef}
                    onChange={patch => setRefForm(f => ({ ...f, ...patch }))}
                    onSave={handleAddRef}
                    onCancel={() => { setAddingRef(false); setRefForm({ name: '', manager_name: '', phone: '', email: '', address: '', contact_date: '', notes: '', income_monthly: '' }) }}
                  />
                )}

                <button
                  className="btn-add-ref"
                  onClick={() => { setRefType('residence'); setAddingRef(true) }}
                >
                  + Add Previous Residence
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── CONVERT TO TENANT MODAL ── */}
      {showConvertModal && (
        <div className="modal-overlay" onClick={() => setShowConvertModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
              <div>
                <div className="modal-ttl">Create Tenant Profile</div>
                <div className="modal-sub">Review and confirm details from the lead — edit anything before saving.</div>
              </div>
              <button onClick={() => setShowConvertModal(false)} style={{ background: 'none', border: 'none', fontSize: '18px', color: '#9b9b9b', cursor: 'pointer', padding: '2px', lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: 0 }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b6b6b', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>First Name *</label>
                <input
                  className="convert-modal-input"
                  type="text"
                  value={convertForm.first_name}
                  onChange={e => setConvertForm(f => ({ ...f, first_name: e.target.value }))}
                  placeholder="First name"
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b6b6b', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Last Name</label>
                <input
                  className="convert-modal-input"
                  type="text"
                  value={convertForm.last_name}
                  onChange={e => setConvertForm(f => ({ ...f, last_name: e.target.value }))}
                  placeholder="Last name"
                />
              </div>
            </div>

            <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b6b6b', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Email *</label>
            <input
              className="convert-modal-input"
              type="email"
              value={convertForm.email}
              onChange={e => setConvertForm(f => ({ ...f, email: e.target.value }))}
              placeholder="tenant@email.com"
            />

            <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b6b6b', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Phone</label>
            <input
              className="convert-modal-input"
              type="tel"
              value={convertForm.phone}
              onChange={e => setConvertForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="Phone number"
            />

            <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b6b6b', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Tenant Notes</label>
            <textarea
              className="convert-modal-input"
              rows={3}
              style={{ resize: 'vertical' }}
              value={convertForm.notes}
              onChange={e => setConvertForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Internal notes for this tenant (optional)"
            />

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button
                disabled={!convertForm.first_name || !convertForm.email || decisionSaving}
                onClick={handleConvertToTenant}
                style={{ flex: 2, background: decisionSaving || !convertForm.first_name || !convertForm.email ? '#9b9b9b' : '#0f172a', color: '#34d399', border: 'none', borderRadius: '9px', padding: '11px', fontSize: '14px', fontWeight: 700, cursor: decisionSaving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
              >
                {decisionSaving ? 'Creating…' : 'Create Tenant'}
              </button>
              <button
                onClick={() => setShowConvertModal(false)}
                style={{ flex: 1, background: '#f5f4f0', border: 'none', borderRadius: '9px', padding: '11px', fontSize: '13px', color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif', fontWeight: 600" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD CO-SIGNER MODAL ── */}
      {addingCosigner && (
        <div className="modal-overlay" onClick={() => setAddingCosigner(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
              <div>
                <div className="modal-ttl">👥 Add a Co-signer</div>
                <div className="modal-sub">
                  We’ll set up a full screening for the co-signer and email them a welcome note letting them know they’ve been added{lead?.first_name ? ` to ${lead.first_name}’s application` : ''}.
                </div>
              </div>
              <button onClick={() => setAddingCosigner(false)} style={{ background: 'none', border: 'none', fontSize: '18px', color: '#9b9b9b', cursor: 'pointer', padding: '2px', lineHeight: 1 }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b6b6b', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>First Name *</label>
                <input className="convert-modal-input" type="text" value={cosignerForm.first_name} onChange={e => setCosignerForm(f => ({ ...f, first_name: e.target.value }))} placeholder="First name" autoFocus />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b6b6b', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Last Name</label>
                <input className="convert-modal-input" type="text" value={cosignerForm.last_name} onChange={e => setCosignerForm(f => ({ ...f, last_name: e.target.value }))} placeholder="Last name" />
              </div>
            </div>

            <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b6b6b', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Email *</label>
            <input className="convert-modal-input" type="email" value={cosignerForm.email} onChange={e => setCosignerForm(f => ({ ...f, email: e.target.value }))} placeholder="cosigner@email.com" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b6b6b', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Phone</label>
                <input className="convert-modal-input" type="tel" value={cosignerForm.phone} onChange={e => setCosignerForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone number" />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b6b6b', display: 'block', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Relationship</label>
                <input className="convert-modal-input" type="text" value={cosignerForm.relationship} onChange={e => setCosignerForm(f => ({ ...f, relationship: e.target.value }))} placeholder="e.g. Parent, Relative" list="cosigner-rel-options" />
                <datalist id="cosigner-rel-options">
                  <option value="Parent" /><option value="Guardian" /><option value="Relative" /><option value="Spouse / Partner" /><option value="Employer" /><option value="Friend" />
                </datalist>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button
                disabled={!cosignerForm.first_name || !cosignerForm.email || savingCosigner}
                onClick={handleAddCosigner}
                style={{ flex: 2, background: savingCosigner || !cosignerForm.first_name || !cosignerForm.email ? '#9b9b9b' : '#8C1D40', color: '#fff', border: 'none', borderRadius: '9px', padding: '11px', fontSize: '14px', fontWeight: 700, cursor: savingCosigner ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}
              >
                {savingCosigner ? 'Adding…' : 'Add & Send Welcome'}
              </button>
              <button onClick={() => setAddingCosigner(false)} style={{ flex: 1, background: '#f5f4f0', border: 'none', borderRadius: '9px', padding: '11px', fontSize: '13px', color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TEMPLATE MODAL ── */}
      {templateModal && (
        <div className="modal-overlay" onClick={() => setTemplateModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <div className="modal-ttl">
                  {templateModal.type === 'employer' ? '💼 Employer Verification' : '🏠 Previous Landlord'}
                  {templateModal.refName ? ` — ${templateModal.refName}` : ''}
                </div>
                <div className="modal-sub">
                  Click any question to copy it. Fill in the [brackets] before sending.
                </div>
              </div>
              <button onClick={() => setTemplateModal(null)} style={{ background: 'none', border: 'none', fontSize: '18px', color: '#9b9b9b', cursor: 'pointer', padding: '2px', lineHeight: 1 }}>✕</button>
            </div>

            {(templateModal.type === 'employer' ? EMPLOYER_QUESTIONS : RESIDENCE_QUESTIONS).map((q, i) => (
              <div
                key={i}
                className="template-q"
                onClick={() => {
                  navigator.clipboard.writeText(q)
                  setCopiedQ(i)
                  setTimeout(() => setCopiedQ(null), 1800)
                }}
              >
                <span style={{ fontSize: '16px', flexShrink: 0 }}>{copiedQ === i ? '✓' : '📋'}</span>
                <span className="template-q-text">{q}</span>
                <span style={{ fontSize: '10px', color: copiedQ === i ? '#10b981' : '#b0a898', flexShrink: 0, fontWeight: 600 }}>
                  {copiedQ === i ? 'Copied!' : 'Copy'}
                </span>
              </div>
            ))}

            <button
              onClick={() => setTemplateModal(null)}
              style={{ marginTop: '12px', width: '100%', background: '#f5f4f0', border: 'none', borderRadius: '9px', padding: '10px', fontSize: '13px', color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* ── CO-SIGNER REQUEST TEMPLATE MODAL ── */}
      {cosignerModal && (() => {
        const first = lead?.first_name?.trim() || 'there'
        const propLine = propertyAddress ? ` to rent ${propertyAddress}` : ''
        const subject = `Next steps on your application${propertyAddress ? ` — ${propertyAddress}` : ''}`
        const body = `Hi ${first},

Thank you for applying${propLine} and for taking the time to complete your application.

After reviewing everything, the income we were able to verify doesn't quite meet our standard requirement of 2.5× the monthly rent. This is very common and does not disqualify you — we'd simply need you to add a co-signer (also called a guarantor) to move forward.

A co-signer is usually a parent or close relative who agrees to cover the rent if you're ever unable to. They'll need to meet the income requirement and complete a quick background and credit check of their own.

If you're able to provide a co-signer, just reply to this email with their full name and email address, and I'll send them the next steps directly. If you have any questions at all, I'm happy to help.

Looking forward to getting you moved in!

Best regards,
[Your name]`
        const fullEmail = `Subject: ${subject}\n\n${body}`
        const copy = (text: string, key: string) => {
          navigator.clipboard.writeText(text)
          setCopiedCosigner(key)
          setTimeout(() => setCopiedCosigner(null), 2000)
        }
        return (
          <div className="modal-overlay" onClick={() => setCosignerModal(false)}>
            <div className="modal-box" style={{ maxWidth: '560px' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                <div>
                  <div className="modal-ttl">👥 Request a Co-signer</div>
                  <div className="modal-sub">Income doesn’t meet the 2.5× rent requirement. Copy this email, then send it to {first} from your inbox.</div>
                </div>
                <button onClick={() => setCosignerModal(false)} style={{ background: 'none', border: 'none', fontSize: '18px', color: '#9b9b9b', cursor: 'pointer', padding: '2px', lineHeight: 1 }}>✕</button>
              </div>

              {/* Subject */}
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '14px 0 6px' }}>Subject</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input readOnly value={subject} onFocus={e => e.currentTarget.select()} style={{ flex: 1, border: '1.5px solid #e8e5de', borderRadius: '9px', padding: '9px 12px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", color: '#1a1a1a', background: '#faf9f6', outline: 'none' }} />
                <button onClick={() => copy(subject, 'subject')} style={{ flexShrink: 0, background: copiedCosigner === 'subject' ? 'rgba(16,185,129,0.08)' : '#faf9f6', border: `1.5px solid ${copiedCosigner === 'subject' ? 'rgba(16,185,129,0.4)' : '#e8e5de'}`, borderRadius: '8px', padding: '9px 12px', fontSize: '12px', fontWeight: 600, color: copiedCosigner === 'subject' ? '#10b981' : '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  {copiedCosigner === 'subject' ? '✓' : 'Copy'}
                </button>
              </div>

              {/* Body */}
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '14px 0 6px' }}>Message</div>
              <textarea readOnly value={body} onFocus={e => e.currentTarget.select()} rows={14} style={{ width: '100%', border: '1.5px solid #e8e5de', borderRadius: '10px', padding: '12px 14px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", color: '#1a1a1a', background: '#faf9f6', outline: 'none', lineHeight: 1.6, resize: 'vertical' }} />

              <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
                <button onClick={() => copy(fullEmail, 'all')} style={{ flex: 2, background: copiedCosigner === 'all' ? '#0f172a' : '#8C1D40', color: '#fff', border: 'none', borderRadius: '9px', padding: '11px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  {copiedCosigner === 'all' ? '✓ Copied!' : '📋 Copy Email'}
                </button>
                <button onClick={() => setCosignerModal(false)} style={{ flex: 1, background: '#f5f4f0', border: 'none', borderRadius: '9px', padding: '11px', fontSize: '13px', color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── CONDITIONAL APPROVAL TEMPLATE MODAL ── */}
      {conditionalModal && (() => {
        const first = lead?.first_name?.trim() || 'there'
        const place = propertyAddress || null
        const subject = `🎉 You're conditionally approved${place ? ` — ${place}` : ''}!`
        const items = pendingItems.split('\n').map(s => s.trim()).filter(Boolean)
        const itemsBlock = items.length
          ? items.map(i => `  ✅  ${i}`).join('\n')
          : '  ✅  [List each outstanding item here — one per line]'
        const body = `Hi ${first}! 🎉

Fantastic news — you've been conditionally approved${place ? ` for ${place}` : ''}! 🏡 We're genuinely excited about the idea of having you as a resident, and we can't wait to get you moved in.

You're almost there! ✨ Just a few quick items left to wrap up before we can finalize everything and prepare your lease:

${itemsBlock}

As soon as these are taken care of, we'll send over your lease and the final next steps right away. 🔑 If anything above is unclear or you have questions, just reply to this email — I'm always happy to help!

Welcome (almost!) home — let's get you settled. 😊

Warm regards,
[Your name]`
        const fullEmail = `Subject: ${subject}\n\n${body}`
        const copy = (text: string, key: string) => {
          navigator.clipboard.writeText(text)
          setCopiedConditional(key)
          setTimeout(() => setCopiedConditional(null), 2000)
        }
        return (
          <div className="modal-overlay" onClick={() => setConditionalModal(false)}>
            <div className="modal-box" style={{ maxWidth: '560px' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                <div>
                  <div className="modal-ttl">📝 Conditional Approval Email</div>
                  <div className="modal-sub">List the pending items below — they’ll appear in the email. Then copy and send it to {first}.</div>
                </div>
                <button onClick={() => setConditionalModal(false)} style={{ background: 'none', border: 'none', fontSize: '18px', color: '#9b9b9b', cursor: 'pointer', padding: '2px', lineHeight: 1 }}>✕</button>
              </div>

              {/* Pending items input */}
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '14px 0 6px' }}>Pending items — one per line</div>
              <textarea
                value={pendingItems}
                onChange={e => setPendingItems(e.target.value)}
                rows={4}
                placeholder={'e.g. Signed co-signer agreement\nProof of renter’s insurance\nFirst month’s rent + deposit'}
                style={{ width: '100%', border: '1.5px solid #e8e5de', borderRadius: '10px', padding: '11px 13px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", color: '#1a1a1a', background: '#fff', outline: 'none', lineHeight: 1.6, resize: 'vertical' }}
                autoFocus
              />

              {/* Subject */}
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '14px 0 6px' }}>Subject</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input readOnly value={subject} onFocus={e => e.currentTarget.select()} style={{ flex: 1, border: '1.5px solid #e8e5de', borderRadius: '9px', padding: '9px 12px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", color: '#1a1a1a', background: '#faf9f6', outline: 'none' }} />
                <button onClick={() => copy(subject, 'subject')} style={{ flexShrink: 0, background: copiedConditional === 'subject' ? 'rgba(16,185,129,0.08)' : '#faf9f6', border: `1.5px solid ${copiedConditional === 'subject' ? 'rgba(16,185,129,0.4)' : '#e8e5de'}`, borderRadius: '8px', padding: '9px 12px', fontSize: '12px', fontWeight: 600, color: copiedConditional === 'subject' ? '#10b981' : '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  {copiedConditional === 'subject' ? '✓' : 'Copy'}
                </button>
              </div>

              {/* Body preview */}
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '14px 0 6px' }}>Message preview</div>
              <textarea readOnly value={body} onFocus={e => e.currentTarget.select()} rows={14} style={{ width: '100%', border: '1.5px solid #e8e5de', borderRadius: '10px', padding: '12px 14px', fontSize: '13px', fontFamily: "'DM Sans', sans-serif", color: '#1a1a1a', background: '#faf9f6', outline: 'none', lineHeight: 1.6, resize: 'vertical' }} />

              <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
                <button onClick={() => copy(fullEmail, 'all')} style={{ flex: 2, background: copiedConditional === 'all' ? '#0f172a' : '#8C1D40', color: '#fff', border: 'none', borderRadius: '9px', padding: '11px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  {copiedConditional === 'all' ? '✓ Copied!' : '📋 Copy Email'}
                </button>
                <button onClick={() => setConditionalModal(false)} style={{ flex: 1, background: '#f5f4f0', border: 'none', borderRadius: '9px', padding: '11px', fontSize: '13px', color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", fontWeight: 600 }}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── EMAIL PREVIEW MODAL ── */}
      {previewRefId && (
        <div className="modal-overlay" onClick={() => { if (!sendingEmail) { setPreviewRefId(null); setPreview(null) } }}>
          <div className="modal-box" style={{ maxWidth: '640px', padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #f0ede6', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="modal-ttl" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {preview ? (preview.refType === 'employer' ? '💼 Employment Verification' : '🏠 Rental Reference') : 'Email Preview'}
                  </div>
                  {preview && (
                    <div style={{ fontSize: '12px', color: '#6b6b6b', marginTop: '6px', lineHeight: 1.6 }}>
                      <div><span style={{ color: '#9b9b9b' }}>To: </span><strong style={{ color: '#1a1a1a' }}>{preview.recipientName ? `${preview.recipientName} · ` : ''}{preview.recipient}</strong></div>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span style={{ color: '#9b9b9b' }}>Subject: </span>{preview.subject}</div>
                    </div>
                  )}
                </div>
                <button onClick={() => { if (!sendingEmail) { setPreviewRefId(null); setPreview(null) } }} disabled={!!sendingEmail} style={{ background: 'none', border: 'none', fontSize: '18px', color: '#9b9b9b', cursor: sendingEmail ? 'not-allowed' : 'pointer', padding: '2px', lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>
            </div>

            {/* Rendered email */}
            <div style={{ flex: 1, overflow: 'auto', background: '#f5f4f0', minHeight: '240px' }}>
              {previewLoading || !preview ? (
                <div style={{ padding: '60px 0', textAlign: 'center', fontSize: '13px', color: '#9b9b9b' }}>Loading preview…</div>
              ) : (
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={preview.html}
                  style={{ width: '100%', height: '420px', border: 'none', display: 'block' }}
                />
              )}
            </div>

            {/* Footer actions */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid #f0ede6', display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ fontSize: '11px', color: '#9b9b9b', flex: 1, lineHeight: 1.4 }}>
                Review the email above. Nothing is sent until you confirm.
              </div>
              <button
                onClick={() => { if (!sendingEmail) { setPreviewRefId(null); setPreview(null) } }}
                disabled={!!sendingEmail}
                className="btn-ghost-sm"
                style={{ padding: '10px 18px' }}
              >
                Cancel
              </button>
              <button
                onClick={() => previewRefId && handleSendEmail(previewRefId)}
                disabled={!preview || !!sendingEmail}
                style={{ background: (!preview || sendingEmail) ? '#9b9b9b' : '#8C1D40', color: '#fff', border: 'none', borderRadius: '9px', padding: '10px 22px', fontSize: '13px', fontWeight: 700, cursor: (!preview || sendingEmail) ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap' }}
              >
                {sendingEmail ? '⏳ Sending…' : '✉ Confirm & Send'}
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RefCard({ ref_, expanded, editing, editForm, statusColors, onToggle, onStatusChange, onEdit, onEditChange, onEditSave, onEditCancel, onDelete, onTemplate, onSendEmail, onCopyEmail, onCopyText, isSending, isCopied, isCopiedText, lastSentAt, sentCount }: {
  ref_: Reference
  expanded: boolean
  editing: boolean
  editForm: Partial<Reference & { income_monthly_str: string }>
  statusColors: Record<Reference['status'], { color: string; bg: string; border: string; label: string }>
  onToggle: () => void
  onStatusChange: (s: Reference['status']) => void
  onEdit: () => void
  onEditChange: (patch: Partial<Reference & { income_monthly_str: string }>) => void
  onEditSave: () => void
  onEditCancel: () => void
  onDelete: () => void
  onTemplate: () => void
  onSendEmail?: () => void
  onCopyEmail?: () => void
  onCopyText?: () => void
  isSending?: boolean
  isCopied?: boolean
  isCopiedText?: boolean
  lastSentAt?: string | null
  sentCount?: number
}) {
  const sc = statusColors[ref_.status]
  return (
    <div className="ref-item" style={{ marginBottom: '8px' }}>
      <div className="ref-item-hd" onClick={onToggle}>
        <div className="ref-icon" style={{ background: ref_.type === 'employer' ? 'rgba(59,130,246,0.1)' : 'rgba(16,185,129,0.1)' }}>
          {ref_.type === 'employer' ? '💼' : '🏠'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ref-name">{ref_.name || (ref_.type === 'employer' ? 'Employer' : 'Residence')}</div>
          <div className="ref-sub" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span>{ref_.phone || ref_.email || ref_.address || '—'}</span>
            {ref_.responses && ref_.responses.length > 0 && (
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#059669', background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.2)', borderRadius: '20px', padding: '1px 7px', lineHeight: 1.6 }}>
                {ref_.responses.length} answers
              </span>
            )}
          </div>
        </div>
        <span className="ref-status-badge" style={{ color: sc.color, background: sc.bg, borderColor: sc.border }}>
          {sc.label}
        </span>
        <span style={{ color: '#9b9b9b', fontSize: '10px', marginLeft: '8px', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="ref-bd">
          {editing ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px', marginBottom: '0' }}>
                <input className="edit-input" placeholder={ref_.type === 'employer' ? 'Company name' : 'Landlord / property name'} value={editForm.name || ''} onChange={e => onEditChange({ name: e.target.value })} />
                {ref_.type === 'employer' && (
                  <input className="edit-input" placeholder="Manager / supervisor name (optional)" value={editForm.manager_name || ''} onChange={e => onEditChange({ manager_name: e.target.value })} />
                )}
                <input className="edit-input" placeholder="Phone" value={editForm.phone || ''} onChange={e => onEditChange({ phone: e.target.value })} />
                <input className="edit-input" placeholder="Email" value={editForm.email || ''} onChange={e => onEditChange({ email: e.target.value })} />
                {ref_.type === 'residence' && (
                  <input className="edit-input" type="date" placeholder="Contact date" value={editForm.contact_date || ''} onChange={e => onEditChange({ contact_date: e.target.value })} />
                )}
              </div>
              <input className="edit-input" placeholder={ref_.type === 'employer' ? 'Company address (optional)' : 'Property address'} value={editForm.address || ''} onChange={e => onEditChange({ address: e.target.value })} />
              {ref_.type === 'employer' && (
                <input
                  className="edit-input"
                  type="number"
                  min={0}
                  placeholder="Monthly gross income (e.g. 4500)"
                  value={editForm.income_monthly_str || ''}
                  onChange={e => onEditChange({ income_monthly_str: e.target.value, income_monthly: e.target.value ? parseInt(e.target.value) : null })}
                />
              )}
              <textarea className="edit-input" rows={3} placeholder="Notes…" style={{ resize: 'vertical', minHeight: '60px' }} value={editForm.notes || ''} onChange={e => onEditChange({ notes: e.target.value })} />
              <div style={{ display: 'flex', gap: '7px' }}>
                <button onClick={onEditSave} style={{ flex: 2, background: '#8C1D40', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>Save</button>
                <button onClick={onEditCancel} className="btn-ghost-sm" style={{ flex: 1 }}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                {ref_.type === 'employer' && ref_.manager_name && (
                  <span style={{ fontSize: '12px', color: '#1a1a1a', fontWeight: 600 }}>👤 {ref_.manager_name}</span>
                )}
                {ref_.phone && <a href={`tel:${ref_.phone}`} style={{ fontSize: '12px', color: '#3b82f6', textDecoration: 'none' }}>📞 {ref_.phone}</a>}
                {ref_.email && <a href={`mailto:${ref_.email}`} style={{ fontSize: '12px', color: '#3b82f6', textDecoration: 'none' }}>✉ {ref_.email}</a>}
                {ref_.address && <span style={{ fontSize: '12px', color: '#6b6b6b' }}>📍 {ref_.address}</span>}
                {ref_.type === 'residence' && ref_.contact_date && <span style={{ fontSize: '12px', color: '#6b6b6b' }}>📅 Contacted {new Date(ref_.contact_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                {ref_.type === 'employer' && ref_.income_monthly != null && (
                  <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>
                    💵 ${ref_.income_monthly.toLocaleString()}/mo
                  </span>
                )}
              </div>
              {ref_.notes && (
                <div style={{ background: '#faf9f6', border: '1px solid #f0ede6', borderRadius: '7px', padding: '8px 10px', fontSize: '12px', color: '#4a4a4a', lineHeight: 1.55, marginBottom: '10px', fontStyle: 'italic' }}>
                  {ref_.notes}
                </div>
              )}

              {ref_.responses && ref_.responses.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                    Reference Form Responses
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {ref_.responses.map((r, i) => {
                      const isYesNo = r.answer === 'yes' || r.answer === 'no'
                      const isAdditional = r.question === 'Additional notes'
                      return (
                        <div key={i} style={{ background: '#faf9f6', border: '1px solid #f0ede6', borderRadius: '9px', padding: '10px 12px' }}>
                          <div style={{ fontSize: '11px', color: '#9b9b9b', fontWeight: 600, marginBottom: '5px', lineHeight: 1.4 }}>
                            {r.question}
                          </div>
                          {isAdditional ? (
                            <div style={{ fontSize: '13px', color: '#3a3a3a', lineHeight: 1.6, fontStyle: 'italic' }}>
                              "{r.answer}"
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                                background: isYesNo
                                  ? (r.answer === 'yes' ? 'rgba(5,150,105,0.1)' : 'rgba(220,38,38,0.08)')
                                  : r.answer === '—' ? '#f5f4f0' : 'rgba(26,26,26,0.07)',
                                color: isYesNo
                                  ? (r.answer === 'yes' ? '#059669' : '#dc2626')
                                  : r.answer === '—' ? '#9b9b9b' : '#1a1a1a',
                                border: `1px solid ${isYesNo
                                  ? (r.answer === 'yes' ? 'rgba(5,150,105,0.2)' : 'rgba(220,38,38,0.2)')
                                  : r.answer === '—' ? '#e8e5de' : 'rgba(26,26,26,0.12)'}`,
                              }}>
                                {isYesNo ? (r.answer === 'yes' ? '✓ Yes' : '✕ No') : r.answer}
                              </span>
                              {r.detail && (
                                <span style={{ fontSize: '12px', color: '#6b6b6b', lineHeight: 1.5, fontStyle: 'italic', paddingTop: '3px' }}>
                                  — {r.detail}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {(onSendEmail || onCopyEmail || onCopyText) && (
                <div style={{ display: 'flex', gap: '6px', marginBottom: lastSentAt ? '6px' : '10px', flexWrap: 'wrap' }}>
                  {onSendEmail && (
                    <button
                      onClick={onSendEmail}
                      disabled={isSending}
                      style={{ flex: 1, minWidth: '90px', background: isSending ? '#9b9b9b' : '#8C1D40', color: '#fff', border: 'none', borderRadius: '7px', padding: '7px 10px', fontSize: '11px', fontWeight: 700, cursor: isSending ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif", opacity: isSending ? 0.7 : 1 }}
                    >
                      {isSending ? '⏳ Sending…' : lastSentAt ? '✉ Preview & Resend' : '✉ Preview & Send'}
                    </button>
                  )}
                  {onCopyEmail && (
                    <button
                      onClick={onCopyEmail}
                      style={{ flex: 1, minWidth: '90px', background: isCopied ? 'rgba(16,185,129,0.08)' : '#faf9f6', border: `1.5px solid ${isCopied ? 'rgba(16,185,129,0.4)' : '#e8e5de'}`, borderRadius: '7px', padding: '7px 10px', fontSize: '11px', fontWeight: 600, color: isCopied ? '#10b981' : '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                    >
                      {isCopied ? '✓ Copied!' : '📋 Copy Email'}
                    </button>
                  )}
                  {onCopyText && (
                    <button
                      onClick={onCopyText}
                      style={{ flex: 1, minWidth: '90px', background: isCopiedText ? 'rgba(59,130,246,0.08)' : '#faf9f6', border: `1.5px solid ${isCopiedText ? 'rgba(59,130,246,0.4)' : '#e8e5de'}`, borderRadius: '7px', padding: '7px 10px', fontSize: '11px', fontWeight: 600, color: isCopiedText ? '#3b82f6' : '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}
                    >
                      {isCopiedText ? '✓ Copied!' : '💬 Copy Text'}
                    </button>
                  )}
                </div>
              )}

              {lastSentAt && (
                <div style={{ fontSize: '10px', color: '#9b9b9b', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ color: '#10b981' }}>✓</span>
                  Email sent {timeAgo(lastSentAt)}{sentCount && sentCount > 1 ? ` · ${sentCount} sent total` : ''}
                </div>
              )}

              <div style={{ fontSize: '10px', fontWeight: 700, color: '#9b9b9b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Status</div>
              <div className="status-cycle">
                {(ref_.type === 'employer'
                  ? (['pending','verified','unverified'] as Reference['status'][])
                  : (['pending','contacted','verified','unverified'] as Reference['status'][])
                ).map(s => {
                  const c = { pending: '#9b9b9b', contacted: '#f97316', verified: '#10b981', unverified: '#ef4444' }[s]
                  return (
                    <button
                      key={s}
                      className="status-opt"
                      style={{ color: ref_.status === s ? c : '#9b9b9b', borderColor: ref_.status === s ? c : '#e8e5de', background: ref_.status === s ? `${c}15` : '#fff' }}
                      onClick={() => onStatusChange(s)}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  )
                })}
              </div>

              <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                <button onClick={onTemplate} style={{ flex: 1, background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '7px', padding: '7px', fontSize: '11px', fontWeight: 600, color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  📋 Template Questions
                </button>
                <button onClick={onEdit} style={{ flex: 1, background: '#faf9f6', border: '1.5px solid #e8e5de', borderRadius: '7px', padding: '7px', fontSize: '11px', fontWeight: 600, color: '#6b6b6b', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  ✎ Edit
                </button>
                <button onClick={onDelete} style={{ background: 'rgba(239,68,68,0.06)', border: '1.5px solid rgba(239,68,68,0.25)', borderRadius: '7px', padding: '7px 10px', fontSize: '11px', fontWeight: 600, color: '#dc2626', cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  ✕
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function AddRefForm({ type, form, saving, onChange, onSave, onCancel }: {
  type: 'employer' | 'residence'
  form: { name: string; manager_name: string; phone: string; email: string; address: string; contact_date: string; notes: string; income_monthly: string }
  saving: boolean
  onChange: (patch: Partial<typeof form>) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="add-ref-form">
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#8C1D40', marginBottom: '10px' }}>
        {type === 'employer' ? '💼 Add Employer' : '🏠 Add Previous Residence'}
      </div>
      <div className="edit-row">
        <input className="edit-input" placeholder={type === 'employer' ? 'Company name' : 'Landlord / property name'} value={form.name} onChange={e => onChange({ name: e.target.value })} />
        {type === 'employer'
          ? <input className="edit-input" placeholder="Manager / supervisor name (optional)" value={form.manager_name} onChange={e => onChange({ manager_name: e.target.value })} />
          : null
        }
        <input className="edit-input" placeholder="Phone" value={form.phone} onChange={e => onChange({ phone: e.target.value })} />
        <input className="edit-input" placeholder="Email" value={form.email} onChange={e => onChange({ email: e.target.value })} />
        {type === 'residence' && (
          <input className="edit-input" type="date" value={form.contact_date} onChange={e => onChange({ contact_date: e.target.value })} />
        )}
      </div>
      <input className="edit-input" placeholder={type === 'employer' ? 'Company address (optional)' : 'Property address'} value={form.address} onChange={e => onChange({ address: e.target.value })} />
      {type === 'employer' && (
        <input
          className="edit-input"
          type="number"
          min={0}
          placeholder="Monthly gross income (e.g. 4500)"
          value={form.income_monthly}
          onChange={e => onChange({ income_monthly: e.target.value })}
        />
      )}
      <textarea className="edit-input" rows={2} placeholder="Notes…" style={{ resize: 'vertical' }} value={form.notes} onChange={e => onChange({ notes: e.target.value })} />
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onSave} disabled={saving} style={{ flex: 2, background: saving ? '#9b9b9b' : '#8C1D40', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px', fontSize: '13px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
          {saving ? 'Adding…' : `Add ${type === 'employer' ? 'Employer' : 'Residence'}`}
        </button>
        <button onClick={onCancel} className="btn-ghost-sm">Cancel</button>
      </div>
    </div>
  )
}

// ── Status flow graphic ─────────────────────────────────────────────────────────

function StatusFlow({ status, tenantCreated }: { status: BgStatus; tenantCreated: boolean }) {
  if (status === 'declined') {
    return (
      <div style={{ background: 'rgba(239,68,68,0.05)', border: '1.5px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'rgba(239,68,68,0.12)', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '17px', flexShrink: 0 }}>✕</div>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#dc2626' }}>Application Declined</div>
          <div style={{ fontSize: '12px', color: '#9b9b9b', marginTop: '1px' }}>This background check was closed as declined. You can reopen it from the actions panel.</div>
        </div>
      </div>
    )
  }

  const nodes = [...STATUS_FLOW.map(s => s.label), 'Tenant Created']
  const currentIndex = tenantCreated ? 4 : STATUS_INDEX[status]

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: '4px' }}>
      {nodes.map((label, i) => {
        const done = i < currentIndex || (i === currentIndex && i === 4)
        const active = i === currentIndex && i !== 4
        const circleStyle: React.CSSProperties = done
          ? { background: '#8C1D40', color: '#fff', border: '2px solid #8C1D40' }
          : active
            ? { background: '#fff', color: '#8C1D40', border: '2px solid #8C1D40', boxShadow: '0 0 0 4px rgba(140,29,64,0.1)' }
            : { background: '#f0ede6', color: '#b0a898', border: '2px solid #e8e5de' }
        return (
          <Fragment key={label}>
            {i > 0 && (
              <div style={{ flex: 1, height: '2px', minWidth: '20px', background: i <= currentIndex ? '#8C1D40' : '#e8e5de', marginTop: '15px' }} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: '92px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, transition: 'all 0.2s', ...circleStyle }}>
                {done ? (i === 4 ? '👤' : '✓') : (i + 1)}
              </div>
              <div style={{ fontSize: '10.5px', fontWeight: active ? 700 : 600, color: active ? '#8C1D40' : done ? '#1a1a1a' : '#9b9b9b', textAlign: 'center', marginTop: '7px', lineHeight: 1.3 }}>
                {label}
              </div>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
