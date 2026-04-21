'use client'

import React, { useState, useEffect } from 'react'
import type { Fan, ConversationSummary, FanList } from '../types'

export interface SidebarProps {
  conversations: ConversationSummary[]
  activeFanId: string | null
  onSelectFan: (fan: Fan) => void
  creators: {id: string, name: string}[]
  activeCreatorId: string
  onCreatorChange: (id: string) => void
  fanLists: FanList[]
  activeListId: string | null
  onSelectList: (id: string | null) => void
  onCreateList: (name: string, color: string, excludeFromAuto: boolean) => void
  onUpdateList: (listId: string, name: string, color: string, excludeFromAuto: boolean) => void
  onDeleteList: (listId: string) => void
  onAddFanToList: (fanId: string, listId: string) => void
  onRemoveFanFromList: (fanId: string, listId: string) => void
  globalAutoMode: boolean
  onToggleAutoMode: () => void
  syncingChats: boolean
  onSyncChats: () => void
  onMarkAllRead: () => void
}

const LIST_COLORS = ['#9b8fd4', '#4caf82', '#ff6b6b', '#f0a500', '#4fc3f7', '#f48fb1', '#aaa', '#fff']

type FilterId = 'all' | 'unread' | 'whale' | 'active' | 'casual' | 'cold' | 'auto_on' | 'auto_off'
const FILTER_OPTIONS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'all' },
  { id: 'unread', label: 'unread' },
  { id: 'whale', label: 'whale' },
  { id: 'active', label: 'active' },
  { id: 'casual', label: 'casual' },
  { id: 'cold', label: 'cold' },
  { id: 'auto_on', label: 'Auto On' },
  { id: 'auto_off', label: 'Auto Off' },
]

type ListModal = {
  mode: 'create' | 'edit'
  listId?: string
  name: string
  color: string
  excludeFromAuto: boolean
}

