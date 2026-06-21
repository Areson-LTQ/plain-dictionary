import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { api, getErrorMessage } from './api'
import { EntryView } from './components/EntryView'
import { FavoriteDialog } from './components/FavoriteDialog'
import { ChartIcon, PinIcon, SearchIcon } from './components/Icons'
import { useDebouncedValue } from './hooks/useDebouncedValue'
import type { DictionaryEntry, EntrySummary } from './types'

export function MainWindow() {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<EntrySummary[]>([])
  const [entry, setEntry] = useState<DictionaryEntry | null>(null)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [isFavorite, setIsFavorite] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [favoriteOpen, setFavoriteOpen] = useState(false)
  const [appVersion, setAppVersion] = useState('')
  const requestId = useRef(0)
  const debouncedQuery = useDebouncedValue(query, 150)

  const refreshFavoriteStatus = useCallback(async (entryId: string) => {
    try {
      const folders = await api.listFavoriteFolders()
      setIsFavorite(folders.some((folder) => folder.entries.some((item) => item.entryId === entryId)))
    } catch (cause) {
      setError(getErrorMessage(cause))
    }
  }, [])

  const openEntry = useCallback(async (entryId: string, shouldRecord: boolean) => {
    setLoading(true)
    setError('')
    try {
      const selected = await api.getEntry(entryId)
      if (shouldRecord) await api.recordQuery(entryId)
      setEntry(selected)
      setQuery(selected.headword)
      setSuggestions([])
      setSearched(true)
      void refreshFavoriteStatus(entryId)
    } catch (cause) { setError(getErrorMessage(cause)) }
    finally { setLoading(false) }
  }, [refreshFavoriteStatus])

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => undefined)
    void api.getSettings().then((settings) => setAlwaysOnTop(settings.alwaysOnTop)).catch((cause) => setError(getErrorMessage(cause)))
    const unlisten = listen<string>('open-entry', (event) => void openEntry(event.payload, false))
    return () => { void unlisten.then((dispose) => dispose()) }
  }, [openEntry])

  useEffect(() => {
    const id = ++requestId.current
    const value = debouncedQuery.trim()
    if (!value || value === entry?.headword) {
      setSuggestions([])
      return
    }
    void api.searchEntries(value).then((results) => {
      if (id === requestId.current) setSuggestions(results)
    }).catch((cause) => setError(getErrorMessage(cause)))
  }, [debouncedQuery, entry?.headword])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = query.trim()
    if (!value) return
    setLoading(true)
    try {
      const results = suggestions.length > 0 ? suggestions : await api.searchEntries(value)
      const exact = results.find((result) => result.headword.toLowerCase() === value.toLowerCase())
      const target = exact ?? results[0]
      setSearched(true)
      if (target) await openEntry(target.id, true)
      else { setEntry(null); setSuggestions([]) }
    } catch (cause) { setError(getErrorMessage(cause)) }
    finally { setLoading(false) }
  }

  const togglePin = async () => {
    const next = !alwaysOnTop
    try { await api.setAlwaysOnTop(next); setAlwaysOnTop(next) } catch (cause) { setError(getErrorMessage(cause)) }
  }

  const startWindowDrag = (event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    void getCurrentWindow().startDragging().catch((cause) => setError(getErrorMessage(cause)))
  }

  return (
    <main className="main-window">
      <header className="app-bar" data-tauri-drag-region onMouseDown={startWindowDrag}>
        <span className="titlebar-title" data-tauri-drag-region>简词{appVersion && <small>v{appVersion}</small>}</span>
        <div className="app-actions">
          <button className="icon-button" onClick={() => void api.openManagementWindow('stats')} title="查看统计" aria-label="查看统计"><ChartIcon /></button>
          <button className={`icon-button ${alwaysOnTop ? 'active' : ''}`} onClick={togglePin} title={alwaysOnTop ? '取消置顶' : '置于顶层'} aria-pressed={alwaysOnTop}><PinIcon /></button>
        </div>
      </header>

      <form className="search-box" onSubmit={submit} role="search">
        <SearchIcon />
        <input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setSearched(false) }} placeholder="输入英文单词或中文词语" aria-label="查词" />
        <kbd>Enter</kbd>
        {suggestions.length > 0 && (
          <div className="suggestions" role="listbox">
            {suggestions.map((suggestion) => (
              <button type="button" key={suggestion.id} role="option" onClick={() => void openEntry(suggestion.id, true)}>
                <strong>{suggestion.headword}</strong>
                <span>{suggestion.ipa ?? suggestion.pronunciation ?? (suggestion.language === 'en' ? '英文' : '中文')}</span>
              </button>
            ))}
          </div>
        )}
      </form>

      {error && <p className="error-banner">{error}</p>}
      <section className="result-area">
        {loading && !entry ? <div className="empty-state">正在查找…</div> : entry ? (
          <EntryView entry={entry} isFavorite={isFavorite} onFavorite={() => setFavoriteOpen(true)} />
        ) : searched ? (
          <div className="empty-state"><strong>没有找到这个词</strong><span>试试更短的词语或检查拼写。</span></div>
        ) : (
          <div className="welcome"><span className="welcome-character">Aa</span><p>英语看音标与分类释义<br />中文找相关英文表达</p></div>
        )}
      </section>
      {favoriteOpen && entry && <FavoriteDialog entryId={entry.id} onChanged={setIsFavorite} onClose={() => setFavoriteOpen(false)} />}
    </main>
  )
}
