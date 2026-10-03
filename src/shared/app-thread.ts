/** F95zone thread for this app. */
export const APP_THREAD_ID = 314326

export function appThreadUrl(threadId = APP_THREAD_ID): string {
  return `https://f95zone.to/threads/${threadId}/`
}
