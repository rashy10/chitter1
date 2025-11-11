import React from 'react'

export default function Comment({ comment, onLike, onReply, onDelete }) {
  if (!comment) return null

  const handleLike = () => onLike && onLike(comment)
  const handleReply = () => onReply && onReply(comment)
  const handleDelete = () => onDelete && onDelete(comment)

  return (
    <div style={{ borderTop: '1px solid #979797ff', paddingTop: 8, marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>{comment.username}</strong>
          <div style={{ fontSize: 14, color: '#ffffffff' }}>{comment.comment}</div>
          <small style={{ color: '#666' }}>{comment.createdAt ? new Date(comment.createdAt).toLocaleString() : 'unknown'}</small>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleLike} aria-label="Like comment">❤️</button>
          {/* <button onClick={handleReply} aria-label="Reply to comment">↩️</button>
          <button onClick={handleDelete} aria-label="Delete comment">🗑️</button> */}
        </div>
      </div>
    </div>
  )
}
