/**
 * Progress on a maintenance job — the landlord's side.
 *
 * `tenant_note` on the item says what a job *is*. This says what has *happened*
 * to it, and it has to be a log rather than a field: there is only one
 * `tenant_note`, so a landlord who edits it to "all done" destroys the sentence
 * that explained the job in the first place, and a tenant reading only the
 * latest state cannot tell a job that is moving from one that is stuck.
 *
 * An update carries a note, photos, or both, and **one** sharing flag covering
 * the whole thing — see the migration for why that isn't per-photo. A private
 * update is a work diary entry: the before-photos for an insurance claim, the
 * quote that came in, what the contractor actually said.
 *
 * Reads and writes go direct through RLS (owner-only, and the policy checks the
 * *item's* owner too, so an update cannot be hung off someone else's job).
 * Unlike item creation there is no email to force through a route, so there is
 * nothing for a server hop to protect.
 */

import { supabase } from '@/lib/supabase'
import { resolveUpload, objectKey } from '@/lib/photoUpload'

export const MAINTENANCE_PHOTO_BUCKET = 'maintenance-photos'

/** Matches the bucket's own limit; checked client-side so the error is useful. */
export const MAX_PHOTO_BYTES = 26214400

export type WorkItemPhoto = {
  id: string
  update_id: string
  url: string
  storage_path: string | null
  caption: string | null
  position: number
  created_at: string
}

export type WorkItemUpdate = {
  id: string
  owner_id: string
  work_item_id: string
  body: string | null
  tenant_visible: boolean
  created_at: string
  updated_at: string
  photos: WorkItemPhoto[]
}

const SELECT = `
  id, owner_id, work_item_id, body, tenant_visible, created_at, updated_at,
  photos:work_item_photos ( id, update_id, url, storage_path, caption, position, created_at )
`

const sortPhotos = (p: WorkItemPhoto[]) =>
  [...p].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))

function map(row: Record<string, unknown>): WorkItemUpdate {
  const photos = (row.photos as WorkItemPhoto[] | null) ?? []
  return { ...(row as unknown as WorkItemUpdate), photos: sortPhotos(photos) }
}

/**
 * Every update on a set of items, newest first.
 *
 * Fetched for the whole list in one query rather than per row — a portfolio
 * with sixty jobs on it should not open sixty requests, and the landlord list
 * wants a per-row count before anything is expanded.
 */
export async function getUpdatesForItems(
  itemIds: string[],
): Promise<Record<string, WorkItemUpdate[]>> {
  if (itemIds.length === 0) return {}
  const { data, error } = await supabase
    .from('work_item_updates')
    .select(SELECT)
    .in('work_item_id', itemIds)
    .order('created_at', { ascending: false })
  if (error || !data) return {}

  const byItem: Record<string, WorkItemUpdate[]> = {}
  for (const row of data) {
    const u = map(row as Record<string, unknown>)
    ;(byItem[u.work_item_id] ??= []).push(u)
  }
  return byItem
}

export async function addUpdate(input: {
  workItemId: string
  ownerId: string
  body: string | null
  tenantVisible: boolean
}): Promise<{ update: WorkItemUpdate | null; error: string | null }> {
  const body = input.body?.trim() || null
  const { data, error } = await supabase
    .from('work_item_updates')
    .insert({
      owner_id: input.ownerId,
      work_item_id: input.workItemId,
      body,
      tenant_visible: input.tenantVisible,
    })
    .select(SELECT)
    .single()
  if (error || !data) return { update: null, error: 'Could not save that update.' }
  return { update: map(data as Record<string, unknown>), error: null }
}

export async function setUpdateShared(
  id: string,
  tenantVisible: boolean,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('work_item_updates')
    .update({ tenant_visible: tenantVisible, updated_at: new Date().toISOString() })
    .eq('id', id)
  return { error: error ? 'Could not change who can see that update.' : null }
}

