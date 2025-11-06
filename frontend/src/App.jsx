import React from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Register from './pages/Register'
import Home from './pages/Home'
import Profile from './pages/Profile'
import Verify from './pages/Verify'
import Postfeed from './pages/Postfeed'
import './App.css'

function Nav() {
  const { user, logout } = useAuth()
  if (user) return null
  return (
    <nav className="nav">
      <Link to="/">Home</Link>
      <Link to="/login">Login</Link>
      <Link to="/register">Register</Link>
      
    </nav>
  )
}

function AppInner() {
  const location = useLocation()
  // make home full-width
  const isHome = location.pathname === '/'
  const { user, loading } = useAuth()

  function RequireAuth({ children }) {
    if (loading) return <div style={{padding:20}}>Loading...</div>
    if (!user) return <Navigate to="/login" replace />
    return children
  }
  return (
    <>
      <Nav/>
      <main className={isHome ? 'container container--full' : 'container'}>
        <Routes>
          <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
          <Route path="/login" element={<Login />} />
          <Route path="/postfeed/:id" element={<RequireAuth><Postfeed /></RequireAuth>} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/register" element={<Register />} />
          <Route path="/profile/:id" element={<Profile />} />
        </Routes>
      </main>
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppInner />
      </BrowserRouter>
    </AuthProvider>
  )
}
