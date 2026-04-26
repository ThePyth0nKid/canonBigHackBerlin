'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Two-step confirm with a short cooldown — used by every "Sign as canonical"
 * and "Sign as distinct" affordance.
 *
 * Truth-making clicks are permanent on the audit chain: the only way to undo
 * one is a separate, signed reverse event. So we trade a deliberate ~1.5s
 * pause for the right to skip the modal-in-modal pattern. The cooldown also
 * defends against double-click reflex on the same button position.
 */
export interface ConfirmStep {
  confirmingId: string | null;
  ready: boolean;
  arm(id: string): void;
  cancel(): void;
  isArmed(id: string): boolean;
  isReady(id: string): boolean;
}

export function useConfirmStep(cooldownMs = 1500): ConfirmStep {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function arm(id: string) {
    if (timer.current) clearTimeout(timer.current);
    setConfirmingId(id);
    setReady(false);
    timer.current = setTimeout(() => setReady(true), cooldownMs);
  }
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    setConfirmingId(null);
    setReady(false);
  }

  return {
    confirmingId,
    ready,
    arm,
    cancel,
    isArmed: (id) => confirmingId === id,
    isReady: (id) => confirmingId === id && ready,
  };
}
