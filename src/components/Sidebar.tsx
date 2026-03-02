import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard" },
  { to: "/docs", label: "Documentation" },
  { to: "/templates", label: "Templates" },
  { to: "/workflows", label: "Workflows" },
  { to: "/settings", label: "Settings" },
];

export default function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <h1>Sahamati</h1>
        <span className="sidebar-subtitle">Dev Process Framework</span>
      </div>
      <ul className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? "active" : ""}`
              }
              end={item.to === "/"}
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
      {user && (
        <div className="sidebar-user">
          {user.picture && (
            <img
              src={user.picture}
              alt={user.name}
              className="sidebar-user-avatar"
            />
          )}
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{user.name}</span>
            <span className="sidebar-user-email">{user.email}</span>
          </div>
          <button className="sidebar-logout-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
