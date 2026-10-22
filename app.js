import { normalizeBank } from './bank-core.js';
import { LocalQuizSession } from './quiz-core.js';

const RING_CIRCUMFERENCE = 2 * Math.PI * 94;

const dom = {
  setupView: document.getElementById('setup-view'),
  quizView: document.getElementById('quiz-view'),
  resultView: document.getElementById('result-view'),

  bankStatus: document.getElementById('bank-status'),
  bankStatusText: document.getElementById('bank-status-text'),
  heroTotal: document.getElementById('hero-total'),
  heroParts: document.getElementById('hero-parts'),
  maxTotal: document.getElementById('max-total'),
  totalInput: document.getElementById('total-input'),
  totalMinus: document.getElementById('total-minus'),
  totalPlus: document.getElementById('total-plus'),
  quickTotals: document.getElementById('quick-totals'),
  partList: document.getElementById('part-list'),
  autoAllocate: document.getElementById('auto-allocate'),
  allocationTotal: document.getElementById('allocation-total'),
  bankCaption: document.getElementById('bank-caption'),
  startBtn: document.getElementById('start-btn'),
  startBtnLabel: document.getElementById('start-btn-label'),

  quitQuiz: document.getElementById('quit-quiz'),
  quizPartName: document.getElementById('quiz-part-name'),
  quizCurrent: document.getElementById('quiz-current'),
  quizTotal: document.getElementById('quiz-total'),
  quizProgress: document.getElementById('quiz-progress'),
  progressFill: document.getElementById('progress-fill'),
  questionCard: document.querySelector('.question-card'),
  typeBadge: document.getElementById('type-badge'),
  questionNumber: document.getElementById('question-number'),
  questionText: document.getElementById('question-text'),
  questionHint: document.getElementById('question-hint'),
  optionList: document.getElementById('option-list'),
  feedback: document.getElementById('feedback'),
  feedbackTitle: document.getElementById('feedback-title'),
  feedbackAnswer: document.getElementById('feedback-answer'),
  explanationWrap: document.getElementById('explanation-wrap'),
  explanationText: document.getElementById('explanation-text'),
  submitAnswer: document.getElementById('submit-answer'),
  nextQuestion: document.getElementById('next-question'),
  nextBtnLabel: document.getElementById('next-btn-label'),
  keyboardHint: document.getElementById('keyboard-hint'),

  resultTitle: document.getElementById('result-title'),
  resultSub: document.getElementById('result-sub'),
  resultCorrect: document.getElementById('result-correct'),
  resultTotal: document.getElementById('result-total'),
  resultAccuracy: document.getElementById('result-accuracy'),
  ringValue: document.getElementById('ring-value'),
  resultCorrectInline: document.getElementById('result-correct-inline'),
  resultTotalInline: document.getElementById('result-total-inline'),
  partResults: document.getElementById('part-results'),
  resultDuration: document.getElementById('result-duration'),
  restartBtn: document.getElementById('restart-btn'),
  backHome: document.getElementById('back-home'),

  exitDialog: document.getElementById('exit-dialog'),
  exitCancel: document.getElementById('exit-cancel'),
  exitConfirm: document.getElementById('exit-confirm'),
  toast: document.getElementById('toast'),
};

const state = {
  bank: null,
  bankReady: false,
  total: 0,
  allocation: new Map(),
  session: null,
  question: null,
  selected: new Set(),
  answered: false,
  finished: false,
  busy: false,
  result: null,
};

const typeLabels = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
};

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function setBankStatus(kind, text) {
  dom.bankStatus.classList.remove('is-loading', 'is-ready', 'is-error');
  if (kind) dom.bankStatus.classList.add(`is-${kind}`);
  dom.bankStatusText.textContent = text;
}

let toastTimer = null;
function showToast(message) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove('is-visible');
  }, 3800);
}

function showView(name) {
  const views = {
    setup: dom.setupView,
    quiz: dom.quizView,
    result: dom.resultView,
  };
  for (const [key, view] of Object.entries(views)) {
    if (key === name) {
      view.hidden = false;
      view.classList.remove('is-active');
      void view.offsetWidth;
      view.classList.add('is-active');
    } else {
      view.hidden = true;
      view.classList.remove('is-active');
    }
  }
  window.scrollTo(0, 0);
}

