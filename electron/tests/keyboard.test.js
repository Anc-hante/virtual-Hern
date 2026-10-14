'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const logic = require('../../src/HernandesCheckout/Resources/keyboard_logic.js');

class FakeInput {
  constructor(value = '', type = 'text') {
    this.tagName = 'INPUT';
    this.type = type;
    this.inputMode = '';
    this.disabled = false;
    this.readOnly = false;
    this.maxLength = -1;
    this._value = value;
    this.events = [];
    this.selectionStart = value.length;
    this.selectionEnd = value.length;
  }
  get value() { return this._value; }
  set value(next) { this._value = String(next); }
  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }
}

test('uses exactly one input event and no premature change event for each key', () => {
  const input = new FakeInput('ABC');
  input.setSelectionRange(1, 1);
  assert.equal(logic.insert(input, 'text', 'x'), true);
  assert.equal(input.value, 'AxBC');
  assert.equal(input.selectionStart, 2);
  assert.deepEqual(input.events, ['input']);
});

test('replaces selected text and backspace respects caret position', () => {
  const input = new FakeInput('1234567');
  input.setSelectionRange(2, 5);
  logic.insert(input, 'text', 'A');
  assert.equal(input.value, '12A67');
  input.setSelectionRange(3, 3);
  logic.insert(input, 'backspace');
  assert.equal(input.value, '1267');
  assert.equal(input.selectionStart, 2);
  assert.deepEqual(input.events, ['input', 'input']);
});

test('does not type in disabled controls or beyond maxLength', () => {
  const input = new FakeInput('123');
  input.maxLength = 3;
  logic.insert(input, 'text', '4');
  assert.equal(input.value, '123');
  assert.deepEqual(input.events, []);
  input.disabled = true;
  assert.equal(logic.insert(input, 'text', '5'), false);
});

test('numeric, text and email inputs choose correct keyboard layout', () => {
  const phone = new FakeInput('', 'tel');
  const email = new FakeInput('', 'email');
  const plain = new FakeInput('', 'password');
  assert.equal(logic.keyboardKind(phone), 'numeric');
  assert.equal(logic.keyboardKind(email), 'email');
  assert.equal(logic.keyboardKind(plain), 'text');
});

test('OK submits the admin form once, not once per synthetic event', () => {
  const input = new FakeInput('');
  let submissions = 0;
  input.form = { requestSubmit() { submissions += 1; } };
  logic.sendEnter(input);
  assert.equal(submissions, 1);
});

test('Electron loads keyboard logic instead of both legacy and new controllers', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const list = main.slice(main.indexOf('const scripts = ['),main.indexOf('].map(name'));
  assert.match(list, /keyboard_logic\.js/);
  assert.doesNotMatch(list, /'keyboard_bridge\.js'/);
});

test('touch keyboard reopens on focused inputs and handles pointer presses once', () => {
  const ui = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'HernandesCheckout', 'Resources', 'keyboard_ui.js'),
    'utf8'
  );
  assert.match(ui, /document\.addEventListener\('pointerdown'/);
  assert.match(ui, /const field = editableFromEvent\(event\)/);
  assert.match(ui, /if \(field\)\s*\{\s*show\(field\);/);
  assert.match(ui, /shadow\.addEventListener\('pointerdown'/);
  assert.match(ui, /event\.preventDefault\(\)/);
  assert.match(ui, /event\.detail !== 0/);
  assert.doesNotMatch(ui, /rows'\)\.addEventListener\('click'/);
});

test('customer identification modal moves above on-screen keyboard', () => {
  const ui = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'HernandesCheckout', 'Resources', 'keyboard_ui.js'),
    'utf8'
  );
  assert.match(ui, /gate\.style\.placeItems = 'start center'/);
  assert.match(ui, /gate\.style\.paddingBottom = '290px'/);
  assert.match(ui, /gate\.style\.placeItems = gateOriginalStyles\.placeItems/);
});
