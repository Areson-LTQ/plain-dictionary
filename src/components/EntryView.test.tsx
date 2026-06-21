import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EntryView } from './EntryView'
import type { DictionaryEntry } from '../types'

const entry: DictionaryEntry = {
  id: 'en:computer',
  headword: 'computer',
  normalizedHeadword: 'computer',
  language: 'en',
  ipa: '/kəmˈpjutɚ/',
  source: 'FreeDict + WikDict',
  senses: [
    { partOfSpeech: '名词', definitions: ['电脑', '计算机'] },
  ],
}

describe('EntryView', () => {
  it('renders the headword, IPA, part of speech and every definition', () => {
    render(<EntryView entry={entry} isFavorite={false} onFavorite={() => undefined} />)

    expect(screen.getByRole('heading', { name: 'computer' })).toBeInTheDocument()
    expect(screen.getByText('/kəmˈpjutɚ/')).toBeInTheDocument()
    expect(screen.getByText('名词')).toBeInTheDocument()
    expect(screen.getByText('电脑')).toBeInTheDocument()
    expect(screen.getByText('计算机')).toBeInTheDocument()
  })

  it('shows favorite state and invokes the favorite action', () => {
    const onFavorite = vi.fn()
    render(<EntryView entry={entry} isFavorite onFavorite={onFavorite} />)

    const button = screen.getByRole('button', { name: '已收藏，管理收藏' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(button)
    expect(onFavorite).toHaveBeenCalledOnce()
  })
})
