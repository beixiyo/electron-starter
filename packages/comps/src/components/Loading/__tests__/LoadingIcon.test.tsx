import { render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { LoadingIcon } from '../LoadingIcon'

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      cancel: vi.fn(),
    } as unknown as Animation)),
  })
})

afterAll(() => {
  if (originalAnimate) {
    Object.defineProperty(Element.prototype, 'animate', originalAnimate)
  }
  else {
    Reflect.deleteProperty(Element.prototype, 'animate')
  }
})

describe('LoadingIcon', () => {
  it('单独传入旧 borderWidth 时保留单色环的真实边框', () => {
    const markup = renderToStaticMarkup(<LoadingIcon borderWidth={ 4 } />)
    const { container } = render(<LoadingIcon borderWidth={ 4 } />)
    const icon = container.firstElementChild as HTMLElement

    /** jsdom 不解析含 CSS var() 的 border shorthand，SSR markup 仍能确认实际 4px 边框值 */
    expect(markup).toContain('border:4px solid rgb(var(--text) / 0.12)')
    expect(icon.style.borderTopColor).toBe('rgb(var(--text) / 0.5)')
    expect(icon.style.background).toBe('')
    expect(icon.style.mask).toBe('')
  })

  it.each([
    { label: 'true', gradient: true as const },
    { label: 'object', gradient: { from: 'red', to: 'blue' } },
  ])('显式渐变配置（$label）优先于旧 borderWidth', ({ gradient }) => {
    const { container } = render(
      <LoadingIcon
        borderWidth={ 4 }
        gradient={ gradient }
      />,
    )
    const icon = container.firstElementChild as HTMLElement

    if (typeof gradient === 'object') {
      expect(icon.style.background).toContain('conic-gradient(from 0deg, red 0deg, blue 360deg)')
    }
    else {
      expect(icon.style.background).toContain('conic-gradient(from 0deg, transparent 0deg, rgb(var(--text) / 0.8) 360deg)')
    }
    expect(icon.style.mask).toContain('data:image/svg+xml')
    expect(icon.style.border).toBe('')
  })

  it('旧 color 仍优先使用单色环', () => {
    const { container } = render(
      <LoadingIcon
        color="red"
        gradient={ true }
      />,
    )
    const icon = container.firstElementChild as HTMLElement

    expect(icon.style.borderTopColor).toBe('red')
    expect(icon.style.background).toBe('')
    expect(icon.style.mask).toBe('')
  })
})
