import React from 'react'

// Renders nothing when there is no next page, so callers can drop it in unconditionally.
export default function LoadMore({ nextCursor, loading, onClick, label = 'Load more' }) {
  if (!nextCursor) return null
  return (
    <button className="btn secondary load-more" onClick={onClick} disabled={loading}>
      {loading ? 'Loading…' : label}
    </button>
  )
}
