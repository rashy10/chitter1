import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Register() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(false)
  const auth = useAuth()
  const nav = useNavigate()

  async function submit(e) {
    e.preventDefault()
    try {
      const res = await auth.register(email, username, password)
      let msg = 'Registered. Check your email for OTP to verify your account.'
      if (res?.devVerificationCode) msg += ` (dev code: ${res.devVerificationCode})`
      setMessage(msg)
      // redirect to verification page with email in query
      nav(`/verify?email=${encodeURIComponent(email)}`)
    } catch (err) {
      setMessage(err.data?.message || 'Registration failed')
    }
  }

  return (
    <div className="auth-card">
      <h2>Register</h2>
      <form onSubmit={submit}>

        <label>Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)} />

        <label>Username</label>
        <input value={username} onChange={e => setUsername(e.target.value)} />
        
        <label>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <button type="submit" disabled={loading}>{loading ? 'Registering...' : 'Register'}</button>
      </form>
      {message && <div className="info">{message}</div>}
    </div>
  )
}
