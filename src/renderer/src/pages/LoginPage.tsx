import { FormEvent, useState, type JSX } from 'react'

type LoginPageProps = {
  busy: boolean
  error: string | null
  onSubmit: (username: string, password: string) => Promise<void>
}

export default function LoginPage({ busy, error, onSubmit }: LoginPageProps): JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    await onSubmit(username, password)
  }

  return (
    <div className="center-screen">
      <section className="login-card">
        <h1>F95 Game Manager</h1>
        <p className="muted">Sign in with your F95zone account. The session is stored locally and reused on the next launch.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Username or email
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={busy}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              required
            />
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="primary-btn" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  )
}
