import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

// During development Vite proxies /auth -> backend (see vite.config.js).
// In production, set VITE_BACKEND_BASE to your backend (or it falls back to the Heroku URL).
const BACKEND_BASE = 'https://chitter-backend-app-4c5e1318fbab.herokuapp.com'


function buildUrl(path) {
  if (!path) return path
  // if absolute URL passed, return as-is
  if (path.startsWith('http')) return path
  // ensure leading slash
  const p = path.startsWith('/') ? path : `/${path}`
  return BACKEND_BASE ? `${BACKEND_BASE}${p}` : p
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [accessToken, setAccessToken] = useState(null)
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState(null)
  const [loading, setLoading] = useState(true)

  // Try a refresh on mount to restore session (server should read refresh cookie)
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
  const res = await fetch(buildUrl('/auth/refresh'), { method: 'POST', credentials: 'include' })
        if (!res.ok) {
          if (mounted) {
            setUser(null)
            setAccessToken(null)
          }
          return
        }
        const body = await res.json()
        if (mounted) {
          setAccessToken(body.accessToken)
          setUser(body.user || null)
        }
      } catch (err) {
        console.error('refresh failed', err)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const login = useCallback(async (email, password) => {
    
  const res = await fetch(buildUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || 'Login failed')
    }
    const body = await res.json()
    setAccessToken(body.accessToken)
    setUser(body.user || null)
    return body
  }, [])

  const register = useCallback(async (email, username, password) => {
    console.log(email, username, password);
  const res = await fetch(buildUrl('/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || 'Registration failed')
    }
    const body = await res.json()
    // keep the email so Verify page can prefill and verify
    setPendingVerificationEmail(email)
    return body
  }, [])

  const verifyOtp = useCallback(async (emailOrCode, maybeCode) => {
    // support verifyOtp(code) using pending email or verifyOtp(email, code)
    let email, code
    if (maybeCode === undefined) {
      email = pendingVerificationEmail
      code = emailOrCode
    } else {
      email = emailOrCode
      code = maybeCode
    }
    if (!email) throw new Error('Email required for verification')
    const res = await fetch(buildUrl('/auth/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || 'Verification failed')
    }
    // verification succeeded — clear pending
    setPendingVerificationEmail(null)
    return res.json()
  }, [pendingVerificationEmail])

  const logout = useCallback(async () => {
    try {
  await fetch(buildUrl('/auth/logout'), { method: 'POST', credentials: 'include' })
    } catch (err) {
      console.error('Logout failed', err)
    }
    setUser(null)
    setAccessToken(null)
  }, [])

  // Wrapper that attaches Authorization and attempts a single refresh on 401
  const fetchWithAuth = useCallback(
    async (input, init = {}) => {
      const headers = new Headers(init.headers || {})
      if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
      const merged = { ...init, headers, credentials: init.credentials ?? 'include' }
      // resolve input to absolute path when needed
      const url = typeof input === 'string' ? buildUrl(input) : input
      let res = await fetch(url, merged)
      if (res.status === 401) {
        // try refresh
  const r = await fetch(buildUrl('/auth/refresh'), { method: 'POST', credentials: 'include' })
        if (r.ok) {
          const b = await r.json()
          setAccessToken(b.accessToken)
          setUser(b.user || null)
          headers.set('Authorization', `Bearer ${b.accessToken}`)
          res = await fetch(url, merged)
        } else {
          // refresh failed
          setUser(null)
          setAccessToken(null)
        }
      }
      return res
    },
    [accessToken],
  )

  const value = { user, setUser, accessToken, loading, login, register, logout, fetchWithAuth, pendingVerificationEmail, verifyOtp }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

export default AuthContext