function apportionEven(total, capacities) {
  const result = capacities.map(() => 0);
  let remaining = Math.min(total, sum(capacities));
  while (remaining > 0) {
    let progressed = false;
    for (let index = 0; index < capacities.length && remaining > 0; index += 1) {
      if (result[index] < capacities[index]) {
        result[index] += 1;
        remaining -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return result;
}

function apportionProportional(total, weights, capacities) {
  const limit = Math.min(Math.max(0, total), sum(capacities));
  const weightTotal = sum(weights);
  if (!weightTotal) return apportionEven(limit, capacities);

  const exact = capacities.map((_, index) => (limit * weights[index]) / weightTotal);
  const allocation = exact.map((value, index) => Math.min(capacities[index], Math.floor(value)));
  let remaining = limit - sum(allocation);

  const order = capacities
    .map((_, index) => ({
      index,
      fraction: exact[index] - Math.floor(exact[index]),
      weight: weights[index],
    }))
    .sort((a, b) => b.fraction - a.fraction || b.weight - a.weight || a.index - b.index);

  let guard = 0;
  while (remaining > 0 && guard < 100) {
    let assigned = false;
    for (const item of order) {
      if (remaining <= 0) break;
      if (allocation[item.index] < capacities[item.index]) {
        allocation[item.index] += 1;
        remaining -= 1;
        assigned = true;
      }
    }
    if (!assigned) break;
    guard += 1;
  }

  if (remaining > 0) {
    for (let index = 0; index < capacities.length && remaining > 0; index += 1) {
      while (remaining > 0 && allocation[index] < capacities[index]) {
        allocation[index] += 1;
        remaining -= 1;
      }
    }
  }

  return allocation;
}

function getCapacities() {
  return state.bank.parts.map((part) => part.total);
}

function getAllocationArray() {
  return state.bank.parts.map((part) => state.allocation.get(part.id) || 0);
}

function setAllocationFromArray(allocation) {
  state.allocation = new Map(state.bank.parts.map((part, index) => [part.id, allocation[index] || 0]));
  state.total = sum(getAllocationArray());
}

function updateQuickTotals() {
  for (const button of dom.quickTotals.querySelectorAll('.quick-btn')) {
    button.classList.toggle('is-active', Number(button.dataset.value) === state.total);
  }
}

function updateStartButton() {
  const valid = state.bankReady &&
    !state.busy &&
    state.total > 0 &&
    sum(getAllocationArray()) === state.total;
  dom.startBtn.disabled = !valid;
  const isStarting = state.busy && !dom.setupView.hidden;
  dom.startBtn.classList.toggle('is-loading', isStarting);
  dom.startBtnLabel.textContent = isStarting ? '正在抽取题目…' : '开始答题';
}

function syncConfigUI() {
  dom.totalInput.value = String(state.total);
  for (const input of dom.partList.querySelectorAll('input[data-part-id]')) {
    input.value = String(state.allocation.get(input.dataset.partId) || 0);
  }
  dom.allocationTotal.textContent = String(sum(getAllocationArray()));
  updateQuickTotals();
  updateStartButton();
}

function setTotal(nextTotal) {
  if (!state.bankReady) return;
  const max = state.bank.stats.totalQuestions;
  const capped = clampInteger(nextTotal, 1, max);
  if (capped === state.total) {
    syncConfigUI();
    return;
  }
  const capacities = getCapacities();
  const weights = getAllocationArray();
  const allocation = sum(weights) > 0
    ? apportionProportional(capped, weights, capacities)
    : apportionEven(capped, capacities);
  setAllocationFromArray(allocation);
  syncConfigUI();
}

function adjustPart(partId, delta) {
  if (!state.bankReady) return;
  const part = state.bank.parts.find((item) => item.id === partId);
  if (!part) return;
  const current = state.allocation.get(partId) || 0;
  const next = clampInteger(current + delta, 0, part.total);
  if (next === current) return;

  const nextTotal = state.total - current + next;
  if (nextTotal < 1) {
    showToast('至少需要保留 1 道题目。');
    syncConfigUI();
    return;
  }

  state.allocation.set(partId, next);
  state.total = nextTotal;
  syncConfigUI();
}

function setPartCount(partId, value) {
  if (!state.bankReady) return;
  const part = state.bank.parts.find((item) => item.id === partId);
  if (!part) return;
  const next = clampInteger(value, 0, part.total);
  const current = state.allocation.get(partId) || 0;
  const nextTotal = state.total - current + next;
  if (nextTotal < 1) {
    showToast('至少需要保留 1 道题目。');
    syncConfigUI();
    return;
  }
  state.allocation.set(partId, next);
  state.total = nextTotal;
  syncConfigUI();
}

function renderQuickTotals() {
  dom.quickTotals.replaceChildren();
  const max = state.bank.stats.totalQuestions;
  const candidates = [10, 20, 30, 50]
    .filter((value) => value < max)
    .slice(0, 3);
  const values = [...new Set([...candidates, max])];

  for (const value of values) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quick-btn';
    button.dataset.value = String(value);
    button.textContent = value === max ? '全部' : String(value);
    button.title = `本次共 ${value} 题`;
    dom.quickTotals.append(button);
  }
  updateQuickTotals();
}

function renderParts() {
  dom.partList.replaceChildren();
  dom.partList.setAttribute('aria-busy', 'false');
  state.bank.parts.forEach((part, index) => {
    const row = document.createElement('div');
    row.className = 'part-row';

    const info = document.createElement('div');
    info.className = 'part-info';

    const partIndex = document.createElement('span');
    partIndex.className = 'part-index';
    partIndex.textContent = String(index + 1).padStart(2, '0');

    const copy = document.createElement('div');
    copy.className = 'part-copy';

    const name = document.createElement('span');
    name.className = 'part-name';
    name.textContent = part.name;
    name.title = part.name;

    const description = document.createElement('span');
    description.className = 'part-desc';
    const descriptionText = part.description ? `${part.description} · ` : '';
    description.textContent = `${descriptionText}共 ${part.total} 题`;
    description.title = description.textContent;

    copy.append(name, description);
    info.append(partIndex, copy);

    const stepper = document.createElement('div');
    stepper.className = 'mini-stepper';

    const minus = document.createElement('button');
    minus.type = 'button';
    minus.dataset.partAction = 'minus';
    minus.dataset.partId = part.id;
    minus.setAttribute('aria-label', `减少「${part.name}」的题数`);
    minus.textContent = '−';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(part.total);
    input.value = '0';
    input.dataset.partId = part.id;
    input.setAttribute('aria-label', `「${part.name}」的题数`);

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.dataset.partAction = 'plus';
    plus.dataset.partId = part.id;
    plus.setAttribute('aria-label', `增加「${part.name}」的题数`);
    plus.textContent = '+';

    stepper.append(minus, input, plus);
    row.append(info, stepper);
    dom.partList.append(row);
  });
}

function updateBankSummary(bank) {
  dom.heroTotal.textContent = String(bank.stats.totalQuestions);
  dom.heroParts.textContent = String(bank.stats.partCount);
  dom.maxTotal.textContent = String(bank.stats.totalQuestions);
  dom.totalInput.max = String(bank.stats.totalQuestions);
  dom.bankCaption.replaceChildren();

  const mark = document.createElement('span');
  mark.className = 'caption-mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '◆';

  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = bank.meta.title;
  const meta = document.createElement('span');
  const warnings = bank.warningCount > 0 ? ` · ${bank.warningCount} 条校验提示` : '';
  meta.textContent = ` ${bank.source} · ${bank.stats.totalQuestions} 题已就绪${warnings}`;
  copy.append(title, meta);
  dom.bankCaption.append(mark, copy);
  dom.bankCaption.title = bank.meta.description || bank.meta.title;
}

function renderBankError(message) {
  state.bankReady = false;
  dom.partList.setAttribute('aria-busy', 'false');
  dom.partList.replaceChildren();

  const box = document.createElement('div');
  box.className = 'boot-error';
  const title = document.createElement('strong');
  title.textContent = '题库未能加载';
  const detail = document.createElement('span');
  detail.textContent = message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'text-btn';
  retry.textContent = '重新加载题库';
  retry.addEventListener('click', loadBank);

  box.append(title, detail, document.createElement('br'), retry);
  dom.partList.append(box);
  dom.startBtn.disabled = true;
  dom.autoAllocate.disabled = true;
  dom.totalInput.disabled = true;
  dom.totalMinus.disabled = true;
  dom.totalPlus.disabled = true;
  dom.bankCaption.textContent = '请检查题库文件后重新加载。';
  setBankStatus('error', '题库不可用');
}

async function loadBank() {
  setBankStatus('loading', '题库加载中');
  dom.startBtn.disabled = true;
  dom.autoAllocate.disabled = true;
  dom.totalInput.disabled = true;
  dom.totalMinus.disabled = true;
  dom.totalPlus.disabled = true;
  dom.partList.setAttribute('aria-busy', 'true');
  dom.partList.replaceChildren();

  for (let index = 0; index < 3; index += 1) {
    const skeleton = document.createElement('div');
    skeleton.className = 'part-skeleton';
    dom.partList.append(skeleton);
  }

  try {
    let response;
    try {
      response = await fetch('./data/dangshi_quiz_500.json', { cache: 'no-cache' });
    } catch {
      throw new Error('无法读取题库文件。请通过 HTTP 服务器访问页面（GitHub Pages 或本地静态服务器），不要直接双击打开 index.html。');
    }
    if (!response.ok) {
      throw new Error(`题库文件加载失败（HTTP ${response.status}）。`);
    }

    const raw = await response.json();
    const { bank: normalized, warnings } = normalizeBank(raw, {
      fallbackTitle: 'dangshi_quiz_500',
    });
    normalized.parts.forEach((part) => {
      part.total = part.questions.length;
    });
    const bank = {
      ...normalized,
      source: 'dangshi_quiz_500.json',
      warningCount: warnings.length,
    };
    if (!bank.parts.length || !bank.stats.totalQuestions) {
      throw new Error('题库没有可用题目。');
    }
    state.bank = bank;
    state.bankReady = true;
    document.title = `${bank.meta.title} · 红色问答`;
    updateBankSummary(bank);
    renderParts();
    renderQuickTotals();

    const initialTotal = Math.min(20, bank.stats.totalQuestions);
    const capacities = getCapacities();
    const initialAllocation = apportionEven(initialTotal, capacities);
    setAllocationFromArray(initialAllocation);

    dom.totalInput.disabled = false;
    dom.totalMinus.disabled = false;
    dom.totalPlus.disabled = false;
    dom.autoAllocate.disabled = false;
    syncConfigUI();
    setBankStatus('ready', `题库就绪 · ${bank.stats.totalQuestions} 题`);
  } catch (error) {
    state.bank = null;
    renderBankError(error.message);
  }
}

function setRestartLoading(loading) {
  const label = dom.restartBtn.querySelector('span');
  dom.restartBtn.disabled = loading;
  dom.backHome.disabled = loading;
  if (label) label.textContent = loading ? '正在抽取题目…' : '再答一局';
}

async function beginQuiz(origin = 'setup') {
  if (!state.bankReady || state.busy) return;
  if (sum(getAllocationArray()) !== state.total || state.total < 1) {
    showToast('题目分配有误，请重新设置。');
    return;
  }

  state.busy = true;
  updateStartButton();
  if (origin === 'result') setRestartLoading(true);

  try {
    const session = new LocalQuizSession(
      state.bank.parts,
      Object.fromEntries(state.allocation),
    );
    state.session = session;
    state.result = null;
    state.answered = false;
    state.finished = false;
    state.answer = null;
    state.selected.clear();
    showView('quiz');
    renderQuestion(session.getQuestion().question);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
    if (origin === 'result') setRestartLoading(false);
    updateStartButton();
  }
}

function optionButtonElements() {
  return [...dom.optionList.querySelectorAll('.option')];
}

function renderOptions(question) {
  dom.optionList.replaceChildren();

  question.options.forEach((option, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'option';
    button.dataset.index = String(index);
    button.style.setProperty('--i', String(index));
    if (question.multiple) button.setAttribute('aria-pressed', 'false');

    const key = document.createElement('span');
    key.className = 'option-key';
    key.textContent = option.key;

    const text = document.createElement('span');
    text.className = 'option-text';
    text.textContent = option.text;

    const mark = document.createElement('span');
    mark.className = 'option-mark';
    mark.setAttribute('aria-hidden', 'true');

    button.append(key, text, mark);
    button.setAttribute('aria-label', `选项 ${option.key}：${option.text}`);
    dom.optionList.append(button);
  });
}

function updateSelectedOptions() {
  for (const button of optionButtonElements()) {
    const index = Number(button.dataset.index);
    const selected = state.selected.has(index);
    button.classList.toggle('is-selected', selected);
    if (state.question?.multiple) {
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  }
  dom.submitAnswer.disabled = state.selected.size === 0;
}

function renderQuestion(question) {
  state.question = question;
  state.answer = null;
  state.answered = false;
  state.finished = false;
  state.selected.clear();

  dom.quizPartName.textContent = question.partName;
  dom.quizCurrent.textContent = String(question.number);
  dom.quizTotal.textContent = String(question.total);
  dom.typeBadge.textContent = typeLabels[question.type] || '单选题';
  dom.questionCard.dataset.type = question.type;
  dom.questionNumber.textContent = String(question.number).padStart(2, '0');
  dom.questionText.textContent = question.question;
  dom.questionHint.textContent = question.multiple
    ? '多选题 · 请选出所有正确选项后确认'
    : question.type === 'judge'
      ? '判断题 · 点击选项作答'
      : '点击你认为正确的选项';

  dom.feedback.hidden = true;
  dom.feedback.removeAttribute('data-state');
  dom.feedbackTitle.textContent = '';
  dom.feedbackAnswer.replaceChildren();
  dom.explanationWrap.hidden = false;
  dom.explanationText.textContent = '';

  dom.submitAnswer.hidden = !question.multiple;
  dom.submitAnswer.disabled = true;
  dom.submitAnswer.textContent = '确认答案';
  dom.nextQuestion.hidden = true;
  dom.nextQuestion.disabled = false;
  dom.nextQuestion.classList.remove('is-loading');
  dom.nextBtnLabel.textContent = '下一题';
  dom.keyboardHint.textContent = question.multiple
    ? '可按字母键多选 · Enter 提交'
    : '可按选项字母快速作答';

  renderOptions(question);
  setProgress(question.number - 1, question.total);

  window.requestAnimationFrame(() => {
    dom.questionText.focus({ preventScroll: true });
  });
}

function setProgress(answered, total) {
  const percent = total > 0 ? Math.min(100, (answered / total) * 100) : 0;
  dom.progressFill.style.width = `${percent}%`;
  dom.quizProgress.setAttribute('aria-valuenow', String(Math.round(percent)));
  dom.quizProgress.setAttribute('aria-valuetext', `已完成 ${answered} / ${total} 题`);
}

function setOptionsDisabled(disabled) {
  for (const button of optionButtonElements()) {
    button.disabled = disabled;
  }
}

function onOptionChoose(index) {
  if (!state.question || state.answered || state.busy) return;
  const option = state.question.options[index];
  if (!option) return;

  if (state.question.multiple) {
    if (state.selected.has(index)) state.selected.delete(index);
    else state.selected.add(index);
    updateSelectedOptions();
    return;
  }

  state.selected = new Set([index]);
  updateSelectedOptions();
  submitCurrentAnswer();
}

async function submitCurrentAnswer() {
  if (!state.question || state.answered || state.busy) return;
  if (!state.selected.size) {
    showToast('请先选择答案。');
    return;
  }
  if (!state.session) {
    showToast('本次答题已失效，请重新开始。');
    return;
  }

  const choices = [...state.selected].sort((a, b) => a - b);
  state.busy = true;
  setOptionsDisabled(true);
  dom.submitAnswer.disabled = true;
  dom.submitAnswer.textContent = '正在提交…';

  try {
    const data = state.session.answer({
      number: state.question.number,
      choices,
    });
    state.answer = data;
    state.answered = true;
    state.finished = data.finished;
    applyAnswerState(data);
  } catch (error) {
    showToast(error.message);
    if (!state.answered) {
      setOptionsDisabled(false);
      if (state.question.multiple) {
        dom.submitAnswer.disabled = state.selected.size === 0;
      }
    }
  } finally {
    state.busy = false;
    dom.submitAnswer.textContent = '确认答案';
  }
}

function applyAnswerState(data) {
  const correctSet = new Set(data.correctChoices);
  for (const button of optionButtonElements()) {
    const index = Number(button.dataset.index);
    button.disabled = true;
    if (correctSet.has(index)) {
      button.classList.add('is-correct');
      button.classList.remove('is-muted');
    } else if (state.selected.has(index)) {
      button.classList.add('is-wrong');
    } else {
      button.classList.add('is-muted');
    }
  }

  const correctText = data.correctOptions
    .map((option) => `${option.key} · ${option.text}`)
    .join('；');

  dom.feedback.hidden = false;
  dom.feedback.dataset.state = data.correct ? 'correct' : 'wrong';
  dom.feedbackTitle.textContent = data.correct ? '回答正确' : '回答错误';
  const answerLabel = document.createElement('b');
  answerLabel.textContent = '正确答案：';
  const answerText = document.createElement('span');
  answerText.className = 'answer-text';
  answerText.textContent = correctText;
  dom.feedbackAnswer.replaceChildren(answerLabel, answerText);

  if (data.explanation) {
    dom.explanationWrap.hidden = false;
    dom.explanationText.textContent = data.explanation;
  } else {
    dom.explanationWrap.hidden = true;
  }

  dom.submitAnswer.hidden = true;
  dom.nextQuestion.hidden = false;
  dom.nextBtnLabel.textContent = data.finished ? '查看成绩' : '下一题';
  dom.keyboardHint.textContent = data.finished
    ? '按 Enter 查看本场成绩'
    : '按 Enter 进入下一题';

  setProgress(data.progress.answered, data.progress.total);
  window.requestAnimationFrame(() => {
    dom.nextQuestion.focus({ preventScroll: true });
  });
}

async function handleNext() {
  if (!state.question || !state.answered || state.busy) return;
  if (state.finished) {
    loadResult();
    return;
  }
  if (!state.session) {
    showToast('本次答题已失效，请重新开始。');
    return;
  }

  state.busy = true;
  dom.nextQuestion.disabled = true;
  dom.nextQuestion.classList.add('is-loading');
  dom.nextBtnLabel.textContent = '加载中…';

  let advanced = false;
  try {
    const data = state.session.getQuestion();
    if (data.finished) {
      state.finished = true;
    } else {
      renderQuestion(data.question);
      advanced = true;
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
    dom.nextQuestion.disabled = false;
    dom.nextQuestion.classList.remove('is-loading');
    if (!advanced && state.finished) {
      dom.nextBtnLabel.textContent = '查看成绩';
    } else if (!advanced) {
      dom.nextBtnLabel.textContent = '下一题';
    }
  }

  if (!advanced && state.finished) {
    loadResult();
  }
}

function loadResult() {
  if (!state.session || state.busy) return;

  try {
    const result = state.session.result();
    state.result = result;
    renderResult(result);
    showView('result');
    dom.resultTitle.focus({ preventScroll: true });
  } catch (error) {
    showToast(error.message);
  }
}

function resultCopy(accuracy) {
  if (accuracy === 100) {
    return {
      title: '满分完成，初心如炬',
      sub: '全部答对。扎实的积累在这一刻闪光，愿这份笃定与热爱长久相伴。',
    };
  }
  if (accuracy >= 80) {
    return {
      title: '表现优异，笃行不怠',
      sub: '基础扎实、思路清晰。回看解析，把每一个知识点都沉淀为前行的力量。',
    };
  }
  if (accuracy >= 60) {
    return {
      title: '学有所获，再接再厉',
      sub: '已经掌握了大部分要点，不妨对照解析再读一遍，让记忆更加牢固。',
    };
  }
  return {
    title: '温故知新，蓄力再行',
    sub: '每一次作答都是积累。读懂解析、补齐细节，下一局会有更好的表现。',
  };
}

function renderResult(result) {
  const copy = resultCopy(result.accuracy);
  dom.resultTitle.textContent = copy.title;
  dom.resultSub.textContent = copy.sub;
  dom.resultCorrect.textContent = String(result.correctCount);
  dom.resultTotal.textContent = String(result.total);
  dom.resultCorrectInline.textContent = String(result.correctCount);
  dom.resultTotalInline.textContent = String(result.total);
  dom.resultAccuracy.textContent = `正确率 ${result.accuracy}%`;
  dom.resultDuration.textContent = formatDuration(result.durationMs);

  dom.ringValue.style.transition = 'none';
  dom.ringValue.style.strokeDashoffset = String(RING_CIRCUMFERENCE);

  dom.partResults.replaceChildren();
  const pendingBars = [];
  for (const part of result.parts) {
    const row = document.createElement('div');
    row.className = 'part-result';

    const head = document.createElement('div');
    head.className = 'part-result-head';
    const name = document.createElement('span');
    name.textContent = part.partName;
    const score = document.createElement('strong');
    score.textContent = `${part.correct} / ${part.total}`;
    const unit = document.createElement('span');
    unit.textContent = ' 题';
    score.append(unit);
    head.append(name, score);

    const track = document.createElement('div');
    track.className = 'part-result-track';
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', `${part.partName}：答对 ${part.correct} 题，共 ${part.total} 题`);
    const fill = document.createElement('span');
    fill.className = 'part-result-fill';
    fill.style.width = '0%';
    track.append(fill);

    row.append(head, track);
    dom.partResults.append(row);
    pendingBars.push({
      fill,
      percent: part.total > 0 ? (part.correct / part.total) * 100 : 0,
    });
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      dom.ringValue.style.transition = '';
      dom.ringValue.style.strokeDashoffset = String(
        RING_CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, result.accuracy)) / 100),
      );
      for (const item of pendingBars) {
        item.fill.style.width = `${item.percent}%`;
      }
    });
  });
}

