import React, { useState, useEffect, useCallback } from 'react'
import './Home.css'
import LeftNav from '../components/LeftNav'
import TopBar from '../components/TopBar'
import Composer from '../components/Composer'
import Feed from '../components/Feed'
import { useAuth } from '../contexts/AuthContext'



export default function Home() {
  const { user ,fetchWithAuth} = useAuth()

  const [posts, setPosts] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)

  async function handleCreate(text,file) {
    
    // allow post when either non-empty text is provided or a file is attached
    const hasText = typeof text === 'string' && text.trim().length > 0;
    if (!hasText && !file) return;

    try {
      let mediaUrl = null;

      // If a file is attached, get a presigned URL and upload it first
      if (file) {
        
        const data  = await fetchWithAuth('/api/generate-upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, fileType: file.type }),
        })
        const res = await data.json()
        const { uploadUrl, publicUrl } = res;
        mediaUrl = publicUrl;
      

        await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        });
      }

      // Always create the post (text may be empty string if only media)
      const response = await fetchWithAuth('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: (typeof text === 'string' ? text.trim() : ''), mediaUrl }),
      })

      if (response.ok) {
        await response.json().catch(() => {})
        fetchPosts()
      } else {
        console.error('Failed to create post')
      }
    } catch (err) {
      console.error('Error creating post', err)
    }
  }

  // Pass a cursor to append the next page; omit it to (re)load the first page.
  const fetchPosts = useCallback(async (cursor = null) => {
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      const response = await fetchWithAuth(`/api/posts${query}`,{
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (response.ok) {
        const data = await response.json()
        // Paginated backends answer { posts, nextCursor }. The array form is the older
        // shape — frontend and backend deploy separately, so tolerate both.
        const page = Array.isArray(data) ? data : (data.posts || [])
        setPosts(prev => (cursor ? [...prev, ...page] : page))
        setNextCursor(Array.isArray(data) ? null : (data.nextCursor || null))
      } else {
        console.error('Failed to fetch posts')
      }
    } catch (err) {
      console.error('Fetch posts error', err)
    }
  }, [fetchWithAuth])

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      await fetchPosts(nextCursor)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  return (
    <div>
      <TopBar username={user.username} id={user.id} />
      <div className="home-layout">
        <LeftNav />
        <div className="main-column">
          <div className="feed-area">
            <Composer onCreate={handleCreate} />
            <Feed posts={posts} />
            {nextCursor && (
              <button className="load-more" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </div>
      
      </div>
    </div>
  )
}
