import { cn } from 'cn'
import { Button } from '@/components/ui/button'

function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Delete',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <div
      data-testid="confirm-dialog"
      className={cn(
        'fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 animate-fade-in',
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className={cn('w-full sm:max-w-sm mx-0 sm:mx-4 rounded-t-xl sm:rounded-xl bg-white shadow-lg p-5 animate-slide-up')}>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{message}</p>
        <div className="mt-4 flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog