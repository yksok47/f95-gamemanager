import { FormEvent, useEffect, useState, type JSX } from 'react'
import type { TwoStepChallenge } from '@shared/types'
import appIcon from '../assets/icon.png'

type LoginPageProps = {
  busy: boolean
  onSubmit: (username: string, password: string) => Promise<void>
  twoStep: TwoStepChallenge | null
  onSubmitTwoStep: (code: string, trust: boolean) => Promise<void>
  onSwitchTwoStepProvider: (providerId: string) => Promise<void>
  onCancelTwoStep: () => Promise<void>
  currentVersion?: string
  latestVersion?: string | null
}

const PROVIDER_NAMES: Record<string, string> = {
  totp: 'authenticator app',
  email: 'email',
  backup: 'backup code',
  authy: 'Authy'
}

const PROVIDER_PROMPTS: Record<string, string> = {
  totp: 'Enter the code shown in your authenticator app.',
  email: 'Enter the code F95zone sent to your email address.',
  backup: 'Enter one of your unused backup codes.'
}

function providerName(id: string): string {
  return PROVIDER_NAMES[id] ?? id
}

function TwoStepForm({
  busy,
  challenge,
  onSubmit,
  onSwitchProvider,
  onCancel
}: {
  busy: boolean
  challenge: TwoStepChallenge
  onSubmit: (code: string, trust: boolean) => Promise<void>
  onSwitchProvider: (providerId: string) => Promise<void>
  onCancel: () => Promise<void>
}): JSX.Element {
  const [code, setCode] = useState('')
  const [trust, setTrust] = useState(true)

  useEffect(() => {
    setCode('')
  }, [challenge])

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    await onSubmit(code, trust)
  }

  const prompt =
    challenge.prompt ||
    PROVIDER_PROMPTS[challenge.provider] ||
    'Enter the verification code for your F95zone account.'
  const isBackup = challenge.provider === 'backup'

  return (
    <>
      <p className="muted">{prompt}</p>
      <form className="login-form" onSubmit={handleSubmit}>
        <label>
          Verification code
          <input
            autoFocus
            autoComplete="one-time-code"
            inputMode={isBackup ? 'text' : 'numeric'}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={busy}
            required
          />
        </label>
        {challenge.error ? (
          <p className="login-error" role="alert">
            {challenge.error}
          </p>
        ) : null}
        {challenge.canTrust ? (
          <label className="login-checkbox">
            <input
              type="checkbox"
              checked={trust}
              onChange={(event) => setTrust(event.target.checked)}
              disabled={busy}
            />
            Don't ask again on this device
          </label>
        ) : null}
        <div className="login-actions">
          <button className="ghost-btn" type="button" onClick={() => void onCancel()} disabled={busy}>
            Back
          </button>
          <button className="primary-btn" type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      </form>
      <div className="login-two-step-alt">
        {challenge.provider === 'email' ? (
          <button
            className="link-btn"
            type="button"
            onClick={() => void onSwitchProvider(challenge.provider)}
            disabled={busy}
          >
            Resend email
          </button>
        ) : null}
        {challenge.providers.map((provider) => (
          <button
            key={provider.id}
            className="link-btn"
            type="button"
            onClick={() => void onSwitchProvider(provider.id)}
            disabled={busy}
          >
            Use {provider.label || providerName(provider.id)} instead
          </button>
        ))}
      </div>
    </>
  )
}

export default function LoginPage({
  busy,
  onSubmit,
  twoStep,
  onSubmitTwoStep,
  onSwitchTwoStepProvider,
  onCancelTwoStep,
  currentVersion,
  latestVersion
}: LoginPageProps): JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    await onSubmit(username, password)
  }

  return (
    <div className="center-screen">
      <section className="login-card">
        <img className="login-app-icon" src={appIcon} alt="" width={72} height={72} />
        <h1>{twoStep ? 'Two-step verification' : 'F95 Game Manager'}</h1>
        {twoStep ? (
          <TwoStepForm
            busy={busy}
            challenge={twoStep}
            onSubmit={onSubmitTwoStep}
            onSwitchProvider={onSwitchTwoStepProvider}
            onCancel={async () => {
              setPassword('')
              await onCancelTwoStep()
            }}
          />
        ) : (
          <>
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
              <button className="primary-btn" type="submit" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </>
        )}
        {currentVersion ? (
          <p className="muted login-version">
            Current version {currentVersion}
            {latestVersion ? ` · available ${latestVersion}` : ''}
          </p>
        ) : null}
      </section>
    </div>
  )
}
