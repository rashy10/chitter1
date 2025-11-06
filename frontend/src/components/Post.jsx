export default function Post({ post, openPost }) {
  return (<div onClick={() => openPost(post.id)}>
    <li className="post-card">
      <div className="post-meta">
        <strong>{post.username}</strong>
        <span className="post-time">{new Date(post.createdAt).toLocaleString()}</span>
      </div>
      <div className="post-body">{post.post}</div>
    </li>
    
    </div>

  )
}
