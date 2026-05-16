'use client'

import { use, useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import {
  getPropertiesByOwner,
  uploadPropertyImage,
  uploadRoomImage,
  Property,
  PropertyRoom,
} from '@/lib/properties'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function EditMediaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [property, setProperty] = useState<Property | null>(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [rooms, setRooms] = useState<PropertyRoom[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState('')
  // Per-room uploading state: roomId -> boolean
  const [roomUploading, setRoomUploading] = useState<Record<string, boolean>>({})
  // Ref map for per-room file inputs
  const roomFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      const props = await getPropertiesByOwner(user.id)
      const found = props.find(p => p.slug === slug)
      if (!found) { router.push('/landlord/listings'); return }

      setProperty(found)
      setImages(found.images.filter(url => {
        // Only show general images (no room association) in the main grid.
        // Since mapProperty puts general images first then room images, we need to
        // cross-reference. We'll reload images separately from rooms.
        return true
      }))
      // Separate general vs room images by re-deriving them from rooms
      const roomImageSet = new Set(found.rooms.flatMap(r => r.images))
      setImages(found.images.filter(url => !roomImageSet.has(url)))
      setRooms(found.rooms)
      setLoading(false)
    }
    load()
  }, [slug, router])

  // Routes through the API (service-role key) to bypass property_images RLS
  async function saveImages(urls: string[]): Promise<{ error: string | null }> {
    if (!property) return { error: 'No property loaded' }
    const res = await fetch(`/api/properties/${property.id}/images`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: urls, ownerId: userId }),
    })
    if (!res.ok) return { error: 'Failed to save' }
    return { error: null }
  }

  async function handleUpload(files: FileList) {
    if (!property) return
    setUploading(true)
    setErrorMsg('')

    const uploaded: string[] = []
    for (let i = 0; i < files.length; i++) {
      setUploadProgress(`Uploading ${i + 1} of ${files.length}…`)
      const { url, error } = await uploadPropertyImage(files[i], userId, property.id)
      if (error || !url) {
        setErrorMsg(`Failed to upload "${files[i].name}". Please try again.`)
        setUploading(false)
        setUploadProgress('')
        return
      }
      uploaded.push(url)
    }

    const newImages = [...images, ...uploaded]
    const { error } = await saveImages(newImages)
    if (error) {
      setErrorMsg('Photos uploaded but failed to save. Please try again.')
    } else {
      setImages(newImages)
    }

    setUploading(false)
    setUploadProgress('')
  }

  async function moveUp(index: number) {
    if (!property || index === 0) return
    const reordered = [...images]
    ;[reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]]
    setImages(reordered)
    await saveImages(reordered)
  }

  async function moveDown(index: number) {
    if (!property || index === images.length - 1) return
    const reordered = [...images]
    ;[reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]]
    setImages(reordered)
    await saveImages(reordered)
  }

  async function handleDelete(index: number) {
    if (!property) return
    const updated = images.filter((_, i) => i !== index)
    setImages(updated)
    await saveImages(updated)
  }

  // Room image handlers
  async function handleRoomUpload(files: FileList, room: PropertyRoom) {
    if (!property) return
    setRoomUploading(prev => ({ ...prev, [room.id]: true }))

    for (let i = 0; i < files.length; i++) {
      const { url, error } = await uploadRoomImage(files[i], userId, property.id, room.id)
      if (error || !url) {
        setErrorMsg(`Failed to upload room photo "${files[i].name}". Please try again.`)
        setRoomUploading(prev => ({ ...prev, [room.id]: false }))
        return
      }
      // Register the image in DB
      const res = await fetch(`/api/properties/${property.id}/rooms/${room.id}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, ownerId: userId }),
      })
      if (!res.ok) {
        setErrorMsg('Photo uploaded but failed to save. Please try again.')
        setRoomUploading(prev => ({ ...prev, [room.id]: false }))
        return
      }
      // Update local state
      setRooms(prev => prev.map(r =>
        r.id === room.id ? { ...r, images: [...r.images, url] } : r
      ))
    }

    setRoomUploading(prev => ({ ...prev, [room.id]: false }))
  }

  async function handleRoomDeleteImage(room: PropertyRoom, url: string) {
    if (!property) return
    const res = await fetch(`/api/properties/${property.id}/rooms/${room.id}/images`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ownerId: userId }),
    })
    if (!res.ok) {
      setErrorMsg('Failed to delete room photo. Please try again.')
      return
    }
    setRooms(prev => prev.map(r =>
      r.id === room.id ? { ...r, images: r.images.filter(u => u !== url) } : r
    ))
  }

  const showRoomSection = property?.rental_mode === 'by_room' && rooms.length > 0

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif", fontSize: '14px', color: '#897174' }}>
        Loading…
      </div>
    )
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .media-wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; font-family: 'Inter', sans-serif; }
        .media-breadcrumb { font-size: 13px; color: #897174; margin-bottom: 20px; }
        .media-breadcrumb a { color: #8C1D40; text-decoration: none; }
        .media-breadcrumb a:hover { text-decoration: underline; }
        .media-title { font-family: 'Manrope', sans-serif; font-size: 22px; font-weight: 800; color: #191c1d; letter-spacing: -0.02em; margin-bottom: 4px; }
        .media-sub { font-size: 14px; color: #897174; margin-bottom: 28px; }

        .media-header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
        .media-heading { font-size: 14px; font-weight: 600; color: #191c1d; }
        .btn-upload { display: inline-flex; align-items: center; gap: 7px; background: #191c1d; color: #fff; border: none; border-radius: 8px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'Inter', sans-serif; transition: background 0.15s; }
        .btn-upload:hover:not(:disabled) { background: #2e3132; }
        .btn-upload:disabled { opacity: 0.6; cursor: not-allowed; }

        .photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
        .photo-card { background: #fff; border: 1.5px solid #ddbfc3; border-radius: 12px; overflow: hidden; position: relative; }
        .photo-card.hero { border-color: #FFC627; border-width: 2px; }
        .photo-thumb { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; }
        .photo-card-body { padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
        .photo-pos { font-size: 11px; font-weight: 600; color: #897174; }
        .hero-star { font-size: 10px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; color: #8C1D40; background: #fdf2f5; border: 1px solid #f4c9d5; border-radius: 20px; padding: 2px 8px; }
        .photo-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
        .btn-arrow { background: none; border: 1px solid #ddbfc3; border-radius: 5px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 12px; color: #564145; transition: background 0.1s, border-color 0.1s; }
        .btn-arrow:hover:not(:disabled) { background: #fdf2f5; border-color: #8C1D40; color: #8C1D40; }
        .btn-arrow:disabled { opacity: 0.25; cursor: default; }
        .btn-del { background: none; border: 1px solid #f5c6d0; border-radius: 5px; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px; color: #8C1D40; transition: background 0.1s; }
        .btn-del:hover { background: #fdf2f5; }

        .empty-state { border: 2px dashed #ddbfc3; border-radius: 14px; padding: 48px 24px; text-align: center; color: #897174; }
        .empty-icon { font-size: 36px; margin-bottom: 12px; }
        .empty-title { font-size: 15px; font-weight: 600; color: #564145; margin-bottom: 4px; }
        .empty-sub { font-size: 13px; }

        .upload-progress { background: #fdf2f5; border: 1px solid #f4c9d5; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #8C1D40; margin-bottom: 16px; }
        .alert-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #991b1b; margin-bottom: 16px; }

        .back-link { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #8C1D40; text-decoration: none; margin-top: 32px; background: none; border: none; cursor: pointer; font-family: 'Inter', sans-serif; padding: 0; }
        .back-link:hover { text-decoration: underline; }

        .section-divider { height: 1px; background: #ede8e9; margin: 32px 0; }
        .room-section-title { font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 800; color: #191c1d; letter-spacing: -0.01em; margin-bottom: 4px; }
        .room-section-sub { font-size: 13px; color: #897174; margin-bottom: 24px; }
        .room-header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; }
        .room-name-label { font-size: 13px; font-weight: 700; color: #191c1d; }
        .btn-upload-sm { display: inline-flex; align-items: center; gap: 6px; background: #fff; color: #191c1d; border: 1.5px solid #ddbfc3; border-radius: 7px; padding: 7px 13px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: 'Inter', sans-serif; transition: border-color 0.15s, background 0.15s; }
        .btn-upload-sm:hover:not(:disabled) { border-color: #8C1D40; background: #fdf2f5; }
        .btn-upload-sm:disabled { opacity: 0.6; cursor: not-allowed; }
        .room-photo-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
        .room-photo-item { position: relative; width: 110px; height: 82px; border-radius: 9px; overflow: hidden; border: 1.5px solid #ddbfc3; flex-shrink: 0; }
        .room-photo-img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .room-photo-del { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 50%; background: rgba(140,29,64,0.85); color: #fff; border: none; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; transition: background 0.15s; }
        .room-photo-del:hover { background: #8C1D40; }
        .room-empty-photos { font-size: 12px; color: #b5a0a4; font-style: italic; margin-bottom: 20px; }
        .room-block { margin-bottom: 28px; padding-bottom: 28px; border-bottom: 1px solid #f0e9ea; }
        .room-block:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
      `}</style>

      <div className="media-wrap">
        <div className="media-breadcrumb">
          <a href="/landlord/listings">Listings</a>
          {' › '}
          <a href={`/landlord/listings/${slug}`}>{property?.name}</a>
          {' › '}
          Photos
        </div>

        <h1 className="media-title">Photos</h1>
        <p className="media-sub">The first photo is your hero — it&apos;s what students see first in listings and emails.</p>

        {uploadProgress && <div className="upload-progress">{uploadProgress}</div>}
        {errorMsg && <div className="alert-error">{errorMsg}</div>}

        <div className="media-header-row">
          <div className="media-heading">
            {images.length > 0 ? `${images.length} photo${images.length !== 1 ? 's' : ''}` : 'No photos yet'}
          </div>
          <button
            className="btn-upload"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? uploadProgress || 'Uploading…' : '+ Upload photos'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => e.target.files && e.target.files.length > 0 && handleUpload(e.target.files)}
          />
        </div>

        {images.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📷</div>
            <div className="empty-title">No photos yet</div>
            <div className="empty-sub">Upload photos to help students picture the space.</div>
          </div>
        ) : (
          <div className="photo-grid">
            {images.map((url, i) => (
              <div key={url} className={`photo-card${i === 0 ? ' hero' : ''}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Photo ${i + 1}`} className="photo-thumb" />
                <div className="photo-card-body">
                  {i === 0 ? (
                    <span className="hero-star">Hero ★</span>
                  ) : (
                    <span className="photo-pos">#{i + 1}</span>
                  )}
                  <div className="photo-actions">
                    <button
                      className="btn-arrow"
                      disabled={i === 0}
                      onClick={() => moveUp(i)}
                      title="Move up"
                    >↑</button>
                    <button
                      className="btn-arrow"
                      disabled={i === images.length - 1}
                      onClick={() => moveDown(i)}
                      title="Move down"
                    >↓</button>
                    <button
                      className="btn-del"
                      onClick={() => handleDelete(i)}
                      title="Delete"
                    >×</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Room Photos Section */}
        {showRoomSection && (
          <>
            <div className="section-divider" />
            <div className="room-section-title">Room Photos</div>
            <p className="room-section-sub">Add photos for each room — shown to prospective tenants assigned to that room.</p>

            {rooms.map(room => (
              <div key={room.id} className="room-block">
                <div className="room-header-row">
                  <div className="room-name-label">{room.name}</div>
                  <button
                    className="btn-upload-sm"
                    disabled={!!roomUploading[room.id]}
                    onClick={() => roomFileInputRefs.current[room.id]?.click()}
                  >
                    {roomUploading[room.id] ? 'Uploading…' : '+ Add room photos'}
                  </button>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    style={{ display: 'none' }}
                    ref={el => { roomFileInputRefs.current[room.id] = el }}
                    onChange={e => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleRoomUpload(e.target.files, room)
                        // reset so same file can be re-selected
                        e.target.value = ''
                      }
                    }}
                  />
                </div>

                {room.images.length === 0 ? (
                  <div className="room-empty-photos">No photos for this room yet.</div>
                ) : (
                  <div className="room-photo-grid">
                    {room.images.map(url => (
                      <div key={url} className="room-photo-item">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={room.name} className="room-photo-img" />
                        <button
                          className="room-photo-del"
                          onClick={() => handleRoomDeleteImage(room, url)}
                          title="Delete photo"
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        <a href={`/landlord/listings/${slug}`} className="back-link">← Back to listing</a>
      </div>
    </>
  )
}
