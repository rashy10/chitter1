import { useEffect, useState } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import React from 'react'
import Comments from '../components/Comments'
import Avatar from '../components/Avatar'
import './Postfeed.css'

export default function Postfeed() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [post, setPost] = useState(location.state?.post ?? null)
  const { user ,fetchWithAuth } = useAuth()
  const [loading, setLoading] = useState(!post)
  const [error, setError] = useState(null)
  const [comment, setComment] = useState('')
  const [author,setAuthor] = useState(false)
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
        
        const merged = { ...(data.post || data), comments: data.comments || data.post?.comments || [], youLiked: data.post?.youLiked ?? data.youLiked }
        const isAuthor = user && merged && (user.id === merged.userId || user.roles.includes('Admin'))
        setAuthor(isAuthor)
        console.log('Loaded post data:', merged)
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
    
      setComment('')
      
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
        
          if (body.likeCount !== undefined) {
            setPost(p => ({ ...p, youLiked: !!body.liked, likes: body.likeCount }))
          } else {
            setPost(p => ({ ...p, youLiked: newYou, likes: newCount }))
          }
        } else {
      
          setPost({ ...post, youLiked: prevYou, likes: prevCount })
          console.error('Failed to submit like')
        }
      } catch (err) {
      
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
            
            setPost(p => ({ ...p, bookmarked: newBookmarked }))
            try {
              const res = await fetchWithAuth(`/api/posts/${post.id}/bookmark`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookmark: newBookmarked }),
              })
              if (res.ok) {
                
                const body = await res.json().catch(() => ({}))
                if (body.bookmarked !== undefined) {
                  setPost(p => ({ ...p, bookmarked: !!body.bookmarked }))
                }
              } else {
                
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
    async function handleDeletePost() {
        try {   
            const response = await fetchWithAuth(`/api/posts/${post.id}`, { method: 'DELETE' });
            if (response.ok) {
                navigate('/');
            } else {
                const text = await response.text();
                throw new Error(`Failed to delete post: ${response.status} ${text}`);
            }
        } catch (err) {
            console.error('Failed to delete post', err);
        }   

    }


  return (
    <div className="postfeed-page">
      <div className="card postfeed-card">
        <div className="postfeed-header">
          <Avatar avatarUrl={post.avatarUrl} size={40} alt={`${post.username}'s avatar`} userId={post.userId}/>
          <div className="postfeed-meta">
            <strong>{post.username}</strong>
            <div className="muted">{post.createdAt ? new Date(post.createdAt).toLocaleString() : 'unknown'}</div>
          </div>
        </div>

        <h1 className="postfeed-title">{post.post}</h1>
        
        {post.mediaUrl && (
          <div style={{ marginTop: 12 }}>
            <img src={post.mediaUrl} alt="Post media" className="post-media" />
          </div>
        )}

        <div className="postfeed-actions">
          <button onClick={handleLike} disabled={pendingLike} aria-pressed={!!post.youLiked}>
            {post.youLiked ? '❤️' : '🤍'} {post.likes}
          </button>
          <div>💬 {post.comment || 0}</div>
          <button
            onClick={() => { handleBookmark() }}
            disabled={pendingBookmark}
            aria-pressed={!!post.bookmarked}
          >
            {post.bookmarked ? '🔖 Bookmarked' : '🔖 Bookmark'}
          </button>
          {author && <button onClick={handleDeletePost}>Delete</button>}
        </div>

        <form onSubmit={handleCommentSubmit} className="postfeed-form">
          <input type="text" value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment..." />
          <button type="submit">Add Comment</button>
        </form>
      </div>

      <div className="card postfeed-card">
        <Comments comments={post.comments} />
      </div>
    </div>
  )
}