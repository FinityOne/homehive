import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type PropertyFaq = {
  id: string
  property_id: string
  question: string
  answer: string
  category: string
  position: number
  created_at?: string
  updated_at?: string
}

export type NewFaqInput = {
  question: string
  answer: string
  category: string
  position?: number
}

// Preset categories surfaced as suggestions in the editor and used to group FAQs.
export const FAQ_CATEGORIES = [
  'General',
  'Costs & Utilities',
  'Amenities',
  'Location & Transport',
  'Rooms & Layout',
  'Lease & Application',
  'Tours & Move-in',
  'Pets',
] as const

// Curated questions students commonly ask, grouped by category. Landlords can
// one-click add any of these and then fill in their own answer.
export const RECOMMENDED_FAQS: { category: string; question: string }[] = [
  { category: 'Costs & Utilities', question: 'How much are utilities and what’s included in rent?' },
  { category: 'Costs & Utilities', question: 'What is the security deposit, and is it refundable?' },
  { category: 'Costs & Utilities', question: 'Are there any additional fees (application, admin, parking)?' },
  { category: 'Amenities', question: 'Is the unit furnished or unfurnished?' },
  { category: 'Amenities', question: 'Is there in-unit laundry, or shared laundry on-site?' },
  { category: 'Amenities', question: 'Is there air conditioning and heating?' },
  { category: 'Amenities', question: 'Is high-speed internet / WiFi included?' },
  { category: 'Amenities', question: 'Is there a gym, pool, or other shared amenities?' },
  { category: 'Location & Transport', question: 'How far is it from ASU campus, and how do students usually get there?' },
  { category: 'Location & Transport', question: 'Is parking available, and is it included?' },
  { category: 'Location & Transport', question: 'What grocery stores, restaurants, and transit are nearby?' },
  { category: 'Rooms & Layout', question: 'How big are the bedrooms?' },
  { category: 'Rooms & Layout', question: 'Do the bedrooms have private bathrooms?' },
  { category: 'Rooms & Layout', question: 'Are rooms assigned, or can I choose my room?' },
  { category: 'Rooms & Layout', question: 'How many roommates will I have, and how are they matched?' },
  { category: 'Lease & Application', question: 'What is the lease length, and are there flexible terms?' },
  { category: 'Lease & Application', question: 'What does the application process look like?' },
  { category: 'Lease & Application', question: 'Is a co-signer or guarantor required?' },
  { category: 'Tours & Move-in', question: 'Can I schedule a tour, and how?' },
  { category: 'Tours & Move-in', question: 'When is the unit available for move-in?' },
  { category: 'Pets', question: 'Are pets allowed, and is there a pet deposit or fee?' },
]

// Fetch FAQs for a property id. Works for both the landlord (own listing via
// RLS) and the public site (active listings via RLS).
export async function getFaqsByPropertyId(propertyId: string): Promise<PropertyFaq[]> {
  const { data, error } = await supabase
    .from('property_faqs')
    .select('*')
    .eq('property_id', propertyId)
    .order('position', { ascending: true })

  if (error || !data) {
    if (error) console.error('Error fetching FAQs:', error)
    return []
  }
  return data as PropertyFaq[]
}

// Public fetch by slug — resolves the active listing, then its FAQs.
export async function getFaqsBySlug(slug: string): Promise<PropertyFaq[]> {
  const { data: prop } = await supabase
    .from('properties')
    .select('id')
    .eq('slug', slug)
    .eq('is_active', true)
    .eq('is_test', false)
    .maybeSingle()

  if (!prop?.id) return []
  return getFaqsByPropertyId(prop.id)
}

export async function createFaq(propertyId: string, input: NewFaqInput): Promise<{ data: PropertyFaq | null; error: any }> {
  const { data, error } = await supabase
    .from('property_faqs')
    .insert({
      property_id: propertyId,
      question: input.question,
      answer: input.answer,
      category: input.category || 'General',
      position: input.position ?? 0,
    })
    .select('*')
    .single()
  return { data: (data as PropertyFaq) ?? null, error }
}

export async function updateFaq(
  id: string,
  updates: Partial<Pick<PropertyFaq, 'question' | 'answer' | 'category' | 'position'>>
): Promise<{ error: any }> {
  const { error } = await supabase.from('property_faqs').update(updates).eq('id', id)
  return { error }
}

export async function deleteFaq(id: string): Promise<{ error: any }> {
  const { error } = await supabase.from('property_faqs').delete().eq('id', id)
  return { error }
}

// Persist a new ordering. Updates each row's position to its array index.
export async function reorderFaqs(orderedIds: string[]): Promise<{ error: any }> {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('property_faqs').update({ position: i }).eq('id', orderedIds[i])
    if (error) return { error }
  }
  return { error: null }
}
