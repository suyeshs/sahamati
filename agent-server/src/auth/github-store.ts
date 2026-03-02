export interface GitHubConnection {
  accessToken: string;
  username: string;
  connectedAt: number;
}

const githubTokens = new Map<string, GitHubConnection>();

export function storeGitHubToken(
  email: string,
  accessToken: string,
  username: string
): void {
  githubTokens.set(email, {
    accessToken,
    username,
    connectedAt: Date.now(),
  });
}

export function getGitHubToken(
  email: string
): GitHubConnection | undefined {
  return githubTokens.get(email);
}

export function removeGitHubToken(email: string): void {
  githubTokens.delete(email);
}

export function hasGitHubToken(email: string): boolean {
  return githubTokens.has(email);
}
