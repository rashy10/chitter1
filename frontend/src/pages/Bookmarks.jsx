import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Post from '../components/Post'



export default function Bookmarks() {

  const [posts, setPosts] = useState([]); // Initialize posts state
  const navigate = useNavigate()
  const { user: currentUser, fetchWithAuth } = useAuth()
  function handleClickPost(id) {
    const p = posts.find(x => x.id === id)
    navigate(`/postfeed/${id}` )
  }
//   function handleClickPost(id) {  
//     // navigate to post detail route; do not include a literal ':' in the path
//     navigate(`/postfeed/${id}`, { state: { post: posts[id] } })

//   }
  useEffect(() => {
    const loadBookmarks = async () => {
      try {
        const response = await fetchWithAuth('/api/bookmarks', { method: 'GET' });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(`Failed to load bookmarks: ${response.status} ${text}`);
        }

  const data = await response.json();
  console.log('Fetched bookmarks data:', data);
  // backend returns { posts: [...] } (we join bookmarks -> posts server-side)
  setPosts(data.posts || []);
      } catch (error) {
        console.error('Error loading bookmarks:', error);
      }
    };

    loadBookmarks();    
  }, [fetchWithAuth])




  return (
    <section className="feed-column">
      {posts.length === 0 ? (
        <div className="feed-placeholder">No posts yet, be the first to share your thoughts! and connect with others</div>
      ) : (
        <ul className="posts-list">
          {posts.map(p => (
            <Post openPost={handleClickPost} key={p.id} post={p} avatarUrl={p.avatarUrl} />
          ))}
          
        </ul>
        
      )}
    </section>
  )
}
