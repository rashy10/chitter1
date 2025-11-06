import React from 'react'
import Post from './Post'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
export default function Feed({ posts = [] }) {


  const navigate = useNavigate()
  const { currentUser } = useAuth()
  function handleClickPost(id) {  
    // navigate to post detail route; do not include a literal ':' in the path
    navigate(`/postfeed/${id}`, { state: { post: posts[id] } })

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
