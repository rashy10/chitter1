import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Avatar from '../components/Avatar'
import Post from '../components/Post'
import './Profile.css'

export default function Profile() {
  const { id } = useParams()
  const nav = useNavigate()
  const { user: currentUser, fetchWithAuth, setUser } = useAuth()

  const [profile, setProfile] = useState(null)
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [formUsername, setFormUsername] = useState('')
  const [formBio, setFormBio] = useState('')
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        // try authenticated fetch first, falls back to unauthenticated if fetchWithAuth isn't available
        const res = await fetchWithAuth(`/api/users/${id}`, { method: 'GET' }) 
        if (!res.ok) {
          // gracefully handle missing backend endpoints or errors
          const text = await res.text().catch(() => '')
          throw new Error(`Failed to load profile (${res.status}) ${text}`)
        }
        const body = await res.json()
        if (cancelled) return
        setProfile(body.user)

        // fetch posts for this user; if endpoint doesn't exist, skip silently
        try {
          const res2 = await (fetchWithAuth ? fetchWithAuth(`/api/users/${id}/posts`, { method: 'GET' }) : fetch(`/api/users/${id}/posts`))
          if (res2.ok) {
            const b2 = await res2.json()
            const decorated = (b2.posts || []).map(p => ({ ...p, avatarUrl: body.user?.avatarUrl }))
            setPosts(decorated)
          } else {
           
            setPosts([])
          }
        } catch (e) {
          setPosts([])
        }
      } catch (err) {
        console.error('Load profile error', err)
        setProfile(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, fetchWithAuth])

  useEffect(() => {
    if (profile && !editing) {
      setFormUsername(profile.username || '')
      setFormBio(profile.bio || '')
    }
  }, [profile, editing])

  function openPost(postId) {
    nav(`/postfeed/${postId}`)
  }

  async function saveProfile(e) {
    e.preventDefault()
    try {
      const res = await fetchWithAuth('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: formUsername, bio: formBio }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(`Failed to save: ${res.status} ${t}`)
      }
      const body = await res.json()
      setProfile(body.user)
      setEditing(false)
      // update AuthContext username if current user updated themselves
      if (currentUser && body.user && currentUser.id === body.user.id && setUser) {
        setUser(prev => ({ ...prev, username: body.user.username }))
      }
    } catch (err) {
      console.error('Save failed', err)
      alert(err.message || 'Save failed')
    }
  }
  async function uploadAvatar() {
     if (!avatarFile) return
      setAvatarUploading(true)
      try {
        const presign = await fetchWithAuth('/api/generate-upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: avatarFile.name, fileType: avatarFile.type }),
        })
        if (!presign.ok) {
          const t = await presign.text().catch(() => '')
          throw new Error(`Presign failed: ${presign.status} ${t}`)
        }
        const presignBody = await presign.json()
        const { uploadUrl, fileKey ,publicUrl } = presignBody
        if (!uploadUrl || !fileKey) throw new Error('Presign response missing fields')
        // upload to S3
        const put = await fetch(uploadUrl, { method: 'PUT', body: avatarFile, headers: { 'Content-Type': avatarFile.type } })
        if (!put.ok) throw new Error('Upload to S3 failed')
        // tell server to set avatarKey
        const upd = await fetchWithAuth('/api/users/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatarKey: fileKey }),
        })
        if (!upd.ok) {
          const t = await upd.text().catch(() => '')
          throw new Error(`Failed to update profile: ${upd.status} ${t}`)
        }
        const body = await upd.json()
        setProfile(body.user)
        // update AuthContext avatar if current user
        if (currentUser && body.user && currentUser.id === body.user.id && setUser) {
          setUser(prev => ({ ...prev, avatarUrl: body.user.avatarUrl }))
        }
        setAvatarFile(null)
        setEditing(false)
        window.location.reload()

      } catch (err) {
        console.error('Avatar upload failed', err)
        alert(err.message || 'Avatar upload failed')
      } finally {
        setAvatarUploading(false)
      }
  }


  if (loading) return <div style={{ padding: 20 }}>Loading profile...</div>
  if (!profile) return <div style={{ padding: 20 }}>Profile not found or backend endpoint missing.</div>

  const isMe = currentUser && currentUser.id === profile.id

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24 }}>
      <aside className="card" style={{ minHeight: 200 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar avatarUrl={profile.avatarUrl} size={96} username={profile.username} userId={profile.id}/>
          <div>
            <h2 style={{ margin: 0 }}>{profile.username}</h2>
            <div className="muted">Joined {profile.createdAt ? new Date(profile.createdAt).toLocaleDateString() : 'unknown'}</div>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>{profile.bio || <span className="muted">No bio yet</span>}</div>

        {isMe && !editing && (
          <div style={{ marginTop: 12 }}>
            <button className="btn secondary" onClick={() => setEditing(true)}>Edit profile</button>
          </div>
        )}

        {isMe && editing && (
          <form onSubmit={saveProfile} className="profile-form">
            <label>Profile picture</label>
            <input type="file" accept="image/*" onChange={e => setAvatarFile(e.target.files && e.target.files[0])} />
            {avatarFile && <div className="muted">Selected: {avatarFile.name}</div>}

            <label>Username</label>
            <input value={formUsername} onChange={e => setFormUsername(e.target.value)} />
            <label>Bio</label>
            <input value={formBio} onChange={e => setFormBio(e.target.value)} />

            
            <div className="form-actions">
              <button className="btn" type="submit">Save</button>
              <button type="button" className="btn secondary" onClick={() => setEditing(false)}>Cancel</button>
            </div>
            {avatarFile && (
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn" disabled={avatarUploading} onClick={uploadAvatar}>Upload avatar</button>
              </div>
            )}
          </form>
        )}
      </aside>

      <section>
        <h3>Posts</h3>
        <ul className="posts-list">
          {posts.map(p => (
            <li key={p.id} style={{ listStyle: 'none' }}>
              <div onClick={() => openPost(p.id)}>
                <Post post={p} openPost={() => openPost(p.id)} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
