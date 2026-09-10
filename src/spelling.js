const TEMPORARY_WORDS = ['because', 'different', 'necessary', 'separate', 'environment'];

// Replace this adapter with LLPSpellingProvider later. The LLP owns ranking:
// hardest/lowest mastery first through easiest/highest mastery last. Each current
// ranking is consumed once, then the next cycle requests a fresh ranking.
export class LocalSpellingProvider {
  constructor() { this.cycles = new Map(); }
  getNextWord({ playerId, studentId = null }) {
    const index = this.cycles.get(playerId) || 0;
    this.cycles.set(playerId, (index + 1) % TEMPORARY_WORDS.length);
    return { wordId: `local-${TEMPORARY_WORDS[index]}`, word: TEMPORARY_WORDS[index], assignmentId: 'local-prototype', rank: index, cycleId: Math.floor(index / TEMPORARY_WORDS.length), studentId };
  }
  submitResult({ studentId = null, wordId, retrievalAttempts, correct, destructionReason }) {
    const result = { studentId, wordId, retrievalAttempts, correct, destructionReason, recordedAt: Date.now() };
    console.info('[spelling-result]', result);
    return result;
  }
}

export const localSpellingProvider = new LocalSpellingProvider();
export function getNextSpellingWord({ playerId, studentId = null }) { return localSpellingProvider.getNextWord({ playerId, studentId }); }
export function submitSpellingAttempt({ word, attempt }) { const normalized = attempt.trim().toLowerCase(); return { attempt: normalized, correct: word.toLowerCase() === normalized }; }
export function completeSpellingChallenge({ studentId, wordId, retrievalAttempts, correct, destructionReason }) { return localSpellingProvider.submitResult({ studentId, wordId, retrievalAttempts, correct, destructionReason }); }
