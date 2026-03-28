// Re-export the posthog instance for use in non-React contexts (e.g., server utilities)
// For React components, prefer `usePostHog()` from 'posthog-js/react'
import posthog from 'posthog-js'

export { posthog }
