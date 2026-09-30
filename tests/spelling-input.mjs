import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SpellingChallengeController } from '../src/spellingController.js';

class Element {
  constructor() { this.listeners = new Map(); this.classList = { add() {}, remove() {}, toggle() {} }; this.value = ''; this.textContent = ''; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type, properties = {}) {
    const event = { ...properties, prevented: false, preventDefault() { this.prevented = true; } };
    this.listeners.get(type)?.(event);
    return event.prevented;
  }
  setAttribute() {}
  focus() {}
}

const names = ['title', 'phase', 'word', 'input', 'feedback', 'ready', 'test', 'check', 'form'];
function setup() {
  const parts = Object.fromEntries(names.map(name => [name, new Element()]));
  const overlay = new Element();
  overlay.querySelector = selector => parts[selector.match(/data-wormhole-(\w+)/)[1]];
  const controller = new SpellingChallengeController({ overlay, onComplete() {} });
  return { controller, ...parts };
}

test('word display blocks selection and clipboard actions only on that element', () => {
  const { word, input } = setup();
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.wormhole-word\s*\{[^}]*user-select:\s*none/s);
  for (const type of ['selectstart', 'copy', 'cut', 'contextmenu']) assert.equal(word.dispatch(type), true);
  assert.equal(input.dispatch('copy'), false);
});

test('answer blocks clipboard and drop insertion while allowing typing and editing', () => {
  const { input } = setup();
  for (const type of ['paste', 'cut', 'drop']) assert.equal(input.dispatch(type), true);
  for (const inputType of ['insertFromPaste', 'insertFromDrop', 'deleteByCut']) {
    assert.equal(input.dispatch('beforeinput', { inputType }), true);
  }
  for (const inputType of ['insertText', 'deleteContentBackward', 'deleteContentForward']) {
    assert.equal(input.dispatch('beforeinput', { inputType }), false);
  }
  for (const modifier of ['metaKey', 'ctrlKey']) assert.equal(input.dispatch('keydown', { key: 'v', [modifier]: true }), true);
  for (const key of ['a', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight']) {
    assert.equal(input.dispatch('keydown', { key }), false);
  }
});

test('manually typed correct answer completes; incorrect answer returns to learning', () => {
  const { controller, input, test: testButton } = setup();
  controller.begin({ playerId: 'student', reason: 'test' });
  const challenge = controller.challenges.get('student');
  controller.beginPractice();
  input.value = challenge.word;
  input.dispatch('input');
  assert.equal(testButton.disabled, false);
  controller.beginRetrieval();
  input.value = 'wrong';
  controller.submitRetrieval();
  assert.equal(challenge.phase, 'learn');
  assert.equal(challenge.retrievalAttempts, 1);
  controller.beginPractice();
  input.value = challenge.word;
  input.dispatch('input');
  controller.beginRetrieval();
  input.value = challenge.word;
  controller.submitRetrieval();
  assert.equal(challenge.phase, 'complete');
  assert.equal(challenge.retrievalAttempts, 2);
});
