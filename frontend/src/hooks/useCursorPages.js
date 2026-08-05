import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

/**
 * Walks a cursor-paginated endpoint.
 *
 * The backend answers { <key>: [...], nextCursor }, where nextCursor is an opaque token
 * for the next page and null once there are none left. Cursors are only valid for the
 * query that produced them, so each hook instance owns its own.
 *
 * The Array.isArray branch tolerates the older bare-array response shape: the frontend
 * (Vercel) and backend (Heroku) deploy independently, so there is a real window where a
 * new frontend talks to a backend that has not been redeployed yet. It can go once both
 * are out.
 *
 * @param url   endpoint to page through, or null to skip loading entirely
 * @param key   property holding the array in the response body (e.g. 'posts', 'users')
 * @param transform  optional per-item mapper, called as (item, body)
 */
export default function useCursorPages(url, { key = 'posts', transform } = {}) {
  const { fetchWithAuth } = useAuth()
  const [items, setItems] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  // Most recent raw response, for callers that need sibling fields alongside the array
  // (e.g. /api/connect returns the viewer's `following` list next to `users`).
  const [lastBody, setLastBody] = useState(null)

  // Kept in a ref, and refreshed every render, so a caller can pass an inline arrow
  // function without it re-triggering the initial load on every render — while still
  // seeing current props when it runs.
  const transformRef = useRef(transform)
  transformRef.current = transform

  const fetchPage = useCallback(async (cursor) => {
    if (!url) return null
    const sep = url.includes('?') ? '&' : '?'
    const target = cursor ? `${url}${sep}cursor=${encodeURIComponent(cursor)}` : url
    const res = await fetchWithAuth(target, { method: 'GET' })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Request failed (${res.status}) ${text}`)
    }
    const body = await res.json()
    const raw = Array.isArray(body) ? body : (body[key] || [])
    const page = transformRef.current ? raw.map(item => transformRef.current(item, body)) : raw
    // Append when paging, replace when starting over.
    setItems(prev => (cursor ? [...prev, ...page] : page))
    setNextCursor(Array.isArray(body) ? null : (body.nextCursor || null))
    setLastBody(Array.isArray(body) ? null : body)
    return body
  }, [url, key, fetchWithAuth])

  useEffect(() => {
    let cancelled = false
    if (!url) { setLoading(false); return }
    setLoading(true)
    setError(null)
    fetchPage(null)
      .catch(err => { if (!cancelled) { console.error('Failed to load', url, err); setError(err.message); setItems([]) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchPage, url])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      await fetchPage(nextCursor)
    } catch (err) {
      console.error('Failed to load more from', url, err)
      setError(err.message)
    } finally {
      setLoadingMore(false)
    }
  }, [nextCursor, loadingMore, fetchPage, url])

  // Discard everything and re-read from the first page — used after a write that
  // belongs at the top of the list, such as creating a post.
  const reload = useCallback(async () => {
    try {
      await fetchPage(null)
    } catch (err) {
      console.error('Failed to reload', url, err)
      setError(err.message)
    }
  }, [fetchPage, url])

  return { items, setItems, nextCursor, loading, loadingMore, error, loadMore, reload, lastBody }
}
