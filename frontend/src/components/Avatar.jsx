import React from 'react'
import './Avatar.css'
import { useNavigate } from 'react-router-dom'



export default function Avatar({ avatarUrl, avatarKey, size = 40, username, className = '' ,userId}) {
  // If you store only avatarKey, compute public URL if your bucket is public:
  const publicUrl = avatarUrl
  const initials = (username || '').split(' ').map(s => s[0]).join('').slice(0,2).toUpperCase()
  const navigate = useNavigate()
  // Use CSS variables to allow dynamic sizing from JS while keeping styles in CSS
  const cssVars = { '--avatar-size': `${size}px`, '--avatar-font-size': `${Math.round(size * 0.4)}px` }

  return (
    <div
      className={`avatar ${className}`}
      style={cssVars}
      aria-hidden={!publicUrl}
      onClick ={() => navigate(`/profile/${userId}`)}
    >
      { publicUrl
        ? <img src={publicUrl} alt={`${username || 'User'}'s avatar`} loading="lazy" width={size} height={size} />
        : <span className="avatar-initials">{initials}</span>
      }
    </div>
  )
}