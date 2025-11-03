import React from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function LeftNav() {
  const { logout } = useAuth()
  const nav = useNavigate()

  function onLogout() {
    logout()
    nav('/login')
  }

  return (
    <aside className="left-nav">
      
      <nav className="left-links">
        <button className="ln-btn">likes</button>
        <button className="ln-btn">people</button>
        <button className="ln-btn">bookmark</button>
        <button className="ln-btn" onClick={onLogout}>logout</button>
      </nav>
    </aside>
  )
}
