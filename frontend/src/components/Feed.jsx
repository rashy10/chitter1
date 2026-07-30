import React from 'react'
import Post from './Post'
import { useNavigate } from 'react-router-dom'

export default function Feed({ posts = [] }) {


  const navigate = useNavigate()
  
  function handleClickPost(id) {  
    navigate(`/postfeed/${id}`)

  }




  return (
    <section className="feed-column">
      {posts.length === 0 ? (
        <div className="feed-placeholder">No posts yet, be the first to share your thoughts! and connect with others</div>
      ) : (
        <ul className="posts-list">
          {posts.map(p => (
            <Post openPost={handleClickPost} key={p.id} post={p} />
          ))}
          
        </ul>
        
      )}
    </section>
  )
}
