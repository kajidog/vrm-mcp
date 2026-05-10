import type { SpeakerStyle } from '../hooks/useSpeakers'
import { formatBytes } from '../utils/format'

interface VrmInfoSectionProps {
  name: string
  speakerId: number | null
  isDefault: boolean
  isPublic: boolean
  speakers: SpeakerStyle[]
  speakersLoading: boolean
  speakersError: string | null
  portrait: string | null
  selectedSpeaker: SpeakerStyle | null
  vrmFileName: string | null
  vrmSize: number
  isEdit: boolean
  onNameChange: (name: string) => void
  onSpeakerChange: (speakerId: number | null) => void
  onDefaultChange: (isDefault: boolean) => void
  onPublicChange: (isPublic: boolean) => void
  openFilePicker: () => void
}

export function VrmInfoSection({
  name,
  speakerId,
  isDefault,
  isPublic,
  speakers,
  speakersLoading,
  speakersError,
  portrait,
  selectedSpeaker,
  vrmFileName,
  vrmSize,
  isEdit,
  onNameChange,
  onSpeakerChange,
  onDefaultChange,
  onPublicChange,
  openFilePicker,
}: VrmInfoSectionProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block text-xs">
        <div className="mb-1 font-semibold text-[var(--ui-text)]">表示名</div>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="例: マイキャラ"
          className="w-full rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-2 text-sm text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
        />
      </label>

      <div className="text-xs">
        <div className="mb-1 font-semibold text-[var(--ui-text)]">デフォルト話者</div>
        <div className="flex items-center gap-2">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--ui-border)] bg-[var(--ui-tag-bg)] text-[var(--ui-text-secondary)]">
            {portrait ? (
              <img
                src={`data:image/png;base64,${portrait}`}
                alt={selectedSpeaker?.characterName ?? 'Speaker'}
                className="h-full w-full object-cover object-[center_top]"
              />
            ) : (
              <span className="text-[10px]">no img</span>
            )}
          </span>
          <select
            value={speakerId ?? ''}
            onChange={(e) => {
              const next = e.target.value === '' ? null : Number(e.target.value)
              onSpeakerChange(next)
            }}
            disabled={speakersLoading}
            className="min-w-0 flex-1 rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-2 text-sm text-[var(--ui-text)] focus:border-[var(--ui-accent)] focus:outline-none"
          >
            <option value="">{speakersLoading ? '読み込み中...' : '選択してください'}</option>
            {speakers.map((s) => (
              <option key={`${s.uuid}-${s.id}`} value={s.id}>
                {s.characterName}（{s.name}）
              </option>
            ))}
          </select>
        </div>
        {speakersError ? (
          <div className="mt-1 text-[11px] text-red-600">話者一覧の取得に失敗: {speakersError}</div>
        ) : null}
      </div>

      <label className="flex items-center gap-2 text-xs text-[var(--ui-text)] md:col-span-2">
        <input type="checkbox" checked={isDefault} onChange={(e) => onDefaultChange(e.target.checked)} />
        デフォルトのVRMに設定
      </label>

      <label className="flex items-center gap-2 text-xs text-[var(--ui-text)] md:col-span-2">
        <input type="checkbox" checked={isPublic} onChange={(e) => onPublicChange(e.target.checked)} />
        公開して他のユーザーも使えるようにする
      </label>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ui-text-secondary)] md:col-span-2">
        <div className="truncate">
          {vrmFileName ? (
            <>
              <span className="font-semibold text-[var(--ui-text)]">{vrmFileName}</span>
              <span className="ml-2">{formatBytes(vrmSize)}</span>
            </>
          ) : (
            'VRM ファイル未選択'
          )}
        </div>
        <button
          type="button"
          onClick={openFilePicker}
          className="rounded-md border border-[var(--ui-border)] bg-[var(--ui-button-bg)] px-2 py-1 text-xs text-[var(--ui-text)] hover:border-[var(--ui-accent)]"
        >
          {isEdit ? 'モデルを変更' : 'ファイルを選択'}
        </button>
      </div>
    </div>
  )
}
