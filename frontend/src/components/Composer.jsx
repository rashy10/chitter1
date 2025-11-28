import React, { useState } from 'react'

export default function Composer({ onCreate }) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null);
  const hasText = typeof text === 'string' && text.trim().length > 0;

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files[0]); // For single file upload
    // For multiple files: setSelectedFile(Array.from(event.target.files));
  };

  async function submit(e) {
    e.preventDefault()
    // allow submit when either non-empty text or a selected file exists
    if (!hasText && !selectedFile) return
    setSubmitting(true)
    try {
      // for now, call parent handler to append locally
      onCreate(text.trim(), selectedFile)
      setText('')
      setSelectedFile(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="composer">
      <form onSubmit={submit}>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="What's happening?" />
        <input type="file" onChange={handleFileChange} />
        {selectedFile && <p>Selected file: {selectedFile.name}</p>}
        <div>
          <button type="submit" disabled={submitting || !(hasText || selectedFile)}>{submitting ? 'Posting...' : 'Post'}</button>
        </div>
      </form>
    </div>
  )
}

