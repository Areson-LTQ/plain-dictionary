import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { api, getErrorMessage } from './api'
import { ChartIcon, CloseIcon, FolderIcon, StarIcon } from './components/Icons'
import type { DictionaryUpdateInfo, FavoriteFolder, Metadata, QueryStat, RecentQuery } from './types'

type Tab = 'stats' | 'favorites'

export function ManagementWindow() {
  const [tab, setTab] = useState<Tab>('stats')
  const [stats, setStats] = useState<QueryStat[]>([])
  const [recent, setRecent] = useState<RecentQuery[]>([])
  const [folders, setFolders] = useState<FavoriteFolder[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [metadata, setMetadata] = useState<Metadata | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<DictionaryUpdateInfo | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')
  const [renameFolderTarget, setRenameFolderTarget] = useState<FavoriteFolder | null>(null)
  const [renameFolderName, setRenameFolderName] = useState('')
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<FavoriteFolder | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [nextStats, nextRecent, nextFolders] = await Promise.all([api.getQueryStats(), api.getRecentQueries(), api.listFavoriteFolders()])
      setStats(nextStats)
      setRecent(nextRecent)
      setFolders(nextFolders)
      setSelectedFolderId((current) => nextFolders.some((folder) => folder.id === current) ? current : nextFolders[0]?.id ?? null)
    } catch (cause) { setError(getErrorMessage(cause)) }
  }, [])

  useEffect(() => {
    void load()
    const unlisten = listen<string>('select-tab', (event) => {
      setTab(event.payload === 'favorites' ? 'favorites' : 'stats')
      void load()
    })
    return () => { void unlisten.then((dispose) => dispose()) }
  }, [load])

  const createFolder = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newFolderName.trim()) return
    try {
      const id = await api.createFavoriteFolder(newFolderName)
      setNewFolderName('')
      setSelectedFolderId(id)
      await load()
    } catch (cause) { setError(getErrorMessage(cause)) }
  }

  const openRenameFolder = (folder: FavoriteFolder) => {
    setError('')
    setRenameFolderTarget(folder)
    setRenameFolderName(folder.name)
  }

  const renameFolder = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!renameFolderTarget || !renameFolderName.trim()) return
    try {
      await api.renameFavoriteFolder(renameFolderTarget.id, renameFolderName)
      setRenameFolderTarget(null)
      await load()
    } catch (cause) { setError(getErrorMessage(cause)) }
  }

  const deleteFolder = async () => {
    if (!deleteFolderTarget) return
    try {
      await api.deleteFavoriteFolder(deleteFolderTarget.id)
      setDeleteFolderTarget(null)
      setSelectedFolderId(null)
      await load()
    } catch (cause) { setError(getErrorMessage(cause)) }
  }

  const removeFavorite = async (folderId: number, entryId: string) => {
    try { await api.removeFavorite(folderId, entryId); await load() } catch (cause) { setError(getErrorMessage(cause)) }
  }

  const showAbout = async () => {
    try {
      setMetadata(await api.metadata())
      setUpdateInfo(null)
      setUpdateMessage('')
      setAboutOpen(true)
    } catch (cause) { setError(getErrorMessage(cause)) }
  }

  const checkUpdate = async () => {
    setUpdateBusy(true)
    setUpdateMessage('')
    try {
      const info = await api.checkDictionaryUpdate()
      setUpdateInfo(info)
      setUpdateMessage(!info.configured ? '当前构建未配置可信更新源。' : info.updateAvailable ? `发现词库版本 ${info.latestVersion}。` : '当前已是最新版本。')
    } catch (cause) { setUpdateMessage(getErrorMessage(cause)) } finally { setUpdateBusy(false) }
  }

  const installUpdate = async () => {
    setUpdateBusy(true)
    setUpdateMessage('正在下载并校验词库，请勿关闭应用。')
    try {
      const info = await api.installDictionaryUpdate()
      setUpdateInfo(info)
      setMetadata(await api.metadata())
      setUpdateMessage(`词库已更新到 ${info.currentVersion}。`)
      await load()
    } catch (cause) { setUpdateMessage(getErrorMessage(cause)) } finally { setUpdateBusy(false) }
  }

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId)

  return (
    <main className="management-window">
      <header className="management-header">
        <div><h1>词语管理</h1></div>
        <div className="management-actions">
          <nav className="tabs" aria-label="管理内容">
            <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}><ChartIcon />查询统计</button>
            <button className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}><StarIcon />收藏夹</button>
          </nav>
          <button className="icon-button management-close" onClick={() => void getCurrentWindow().hide()} title="关闭" aria-label="关闭"><CloseIcon /></button>
        </div>
      </header>
      {error && <p className="error-banner">{error}</p>}

      {tab === 'stats' ? (
        <section className="panel stats-panel">
          <section className="management-recent">
            <h2>最近查询</h2>
            {recent.length === 0 ? <p className="muted">查询过的词会出现在这里。</p> : (
              <div className="recent-list">
                {recent.map((item, index) => <button key={`${item.entryId}-${item.queriedAt}-${index}`} onClick={() => void api.focusMainWindow(item.entryId)}><span>{item.headword}</span><small>{item.language === 'en' ? 'EN' : '中'}</small></button>)}
              </div>
            )}
          </section>
          <div className="panel-title"><div><h2>查询统计</h2><p>共查过 {stats.length} 个不同词条</p></div><span className="total-count">{stats.reduce((sum, item) => sum + item.queryCount, 0)}<small>次查询</small></span></div>
          {stats.length === 0 ? <div className="empty-state"><strong>还没有统计数据</strong><span>在主窗口确认查询后，这里会自动累计。</span></div> : (
            <div className="data-list">
              <div className="data-head"><span>词条</span><span>最近查询</span><span>次数</span></div>
              {stats.map((item, index) => (
                <button key={item.entryId} disabled={!item.available} onClick={() => void api.focusMainWindow(item.entryId)}>
                  <span className="rank">{index + 1}</span><strong>{item.headword}</strong><small>{item.language === 'en' ? '英文' : '中文'}{!item.available && ' · 暂不可用'}</small>
                  <time>{formatDate(item.lastQueriedAt)}</time><b>{item.queryCount}</b>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="favorites-layout">
          <aside className="folder-sidebar">
            <h2>收藏夹</h2>
            <form onSubmit={createFolder}><input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} maxLength={40} placeholder="新建收藏夹" /><button type="submit" aria-label="新建">+</button></form>
            <div className="folder-list">
              {folders.map((folder) => <button className={folder.id === selectedFolderId ? 'active' : ''} key={folder.id} onClick={() => setSelectedFolderId(folder.id)}><FolderIcon /><span>{folder.name}</span><small>{folder.entries.length}</small></button>)}
            </div>
          </aside>
          <section className="favorite-content">
            {!selectedFolder ? <div className="empty-state"><strong>新建一个收藏夹</strong><span>然后从词条详情将单词加入这里。</span></div> : <>
              <header><div><h2>{selectedFolder.name}</h2><p>{selectedFolder.entries.length} 个词条</p></div><div><button type="button" onClick={() => openRenameFolder(selectedFolder)}>重命名</button><button type="button" className="danger" onClick={() => { setError(''); setDeleteFolderTarget(selectedFolder) }}>删除</button></div></header>
              {selectedFolder.entries.length === 0 ? <div className="empty-state"><strong>收藏夹还是空的</strong><span>在主窗口查词后点击“收藏”。</span></div> : (
                <div className="favorite-grid">{selectedFolder.entries.map((item) => <article key={item.entryId} className={!item.available ? 'unavailable' : ''}><button className="word" disabled={!item.available} onClick={() => void api.focusMainWindow(item.entryId)}><strong>{item.headword}</strong><small>{item.available ? (item.language === 'en' ? '英文' : '中文') : '词库中暂不可用'}</small></button><button className="remove" onClick={() => void removeFavorite(selectedFolder.id, item.entryId)}>移除</button></article>)}</div>
              )}
            </>}
          </section>
        </section>
      )}
      <footer className="management-footer"><button onClick={() => void showAbout()}>关于词库与许可</button><span>离线查询 · 数据留在本机</span></footer>
      {renameFolderTarget && <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setRenameFolderTarget(null)}>
        <section className="dialog folder-action-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-folder-title">
          <header><h2 id="rename-folder-title">重命名收藏夹</h2><button type="button" className="icon-button" onClick={() => setRenameFolderTarget(null)} aria-label="关闭"><CloseIcon /></button></header>
          <form onSubmit={renameFolder}>
            <input autoFocus value={renameFolderName} onChange={(event) => setRenameFolderName(event.target.value)} maxLength={40} aria-label="收藏夹名称" />
            {error && <p className="error-text">{error}</p>}
            <div className="dialog-actions"><button type="button" onClick={() => setRenameFolderTarget(null)}>取消</button><button type="submit" className="primary">保存</button></div>
          </form>
        </section>
      </div>}
      {deleteFolderTarget && <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDeleteFolderTarget(null)}>
        <section className="dialog folder-action-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-folder-title">
          <header><h2 id="delete-folder-title">删除收藏夹</h2><button type="button" className="icon-button" onClick={() => setDeleteFolderTarget(null)} aria-label="关闭"><CloseIcon /></button></header>
          <p>确定删除“{deleteFolderTarget.name}”吗？{deleteFolderTarget.entries.length > 0 && `其中 ${deleteFolderTarget.entries.length} 条收藏关系也会删除。`}词典词条和查询统计不会受影响。</p>
          {error && <p className="error-text">{error}</p>}
          <div className="dialog-actions"><button type="button" onClick={() => setDeleteFolderTarget(null)}>取消</button><button type="button" className="danger-primary" onClick={() => void deleteFolder()}>删除</button></div>
        </section>
      </div>}
      {aboutOpen && metadata && <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !updateBusy && setAboutOpen(false)}><section className="dialog about-dialog" role="dialog" aria-modal="true"><h2>词库与许可</h2><dl><dt>版本</dt><dd>{metadata.version}</dd><dt>构建</dt><dd>{metadata.builtAt}</dd><dt>数据源</dt><dd>{metadata.sources}</dd><dt>许可</dt><dd>{metadata.license}</dd></dl><p>应用代码与词典数据分别遵循各自许可证。再分发派生词库时必须保留来源署名及相同方式共享要求。</p><section className="dictionary-update"><strong>词库更新</strong><p>仅在你主动操作时联网。下载内容会经过签名、哈希和 SQLite 完整性校验。</p>{updateMessage && <output>{updateMessage}</output>}<div>{updateInfo?.updateAvailable && <button disabled={updateBusy} onClick={() => void installUpdate()}>{updateBusy ? '更新中…' : `安装 ${updateInfo.latestVersion}`}</button>}<button disabled={updateBusy} onClick={() => void checkUpdate()}>{updateBusy ? '检查中…' : '检查更新'}</button></div></section><button disabled={updateBusy} onClick={() => setAboutOpen(false)}>关闭</button></section></div>}
    </main>
  )
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}
