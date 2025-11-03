import React from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function TopBar({username}) {
  
  return (
    <header className="top-bar">
      <div className="brand">twitter</div>
      <div className="top-right">{username}</div>
    </header>
  )
}
