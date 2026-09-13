import type { CSSProperties, JSX } from 'react'
import { GAME_RARITIES, RARITY_RANK, type GameRarity } from '@shared/types'

function rarityLabel(rarity: GameRarity): string {
  return rarity[0].toUpperCase() + rarity.slice(1)
}

type RaritySliderProps = {
  value: GameRarity
  onChange: (rarity: GameRarity) => void
  disabled?: boolean
}

export default function RaritySlider({ value, onChange, disabled }: RaritySliderProps): JSX.Element {
  const rank = RARITY_RANK[value]
  const max = GAME_RARITIES.length - 1
  const style = {
    ['--rarity-step' as string]: rank,
    ['--rarity-max' as string]: max
  } as CSSProperties

  return (
    <label
      className={`rarity-slider rarity-slider-${value}`}
      style={style}
      title="Rarity — drag to change"
    >
      <span className="rarity-slider-track" aria-hidden="true">
        <span className="rarity-slider-fill" />
        {GAME_RARITIES.map((tier, index) => (
          <span
            key={tier}
            className={index <= rank ? 'rarity-slider-tick is-active' : 'rarity-slider-tick'}
            style={{
              left: `calc(var(--rarity-inset) + (100% - 2 * var(--rarity-inset)) * ${index / max})`
            }}
          />
        ))}
        <span className="rarity-slider-thumb" />
      </span>
      <span className="rarity-slider-body">{rarityLabel(value)}</span>
      <input
        className="rarity-slider-input"
        type="range"
        min={0}
        max={max}
        step={1}
        value={rank}
        disabled={disabled}
        aria-label="Rarity"
        aria-valuetext={rarityLabel(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={rank}
        onChange={(event) => {
          const next = GAME_RARITIES[Number(event.target.value)]
          if (next && next !== value) onChange(next)
        }}
      />
    </label>
  )
}
