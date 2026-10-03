export interface EnsembleState {
  scoreId?: string;
  rehearsalId?: string;
  isRehearsing: boolean;
  page: number;
  position?: Record<string, any>;
}
export const ensembleStates = new Map<string, EnsembleState>();
let publisher: ((ensembleId: string, event: string, data: unknown) => void) | undefined;
export function setEnsemblePublisher(value: typeof publisher) { publisher = value; }
export function publishEnsemble(ensembleId: string, event: string, data: unknown) { publisher?.(ensembleId, event, data); }
export function getEnsembleState(ensembleId: string): EnsembleState {
  const existing = ensembleStates.get(ensembleId);
  if (existing) return existing;
  const state = { isRehearsing: false, page: 1 };
  ensembleStates.set(ensembleId, state);
  return state;
}
