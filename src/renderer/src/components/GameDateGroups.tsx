import type { JSX, ReactNode } from 'react'
import { groupByUpdateDate } from '@shared/updates'

type DatedGame = {
  timestamp?: number | null
}

type GameDateGroupsProps<T extends DatedGame> = {
  games: T[]
  grouped: boolean
  timestampOf?: (game: T) => number | undefined | null
  children: (game: T, index: number) => ReactNode
}

export default function GameDateGroups<T extends DatedGame>({
  games,
  grouped,
  timestampOf,
  children
}: GameDateGroupsProps<T>): JSX.Element {
  if (!grouped) {
    return <div className="catalog-grid">{games.map((game, index) => children(game, index))}</div>
  }

  const groups = groupByUpdateDate(games, timestampOf ?? ((game) => game.timestamp))
  let index = 0
  return (
    <div className="catalog-groups">
      {groups.map((group) => (
        <section key={group.key} className="catalog-date-group">
          <h2 className="catalog-date-group-title">{group.label}</h2>
          <div className="catalog-grid">
            {group.items.map((game) => {
              const nextIndex = index
              index += 1
              return children(game, nextIndex)
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
