import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function useQuery() {
  return new URLSearchParams(useLocation().search)
}

export default function Verify() {
  const [otp, setOtp] = useState('')
  const auth = useAuth()
  const nav = useNavigate()
  const query = useQuery()
  const [email, setEmail] = useState(auth.pendingVerificationEmail || query.get('email') || '')

  async function submit(e) {
    e.preventDefault()
    try {
      // verifyOtp accepts (code) if pendingVerificationEmail exists, or (email, code)
      if (auth.pendingVerificationEmail) {
        await auth.verifyOtp(otp)
      } else {
        await auth.verifyOtp(email, otp)
      }
      nav('/login')
    } catch (err) {
      console.error('Verification failed', err)
      alert(err.message || 'Verification failed')
    }
  }

  return (
    <div className="auth-card">
      <h2>Verify Account</h2>
      <p>Please check your email for the OTP to verify your account.</p>
      <form onSubmit={submit}>
        {!auth.pendingVerificationEmail && (
          <>
            <label>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} />
          </>
        )}
        <label>Verification Code</label>
        <input value={otp} onChange={e => setOtp(e.target.value)} />
        <button type="submit">Verify</button>
      </form>
    </div>
  )
}
