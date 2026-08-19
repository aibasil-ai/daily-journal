import { useState } from 'react'
import { Icon } from '../../components/icon'
import { zhTW } from '../../i18n/zh-TW'
import type { SheetConnectionInfo, UserProfile } from '../../services/journal-api-client'

type SettingsViewProps = {
  user?: UserProfile
  sheetConnection?: SheetConnectionInfo
  onSwitchSheet: (targetSpreadsheetId: string) => Promise<void>
  onRepairSheet: () => Promise<void>
  onDeleteAccount: () => Promise<void>
}

export function SettingsView({
  user,
  sheetConnection,
  onSwitchSheet,
  onRepairSheet,
  onDeleteAccount,
}: SettingsViewProps) {
  const [switchSheetId, setSwitchSheetId] = useState('')
  const [isSwitching, setIsSwitching] = useState(false)
  const [isRepairing, setIsRepairing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string }>()

  const handleSwitch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!switchSheetId.trim()) return
    setIsSwitching(true)
    setMessage(undefined)
    try {
      await onSwitchSheet(switchSheetId.trim())
      setMessage({ type: 'success', text: '已成功切換 Google Sheet。' })
      setSwitchSheetId('')
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : zhTW.errors.generic })
    } finally {
      setIsSwitching(false)
    }
  }

  const handleRepair = async () => {
    setIsRepairing(true)
    setMessage(undefined)
    try {
      await onRepairSheet()
      setMessage({ type: 'success', text: zhTW.settings.repairSuccess })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : zhTW.errors.generic })
    } finally {
      setIsRepairing(false)
    }
  }

  const handleDelete = async () => {
    if (deleteConfirmText !== 'DELETE') return
    setIsDeleting(true)
    setMessage(undefined)
    try {
      await onDeleteAccount()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : zhTW.errors.generic })
      setIsDeleting(false)
    }
  }

  return (
    <section className="settings-panel" style={{ maxWidth: 640, margin: '0 auto', padding: '1.5rem' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>{zhTW.settings.title}</h1>

      {message && (
        <div
          role="alert"
          style={{
            padding: '0.75rem 1rem',
            borderRadius: 6,
            marginBottom: '1.5rem',
            backgroundColor: message.type === 'success' ? '#E8F5E9' : '#FFEBEE',
            color: message.type === 'success' ? '#2E7D32' : '#C62828',
          }}
        >
          {message.text}
        </div>
      )}

      {user && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 8 }}>
          <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Google 帳號</strong>
          <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>{user.email || user.name}</p>
        </div>
      )}

      <div style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 8 }}>
        <strong style={{ display: 'block', marginBottom: '0.5rem' }}>{zhTW.settings.currentSheet}</strong>
        {sheetConnection ? (
          <div>
            <p style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>{sheetConnection.spreadsheetName}</p>
            <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
              ID: {sheetConnection.spreadsheetId}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <a
                href={`https://docs.google.com/spreadsheets/d/${sheetConnection.spreadsheetId}/edit`}
                target="_blank"
                rel="noreferrer"
                className="button button--secondary"
                style={{ textDecoration: 'none' }}
              >
                <Icon>open_in_new</Icon>
                {zhTW.settings.openInSheets}
              </a>
              <button
                type="button"
                className="button button--secondary"
                disabled={isRepairing}
                onClick={() => void handleRepair()}
              >
                <Icon>build</Icon>
                {isRepairing ? zhTW.settings.repairing : zhTW.settings.repairSheet}
              </button>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>尚未連結試算表</p>
        )}
      </div>

      <div style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 8 }}>
        <strong style={{ display: 'block', marginBottom: '0.5rem' }}>{zhTW.settings.switchSheet}</strong>
        <form onSubmit={handleSwitch} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={switchSheetId}
            onChange={(e) => setSwitchSheetId(e.target.value)}
            placeholder={zhTW.onboarding.sheetIdPlaceholder}
            style={{ flex: 1, minWidth: 200, padding: '0.5rem', borderRadius: 4, border: '1px solid var(--color-border)' }}
            required
          />
          <button type="submit" className="button button--primary" disabled={isSwitching}>
            {isSwitching ? zhTW.connection.connecting : zhTW.onboarding.selectButton}
          </button>
        </form>
      </div>

      <div style={{ padding: '1rem', border: '1px solid #FFCDD2', borderRadius: 8, backgroundColor: '#FFEBEE' }}>
        <strong style={{ display: 'block', color: '#C62828', marginBottom: '0.5rem' }}>{zhTW.settings.deleteAccount}</strong>
        <p style={{ fontSize: '0.85rem', color: '#B71C1C', marginBottom: '0.75rem' }}>
          {zhTW.settings.deleteWarning}
        </p>
        <button
          type="button"
          className="button"
          style={{ backgroundColor: '#C62828', color: '#fff', border: 'none' }}
          onClick={() => setShowDeleteModal(true)}
        >
          <Icon>delete_forever</Icon>
          {zhTW.settings.deleteAccount}
        </button>
      </div>

      {showDeleteModal && (
        <div className="editor-overlay" role="presentation">
          <div className="editor-modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }}>
            <header className="editor-modal__header">
              <h2>{zhTW.settings.deleteAccount}</h2>
            </header>
            <div style={{ padding: '1rem' }}>
              <p style={{ color: '#C62828', fontSize: '0.9rem' }}>{zhTW.settings.deleteWarning}</p>
              <label>
                <span style={{ fontSize: '0.85rem', display: 'block', margin: '0.75rem 0 0.25rem 0' }}>
                  {zhTW.settings.deleteConfirmPrompt}
                </span>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  style={{ width: '100%', padding: '0.5rem', borderRadius: 4, border: '1px solid var(--color-border)' }}
                />
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={isDeleting}
                >
                  {zhTW.actions.cancel}
                </button>
                <button
                  type="button"
                  className="button"
                  style={{ backgroundColor: '#C62828', color: '#fff', border: 'none' }}
                  disabled={deleteConfirmText !== 'DELETE' || isDeleting}
                  onClick={() => void handleDelete()}
                >
                  {isDeleting ? zhTW.settings.deleting : zhTW.settings.confirmDelete}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