export default function Sidebar({
  conversations, activeFanId, onSelectFan,
  creators, activeCreatorId, onCreatorChange,
  fanLists, activeListId, onSelectList,
  onCreateList, onUpdateList, onDeleteList,
  onAddFanToList, onRemoveFanFromList,
  globalAutoMode,
  onToggleAutoMode,
  syncingChats,
  onSyncChats,
  onMarkAllRead,
}: SidebarProps) {
  const [now, setNow] = useState(Date.now())
  const [activeFilter, setActiveFilter] = useState<FilterId>('all')
  const [listModal, setListModal] = useState<ListModal | null>(null)
  const [showListsPanel, setShowListsPanel] = useState(false)
  const [hoveredFanId, setHoveredFanId] = useState<string | null>(null)
  const [listDropdownFanId, setListDropdownFanId] = useState<string | null>(null)

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!listDropdownFanId) return
    const handler = () => setListDropdownFanId(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [listDropdownFanId])

  return (
    <>
      <style>{`
        @keyframes sidebar-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* List modal */}
      {listModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setListModal(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 24, width: 300,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>
              {listModal.mode === 'create' ? 'New List' : 'Edit List'}
            </div>

            <input
              value={listModal.name}
              onChange={e => setListModal(prev => prev ? { ...prev, name: e.target.value } : null)}
              placeholder="List name"
              autoFocus
              style={{
                width: '100%', background: 'var(--bg-surface)',
                border: '1px solid var(--border)', borderRadius: 8,
                padding: '8px 12px', color: 'var(--text-primary)',
                fontSize: 13, marginBottom: 16, boxSizing: 'border-box',
                outline: 'none',
              }}
            />

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>COLOR</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {LIST_COLORS.map(color => (
                  <div
                    key={color}
                    onClick={() => setListModal(prev => prev ? { ...prev, color } : null)}
                    style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: color, cursor: 'pointer',
                      border: listModal.color === color ? '2px solid white' : '2px solid transparent',
                      flexShrink: 0,
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 20, padding: '10px 12px',
              background: 'var(--bg-surface)', borderRadius: 8,
            }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>Exclude from Auto Mode</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>AI won't auto-reply to fans in this list</div>
              </div>
              <div
                onClick={() => setListModal(prev => prev ? { ...prev, excludeFromAuto: !prev.excludeFromAuto } : null)}
                style={{
                  width: 36, height: 20, borderRadius: 999, cursor: 'pointer',
                  background: listModal.excludeFromAuto ? 'var(--green)' : 'var(--bg-hover)',
                  border: '1px solid var(--border)', position: 'relative', transition: 'background 0.2s',
                  flexShrink: 0,
                }}
              >
                <div style={{
                  position: 'absolute', top: 2,
                  left: listModal.excludeFromAuto ? 18 : 2,
                  width: 14, height: 14, borderRadius: '50%',
                  background: 'white', transition: 'left 0.2s',
                }} />
              </div>
            </div>

            {listModal.mode === 'edit' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>FANS IN THIS LIST</div>
                <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                  {conversations.map(conv => {
                    const list = fanLists.find(l => l.id === listModal?.listId)
                    const isMember = list?.member_fan_ids.includes(conv.fan.id) ?? false
                    return (
                      <div
                        key={conv.fan.id}
                        onClick={() => isMember
                          ? onRemoveFanFromList(conv.fan.id, listModal!.listId!)
                          : onAddFanToList(conv.fan.id, listModal!.listId!)
                        }
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '8px 12px', cursor: 'pointer',
                          borderBottom: '1px solid var(--border-subtle)',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                          border: `2px solid ${isMember ? (list?.color ?? 'var(--border)') : 'var(--border)'}`,
                          background: isMember ? (list?.color ?? 'transparent') : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {isMember && <span style={{ fontSize: 9, color: '#000', fontWeight: 700 }}>✓</span>}
                        </div>
                        <span style={{ fontSize: 12, flex: 1, color: 'var(--text-primary)' }}>{conv.fan.display_name}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>${conv.fan.total_spent}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {listModal.mode === 'edit' && (
                <button
                  type="button"
                  onClick={() => { onDeleteList(listModal.listId!); setListModal(null) }}
                  style={{
                    padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                    background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)',
                    color: '#ff6b6b', fontSize: 12,
                  }}
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => setListModal(null)}
                style={{
                  flex: 1, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', fontSize: 12,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!listModal.name.trim()) return
                  if (listModal.mode === 'create') {
                    onCreateList(listModal.name, listModal.color, listModal.excludeFromAuto)
                  } else {
                    onUpdateList(listModal.listId!, listModal.name, listModal.color, listModal.excludeFromAuto)
                  }
                  setListModal(null)
                }}
                style={{
                  flex: 1, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                  background: 'var(--silver)', border: 'none',
                  color: '#000', fontSize: 12, fontWeight: 600,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <aside
        style={{
          height: '100vh',
          width: '100%',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {creators.length > 1 && (
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}>
            <div style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              marginBottom: 6,
            }}>
              Creator
            </div>
            <select
              value={activeCreatorId}
              onChange={(e) => onCreatorChange(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                padding: '6px 10px',
                color: 'var(--text-primary)',
                fontSize: 13,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {creators.map((c) => (
                <option key={c.id} value={c.id} style={{ background: 'var(--bg-elevated)' }}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div
          style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: 8,
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: '0.02em',
                color: 'var(--silver)',
              }}
            >
              INBOX
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={onSyncChats}
                disabled={syncingChats}
                style={{
                  fontSize: 11, padding: '3px 8px', borderRadius: 4,
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', cursor: 'pointer',
                  opacity: syncingChats ? 0.5 : 1,
                }}
              >
                {syncingChats ? 'Syncing...' : '↻ Sync'}
              </button>
              <button
                type="button"
                onClick={onMarkAllRead}
                style={{
                  fontSize: 11, padding: '3px 8px', borderRadius: 4,
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', cursor: 'pointer',
                }}
              >
                ✓ Mark all read
              </button>
            </div>
            <button
              type="button"
              onClick={onToggleAutoMode}
              style={{
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 4,
                cursor: 'pointer',
                background: globalAutoMode ? 'rgba(76,175,130,0.15)' : 'transparent',
                color: globalAutoMode ? 'var(--green)' : 'var(--text-muted)',
                border: globalAutoMode ? '1px solid rgba(76,175,130,0.4)' : '1px solid var(--border)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {globalAutoMode ? '● Auto' : 'Auto'}
            </button>
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginTop: 2,
            }}
          >
            {conversations.length} conversation{conversations.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Lists bar */}
        <div style={{ padding: '8px 12px 0', display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => onSelectList(null)}
            style={{
              fontSize: 10, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
              background: activeListId === null ? 'var(--silver)' : 'transparent',
              color: activeListId === null ? '#000' : 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            All
          </button>
          {fanLists.map(list => (
            <button
              key={list.id}
              type="button"
              onClick={() => onSelectList(activeListId === list.id ? null : list.id)}
              style={{
                fontSize: 10, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
                background: activeListId === list.id ? list.color : 'transparent',
                color: activeListId === list.id ? '#000' : 'var(--text-muted)',
                border: `1px solid ${list.color}`,
              }}
            >
              {list.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowListsPanel(true)}
            style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-muted)',
            }}
          >
            Edit Lists
          </button>
        </div>

        {/* Manage Lists panel */}
        {showListsPanel && (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 200,
              background: 'rgba(0,0,0,0.6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={() => setShowListsPanel(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 12, padding: 24, width: 420, maxHeight: '80vh',
                overflow: 'auto', paddingBottom: 20,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Manage Lists</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowListsPanel(false)
                      setListModal({ mode: 'create', name: '', color: '#9b8fd4', excludeFromAuto: false })
                    }}
                    style={{
                      fontSize: 11, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                      background: 'var(--bg-hover)', border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    + New List
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowListsPanel(false)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: '0 4px',
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>

              {fanLists.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
                  No lists yet. Create one above.
                </div>
              ) : fanLists.map(list => (
                <div
                  key={list.id}
                  onClick={() => {
                    setShowListsPanel(false)
                    setListModal({
                      mode: 'edit', listId: list.id,
                      name: list.name, color: list.color,
                      excludeFromAuto: list.exclude_from_auto,
                    })
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 14px', background: 'var(--bg-surface)',
                    border: '1px solid var(--border)', borderRadius: 10,
                    marginBottom: 8, cursor: 'pointer',
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: list.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{list.name}</div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {list.member_fan_ids.length} fans
                  </span>
                  {list.exclude_from_auto && (
                    <span style={{
                      fontSize: 9, padding: '2px 6px', borderRadius: 999,
                      background: 'rgba(255,80,80,0.1)', color: '#ff6b6b',
                      border: '1px solid rgba(255,80,80,0.2)',
                    }}>AUTO EXCLUDED</span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>→</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: '8px 8px 0', flexShrink: 0 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              paddingBottom: 8,
            }}
          >
            {FILTER_OPTIONS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveFilter(id)}
                style={{
                  flexShrink: 0,
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: activeFilter === id ? '1px solid var(--silver)' : '1px solid var(--border)',
                  background: activeFilter === id ? 'rgba(200,200,200,0.1)' : 'transparent',
                  color: activeFilter === id ? 'var(--silver)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <ul
          style={{
            flex: 1,
            overflow: 'auto',
            listStyle: 'none',
            padding: '0 8px 16px',
          }}
        >
          {(() => {
            const filtered = conversations.filter((c) => {
              if (activeListId && !fanLists.find(l => l.id === activeListId)?.member_fan_ids.includes(c.fan.id)) return false
              if (activeFilter === 'unread') return c.unread
              if (activeFilter === 'all') return true
              if (activeFilter === 'auto_on') {
                return c.fan.auto_mode === true
                  || (globalAutoMode && c.fan.auto_mode !== false)
              }
              if (activeFilter === 'auto_off') return c.fan.auto_mode === false
              return c.fan.spend_tier === activeFilter
            })
            const formatTime = (d: Date) => {
              const diff = now - d.getTime()
              const m = 60 * 1000
              const h = 60 * m
              const dMs = 24 * h
              if (diff >= 7 * dMs) return d.toLocaleDateString()
              if (diff >= dMs) return `${Math.floor(diff / dMs)}d`
              if (diff >= h) return `${Math.floor(diff / h)}h`
              if (diff >= m) return `${Math.floor(diff / m)}m`
              return 'now'
            }
            return filtered.map((c) => {
            const isActive = c.fan.id === activeFanId
            const preview = c.last_message.length > 40 ? c.last_message.slice(0, 40) + '…' : c.last_message
            const msgTime = new Date(c.last_message_time)
            const isValid = msgTime.getFullYear() > 2000
            const timeDisplay = isValid ? formatTime(msgTime) : ''
            const tier = c.fan.spend_tier
            const tierStyles: React.CSSProperties =
              tier === 'whale'
                ? { border: '1px solid var(--silver)', color: 'var(--silver)' }
                : tier === 'active'
                  ? { border: '1px solid var(--green)', color: 'var(--green)' }
                  : tier === 'casual'
                    ? { border: '1px solid var(--purple)', color: 'var(--purple)' }
                    : { border: '1px solid var(--text-faint)', color: 'var(--text-faint)' }
            const showAutoIndicator = c.fan.auto_mode === true
              || (globalAutoMode && c.fan.auto_mode !== false)
            const showOffIndicator = c.fan.auto_mode === false
            return (
              <li key={c.fan.id} style={{ position: 'relative' }}>
                <div
                  style={{ position: 'relative' }}
                  onMouseEnter={() => setHoveredFanId(c.fan.id)}
                  onMouseLeave={() => { setHoveredFanId(null) }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectFan(c.fan)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 10px',
                      marginBottom: 4,
                      background: isActive ? 'var(--bg-hover)' : 'transparent',
                      border: 'none',
                      borderLeft: isActive ? '3px solid var(--silver)' : '3px solid transparent',
                      borderRadius: 6,
                      cursor: 'pointer',
                      color: 'inherit',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {c.unread && (
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: 'var(--green)',
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                          {c.fan.display_name}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {showAutoIndicator && (
                          <span style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 999,
                            background: 'rgba(76,175,130,0.2)', color: 'var(--green)',
                            border: '1px solid rgba(76,175,130,0.4)',
                            marginLeft: 'auto', flexShrink: 0,
                          }}>AUTO</span>
                        )}
                        {showOffIndicator && (
                          <span style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 999,
                            background: 'rgba(255,80,80,0.1)', color: '#ff6b6b',
                            border: '1px solid rgba(255,80,80,0.3)',
                            marginLeft: 'auto', flexShrink: 0,
                          }}>OFF</span>
                        )}
                        <span style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--font-display)' }}>
                          ${c.fan.total_spent}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {timeDisplay}
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: c.unread ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: c.unread ? 600 : 400,
                        marginBottom: 6,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {preview}
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        padding: '2px 6px',
                        borderRadius: 4,
                        ...tierStyles,
                      }}
                    >
                      {c.fan.spend_tier}
                    </span>
                    {c.unread && (c.unread_count ?? 0) > 0 && (
                      <span style={{
                        marginLeft: 4,
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 999,
                        background: 'var(--green)',
                        color: '#000',
                        fontWeight: 700,
                        minWidth: 18,
                        textAlign: 'center',
                      }}>
                        {c.unread_count}
                      </span>
                    )}
                  </button>

                  {/* Hover "+" list button */}
                  {hoveredFanId === c.fan.id && fanLists.length > 0 && (
                    <div style={{
                      position: 'absolute', right: 8, top: '50%',
                      transform: 'translateY(-50%)',
                      display: 'flex', gap: 4,
                    }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setListDropdownFanId(listDropdownFanId === c.fan.id ? null : c.fan.id)
                        }}
                        style={{
                          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                          borderRadius: 4, padding: '2px 6px', fontSize: 10,
                          color: 'var(--text-muted)', cursor: 'pointer',
                        }}
                      >
                        + list
                      </button>
                    </div>
                  )}

                  {/* List dropdown */}
                  {listDropdownFanId === c.fan.id && (
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{
                        position: 'absolute', right: 8, top: '100%', zIndex: 50,
                        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                        borderRadius: 8, padding: 4, minWidth: 140,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                      }}
                    >
                      {fanLists.map(list => {
                        const isMember = list.member_fan_ids.includes(c.fan.id)
                        return (
                          <button
                            key={list.id}
                            type="button"
                            onClick={() => {
                              isMember ? onRemoveFanFromList(c.fan.id, list.id) : onAddFanToList(c.fan.id, list.id)
                              setListDropdownFanId(null)
                            }}
                            style={{
                              width: '100%', textAlign: 'left', padding: '6px 10px',
                              background: 'transparent', border: 'none', borderRadius: 6,
                              color: isMember ? list.color : 'var(--text-primary)',
                              fontSize: 12, cursor: 'pointer', display: 'flex',
                              alignItems: 'center', gap: 6,
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <span style={{
                              width: 8, height: 8, borderRadius: '50%',
                              background: list.color, flexShrink: 0,
                            }} />
                            {list.name}
                            {isMember && <span style={{ marginLeft: 'auto', fontSize: 10 }}>✓</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </li>
            )
            })
          })()}
        </ul>
      </aside>
    </>
  )
}
