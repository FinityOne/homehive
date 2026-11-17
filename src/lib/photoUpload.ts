/**
 * Getting a photo off a phone and into a storage bucket.
 *
 * Extracted from `inspections.ts`, which learned all of this the hard way; the
 * maintenance photos needed the same two rules, and a second copy of them is a
 * second place to forget one.
 *
 * Rule 1 — **derive the content type from the extension, not the browser.**
 * Our buckets restrict `allowed_mime_types`, and iOS often reports an empty
 * `File.type` for HEIC while some browsers send `application/octet-stream`.
 * supabase-js passes that straight through and the bucket answers **415
 * invalid_mime_type**, so an unlabelled file is simply rejected.
 *
 * Rule 2 — **never use the user's filename as the object key.** Spaces, unicode
 * and `#` all produce keys that either fail to upload or cannot be fetched
 * back.
 *
 * Rule 3 lives at every call site rather than here, because it is about the DOM
 * and not about storage: `input.files` is a **live FileList**, and the usual
 * `e.target.value = ''` reset empties it. Snapshot it with `Array.from` inside
 * the event handler, before the reset, or an async upload sees zero files and
 * no-ops in silence. Every function here takes `File[]`, never `FileList`, so
 * the snapshot has to have happened before you can call it.
 */

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', avif: 'image/avif',
}

export function resolveUpload(file: File): { ext: string; contentType: string } {
  const rawExt = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const byExt = MIME_BY_EXT[rawExt]
  const byBrowser = file.type && file.type.startsWith('image/') ? file.type : null
  const contentType = byExt ?? byBrowser ?? 'image/jpeg'
  const ext = rawExt || (contentType.split('/')[1] || 'jpg')
  return { ext, contentType }
}

/**
 * An object key that is unique, unguessable and safe in a URL.
 *
 * The leading `ownerId` segment is not decoration: every one of these buckets
 * has a storage policy of the form `(storage.foldername(name))[1] =
 * auth.uid()`, so a key that does not start with the uploader's id is refused.
 */
export function objectKey(ownerId: string, folders: string[], ext: string): string {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return [ownerId, ...folders.filter(Boolean), `${stamp}.${ext}`].join('/')
}
