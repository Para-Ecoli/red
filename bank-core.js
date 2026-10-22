export class BankError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BankError';
  }
}

const PART_ARRAY_KEYS = ['parts', 'categories', 'sections', 'chapters', 'groups', 'modules'];
const GROUP_QUESTIONS_KEYS = ['questions', 'items', 'list', 'data', 'questionList', 'question_list'];
const TEXT_KEYS = ['question', 'stem', 'title', 'content', 'questionText', 'question_text', 'qtext', '题干', '题目'];
const OPTION_KEYS = ['options', 'choices', 'option', 'choiceList', 'optionList', '选项'];
const ANSWER_KEYS = [
  'answer', 'correctAnswer', 'correct_answer', 'correct', 'answerKey', 'answer_key',
  'rightAnswer', 'right_answer', 'correctOption', 'correct_option', '答案', '正确答案',
];
const EXPLANATION_KEYS = [
  'explanation', 'analysis', 'explain', 'answerExplanation', 'answer_explanation',
  'reason', 'comment', '解析', '答案解析',
];
const TYPE_KEYS = ['type', 'questionType', 'question_type', 'qtype', 'kind', '题型'];
const ID_KEYS = ['id', 'no', 'number', 'num', 'code'];
const GROUP_NAME_KEYS = ['name', 'title', 'label', 'category', 'categoryName', 'typeName', 'part', 'type'];
const GROUP_DESCRIPTION_KEYS = ['description', 'desc', 'intro', 'subtitle', 'summary'];
const CATEGORY_KEYS = ['part', 'category', 'categoryName', 'section', 'chapter', 'group', 'module', 'type', 'questionType', '题型', '分类'];
const META_KEYS = new Set([
  'meta', 'title', 'name', 'description', 'desc', 'intro', 'version', 'author', 'source',
  'total', 'updatedAt', 'updated_at', 'parts', 'categories', 'sections', 'chapters', 'groups', 'modules',
]);

function firstDefined(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asText(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

function pickGroupQuestions(group) {
  for (const key of GROUP_QUESTIONS_KEYS) {
    if (Array.isArray(group?.[key])) return group[key];
  }
  return null;
}

function isQuestionLike(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return TEXT_KEYS.some((key) => typeof value[key] === 'string' && value[key].trim());
}

function isGroupLike(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const nested = pickGroupQuestions(value);
  return Array.isArray(nested) && nested.some(isQuestionLike);
}

function normalizeMeta(raw, fallbackTitle) {
  const meta = raw && !Array.isArray(raw) && typeof raw.meta === 'object' && raw.meta ? raw.meta : {};
  const title = asText(firstDefined(meta, ['title', 'name'])) ||
    asText(firstDefined(raw, ['title', 'name', 'bankName', 'bank_name'])) ||
    fallbackTitle || '知识竞答题库';
  const description = asText(firstDefined(meta, ['description', 'desc', 'intro', 'subtitle'])) ||
    asText(firstDefined(raw, ['description', 'desc', 'intro'])) || '';
  const version = asText(firstDefined(meta, ['version'])) || asText(firstDefined(raw, ['version'])) || '';
  return { title, description, version };
}

function groupFromRaw(group, index, warnings) {
  const questions = pickGroupQuestions(group);
  if (!questions || !questions.length) {
    warnings.push(`已跳过一个空的题目分组（第 ${index + 1} 组）。`);
    return null;
  }
  const name = asText(firstDefined(group, GROUP_NAME_KEYS)) || `第 ${index + 1} 部分`;
  const description = asText(firstDefined(group, GROUP_DESCRIPTION_KEYS));
  return { name, description, questions };
}

function labelFlatQuestions(questions) {
  const labels = questions.map((question) => {
    if (!question || typeof question !== 'object') return '';
    const value = firstDefined(question, CATEGORY_KEYS);
    return typeof value === 'string' ? value.trim() : '';
  });
  const distinct = [...new Set(labels.filter(Boolean))];

  if (!distinct.length) {
    return [{ name: '综合题库', description: '', questions }];
  }

  if (distinct.length === 1) {
    return [{ name: distinct[0], description: '', questions }];
  }

  const groups = new Map();
  questions.forEach((question, i) => {
    const name = labels[i] || '其他';
    if (!groups.has(name)) groups.set(name, { name, description: '', questions: [] });
    groups.get(name).questions.push(question);
  });
  return [...groups.values()];
}

function extractGroups(raw, warnings) {
  if (Array.isArray(raw)) {
    if (raw.some(isGroupLike)) {
      return raw
        .map((group, index) => (isGroupLike(group) ? groupFromRaw(group, index, warnings) : null))
        .filter(Boolean);
    }
    return labelFlatQuestions(raw);
  }

  if (!raw || typeof raw !== 'object') {
    throw new BankError('题库内容必须是 JSON 对象或数组。');
  }

  for (const key of PART_ARRAY_KEYS) {
    const value = raw[key];
    if (Array.isArray(value) && value.some(isGroupLike)) {
      return value
        .map((group, index) => (isGroupLike(group) ? groupFromRaw(group, index, warnings) : null))
        .filter(Boolean);
    }
  }

  for (const key of GROUP_QUESTIONS_KEYS) {
    const value = raw[key];
    if (!Array.isArray(value)) continue;
    if (value.some(isGroupLike)) {
      return value
        .map((group, index) => (isGroupLike(group) ? groupFromRaw(group, index, warnings) : null))
        .filter(Boolean);
    }
    return labelFlatQuestions(value);
  }

  const keyedGroups = Object.entries(raw).filter(([key, value]) => (
    !META_KEYS.has(key) &&
    !key.startsWith('_') &&
    Array.isArray(value) &&
    value.some(isQuestionLike)
  ));
  if (keyedGroups.length) {
    return keyedGroups.map(([name, questions]) => ({ name, description: '', questions }));
  }

  if (isQuestionLike(raw)) {
    return [{ name: '综合题库', description: '', questions: [raw] }];
  }

  return [];
}

function parseOptionString(value) {
  const text = asText(value);
  if (!text) return null;
  const patterns = [
    /^([A-Za-z])[.．、:：)）]\s*(.+)$/,
    /^[（(]([A-Za-z])[)）]\s*(.+)$/,
    /^([A-Za-z])\s*[-—]\s*(.+)$/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[2].trim()) {
      return { rawKey: match[1].toUpperCase(), text: match[2].trim(), correct: false };
    }
  }
  return { rawKey: null, text, correct: false };
}

