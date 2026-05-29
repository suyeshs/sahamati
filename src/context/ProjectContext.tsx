import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "./AuthContext";
import {
  getProject,
  type ProjectWithDetails,
  type PhaseWithDocs,
  type ProjectMember,
} from "../lib/project-api";

interface ProjectContextValue {
  project: ProjectWithDetails | null;
  phases: PhaseWithDocs[];
  members: ProjectMember[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const ProjectContext = createContext<ProjectContextValue>({
  project: null,
  phases: [],
  members: [],
  loading: true,
  error: null,
  refresh: () => {},
});

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [project, setProject] = useState<ProjectWithDetails | null>(null);
  const [phases, setPhases] = useState<PhaseWithDocs[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    if (!slug || !user?.email) return;

    setLoading(true);
    setError(null);
    try {
      const data = await getProject(user.email, slug);
      setProject(data.project);
      setPhases(data.phases);
      setMembers(data.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [slug, user?.email]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  return (
    <ProjectContext.Provider
      value={{ project, phases, members, loading, error, refresh: fetchProject }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}
