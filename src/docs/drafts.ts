// Доказательные черновики документов без AI: только подтверждённые факты профиля.
// Самоописания идут отдельным блоком «требует примера» и в текст письма как факт не попадают.

import type { MaterialVersion, SkillEvidence, Vacancy } from "../shared/types";
import { normalizeText } from "../core/text";

export const TEMPLATE_VERSION = "template-2026.10.21";

function matchSkills(v: Vacancy, skills: SkillEvidence[]) {
  const want = [...v.facts.skills.value.required, ...v.facts.skills.value.preferred, ...v.facts.skills.value.mentioned].map((s) => normalizeText(s));
  const body = normalizeText(`${v.title} ${v.description.slice(0, 8000)}`);
  const relevant = (s: SkillEvidence) => want.includes(normalizeText(s.skill)) || body.includes(normalizeText(s.skill));
  return {
    proven: skills.filter((s) => s.kind === "proven" && relevant(s)),
    provenOther: skills.filter((s) => s.kind === "proven" && !relevant(s)),
    self: skills.filter((s) => s.kind === "self_reported" && relevant(s)),
    missing: v.facts.skills.value.required.filter((r) => !skills.some((s) => normalizeText(s.skill) === normalizeText(r) && s.kind === "proven")),
  };
}

export function templateLetter(input: { candidateName: string; vacancy: Vacancy; skills: SkillEvidence[]; lang: "ru" | "en" }): { content: string; usedFacts: string[]; gaps: string[] } {
  const { vacancy: v, lang } = input;
  const m = matchSkills(v, input.skills);
  const used = [...m.proven, ...m.provenOther.slice(0, 2)];
  const line = (s: SkillEvidence) => `• ${s.skill}${s.evidence ? ` — ${s.evidence}` : ""}${s.url ? ` (${s.url})` : ""}`;
  const gaps = [
    ...m.missing.map((s) => (lang === "ru" ? `Нет подтверждённого навыка: ${s}` : `No proven skill: ${s}`)),
    ...m.self.map((s) => (lang === "ru" ? `Только со слов, нужен пример: ${s.skill}` : `Self-reported only, example needed: ${s.skill}`)),
  ];
  const content =
    lang === "ru"
      ? [
          `Здравствуйте!`,
          ``,
          `Меня заинтересовала вакансия «${v.title}» в компании ${v.company || "вашей компании"}.`,
          used.length ? `Что я уже делал(а) и могу показать:` : `Подтверждённых примеров, относящихся к этой роли, в профиле пока нет.`,
          ...used.map(line),
          ``,
          `Готов(а) выполнить тестовое задание и ответить на вопросы письменно.`,
          ``,
          `С уважением,`,
          input.candidateName,
        ].join("\n")
      : [
          `Hello,`,
          ``,
          `I am interested in the "${v.title}" position at ${v.company || "your company"}.`,
          used.length ? `What I have done and can show:` : `My profile has no proven examples related to this role yet.`,
          ...used.map(line),
          ``,
          `I am happy to complete a test task and answer questions in writing.`,
          ``,
          `Best regards,`,
          input.candidateName,
        ].join("\n");
  return { content, usedFacts: used.map((s) => s.id), gaps };
}

export function templateCv(input: { candidateName: string; notes: string; skills: SkillEvidence[]; lang: "ru" | "en" }): { content: string; usedFacts: string[] } {
  const ru = input.lang === "ru";
  const proven = input.skills.filter((s) => s.kind === "proven");
  const self = input.skills.filter((s) => s.kind === "self_reported");
  const lines = [
    `# ${input.candidateName}`,
    ``,
    input.notes ? input.notes : "",
    ``,
    ru ? `## Подтверждённые навыки и примеры` : `## Proven skills and examples`,
    ...(proven.length ? proven.map((s) => `- **${s.skill}**${s.evidence ? ` — ${s.evidence}` : ""}${s.url ? ` (${s.url})` : ""}`) : [ru ? "- (пока нет — добавьте примеры в профиле)" : "- (none yet — add examples in the profile)"]),
    ``,
    ru ? `## Изучаю / со слов (проверьте перед отправкой)` : `## Learning / self-reported (review before sending)`,
    ...(self.length ? self.map((s) => `- ${s.skill}${s.evidence ? ` — ${s.evidence}` : ""}`) : ["-"]),
  ];
  return { content: lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"), usedFacts: [...proven, ...self].map((s) => s.id) };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Простое безопасное преобразование текста/Markdown в HTML (заголовки, списки, абзацы, жирный). */
export function textToHtml(title: string, content: string, lang: "ru" | "en"): string {
  const blocks: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(`<ul>${list.map((li) => `<li>${li}</li>`).join("")}</ul>`);
    list = [];
  };
  const inline = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  for (const raw of content.split("\n")) {
    const l = raw.trimEnd();
    if (/^#\s/.test(l)) {
      flush();
      blocks.push(`<h1>${inline(l.slice(2))}</h1>`);
    } else if (/^##\s/.test(l)) {
      flush();
      blocks.push(`<h2>${inline(l.slice(3))}</h2>`);
    } else if (/^[-•]\s/.test(l)) list.push(inline(l.replace(/^[-•]\s/, "")));
    else if (!l.trim()) flush();
    else {
      flush();
      blocks.push(`<p>${inline(l)}</p>`);
    }
  }
  flush();
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(title)}</title>
<style>body{font:11pt/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2328;max-width:720px;margin:32px auto;padding:0 24px}h1{font-size:18pt;margin:0 0 12px}h2{font-size:13pt;margin:18px 0 6px}ul{padding-left:20px}p{margin:6px 0}</style></head><body>${blocks.join("\n")}</body></html>`;
}

export function materialFileName(m: Pick<MaterialVersion, "title" | "version">, ext: string): string {
  const base = m.title.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "document";
  return `${base} v${m.version}.${ext}`;
}
