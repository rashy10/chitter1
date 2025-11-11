import React from 'react'
import Comment from './Comment'

export default function Comments({ comments = [], onLike, onReply, onDelete }) {
  if (!comments || comments.length === 0) return null

  return (
    <div style={{ marginTop: 20 }}>
      <h3>Comments:</h3>
      {comments.map((cmt) => (
        <Comment key={cmt.id || cmt._id || `${cmt.username}-${cmt.createdAt}`} comment={cmt} onLike={onLike} onReply={onReply} onDelete={onDelete} />
      ))}
    </div>
  )
}
