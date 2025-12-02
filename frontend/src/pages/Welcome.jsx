import React from 'react'
import { Link } from 'react-router-dom'
import './Welcome.css'
import Footer from '../components/Footer'


export default function Welcome() {
  return (
    <>
    <section className="welcome">
      <div className="welcome__panel">
        <h1 className="welcome__title">Welcome to Chit‑Chat</h1>
        <p className="welcome__lead">A lightweight, friendly place to share thoughts, images and follow friends. Join the conversation — it only takes a minute.</p>
        <div className="welcome__actions">
          <Link to="/register" className="btn btn--primary">Create account</Link>
          <Link to="/login" className="btn btn--ghost">Log in</Link>
        </div>
      </div>
      <div className="welcome__art">
        
        <img src="/chit-chat-hero.svg" alt="Chit-Chat hero illustration" />
      </div>
       
    </section>
    
    </>
  )
}