export async function setUpdateBody(
  id: string,
  body: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('work_item_updates')
    .update({ body: body?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
  return { error: error ? 'Could not save that note.' : null }
}

/**
 * Delete an update, and the files behind its photos.
 *
 * The rows would cascade on their own, but the *objects* would not — a cascade
 * deletes the row that remembers `storage_path` and leaves the file paid for
 * and unreachable forever. Files first, therefore, and a failure there is
 * swallowed: a landlord asking to remove a note must not be blocked by a
 * storage hiccup, and an orphaned object is the cheaper of the two failures.
 */
export async function deleteUpdate(update: WorkItemUpdate): Promise<{ error: string | null }> {
  const paths = update.photos.map(p => p.storage_path).filter((p): p is string => !!p)
  if (paths.length > 0) {
    await supabase.storage.from(MAINTENANCE_PHOTO_BUCKET).remove(paths).catch(() => {})
  }
  const { error } = await supabase.from('work_item_updates').delete().eq('id', update.id)
  return { error: error ? 'Could not delete that update.' : null }
}

export async function deletePhoto(photo: WorkItemPhoto): Promise<{ error: string | null }> {
  if (photo.storage_path) {
    await supabase.storage.from(MAINTENANCE_PHOTO_BUCKET).remove([photo.storage_path]).catch(() => {})
  }
  const { error } = await supabase.from('work_item_photos').delete().eq('id', photo.id)
  return { error: error ? 'Could not remove that photo.' : null }
}

/**
 * Where a maintenance photo lives in the bucket.
 *
 * The first segment **must** be the owner's uid: the storage policies are
 * `(storage.foldername(name))[1] = auth.uid()`, so a key shaped any other way
 * is refused on upload. Changing this without changing the migration breaks
 * uploads silently-ish (a 403 in a toast).
 */
export const maintenancePhotoPath = (ownerId: string, updateId: string, ext: string) =>
  objectKey(ownerId, ['updates', updateId], ext)

/**
 * Upload photos onto an update.
 *
 * Takes `File[]`, never a `FileList`: `input.files` is live, and the usual
 * `e.target.value = ''` reset empties it, so an async upload that reads the
 * list after its first `await` sees zero files and no-ops in silence. Callers
 * must snapshot with `Array.from` inside the event handler.
 *
 * Partial success is reported rather than thrown. Five photos where the third
 * is a 40MB HEIC should store four and say so — rejecting the batch loses the
 * landlord's other four uploads and their patience.
 */
export async function addPhotos(input: {
  updateId: string
  ownerId: string
  files: File[]
  startPosition?: number
}): Promise<{ photos: WorkItemPhoto[]; failed: string[] }> {
  const photos: WorkItemPhoto[] = []
  const failed: string[] = []
  let position = input.startPosition ?? 0

  for (const file of input.files) {
    if (file.size > MAX_PHOTO_BYTES) {
      failed.push(`${file.name} is too large (max 25MB)`)
      continue
    }
    const { ext, contentType } = resolveUpload(file)
    const path = maintenancePhotoPath(input.ownerId, input.updateId, ext)

    const { error: upErr } = await supabase.storage
      .from(MAINTENANCE_PHOTO_BUCKET)
      .upload(path, file, { contentType, upsert: false })
    if (upErr) { failed.push(`${file.name} wouldn't upload`); continue }

    const { data: { publicUrl } } = supabase.storage
      .from(MAINTENANCE_PHOTO_BUCKET).getPublicUrl(path)

    const { data, error } = await supabase
      .from('work_item_photos')
      .insert({
        owner_id: input.ownerId,
        update_id: input.updateId,
        url: publicUrl,
        storage_path: path,
        position: position++,
      })
      .select('id, update_id, url, storage_path, caption, position, created_at')
      .single()

    if (error || !data) {
      // The file landed but the row didn't. Clean the file up rather than
      // leaving an object nothing points at.
      await supabase.storage.from(MAINTENANCE_PHOTO_BUCKET).remove([path]).catch(() => {})
      failed.push(`${file.name} couldn't be saved`)
      continue
    }
    photos.push(data as WorkItemPhoto)
  }

  return { photos, failed }
}

export async function setPhotoCaption(
  id: string,
  caption: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('work_item_photos')
    .update({ caption: caption?.trim() || null })
    .eq('id', id)
  return { error: error ? 'Could not save that caption.' : null }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** An update with neither a note nor a photo says nothing. */
export const isEmptyUpdate = (u: { body: string | null; photos: { id: string }[] }) =>
  !u.body?.trim() && u.photos.length === 0

export const photoCount = (updates: WorkItemUpdate[]) =>
  updates.reduce((n, u) => n + u.photos.length, 0)

export const sharedCount = (updates: WorkItemUpdate[]) =>
  updates.filter(u => u.tenant_visible).length

/**
 * How an update's reach reads on the landlord's screen.
 *
 * Three states, not two, and the third is the one that matters: an update
 * marked shared on an item that is itself private reaches **nobody**. Saying
 * "Shared" there would be a lie the landlord acts on — they tick the box, nod,
 * and the tenant is never told the plumber is coming.
 */
export function updateReach(
  update: { tenant_visible: boolean },
  item: { tenant_visible: boolean },
): { shown: boolean; label: string; why: string | null } {
  if (!update.tenant_visible) {
    return { shown: false, label: 'Private', why: null }
  }
  if (!item.tenant_visible) {
    return {
      shown: false,
      label: 'Not shown yet',
      why: 'This update is marked shared, but the job itself is private — share the job and residents will see it.',
    }
  }
  return { shown: true, label: 'Shared', why: null }
}
