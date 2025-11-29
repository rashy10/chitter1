import React, { useState, useEffect, useCallback } from 'react'
import './Home.css'
import LeftNav from '../components/LeftNav'
import TopBar from '../components/TopBar'
import Composer from '../components/Composer'
import Feed from '../components/Feed'
import { useAuth } from '../contexts/AuthContext'



export default function Home() {
  const { user ,fetchWithAuth} = useAuth()

  const [posts, setPosts] = useState()

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

  const fetchPosts = useCallback(async () => {
    try {
      const response = await fetchWithAuth('/api/posts',{
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (response.ok) {
        const posts = await response.json()
        setPosts(posts)
      } else {
        console.error('Failed to fetch posts')
      }
    } catch (err) {
      console.error('Fetch posts error', err)
    }
  }, [fetchWithAuth])

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
          </div>
        </div>
      
      </div>
    </div>
  )
}
