import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import PeopleCard from '../components/PeopleCard';

export default function Connect() {
    const { user: currentUser, fetchWithAuth, setUser } = useAuth();
    const [connections, setConnections] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        let mounted = true;

        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await fetchWithAuth('/api/connect', { method: 'GET' });
                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`Server responded ${response.status}: ${text}`);
                }
                const data = await response.json();
                const users = Array.isArray(data.users) ? data.users : [];
                // determine current following list (prefer AuthContext, fallback to server-provided following)
                let followingList = [];
                if (Array.isArray(currentUser?.following)) followingList = currentUser.following;
                else if (data.following && Array.isArray(data.following.following)) followingList = data.following.following;
                const annotated = users.map((u) => ({ ...u, isFollowing: followingList.includes(u.id) }));
                if (mounted) setConnections(annotated);
            } catch (err) {
                console.error('Failed to load connections', err);
                if (mounted) setError(err.message || 'Failed to load connections');
            } finally {
                if (mounted) setLoading(false);
            }
        };

        load();
        return () => {
            mounted = false;
        };
    }, [fetchWithAuth, currentUser]);

    async function handleConnect(userId) {
        try {   
                const response = await fetchWithAuth(`/api/connect/${userId}`, { method: 'PATCH' });
                if (response.ok) {
                    const body = await response.json().catch(() => ({}));
                    // update AuthContext user if server returned updated user
                    if (body.user) setUser(body.user);
                    // update local connections UI
                    setConnections((prev) => prev.map((u) => (u.id === userId ? { ...u, isFollowing: true } : u)));
                } else {
                    const text = await response.text();
                    throw new Error(`Failed to connect: ${response.status} ${text}`);
                }

        } catch (err) {
            console.error('Failed to connect', err);
        }
    }
    if (loading) return <div>Loading people you may know…</div>;
    if (error) return <div style={{ color: 'red' }}>Error: {error}</div>;

    return (
        <div>
            <h1>People You May Know</h1>
            {connections.length === 0 ? (
                <p>No suggestions right now.</p>
            ) : (
                <ul>
                    {connections.map((u) => {
                        const isFollowing = !!u.isFollowing;
                        const btnText = isFollowing ? 'Following' : 'Follow';
                        return <PeopleCard key={u.id} user={u} connect={handleConnect} btnText={btnText} />
                    })}
                </ul>
            )}
        </div>
    );
}