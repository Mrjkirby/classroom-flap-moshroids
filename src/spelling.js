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

// Temporary local provider.
//
// Each player receives an independently shuffled copy of the complete word list.
// Every word is used exactly once before that player's list is reshuffled.
//
// Replace this adapter with LLPSpellingProvider later. LLP will own ranking,
// mastery, assignments and permanent spelling progress.

function shuffleWords(words) {
  const shuffled = [...words];

  // Fisher-Yates shuffle.
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

export class LocalSpellingProvider {
  constructor() {
    this.players = new Map();
  }

  createCycle(previousLastWord = null) {
    let words = shuffleWords(TEMPORARY_WORDS);

    // Avoid starting a new cycle with the same word that ended the last one.
    if (previousLastWord && words.length > 1 && words[0] === previousLastWord) {
      const swapIndex = 1 + Math.floor(Math.random() * (words.length - 1));
      [words[0], words[swapIndex]] = [words[swapIndex], words[0]];
    }

    return words;
  }

  getPlayerState(playerId) {
    let state = this.players.get(playerId);

    if (!state) {
      state = {
        words: this.createCycle(),
        index: 0,
        cycleId: 0,
        lastWord: null
      };

      this.players.set(playerId, state);
    }

    return state;
  }

  getNextWord({ playerId, studentId = null }) {
    const state = this.getPlayerState(playerId);

    // Player completed the entire shuffled deck.
    // Build a fresh randomized cycle.
    if (state.index >= state.words.length) {
      state.words = this.createCycle(state.lastWord);
      state.index = 0;
      state.cycleId += 1;
    }

    const rank = state.index;
    const word = state.words[state.index];

    state.lastWord = word;
    state.index += 1;

    return {
      wordId: `local-${word}`,
      word,
      assignmentId: 'local-prototype',
      rank,
      cycleId: state.cycleId,
      studentId
    };
  }

  submitResult({
    studentId = null,
    wordId,
    retrievalAttempts,
    correct,
    destructionReason
  }) {
    const result = {
      studentId,
      wordId,
      retrievalAttempts,
      correct,
      destructionReason,
      recordedAt: Date.now()
    };

    console.info('[spelling-result]', result);
    return result;
  }
}

export const localSpellingProvider = new LocalSpellingProvider();

export function getNextSpellingWord({ playerId, studentId = null }) {
  return localSpellingProvider.getNextWord({ playerId, studentId });
}

export function submitSpellingAttempt({ word, attempt }) {
  const normalized = attempt.trim().toLowerCase();

  return {
    attempt: normalized,
    correct: word.toLowerCase() === normalized
  };
}

export function completeSpellingChallenge({
  studentId,
  wordId,
  retrievalAttempts,
  correct,
  destructionReason
}) {
  return localSpellingProvider.submitResult({
    studentId,
    wordId,
    retrievalAttempts,
    correct,
    destructionReason
  });
}
