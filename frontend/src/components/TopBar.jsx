import React from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function TopBar({username}) {
  const nav = useNavigate()
  return (
    <header className="top-bar">
      <div onClick={() => nav('/')} className="brand">twitter</div>
      <div className="top-right">{username}</div>
    </header>
  )
}
