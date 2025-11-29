// Default to local dev, but fall back to your Heroku backend so builds without env still work
const BACKEND_BASE = import.meta.env.VITE_BACKEND_BASE || 'https://chitter-backend-app-4c5e1318fbab.herokuapp.com'

async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`${BACKEND_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  })

  const text = await res.text()
  try {
    const data = text ? JSON.parse(text) : null
    if (!res.ok) throw { status: res.status, data }
    return data
  } catch (err) {
    if (err && err.status) throw err
    throw { status: res.status, data: text }
  }
}

export async function register(payload) {
  return request('/auth/register', { method: 'POST', body: payload })
}

export async function login(payload) {
  return request('/auth/login', { method: 'POST', body: payload })
}

export async function fetchHomeFeed(token) {
  return request('/feed/home', { token })
}

export default { request, register, login, fetchHomeFeed }
