export function formatCount(value: number | undefined): string {
  const amount = Number(value) || 0
  if (amount < 1000) return String(Math.round(amount))
  if (amount < 10_000) return `${(amount / 1000).toFixed(1)}k`
  if (amount < 1_000_000) return `${Math.round(amount / 1000)}k`
  if (amount < 10_000_000) return `${(amount / 1_000_000).toFixed(1)}M`
  return `${Math.round(amount / 1_000_000)}M`
}

export type RatingTone = 'violet' | 'blue' | 'green' | 'yellow' | 'red' | 'black' | 'none'

export function ratingTone(rating: number | undefined): RatingTone {
  const value = Number(rating) || 0
  if (value >= 4.5) return 'violet'
  if (value >= 4) return 'blue'
  if (value >= 3.5) return 'green'
  if (value >= 3) return 'yellow'
  if (value >= 2) return 'red'
  if (value > 0) return 'black'
  return 'none'
}

export function formatRating(rating: number | undefined): string {
  if (!rating) return 'Unrated'
  return `${rating.toFixed(2)}★`
}

export function ratingClass(rating: number | undefined): string {
  const tone = ratingTone(rating)
  return tone === 'none' ? 'rating-none' : `rating-${tone}`
}
