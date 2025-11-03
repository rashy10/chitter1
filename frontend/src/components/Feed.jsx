import React from 'react'

export default function Feed({ posts = [] }) {
  return (
    <section className="feed-column">
      {posts.length === 0 ? (
        <div className="feed-placeholder">No posts yet</div>
      ) : (
        <ul className="posts-list">
          {posts.map(p => (
            <li className="post-card" key={p.id}>
              <div className="post-meta">
                <strong>{p.username}</strong>
                <span className="post-time">{new Date(p.createdAt).toLocaleString()}</span>
              </div>
              <div className="post-body">{p.post}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
