import type { JSX } from 'react'
import FollowedPage, { type FollowedPageProps } from './FollowedPage'

export default function UpdatesPage(props: Omit<FollowedPageProps, 'mode'>): JSX.Element {
  return <FollowedPage {...props} mode="updates" />
}
