import React, { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import PeopleCard from '../components/PeopleCard'
import LoadMore from '../components/LoadMore'
import useCursorPages from '../hooks/useCursorPages'
import './Connect.css'

export default function Connect() {
    const { user: currentUser, fetchWithAuth, setUser } = useAuth();

    // Paged alphabetically by username. Users have no meaningful recency for discovery,
    // and username is unique, so the cursor is just the last username of the page.
    const { items: users, nextCursor, loading, loadingMore, error, loadMore, lastBody } =
        useCursorPages('/api/connect', { key: 'users' });

    // Optimistic follows, for the case where the PATCH does not echo an updated user.
    const [justFollowed, setJustFollowed] = useState(() => new Set());

    // Follow state is derived at render rather than baked into the loaded items, so
    // following someone updates the UI without refetching — which would otherwise
    // discard every page loaded so far.
    const serverFollowing = Array.isArray(lastBody?.following) ? lastBody.following : [];
    const followingList = Array.isArray(currentUser?.following) ? currentUser.following : serverFollowing;
    const followingSet = new Set([...followingList, ...justFollowed]);

    async function handleConnect(userId) {
        try {
            const response = await fetchWithAuth(`/api/connect/${userId}`, { method: 'PATCH' });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Failed to connect: ${response.status} ${text}`);
            }
            const body = await response.json().catch(() => ({}));
            if (body.user) setUser(body.user);
            setJustFollowed(prev => new Set(prev).add(userId));
        } catch (err) {
            console.error('Failed to connect', err);
        }
    }

    if (loading) return <div>Loading people you may know…</div>;
    if (error) return <div style={{ color: 'red' }}>Error: {error}</div>;

    return (
        <div className="connect-page">
            <div className="connect-header">
                <div>
                    <h1 className="connect-title">People You May Know</h1>
                    <p className="connect-subtitle">Follow people to see their posts in your feed.</p>
                </div>
            </div>
            {users.length === 0 ? (
                <div className="connect-empty">No suggestions right now.</div>
            ) : (
                <>
                    <ul className="people-list">
                        {users.map((u) => {
                            const isFollowing = followingSet.has(u.id);
                            return (
                                <PeopleCard
                                    key={u.id}
                                    user={{ ...u, isFollowing }}
                                    connect={handleConnect}
                                    btnText={isFollowing ? 'Following' : 'Follow'}
                                />
                            );
                        })}
                    </ul>
                    <LoadMore nextCursor={nextCursor} loading={loadingMore} onClick={loadMore} label="Show more people" />
                </>
            )}
        </div>
    )
}
