import React from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function TopBar({username, id}) {
  const nav = useNavigate()
  
  return (
    <header className="top-bar">
      <div onClick={() => nav('/')} className="brand">Chit-Chat</div>
      <div onClick={() => nav(`/profile/${id}`)} className="top-right">{username}</div>
    </header>
  )
}
