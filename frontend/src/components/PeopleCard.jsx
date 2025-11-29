import Avatar from "./Avatar";


export default function PeopleCard({ user ,connect ,btnText }) {
    return (
        <div className="people-card">
            <Avatar avatarUrl={user.avatarUrl} alt={user.username} userId={user.id}/>
            <h3>{user.username}</h3>
            <button onClick={() => connect(user.id)}>{btnText}</button>
        </div>
    );
}