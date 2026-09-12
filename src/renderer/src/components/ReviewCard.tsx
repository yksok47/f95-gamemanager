import type { JSX, MouseEvent } from 'react'
import type { ThreadReview } from '@shared/types'

type ReviewScore = 0 | 1 | 2 | 3 | 4 | 5

function scoreOf(rating: number): ReviewScore {
  if (!Number.isFinite(rating) || rating <= 0) return 0
  return Math.min(5, Math.max(1, Math.round(rating))) as ReviewScore
}

function ScoreIcon({ score }: { score: ReviewScore }): JSX.Element {
  if (score === 5) {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path
          fill="currentColor"
          d="m24 5 5.4 11.2 12.3 1.8-8.9 8.6 2.1 12.2L24 32.8 13.1 38.8l2.1-12.2-8.9-8.6 12.3-1.8z"
        />
      </svg>
    )
  }
  if (score === 4) {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="20" fill="currentColor" />
        <circle cx="16.5" cy="20" r="3.1" fill="var(--review-face-cut)" />
        <circle cx="31.5" cy="20" r="3.1" fill="var(--review-face-cut)" />
        <path
          fill="var(--review-face-cut)"
          d="M14.8 27.2c2.4 6.4 6.1 9.2 9.2 9.2s6.8-2.8 9.2-9.2c.25-.7-.4-1.3-1.1-1-2.4.9-5 1.4-8.1 1.4s-5.7-.5-8.1-1.4c-.7-.3-1.35.3-1.1 1z"
        />
      </svg>
    )
  }
  if (score === 3) {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="20" fill="currentColor" />
        <circle cx="16.5" cy="20" r="3.1" fill="var(--review-face-cut)" />
        <circle cx="31.5" cy="20" r="3.1" fill="var(--review-face-cut)" />
        <rect x="15.5" y="30" width="17" height="3.2" rx="1.6" fill="var(--review-face-cut)" />
      </svg>
    )
  }
  if (score === 2) {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="20" fill="currentColor" />
        <path
          fill="var(--review-face-cut)"
          d="M12.2 15.4c1.7-.9 3.5-.3 4.2 1.1.3.6 1.1.8 1.7.4.6-.3.8-1.1.4-1.7-1.4-2.7-4.5-3.8-7.3-2.3-.6.3-.8 1.1-.4 1.7.3.5 1 .8 1.4.8zM35.8 15.4c.4-.6.2-1.4-.4-1.7-2.8-1.5-5.9-.4-7.3 2.3-.4.6-.2 1.4.4 1.7.6.4 1.4.2 1.7-.4.7-1.4 2.5-2 4.2-1.1.4 0 1.1-.3 1.4-.8z"
        />
        <circle cx="16.5" cy="21.2" r="3.1" fill="var(--review-face-cut)" />
        <circle cx="31.5" cy="21.2" r="3.1" fill="var(--review-face-cut)" />
        <path
          fill="var(--review-face-cut)"
          d="M33.2 34.6c-2.4-5.2-5.8-7.4-9.2-7.4s-6.8 2.2-9.2 7.4c-.3.7.35 1.3 1.1 1 2.3-.8 5-.1 8.1-.1s5.8-.7 8.1.1c.75.3 1.4-.3 1.1-1z"
        />
      </svg>
    )
  }
  if (score === 1) {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="20" fill="currentColor" />
        <path
          fill="none"
          stroke="var(--review-face-cut)"
          strokeLinecap="round"
          strokeWidth="3.4"
          d="M11.5 15.2 21 19.2M36.5 15.2 27 19.2"
        />
        <circle cx="16.8" cy="23.4" r="2.6" fill="var(--review-face-cut)" />
        <circle cx="31.2" cy="23.4" r="2.6" fill="var(--review-face-cut)" />
        <path
          fill="var(--review-face-cut)"
          d="M33.4 35.8c-2.5-5.6-6-8-9.4-8s-6.9 2.4-9.4 8c-.3.7.4 1.3 1.15.95 2.5-1.1 5.3-1.65 8.25-1.65s5.75.55 8.25 1.65c.75.35 1.45-.25 1.15-.95z"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="20" fill="currentColor" />
      <circle cx="24" cy="17.5" r="2.4" fill="var(--review-face-cut)" />
      <rect x="21.8" y="22.2" width="4.4" height="11" rx="2.2" fill="var(--review-face-cut)" />
    </svg>
  )
}

function scoreLabel(score: ReviewScore): string {
  if (score === 5) return '5 stars'
  if (score === 4) return '4 stars'
  if (score === 3) return '3 stars'
  if (score === 2) return '2 stars'
  if (score === 1) return '1 star'
  return 'No score'
}

type ReviewCardProps = {
  review: ThreadReview
  date: string
  onProseClick: (event: MouseEvent<HTMLDivElement>) => void
}

export default function ReviewCard({ review, date, onProseClick }: ReviewCardProps): JSX.Element {
  const score = scoreOf(review.rating)
  return (
    <article className={`review-card review-card-${score}`}>
      <div className="review-score" title={scoreLabel(score)} aria-label={scoreLabel(score)}>
        <ScoreIcon score={score} />
      </div>
      <div className="review-message">
        <header>
          <strong>{review.author}</strong>
          {date ? <span className="muted">{date}</span> : null}
        </header>
        {review.html ? (
          <div
            className="review-prose thread-prose"
            onClick={onProseClick}
            dangerouslySetInnerHTML={{ __html: review.html }}
          />
        ) : (
          <p className="review-prose-text">{review.body}</p>
        )}
      </div>
    </article>
  )
}
