// Read/unread tracking in localStorage, per notebook: { topics: { [chapterId]: [topicId] }, chapters: [chapterId] }
export class Progress extends EventTarget {
  constructor(notebook) {
    super();
    this.key = `h2g2:progress:${notebook}`;
    try { this.data = JSON.parse(localStorage.getItem(this.key)) || {}; } catch { this.data = {}; }
    this.data.topics ||= {};
    this.data.chapters ||= [];
    window.addEventListener('storage', (e) => {
      if (e.key !== this.key) return;
      try { this.data = JSON.parse(e.newValue) || { topics: {}, chapters: [] }; } catch { return; }
      this.dispatchEvent(new Event('change'));
    });
  }
  #save() {
    localStorage.setItem(this.key, JSON.stringify(this.data));
    this.dispatchEvent(new Event('change'));
  }
  isTopicRead(chapterId, topicId) { return (this.data.topics[chapterId] || []).includes(topicId); }
  setTopicRead(chapter, topicId, read) {
    const set = new Set(this.data.topics[chapter.id] || []);
    read ? set.add(topicId) : set.delete(topicId);
    this.data.topics[chapter.id] = [...set];
    const allRead = chapter.topics?.length && chapter.topics.every((t) => set.has(t.id));
    this.#setChapter(chapter.id, !!allRead);
    this.#save();
  }
  isChapterRead(chapter) {
    if (chapter.topics?.length) return chapter.topics.every((t) => this.isTopicRead(chapter.id, t.id));
    return this.data.chapters.includes(chapter.id);
  }
  setChapterRead(chapter, read) {
    this.data.topics[chapter.id] = read ? (chapter.topics || []).map((t) => t.id) : [];
    this.#setChapter(chapter.id, read);
    this.#save();
  }
  #setChapter(id, read) {
    const set = new Set(this.data.chapters);
    read ? set.add(id) : set.delete(id);
    this.data.chapters = [...set];
  }
  /** Fraction read for a chapter (topics) */
  chapterFraction(chapter) {
    if (!chapter.topics?.length) return this.isChapterRead(chapter) ? 1 : 0;
    return chapter.topics.filter((t) => this.isTopicRead(chapter.id, t.id)).length / chapter.topics.length;
  }
  /** Overall fraction across flattened chapters (each topic counts once; topic-less chapters count as one unit). */
  overall(chapters) {
    let total = 0;
    let done = 0;
    for (const c of chapters) {
      const units = c.topics?.length || 1;
      total += units;
      done += this.chapterFraction(c) * units;
    }
    return total ? done / total : 0;
  }
}

/** Read the stored fraction without instantiating listeners (library covers). */
export function storedProgress(notebook) {
  try { return JSON.parse(localStorage.getItem(`h2g2:progress:${notebook}`)) || null; } catch { return null; }
}
