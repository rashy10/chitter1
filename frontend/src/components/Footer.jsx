import React from 'react'
import { Link } from 'react-router-dom'
import './Footer.css'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner container">
        <div className="footer__left">
          <div className="footer__brand">Chit‑Chat</div>
          <div className="footer__small">Built with ♥ — share a moment.</div>
        </div>
        <div className="footer__links">
          <Link to="/">Home</Link>
          <Link to="/people">People</Link>
          <a href="#" onClick={(e)=>e.preventDefault()}>About</a>
          <a href="#" onClick={(e)=>e.preventDefault()}>Privacy</a>
        </div>
      </div>
    </footer>
  )
}
