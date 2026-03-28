'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LandlordSignupRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/signup?role=landlord') }, [router])
  return null
}
