import { NavLink, Outlet } from "react-router-dom";
import { useReviewRuns } from "../review/ReviewRunsContext";

export function AppNavLayout() {
  const { selectedRunId } = useReviewRuns();

  return (
    <div className="admin-layout">
      <nav className="admin-nav" aria-label="Admin">
        <div className="admin-nav-title">Operator</div>
        <NavLink
          to="/review"
          end
          className={({ isActive }) => `admin-nav-link${isActive ? " active" : ""}`}
        >
          Review queue
        </NavLink>
        {selectedRunId ? (
          <NavLink
            to={`/review/${encodeURIComponent(selectedRunId)}`}
            className={({ isActive }) => `admin-nav-link${isActive ? " active" : ""}`}
          >
            Run detail
          </NavLink>
        ) : (
          <span className="admin-nav-link disabled" title="Select a run from the queue first">
            Run detail
          </span>
        )}
        <NavLink
          to="/diagnostics"
          className={({ isActive }) => `admin-nav-link${isActive ? " active" : ""}`}
        >
          Diagnostics
        </NavLink>
      </nav>
      <div className="admin-outlet">
        <Outlet />
      </div>
    </div>
  );
}
