import React, { useState } from 'react'

export default function Composer({ onCreate }) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSubmitting(true)
    try {
      // for now, call parent handler to append locally
      onCreate(text.trim())
      setText('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="composer">
      <form onSubmit={submit}>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="What's happening?" />
        <div>
          <button type="submit" disabled={submitting || !text.trim()}>{submitting ? 'Posting...' : 'Post'}</button>
        </div>
      </form>
    </div>
  )
}
