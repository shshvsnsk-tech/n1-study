(() => {
  const data = window.N1_DATA;
  const STORAGE_KEY = "n1-study-progress-v1";
  const DEFAULT_DAILY_TARGET = 20;
  const QUIZ_SIZE = 20;
  const MIXED_QUIZ_SIZE_PER_TYPE = QUIZ_SIZE / 2;
  const localDayKey = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const dayKey = () => localDayKey();
  const defaultState = {
    items: {},
    daily: {},
    dailyTarget: DEFAULT_DAILY_TARGET,
    streak: 0,
    lastStudyDay: null
  };

  let state = loadState();
  let cardFilter = "mixed";
  let cardQueue = [];
  let cardIndex = 0;
  let sessionFinished = false;
  let quizFilter = "mixed";
  let quiz = {
    questions: [],
    index: 0,
    score: 0,
    answered: false,
    typeScores: { word: 0, grammar: 0 }
  };
  let libraryFilter = { type: "all", status: "all", query: "" };

  function loadState() {
    try {
      return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function showBackupMessage(message, isError = false) {
    const element = document.querySelector("#backup-message");
    element.textContent = message;
    element.style.color = isError ? "var(--red)" : "var(--sage)";
  }

  function exportProgress() {
    const payload = {
      format: "n1-study-progress",
      version: 1,
      exportedAt: new Date().toISOString(),
      state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `n1-study-${dayKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showBackupMessage("学习记录已导出。");
  }

  function isValidProgress(value) {
    return value &&
      typeof value === "object" &&
      value.items &&
      typeof value.items === "object" &&
      value.daily &&
      typeof value.daily === "object";
  }

  async function importProgress(file) {
    try {
      const payload = JSON.parse(await file.text());
      const imported = payload?.format === "n1-study-progress"
        ? payload.state
        : payload;
      if (!isValidProgress(imported)) {
        throw new Error("文件不是有效的 N1 研习室学习记录");
      }
      state = {
        ...structuredClone(defaultState),
        ...imported,
        items: { ...imported.items },
        daily: { ...imported.daily }
      };
      saveState();
      buildCardQueue();
      renderDashboard();
      renderCard();
      renderLibrary();
      showBackupMessage("学习记录已恢复。");
    } catch (error) {
      showBackupMessage(`导入失败：${error.message}`, true);
    }
  }

  function itemState(id) {
    if (!state.items[id]) {
      state.items[id] = {
        favorite: false,
        wrong: 0,
        reviews: 0,
        interval: 0,
        due: 0,
        mastered: false
      };
    }
    return state.items[id];
  }

  function reviewStatus(item) {
    const progress = itemState(item.id);
    if (!progress.reviews) return { label: "未学习", className: "new" };
    if (progress.mastered) return { label: "已掌握", className: "mastered" };
    if (progress.due <= Date.now()) return { label: "待复习", className: "due" };
    return {
      label: `${new Intl.DateTimeFormat("zh-CN", {
        month: "numeric",
        day: "numeric"
      }).format(new Date(progress.due))} 复习`,
      className: "scheduled"
    };
  }

  function escapeHtml(value = "") {
    return value.replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function speakJapanese(text) {
    if (!("speechSynthesis" in window)) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = 0.82;
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find(voice => voice.lang.startsWith("ja")) || null;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  function navigate(view) {
    document.querySelectorAll(".view").forEach(el => el.classList.toggle("active", el.id === `${view}-view`));
    document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (view === "library") renderLibrary();
    if (view === "cards") renderCard();
    if (view === "quiz" && !quiz.questions.length) startQuiz();
  }

  function dailyPick(type) {
    const candidates = data.filter(item => item.type === type);
    const seed = [...dayKey()].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return candidates[seed % candidates.length];
  }

  function renderDashboard() {
    const today = dayKey();
    const todayReviews = state.daily[today] || 0;
    const dailyTarget = Number(state.dailyTarget) || DEFAULT_DAILY_TARGET;
    const mastered = data.filter(item => itemState(item.id).mastered).length;
    const due = data.filter(item => {
      const progress = itemState(item.id);
      return progress.reviews > 0 && progress.due <= Date.now();
    }).length;
    const percent = Math.min(100, Math.round(todayReviews / dailyTarget * 100));

    document.querySelector("#today-date").textContent = new Intl.DateTimeFormat("zh-CN", {
      month: "long", day: "numeric", weekday: "short"
    }).format(new Date());
    document.querySelector("#today-count").textContent = `${todayReviews} / ${dailyTarget}`;
    document.querySelector("#daily-target").value = String(dailyTarget);
    document.querySelector("#progress-percent").textContent = `${percent}%`;
    document.querySelector("#progress-ring").style.setProperty("--progress", `${percent}%`);
    document.querySelector("#streak-count").textContent = state.streak;
    document.querySelector("#mastered-count").textContent = mastered;
    document.querySelector("#due-count").textContent = due;

    const word = dailyPick("word");
    const grammar = dailyPick("grammar");
    document.querySelector("#daily-word").innerHTML = `
      <h3>${escapeHtml(word.term)}</h3>
      <p class="reading">${escapeHtml(word.reading)}</p>
      <p class="meaning">${escapeHtml(word.meaning)}</p>`;
    document.querySelector("#daily-grammar").innerHTML = `
      <h3>${escapeHtml(grammar.term)}</h3>
      <p class="reading">${escapeHtml(grammar.reading)}</p>
      <p class="meaning">${escapeHtml(grammar.meaning)}</p>`;
  }

  function shuffled(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function buildCardQueue() {
    const candidates = data.filter(item => cardFilter === "mixed" || item.type === cardFilter);
    const overdue = candidates.filter(item => {
      const progress = itemState(item.id);
      return progress.reviews > 0 && progress.due <= Date.now();
    });
    const unseen = candidates.filter(item => !itemState(item.id).reviews);
    const scheduled = candidates.filter(item => {
      const progress = itemState(item.id);
      return progress.reviews > 0 && progress.due > Date.now();
    });
    cardQueue = [
      ...shuffled(overdue),
      ...shuffled(unseen),
      ...shuffled(scheduled)
    ].slice(0, 20);
    cardIndex = 0;
    sessionFinished = false;
  }

  function renderCard() {
    if (!cardQueue.length) buildCardQueue();
    if (sessionFinished) {
      document.querySelector("#study-card").classList.remove("flipped");
      document.querySelector("#rating-buttons").classList.remove("visible");
      document.querySelector("#card-front").innerHTML = `
        <span class="card-label">SESSION COMPLETE</span>
        <h2 class="session-complete-mark">完</h2>
        <p class="reading">本轮 ${cardQueue.length} 张卡片已完成</p>
        <button class="primary-button" id="next-session">开始下一轮</button>`;
      document.querySelector("#card-back").innerHTML = "";
      document.querySelector("#session-current").textContent = cardQueue.length;
      document.querySelector("#session-progress").style.width = "100%";
      document.querySelector("#session-new").textContent = "0";
      document.querySelector("#session-learning").textContent = "0";
      document.querySelector("#session-done").textContent = state.daily[dayKey()] || 0;
      return;
    }
    const card = cardQueue[cardIndex];
    if (!card) return;
    const isWord = card.type === "word";
    document.querySelector("#study-card").classList.remove("flipped");
    document.querySelector("#rating-buttons").classList.remove("visible");
    document.querySelector("#card-front").innerHTML = `
      <span class="card-label">${isWord ? "文字 · 語彙" : "文法"}</span>
      <h2>${escapeHtml(card.term)}</h2>
      <p class="reading">${escapeHtml(card.reading)}</p>
      <button class="speak-button" data-speak="${escapeHtml(card.term)}" aria-label="朗读日语">
        发音
      </button>`;
    document.querySelector("#card-back").innerHTML = `
      <span class="card-label">${isWord ? "释义" : "含义与用法"}</span>
      <h3>${escapeHtml(card.meaning)}</h3>
      ${card.connection ? `<p><strong>接续：</strong>${escapeHtml(card.connection)}</p>` : ""}
      <p>${escapeHtml(card.note)}</p>
      <div class="example">
        ${escapeHtml(card.example)}
        <small>${escapeHtml(card.translation)}</small>
      </div>`;
    renderSession();
  }

  function renderSession() {
    const done = cardIndex;
    document.querySelector("#session-current").textContent = Math.min(cardIndex + 1, cardQueue.length);
    document.querySelector("#session-total").textContent = cardQueue.length;
    document.querySelector("#session-progress").style.width = `${cardQueue.length ? done / cardQueue.length * 100 : 0}%`;
    document.querySelector("#session-new").textContent = cardQueue.slice(cardIndex).filter(item => !itemState(item.id).reviews).length;
    document.querySelector("#session-learning").textContent = cardQueue.slice(cardIndex).filter(item => itemState(item.id).wrong > 0).length;
    document.querySelector("#session-done").textContent = state.daily[dayKey()] || 0;
  }

  function flipCard() {
    if (sessionFinished) return;
    const el = document.querySelector("#study-card");
    el.classList.toggle("flipped");
    document.querySelector("#rating-buttons").classList.toggle("visible", el.classList.contains("flipped"));
  }

  function rateCard(rating) {
    const card = cardQueue[cardIndex];
    if (!card) return;
    const progress = itemState(card.id);
    const previousInterval = progress.interval || 0;
    const intervals = {
      again: 1 / 1440,
      hard: Math.max(1, Math.round(previousInterval * 1.2)),
      good: Math.max(3, Math.round(previousInterval * 2)),
      easy: Math.max(7, Math.round(previousInterval * 2.8))
    };
    progress.reviews += 1;
    progress.interval = intervals[rating];
    progress.due = Date.now() + intervals[rating] * 86400000;
    progress.mastered = progress.reviews >= 3 && ["good", "easy"].includes(rating);
    if (rating === "again") progress.wrong += 1;
    registerStudy();
    cardIndex += 1;
    if (cardIndex >= cardQueue.length) {
      sessionFinished = true;
    }
    saveState();
    renderCard();
    renderDashboard();
  }

  function registerStudy() {
    const today = dayKey();
    state.daily[today] = (state.daily[today] || 0) + 1;
    if (state.lastStudyDay !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      state.streak = state.lastStudyDay === localDayKey(yesterday)
        ? state.streak + 1
        : 1;
      state.lastStudyDay = today;
    }
  }

  function startQuiz() {
    const candidates = data.filter(item => {
      if (quizFilter === "word" || quizFilter === "grammar") {
        return item.type === quizFilter;
      }
      if (quizFilter === "wrong") return itemState(item.id).wrong > 0;
      return true;
    });
    if (!candidates.length) {
      quiz = {
        questions: [],
        index: 0,
        score: 0,
        answered: false,
        typeScores: { word: 0, grammar: 0 }
      };
      document.querySelector("#quiz-number").textContent = "暂无题目";
      document.querySelector("#quiz-score").textContent = "得分 0";
      document.querySelector("#quiz-content").innerHTML = `
        <p class="eyebrow">NO QUESTIONS</p>
        <h2>还没有错题</h2>
        <p>先完成一次普通测验，回答错误的内容会自动进入这里。</p>`;
      document.querySelector("#quiz-options").innerHTML = "";
      document.querySelector("#quiz-feedback").innerHTML = "";
      document.querySelector("#next-question").classList.add("hidden");
      return;
    }
    const selected = quizFilter === "mixed"
      ? shuffled([
          ...shuffled(candidates.filter(item => item.type === "word"))
            .slice(0, MIXED_QUIZ_SIZE_PER_TYPE),
          ...shuffled(candidates.filter(item => item.type === "grammar"))
            .slice(0, MIXED_QUIZ_SIZE_PER_TYPE)
        ])
      : shuffled(candidates).slice(0, Math.min(QUIZ_SIZE, candidates.length));
    const questions = selected.map(item => {
      const distractors = shuffled(data.filter(other =>
        other.type === item.type &&
        other.id !== item.id &&
        other.meaning !== item.meaning
      ))
        .slice(0, 3)
        .map(other => other.meaning);
      return { item, options: shuffled([...new Set([item.meaning, ...distractors])]) };
    });
    quiz = {
      questions,
      index: 0,
      score: 0,
      answered: false,
      typeScores: { word: 0, grammar: 0 }
    };
    renderQuiz();
  }

  function renderQuiz() {
    const question = quiz.questions[quiz.index];
    if (!question) {
      const wordTotal = quiz.questions.filter(entry => entry.item.type === "word").length;
      const grammarTotal = quiz.questions.filter(entry => entry.item.type === "grammar").length;
      document.querySelector("#quiz-content").innerHTML = `
        <p class="eyebrow">完成</p>
        <h2>${quiz.score} / ${quiz.questions.length}</h2>
        <div class="quiz-result-breakdown">
          <span>词汇 ${quiz.typeScores.word} / ${wordTotal}</span>
          <span>语法 ${quiz.typeScores.grammar} / ${grammarTotal}</span>
        </div>
        <p>这轮测验已经完成，错题已自动加入复习记录。</p>`;
      document.querySelector("#quiz-options").innerHTML = "";
      document.querySelector("#quiz-feedback").innerHTML = "";
      document.querySelector("#next-question").classList.add("hidden");
      return;
    }
    document.querySelector("#quiz-number").textContent = `第 ${quiz.index + 1} 题 / ${quiz.questions.length}`;
    document.querySelector("#quiz-score").textContent = `得分 ${quiz.score}`;
    document.querySelector("#quiz-content").innerHTML = `
      <p class="eyebrow">${question.item.type === "word" ? "请选择正确释义" : "请选择最符合的含义"}</p>
      <h2>${escapeHtml(question.item.term)}</h2>
      <p class="quiet">${escapeHtml(question.item.reading)}</p>`;
    document.querySelector("#quiz-options").innerHTML = question.options.map(option =>
      `<button data-option="${escapeHtml(option)}">${escapeHtml(option)}</button>`
    ).join("");
    document.querySelector("#quiz-feedback").innerHTML = "";
    document.querySelector("#next-question").classList.add("hidden");
    quiz.answered = false;
  }

  function answerQuiz(option, button) {
    if (quiz.answered) return;
    quiz.answered = true;
    const question = quiz.questions[quiz.index];
    const correct = option === question.item.meaning;
    const progress = itemState(question.item.id);
    document.querySelectorAll("#quiz-options button").forEach(el => {
      el.disabled = true;
      if (el.dataset.option === question.item.meaning) el.classList.add("correct");
    });
    if (correct) {
      quiz.score += 1;
      quiz.typeScores[question.item.type] += 1;
      document.querySelector("#quiz-feedback").innerHTML = `<strong>回答正确。</strong> ${escapeHtml(question.item.note)}`;
    } else {
      button.classList.add("wrong");
      progress.wrong += 1;
      progress.due = Date.now();
      document.querySelector("#quiz-feedback").innerHTML = `<strong>正确答案：${escapeHtml(question.item.meaning)}</strong><br>${escapeHtml(question.item.note)}`;
    }
    progress.reviews += 1;
    registerStudy();
    saveState();
    document.querySelector("#quiz-score").textContent = `得分 ${quiz.score}`;
    document.querySelector("#next-question").classList.remove("hidden");
    renderDashboard();
  }

  function matchesStatus(item, status) {
    const progress = itemState(item.id);
    if (status === "favorite") return progress.favorite;
    if (status === "wrong") return progress.wrong > 0;
    if (status === "mastered") return progress.mastered;
    return true;
  }

  function renderLibrary() {
    const query = libraryFilter.query.toLocaleLowerCase();
    const items = data.filter(item => {
      const typeMatch = libraryFilter.type === "all" || item.type === libraryFilter.type;
      const statusMatch = matchesStatus(item, libraryFilter.status);
      const haystack = [item.term, item.reading, item.meaning, item.note, ...(item.tags || [])].join(" ").toLocaleLowerCase();
      return typeMatch && statusMatch && haystack.includes(query);
    });
    document.querySelector("#library-summary").textContent = `共 ${items.length} 条 · 单词 ${items.filter(i => i.type === "word").length} · 语法 ${items.filter(i => i.type === "grammar").length}`;
    document.querySelector("#library-list").innerHTML = items.length ? items.map(item => {
      const progress = itemState(item.id);
      const status = reviewStatus(item);
      return `
        <article class="library-item" data-id="${item.id}">
          <span class="type-pill">${item.type === "word" ? "文字词汇" : "文法"}</span>
          <div><h3>${escapeHtml(item.term)}</h3><p>${escapeHtml(item.reading)}</p></div>
          <p>${escapeHtml(item.meaning)}</p>
          <div class="status-icons">
            <span class="review-status ${status.className}">${status.label}</span>
            <button class="${progress.favorite ? "on" : ""}" data-favorite="${item.id}" aria-label="收藏">◆</button>
            ${progress.wrong ? `<span title="错题次数">×${progress.wrong}</span>` : ""}
          </div>
        </article>`;
    }).join("") : `<p class="quiet">没有找到符合条件的内容。</p>`;
  }

  function showDetail(item) {
    const progress = itemState(item.id);
    const status = reviewStatus(item);
    document.querySelector("#dialog-content").innerHTML = `
      <p class="eyebrow">${item.type === "word" ? "文字 · 語彙" : "文法"}</p>
      <h2>${escapeHtml(item.term)}</h2>
      <p class="reading">${escapeHtml(item.reading)}</p>
      <button class="speak-button" data-speak="${escapeHtml(item.term)}">朗读日语</button>
      <section>
        <h3>${escapeHtml(item.meaning)}</h3>
        ${item.connection ? `<p><strong>接续：</strong>${escapeHtml(item.connection)}</p>` : ""}
        <p>${escapeHtml(item.note)}</p>
      </section>
      <section class="example">
        <strong>例句</strong>
        <p>${escapeHtml(item.example)}</p>
        <p class="quiet">${escapeHtml(item.translation)}</p>
      </section>
      <section>
        <p class="quiet">来源标记：${escapeHtml(item.source)}</p>
        <p class="quiet">学习状态：${status.label} · 复习 ${progress.reviews} 次 · 错题 ${progress.wrong} 次</p>
        <div class="detail-actions">
          <button class="secondary-button" data-detail-favorite="${item.id}">
            ${progress.favorite ? "取消收藏" : "加入收藏"}
          </button>
          ${progress.wrong ? `
            <button class="secondary-button" data-clear-wrong="${item.id}">
              已掌握，清除错题
            </button>
          ` : ""}
          ${progress.reviews ? `
            <button class="secondary-button" data-review-now="${item.id}">
              加入今日复习
            </button>
          ` : ""}
        </div>
      </section>`;
    const dialog = document.querySelector("#detail-dialog");
    if (!dialog.open) dialog.showModal();
  }

  document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => navigate(button.dataset.view)));
  document.querySelector("#start-review").addEventListener("click", () => navigate("cards"));
  document.querySelector("#daily-target").addEventListener("change", event => {
    state.dailyTarget = Number(event.target.value);
    saveState();
    renderDashboard();
  });
  document.querySelectorAll("[data-open-daily]").forEach(button => button.addEventListener("click", () => showDetail(dailyPick(button.dataset.openDaily))));
  document.querySelector("#study-card").addEventListener("click", flipCard);
  document.querySelector("#study-card").addEventListener("click", event => {
    const speak = event.target.closest("[data-speak]");
    if (speak) {
      event.stopImmediatePropagation();
      speakJapanese(speak.dataset.speak);
      return;
    }
    if (event.target.closest("#next-session")) {
      event.stopImmediatePropagation();
      buildCardQueue();
      renderCard();
    }
  }, true);
  document.addEventListener("keydown", event => {
    if (!document.querySelector("#cards-view").classList.contains("active")) return;
    if (event.code === "Space") {
      event.preventDefault();
      flipCard();
      return;
    }
    const ratingMap = {
      Digit1: "again",
      Digit2: "hard",
      Digit3: "good",
      Digit4: "easy"
    };
    if (
      ratingMap[event.code] &&
      document.querySelector("#study-card").classList.contains("flipped")
    ) {
      event.preventDefault();
      rateCard(ratingMap[event.code]);
    }
  });
  document.querySelector("#rating-buttons").addEventListener("click", event => {
    const button = event.target.closest("[data-rating]");
    if (button) rateCard(button.dataset.rating);
  });
  document.querySelector("#card-type").addEventListener("click", event => {
    const button = event.target.closest("[data-type]");
    if (!button) return;
    cardFilter = button.dataset.type;
    document.querySelectorAll("#card-type button").forEach(el => el.classList.toggle("active", el === button));
    buildCardQueue();
    renderCard();
  });
  document.querySelector("#shuffle-cards").addEventListener("click", () => {
    buildCardQueue();
    renderCard();
  });
  document.querySelector("#restart-quiz").addEventListener("click", startQuiz);
  document.querySelector("#quiz-type").addEventListener("click", event => {
    const button = event.target.closest("[data-quiz-type]");
    if (!button) return;
    quizFilter = button.dataset.quizType;
    document.querySelectorAll("#quiz-type button").forEach(element => {
      element.classList.toggle("active", element === button);
    });
    startQuiz();
  });
  document.querySelector("#next-question").addEventListener("click", () => {
    quiz.index += 1;
    renderQuiz();
  });
  document.querySelector("#quiz-options").addEventListener("click", event => {
    const button = event.target.closest("[data-option]");
    if (button) answerQuiz(button.dataset.option, button);
  });
  document.querySelector("#search-input").addEventListener("input", event => {
    libraryFilter.query = event.target.value.trim();
    renderLibrary();
  });
  ["#library-type", "#library-status"].forEach(selector => {
    document.querySelector(selector).addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;
      document.querySelectorAll(`${selector} button`).forEach(el => el.classList.toggle("active", el === button));
      if (button.dataset.type) libraryFilter.type = button.dataset.type;
      if (button.dataset.status) libraryFilter.status = button.dataset.status;
      renderLibrary();
    });
  });
  document.querySelector("#library-list").addEventListener("click", event => {
    const favorite = event.target.closest("[data-favorite]");
    if (favorite) {
      event.stopPropagation();
      const progress = itemState(favorite.dataset.favorite);
      progress.favorite = !progress.favorite;
      saveState();
      renderLibrary();
      return;
    }
    const row = event.target.closest("[data-id]");
    if (row) showDetail(data.find(item => item.id === row.dataset.id));
  });
  document.querySelector(".dialog-close").addEventListener("click", () => document.querySelector("#detail-dialog").close());
  document.querySelector("#detail-dialog").addEventListener("click", event => {
    if (event.target === event.currentTarget) {
      event.currentTarget.close();
      return;
    }
    const speak = event.target.closest("[data-speak]");
    if (speak) {
      speakJapanese(speak.dataset.speak);
      return;
    }
    const favorite = event.target.closest("[data-detail-favorite]");
    if (favorite) {
      const item = data.find(entry => entry.id === favorite.dataset.detailFavorite);
      itemState(item.id).favorite = !itemState(item.id).favorite;
      saveState();
      showDetail(item);
      renderLibrary();
      return;
    }
    const clearWrong = event.target.closest("[data-clear-wrong]");
    if (clearWrong) {
      const item = data.find(entry => entry.id === clearWrong.dataset.clearWrong);
      const progress = itemState(item.id);
      progress.wrong = 0;
      progress.mastered = true;
      progress.due = Date.now() + 7 * 86400000;
      saveState();
      showDetail(item);
      renderDashboard();
      renderLibrary();
      return;
    }
    const reviewNow = event.target.closest("[data-review-now]");
    if (reviewNow) {
      const item = data.find(entry => entry.id === reviewNow.dataset.reviewNow);
      const progress = itemState(item.id);
      progress.mastered = false;
      progress.due = Date.now();
      saveState();
      showDetail(item);
      renderDashboard();
      renderLibrary();
    }
  });
  document.querySelector("#export-progress").addEventListener("click", exportProgress);
  document.querySelector("#import-progress").addEventListener("click", () => {
    document.querySelector("#progress-file").click();
  });
  document.querySelector("#progress-file").addEventListener("change", event => {
    const [file] = event.target.files;
    if (file) importProgress(file);
    event.target.value = "";
  });

  buildCardQueue();
  renderDashboard();
  renderCard();
})();
