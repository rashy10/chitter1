import Avatar from './Avatar'
import './PeopleCard.css'

export default function PeopleCard({ user, connect, btnText }) {
    const isFollowing = btnText === 'Following'
    return (
        <div className="people-card">
            <div className="people-card__left">
                <Avatar avatarUrl={user.avatarUrl} alt={user.username} userId={user.id} />
                <h3 className="people-card__name">{user.username}</h3>
            </div>
            <button
                className={`people-card__btn ${isFollowing ? 'people-card__btn--following' : ''}`}
                onClick={() => connect(user.id)}
            >
                {btnText}
            </button>
        </div>
    )
}