import { Routes, Route } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Documentation from "./pages/Documentation";
import TemplateGenerator from "./pages/TemplateGenerator";
import WorkflowAutomation from "./pages/WorkflowAutomation";
import Settings from "./pages/Settings";

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="docs" element={<Documentation />} />
        <Route path="docs/:docPath" element={<Documentation />} />
        <Route path="templates" element={<TemplateGenerator />} />
        <Route path="workflows" element={<WorkflowAutomation />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
