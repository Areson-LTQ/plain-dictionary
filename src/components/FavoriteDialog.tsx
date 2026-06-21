import { useEffect, useState } from 'react'
import { api, getErrorMessage } from '../api'
import type { FavoriteFolder } from '../types'
import { CloseIcon, FolderIcon } from './Icons'

interface FavoriteDialogProps {
  entryId: string
  onChanged: (isFavorite: boolean) => void
  onClose: () => void
}

export function FavoriteDialog({ entryId, onChanged, onClose }: FavoriteDialogProps) {
  const [folders, setFolders] = useState<FavoriteFolder[]>([])
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const nextFolders = await api.listFavoriteFolders()
      setFolders(nextFolders)
      onChanged(nextFolders.some((folder) => folder.entries.some((item) => item.entryId === entryId)))
    } catch (cause) { setError(getErrorMessage(cause)) }
  }

  useEffect(() => { void load() }, [])

  const toggle = async (folder: FavoriteFolder) => {
    const exists = folder.entries.some((item) => item.entryId === entryId)
    try {
      if (exists) await api.removeFavorite(folder.id, entryId)
      else await api.addFavorite(folder.id, entryId)
      await load()
    } catch (cause) { setError(getErrorMessage(cause)) }
  }

  const createFolder = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newName.trim()) return
    try {
      const folderId = await api.createFavoriteFolder(newName)
      await api.addFavorite(folderId, entryId)
      setNewName('')
      await load()
    } catch (cause) { setError(getErrorMessage(cause)) }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog favorite-dialog" role="dialog" aria-modal="true" aria-labelledby="favorite-title">
        <header><h2 id="favorite-title">加入收藏夹</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><CloseIcon /></button></header>
        {folders.length === 0 ? <p className="muted">还没有收藏夹，新建一个吧。</p> : (
          <div className="folder-check-list">
            {folders.map((folder) => {
              const checked = folder.entries.some((item) => item.entryId === entryId)
              return <label key={folder.id}><input type="checkbox" checked={checked} onChange={() => void toggle(folder)} /><FolderIcon />{folder.name}</label>
            })}
          </div>
        )}
        <form className="new-folder-form" onSubmit={createFolder}>
          <input value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={40} placeholder="新收藏夹名称" />
          <button type="submit">新建并加入</button>
        </form>
        {error && <p className="error-text">{error}</p>}
      </section>
    </div>
  )
}
