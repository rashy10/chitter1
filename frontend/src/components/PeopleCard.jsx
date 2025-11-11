export default function PeopleCard({ user ,connect ,btnText }) {
    return (
        <div className="people-card">
            <h3>{user.username}</h3>
            <button onClick={() => connect(user.id)}>{btnText}</button>
        </div>
    );
}