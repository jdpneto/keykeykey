import React, { createContext, useContext, useState, useCallback } from 'react';
import { useTheme } from '../../lib/theme';

type ToastContextType = {
  show: (message: string) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);

  const show = useCallback((message: string) => {
    setToast({ message, key: Date.now() });
    setTimeout(() => setToast(null), 2000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div
          key={toast.key}
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: theme.colors.text,
            color: theme.colors.background,
            padding: '8px 20px',
            borderRadius: theme.radii.md,
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.medium,
            zIndex: 9999,
            animation: 'toastIn 0.2s ease',
            pointerEvents: 'none',
          }}
        >
          {toast.message}
          <style>{`@keyframes toastIn { from { opacity: 0; transform: translateX(-50%) translateY(8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }`}</style>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
