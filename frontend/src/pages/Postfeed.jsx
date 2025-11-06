import { useEffect, useState } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import React from 'react'

export default function Postfeed() {
  const { id } = useParams()
  const location = useLocation()
  const [post, setPost] = useState(location.state?.post ?? null)
  const { fetchWithAuth } = useAuth()
  const [loading, setLoading] = useState(!post)
  const [error, setError] = useState(null)
  const [comment, setComment] = useState('')
  useEffect(() => {
    if (post) {
      setLoading(false)
      return
    }

    if (!id) return

    let cancelled = false

    async function loadPost() {
      try {
        setLoading(true)
        const response = await fetchWithAuth(`/api/postsfeed/${id}`, { method: 'GET' })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          throw new Error(`Failed to load post: ${response.status} ${text}`)
        }
        const data = await response.json()
        // backend returns { post, comments }
        const merged = { ...(data.post || data), comments: data.comments || data.post?.comments || [] }
        if (!cancelled) setPost(merged)
      } catch (err) {
        console.error('Error loading post', err)
        if (!cancelled) setError(err.message || 'Failed to load post')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPost()

    return () => { cancelled = true }
  }, [id, post, fetchWithAuth, comment])

  if (loading) return <div style={{ padding: 20 }}>Loading post...</div>
  if (error) return <div style={{ padding: 20, color: 'red' }}>{error}</div>
  if (!post) return <div style={{ padding: 20 }}>Post not found.</div>


  async function handleCommentSubmit(e) {
    e.preventDefault()
   
    console.log('Submitting comment:', comment)
    const response = await fetchWithAuth(`/api/posts/${post.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
      headers: { 'Content-Type': 'application/json' },
    })
    if (response.ok) {
      // clear input and reload post (so comments are fetched)
      setComment('')
      // reload post and comments
      try {
        const res2 = await fetchWithAuth(`/api/postsfeed/${post.id}`, { method: 'GET' })
        if (res2.ok) {
          const data = await res2.json()
          const merged = { ...(data.post || data), comments: data.comments || data.post?.comments || [] }
          setPost(merged)
        }
      } catch (err) {
        console.error('Failed to reload post after comment', err)
      }
    } else {
      console.error('Failed to submit comment')
    }
  }


  return (
    <div style={{ padding: 16 }}>
      <span><strong>{post.username}</strong> </span>
      <div>{post.createdAt ? new Date(post.createdAt).toLocaleString() : 'unknown'}</div>

      <h1 style={{ marginTop: 8 }}>{post.post}</h1>
      <div style={{ marginTop: 12 }}>❤️ {Array.isArray(post.likes) ? post.likes.length : 0}</div>
      <div>💬 {Array.isArray(post.comment) ? post.comment.length : (Array.isArray(post.comments) ? post.comments.length : 0)}</div>
      <form onSubmit={handleCommentSubmit}>
        <input type="text" value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment..." />
        <button type="submit">Add Comment</button>
      </form>
      {post.comments && post.comments.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3>Comments:</h3>
          {post.comments.map((cmt, index) => (
            <div key={index} style={{ borderTop: '1px solid #ccc', paddingTop: 8, marginTop: 8 }}>
              <strong>{cmt.username}</strong>: {cmt.comment} <br />
              <small>{cmt.createdAt ? new Date(cmt.createdAt).toLocaleString() : 'unknown'}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}