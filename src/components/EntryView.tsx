import type { DictionaryEntry } from '../types'
import { StarIcon } from './Icons'

interface EntryViewProps {
  entry: DictionaryEntry
  isFavorite: boolean
  onFavorite: () => void
}

export function EntryView({ entry, isFavorite, onFavorite }: EntryViewProps) {
  return (
    <article className="entry-view" aria-live="polite">
      <header className="entry-header">
        <div>
          <div className="entry-title-line">
            <h1>{entry.headword}</h1>
            {entry.traditional && entry.traditional !== entry.headword && <span className="traditional">繁 {entry.traditional}</span>}
            {(entry.ipa || entry.pronunciation) && <span className="phonetic">{entry.ipa ?? entry.pronunciation}</span>}
          </div>
        </div>
        <button
          className={`icon-button favorite-action ${isFavorite ? 'active' : ''}`}
          onClick={onFavorite}
          title={isFavorite ? '管理收藏' : '收藏到收藏夹'}
          aria-label={isFavorite ? '已收藏，管理收藏' : '收藏到收藏夹'}
          aria-pressed={isFavorite}
        >
          <StarIcon />
        </button>
      </header>

      <div className="sense-list">
        {entry.senses.map((sense, index) => (
          <section className="sense-group" key={`${sense.partOfSpeech ?? 'meaning'}-${index}`}>
            {sense.partOfSpeech && <span className="part-of-speech">{sense.partOfSpeech}</span>}
            <ol>
              {sense.definitions.map((definition) => <li key={definition}>{definition}</li>)}
            </ol>
          </section>
        ))}
      </div>
      <footer className="entry-source">来源：{entry.source}</footer>
    </article>
  )
}
