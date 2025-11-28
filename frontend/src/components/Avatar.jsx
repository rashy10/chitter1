import React from 'react'

export default function Avatar({ avatarUrl, avatarKey, size = 40, username, className = '' }) {
  // If you store only avatarKey, compute public URL if your bucket is public:
  const publicUrl = avatarUrl 
  const initials = (username || '').split(' ').map(s => s[0]).join('').slice(0,2).toUpperCase()

  return (
    <div
      className={`avatar ${className}`}
      style={{ width: size, height: size, lineHeight: `${size}px`, fontSize: Math.round(size * 0.4) }}
      aria-hidden={!publicUrl}
    >
      { publicUrl
        ? <img src={publicUrl} alt={`${username || 'User'}'s avatar`} loading="lazy" width={size} height={size} />
        : <span className="avatar-initials">{initials}</span>
      }
    </div>
  )
}