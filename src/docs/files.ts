// Файлы документов: извлечение текста из PDF/DOCX/TXT/HTML и экспорт в DOCX.
// Скан без текстового слоя не выдаётся за пустой документ: человек получает понятное сообщение о распознавании (OCR).

import fs from "node:fs";
import path from "node:path";
import { msg, type Msg } from "../shared/types";
import { htmlToText } from "../core/text";

export interface Extraction {
  status: "ok" | "needs_ocr" | "unsupported" | "error";
  text: string;
  pages: number | null;
  method: "pdf" | "docx" | "text" | "html" | null;
  message: Msg;
}

const MAX_CHARS = 200_000;

export async function extractText(filePath: string): Promise<Extraction> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".txt" || ext === ".md") {
      const text = fs.readFileSync(filePath, "utf8").slice(0, MAX_CHARS);
      return { status: "ok", text, pages: null, method: "text", message: msg("Текст загружен", "Text loaded") };
    }
    if (ext === ".html" || ext === ".htm") {
      const text = htmlToText(fs.readFileSync(filePath, "utf8")).slice(0, MAX_CHARS);
      return { status: "ok", text, pages: null, method: "html", message: msg("Текст извлечён из HTML", "Text extracted from HTML") };
    }
    if (ext === ".docx") {
      const mammoth = await import("mammoth");
      const r = await mammoth.extractRawText({ buffer: fs.readFileSync(filePath) });
      const text = r.value.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_CHARS);
      if (!text) return { status: "error", text: "", pages: null, method: "docx", message: msg("В документе DOCX нет текста (возможно, только картинки)", "The DOCX document has no text (perhaps only images)") };
      return { status: "ok", text, pages: null, method: "docx", message: msg(`Текст извлечён из DOCX: ${text.length} символов`, `Text extracted from DOCX: ${text.length} characters`) };
    }
    if (ext === ".pdf") {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(filePath)));
      const r = await pdfText(pdf, { mergePages: false });
      const pages = r.totalPages;
      const text = (r.text as string[]).map((p) => p.replace(/[ \t]+\n/g, "\n").trim()).filter(Boolean).join("\n\n").slice(0, MAX_CHARS);
      // Меньше ~20 печатных символов на страницу — почти наверняка скан без текстового слоя
      const printable = text.replace(/\s+/g, "").length;
      if (printable < Math.max(20, pages * 20)) {
        return {
          status: "needs_ocr", text, pages, method: "pdf",
          message: msg(
            `PDF похож на скан: в нём нет текстового слоя (${pages} стр.). Файл сохранён, но текст не извлечён. Распознайте текст (OCR) — например, «Просмотр» на Mac, Microsoft Word или Google Документы умеют это — и импортируйте результат как DOCX или PDF с текстом.`,
            `This PDF looks like a scan: it has no text layer (${pages} pages). The file is saved, but no text was extracted. Run text recognition (OCR) — Preview on Mac, Microsoft Word or Google Docs can do it — and import the result as DOCX or a text PDF.`,
          ),
        };
      }
      return { status: "ok", text, pages, method: "pdf", message: msg(`Текст извлечён из PDF: ${pages} стр., ${text.length} символов`, `Text extracted from PDF: ${pages} pages, ${text.length} characters`) };
    }
    return { status: "unsupported", text: "", pages: null, method: null, message: msg(`Файл ${ext || "без расширения"} сохранён; текст извлекается из PDF, DOCX, TXT, MD и HTML`, `The ${ext || "extensionless"} file is saved; text is extracted from PDF, DOCX, TXT, MD and HTML`) };
  } catch (e) {
    return { status: "error", text: "", pages: null, method: null, message: msg(`Не удалось прочитать файл: ${(e as Error).message}`, `Could not read the file: ${(e as Error).message}`) };
  }
}

/** DOCX из текста документа: «# » — заголовок, «- »/«• » — пункт списка, пустая строка — новый абзац. */
export async function toDocx(title: string, content: string): Promise<Buffer> {
  const { Document, HeadingLevel, Packer, Paragraph, TextRun } = await import("docx");
  const children = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] })];
  for (const raw of content.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      children.push(new Paragraph({ heading: h[1].length === 1 ? HeadingLevel.HEADING_1 : h[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: [new TextRun(h[2])] }));
      continue;
    }
    const b = line.match(/^\s*[-•*]\s+(.*)$/);
    if (b) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b[1])] }));
      continue;
    }
    children.push(new Paragraph({ children: [new TextRun(line)] }));
  }
  const doc = new Document({ creator: "Job Search Desktop", title, styles: { default: { document: { run: { font: "Calibri", size: 22 } } } }, sections: [{ children }] });
  return Packer.toBuffer(doc);
}