function isOptionObjectMap(value) {
  const entries = Object.entries(value);
  return entries.length > 1 &&
    entries.every(([key, entry]) => /^[A-Za-z0-9\u4e00-\u9fa5]{1,8}$/.test(key) && (typeof entry === 'string' || typeof entry === 'number'));
}

function normalizeOptionObject(entry) {
  const keySource = firstDefined(entry, ['key', 'optionKey', 'option_key', 'code', 'letter', 'id']);
  const text = asText(firstDefined(entry, ['text', 'content', 'label', 'value', 'option', 'title', 'name']));
  const likelyKey = !keySource && (entry.content !== undefined || entry.text !== undefined)
    ? asText(entry.label)
    : asText(keySource);
  const correct = entry.correct === true || entry.isCorrect === true || entry.is_correct === true ||
    entry.right === true || entry.isAnswer === true || entry.answer === true;
  return { rawKey: likelyKey || null, text, correct };
}

function normalizeOptions(value) {
  const options = [];

  const push = (option) => {
    if (option && option.text) options.push(option);
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' || typeof entry === 'number') {
        push(parseOptionString(entry));
        continue;
      }
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        if (isOptionObjectMap(entry)) {
          for (const [key, text] of Object.entries(entry)) {
            push({ rawKey: key, text: asText(text), correct: false });
          }
        } else {
          push(normalizeOptionObject(entry));
        }
      }
    }
  } else if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([key]) => !['correct', 'answer'].includes(key));
    const sorted = entries.every(([key]) => /^\d+$/.test(key))
      ? [...entries].sort((a, b) => Number(a[0]) - Number(b[0]))
      : entries.every(([key]) => /^[A-Za-z]$/.test(key))
        ? [...entries].sort((a, b) => a[0].localeCompare(b[0]))
        : entries;
    for (const [key, entry] of sorted) {
      if (typeof entry === 'string' || typeof entry === 'number') {
        const parsed = parseOptionString(entry);
        push({ rawKey: parsed?.rawKey || key, text: parsed?.text || '', correct: false });
      } else if (entry && typeof entry === 'object') {
        const option = normalizeOptionObject(entry);
        push({ ...option, rawKey: option.rawKey || key });
      }
    }
  }

  options.forEach((option, index) => {
    if (!option.rawKey) option.rawKey = letterFor(index);
  });

  return options;
}

function letterFor(index) {
  return String.fromCharCode(65 + index);
}

