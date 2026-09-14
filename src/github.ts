import { config } from './config.js';

export type GitHubUser = {
  login: string;
  name: string | null;
  htmlUrl: string;
  publicRepos: number;
};

/**
 * `GET /user` — the endpoint that answers "whose token is this?", which makes it
 * the clearest proof that the credential the gateway released is the PAT and that
 * it arrived intact. Only describes the request; `keydrisFetch` redeems the
 * token, injects the credential, and sends it.
 */
export function userRequest(): { url: URL; init: RequestInit } {
  return {
    url: new URL('/user', config.githubApiBase),
    init: {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'keydris-manufact-template',
      },
    },
  };
}

export function parseUser(payload: unknown): GitHubUser {
  const user = payload as {
    login: string;
    name: string | null;
    html_url: string;
    public_repos: number;
  };
  return {
    login: user.login,
    name: user.name,
    htmlUrl: user.html_url,
    publicRepos: user.public_repos,
  };
}
