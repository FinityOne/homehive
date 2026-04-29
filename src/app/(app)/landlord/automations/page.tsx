'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type AutomationLog = {
  id: string
  created_at: string
  source: string
  parsed_address: string | null
  property_name: string | null
  lead_name: string | null
  lead_email: string | null
  status: 'processing' | 'success' | 'failed'
  error_message: string | null
}

const STATUS_META = {
  success:    { label: 'Success',    color: '#16a34a', bg: 'rgba(22,163,74,0.08)',   border: 'rgba(22,163,74,0.25)' },
  failed:     { label: 'Failed',     color: '#dc2626', bg: 'rgba(220,38,38,0.08)',   border: 'rgba(220,38,38,0.25)' },
  processing: { label: 'Processing', color: '#d97706', bg: 'rgba(217,119,6,0.08)',   border: 'rgba(217,119,6,0.25)' },
}

export default function AutomationsPage() {
  const [logs, setLogs]           = useState<AutomationLog[]>([])
  const [loading, setLoading]     = useState(true)
  const [copied, setCopied]       = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'setup'>('overview')

  const webhookUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://homehive.live'}/api/inbound-email`

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('lead_automation_logs')
        .select('id, created_at, source, parsed_address, property_name, lead_name, lead_email, status, error_message')
        .order('created_at', { ascending: false })
        .limit(50)

      setLogs((data || []) as AutomationLog[])
      setLoading(false)
    }
    load()
  }, [])

  const successCount = logs.filter(l => l.status === 'success').length
  const failedCount  = logs.filter(l => l.status === 'failed').length

  const copyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 20px' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(140,29,64,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
            ⚡
          </div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#0f172a' }}>Automations</h1>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>
          Auto-capture leads from listing platforms and route them directly into your pipeline.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e2e8f0', marginBottom: 28 }}>
        {(['overview', 'logs', 'setup'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? '#8C1D40' : '#64748b',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #8C1D40' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div>
          {/* Redfin integration card */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ background: '#fff', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#fff', fontSize: 22, fontWeight: 700, fontStyle: 'italic', lineHeight: 1 }}>R</span>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>Redfin</div>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Auto-capture inbound listing inquiries</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {logs.length > 0 ? (
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', borderRadius: 20, padding: '4px 12px' }}>
                    ● Active
                  </span>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#d97706', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', borderRadius: 20, padding: '4px 12px' }}>
                    ○ Setup needed
                  </span>
                )}
                <button
                  onClick={() => setActiveTab('setup')}
                  style={{ fontSize: 13, fontWeight: 500, color: '#8C1D40', background: 'none', border: '1px solid #8C1D40', borderRadius: 8, padding: '6px 14px', cursor: 'pointer' }}
                >
                  View setup →
                </button>
              </div>
            </div>

            <div style={{ background: '#f8fafc', borderTop: '1px solid #e2e8f0', padding: '16px 24px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { label: 'Total captured',   value: logs.length,   color: '#0f172a' },
                { label: 'Leads created',    value: successCount,  color: '#16a34a' },
                { label: 'Errors',           value: failedCount,   color: failedCount > 0 ? '#dc2626' : '#64748b' },
              ].map(stat => (
                <div key={stat.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {logs.length > 0 && (
              <div style={{ background: '#fff', borderTop: '1px solid #e2e8f0', padding: '14px 24px' }}>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Recent activity
                </div>
                {logs.slice(0, 3).map(log => (
                  <div key={log.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                        {log.lead_name || log.lead_email || 'Unknown'}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {log.property_name || log.parsed_address || '—'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{fmtDate(log.created_at)}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_META[log.status]?.color, background: STATUS_META[log.status]?.bg, border: `1px solid ${STATUS_META[log.status]?.border}`, borderRadius: 20, padding: '2px 8px' }}>
                        {STATUS_META[log.status]?.label}
                      </span>
                    </div>
                  </div>
                ))}
                {logs.length > 3 && (
                  <button onClick={() => setActiveTab('logs')} style={{ marginTop: 10, fontSize: 13, color: '#8C1D40', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                    View all {logs.length} logs →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Coming soon card */}
          <div style={{ border: '1px dashed #e2e8f0', borderRadius: 14, padding: '20px 24px', background: '#f8fafc' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>More integrations coming soon</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {['Zillow', 'Apartments.com', 'Facebook Marketplace', 'Craigslist'].map(name => (
                <span key={name} style={{ fontSize: 13, color: '#94a3b8', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 14px' }}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Logs Tab */}
      {activeTab === 'logs' && (
        <div>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Loading logs...</div>
          ) : logs.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', border: '1px dashed #e2e8f0', borderRadius: 14, color: '#94a3b8' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: '#64748b' }}>No automation logs yet</div>
              <div style={{ fontSize: 13 }}>Once you set up Gmail forwarding, leads will appear here automatically.</div>
            </div>
          ) : (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 80px', background: '#f8fafc', padding: '10px 20px', borderBottom: '1px solid #e2e8f0', gap: 12 }}>
                {['Lead', 'Property', 'Date', 'Status'].map(h => (
                  <div key={h} style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</div>
                ))}
              </div>
              {logs.map((log, i) => (
                <div key={log.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 80px', padding: '14px 20px', gap: 12, borderBottom: i < logs.length - 1 ? '1px solid #f1f5f9' : 'none', background: '#fff', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{log.lead_name || '—'}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{log.lead_email || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: '#0f172a' }}>{log.property_name || '—'}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{log.parsed_address || '—'}</div>
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b' }}>{fmtDate(log.created_at)}</div>
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_META[log.status]?.color, background: STATUS_META[log.status]?.bg, border: `1px solid ${STATUS_META[log.status]?.border}`, borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap' }}>
                      {STATUS_META[log.status]?.label}
                    </span>
                    {log.error_message && (
                      <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }} title={log.error_message}>
                        ⚠ {log.error_message.slice(0, 40)}{log.error_message.length > 40 ? '…' : ''}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Setup Tab */}
      {activeTab === 'setup' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Step 1: Resend inbound */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ background: '#0f172a', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#8C1D40', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>1</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Configure Resend Inbound Email</span>
            </div>
            <div style={{ background: '#fff', padding: '20px 24px' }}>
              <p style={{ margin: '0 0 14px', fontSize: 14, color: '#374151', lineHeight: 1.7 }}>
                In your <strong>Resend dashboard</strong>, go to <strong>Emails → Inbound</strong> and add a new inbound address (e.g. <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, fontSize: 13 }}>leads@homehive.live</code>). Set the webhook URL to:
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
                <code style={{ flex: 1, fontSize: 13, color: '#0f172a', wordBreak: 'break-all' }}>{webhookUrl}</code>
                <button
                  onClick={copyWebhook}
                  style={{ fontSize: 12, fontWeight: 600, color: copied ? '#16a34a' : '#8C1D40', background: copied ? 'rgba(22,163,74,0.08)' : 'rgba(140,29,64,0.08)', border: `1px solid ${copied ? 'rgba(22,163,74,0.3)' : 'rgba(140,29,64,0.3)'}`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer', flexShrink: 0 }}
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
                Resend will POST the email payload to this URL every time an inbound email arrives.
              </p>
            </div>
          </div>

          {/* Step 2: Gmail filter */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ background: '#0f172a', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#8C1D40', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>2</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Set up Gmail Auto-Forwarding</span>
            </div>
            <div style={{ background: '#fff', padding: '20px 24px' }}>
              <p style={{ margin: '0 0 14px', fontSize: 14, color: '#374151', lineHeight: 1.7 }}>
                In Gmail, create a filter to auto-forward Redfin lead emails to your Resend inbound address:
              </p>
              <ol style={{ margin: '0 0 14px', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, color: '#374151', lineHeight: 1.7 }}>
                <li>Open Gmail → Settings (⚙️) → <strong>See all settings</strong> → <strong>Filters and Blocked Addresses</strong></li>
                <li>Click <strong>Create a new filter</strong></li>
                <li>
                  In the <strong>Subject</strong> field, enter:
                  <div style={{ marginTop: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px' }}>
                    <code style={{ fontSize: 13, color: '#0f172a' }}>New lead for:</code>
                  </div>
                </li>
                <li>Click <strong>Create filter</strong> → check <strong>Forward it to</strong> → enter your Resend inbound address</li>
                <li>Save the filter</li>
              </ol>
              <div style={{ background: '#fef3cd', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#92400e' }}>
                <strong>Note:</strong> Gmail requires you to verify the forwarding address first. Resend will send a confirmation email — click the link to confirm.
              </div>
            </div>
          </div>

          {/* Step 3: Property addresses */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ background: '#0f172a', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#8C1D40', color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>3</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Verify Property Addresses Match Redfin</span>
            </div>
            <div style={{ background: '#fff', padding: '20px 24px' }}>
              <p style={{ margin: 0, fontSize: 14, color: '#374151', lineHeight: 1.7 }}>
                The automation matches incoming Redfin addresses against your HomeHive property listings. Make sure the street address in your <a href="/landlord/listings" style={{ color: '#8C1D40', textDecoration: 'none', fontWeight: 600 }}>listings</a> matches what Redfin shows (e.g. <em>1234 E University Dr, Tempe, AZ</em>). The first line of the address is used for matching.
              </p>
            </div>
          </div>

          {/* How it works summary */}
          <div style={{ border: '1px solid rgba(140,29,64,0.2)', borderRadius: 14, padding: '20px 24px', background: 'rgba(140,29,64,0.03)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#8C1D40', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>How it works end-to-end</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                'Redfin prospect submits inquiry on your listing',
                'Redfin emails you at your Gmail workspace address',
                'Gmail filter forwards it to your Resend inbound address',
                'HomeHive receives the email, extracts the lead + address',
                'Lead is matched to your property and automatically created',
                'Pre-screen invitation is sent to the prospect instantly',
                'You see the new lead in your Leads dashboard with source "Redfin"',
              ].map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#374151' }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(140,29,64,0.1)', color: '#8C1D40', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
                  {step}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
