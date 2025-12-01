import React from 'react';
import Avatar from './Avatar';  

export default function Post({ post, openPost }) {
  return (<div onClick={() => openPost(post.id)}>
    <li className="post-card">
      <div className="post-meta">
        <Avatar avatarKey={post.avatarKey} avatarUrl={post.avatarUrl } size={36} username={post.username} userId={post.userId}/> <strong>{post.username}</strong>
        <span className="post-time">{new Date(post.createdAt).toLocaleString()}</span>
      </div>
      <div className="post-body">{post.post}</div>
      {post.mediaUrl && <img src={post.mediaUrl} alt="Post media" className="post-media" />}
    ❤️{post.likes || 0} 💬 {post.comment || 0}
    
    </li>
    </div>

  )
}
