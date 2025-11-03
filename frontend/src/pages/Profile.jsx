import React from 'react'
import { useParams } from 'react-router-dom'

export default function Profile() {
  const { id } = useParams()

  return (
    <div>
      <h1>Profile</h1>
      <div>User ID: {id}</div>
      <div>Profile page not implemented yet.</div>
    </div>
  )
}
