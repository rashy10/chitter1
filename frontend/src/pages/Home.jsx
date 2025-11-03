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

  async function handleCreate(text) {
    // locally append a new post; in future wire to API
    const response = await fetchWithAuth('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    if (response.ok) {
      const newPost = await response.json()
      fetchPosts()
    } else {
      console.error('Failed to create post')
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

  // load posts on mount
  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  return (
    <div>
      <TopBar username={user.username} />
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
