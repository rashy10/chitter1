import React from 'react'
import { useNavigate } from 'react-router-dom'
import Post from '../components/Post'
import LoadMore from '../components/LoadMore'
import useCursorPages from '../hooks/useCursorPages'

export default function Bookmarks() {
  const navigate = useNavigate()

  // Paged newest-saved-first. The cursor walks the bookmarks collection, not posts,
  // so ordering is when you saved a post rather than when it was written.
  const { items: posts, nextCursor, loading, loadingMore, error, loadMore } =
    useCursorPages('/api/bookmarks')

  function handleClickPost(id) {
    navigate(`/postfeed/${id}`)
  }

  if (loading) return <div className="feed-placeholder">Loading bookmarks…</div>
  if (error) return <div className="feed-placeholder">Couldn’t load bookmarks: {error}</div>

  return (
    <section className="feed-column">
      {posts.length === 0 ? (
        <div className="feed-placeholder">Nothing saved yet — bookmark a post and it will show up here.</div>
      ) : (
        <>
          <ul className="posts-list">
            {posts.map(p => (
              <Post openPost={handleClickPost} key={p.id} post={p} avatarUrl={p.avatarUrl} />
            ))}
          </ul>
          <LoadMore nextCursor={nextCursor} loading={loadingMore} onClick={loadMore} />
        </>
      )}
    </section>
  )
}
