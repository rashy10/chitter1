import { useEffect, useState } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import React from 'react'
import Comments from '../components/Comments'

export default function Postfeed() {
  const { id } = useParams()
  const location = useLocation()
  const [post, setPost] = useState(location.state?.post ?? null)
  const { fetchWithAuth } = useAuth()
  const [loading, setLoading] = useState(!post)
  const [error, setError] = useState(null)
  const [comment, setComment] = useState('')
  const [pendingLike, setPendingLike] = useState(false)
  const [pendingBookmark, setPendingBookmark] = useState(false)
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
        const merged = { ...(data.post || data), comments: data.comments || data.post?.comments || [], youLiked: data.post?.youLiked ?? data.youLiked }
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
    async function handleLike() {
      if (pendingLike) return
      setPendingLike(true)
      // optimistic update
      const prevYou = post.youLiked
      const prevCount = post.likes || 0
      const newYou = !prevYou
      const newCount = newYou ? prevCount + 1 : Math.max(0, prevCount - 1)
      setPost({ ...post, youLiked: newYou, likes: newCount })

      try {
        const response = await fetchWithAuth(`/api/posts/${post.id}/likes`, {
          method: newYou ? 'POST' : 'DELETE',
        })
        if (response.ok) {
          const body = await response.json().catch(() => ({}))
          // reconcile with server-provided count if available
          if (body.likeCount !== undefined) {
            setPost(p => ({ ...p, youLiked: !!body.liked, likes: body.likeCount }))
          } else {
            setPost(p => ({ ...p, youLiked: newYou, likes: newCount }))
          }
        } else {
          // rollback on failure
          setPost({ ...post, youLiked: prevYou, likes: prevCount })
          console.error('Failed to submit like')
        }
      } catch (err) {
        // rollback
        setPost({ ...post, youLiked: prevYou, likes: prevCount })
        console.error('Failed to submit like', err)
      } finally {
        setPendingLike(false)
      }
  }
  async function handleBookmark() {
    if (pendingBookmark) return
            setPendingBookmark(true)
            const prevBookmarked = !!post.bookmarked
            const newBookmarked = !prevBookmarked
            // optimistic update
            setPost(p => ({ ...p, bookmarked: newBookmarked }))
            try {
              const res = await fetchWithAuth(`/api/posts/${post.id}/bookmark`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookmark: newBookmarked }),
              })
              if (res.ok) {
                // if server returns canonical state, reconcile
                const body = await res.json().catch(() => ({}))
                if (body.bookmarked !== undefined) {
                  setPost(p => ({ ...p, bookmarked: !!body.bookmarked }))
                }
              } else {
                // rollback
                setPost(p => ({ ...p, bookmarked: prevBookmarked }))
                console.error('Failed to toggle bookmark')
              }
            } catch (err) {
              setPost(p => ({ ...p, bookmarked: prevBookmarked }))
              console.error('Failed to toggle bookmark', err)
            } finally {
              setPendingBookmark(false)
            }
    
  }

  return (
    <div style={{ padding: 16 }}>
      <span><strong>{post.username}</strong> </span>
      <div>{post.createdAt ? new Date(post.createdAt).toLocaleString() : 'unknown'}</div>

      <h1 style={{ marginTop: 8 }}>{post.post}</h1>
      <div style={{ marginTop: 12 }}>
        <button onClick={handleLike} disabled={pendingLike} aria-pressed={!!post.youLiked} style={{ cursor: pendingLike ? 'wait' : 'pointer' }}>
          {post.youLiked ? '❤️' : '🤍'} {post.likes}
        </button>
      </div>
      <div>💬 {post.comment || 0}</div>
      <div style={{ marginTop: 12 }}>
        <button
          onClick={() => { handleBookmark() }}
          disabled={pendingBookmark}
          aria-pressed={!!post.bookmarked}
          style={{ cursor: pendingBookmark ? 'wait' : 'pointer' }}
        >
          {post.bookmarked ? '🔖 Bookmarked' : '🔖 Bookmark'}
        </button>
      </div>
      <form onSubmit={handleCommentSubmit}>
        <input type="text" value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment..." />
        <button type="submit">Add Comment</button>
      </form>
      <Comments comments={post.comments} />
    </div>
  )
}