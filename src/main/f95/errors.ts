export class F95Error extends Error {
  constructor(
    message: string,
    readonly code:
      | 'login_required'
      | 'auth_failed'
      | 'rate_limited'
      | 'blocked'
      | 'network'
      | 'parse'
  ) {
    super(message)
    this.name = 'F95Error'
  }
}
