import React, { useState } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import { CopyButton } from '../components/CopyButton.js';
import { TotpCodeDisplay } from '../components/TotpCodeDisplay.js';
import type { VaultItem } from '@keykeykey/core';
import { rebuildAfterRestore } from '@keykeykey/core/store';

interface CredentialDetailScreenProps {
  item: VaultItem;
  onNavigate: (s: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  onRefreshItems?: () => Promise<void>;
}

export function CredentialDetailScreen({
  item,
  onNavigate,
  onBack,
  onRefresh,
  onRefreshItems,
}: CredentialDetailScreenProps) {
  const { theme } = useTheme();
  const [showPassword, setShowPassword] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyRevealed, setHistoryRevealed] = useState<Set<number>>(new Set());
  const [restoringIndex, setRestoringIndex] = useState<number | null>(null);
  const [justRestoredIndex, setJustRestoredIndex] = useState<number | null>(null);

  const labelStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textSecondary,
    fontWeight: theme.typography.weights.medium,
    marginBottom: 2,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  };

  const valueStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text,
    wordBreak: 'break-all' as const,
  };

  const fieldRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing.sm,
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: theme.spacing.md,
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    background: theme.colors.surface,
    borderRadius: theme.radii.md,
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await sendMessage({ type: 'DELETE_ITEM', id: item.id });
      onRefresh();
      onBack();
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const toggleHistoryReveal = (index: number) => {
    setHistoryRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleClearHistory = async () => {
    if (!window.confirm('Clear all password history? This cannot be undone.')) return;
    await sendMessage({ type: 'UPDATE_ITEM', id: item.id, updates: { passwordHistory: [] } });
    setShowHistory(false);
    setHistoryRevealed(new Set());
    onRefresh();
    await onRefreshItems?.();
  };

  const handleRestore = async (originalIndex: number) => {
    if (item.type !== 'credential') return;
    if (restoringIndex !== null) return; // in-flight guard
    const history = item.passwordHistory ?? [];
    const result = rebuildAfterRestore(
      item.password,
      history,
      originalIndex,
      new Date().toISOString(),
    );
    if (result === null) return;
    setRestoringIndex(originalIndex);
    try {
      await sendMessage({
        type: 'UPDATE_ITEM',
        id: item.id,
        updates: { password: result.password, passwordHistory: result.passwordHistory },
      });
      setHistoryRevealed(new Set());
      setJustRestoredIndex(originalIndex);
      setTimeout(() => setJustRestoredIndex(null), 1500);
      onRefresh();
      await onRefreshItems?.();
    } finally {
      setRestoringIndex(null);
    }
  };

  const renderPasswordHistory = () => {
    if (item.type !== 'credential') return null;
    const history = item.passwordHistory;
    if (!history || history.length === 0) return null;

    return (
      <div style={sectionStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: showHistory ? theme.spacing.sm : 0,
          }}
        >
          <div style={labelStyle}>Password History ({history.length})</div>
          <button
            onClick={() => {
              setShowHistory(!showHistory);
              if (showHistory) setHistoryRevealed(new Set());
            }}
            style={{
              background: 'none',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.sm,
              padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
              color: theme.colors.textSecondary,
              cursor: 'pointer',
              fontSize: theme.typography.sizes.xs,
            }}
          >
            {showHistory ? 'Hide' : 'Show'}
          </button>
        </div>
        {showHistory && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing.xs }}>
            {[...history].reverse().map((entry, idx) => {
              const originalIndex = history.length - 1 - idx;
              const revealed = historyRevealed.has(originalIndex);
              const date = new Date(entry.changedAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              });
              return (
                <div
                  key={originalIndex}
                  style={{
                    borderTop: idx > 0 ? `1px solid ${theme.colors.border}` : undefined,
                    paddingTop: idx > 0 ? theme.spacing.xs : 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: theme.typography.sizes.xs,
                      color: theme.colors.textSecondary,
                      marginBottom: 2,
                    }}
                  >
                    {date}
                  </div>
                  <div style={fieldRowStyle}>
                    <div
                      style={{
                        ...valueStyle,
                        flex: 1,
                        fontFamily: 'monospace',
                        fontSize: theme.typography.sizes.xs,
                      }}
                    >
                      {revealed ? entry.password : '••••••••••••'}
                    </div>
                    <button
                      onClick={() => toggleHistoryReveal(originalIndex)}
                      style={{
                        background: 'none',
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: theme.radii.sm,
                        padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                        color: theme.colors.textSecondary,
                        cursor: 'pointer',
                        fontSize: theme.typography.sizes.xs,
                      }}
                    >
                      {revealed ? 'Hide' : 'Show'}
                    </button>
                    <CopyButton text={entry.password} label="Copy" />
                    <button
                      onClick={() => handleRestore(originalIndex)}
                      disabled={restoringIndex !== null}
                      aria-label="Restore this password"
                      title="Restore this password"
                      style={{
                        background: 'none',
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: theme.radii.sm,
                        padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                        color:
                          justRestoredIndex === originalIndex
                            ? theme.colors.success
                            : theme.colors.textSecondary,
                        cursor: restoringIndex !== null ? 'not-allowed' : 'pointer',
                        fontSize: theme.typography.sizes.xs,
                        opacity:
                          restoringIndex !== null && restoringIndex !== originalIndex ? 0.5 : 1,
                      }}
                    >
                      {justRestoredIndex === originalIndex ? 'Restored!' : 'Restore'}
                    </button>
                  </div>
                </div>
              );
            })}
            <button
              onClick={handleClearHistory}
              style={{
                background: 'none',
                border: 'none',
                color: theme.colors.danger,
                cursor: 'pointer',
                fontSize: theme.typography.sizes.xs,
                padding: `${theme.spacing.xs}px 0`,
                textAlign: 'left' as const,
              }}
            >
              Clear History
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderCredential = () => {
    if (item.type !== 'credential') return null;
    return (
      <>
        {item.url && (
          <div style={sectionStyle}>
            <div style={labelStyle}>URL</div>
            <div style={fieldRowStyle}>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...valueStyle, color: theme.colors.primary, flex: 1 }}
              >
                {item.url}
              </a>
            </div>
          </div>
        )}
        <div style={sectionStyle}>
          <div style={labelStyle}>Username</div>
          <div style={fieldRowStyle}>
            <div style={{ ...valueStyle, flex: 1 }}>{item.username}</div>
            <CopyButton text={item.username} label="Copy" />
          </div>
        </div>
        <div style={sectionStyle}>
          <div style={labelStyle}>Password</div>
          <div style={fieldRowStyle}>
            <div style={{ ...valueStyle, flex: 1, fontFamily: 'monospace' }}>
              {showPassword ? item.password : '••••••••••••'}
            </div>
            <button
              onClick={() => setShowPassword(!showPassword)}
              style={{
                background: 'none',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radii.sm,
                padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                color: theme.colors.textSecondary,
                cursor: 'pointer',
                fontSize: theme.typography.sizes.xs,
              }}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
            <CopyButton text={item.password} label="Copy" />
          </div>
        </div>
        {item.totp && (
          <div style={sectionStyle}>
            <TotpCodeDisplay input={item.totp} />
          </div>
        )}
        {item.notes && (
          <div style={sectionStyle}>
            <div style={labelStyle}>Notes</div>
            <div style={valueStyle}>{item.notes}</div>
          </div>
        )}
      </>
    );
  };

  const renderCard = () => {
    if (item.type !== 'card') return null;
    const maskedNumber = showCardNumber ? item.number : '•••• •••• •••• ' + item.number.slice(-4);
    return (
      <>
        <div style={sectionStyle}>
          <div style={labelStyle}>Cardholder Name</div>
          <div style={valueStyle}>{item.cardholderName}</div>
        </div>
        <div style={sectionStyle}>
          <div style={labelStyle}>Card Number</div>
          <div style={fieldRowStyle}>
            <div style={{ ...valueStyle, flex: 1, fontFamily: 'monospace' }}>{maskedNumber}</div>
            <button
              onClick={() => setShowCardNumber(!showCardNumber)}
              style={{
                background: 'none',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radii.sm,
                padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                color: theme.colors.textSecondary,
                cursor: 'pointer',
                fontSize: theme.typography.sizes.xs,
              }}
            >
              {showCardNumber ? 'Hide' : 'Show'}
            </button>
            <CopyButton text={item.number} label="Copy" />
          </div>
        </div>
        <div style={sectionStyle}>
          <div style={labelStyle}>Expiry</div>
          <div style={valueStyle}>
            {String(item.expirationMonth).padStart(2, '0')} / {item.expirationYear}
          </div>
        </div>
        <div style={sectionStyle}>
          <div style={labelStyle}>CVV</div>
          <div style={fieldRowStyle}>
            <div style={{ ...valueStyle, flex: 1, fontFamily: 'monospace' }}>
              {showCvv ? item.cvv : '•••'}
            </div>
            <button
              onClick={() => setShowCvv(!showCvv)}
              style={{
                background: 'none',
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radii.sm,
                padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
                color: theme.colors.textSecondary,
                cursor: 'pointer',
                fontSize: theme.typography.sizes.xs,
              }}
            >
              {showCvv ? 'Hide' : 'Show'}
            </button>
            <CopyButton text={item.cvv} label="Copy" />
          </div>
        </div>
        {item.notes && (
          <div style={sectionStyle}>
            <div style={labelStyle}>Notes</div>
            <div style={valueStyle}>{item.notes}</div>
          </div>
        )}
      </>
    );
  };

  const renderNote = () => {
    if (item.type !== 'secure-note') return null;
    return (
      <div style={sectionStyle}>
        <div style={labelStyle}>Content</div>
        <div style={{ ...valueStyle, whiteSpace: 'pre-wrap' }}>{item.content}</div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: theme.colors.textSecondary,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.md,
            padding: theme.spacing.xs,
            borderRadius: theme.radii.sm,
          }}
          aria-label="Back"
        >
          &#8592;
        </button>
        <div
          style={{
            flex: 1,
            fontWeight: theme.typography.weights.bold,
            fontSize: theme.typography.sizes.md,
            color: theme.colors.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.name}
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: theme.spacing.md,
        }}
      >
        {renderCredential()}
        {renderCard()}
        {renderNote()}
        {renderPasswordHistory()}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
          <button
            onClick={() => onNavigate(`edit:${item.id}`)}
            style={{
              flex: 1,
              padding: `${theme.spacing.sm}px`,
              background: theme.colors.primary,
              color: '#000',
              border: 'none',
              borderRadius: theme.radii.md,
              fontWeight: theme.typography.weights.semibold,
              fontSize: theme.typography.sizes.sm,
              cursor: 'pointer',
            }}
          >
            Edit
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            style={{
              flex: 1,
              padding: `${theme.spacing.sm}px`,
              background: 'none',
              color: theme.colors.danger,
              border: `1px solid ${theme.colors.danger}`,
              borderRadius: theme.radii.md,
              fontWeight: theme.typography.weights.semibold,
              fontSize: theme.typography.sizes.sm,
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Confirmation dialog */}
      {confirmDelete && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.spacing.md,
          }}
        >
          <div
            style={{
              background: theme.colors.background,
              borderRadius: theme.radii.lg,
              padding: theme.spacing.lg,
              width: '100%',
              maxWidth: 280,
            }}
          >
            <div
              style={{
                fontWeight: theme.typography.weights.bold,
                fontSize: theme.typography.sizes.md,
                marginBottom: theme.spacing.sm,
                color: theme.colors.text,
              }}
            >
              Delete Item?
            </div>
            <div
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.textSecondary,
                marginBottom: theme.spacing.md,
              }}
            >
              Are you sure you want to delete &quot;{item.name}&quot;? This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: theme.spacing.sm }}>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{
                  flex: 1,
                  padding: `${theme.spacing.sm}px`,
                  background: 'none',
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radii.md,
                  color: theme.colors.text,
                  cursor: 'pointer',
                  fontSize: theme.typography.sizes.sm,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  flex: 1,
                  padding: `${theme.spacing.sm}px`,
                  background: theme.colors.danger,
                  border: 'none',
                  borderRadius: theme.radii.md,
                  color: '#fff',
                  cursor: 'pointer',
                  fontWeight: theme.typography.weights.semibold,
                  fontSize: theme.typography.sizes.sm,
                  opacity: deleting ? 0.7 : 1,
                }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
