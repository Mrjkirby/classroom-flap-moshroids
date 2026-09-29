const TEMPORARY_WORDS = [
  'absence', 'acceptable', 'accessible', 'accidentally', 'accommodate', 'accomplish', 'accumulate', 'achievement',
  'acknowledge', 'acquire', 'acquisition', 'address', 'adequate', 'adolescent', 'advantageous', 'aggressive',
  'allegiance', 'allotment', 'already', 'amateur', 'among', 'analyze', 'annihilate', 'anonymous',
  'anxious', 'apparent', 'appearance', 'appreciation', 'appropriate', 'argument', 'arithmetic', 'ascend',
  'assessment', 'association', 'atmosphere', 'attendance', 'auxiliary', 'balance', 'beautiful', 'becoming',
  'beginning', 'behavior', 'believe', 'benefit', 'benefited', 'boundary', 'bureau', 'business',
  'calendar', 'campaign', 'candidate', 'category', 'cemetery', 'challenge', 'changeable', 'character',
  'characteristic', 'column', 'committee', 'comparative', 'compatible', 'compelled', 'competition', 'concede',
  'conceivable', 'conceive', 'condemn', 'conscience', 'conscientious', 'conscious', 'consensus', 'consistent',
  'continuous', 'controversy', 'convenience', 'convenient', 'courageous', 'curiosity', 'cylinder', 'deceive',
  'decision', 'defendant', 'definite', 'definitely', 'definition', 'dependent', 'descendant', 'describe',
  'description', 'desperate', 'development', 'difference', 'dilemma', 'disappear', 'disappoint', 'disastrous',
  'discipline', 'discrimination', 'discussion', 'disease', 'dissatisfied', 'dominant', 'drunkenness', 'dumbbell',
  'easily', 'ecstasy', 'efficiency', 'eighth', 'eligible', 'embarrass', 'emergency', 'encouragement',
  'energy', 'enthusiastic', 'environment', 'equipment', 'equipped', 'exaggerate', 'exceed', 'excellence',
  'excellent', 'exercise', 'exhaust', 'exhaustion', 'existence', 'exorbitant', 'experience', 'experiment',
  'explanation', 'extension', 'extraordinary', 'extreme', 'fahrenheit', 'fallacy', 'familiar', 'fascinate',
  'favorite', 'february', 'fierce', 'fiery', 'financial', 'foreign', 'forfeit', 'forty',
  'fourth', 'frequently', 'friend', 'fundamental', 'gauge', 'generosity', 'government', 'grammar',
  'guarantee', 'guidance', 'harass', 'height', 'hierarchy', 'hygiene', 'hypocrisy', 'ignorance',
  'illogical', 'immediate', 'immediately', 'immigrant', 'independence', 'independent', 'indispensable', 'inevitable',
  'ingenious', 'intellectual', 'intelligence', 'intelligent', 'interference', 'interrupt', 'irrelevant', 'irresistible',
  'knowledge', 'laboratory', 'leisure', 'length', 'license', 'lieutenant', 'lightning', 'likable',
  'loneliness', 'maintenance', 'maneuver', 'marriage', 'mathematics', 'miniature', 'mischievous', 'misspell',
  'mortgage', 'necessary', 'neighbor', 'neither', 'noticeable', 'nuisance', 'obedient', 'obstacle',
  'occasion', 'occasionally', 'occurred', 'occurrence', 'omission', 'opinion', 'opportunity', 'optimism',
  'parallel', 'paralyze', 'particular', 'pastime', 'perceive', 'permanent', 'perseverance', 'persistence',
  'personnel', 'perspective', 'physical', 'piece', 'plausible', 'possession', 'possible', 'practical',
  'preceding', 'preference', 'prejudice', 'preparation', 'privilege', 'procedure', 'proceed', 'prominent',
  'pronunciation', 'psychology', 'publicly', 'pursue', 'questionnaire', 'receive', 'recommend', 'reference',
  'relevant', 'religious', 'remembrance', 'repetition', 'resistance', 'rhythm', 'ridiculous', 'sacrilegious',
  'schedule', 'separate'
];

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