const JUDGE_TRUE_TEXTS = ['正确', '对', '是', '√', '✓', 'true', 't'];
const JUDGE_FALSE_TEXTS = ['错误', '错', '否', '×', '✕', 'false', 'f'];

function cleanJudgeText(text) {
  return text.replace(/[。.！!\s]/g, '').toLowerCase();
}

function looksLikeJudge(options) {
  if (options.length !== 2) return false;
  const texts = options.map((option) => cleanJudgeText(option.text));
  return texts.some((text) => JUDGE_TRUE_TEXTS.includes(text)) &&
    texts.some((text) => JUDGE_FALSE_TEXTS.includes(text));
}

function tokenMatchesOption(token, option) {
  const normalized = token.trim().toUpperCase();
  if (option.rawKey && option.rawKey.trim().toUpperCase() === normalized) return true;
  return option.text.trim().toUpperCase() === normalized;
}

function resolveAnswerToken(token, options) {
  if (token === null || token === undefined) return [];
  if (typeof token === 'boolean') {
    const target = token ? JUDGE_TRUE_TEXTS : JUDGE_FALSE_TEXTS;
    const index = options.findIndex((option) => target.includes(cleanJudgeText(option.text)));
    return index >= 0 ? [index] : (token ? [0] : (options.length > 1 ? [1] : []));
  }
  if (typeof token === 'number' && Number.isFinite(token)) {
    const rawMatch = options.findIndex((option) => option.rawKey && Number(option.rawKey) === token);
    if (rawMatch >= 0) return [rawMatch];
    if (token === 0) return [0];
    if (Number.isInteger(token) && token >= 1 && token <= options.length) return [token - 1];
    return [];
  }

  let text = String(token).trim();

  const prefixMatch = text.match(/^(?:正确答案|答案)\s*[:：]\s*(.+)$/);
  if (prefixMatch) text = prefixMatch[1].trim();
  if (!text) return [];

  const directIndex = options.findIndex((option) => tokenMatchesOption(text, option));
  if (directIndex >= 0) return [directIndex];

  const stripped = text.replace(/^([（(]?)([A-Za-z])([)）]?[.．、:：]?)(?:\s+|$)/, '$2');
  if (stripped !== text) {
    const index = options.findIndex((option) => tokenMatchesOption(stripped, option));
    if (index >= 0) return [index];
  }

  const normalizedText = cleanJudgeText(text);
  if (JUDGE_TRUE_TEXTS.includes(normalizedText) || JUDGE_FALSE_TEXTS.includes(normalizedText)) {
    return resolveAnswerToken(JUDGE_TRUE_TEXTS.includes(normalizedText), options);
  }

  const integer = Number(text);
  if (/^\d+$/.test(text) && Number.isInteger(integer)) {
    if (integer === 0) return [0];
    if (integer >= 1 && integer <= options.length) return [integer - 1];
    return [];
  }

  if (/^[A-Za-z]+$/.test(text) && text.length > 1) {
    const indexes = [];
    for (const character of text.toUpperCase()) {
      const index = options.findIndex((option) => option.rawKey && option.rawKey.toUpperCase() === character);
      if (index >= 0) indexes.push(index);
    }
    if (indexes.length === text.length) return indexes;
  }

  return [];
}

function splitAnswerValue(value) {
  const values = Array.isArray(value) ? value : [value];
  const tokens = [];
  for (const item of values) {
    if (item === null || item === undefined || item === '') continue;
    if (typeof item !== 'string') {
      tokens.push(item);
      continue;
    }
    const text = item.trim();
    if (/^[A-Za-z](?:\s*[,，、;；/]\s*[A-Za-z])+$/.test(text)) {
      tokens.push(...text.split(/[\s,，、;；/]+/).filter(Boolean));
    } else if (/^\d+(?:\s*[,，、;；/]\s*\d+)+$/.test(text)) {
      tokens.push(...text.split(/[\s,，、;；/]+/).filter(Boolean).map(Number));
    } else {
      tokens.push(text);
    }
  }
  return tokens;
}

