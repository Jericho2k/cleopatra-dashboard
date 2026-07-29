'use client'

import React, { useEffect, useRef } from 'react'

type ConfirmDialogProps = {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  eyebrow?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  eyebrow = 'AI ANALYSIS',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onCancel()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'rgba(3, 3, 5, 0.78)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        style={{
          width: 'min(480px, 100%)',
          padding: 24,
          borderRadius: 14,
          border: '1px solid rgba(155, 143, 212, 0.32)',
          background: 'linear-gradient(145deg, rgba(28,27,34,0.99), rgba(16,16,20,0.99))',
          boxShadow: '0 28px 90px rgba(0,0,0,0.58), inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <div style={{
          marginBottom: 12,
          color: 'var(--purple)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.16em',
        }}>
          {eyebrow}
        </div>
        <div
          id="confirm-dialog-title"
          style={{ color: 'var(--text-primary)', fontSize: 19, fontWeight: 650, lineHeight: 1.25 }}
        >
          {title}
        </div>
        <div
          id="confirm-dialog-description"
          style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}
        >
          {description}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, marginTop: 24 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '9px 15px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{
              padding: '9px 16px',
              borderRadius: 8,
              border: '1px solid rgba(155, 143, 212, 0.65)',
              background: 'linear-gradient(135deg, rgba(155,143,212,0.28), rgba(155,143,212,0.13))',
              color: '#d7d0ff',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
