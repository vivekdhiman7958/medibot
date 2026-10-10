const acknowledgeButton = document.querySelector("#acknowledge");
const disclaimerCard = document.querySelector("#disclaimer-card");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const form = document.querySelector("#chat-form");
const messages = document.querySelector("#messages");

let sessionId = null;

async function readResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The server returned an unexpected response. Please restart the app and try again.");
  }
}

function appendInline(parent, text) {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|(?<!\*)\*[^*]+\*|(?<!_)_[^_]+_|`[^`]+`)/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parent.append(document.createTextNode(text.slice(cursor, index)));

    const token = match[0];
    const content = token.slice(token.startsWith("**") || token.startsWith("__") ? 2 : 1, -(
      token.startsWith("**") || token.startsWith("__") ? 2 : 1
    ));
    const element = document.createElement(
      token.startsWith("**") || token.startsWith("__") ? "strong" :
        token.startsWith("`") ? "code" : "em",
    );
    element.textContent = content;
    parent.append(element);
    cursor = index + token.length;
  }

  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function isBlockStart(lines, index) {
  return /^#{1,3}\s/.test(lines[index]) ||
    /^\s*[-*+]\s+/.test(lines[index]) ||
    /^\s*\d+[.)]\s+/.test(lines[index]) ||
    (lines[index].includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1]));
}

function renderMarkdown(text, target) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const fragment = document.createDocumentFragment();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) {
      const headers = splitTableRow(line);
      const tableWrap = document.createElement("div");
      tableWrap.className = "table-wrap";
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const headerRow = document.createElement("tr");
      for (const header of headers) {
        const cell = document.createElement("th");
        appendInline(cell, header);
        headerRow.append(cell);
      }
      head.append(headerRow);
      table.append(head);
      const body = document.createElement("tbody");
      index += 2;

      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const cells = splitTableRow(lines[index]);
        const row = document.createElement("tr");
        headers.forEach((_, cellIndex) => {
          const cell = document.createElement("td");
          appendInline(cell, cells[cellIndex] ?? "");
          row.append(cell);
        });
        body.append(row);
        index += 1;
      }
      table.append(body);
      tableWrap.append(table);
      fragment.append(tableWrap);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/) ?? line.match(/^\*\*([^*]+)\*\*$/);
    if (heading) {
      const markdownHeading = heading[1].startsWith("#");
      const element = document.createElement(markdownHeading ? `h${heading[1].length + 1}` : "h3");
      appendInline(element, markdownHeading ? heading[2] : heading[1]);
      fragment.append(element);
      index += 1;
      continue;
    }

    const listMatch = line.match(/^\s*([-*+])\s+(.+)$/);
    if (listMatch) {
      const list = document.createElement("ul");
      while (index < lines.length) {
        const item = lines[index].trim().match(/^[-*+]\s+(.+)$/);
        if (!item) break;
        const element = document.createElement("li");
        appendInline(element, item[1]);
        list.append(element);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const numberedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      const list = document.createElement("ol");
      while (index < lines.length) {
        const item = lines[index].trim().match(/^\d+[.)]\s+(.+)$/);
        if (!item) break;
        const element = document.createElement("li");
        appendInline(element, item[1]);
        list.append(element);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const paragraph = document.createElement("p");
    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    if (paragraphLines.length === 0) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    appendInline(paragraph, paragraphLines.join(" "));
    fragment.append(paragraph);
  }

  target.replaceChildren(fragment);
}

function addMessage(text, role, isError = false) {
  const article = document.createElement("article");
  article.className = `message ${role === "user" ? "user-message" : "assistant-message"}${isError ? " error-message" : ""}`;
  renderMarkdown(text, article);
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
  return article;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function revealMessage(text) {
  const article = addMessage("", "assistant");
  article.classList.add("typing");
  article.setAttribute("aria-busy", "true");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    renderMarkdown(text, article);
  } else {
    const chunks = text.match(/\S+\s*/g) ?? [];
    let visibleText = "";
    for (const chunk of chunks) {
      visibleText += chunk;
      renderMarkdown(visibleText, article);
      messages.scrollTop = messages.scrollHeight;
      await wait(24);
    }
  }

  article.classList.remove("typing");
  article.removeAttribute("aria-busy");
}

function appendSources(article, sources, notice) {
  if (!Array.isArray(sources) || sources.length === 0) return;
  const section = document.createElement("section");
  section.className = "web-sources";

  const note = document.createElement("p");
  note.className = "web-source-notice";
  note.textContent = notice || "Information found on the internet; this is general information, not a diagnosis.";
  section.append(note);

  const heading = document.createElement("h4");
  heading.textContent = "Sources";
  section.append(heading);
  const list = document.createElement("ul");

  for (const source of sources) {
    if (typeof source?.title !== "string" || typeof source?.url !== "string") continue;
    let url;
    try {
      url = new URL(source.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = source.title;
    item.append(link);
    list.append(item);
  }

  if (list.childElementCount > 0) section.append(list);
  article.append(section);
  messages.scrollTop = messages.scrollHeight;
}

async function acknowledge() {
  acknowledgeButton.disabled = true;
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ acknowledged: true }),
    });
    const data = await readResponse(response);
    if (!response.ok) throw new Error(data.error || "Could not start a session.");
    sessionId = data.sessionId;
    disclaimerCard.remove();
    input.disabled = false;
    sendButton.disabled = false;
    input.focus();
  } catch (error) {
    acknowledgeButton.disabled = false;
    addMessage(error.message || "Could not start a session.", "assistant", true);
  }
}

async function sendMessage(text) {
  if (!sessionId || !text.trim()) return;
  addMessage(text, "user");
  input.value = "";
  input.disabled = true;
  sendButton.disabled = true;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
    });
    const data = await readResponse(response);
    if (!response.ok) throw new Error(data.error || "The request could not be completed.");
    await revealMessage(data.answer);
    appendSources(
      messages.lastElementChild,
      data.sources,
      data.sourceNotice,
    );
  } catch (error) {
    addMessage(error.message || "The request could not be completed.", "assistant", true);
  } finally {
    input.disabled = false;
    sendButton.disabled = false;
    input.focus();
  }
}

acknowledgeButton.addEventListener("click", acknowledge);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage(input.value);
});
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => void sendMessage(button.dataset.message || ""));
});
