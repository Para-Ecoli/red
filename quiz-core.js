function randomInt(max) {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) return Math.floor(Math.random() * max);

  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  let value;
  do {
    cryptoObj.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function letterFor(index) {
  return String.fromCharCode(65 + index);
}

export class LocalQuizSession {
  constructor(parts, rawAllocation) {
    this.questions = [];
    this.answers = [];
    this.createdAt = Date.now();
    this.finishedAt = null;
    this.build(parts, rawAllocation);
  }

  build(parts, rawAllocation) {
    if (!rawAllocation || typeof rawAllocation !== 'object' || Array.isArray(rawAllocation)) {
      throw new Error('请为每个板块设置题目数量。');
    }

    const knownIds = new Set(parts.map((part) => part.id));
    for (const partId of Object.keys(rawAllocation)) {
      if (!knownIds.has(partId)) {
        throw new Error('配置中包含未知的题目板块，请刷新页面后重试。');
      }
    }

    const selected = [];
    const allocation = [];
    let total = 0;

    for (const part of parts) {
      const rawCount = rawAllocation[part.id] ?? 0;
      const count = Number(rawCount);
      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`「${part.name}」的题数必须是大于等于 0 的整数。`);
      }
      if (count > part.questions.length) {
        throw new Error(`「${part.name}」最多可选 ${part.questions.length} 题。`);
      }
      if (count === 0) continue;

      const chosenQuestions = shuffle(part.questions).slice(0, count);
      for (const question of chosenQuestions) {
        selected.push({ part, question });
      }
      allocation.push({ partId: part.id, partName: part.name, count });
      total += count;
    }

    if (total === 0) throw new Error('至少需要选择 1 道题目。');

    this.total = total;
    this.allocation = allocation;
    this.questions = shuffle(selected).map(({ part, question }) => {
      const originalAnswerSet = new Set(question.answer);
      const shuffledOptions = shuffle(question.options.map((option, originalIndex) => ({
        text: option.text,
        originalIndex,
      })));
      const answerIndices = [];
      const options = shuffledOptions.map((option, displayIndex) => {
        if (originalAnswerSet.has(option.originalIndex)) answerIndices.push(displayIndex);
        return { key: letterFor(displayIndex), text: option.text };
      });

      return {
        partId: part.id,
        partName: part.name,
        type: question.type,
        difficulty: question.difficulty || '',
        difficultyLabel: question.difficultyLabel || '',
        question: question.question,
        options,
        answerIndices,
        explanation: question.explanation,
      };
    });
  }

  getQuestion() {
    const index = this.answers.length;
    const finished = index >= this.questions.length;
    return {
      finished,
      question: finished ? null : this.publicQuestion(index),
      progress: { answered: index, total: this.questions.length },
    };
  }

  publicQuestion(index) {
    const question = this.questions[index];
    return {
      number: index + 1,
      total: this.questions.length,
      partId: question.partId,
      partName: question.partName,
      type: question.type,
      difficulty: question.difficulty,
      difficultyLabel: question.difficultyLabel,
      multiple: question.type === 'multiple',
      question: question.question,
      options: question.options.map((option) => ({ key: option.key, text: option.text })),
    };
  }

  answer({ number, choices } = {}) {
    const currentIndex = this.answers.length;
    const total = this.questions.length;

    if (currentIndex >= total) {
      throw new Error('本次答题已经完成。');
    }
    if (number !== undefined && Number(number) !== currentIndex + 1) {
      throw new Error('题目状态已更新，请刷新当前题目后重试。');
    }
    if (!Array.isArray(choices) || !choices.length) {
      throw new Error('请至少选择一个选项。');
    }
    if (!choices.every((choice) => Number.isInteger(choice))) {
      throw new Error('选项格式不正确。');
    }

    const uniqueChoices = [...new Set(choices)].sort((a, b) => a - b);
    const question = this.questions[currentIndex];
    if (uniqueChoices.some((choice) => choice < 0 || choice >= question.options.length)) {
      throw new Error('选择中包含无效选项。');
    }
    if (question.type !== 'multiple' && uniqueChoices.length !== 1) {
      throw new Error('本题为单选题，请选择一个选项。');
    }

    const answerSet = new Set(question.answerIndices);
    const correct = uniqueChoices.length === answerSet.size &&
      uniqueChoices.every((choice) => answerSet.has(choice));

    this.answers.push({
      number: currentIndex + 1,
      choices: uniqueChoices,
      correct,
      answeredAt: Date.now(),
    });

    const finished = this.answers.length === total;
    if (finished) this.finishedAt = Date.now();

    return {
      correct,
      choices: uniqueChoices,
      correctChoices: question.answerIndices,
      correctOptions: question.answerIndices.map((index) => ({
        key: question.options[index].key,
        text: question.options[index].text,
      })),
      explanation: question.explanation,
      finished,
      progress: {
        answered: this.answers.length,
        total,
      },
    };
  }

  result() {
    const total = this.questions.length;
    if (this.answers.length < total) {
      throw new Error('还有题目未作答，暂时无法查看结果。');
    }

    const correctCount = this.answers.filter((answer) => answer.correct).length;
    const partBuckets = new Map();
    for (const question of this.questions) {
      if (!partBuckets.has(question.partId)) {
        partBuckets.set(question.partId, {
          partId: question.partId,
          partName: question.partName,
          total: 0,
          correct: 0,
        });
      }
      partBuckets.get(question.partId).total += 1;
    }
    this.questions.forEach((question, index) => {
      if (this.answers[index]?.correct) {
        partBuckets.get(question.partId).correct += 1;
      }
    });

    const durationMs = Math.max(0, (this.finishedAt || Date.now()) - this.createdAt);

    return {
      total,
      correctCount,
      wrongCount: total - correctCount,
      accuracy: total ? Math.round((correctCount / total) * 100) : 0,
      durationMs,
      finishedAt: new Date(this.finishedAt || Date.now()).toISOString(),
      parts: [...partBuckets.values()],
    };
  }
}