function resolveAnswers(value, options) {
  if (value === null || value === undefined || value === '') return [];
  const tokens = splitAnswerValue(value);
  const indexes = new Set();
  let resolvedAny = false;

  for (const token of tokens) {
    const matches = resolveAnswerToken(token, options);
    if (matches.length) {
      resolvedAny = true;
      for (const index of matches) indexes.add(index);
    }
  }

  if (!resolvedAny) {
    const singleText = Array.isArray(value) ? value.join('') : String(value);
    const compact = singleText.replace(/\s/g, '').toUpperCase();
    if (/^[A-Z]{2,}$/.test(compact)) {
      const letters = [...compact];
      const found = letters.map((letter) => options.findIndex((option) => option.rawKey?.toUpperCase() === letter));
      if (found.every((index) => index >= 0)) return [...new Set(found)].sort((a, b) => a - b);
    }
  }

  return [...indexes].sort((a, b) => a - b);
}

function normalizeQuestion(raw, context) {
  const { number, warnings, partName } = context;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`第 ${number} 道题格式无效，已跳过。`);
    return null;
  }

  const question = asText(firstDefined(raw, TEXT_KEYS));
  if (!question) {
    warnings.push(`第 ${number} 道题缺少题干，已跳过。`);
    return null;
  }

  const options = normalizeOptions(firstDefined(raw, OPTION_KEYS));
  if (options.length < 2) {
    warnings.push(`第 ${number} 道题（${question.slice(0, 18)}…）有效选项少于 2 个，已跳过。`);
    return null;
  }

  let answer = resolveAnswers(firstDefined(raw, ANSWER_KEYS), options);
  if (!answer.length) {
    answer = options
      .map((option, index) => (option.correct ? index : -1))
      .filter((index) => index >= 0);
  }
  if (!answer.length) {
    warnings.push(`第 ${number} 道题（${question.slice(0, 18)}…）未识别到正确答案，已跳过。`);
    return null;
  }

  const declaredType = asText(firstDefined(raw, TYPE_KEYS)) || partName || '';
  const multiHint = /多选|多项|不定项|multiple|multi/i.test(declaredType);
  const judgeHint = /判断|是非|true[\s_-]?false|judge/i.test(declaredType);
  let type = 'single';
  if (answer.length > 1 || multiHint) {
    type = 'multiple';
  } else if (judgeHint || looksLikeJudge(options)) {
    type = 'judge';
  }

  const explanation = asText(firstDefined(raw, EXPLANATION_KEYS));
  const sourceId = firstDefined(raw, ID_KEYS);

  return {
    id: `q-${number}`,
    sourceId: sourceId === undefined ? null : String(sourceId),
    type,
    question,
    options: options.map((option, index) => ({ key: letterFor(index), text: option.text })),
    answer,
    explanation,
  };
}

export function normalizeBank(raw, options = {}) {
  const warnings = [];
  const groups = extractGroups(raw, warnings);
  if (!groups.length) {
    throw new BankError('未能从题库中识别出题目。请检查题库是否为 JSON 数组，或包含 questions / parts 字段。');
  }

  const meta = normalizeMeta(raw, options.fallbackTitle);
  const parts = [];
  let questionNumber = 0;
  const seenQuestions = new Set();

  groups.forEach((group, partIndex) => {
    const normalizedQuestions = [];
    for (const rawQuestion of group.questions) {
      questionNumber += 1;
      const question = normalizeQuestion(rawQuestion, {
        number: questionNumber,
        warnings,
        partName: group.name,
      });
      if (!question) continue;

      const duplicateKey = `${question.question}::${question.options.map((option) => option.text).join('|')}`;
      if (seenQuestions.has(duplicateKey)) {
        warnings.push(`第 ${questionNumber} 道题与前面的题目重复，已跳过。`);
        continue;
      }
      seenQuestions.add(duplicateKey);
      normalizedQuestions.push(question);
    }

    if (normalizedQuestions.length) {
      parts.push({
        id: `part-${partIndex + 1}`,
        name: group.name || `第 ${partIndex + 1} 部分`,
        description: group.description || '',
        questions: normalizedQuestions,
      });
    }
  });

  if (!parts.length) {
    throw new BankError('题库中没有可用题目，请检查题干、选项与答案字段。');
  }

  const totalQuestions = parts.reduce((sum, part) => sum + part.questions.length, 0);
  const stats = {
    totalQuestions,
    partCount: parts.length,
    singleChoice: 0,
    multipleChoice: 0,
    judge: 0,
  };
  for (const part of parts) {
    for (const question of part.questions) {
      if (question.type === 'multiple') stats.multipleChoice += 1;
      else if (question.type === 'judge') stats.judge += 1;
      else stats.singleChoice += 1;
    }
  }

  return {
    bank: { meta, parts, stats, warnings: [...warnings] },
    warnings,
  };
}

