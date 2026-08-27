import { Card, Switch } from 'comps'
import { memo, useCallback } from 'react'
import type { AudioToggleCardProps } from './types'

export const AudioToggleCard = memo<AudioToggleCardProps>((props) => {
  const {
    title,
    description,
    checked,
    disabled,
    onChange,
  } = props

  const handleChange = useCallback((value: boolean) => {
    if (disabled) return
    onChange(value)
  }, [disabled, onChange])

  return (
    <Card
      rounded="xl"
      padding="none"
      shadow="none"
      bordered={ false }
      hoverEffect={ false }
      bodyClassName="px-4 py-3"
      className="bg-background3"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{ title }</p>
          <p className="text-xs text-text3">{ description }</p>
        </div>
        <Switch
          size="sm"
          checked={ checked }
          disabled={ disabled }
          onChange={ handleChange }
        />
      </div>
    </Card>
  )
})

AudioToggleCard.displayName = 'AudioToggleCard'