function returnToSetup() {
  if (dom.exitDialog.open) dom.exitDialog.close();
  state.session = null;
  state.question = null;
  state.result = null;
  state.answered = false;
  state.finished = false;
  state.selected.clear();
  state.busy = false;
  showView('setup');
  updateStartButton();
}

function openExitDialog() {
  if (!dom.exitDialog.open) {
    dom.exitDialog.showModal();
  }
}

function bindEvents() {
  dom.startBtn.addEventListener('click', () => beginQuiz('setup'));
  dom.restartBtn.addEventListener('click', () => beginQuiz('result'));
  dom.backHome.addEventListener('click', () => {
    showView('setup');
    updateStartButton();
  });

  dom.totalMinus.addEventListener('click', () => setTotal(state.total - 1));
  dom.totalPlus.addEventListener('click', () => setTotal(state.total + 1));
  dom.totalInput.addEventListener('change', () => {
    if (!state.bankReady) return;
    const value = Number(dom.totalInput.value);
    if (!Number.isFinite(value) || value < 1) {
      dom.totalInput.value = String(state.total);
      return;
    }
    setTotal(value);
  });
  dom.totalInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') dom.totalInput.blur();
  });

  dom.quickTotals.addEventListener('click', (event) => {
    const button = event.target.closest('.quick-btn');
    if (button) setTotal(Number(button.dataset.value));
  });

  dom.autoAllocate.addEventListener('click', () => {
    if (!state.bankReady) return;
    const allocation = apportionEven(state.total, getCapacities());
    setAllocationFromArray(allocation);
    syncConfigUI();
  });

  dom.partList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-part-action]');
    if (!button) return;
    const delta = button.dataset.partAction === 'plus' ? 1 : -1;
    adjustPart(button.dataset.partId, delta);
  });

  dom.partList.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-part-id]');
    if (!input) return;
    setPartCount(input.dataset.partId, Number(input.value));
  });

  dom.optionList.addEventListener('click', (event) => {
    const button = event.target.closest('.option');
    if (!button || button.disabled) return;
    onOptionChoose(Number(button.dataset.index));
  });

  dom.submitAnswer.addEventListener('click', submitCurrentAnswer);
  dom.nextQuestion.addEventListener('click', handleNext);

  dom.quitQuiz.addEventListener('click', openExitDialog);
  dom.exitCancel.addEventListener('click', () => dom.exitDialog.close());
  dom.exitConfirm.addEventListener('click', returnToSetup);

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (dom.quizView.hidden || dom.exitDialog.open) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      openExitDialog();
      return;
    }

    if (!state.answered) {
      if (event.key === 'Enter' && state.question?.multiple) {
        if (state.selected.size > 0 && !state.busy) {
          event.preventDefault();
          submitCurrentAnswer();
        }
        return;
      }

      let index = -1;
      if (state.question) {
        const key = event.key.toUpperCase();
        index = state.question.options.findIndex((option) => option.key.toUpperCase() === key);
        if (index < 0 && /^[1-9]$/.test(event.key)) {
          index = Number(event.key) - 1;
        }
      }
      if (index >= 0 && index < (state.question?.options.length || 0) && !state.busy) {
        event.preventDefault();
        onOptionChoose(index);
      }
      return;
    }

    if (event.key === 'Enter') {
      const tag = document.activeElement?.tagName;
      if (tag === 'BUTTON' || tag === 'A') return;
      event.preventDefault();
      handleNext();
    }
  });
}

async function init() {
  bindEvents();
  await loadBank();
}

init();
